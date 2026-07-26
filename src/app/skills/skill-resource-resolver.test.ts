import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readSkillResource,
  resolveSkillResource,
  type SkillResourceErrorFacts,
  type SkillResourcePackageInput,
  type SkillResourceResolvedFacts,
  type SkillResourceResolverResult,
} from "./skill-resource-resolver.js";

test("readSkillResource returns text facts for a legal reference", async () => {
  const fixture = await createSkillFixture("reference-ok");
  try {
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "guide.md"), "Use precise facts.", "utf8");

    const result = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/guide.md",
      type: "reference",
      maxChars: 100,
    }));

    assert.equal(result.relativePath, "references/guide.md");
    assert.equal(result.type, "reference");
    assert.equal(result.content, "Use precise facts.");
    assert.equal(result.byteLength, Buffer.byteLength("Use precise facts.", "utf8"));
    assert.equal(result.charCount, "Use precise facts.".length);
    assert.equal(result.truncated, false);
    assert.equal(result.contentHash, hashBuffer(Buffer.from("Use precise facts.", "utf8")));
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource never returns asset body content", async () => {
  const fixture = await createSkillFixture("asset-metadata");
  try {
    const assetBytes = Buffer.from([0, 255, 1, 2, 3]);
    await fs.mkdir(path.join(fixture.packagePath, "assets"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "assets", "logo.bin"), assetBytes);

    const result = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "assets/logo.bin",
      type: "asset",
      maxChars: 1,
    }));

    assert.equal(result.relativePath, "assets/logo.bin");
    assert.equal(result.type, "asset");
    assert.equal("content" in result, false);
    assert.equal(result.charCount, undefined);
    assert.equal(result.byteLength, assetBytes.byteLength);
    assert.equal(result.truncated, false);
    assert.equal(result.contentHash, hashBuffer(assetBytes));
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource reports scripts as metadata-only and does not execute them", async () => {
  const fixture = await createSkillFixture("script-metadata");
  try {
    await fs.mkdir(path.join(fixture.packagePath, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(fixture.packagePath, "scripts", "danger.js"),
      "throw new Error('SCRIPT_EXECUTED');",
      "utf8"
    );

    const result = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "scripts/danger.js",
      type: "script",
      maxChars: 100,
    }));

    assert.equal(result.relativePath, "scripts/danger.js");
    assert.equal(result.type, "script");
    assert.equal("content" in result, false);
    assert.equal(result.requiresToolExecution, true);
    assert.equal(result.notExecutableByResolver, true);
    assert.match(result.executionNote ?? "", /ToolCenter confirmation/);
    assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource blocks path escape before reading outside the package", async () => {
  const fixture = await createSkillFixture("path-escape");
  try {
    await fs.writeFile(path.join(fixture.rootPath, "outside.txt"), "OUTSIDE_SENTINEL", "utf8");

    const result = expectError(await readSkillResource({
      ...fixture,
      relativePath: "../outside.txt",
      type: "reference",
      maxChars: 100,
    }));

    assert.equal(result.errorCode, "path_escape");
    assert.equal(result.relativePath, "");
    assert.equal("content" in result, false);
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource truncates reference content by maxChars while keeping full counts", async () => {
  const fixture = await createSkillFixture("reference-truncate");
  try {
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "long.txt"), "abcdef", "utf8");

    const result = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/long.txt",
      type: "reference",
      maxChars: 3,
    }));

    assert.equal(result.content, "abc");
    assert.equal(result.charCount, 6);
    assert.equal(result.byteLength, 6);
    assert.equal(result.truncated, true);
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource streams a late reference window while preserving full hash and counts", async () => {
  const fixture = await createSkillFixture("reference-late-window");
  try {
    const content = `${"x".repeat(2_000_000)}tail`;
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "large.txt"), content, "utf8");

    const result = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/large.txt",
      type: "reference",
      startChar: 2_000_000,
      maxChars: 4,
    }));

    assert.equal(result.content, "tail");
    assert.equal(result.charCount, content.length);
    assert.equal(result.byteLength, Buffer.byteLength(content, "utf8"));
    assert.equal(result.contentHash, hashBuffer(Buffer.from(content, "utf8")));
    assert.equal(result.truncated, false);
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource keeps large UTF-8 streams on safe UTF-16 continuation boundaries", async () => {
  const fixture = await createSkillFixture("reference-emoji-boundary");
  try {
    const content = `${"a".repeat(65_535)}😀z${"b".repeat(70_000)}`;
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "unicode.txt"), content, "utf8");

    const beforeEmoji = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/unicode.txt",
      type: "reference",
      startChar: 65_533,
      maxChars: 3,
    }));
    assert.equal(beforeEmoji.content, "aa");
    assert.equal(beforeEmoji.truncated, true);
    assert.equal(beforeEmoji.charCount, content.length);
    assert.equal(beforeEmoji.contentHash, hashBuffer(Buffer.from(content, "utf8")));

    const fromEmoji = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/unicode.txt",
      type: "reference",
      startChar: 65_535,
      maxChars: 3,
    }));
    assert.equal(fromEmoji.content, "😀z");
    assert.equal(fromEmoji.truncated, true);

    const splitEmoji = expectError(await readSkillResource({
      ...fixture,
      relativePath: "references/unicode.txt",
      type: "reference",
      startChar: 65_536,
      maxChars: 3,
    }));
    assert.equal(splitEmoji.errorCode, "invalid_start_char");
    assert.match(splitEmoji.errorMessage, /surrogate pair/u);
  } finally {
    await removeFixture(fixture);
  }
});

test("readSkillResource propagates cancellation from the file stream", async () => {
  const fixture = await createSkillFixture("reference-cancel");
  try {
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "large.txt"), "x".repeat(1_000_000), "utf8");
    const controller = new AbortController();
    controller.abort(new Error("cancel skill read"));

    await assert.rejects(
      readSkillResource({
        ...fixture,
        relativePath: "references/large.txt",
        type: "reference",
        maxChars: 10,
        abortSignal: controller.signal,
      }),
      /cancel skill read/u,
    );
  } finally {
    await removeFixture(fixture);
  }
});

test("resolveSkillResource hashes are stable across read limits", async () => {
  const fixture = await createSkillFixture("hash-stable");
  try {
    const content = "stable hash content";
    await fs.mkdir(path.join(fixture.packagePath, "references"), { recursive: true });
    await fs.writeFile(path.join(fixture.packagePath, "references", "hash.txt"), content, "utf8");

    const truncated = expectResolved(await readSkillResource({
      ...fixture,
      relativePath: "references/hash.txt",
      type: "reference",
      maxChars: 6,
    }));
    const resolved = expectResolved(await resolveSkillResource({
      ...fixture,
      relativePath: "references/hash.txt",
      type: "reference",
      maxChars: 100,
    }));

    assert.equal(truncated.contentHash, resolved.contentHash);
    assert.equal(resolved.contentHash, hashBuffer(Buffer.from(content, "utf8")));
    assert.equal(truncated.truncated, true);
    assert.equal(resolved.truncated, false);
    assert.equal("content" in resolved, false);
  } finally {
    await removeFixture(fixture);
  }
});

async function createSkillFixture(name: string): Promise<SkillResourcePackageInput & {
  readonly rootPath: string;
}> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), `agentarbor-skill-resource-${name}-`));
  const packagePath = path.join(rootPath, "sample-skill");
  const sourcePath = path.join(packagePath, "SKILL.md");
  await fs.mkdir(packagePath, { recursive: true });
  await fs.writeFile(
    sourcePath,
    "---\nname: sample-skill\ndescription: Fixture skill.\n---\n\nBody.",
    "utf8"
  );
  return { rootPath, packagePath, sourcePath };
}

async function removeFixture(fixture: { readonly rootPath: string }): Promise<void> {
  await fs.rm(fixture.rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function expectResolved(result: SkillResourceResolverResult): SkillResourceResolvedFacts {
  if (result.ok) {
    return result;
  }
  assert.fail(result.errorCode);
}

function expectError(result: SkillResourceResolverResult): SkillResourceErrorFacts {
  if (!result.ok) {
    return result;
  }
  assert.fail("skill resource unexpectedly resolved");
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
