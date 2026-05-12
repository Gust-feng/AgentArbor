import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLocalEditFileTool,
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
  createLocalRunCommandTool,
  createLocalShellCommandTool,
  createLocalWorkspaceSandboxPolicy,
  createLocalWriteFileTool,
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

test("local write_file and edit_file stay inside the local strategy sandbox", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const writeFileTool = createLocalWriteFileTool(root);
    const editFile = createLocalEditFileTool(root);

    const written = await writeFileTool.execute({ path: "notes/result.md", content: "# Title\n\nbody\n" }, context);
    const edited = await editFile.execute({ path: "notes/result.md", oldText: "body", newText: "updated body" }, context);

    assert.equal(asRecord(written).action, "write_file");
    assert.equal(asRecord(written).refId, "workspace:file:notes/result.md");
    assert.equal(asRecord(edited).action, "edit_file");
    assert.equal(await readFile(path.join(root, "notes", "result.md"), "utf8"), "# Title\n\nupdated body\n");

    await assert.rejects(
      () => writeFileTool.execute({ path: "../outside.md", content: "nope" }, context),
      /outside the workspace boundary/
    );
    await assert.rejects(
      () => writeFileTool.execute({ path: ".trellis/local.md", content: "nope" }, context),
      /blocked workspace path/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local run_command uses policy allowlists and internal workspace commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha", "utf8");
    const runCommand = createLocalRunCommandTool(root);
    const shellCommand = createLocalShellCommandTool(root);

    const echoed = await runCommand.execute({ command: "echo", args: ["hello", "workspace"] }, context);
    const shellEchoed = await shellCommand.execute({ command: "echo", args: ["hello", "shell"] }, context);
    const listed = await runCommand.execute({ command: "dir", args: ["src"] }, context);
    const typed = await runCommand.execute({ command: "type", args: ["src/note.txt"] }, context);

    assert.equal(asRecord(echoed).action, "run_command");
    assert.equal(asRecord(shellEchoed).action, "shell_command");
    assert.match(String(asRecord(shellEchoed).refId), /^workspace:shell:/);
    assert.match(String(asRecord(asRecord(echoed).result).stdout), /hello workspace/);
    assert.match(String(asRecord(asRecord(listed).result).stdout), /note\.txt/);
    assert.match(String(asRecord(asRecord(typed).result).stdout), /alpha/);
    await assert.rejects(
      () => runCommand.execute({ command: "git", args: ["checkout", "--", "."] }, context),
      /read-only git commands/
    );
    await assert.rejects(
      () => runCommand.execute({ command: "powershell", args: ["-Command", "Get-ChildItem"] }, context),
      /rejected command/
    );
    await assert.rejects(
      () => runCommand.execute({ command: path.join(root, "git"), args: ["status"] }, context),
      /bare command name/
    );
    await assert.rejects(
      () => runCommand.execute({ command: "git", args: ["--git-dir=../other/.git", "status"] }, context),
      /outside the local workspace boundary/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local strategy sandbox can disable writes and command execution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const sandboxPolicy = createLocalWorkspaceSandboxPolicy({ allowWrite: false, allowExecute: false });
    const writeFileTool = createLocalWriteFileTool(root, { sandboxPolicy });
    const runCommand = createLocalRunCommandTool(root, { sandboxPolicy });

    await assert.rejects(
      () => writeFileTool.execute({ path: "note.txt", content: "nope" }, context),
      /does not allow local file writes/
    );
    await assert.rejects(
      () => runCommand.execute({ command: "echo", args: ["nope"] }, context),
      /does not allow local command execution/
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
