import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { createConnection, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createLocalEditFileTool,
  createLocalGlobTool,
  createLocalGrepFilesTool,
  createLocalReadFileTool,
  createLocalShellCommandTool,
  createLocalWorkspaceSandboxPolicy,
  createLocalWriteFileTool,
  InMemoryLocalWorkspaceMutationCoordinator,
} from "./local-workspace-tools.js";
import { ensurePidExited } from "./background-process-test-utils.js";
import { createDefaultCommandShellConfig } from "./local-workspace-command-tools.js";

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
  assert.equal(commandSource.includes("export function createLocalShellCommandTool"), true);
  assert.equal(commandSource.includes("function runShellCommand"), true);
  assert.equal(commandSource.includes("function runProgramCommand"), true);
  assert.equal(commandSource.includes("function commandToolOutput"), true);
  assert.equal(readSource.includes("export function createLocalReadFileTool"), true);
  assert.equal(readSource.includes("export function createLocalListDirTool"), false);
  assert.equal(readSource.includes("export function createLocalGrepFilesTool"), true);
  assert.equal(readSource.includes("async function grepPath"), true);
  assert.equal(writeSource.includes("export function createLocalWriteFileTool"), true);
  assert.equal(writeSource.includes("export function createLocalCreateFileTool"), false);
  assert.equal(writeSource.includes("export function createLocalEditFileTool"), true);
  assert.equal(writeSource.includes("export function createLocalDeleteFileTool"), false);
  assert.equal(writeSource.includes("function parseExactEdits"), true);
  assert.equal(writeSource.includes("function locateExactEdits"), true);
  assert.equal(commonSource.includes("export function resolveWorkspacePath"), true);
  // asRecord 已收敛到 src/kernel/values；common 继续对外提供该名字，
  // 但通过转出而不是本地重新实现，避免记录判定语义再次分裂。
  assert.equal(commonSource.includes("export { asRecord };"), true);
});

test("default command shell follows AgentArbor Windows auto-detection order", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-shell-default-"));
  try {
    const fakeGitBash = path.join(root, "bash.exe");
    await writeFile(fakeGitBash, "", "utf8");

    const gitBash = createDefaultCommandShellConfig("win32", {
      CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash,
    });
    const powerShell = createDefaultCommandShellConfig("win32", {
      CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash,
      AGENTARBOR_USE_POWERSHELL_TOOL: "1",
    });
    const externalPowerShellPreference = createDefaultCommandShellConfig("win32", {
      CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash,
      CLAUDE_CODE_USE_POWERSHELL_TOOL: "1",
    });
    const fallback = createDefaultCommandShellConfig("win32", {});

    assert.equal(gitBash.configuredKind, "auto");
    assert.equal(gitBash.kind, "bash");
    assert.equal(gitBash.label, "Git Bash");
    assert.equal(gitBash.syntax, "posix");
    assert.equal(gitBash.executable, fakeGitBash);
    assert.equal(powerShell.kind, "powershell");
    assert.equal(powerShell.syntax, "powershell");
    assert.equal(externalPowerShellPreference.kind, "bash");
    assert.equal(fallback.kind === "bash" || fallback.kind === "pwsh" || fallback.kind === "powershell" || fallback.kind === "cmd", true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local workspace tools read and grep within workspace boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha\nneedle beta\n", "utf8");

    const readFile = createLocalReadFileTool(root);
    const grepFiles = createLocalGrepFilesTool(root);

    const read = await readFile.execute({ path: "src/note.txt" }, context);
    const readFacts = asDirectToolFacts(read);
    assert.equal(readFacts.refId, "workspace:file:src/note.txt");
    assert.equal(readFacts.path, "src/note.txt");
    assert.match(String(readFacts.content), /needle beta/);
    assert.equal(readFacts.totalLines, 3);

    const rangedRead = await readFile.execute({ path: "src/note.txt", startLine: 2, endLine: 2 }, context);
    const rangedReadFacts = asDirectToolFacts(rangedRead);
    assert.equal(rangedReadFacts.content, "needle beta");
    assert.equal(rangedReadFacts.startLine, 2);
    assert.equal(rangedReadFacts.endLine, 2);
    assert.equal(rangedReadFacts.hasMoreBefore, true);
    assert.equal(rangedReadFacts.hasMoreAfter, true);
    assert.equal(rangedReadFacts.nextStartLine, 3);
    assert.deepEqual(asRecord(asRecord(rangedReadFacts.continuation).nextInput), {
      path: "src/note.txt",
      startLine: 3,
    });

    const emptyRangeRead = await readFile.execute({ path: "src/note.txt", startLine: 20, endLine: 21 }, context);
    const emptyRangeFacts = asDirectToolFacts(emptyRangeRead);
    assert.equal(emptyRangeFacts.content, "");
    assert.equal(emptyRangeFacts.hasMoreBefore, true);
    assert.equal(emptyRangeFacts.hasMoreAfter, false);

    const grep = await grepFiles.execute({ path: "src", query: "needle" }, context);
    const matches = asDirectToolFacts(grep).matches as readonly { readonly path: string; readonly line: number }[];
    assert.deepEqual(matches, [{ path: "src/note.txt", line: 2, preview: "needle beta" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C05 exposes a concise PascalCase workspace tool surface", () => {
  assert.equal(createLocalReadFileTool().definition.name, "Read");
  assert.equal(createLocalGrepFilesTool().definition.name, "Grep");
  assert.equal(createLocalGlobTool().definition.name, "Glob");
  assert.equal(createLocalWriteFileTool().definition.name, "Write");
  assert.equal(createLocalEditFileTool().definition.name, "Edit");
  assert.equal(createLocalShellCommandTool().definition.name, "Shell");
  assert.deepEqual(Object.keys(createLocalShellCommandTool().definition.inputSchema.properties), [
    "command", "timeoutMs", "cwd", "background",
  ]);
  const editItemProperties = asRecord(asRecord(createLocalEditFileTool().definition.inputSchema.properties.edits).items).properties;
  assert.deepEqual(Object.keys(asRecord(editItemProperties)), ["oldText", "newText"]);
});

test("C05 permits modifying existing files without a prior Read", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-c04-read-before-write-"));
  try {
    const target = path.join(root, "note.txt");
    await writeFile(target, "before\n", "utf8");
    const writeTool = createLocalWriteFileTool(root);
    const editTool = createLocalEditFileTool(root);

    await writeTool.execute({ path: "note.txt", content: "blind overwrite\n" }, context);
    await writeFile(target, "external change\n", "utf8");
    await editTool.execute({ path: "note.txt", edits: [{ oldText: "external", newText: "updated" }] }, context);
    assert.equal(await readFile(target, "utf8"), "updated change\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-run concurrent edits of one file compose in source order without losing changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-same-file-edits-"));
  try {
    const target = path.join(root, "note.txt");
    await writeFile(target, "alpha\nbeta\n", "utf8");
    const mutationCoordinator = new InMemoryLocalWorkspaceMutationCoordinator();
    const editTool = createLocalEditFileTool(root, { mutationCoordinator });

    const results = await Promise.all([
      editTool.execute({ path: "note.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, context),
      editTool.execute({ path: "note.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, context),
    ]);

    assert.equal(results.length, 2);
    assert.equal(await readFile(target, "utf8"), "ALPHA\nBETA\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-run overlapping edits preserve the first change and reject the stale replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-overlapping-edits-"));
  try {
    const target = path.join(root, "note.txt");
    await writeFile(target, "alpha\n", "utf8");
    const mutationCoordinator = new InMemoryLocalWorkspaceMutationCoordinator();
    const editTool = createLocalEditFileTool(root, { mutationCoordinator });

    const results = await Promise.allSettled([
      editTool.execute({ path: "note.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, context),
      editTool.execute({ path: "note.txt", edits: [{ oldText: "alpha", newText: "Alpha" }] }, context),
    ]);

    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    assert.match(String(results[1]?.status === "rejected" ? results[1].reason : ""), /must match exactly once.*matches=0/);
    assert.equal(await readFile(target, "utf8"), "ALPHA\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared mutation coordination composes independent edits across runs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-cross-run-edits-"));
  try {
    const target = path.join(root, "note.txt");
    await writeFile(target, "alpha\nbeta\n", "utf8");
    const mutationCoordinator = new InMemoryLocalWorkspaceMutationCoordinator();
    const firstEdit = createLocalEditFileTool(root, { mutationCoordinator });
    const secondEdit = createLocalEditFileTool(root, { mutationCoordinator });

    const results = await Promise.allSettled([
      firstEdit.execute({ path: "note.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, context),
      secondEdit.execute({ path: "note.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, context),
    ]);

    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "fulfilled");
    assert.equal(await readFile(target, "utf8"), "ALPHA\nBETA\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutation coordination does not block independent file paths", async () => {
  const mutationCoordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  let releaseFirst!: () => void;
  let markFirstEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = mutationCoordinator.run("C:/workspace/first.txt", async () => {
    markFirstEntered();
    await firstGate;
    return "first";
  });
  await firstEntered;

  const second = mutationCoordinator.run("C:/workspace/second.txt", async () => "second");
  assert.equal(await second, "second");
  releaseFirst();
  assert.equal(await first, "first");
});

test("local grep returns complete executable continuations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-continuation-"));
  try {
    await mkdir(path.join(root, "src"));
    for (let index = 1; index <= 5; index += 1) {
      await writeFile(path.join(root, "src", `note-${index}.txt`), `needle ${index}\n`, "utf8");
    }
    const grepFiles = createLocalGrepFilesTool(root, { ripgrepSearch: false });

    const firstGrep = asDirectToolFacts(await grepFiles.execute({ path: "src", query: "needle", limit: 2 }, context));
    const firstGrepResult = firstGrep;
    assert.equal(firstGrep.truncated, true);
    assert.equal(firstGrepResult.hasMoreAfter, true);
    assert.equal(firstGrep.nextOffset, 2);
    const firstGrepNextInput = asRecord(asRecord(firstGrep.continuation).nextInput);
    assert.deepEqual(firstGrepNextInput, {
      query: "needle",
      path: "src",
      limit: 2,
      offset: 2,
    });
    assert.equal(firstGrepResult.matchesReturned, 2);

    const secondGrep = asDirectToolFacts(await grepFiles.execute(firstGrepNextInput, context));
    const secondGrepResult = secondGrep;
    assert.equal(secondGrepResult.offset, 2);
    assert.equal(secondGrepResult.matchesReturned, 2);
    assert.equal(secondGrep.nextOffset, 4);
    assert.deepEqual(asRecord(asRecord(secondGrep.continuation).nextInput), {
      query: "needle",
      path: "src",
      limit: 2,
      offset: 4,
    });

    const exactGrep = asDirectToolFacts(await grepFiles.execute({ path: "src", query: "needle", limit: 5 }, context));
    const exactGrepResult = exactGrep;
    assert.equal(exactGrep.truncated, false);
    assert.equal(exactGrepResult.hasMoreAfter, false);
    assert.equal(exactGrepResult.continuation, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read keeps output-budget continuations executable without text gaps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-read-budget-continuation-"));
  try {
    const content = "0123456789".repeat(900);
    await writeFile(path.join(root, "long.txt"), content, "utf8");
    const readFileTool = createLocalReadFileTool(root, {
      outputTokenCounter: { countText: (text) => text.length },
    });
    let input: Record<string, unknown> = { path: "long.txt", maxLength: content.length + 1 };
    let reconstructed = "";
    let pages = 0;

    for (;;) {
      const output = asDirectToolFacts(await readFileTool.execute(input, context));
      reconstructed += String(output.content).slice(0, Number(output.textChars));
      pages += 1;
      assert.equal(pages <= 20, true, "read continuation must make bounded forward progress");
      if (output.continuation === undefined) {
        assert.equal(output.truncated, false);
        break;
      }
      const nextInput = asRecord(asRecord(output.continuation).nextInput);
      assert.deepEqual(nextInput, {
        path: "long.txt",
        maxLength: content.length + 1,
        startChar: reconstructed.length,
      });
      assert.equal(output.truncated, true);
      input = nextInput;
    }

    assert.equal(pages > 1, true);
    assert.equal(reconstructed, content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read excludes a producer ellipsis from a second output-budget cursor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-read-double-truncation-"));
  try {
    const content = "A😀BCDEFGHI";
    await writeFile(path.join(root, "unicode.txt"), content, "utf8");
    const readFileTool = createLocalReadFileTool(root, {
      outputTokenCounter: {
        countText: (text) => text.includes('"textChars":4') ? 10_000 : text.length,
      },
    });
    let input: Record<string, unknown> = { path: "unicode.txt", maxLength: 5 };
    let reconstructed = "";
    let pages = 0;

    for (;;) {
      const output = asDirectToolFacts(await readFileTool.execute(input, context));
      const textChars = Number(output.textChars);
      reconstructed += String(output.content).slice(0, textChars);
      pages += 1;
      assert.equal(pages <= 10, true, "double truncation must keep making forward progress");
      if (output.continuation === undefined) {
        break;
      }
      const nextInput = asRecord(asRecord(output.continuation).nextInput);
      assert.equal(nextInput.startChar, reconstructed.length);
      input = nextInput;
    }

    assert.equal(pages > 1, true);
    assert.equal(reconstructed, content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local glob and grep keep output-budget continuation filters complete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-collection-budget-continuation-"));
  try {
    for (let index = 0; index < 90; index += 1) {
      await writeFile(
        path.join(root, `file-${String(index).padStart(3, "0")}-${"x".repeat(40)}.txt`),
        "needle\n",
        "utf8",
      );
    }
    const outputTokenCounter = { countText: (text: string) => text.length };
    const glob = createLocalGlobTool(root, { outputTokenCounter });
    const firstGlob = asDirectToolFacts(await glob.execute({ pattern: "*.txt", path: ".", limit: 90 }, context));
    const firstGlobNextInput = asRecord(asRecord(firstGlob.continuation).nextInput);

    assert.equal(Number(firstGlob.matchesReturned) < 90, true);
    assert.deepEqual(firstGlobNextInput, {
      pattern: "*.txt",
      path: ".",
      limit: 90,
      offset: firstGlob.matchesReturned,
    });
    const secondGlob = asDirectToolFacts(await glob.execute(firstGlobNextInput, context));
    assert.equal(secondGlob.offset, firstGlob.matchesReturned);

    const matches = Array.from({ length: 80 }, (_value, index) => ({
      path: `src/match-${index}.txt`,
      line: index + 1,
      preview: `needle ${"y".repeat(200)}`,
    }));
    const grepFiles = createLocalGrepFilesTool(root, {
      outputTokenCounter,
      ripgrepSearch: async (request) => matches.slice(0, request.limit),
    });
    const firstGrep = asDirectToolFacts(await grepFiles.execute({
      query: "Needle",
      path: ".",
      limit: 80,
    }, context));
    const firstGrepNextInput = asRecord(asRecord(firstGrep.continuation).nextInput);

    assert.equal(Number(firstGrep.matchesReturned) < 80, true);
    assert.deepEqual(firstGrepNextInput, {
      query: "Needle",
      path: ".",
      limit: 80,
      offset: firstGrep.matchesReturned,
    });
    const secondGrep = asDirectToolFacts(await grepFiles.execute(firstGrepNextInput, context));
    assert.equal(secondGrep.offset, firstGrep.matchesReturned);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep caps oversized offsets before collecting matches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-offset-cap-"));
  try {
    let observedCollectLimit = 0;
    const grepFiles = createLocalGrepFilesTool(root, {
      ripgrepSearch: async (request) => {
        observedCollectLimit = request.limit;
        return [];
      },
    });

    const grep = asDirectToolFacts(await grepFiles.execute({
      path: ".",
      query: "needle",
      limit: 80,
      offset: Number.MAX_SAFE_INTEGER,
    }, context));
    const result = grep;

    assert.equal(observedCollectLimit, 10_081);
    assert.equal(result.offset, 10_000);
    assert.equal(result.maxOffset, 10_000);
    assert.equal(result.offsetCeiling, 10_000);
    assert.equal(result.matchesReturned, 0);
    assert.equal(result.hasMoreAfter, false);
    assert.equal(result.reachedOffsetCeiling, false);
    assert.equal(result.continuation, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep fails honestly when matches exceed the supported offset ceiling", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-offset-boundary-"));
  try {
    const observedCollectLimits: number[] = [];
    const grepFiles = createLocalGrepFilesTool(root, {
      ripgrepSearch: async (request) => {
        observedCollectLimits.push(request.limit);
        return Array.from({ length: request.limit }, (_value, index) => ({
          path: `src/match-${index}.txt`,
          line: 1,
          preview: `needle ${index}`,
        }));
      },
    });

    const executed = asRecord(await grepFiles.execute({ path: ".", query: "needle", limit: 80, offset: 10_000 }, context));
    const result = asRecord(executed.result);
    const output = asRecord(result.output);
    const firstMatches = output.matchesPreview as readonly { readonly path: string }[];

    assert.equal(executed.kind, "tool_call_result");
    assert.equal(result.status, "failed");
    assert.equal(asRecord(result.errorFacts).code, "grep_offset_limit_reached");
    assert.equal(asRecord(result.errorFacts).retryable, false);
    assert.equal(output.truncated, undefined);
    assert.equal(output.continuation, undefined);
    assert.equal(output.searchComplete, false);
    assert.equal(output.offset, 10_000);
    assert.equal(output.matchesReturned, 80);
    assert.equal(output.hasMoreAfter, true);
    assert.equal(output.reachedOffsetCeiling, true);
    assert.equal(output.offsetCeiling, 10_000);
    assert.equal(firstMatches[0]?.path, "src/match-10000.txt");
    assert.deepEqual(observedCollectLimits, [10_081]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep does not emit a non-forward output-budget continuation at the offset ceiling", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-offset-budget-boundary-"));
  try {
    const grepFiles = createLocalGrepFilesTool(root, {
      outputTokenCounter: { countText: () => 10_000 },
      ripgrepSearch: async (request) => Array.from({ length: request.limit - 80 }, (_value, index) => ({
        path: `src/match-${index}.txt`,
        line: 1,
        preview: `needle ${index}`,
      })),
    });

    await assert.rejects(
      () => grepFiles.execute({ path: ".", query: "needle", limit: 80, offset: 10_000 }, context),
      /Grep metadata exceeds the fixed model result budget/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read returns a complete character continuation for maxLength windows", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-read-char-continuation-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "long.txt"), "abcdefghij", "utf8");
    const readFileTool = createLocalReadFileTool(root);

    const firstRead = asDirectToolFacts(await readFileTool.execute({ path: "src/long.txt", maxLength: 5 }, context));
    const firstResult = firstRead;
    assert.equal(firstRead.truncated, true);
    assert.equal(firstResult.content, "abcd…");
    assert.equal(firstResult.startChar, 0);
    assert.equal(firstResult.textChars, 4);
    assert.equal(firstResult.charCount, 10);
    assert.equal(firstRead.nextStartChar, 4);
    const firstNextInput = asRecord(asRecord(firstRead.continuation).nextInput);
    assert.deepEqual(firstNextInput, { path: "src/long.txt", maxLength: 5, startChar: 4 });

    const secondRead = asDirectToolFacts(await readFileTool.execute(firstNextInput, context));
    const secondResult = secondRead;
    assert.equal(secondResult.content, "efgh…");
    assert.equal(secondResult.startChar, 4);
    assert.equal(secondRead.nextStartChar, 8);
    assert.deepEqual(asRecord(asRecord(secondRead.continuation).nextInput), {
      path: "src/long.txt",
      maxLength: 5,
      startChar: 8,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read next character offset keeps emoji surrogate pairs intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-read-unicode-window-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "unicode.txt"), "A😀BC", "utf8");
    const readFileTool = createLocalReadFileTool(root);

    const first = asDirectToolFacts(await readFileTool.execute(
      { path: "src/unicode.txt", maxLength: 3 },
      context,
    ));
    const secondInput = asRecord(asRecord(first.continuation).nextInput);
    const second = asDirectToolFacts(await readFileTool.execute(secondInput, context));

    assert.equal(first.content, "A…");
    assert.equal(first.textChars, 1);
    assert.equal(second.content, "😀…");
    assert.equal(second.textChars, 2);
    await assert.rejects(
      () => readFileTool.execute({ path: "src/unicode.txt", maxLength: 3, startChar: 2 }, context),
      /must not split a UTF-16 surrogate pair/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read rejects a character window too small to advance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-read-char-minimum-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "long.txt"), "abcdefghij", "utf8");
    const readFileTool = createLocalReadFileTool(root);

    await assert.rejects(
      () => readFileTool.execute({ path: "src/long.txt", maxLength: 2 }, context),
      /read maxLength must be at least 3/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read rejects invalid explicit maxLength values instead of using the default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-read-invalid-window-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "long.txt"), "abcdefghij", "utf8");
    const readFileTool = createLocalReadFileTool(root);

    for (const maxLength of [0, -1, 1, 2, 1.5, "1"] as const) {
      await assert.rejects(
        () => readFileTool.execute({ path: "src/long.txt", maxLength }, context),
        /read maxLength must be at least 3 and a safe integer/,
      );
    }
    for (const startChar of [-1, 1.5, "1", 11] as const) {
      await assert.rejects(
        () => readFileTool.execute({ path: "src/long.txt", startChar }, context),
        /read startChar/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read rejects line ranges with maxLength to avoid skipped text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-read-line-maxlength-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "long-lines.txt"), "abcdefghij\nklmnopqrst\n", "utf8");
    const readFileTool = createLocalReadFileTool(root);

    await assert.rejects(
      () => readFileTool.execute({ path: "src/long-lines.txt", startLine: 1, endLine: 2, maxLength: 5 }, context),
      /cannot combine maxLength with startLine\/endLine/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep prefers ripgrep runner and records the search engine", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    let called = false;
    const grepFiles = createLocalGrepFilesTool(root, {
      ripgrepSearch: async (request) => {
        called = true;
        assert.equal(request.query, "Needle");
        assert.equal(request.limit, 2);
        return [{ path: "src/from-rg.txt", line: 7, preview: "Needle from rg" }];
      },
    });

    const grep = await grepFiles.execute({ path: ".", query: "Needle", limit: 1 }, context);
    const result = asDirectToolFacts(grep);
    const matches = result.matches as readonly { readonly path: string; readonly line: number; readonly preview: string }[];

    assert.equal(called, true);
    assert.equal(result.engine, "rg");
    assert.deepEqual(matches, [{ path: "src/from-rg.txt", line: 7, preview: "Needle from rg" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep falls back to JS recursion when ripgrep is unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha\nneedle beta\n", "utf8");
    const grepFiles = createLocalGrepFilesTool(root, {
      ripgrepSearch: async () => undefined,
    });

    const grep = await grepFiles.execute({ path: "src", query: "needle" }, context);
    const result = asDirectToolFacts(grep);
    const matches = result.matches as readonly { readonly path: string; readonly line: number }[];

    assert.equal(result.engine, "js");
    assert.deepEqual(matches, [{ path: "src/note.txt", line: 2, preview: "needle beta" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local grep JS fallback skips Git internals like the ripgrep path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-grep-git-"));
  try {
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, ".git", "config"), "needle internal\n", "utf8");
    await writeFile(path.join(root, "src", "note.txt"), "needle source\n", "utf8");
    const grep = createLocalGrepFilesTool(root, { ripgrepSearch: false });

    const result = asDirectToolFacts(await grep.execute({ query: "needle", path: "." }, context));

    assert.deepEqual(result.matches, [
      { path: "src/note.txt", line: 1, preview: "needle source" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read rejects paths outside workspace", async () => {
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

test("local read preserves line endings so returned ranges can be edited exactly", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-line-endings-"));
  try {
    const file = path.join(root, "windows.txt");
    await writeFile(file, "alpha\r\nbeta\r\ngamma\r\n", "utf8");
    const readFileTool = createLocalReadFileTool(root);
    const editFileTool = createLocalEditFileTool(root);

    const readResult = asDirectToolFacts(await readFileTool.execute({
      path: "windows.txt",
      startLine: 1,
      endLine: 2,
    }, context));

    assert.equal(readResult.content, "alpha\r\nbeta");
    await editFileTool.execute({
      path: "windows.txt",
      edits: [{ oldText: readResult.content, newText: "ALPHA\r\nBETA" }],
    }, context);
    assert.equal(await readFile(file, "utf8"), "ALPHA\r\nBETA\r\ngamma\r\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read preserves line endings while streaming a large line range", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-large-line-range-"));
  try {
    const file = path.join(root, "large.txt");
    const lines = Array.from({ length: 32_000 }, (_, index) => `line-${String(index + 1).padStart(5, "0")}-padding`);
    await writeFile(file, `${lines.join("\r\n")}\r\n`, "utf8");
    assert.equal((await stat(file)).size > 512_000, true);
    const readFileTool = createLocalReadFileTool(root);

    const result = asDirectToolFacts(await readFileTool.execute({
      path: "large.txt",
      startLine: 2,
      endLine: 3,
    }, context));

    assert.equal(result.content, `${lines[1]}\r\n${lines[2]}`);
    assert.equal(result.hasMoreAfter, true);
    assert.equal(result.nextStartLine, 4);
    assert.deepEqual(asRecord(asRecord(result.continuation).nextInput), {
      path: "large.txt",
      startLine: 4,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local read reports invalid UTF-8 instead of returning replacement text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-invalid-utf8-"));
  try {
    const file = path.join(root, "invalid.txt");
    await writeFile(file, Buffer.from([0x61, 0xC3, 0x28, 0x62]));
    const readFileTool = createLocalReadFileTool(root);

    const result = asDirectToolFacts(await readFileTool.execute({ path: "invalid.txt" }, context));

    assert.equal(result.binary, true);
    assert.equal(result.reason, "invalid_utf8");
    assert.equal(result.content, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local Write creates or rewrites and Edit stays inside the local strategy sandbox", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const writeFileTool = createLocalWriteFileTool(root);
    const editFile = createLocalEditFileTool(root);

    const created = await writeFileTool.execute({ path: "notes/result.md", content: "# Title\n\nbody\n" }, context);
    const edited = await editFile.execute({
      path: "notes/result.md",
      edits: [{ oldText: "body", newText: "updated body" }],
    }, context);
    const createdFacts = asDirectToolFacts(created);
    const editedFacts = asDirectToolFacts(edited);

    assert.equal(createdFacts.refId, "workspace:file:notes/result.md");
    assert.equal(typeof editedFacts.beforeHash, "string");
    assert.equal(typeof editedFacts.afterHash, "string");
    assert.equal(asRecord(editedFacts.diff).status, "available");
    assert.equal(await readFile(path.join(root, "notes", "result.md"), "utf8"), "# Title\n\nupdated body\n");

    await assert.rejects(
      () => writeFileTool.execute({ path: "../outside.md", content: "nope" }, context),
      /outside the workspace boundary/
    );
    await mkdir(path.join(root, ".trellis"));
    const trellisCreated = await writeFileTool.execute({ path: ".trellis/local.md", content: "allowed body" }, context);
    assert.equal(asDirectToolFacts(trellisCreated).path, ".trellis/local.md");
    const overwritten = await writeFileTool.execute({ path: "notes/result.md", content: "overwritten" }, context);
    assert.equal(asDirectToolFacts(overwritten).operation, "write");
    assert.equal(await readFile(path.join(root, "notes", "result.md"), "utf8"), "overwritten");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit validates every exact replacement before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "alpha\nbeta\ngamma\n", "utf8");
    const editFile = createLocalEditFileTool(root);

    await editFile.execute({
      path: "notes.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "gamma", newText: "GAMMA" },
      ],
    }, context);
    assert.equal(await readFile(file, "utf8"), "ALPHA\nbeta\nGAMMA\n");

    await writeFile(file, "same\nsame\n", "utf8");
    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "once" }] }, context),
      /must match exactly once.*matches=2/
    );
    assert.equal(await readFile(file, "utf8"), "same\nsame\n");

    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "missing", newText: "value" }] }, context),
      /must match exactly once.*matches=0/
    );
    assert.equal(await readFile(file, "utf8"), "same\nsame\n");

    await writeFile(file, "same\nsame\n", "utf8");
    await assert.rejects(
      () => editFile.execute({
        path: "notes.txt",
        edits: [
          { oldText: "same\nsame", newText: "both" },
          { oldText: "same", newText: "one" },
        ],
      }, context),
      /must match exactly once.*matches=2|overlap/
    );
    assert.equal(await readFile(file, "utf8"), "same\nsame\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit rejects binary targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-binary-edit-"));
  try {
    const file = path.join(root, "image.bin");
    const original = Buffer.from([0x61, 0x6c, 0x70, 0x68, 0x61, 0x00, 0x62, 0x65, 0x74, 0x61]);
    await writeFile(file, original);
    const editFile = createLocalEditFileTool(root);

    await assert.rejects(
      () => editFile.execute({
        path: "image.bin",
        edits: [{ oldText: "alpha", newText: "ALPHA" }],
      }, context),
      /File is binary or non-text: image\.bin; bytes=10/
    );
    assert.deepEqual(await readFile(file), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local edit preserves an existing UTF-8 byte order mark", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-bom-edit-"));
  try {
    const file = path.join(root, "bom.txt");
    await writeFile(file, Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from("alpha\nbeta\n", "utf8"),
    ]));
    const editFileTool = createLocalEditFileTool(root);

    await editFileTool.execute({
      path: "bom.txt",
      edits: [{ oldText: "beta", newText: "BETA" }],
    }, context);

    const updated = await readFile(file);
    assert.deepEqual([...updated.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    assert.equal(updated.subarray(3).toString("utf8"), "alpha\nBETA\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local write tools do not require confirmation", async () => {
  const writeFileTool = createLocalWriteFileTool();
  const editFileTool = createLocalEditFileTool();

  assert.equal(writeFileTool.definition.metadata?.requiresConfirmation, false);
  assert.equal(editFileTool.definition.metadata?.requiresConfirmation, false);
});

test("local shell uses the workspace shell and confirmation metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "note.txt"), "alpha", "utf8");
    const shellCommand = createLocalShellCommandTool(root);
    const syntax = shellSyntaxFromTool(shellCommand);

    assert.equal(shellCommand.definition.metadata?.requiresConfirmation, true);
    assert.deepEqual(shellCommand.definition.inputSchema.required, ["command"]);
    assert.equal(shellCommand.definition.inputSchema.anyOf, undefined);
    assert.equal("commandLine" in shellCommand.definition.inputSchema.properties, false);
    assert.equal("args" in shellCommand.definition.inputSchema.properties, false);
    assert.equal("background" in shellCommand.definition.inputSchema.properties, true);
    assert.equal("cwd" in shellCommand.definition.inputSchema.properties, true);
    assert.equal("backgroundWaitMs" in shellCommand.definition.inputSchema.properties, false);
    assert.equal("waitForPort" in shellCommand.definition.inputSchema.properties, false);
    assert.equal("lifetime" in shellCommand.definition.inputSchema.properties, false);
    assert.equal(shellCommand.definition.metadata?.runtimeHints?.[0]?.kind, "command_shell");
    assert.equal(shellCommand.definition.metadata?.runtimeHints?.[0]?.commandLineParameter, "command");

    const echoed = await shellCommand.execute({ commandLine: shellEchoCommand("hello workspace", syntax) }, context);
    const shellStyleEchoed = await shellCommand.execute({ commandLine: shellEchoCommand("approval-review", syntax) }, context);
    const quotedEchoed = await shellCommand.execute({ commandLine: shellEchoCommand("hello quoted shell", syntax) }, context);
    const shellEchoed = await shellCommand.execute({ commandLine: shellEchoCommand("hello shell", syntax) }, context);
    const chained = await shellCommand.execute({ commandLine: shellChainedEchoCommand(syntax) }, context);
    const piped = await shellCommand.execute({ commandLine: shellPipeCommand(syntax) }, context);
    const listed = await shellCommand.execute({ commandLine: shellListCommand("src", syntax) }, context);
    const listedWithCwd = await shellCommand.execute({ commandLine: shellListCommand(".", syntax), cwd: "src" }, context);
    const typed = await shellCommand.execute({ commandLine: shellReadCommand(path.join("src", "note.txt"), syntax) }, context);
    const inlineScript = await shellCommand.execute({ commandLine: nodeInlineScriptCommand(syntax) }, context);
    const directArgs = await shellCommand.execute({ command: process.execPath, args: ["-e", "console.log('hello direct args')"] }, context);
    const madeDirectory = await shellCommand.execute({ commandLine: shellMakeDirectoryCommand("generated/nested", syntax) }, context);
    const echoedFacts = asDirectToolFacts(echoed);
    const shellStyleFacts = asDirectToolFacts(shellStyleEchoed);
    const quotedFacts = asDirectToolFacts(quotedEchoed);
    const shellFacts = asDirectToolFacts(shellEchoed);
    const chainedFacts = asDirectToolFacts(chained);
    const pipedFacts = asDirectToolFacts(piped);
    const listedFacts = asDirectToolFacts(listed);
    const listedWithCwdFacts = asDirectToolFacts(listedWithCwd);
    const typedFacts = asDirectToolFacts(typed);
    const inlineScriptFacts = asDirectToolFacts(inlineScript);
    const directArgsFacts = asDirectToolFacts(directArgs);
    const madeDirectoryFacts = asDirectToolFacts(madeDirectory);

    assert.match(String(shellFacts.refId), /^workspace:shell:/);
    assert.equal(shellFacts.commandLine, shellEchoCommand("hello shell", syntax));
    assert.equal(typeof shellFacts.shell, "object");
    assert.match(String(echoedFacts.stdout), /hello workspace/);
    assert.match(String(shellStyleFacts.stdout), /approval-review/);
    assert.match(String(quotedFacts.stdout), /hello quoted shell/);
    assert.match(String(chainedFacts.stdout), /safe/);
    assert.match(String(chainedFacts.stdout), /unsafe/);
    assert.match(String(pipedFacts.stdout), /needle/);
    assert.match(String(listedFacts.stdout), /note\.txt/);
    assert.equal(listedWithCwdFacts.cwd, "src");
    assert.match(String(listedWithCwdFacts.stdout), /note\.txt/);
    assert.match(String(typedFacts.stdout), /alpha/);
    assert.match(String(inlineScriptFacts.stdout), /hello_inline_script/);
    assert.match(String(directArgsFacts.stdout), /hello direct args/);
    assert.equal(madeDirectoryFacts.exitCode, 0);
    assert.equal((await stat(path.join(root, "generated", "nested"))).isDirectory(), true);

    const quotedPython = await shellCommand.execute({
      commandLine: `${process.execPath} -e "console.log('fragile quoted shell')"` ,
      command: process.execPath,
      args: ["-e", "console.log('fragile quoted shell')"],
    }, context);
    assert.match(String(asDirectToolFacts(quotedPython).stdout), /fragile quoted shell/);

    await assert.rejects(
      () => shellCommand.execute({ commandLine: shellEchoCommand("nope", syntax), cwd: "../outside" }, context),
      /outside the workspace boundary/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local shell bounds foreground process lifetime and output volume", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);

    const timedOut = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('before-timeout'); setTimeout(() => {}, 5000);"],
      timeoutMs: 200,
    }, context);
    const timeoutResult = asDirectToolFacts(timedOut);
    assert.equal(timeoutResult.exitCode, 124);
    assert.equal(timeoutResult.timedOut, true);
    assert.match(String(timeoutResult.stdout), /before-timeout/);
    assert.match(String(timeoutResult.stderr), /timed out after 200ms/);

    const largeOutput = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(140000)); process.stderr.write('y'.repeat(70000));"],
    }, context);
    const largeResult = asDirectToolFacts(largeOutput);
    assert.equal(asRecord(largeOutput).truncated, true);
    assert.equal(String(largeResult.stdout).length, 12_000);
    assert.equal(String(largeResult.stderr).length, 4_000);
    assert.equal(largeResult.stdoutTruncated, true);
    assert.equal(largeResult.stderrTruncated, true);
    assert.equal(largeResult.stdoutChars, 140_000);
    assert.equal(largeResult.stderrChars, 70_000);
    assert.equal(largeResult.stdoutOmittedChars, 128_000);
    assert.equal(largeResult.stderrOmittedChars, 66_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local shell can start long-running commands in the background with a log path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const started = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('background-ready'); setTimeout(() => {}, 5000);"],
      background: true,
    }, context);
    const result = asDirectToolFacts(started);
    const logPath = String(result.logPath);

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(typeof result.pid, "number");
    assert.match(String(result.stopCommand), process.platform === "win32" ? /taskkill/ : /kill -TERM/);
    assert.match(String(result.stdout), /Started background process/);
    assert.match(String(result.stdout), /Log:/);
    await waitUntil(async () => {
      try {
        return (await readFile(logPath, "utf8")).includes("background-ready");
      } catch {
        return false;
      }
    });
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 1_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell waits for a background server port", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const port = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root);
    const script = [
      "const http=require('node:http');",
      "const server=http.createServer((req,res)=>res.end('ok'));",
      `server.listen(${port}, '127.0.0.1', () => console.log('server-ready:${port}'));`,
      "setInterval(() => {}, 1000);",
    ].join("");
    const started = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", script],
      background: true,
      backgroundWaitMs: 500,
      waitForPort: port,
      waitForPortTimeoutMs: 3_000,
    }, context);
    const result = asDirectToolFacts(started);

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, true);
    assert.equal(typeof result.durationMs, "number");
    assert.match(String(result.stdout), new RegExp(`Port ${port} is ready\\.`));
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 1_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
    await waitUntil(async () => !(await canConnectToLocalPort(port)), 5_000);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell reports when a requested background port is not ready", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const port = await unusedLocalPort();
    const shellCommand = createLocalShellCommandTool(root);
    const started = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log('background-without-port'); setTimeout(() => {}, 5000);"],
      background: true,
      backgroundWaitMs: 500,
      waitForPort: port,
      waitForPortTimeoutMs: 300,
    }, context);
    const result = asDirectToolFacts(started);

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(result.waitForPort, port);
    assert.equal(result.portReady, false);
    assert.equal(typeof result.durationMs, "number");
    assert.match(String(result.stderr), new RegExp(`Port ${port} did not become ready within 300ms\\.`));
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 1_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell captures shell-native background command output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const syntax = shellSyntaxFromTool(shellCommand);
    const started = await shellCommand.execute({
      commandLine: shellBackgroundLogCommand(syntax),
      background: true,
      backgroundWaitMs: 1_000,
    }, context);
    const result = asDirectToolFacts(started);
    const logPath = String(result.logPath);

    assert.equal(result.exitCode, null);
    assert.equal(result.background, true);
    assert.equal(typeof result.pid, "number");
    assert.match(String(result.stdout), /Started background process/);
    await waitUntil(async () => {
      try {
        return (await readFile(logPath, "utf8")).includes("SHELL_BG_READY");
      } catch {
        return false;
      }
    });
    await shellCommand.execute({ commandLine: String(result.stopCommand), timeoutMs: 1_000 }, context);
    await ensurePidExited(typeof result.pid === "number" ? result.pid : undefined, 5_000);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell reports background commands that exit immediately", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const exited = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "console.error('background failed fast'); process.exit(7);"],
      background: true,
    }, context);
    const result = asDirectToolFacts(exited);

    assert.equal(result.exitCode, 7);
    assert.equal(result.background, true);
    assert.equal(result.processState, "exited");
    assert.equal(typeof result.logPath, "string");
    assert.match(String(result.stdout), /background failed fast/);
    assert.match(String(result.stderr), /exited before it stayed running/);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell reports background commands that fail during the startup observation window", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const shellCommand = createLocalShellCommandTool(root);
    const exited = await shellCommand.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => { console.error('background delayed fail'); process.exit(9); }, 250);"],
      background: true,
      backgroundWaitMs: 750,
    }, context);
    const result = asDirectToolFacts(exited);

    assert.equal(result.exitCode, 9);
    assert.equal(result.background, true);
    assert.equal(result.processState, "exited");
    assert.equal(typeof result.logPath, "string");
    assert.match(String(result.stdout), /background delayed fail/);
    assert.match(String(result.stderr), /exited before it stayed running/);
  } finally {
    await removeTempTree(root);
  }
});

test("local shell falls back to shell execution for Windows cmd shims while preserving direct argv for executables", async () => {
  if (process.platform !== "win32") {
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  const fakeBin = path.join(root, "bin");
  const originalPath = process.env.PATH;
  try {
    await mkdir(fakeBin);
    await writeFile(
      path.join(fakeBin, "fakecmd.cmd"),
      "@echo off\r\nset \"arg1=%~1\"\r\nset \"arg2=%~2\"\r\necho fakecmd:%arg1%:%arg2%\r\n",
      "utf8"
    );
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ""}`;
    const shellCommand = createLocalShellCommandTool(root, {
      commandShell: {
        ...createDefaultCommandShellConfig("win32", {}),
        kind: "cmd",
        label: "Windows Command Prompt",
        executable: process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
        syntax: "cmd",
        platform: "win32",
        invocation: [process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe", "/d", "/s", "/c", "<commandLine>"],
        commandLineParameter: "commandLine",
        notes: ["Test cmd shell."],
        updatedAt: "test",
      },
    });

    const shim = await shellCommand.execute({
      commandLine: "fakecmd hello world",
      command: "fakecmd",
      args: ["hello", "world"],
    }, context);
    const shimArgvOnly = await shellCommand.execute({
      command: "fakecmd",
      args: ["hello space", "A&B"],
    }, context);
    const direct = await shellCommand.execute({
      commandLine: `${process.execPath} -e "console.log('direct argv')"` ,
      command: process.execPath,
      args: ["-e", "console.log('direct argv')"],
    }, context);

    assert.match(String(asDirectToolFacts(shim).stdout), /fakecmd:hello:world/i);
    assert.match(String(asDirectToolFacts(shimArgvOnly).stdout), /fakecmd:hello space:A&B/i);
    assert.match(String(asDirectToolFacts(direct).stdout), /direct argv/);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("local strategy sandbox can disable writes and command execution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tools-"));
  try {
    const sandboxPolicy = createLocalWorkspaceSandboxPolicy({ allowWrite: false, allowExecute: false });
    const writeFileTool = createLocalWriteFileTool(root, { sandboxPolicy });
    const shellCommand = createLocalShellCommandTool(root, { sandboxPolicy });

    await assert.rejects(
      () => writeFileTool.execute({ path: "note.txt", content: "nope" }, context),
      /does not allow local file writes/
    );
    await assert.rejects(
      () => shellCommand.execute({ commandLine: "echo nope" }, context),
      /does not allow local command execution/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function shellSyntaxFromTool(tool: ReturnType<typeof createLocalShellCommandTool>): "cmd" | "powershell" | "posix" {
  const hint = tool.definition.metadata?.runtimeHints?.[0];
  assert.equal(hint?.kind, "command_shell");
  return hint.syntax;
}

function shellEchoCommand(text: string, syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "powershell") return `Write-Output ${quoteShellPath(text, syntax)}`;
  return `echo ${quoteShellPath(text, syntax)}`;
}

function shellChainedEchoCommand(syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "powershell") return "Write-Output safe; Write-Output unsafe";
  return "echo safe && echo unsafe";
}

function shellPipeCommand(syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") return "echo needle | findstr needle";
  if (syntax === "powershell") return "Write-Output needle | Select-String needle";
  return "printf 'needle\\n' | grep needle";
}

function shellListCommand(directory: string, syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") return `dir /b ${directory}`;
  if (syntax === "powershell") return `Get-ChildItem -Name ${quoteShellPath(directory, syntax)}`;
  return `ls ${quoteShellPath(directory, syntax)}`;
}

function shellReadCommand(file: string, syntax: "cmd" | "powershell" | "posix"): string {
  const normalized = syntax === "cmd" || syntax === "powershell"
    ? file.split(path.sep).join("\\")
    : file.split(path.sep).join("/");
  if (syntax === "cmd") return `type ${normalized}`;
  if (syntax === "powershell") return `Get-Content ${quoteShellPath(normalized, syntax)}`;
  return `cat ${quoteShellPath(normalized, syntax)}`;
}

function shellMakeDirectoryCommand(directory: string, syntax: "cmd" | "powershell" | "posix"): string {
  const normalized = syntax === "cmd" || syntax === "powershell" ? directory.split("/").join("\\") : directory;
  if (syntax === "cmd" || syntax === "powershell") return `mkdir ${quoteShellPath(normalized, syntax)}`;
  return `mkdir -p ${quoteShellPath(normalized, syntax)}`;
}

function shellBackgroundLogCommand(syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") return "echo SHELL_BG_READY && ping -n 6 127.0.0.1 >nul";
  if (syntax === "powershell") return "Write-Output SHELL_BG_READY; Start-Sleep -Seconds 5";
  return "printf 'SHELL_BG_READY\\n'; sleep 5";
}

function quoteShellPath(value: string, syntax: "cmd" | "powershell" | "posix"): string {
  if (/^[A-Za-z0-9_./:\\-]+$/u.test(value) && value.length > 0) {
    return value;
  }
  if (syntax === "cmd") {
    return `"${value.replace(/"/g, '\\"').replace(/[&|<>()]/g, (character) => `^${character}`)}"`;
  }
  if (syntax === "powershell") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function nodeInlineScriptCommand(syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") {
    return "node -e console.log('hello_inline_script')";
  }
  return `node -e ${quoteShellPath('console.log("hello_inline_script")', syntax)}`;
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(25);
  }
}

async function removeTempTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function unusedLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (port === undefined) {
          reject(new Error("Could not allocate local port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function canConnectToLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

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
