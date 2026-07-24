import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPatch } from "diff";
import { MAX_LOCAL_WORKSPACE_FILE_BYTES } from "./local-workspace-common.js";
import {
  createLocalGrepFilesTool,
} from "./local-workspace-read-tools.js";
import {
  createLocalEditFileTool,
  EDIT_FILE_DIFF_MAX_INPUT_CHARS,
} from "./local-workspace-write-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("local grep JS fallback reports factual skipped file counts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-grep-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "src", "match.txt"), "alpha\nneedle beta\n", "utf8");
    await writeFile(path.join(root, "src", "binary.png"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(root, "src", "large.txt"), "x".repeat(MAX_LOCAL_WORKSPACE_FILE_BYTES + 1), "utf8");
    await writeFile(path.join(root, "dist", "generated.txt"), "needle in skipped directory\n", "utf8");

    const grepFiles = createLocalGrepFilesTool(root, { ripgrepSearch: false });
    const grep = await grepFiles.execute({ path: ".", query: "needle" }, context);
    const result = asDirectToolFacts(grep);
    const matches = result.matches as readonly unknown[];
    const samples = (result.skippedSamples as readonly unknown[]).map(asRecord);

    assert.equal(result.engine, "js");
    assert.equal(result.skippedFactsAvailable, true);
    assert.equal(result.skippedFactsComplete, true);
    assert.equal(result.searchedFiles, 1);
    assert.equal(result.skippedFiles, 2);
    assert.equal(result.skippedBinaryFiles, 1);
    assert.equal(result.skippedTooLargeFiles, 1);
    assert.equal(result.skippedUnreadableFiles, 0);
    assert.equal(result.skippedDirectories, 1);
    assert.deepEqual(matches, [{ path: "src/match.txt", line: 2, preview: "needle beta" }]);
    assert.equal(samples.some((sample) => sample.path === "src/binary.png" && sample.reason === "binary"), true);
    assert.equal(samples.some((sample) => sample.path === "src/large.txt" && sample.reason === "too_large"), true);
    assert.equal(samples.some((sample) => sample.path === "dist" && sample.reason === "skipped_directory"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep rg engine leaves skipped facts unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-grep-rg-"));
  try {
    const grepFiles = createLocalGrepFilesTool(root, {
      ripgrepSearch: async () => [{ path: "src/from-rg.txt", line: 1, preview: "needle" }],
    });

    const grep = await grepFiles.execute({ path: ".", query: "needle" }, context);
    const result = asDirectToolFacts(grep);

    assert.equal(result.engine, "rg");
    assert.equal(result.skippedFactsAvailable, false);
    assert.equal(result.skippedFiles, undefined);
    assert.deepEqual(result.matches, [{ path: "src/from-rg.txt", line: 1, preview: "needle" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit reports replacement facts after writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-"));
  try {
    const file = path.join(root, "notes.txt");
    const original = "alpha\nbeta\ngamma\n";
    await writeFile(file, original, "utf8");

    const editFile = createLocalEditFileTool(root);
    const edited = await editFile.execute({
      path: "notes.txt",
      edits: [{ oldText: "beta", newText: "BETA" }],
    }, context);
    const result = asDirectToolFacts(edited);

    assert.equal(result.changed, true);
    assert.equal(result.replacements, 1);
    assert.equal(typeof result.beforeHash, "string");
    assert.equal(typeof result.afterHash, "string");
    assert.notEqual(result.beforeHash, result.afterHash);
    const diff = asRecord(result.diff);
    assert.equal(diff.status, "available");
    assert.equal(typeof diff.unifiedDiff, "string");
    assert.equal(applyPatch(original, String(diff.unifiedDiff)), original.replace("beta", "BETA"));
    assert.equal(await readFile(file, "utf8"), original.replace("beta", "BETA"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit records an unchanged canonical diff without fabricating a patch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-unchanged-"));
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "same\n", "utf8");
    const result = asDirectToolFacts(await createLocalEditFileTool(root).execute({
      path: "notes.txt",
      edits: [{ oldText: "same", newText: "same" }],
    }, context));

    assert.deepEqual(result.diff, { status: "unchanged" });
    assert.equal(result.changed, false);
    assert.equal(result.replacements, 0);
    assert.equal(await readFile(file, "utf8"), "same\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit reports the canonical diff input limit without blocking the write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-limit-"));
  try {
    const file = path.join(root, "large.txt");
    const original = `a${"x".repeat(Math.floor(EDIT_FILE_DIFF_MAX_INPUT_CHARS / 2) + 1)}\n`;
    await writeFile(file, original, "utf8");
    const result = asDirectToolFacts(await createLocalEditFileTool(root).execute({
      path: "large.txt",
      edits: [{ oldText: "a", newText: "b" }],
    }, context));
    const diff = asRecord(result.diff);

    assert.equal(diff.status, "unavailable");
    assert.equal(diff.reason, "input_limit_exceeded");
    assert.equal(diff.beforeChars, original.length);
    assert.equal(diff.afterChars, original.length);
    assert.equal(diff.maxInputChars, EDIT_FILE_DIFF_MAX_INPUT_CHARS);
    assert.equal(diff.unifiedDiff, undefined);
    assert.equal(await readFile(file, "utf8"), `b${original.slice(1)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit failure messages include facts without next-step suggestions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-error-"));
  try {
    await writeFile(path.join(root, "notes.txt"), "same\nsame\n", "utf8");
    const editFile = createLocalEditFileTool(root);

    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "once" }] }, context),
      (error) => {
        const message = errorMessage(error);
        assert.match(message, /must match exactly once/);
        assert.match(message, /matches=2/);
        assert.equal(message.includes("provide occurrence"), false);
        assert.equal(message.includes("try reading"), false);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function asDirectToolFacts(value: unknown): Record<string, unknown> {
  const output = asRecord(value);
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `workspace output must not contain ${legacyField}`);
  }
  return output;
}

function errorMessage(error: unknown): string {
  assert.equal(error instanceof Error, true);
  return (error as Error).message;
}
