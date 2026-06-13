import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLocalCreateFileTool,
  createLocalDeleteFileTool,
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
const sourceDirectory = path.join(process.cwd(), "src", "app", "tool-center", "adapters");

test("local workspace adapter keeps sandbox policy and tool families split from compatibility exports", async () => {
  const [toolsSource, sandboxSource, commandSource, readSource, writeSource, commonSource] = await Promise.all([
    readFile(path.join(sourceDirectory, "local-workspace-tools.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "local-workspace-sandbox.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "local-workspace-command-tools.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "local-workspace-read-tools.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "local-workspace-write-tools.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "local-workspace-common.ts"), "utf8"),
  ]);

  assert.equal(toolsSource.includes('from "./local-workspace-sandbox.js"'), true);
  assert.equal(toolsSource.includes('from "./local-workspace-command-tools.js"'), true);
  assert.equal(toolsSource.includes('from "./local-workspace-read-tools.js"'), true);
  assert.equal(toolsSource.includes('from "./local-workspace-write-tools.js"'), true);
  assert.equal(toolsSource.includes('from "./local-workspace-common.js"'), false);
  assert.equal(toolsSource.includes("export function createLocalWorkspaceSandboxPolicy"), false);
  assert.equal(toolsSource.includes("export function createLocalReadFileTool"), false);
  assert.equal(toolsSource.includes("export function createLocalListDirTool"), false);
  assert.equal(toolsSource.includes("export function createLocalGrepFilesTool"), false);
  assert.equal(toolsSource.includes("export function createLocalWriteFileTool"), false);
  assert.equal(toolsSource.includes("export function createLocalCreateFileTool"), false);
  assert.equal(toolsSource.includes("export function createLocalEditFileTool"), false);
  assert.equal(toolsSource.includes("export function createLocalDeleteFileTool"), false);
  assert.equal(toolsSource.includes("export function createLocalRunCommandTool"), false);
  assert.equal(toolsSource.includes("export function createLocalShellCommandTool"), false);
  assert.equal(toolsSource.includes("async function grepPath"), false);
  assert.equal(toolsSource.includes("function parseAnchorEdits"), false);
  assert.equal(toolsSource.includes("function locateAnchorEdits"), false);
  assert.equal(toolsSource.includes("async function runInternalWorkspaceCommand"), false);
  assert.equal(toolsSource.includes("function commandToolOutput"), false);
  assert.equal(toolsSource.includes("function checkCommandArgs"), false);
  assert.equal(toolsSource.includes("function checkSandboxPath"), false);
  assert.equal(toolsSource.includes("function splitSimpleCommandLine"), false);
  assert.equal(toolsSource.includes("function hasShellControlToken"), false);
  assert.equal(toolsSource.includes("function resolveWorkspacePath"), false);
  assert.equal(toolsSource.includes("function asRecord"), false);
  assert.equal(sandboxSource.includes("export function createLocalWorkspaceSandboxPolicy"), true);
  assert.equal(sandboxSource.includes("function checkCommandArgs"), false);
  assert.equal(sandboxSource.includes("function checkSandboxPath"), true);
  assert.equal(sandboxSource.includes("function splitSimpleCommandLine"), false);
  assert.equal(commandSource.includes("export function createLocalRunCommandTool"), true);
  assert.equal(commandSource.includes("export function createLocalShellCommandTool"), true);
  assert.equal(commandSource.includes("function runShellCommand"), true);
  assert.equal(commandSource.includes("function runProgramCommand"), true);
  assert.equal(commandSource.includes("function commandToolOutput"), true);
  assert.equal(readSource.includes("export function createLocalReadFileTool"), true);
  assert.equal(readSource.includes("export function createLocalListDirTool"), true);
  assert.equal(readSource.includes("export function createLocalGrepFilesTool"), true);
  assert.equal(readSource.includes("async function grepPath"), true);
  assert.equal(writeSource.includes("export function createLocalWriteFileTool"), true);
  assert.equal(writeSource.includes("export function createLocalCreateFileTool"), true);
  assert.equal(writeSource.includes("export function createLocalEditFileTool"), true);
  assert.equal(writeSource.includes("export function createLocalDeleteFileTool"), true);
  assert.equal(writeSource.includes("function parseAnchorEdits"), true);
  assert.equal(writeSource.includes("function locateAnchorEdits"), true);
  assert.equal(commonSource.includes("export function resolveWorkspacePath"), true);
  assert.equal(commonSource.includes("export function asRecord"), true);
});

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

test("local create_file and edit_file stay inside the local strategy sandbox", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const createFile = createLocalCreateFileTool(root);
    const editFile = createLocalEditFileTool(root);

    const created = await createFile.execute({ path: "notes/result.md", content: "# Title\n\nbody\n" }, context);
    const edited = await editFile.execute({
      path: "notes/result.md",
      edits: [{ anchor: "body", replacement: "updated body" }],
    }, context);

    assert.equal(asRecord(created).action, "create_file");
    assert.equal(asRecord(created).refId, "workspace:file:notes/result.md");
    assert.equal(asRecord(edited).action, "edit_file");
    assert.equal(typeof asRecord(asRecord(edited).result).beforeHash, "string");
    assert.equal(typeof asRecord(asRecord(edited).result).afterHash, "string");
    assert.equal(await readFile(path.join(root, "notes", "result.md"), "utf8"), "# Title\n\nupdated body\n");

    await assert.rejects(
      () => createFile.execute({ path: "notes/result.md", content: "overwrite" }, context),
      /already exists/
    );
    await assert.rejects(
      () => createFile.execute({ path: "../outside.md", content: "nope" }, context),
      /outside the workspace boundary/
    );
    await mkdir(path.join(root, ".trellis"));
    const trellisCreated = await createFile.execute({ path: ".trellis/local.md", content: "allowed body" }, context);
    assert.equal(asRecord(asRecord(trellisCreated).result).path, ".trellis/local.md");
    const overwritten = await createFile.execute({ path: "notes/result.md", content: "overwritten", overwrite: true }, context);
    assert.equal(asRecord(asRecord(overwritten).result).overwrite, true);
    assert.equal(await readFile(path.join(root, "notes", "result.md"), "utf8"), "overwritten");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit_file validates all anchors before writing and rejects ambiguous edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "alpha\nbeta\ngamma\n", "utf8");
    const editFile = createLocalEditFileTool(root);

    await editFile.execute({
      path: "notes.txt",
      edits: [
        { anchor: "alpha", replacement: "ALPHA" },
        { anchor: "gamma", replacement: "GAMMA" },
      ],
    }, context);
    assert.equal(await readFile(file, "utf8"), "ALPHA\nbeta\nGAMMA\n");

    await writeFile(file, "same\nsame\n", "utf8");
    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "once" }] }, context),
      /matched 2 locations/
    );
    assert.equal(await readFile(file, "utf8"), "same\nsame\n");

    await editFile.execute({
      path: "notes.txt",
      edits: [{ oldText: "same", newText: "second", occurrence: 2 }],
    }, context);
    assert.equal(await readFile(file, "utf8"), "same\nsecond\n");

    await writeFile(file, "same\nsame\nsame\n", "utf8");
    await editFile.execute({
      path: "notes.txt",
      edits: [{ oldText: "same", newText: "middle", startLine: 2, endLine: 2 }],
    }, context);
    assert.equal(await readFile(file, "utf8"), "same\nmiddle\nsame\n");

    await writeFile(file, "same\nsame\n", "utf8");
    await assert.rejects(
      () => editFile.execute({
        path: "notes.txt",
        edits: [
          { oldText: "same\nsame", newText: "both" },
          { oldText: "same", newText: "one" },
        ],
      }, context),
      /matched 2 locations|overlap/
    );

    await assert.rejects(
      () => editFile.execute({
        path: "notes.txt",
        edits: [{ oldText: "same", newText: "missing", occurrence: 2, startLine: 1, endLine: 1 }],
      }, context),
      /did not overlap the requested line range/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local write tools do not require confirmation", async () => {
  const writeFileTool = createLocalWriteFileTool();
  const createFileTool = createLocalCreateFileTool();
  const editFileTool = createLocalEditFileTool();
  const deleteFileTool = createLocalDeleteFileTool();

  assert.equal(writeFileTool.definition.metadata?.requiresConfirmation, false);
  assert.equal(createFileTool.definition.metadata?.requiresConfirmation, false);
  assert.equal(editFileTool.definition.metadata?.requiresConfirmation, false);
  assert.equal(deleteFileTool.definition.metadata?.requiresConfirmation, false);
});

test("local delete_file deletes only regular files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "dir"));
    await writeFile(path.join(root, "dir", "note.txt"), "remove me", "utf8");
    const deleteFile = createLocalDeleteFileTool(root);

    const deleted = await deleteFile.execute({ path: "dir/note.txt" }, context);
    assert.equal(asRecord(deleted).action, "delete_file");
    await assert.rejects(() => readFile(path.join(root, "dir", "note.txt"), "utf8"), /ENOENT/);
    await assert.rejects(
      () => deleteFile.execute({ path: "dir" }, context),
      /regular file path/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local run_command uses the workspace shell and confirmation metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha", "utf8");
    const runCommand = createLocalRunCommandTool(root);
    const shellCommand = createLocalShellCommandTool(root);

    assert.equal(runCommand.definition.metadata?.requiresConfirmation, true);
    assert.equal(shellCommand.definition.metadata?.requiresConfirmation, true);
    assert.deepEqual(shellCommand.definition.inputSchema.required, []);
    assert.equal("args" in shellCommand.definition.inputSchema.properties, true);
    assert.equal(shellCommand.definition.metadata?.runtimeHints?.[0]?.kind, "command_shell");

    const echoed = await runCommand.execute({ commandLine: "echo hello workspace" }, context);
    const shellStyleEchoed = await runCommand.execute({ commandLine: "echo approval-review" }, context);
    const quotedEchoed = await shellCommand.execute({ commandLine: "echo hello quoted shell" }, context);
    const shellEchoed = await shellCommand.execute({ commandLine: "echo hello shell" }, context);
    const chained = await runCommand.execute({ commandLine: "echo safe && echo unsafe" }, context);
    const piped = await shellCommand.execute({ commandLine: platformPipeCommand() }, context);
    const listed = await runCommand.execute({ commandLine: platformListCommand("src") }, context);
    const typed = await runCommand.execute({ commandLine: platformReadCommand(path.join("src", "note.txt")) }, context);
    const inlineScript = await shellCommand.execute({ commandLine: nodeInlineScriptCommand() }, context);
    const legacyArgs = await shellCommand.execute({ command: process.execPath, args: ["-e", "console.log('hello legacy args')"] }, context);

    assert.equal(asRecord(echoed).action, "run_command");
    assert.equal(asRecord(shellEchoed).action, "shell_command");
    assert.match(String(asRecord(shellEchoed).refId), /^workspace:shell:/);
    assert.equal(asRecord(asRecord(shellEchoed).result).commandLine, "echo hello shell");
    assert.equal(typeof asRecord(asRecord(shellEchoed).result).shell, "object");
    assert.match(String(asRecord(asRecord(echoed).result).stdout), /hello workspace/);
    assert.match(String(asRecord(asRecord(shellStyleEchoed).result).stdout), /approval-review/);
    assert.match(String(asRecord(asRecord(quotedEchoed).result).stdout), /hello quoted shell/);
    assert.match(String(asRecord(asRecord(chained).result).stdout), /safe/);
    assert.match(String(asRecord(asRecord(chained).result).stdout), /unsafe/);
    assert.match(String(asRecord(asRecord(piped).result).stdout), /needle/);
    assert.match(String(asRecord(asRecord(listed).result).stdout), /note\.txt/);
    assert.match(String(asRecord(asRecord(typed).result).stdout), /alpha/);
    assert.match(String(asRecord(asRecord(inlineScript).result).stdout), /hello_inline_script/);
    assert.match(String(asRecord(asRecord(legacyArgs).result).stdout), /hello legacy args/);

    const quotedPython = await shellCommand.execute({
      commandLine: `${process.execPath} -e "console.log('fragile quoted shell')"` ,
      command: process.execPath,
      args: ["-e", "console.log('fragile quoted shell')"],
    }, context);
    assert.match(String(asRecord(asRecord(quotedPython).result).stdout), /fragile quoted shell/);
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
      () => runCommand.execute({ commandLine: "echo nope" }, context),
      /does not allow local command execution/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function platformPipeCommand(): string {
  return process.platform === "win32" ? "echo needle | findstr needle" : "printf 'needle\\n' | grep needle";
}

function platformListCommand(directory: string): string {
  return process.platform === "win32" ? `dir /b ${directory}` : `ls ${directory}`;
}

function platformReadCommand(file: string): string {
  const normalized = process.platform === "win32" ? file.split(path.sep).join("\\") : file.split(path.sep).join("/");
  return process.platform === "win32" ? `type ${normalized}` : `cat ${normalized}`;
}

function quotePath(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function nodeInlineScriptCommand(): string {
  if (process.platform === "win32") {
    return "node -e console.log('hello_inline_script')";
  }
  return `${quotePath(process.execPath)} -e ${quotePath("console.log('hello_inline_script')")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}
