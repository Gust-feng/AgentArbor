import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopBasicToolRegistryForTest as createDesktopBasicToolRegistry } from "../../testing/desktop-basic-tool-registry.js";
import { projectToolDisplay } from "../../tool-projection/tool-display-projection.js";
import { ToolCenter } from "../tool-center.js";
import { createHttpRequestTool, type HttpRequestFetchLike } from "./http-request-tool.js";
import { createLocalShellCommandTool } from "./local-workspace-command-tools.js";
import { createLocalGrepFilesTool, createLocalListDirTool, createLocalReadFileTool } from "./local-workspace-read-tools.js";
import { createLocalEditFileTool } from "./local-workspace-write-tools.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
const suggestionPattern = /\btry\b|\bprovide\b|\bsuggest|\brecommend\b|recoveryHint|\u5efa\u8bae/iu;

test("shell_command returns small stdout and stderr exactly without truncation facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-shell-small-"));
  try {
    const shell = createLocalShellCommandTool(root);
    const output = asDirectToolFacts(await shell.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('stdout-small'); process.stderr.write('stderr-small');"],
    }, context));

    assert.equal(output.truncated, false);
    assert.equal(output.stdout, "stdout-small");
    assert.equal(output.stderr, "stderr-small");
    assert.equal(output.stdoutTruncated, false);
    assert.equal(output.stderrTruncated, false);
    assert.equal(output.stdoutChars, "stdout-small".length);
    assert.equal(output.stderrChars, "stderr-small".length);
    assert.equal(output.stdoutOmittedChars, 0);
    assert.equal(output.stderrOmittedChars, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell_command reports factual truncation and omitted counts only after output caps are exceeded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-shell-large-"));
  try {
    const stdoutChars = 70_000;
    const stderrChars = 35_000;
    const shell = createLocalShellCommandTool(root);
    const output = asDirectToolFacts(await shell.execute({
      command: process.execPath,
      args: ["-e", `process.stdout.write('x'.repeat(${stdoutChars})); process.stderr.write('e'.repeat(${stderrChars}));`],
    }, context));

    assert.equal(output.truncated, true);
    assert.equal(output.stdoutTruncated, true);
    assert.equal(output.stderrTruncated, true);
    assert.equal(String(output.stdout).length, 16_000);
    assert.equal(String(output.stderr).length, 8_000);
    assert.equal(output.stdoutChars, stdoutChars);
    assert.equal(output.stderrChars, stderrChars);
    assert.equal(output.stdoutOmittedChars, stdoutChars - 16_000);
    assert.equal(output.stderrOmittedChars, stderrChars - 8_000);
    assert.doesNotMatch(JSON.stringify(output), suggestionPattern);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ToolCenter preserves command logRef in model-visible command facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-shell-log-ref-"));
  try {
    const registry = createDesktopBasicToolRegistry({
      env: {},
      workspaceRoot: root,
      playwrightAvailable: false,
      toolCatalogNames: ["shell_command"],
    });
    const center = registry.createToolCenter("desktop-basic");
    const result = await center.execute(
      {
        callId: "call-shell-log-ref",
        toolName: "shell_command",
        input: {
          command: process.execPath,
          args: ["-e", "process.stdout.write('z'.repeat(20000));"],
        },
      },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: ["shell_command"],
        approvedConfirmationIds: ["confirmation-call-shell-log-ref"],
      }
    );

    const output = asDirectToolFacts(result.output);
    const continuation = asRecord(output.continuation);

    assert.equal(result.status, "completed");
    assert.equal(output.truncated, true);
    assert.equal(output.stdoutTruncated, true);
    assert.match(String(output.logRef), /^command-log:\/\/[^\\/]+$/);
    assert.equal(typeof output.logPath, "string");
    assert.equal(continuation.ref, output.logRef);
    assert.equal(asRecord(continuation.nextInput).ref, output.logRef);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ToolCenter read can consume shell_command command-log refs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-shell-log-read-"));
  try {
    const registry = createDesktopBasicToolRegistry({
      env: {},
      workspaceRoot: root,
      playwrightAvailable: false,
      toolCatalogNames: ["shell_command", "read"],
    });
    const center = registry.createToolCenter("desktop-basic");
    const shellResult = await center.execute(
      {
        callId: "call-shell-log-readable",
        toolName: "shell_command",
        input: {
          command: process.execPath,
          args: ["-e", "process.stdout.write('readable-log-start\\n' + 'q'.repeat(20000) + '\\nreadable-log-end');"],
        },
      },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: ["shell_command", "read"],
        approvedConfirmationIds: ["confirmation-call-shell-log-readable"],
      }
    );
    const shellFacts = asDirectToolFacts(shellResult.output);
    const logRef = String(shellFacts.logRef);

    const readResult = await center.execute(
      { callId: "call-read-command-log", toolName: "read", input: { ref: logRef, maxLength: 30_000 } },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: ["shell_command", "read"],
      }
    );
    const readContent = asDirectToolFacts(readResult.output);

    assert.equal(shellResult.status, "completed");
    assert.match(logRef, /^command-log:\/\/[^\\/]+$/);
    assert.equal(readResult.status, "completed");
    assert.equal(readContent.researchStatus, "completed");
    assert.equal(readContent.source, "command_log");
    assert.equal(readContent.uri, logRef);
    assert.match(String(readContent.contentPreview), /readable-log-start/);
    assert.match(String(readContent.contentPreview), /readable-log-end/);
    assert.equal(JSON.stringify(readContent.metadata).includes(String(shellFacts.logPath)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ToolCenter UI summaries do not replace model-visible command facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-projection-"));
  try {
    const registry = createDesktopBasicToolRegistry({
      env: {},
      workspaceRoot: root,
      playwrightAvailable: false,
      toolCatalogNames: ["shell_command"],
    });
    const center = registry.createToolCenter("desktop-basic");
    const stdout = `start-${"x".repeat(4_000)}-end`;
    const result = await center.execute(
      {
        callId: "call-shell-projection",
        toolName: "shell_command",
        input: {
          command: process.execPath,
          args: ["-e", `process.stdout.write(${JSON.stringify(stdout)});`],
        },
      },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: ["shell_command"],
        approvedConfirmationIds: ["confirmation-call-shell-projection"],
      }
    );

    const output = asDirectToolFacts(result.output);
    const display = projectToolDisplay(
      { callId: result.callId, toolName: result.toolName, input: result.input },
      result.output,
    );

    assert.equal(result.status, "completed");
    assert.equal(output.stdout, stdout);
    assert.equal(output.stdoutTruncated, false);
    assert.equal(output.truncated, false);
    assert.equal(display.kind, "command_summary");
    assert.equal(String(display.outputSummary).length < stdout.length, true);
    assert.equal(JSON.stringify(result.output).includes("start-"), true);
    assert.equal(JSON.stringify(result.output).includes("-end"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("edit_file dryRun and failures return edit facts without recovery suggestions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-edit-"));
  try {
    await writeFile(path.join(root, "notes.txt"), "same\nsame\n", "utf8");
    const editFile = createLocalEditFileTool(root);

    const dryRun = asDirectToolFacts(await editFile.execute({
      path: "notes.txt",
      dryRun: true,
      edits: [{ oldText: "same\n", newText: "once\n", occurrence: 1 }],
    }, context));
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.wouldReplace, 1);
    assert.equal(dryRun.replacements, 0);
    assert.equal(typeof dryRun.beforeHash, "string");
    assert.equal(typeof dryRun.afterHash, "string");
    assert.doesNotMatch(JSON.stringify(dryRun), suggestionPattern);

    await assert.rejects(
      () => editFile.execute({ path: "notes.txt", edits: [{ oldText: "same", newText: "once" }] }, context),
      (error: unknown) => {
        const message = errorMessage(error);
        assert.match(message, /matched 2 locations/);
        assert.match(message, /editIndex=1/);
        assert.match(message, /availableMatches=2/);
        assert.doesNotMatch(message, suggestionPattern);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grep_files exposes skipped facts only when the search engine can observe them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-grep-"));
  try {
    await writeFile(path.join(root, "match.txt"), "needle\n", "utf8");

    const jsGrep = createLocalGrepFilesTool(root, { ripgrepSearch: false });
    const jsResult = asDirectToolFacts(await jsGrep.execute({ path: ".", query: "needle" }, context));
    assert.equal(jsResult.engine, "js");
    assert.equal(jsResult.skippedFactsAvailable, true);
    assert.equal(typeof jsResult.searchedFiles, "number");
    assert.equal(typeof jsResult.skippedFiles, "number");

    const rgGrep = createLocalGrepFilesTool(root, {
      ripgrepSearch: async () => [{ path: "match.txt", line: 1, preview: "needle" }],
    });
    const rgResult = asDirectToolFacts(await rgGrep.execute({ path: ".", query: "needle" }, context));
    assert.equal(rgResult.engine, "rg");
    assert.equal(rgResult.skippedFactsAvailable, false);
    assert.equal(rgResult.skippedFiles, undefined);
    assert.equal(rgResult.skippedUnreadableFiles, undefined);
    assert.equal(rgResult.skippedSamples, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ToolCenter exposes executable continuation inputs for truncated local list and grep results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-facts-continuation-"));
  try {
    for (let index = 1; index <= 5; index += 1) {
      await writeFile(path.join(root, `note-${index}.txt`), `needle ${index}\n`, "utf8");
    }
    const center = new ToolCenter();
    center.register(createLocalReadFileTool(root));
    center.register(createLocalListDirTool(root));
    center.register(createLocalGrepFilesTool(root, { ripgrepSearch: false }));

    const read = await center.execute(
      { callId: "call-read-continuation", toolName: "read_file", input: { path: "note-1.txt", startLine: 1, endLine: 1 } },
      context,
      { callerAgentId: context.callerAgentId, allowedTools: ["read_file", "list_dir", "grep_files"] }
    );
    const readOutput = asDirectToolFacts(read.output);
    const readNextInput = asRecord(asRecord(readOutput.continuation).nextInput);

    assert.equal(read.status, "completed");
    assert.equal(readOutput.truncated, true);
    assert.equal(readNextInput.path, "note-1.txt");
    assert.equal(readNextInput.startLine, 2);

    await writeFile(path.join(root, "long.txt"), "abcdefghij", "utf8");
    const charRead = await center.execute(
      { callId: "call-read-char-continuation", toolName: "read_file", input: { path: "long.txt", maxLength: 5 } },
      context,
      { callerAgentId: context.callerAgentId, allowedTools: ["read_file", "list_dir", "grep_files"] }
    );
    const charReadOutput = asDirectToolFacts(charRead.output);
    const charReadNextInput = asRecord(asRecord(charReadOutput.continuation).nextInput);

    assert.equal(charRead.status, "completed");
    assert.equal(charReadOutput.truncated, true);
    assert.equal(charReadNextInput.path, "long.txt");
    assert.equal(charReadNextInput.maxLength, 5);
    assert.equal(charReadNextInput.startChar, 4);
    assert.equal("startLine" in charReadNextInput, false);

    const listed = await center.execute(
      { callId: "call-list-continuation", toolName: "list_dir", input: { path: ".", limit: 2 } },
      context,
      { callerAgentId: context.callerAgentId, allowedTools: ["read_file", "list_dir", "grep_files"] }
    );
    const listOutput = asDirectToolFacts(listed.output);
    const listContinuation = asRecord(listOutput.continuation);
    const listNextInput = asRecord(listContinuation.nextInput);

    assert.equal(listed.status, "completed");
    assert.equal(listOutput.truncated, true);
    assert.equal(listNextInput.path, ".");
    assert.equal(listNextInput.limit, 2);
    assert.equal(listNextInput.offset, 2);

    const grep = await center.execute(
      { callId: "call-grep-continuation", toolName: "grep_files", input: { path: ".", query: "needle", limit: 2 } },
      context,
      { callerAgentId: context.callerAgentId, allowedTools: ["read_file", "list_dir", "grep_files"] }
    );
    const grepOutput = asDirectToolFacts(grep.output);
    const grepContinuation = asRecord(grepOutput.continuation);
    const grepNextInput = asRecord(grepContinuation.nextInput);

    assert.equal(grep.status, "completed");
    assert.equal(grepOutput.truncated, true);
    assert.equal(grepNextInput.query, "needle");
    assert.equal(grepNextInput.path, ".");
    assert.equal(grepNextInput.limit, 2);
    assert.equal(grepNextInput.offset, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop-basic model-visible tool contract does not expose empty run_memory capability", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: false });
  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.equal(center.has("run_memory"), false);
  assert.equal(center.list().some((tool) => tool.name === "run_memory"), false);
  assert.equal(catalog.allowedTools.includes("run_memory"), false);
  assert.equal(catalog.tools.some((tool) => tool.name === "run_memory"), false);
});

test("http_request network errors expose OS facts without recoveryHint", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:43210"), {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 43210,
  });
  const tool = createHttpRequestTool({ fetch: rejectingFetch(fetchFailureWithCause(cause)) });

  await assert.rejects(
    () => tool.execute({ url: "http://127.0.0.1:43210/status" }, context),
    (error: unknown) => {
      const record = asRecord(error);
      const facts = asRecord(record.facts);
      const message = errorMessage(error);
      assert.match(message, /ECONNREFUSED/);
      assert.match(message, /syscall=connect/);
      assert.match(message, /address=127\.0\.0\.1/);
      assert.match(message, /port=43210/);
      assert.equal(record.recoveryHint, undefined);
      assert.equal(facts.code, "ECONNREFUSED");
      assert.equal(facts.errno, -4078);
      assert.equal(facts.syscall, "connect");
      assert.equal(facts.address, "127.0.0.1");
      assert.equal(facts.port, 43210);
      assert.doesNotMatch(JSON.stringify({ message, facts, recoveryHint: record.recoveryHint }), suggestionPattern);
      return true;
    }
  );
});

test("ToolCenter http_request failures preserve network facts in the execution result", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:43210"), {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 43210,
  });
  const center = new ToolCenter();
  center.register(createHttpRequestTool({ fetch: rejectingFetch(fetchFailureWithCause(cause)) }));

  const result = await center.execute(
    { callId: "call-http-refused", toolName: "http_request", input: { url: "http://127.0.0.1:43210/status" } },
    context,
    { callerAgentId: context.callerAgentId, allowedTools: ["http_request"] }
  );
  const errorFacts = asRecord(result.errorFacts);

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /ECONNREFUSED/);
  assert.equal(result.errorDomain, "tool_error");
  assert.equal(errorFacts.code, "ECONNREFUSED");
  assert.equal(errorFacts.errno, -4078);
  assert.equal(errorFacts.syscall, "connect");
  assert.equal(errorFacts.address, "127.0.0.1");
  assert.equal(errorFacts.port, 43210);
  assert.equal(errorFacts.method, "GET");
  assert.equal(errorFacts.url, "http://127.0.0.1:43210/status");
  assert.equal(typeof errorFacts.durationMs, "number");
  assert.doesNotMatch(JSON.stringify(result), suggestionPattern);
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
    assert.equal(legacyField in output, false, `tool output must not contain ${legacyField}`);
  }
  return output;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    assert.fail(`Expected Error, received ${typeof error}`);
  }
  return error.message;
}

function rejectingFetch(error: unknown): HttpRequestFetchLike {
  return async () => {
    throw error;
  };
}

function fetchFailureWithCause(cause: Error): Error {
  const error = new TypeError("fetch failed") as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}
