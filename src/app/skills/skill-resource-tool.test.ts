import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolFactValue } from "../../domain/tools/index.js";
import { ToolCenter } from "../tool-center/tool-center.js";
import { createReadSkillResourceTool } from "./skill-resource-tool.js";

test("skill_read publishes closed integer bounds for resource windows", () => {
  const schema = createReadSkillResourceTool().definition.inputSchema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["skillId", "path", "type"]);
  assert.deepEqual(schema.properties.maxChars, {
    type: "integer",
    minimum: 1,
    maximum: 64_000,
    description: "Maximum reference characters to return.",
  });
  assert.equal((schema.properties.startChar as { readonly type?: unknown }).type, "integer");
});

test("skill_read reads only indexed resources from loaded selected skills", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);

    const output = await tool.execute({
      skillId: "sample-skill",
      type: "reference",
      path: "references/guide.md",
      maxChars: 100,
    }, executionContext());

    const result = asRecord(output);
    assertDirectToolFacts(result);
    assert.equal(result.content, "Use precise facts.");
    assert.equal(result.contentHash, hash("Use precise facts."));
    assert.equal(result.truncated, false);
  } finally {
    await fixture.remove();
  }
});

test("skill_read continues beyond the former startChar ceiling without repeating a window", async () => {
  const referenceContent = `${"x".repeat(2_000_000)}abc`;
  const fixture = await createFixture({ referenceContent });
  try {
    const center = new ToolCenter();
    center.register(createReadSkillResourceTool([fixture.skillContext()]));
    const permission = { callerAgentId: "agent", allowedTools: ["SkillRead"] };
    const first = await center.execute({
      callId: "call-skill-before-ceiling",
      toolName: "SkillRead",
      input: {
        skillId: "sample-skill",
        type: "reference",
        path: "references/guide.md",
        maxChars: 2,
        startChar: 1_999_998,
      },
    }, executionContext(), permission);
    const firstOutput = asRecord(first.output);
    const nextInput = asRecord(asRecord(firstOutput.continuation).nextInput);

    assert.equal(first.status, "completed");
    assert.equal(firstOutput.content, "xx");
    assert.equal(firstOutput.truncated, true);
    assert.equal(nextInput.startChar, 2_000_000);
    assert.equal(Number(nextInput.startChar) > Number(firstOutput.startChar), true);
    assert.equal(Number(nextInput.startChar) <= 2_000_000, true);

    const second = await center.execute({
      callId: "call-skill-former-ceiling",
      toolName: "SkillRead",
      input: nextInput as ToolFactValue,
    }, executionContext(), permission);
    const secondOutput = asRecord(second.output);
    const thirdInput = asRecord(asRecord(secondOutput.continuation).nextInput);

    assert.equal(second.status, "completed");
    assert.equal(secondOutput.content, "ab");
    assert.equal(secondOutput.truncated, true);
    assert.equal(thirdInput.startChar, 2_000_002);
    assert.equal(Number(thirdInput.startChar) > Number(secondOutput.startChar), true);

    const third = await center.execute({
      callId: "call-skill-beyond-former-ceiling",
      toolName: "SkillRead",
      input: thirdInput as ToolFactValue,
    }, executionContext(), permission);
    const thirdOutput = asRecord(third.output);

    assert.equal(third.status, "completed");
    assert.equal(thirdOutput.content, "c");
    assert.equal(thirdOutput.truncated, false);
    assert.equal(thirdOutput.continuation, undefined);
    assert.equal(`${firstOutput.content}${secondOutput.content}${thirdOutput.content}`, "xxabc");
  } finally {
    await fixture.remove();
  }
});

test("skill_read continuation never splits an emoji at a stream boundary", async () => {
  const referenceContent = `${"a".repeat(65_535)}😀z`;
  const fixture = await createFixture({ referenceContent });
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);
    const first = asRecord(await tool.execute({
      skillId: "sample-skill",
      type: "reference",
      path: "references/guide.md",
      maxChars: 3,
      startChar: 65_533,
    }, executionContext()));
    const nextInput = asRecord(asRecord(first.continuation).nextInput);

    assert.equal(first.content, "aa");
    assert.equal(first.truncated, true);
    assert.equal(nextInput.startChar, 65_535);

    const second = asRecord(await tool.execute(nextInput as ToolFactValue, executionContext()));
    assert.equal(second.content, "😀z");
    assert.equal(second.truncated, false);
    assert.equal(second.continuation, undefined);
  } finally {
    await fixture.remove();
  }
});

test("skill_read rejects fractional continuation offsets", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);
    await assert.rejects(
      () => tool.execute({
        skillId: "sample-skill",
        type: "reference",
        path: "references/guide.md",
        startChar: 1.5,
      }, executionContext()),
      /non-negative safe integer/
    );
  } finally {
    await fixture.remove();
  }
});

test("skill_read rejects unselected, omitted, failed, and unindexed resources", async () => {
  const fixture = await createFixture();
  try {
    const loadedTool = createReadSkillResourceTool([fixture.skillContext()]);
    const omittedTool = createReadSkillResourceTool([fixture.skillContext({ omitted: true })]);
    const failedTool = createReadSkillResourceTool([fixture.skillContext({ loadStatus: "failed" })]);

    await assert.rejects(
      () => loadedTool.execute({ skillId: "other", type: "reference", path: "references/guide.md" }, executionContext()),
      /not available/
    );
    await assert.rejects(
      () => loadedTool.execute({ skillId: "sample-skill", type: "reference", path: "references/missing.md" }, executionContext()),
      /not available/
    );
    await assert.rejects(
      () => loadedTool.execute({ skillId: "sample-skill", type: "eval", path: "evals/review-case.json" }, executionContext()),
      /type must be reference, asset, or script/
    );
    await assert.rejects(
      () => omittedTool.execute({ skillId: "sample-skill", type: "reference", path: "references/guide.md" }, executionContext()),
      /not available/
    );
    await assert.rejects(
      () => failedTool.execute({ skillId: "sample-skill", type: "reference", path: "references/guide.md" }, executionContext()),
      /not available/
    );
  } finally {
    await fixture.remove();
  }
});

test("skill_read reports assets and scripts without returning raw content", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);

    const asset = asRecord(await tool.execute({
      skillId: "sample-skill",
      type: "asset",
      path: "assets/logo.bin",
    }, executionContext()));
    assertDirectToolFacts(asset);
    assert.equal(asset.content, undefined);
    assert.equal(asset.byteLength, 5);

    const script = asRecord(await tool.execute({
      skillId: "sample-skill",
      type: "script",
      path: "scripts/run.js",
    }, executionContext()));
    assertDirectToolFacts(script);
    assert.equal(script.requiresToolExecution, true);
    assert.equal(script.notExecutableByResolver, true);
    assert.equal(script.content, undefined);
  } finally {
    await fixture.remove();
  }
});

test("skill_read fails closed when resource hash changed after run creation", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);
    await fs.writeFile(path.join(fixture.packagePath, "references", "guide.md"), "Changed.", "utf8");

    await assert.rejects(
      () => tool.execute({
        skillId: "sample-skill",
        type: "reference",
        path: "references/guide.md",
      }, executionContext()),
      /hash does not match/
    );
  } finally {
    await fixture.remove();
  }
});

async function createFixture(options: { readonly referenceContent?: string } = {}): Promise<{
  readonly packagePath: string;
  readonly sourcePath: string;
  skillContext(overrides?: { readonly omitted?: boolean; readonly loadStatus?: "loaded" | "failed" }): {
    readonly skill: any;
    readonly body: string;
    readonly triggerReason: string;
    readonly loadStatus: "loaded" | "failed";
    readonly omitted?: boolean;
  };
  remove(): Promise<void>;
}> {
  const referenceContent = options.referenceContent ?? "Use precise facts.";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-resource-tool-"));
  const packagePath = path.join(root, "sample-skill");
  const sourcePath = path.join(packagePath, "SKILL.md");
  await fs.mkdir(path.join(packagePath, "references"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "assets"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "scripts"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "evals"), { recursive: true });
  await fs.writeFile(sourcePath, "---\nname: sample-skill\ndescription: Sample.\n---\n\nBody.", "utf8");
  await fs.writeFile(path.join(packagePath, "references", "guide.md"), referenceContent, "utf8");
  await fs.writeFile(path.join(packagePath, "assets", "logo.bin"), Buffer.from([1, 2, 3, 4, 5]));
  await fs.writeFile(path.join(packagePath, "scripts", "run.js"), "throw new Error('executed');", "utf8");
  await fs.writeFile(path.join(packagePath, "evals", "review-case.json"), "{\"input\":\"review\"}", "utf8");
  return {
    packagePath,
    sourcePath,
    skillContext(overrides = {}) {
      return {
        skill: {
          id: "sample-skill",
          name: "sample-skill",
          description: "Sample.",
          enabled: true,
          sourcePath,
          triggers: [],
          packagePath,
          resourceIndex: [
            {
              type: "reference",
              relativePath: "references/guide.md",
              exists: true,
              contentHash: hash(referenceContent),
              byteLength: Buffer.byteLength(referenceContent, "utf8"),
            },
            {
              type: "asset",
              relativePath: "assets/logo.bin",
              exists: true,
              contentHash: `sha256:${createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5])).digest("hex")}`,
              byteLength: 5,
            },
            {
              type: "script",
              relativePath: "scripts/run.js",
              exists: true,
              contentHash: hash("throw new Error('executed');"),
              byteLength: Buffer.byteLength("throw new Error('executed');", "utf8"),
            },
            {
              type: "eval",
              relativePath: "evals/review-case.json",
              exists: true,
              contentHash: hash("{\"input\":\"review\"}"),
              byteLength: Buffer.byteLength("{\"input\":\"review\"}", "utf8"),
            },
          ],
          resources: [
            {
              kind: "reference",
              name: "guide.md",
              relativePath: "references/guide.md",
              sourcePath: path.join(packagePath, "references", "guide.md"),
              contentHash: hash(referenceContent),
              byteLength: Buffer.byteLength(referenceContent, "utf8"),
            },
            {
              kind: "asset",
              name: "logo.bin",
              relativePath: "assets/logo.bin",
              sourcePath: path.join(packagePath, "assets", "logo.bin"),
              contentHash: `sha256:${createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5])).digest("hex")}`,
              byteLength: 5,
            },
            {
              kind: "script",
              name: "run.js",
              relativePath: "scripts/run.js",
              sourcePath: path.join(packagePath, "scripts", "run.js"),
              contentHash: hash("throw new Error('executed');"),
              byteLength: Buffer.byteLength("throw new Error('executed');", "utf8"),
            },
          ],
        },
        body: "Body.",
        triggerReason: "test",
        loadStatus: overrides.loadStatus ?? "loaded",
        omitted: overrides.omitted,
      };
    },
    remove: () => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

function executionContext() {
  return {
    callerAgentId: "agent",
    traceId: "trace",
    goalId: "goal",
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? value as Readonly<Record<string, unknown>> : {};
}

function assertDirectToolFacts(output: Readonly<Record<string, unknown>>): void {
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `skill resource output must not contain ${legacyField}`);
  }
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
