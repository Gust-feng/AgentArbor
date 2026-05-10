import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
} from "./local-workspace-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("local workspace tools read, list, and grep within workspace boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha\nneedle beta\n", "utf8");

    const readFile = createLocalReadFileTool(root);
    const listDir = createLocalListDirTool(root);
    const grepFiles = createLocalGrepFilesTool(root);

    const read = await readFile.execute({ path: "src/note.txt" }, context);
    assert.equal(asRecord(read).action, "read_file");
    assert.equal(asRecord(read).refId, "workspace:file:src/note.txt");
    assert.equal(asRecord(asRecord(read).result).path, "src/note.txt");
    assert.match(String(asRecord(asRecord(read).result).content), /needle beta/);

    const listed = await listDir.execute({ path: "src" }, context);
    assert.equal(asRecord(listed).action, "list_dir");
    const entries = asRecord(asRecord(listed).result).entries as readonly { readonly name: string }[];
    assert.deepEqual(entries.map((entry) => entry.name), ["note.txt"]);

    const grep = await grepFiles.execute({ path: "src", query: "needle" }, context);
    assert.equal(asRecord(grep).action, "grep_files");
    const matches = asRecord(asRecord(grep).result).matches as readonly { readonly path: string; readonly line: number }[];
    assert.deepEqual(matches, [{ path: "src/note.txt", line: 2, preview: "needle beta" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read_file rejects paths outside workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const readFile = createLocalReadFileTool(root);
    await assert.rejects(
      () => readFile.execute({ path: "../outside.txt" }, context),
      /outside the workspace boundary/
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
