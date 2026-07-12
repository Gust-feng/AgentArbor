import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReadSkillResourceTool } from "./skill-resource-tool.js";

test("read_skill_resource reads only indexed resources from loaded selected skills", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);

    const output = await tool.execute({
      skillId: "sample-skill",
      type: "reference",
      path: "references/guide.md",
      maxChars: 100,
    }, executionContext());

    const result = asRecord(asRecord(output).result);
    assert.equal(asRecord(output).action, "read_skill_resource");
    assert.equal(result.content, "Use precise facts.");
    assert.equal(result.contentHash, hash("Use precise facts."));
    assert.equal(result.truncated, false);
  } finally {
    await fixture.remove();
  }
});

test("read_skill_resource rejects unselected, omitted, failed, and unindexed resources", async () => {
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

test("read_skill_resource reports assets and scripts without returning raw content", async () => {
  const fixture = await createFixture();
  try {
    const tool = createReadSkillResourceTool([fixture.skillContext()]);

    const asset = asRecord(await tool.execute({
      skillId: "sample-skill",
      type: "asset",
      path: "assets/logo.bin",
    }, executionContext()));
    const assetResult = asRecord(asset.result);
    assert.equal("content" in assetResult, true);
    assert.equal(assetResult.content, undefined);
    assert.equal(assetResult.byteLength, 5);

    const script = asRecord(await tool.execute({
      skillId: "sample-skill",
      type: "script",
      path: "scripts/run.js",
    }, executionContext()));
    const scriptResult = asRecord(script.result);
    assert.equal(scriptResult.requiresToolExecution, true);
    assert.equal(scriptResult.notExecutableByResolver, true);
    assert.equal(scriptResult.content, undefined);
  } finally {
    await fixture.remove();
  }
});

test("read_skill_resource fails closed when resource hash changed after run creation", async () => {
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

async function createFixture(): Promise<{
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-resource-tool-"));
  const packagePath = path.join(root, "sample-skill");
  const sourcePath = path.join(packagePath, "SKILL.md");
  await fs.mkdir(path.join(packagePath, "references"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "assets"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "scripts"), { recursive: true });
  await fs.mkdir(path.join(packagePath, "evals"), { recursive: true });
  await fs.writeFile(sourcePath, "---\nname: sample-skill\ndescription: Sample.\n---\n\nBody.", "utf8");
  await fs.writeFile(path.join(packagePath, "references", "guide.md"), "Use precise facts.", "utf8");
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
              contentHash: hash("Use precise facts."),
              byteLength: Buffer.byteLength("Use precise facts.", "utf8"),
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
              contentHash: hash("Use precise facts."),
              byteLength: Buffer.byteLength("Use precise facts.", "utf8"),
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
    remove: () => fs.rm(root, { recursive: true, force: true }),
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

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
