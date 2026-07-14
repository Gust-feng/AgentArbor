import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_LOCAL_WORKSPACE_FILE_BYTES } from "./local-workspace-common.js";
import {
  createLocalGrepFilesTool,
  createLocalListDirTool,
} from "./local-workspace-read-tools.js";
import { createLocalEditFileTool } from "./local-workspace-write-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("local list_dir reports recursive entry facts without truncating small results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-list-"));
  try {
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await writeFile(path.join(root, "readme.md"), "root", "utf8");
    await writeFile(path.join(root, "src", "nested", "deep.txt"), "deep", "utf8");

    const listDir = createLocalListDirTool(root);
    const listed = await listDir.execute({ path: ".", depth: 3 }, context);
    const output = asDirectToolFacts(listed);
    const entries = (output.entries as readonly unknown[]).map(asRecord);
    const byPath = new Map(entries.map((entry) => [String(entry.path), entry]));

    assert.equal(output.truncated, false);
    assert.equal(output.depth, 3);
    assert.equal(output.entriesReturned, 4);
    assert.equal(output.totalEntries, 4);
    assert.equal(output.scanComplete, true);
    assert.equal(byPath.get("readme.md")?.name, "readme.md");
    assert.equal(byPath.get("readme.md")?.kind, "file");
    assert.equal(byPath.get("readme.md")?.bytes, 4);
    assert.equal(byPath.get("readme.md")?.depth, 1);
    assert.equal(byPath.get("src")?.kind, "directory");
    assert.equal(typeof byPath.get("src")?.bytes, "number");
    assert.equal(byPath.get("src")?.depth, 1);
    assert.equal(byPath.get("src/nested")?.depth, 2);
    assert.equal(byPath.get("src/nested/deep.txt")?.name, "deep.txt");
    assert.equal(byPath.get("src/nested/deep.txt")?.kind, "file");
    assert.equal(byPath.get("src/nested/deep.txt")?.bytes, 4);
    assert.equal(byPath.get("src/nested/deep.txt")?.depth, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local list_dir caps large results at the tool maximum", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-list-large-"));
  try {
    for (let index = 0; index < 205; index += 1) {
      await writeFile(path.join(root, `file-${String(index).padStart(3, "0")}.txt`), "x", "utf8");
    }

    const listDir = createLocalListDirTool(root);
    const listed = await listDir.execute({ path: "." }, context);
    const output = asDirectToolFacts(listed);
    const entries = output.entries as readonly unknown[];

    assert.equal(output.truncated, true);
    assert.equal(output.depth, 1);
    assert.equal(output.maxEntries, 200);
    assert.equal(output.entriesReturned, 200);
    assert.equal(output.totalEntries, undefined);
    assert.equal(output.scanComplete, false);
    assert.equal(entries.length, 200);
    assert.equal(JSON.stringify(output).length < 180_000, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep_files JS fallback reports factual skipped file counts", async () => {
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

test("local grep_files rg engine leaves skipped facts unavailable", async () => {
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

test("local edit_file dryRun reports replacement facts without writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-"));
  try {
    const file = path.join(root, "notes.txt");
    const original = "alpha\nbeta\ngamma\n";
    await writeFile(file, original, "utf8");

    const editFile = createLocalEditFileTool(root);
    const edited = await editFile.execute({
      path: "notes.txt",
      dryRun: true,
      edits: [{ oldText: "beta", newText: "BETA" }],
    }, context);
    const result = asDirectToolFacts(edited);

    assert.equal(result.dryRun, true);
    assert.equal(result.wouldReplace, 1);
    assert.equal(result.replacements, 0);
    assert.equal(result.previousLength, original.length);
    assert.equal(result.nextLength, original.replace("beta", "BETA").length);
    assert.equal(typeof result.beforeHash, "string");
    assert.equal(typeof result.afterHash, "string");
    assert.notEqual(result.beforeHash, result.afterHash);
    assert.deepEqual(result.diffSummary, ["line 2: beta -> BETA"]);
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit_file failure messages include facts without next-step suggestions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-facts-edit-error-"));
  try {
    await writeFile(path.join(root, "notes.txt"), "same\nsame\n", "utf8");
    const editFile = createLocalEditFileTool(root);

    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "once" }] }, context),
      (error) => {
        const message = errorMessage(error);
        assert.match(message, /matched 2 locations/);
        assert.match(message, /matches=2/);
        assert.match(message, /availableMatches=2/);
        assert.equal(message.includes("provide occurrence"), false);
        assert.equal(message.includes("try reading"), false);
        return true;
      }
    );

    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "third", occurrence: 3 }] }, context),
      (error) => {
        const message = errorMessage(error);
        assert.match(message, /requested occurrence 3/);
        assert.match(message, /requestedOccurrence=3/);
        assert.match(message, /availableMatches=2/);
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
