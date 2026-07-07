import assert from "node:assert/strict";
import test from "node:test";
import { projectToolApprovalRequired, projectToolFailure, projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

test("ordinary markdown fragments preserve whitespace-only streaming deltas", () => {
  assert.equal(redactOrdinaryMarkdownFragment(" "), " ");
  assert.equal(redactOrdinaryMarkdownFragment("   "), "   ");
  assert.equal(redactOrdinaryMarkdownFragment("\n"), "\n");
});

test("ordinary markdown fragments preserve indentation and repeated spaces", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment("```ts\n  const value  = 1;\n```"),
    "```ts\n  const value  = 1;\n```"
  );
});

test("ordinary markdown fragments keep visible text without redaction", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment(" hello api_key=secret-value "),
    " hello api_key=secret-value "
  );
});

test("read tool projection exposes content preview to model continuation", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-read",
      toolName: "read",
      input: { ref: "research:web:one" },
    },
    output: {
      action: "read",
      ref: "research:web:one",
      status: "completed",
      result: {
        refId: "research:page:one",
        source: "page",
        title: "Readable Page",
        uri: "https://example.test/page",
        status: "completed",
        summary: "Readable summary",
        contentPreview: "Actual page body preview for the model.",
        truncated: true,
        sourceSearchRef: "research:web:one",
        metadata: { contentLength: 3000 },
      },
      trace: {
        traceId: "research-trace-test",
        action: "read",
        ref: "research:web:one",
        requestedSources: ["page"],
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.001Z",
        sourceSteps: [],
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly title?: string;
    readonly url?: string;
    readonly source?: string;
    readonly status?: string;
    readonly contentPreview?: string;
    readonly truncated?: boolean;
  };

  assert.equal(projection.display?.kind, "read_result");
  assert.equal(agentContent.title, "Readable Page");
  assert.equal(agentContent.url, "https://example.test/page");
  assert.equal(agentContent.source, "page");
  assert.equal(agentContent.status, "completed");
  assert.equal(agentContent.contentPreview, "Actual page body preview for the model.");
  assert.equal(agentContent.truncated, true);
  assert.equal(JSON.stringify(agentContent).includes("资料读取完成"), false);
  assert.equal(JSON.stringify(agentContent).includes("材料已读取"), false);
});

test("sub-agent projection keeps full output in model continuation", () => {
  const sentinel = "SUB_AGENT_FULL_OUTPUT_SENTINEL";
  const fullOutput = `${"0123456789".repeat(80)}${sentinel}`;
  const projection = projectToolResult({
    request: {
      callId: "call-sub-agent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "research-expert", task: "return details" },
    },
    output: {
      action: "call_sub_agent",
      status: "completed",
      sub_agent_name: "research-expert",
      sub_agent_id: "research-expert",
      summary: "子 Agent 已完成，完整输出 826 字。",
      result: {
        status: "completed",
        summary: "子 Agent 已完成，完整输出 826 字。",
        full_output: fullOutput,
        tool_calls: 0,
        model_rounds: 1,
        duration_ms: 12,
        run_id: "sub-run-1",
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly full_output?: string;
    readonly result?: { readonly full_output?: string };
    readonly summary?: string;
  };

  assert.equal(agentContent.full_output, fullOutput);
  assert.equal(agentContent.result?.full_output, fullOutput);
  assert.equal(agentContent.summary?.includes(sentinel), false);
});

test("batch sub-agent projection keeps each full output in model continuation", () => {
  const first = `${"a".repeat(700)}FIRST_TAIL`;
  const second = `${"b".repeat(700)}SECOND_TAIL`;
  const projection = projectToolResult({
    request: {
      callId: "call-sub-agents",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "research-expert", task: "first" },
          { sub_agent_name: "review-expert", task: "second" },
        ],
      },
    },
    output: {
      action: "call_sub_agents",
      status: "completed",
      summary: "执行 2 个子 Agent 任务：2 成功，0 失败，0 取消，0 等待确认，0 未启动，总耗时 20ms",
      result: {
        results: [
          {
            index: 0,
            sub_agent_name: "research-expert",
            status: "completed",
            summary: "子 Agent 已完成，完整输出 710 字。",
            full_output: first,
          },
          {
            index: 1,
            sub_agent_name: "review-expert",
            status: "completed",
            summary: "子 Agent 已完成，完整输出 711 字。",
            full_output: second,
          },
        ],
        stats: { total: 2, completed: 2 },
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly result?: {
      readonly results?: readonly { readonly full_output?: string }[];
    };
  };

  assert.equal(agentContent.result?.results?.[0]?.full_output, first);
  assert.equal(agentContent.result?.results?.[1]?.full_output, second);
});

test("batch read projection exposes per-ref content and errors to model continuation", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-batch-read",
      toolName: "read",
      input: { ref: ["a.md", "missing.md"] },
    },
    output: [
      {
        ref: "a.md",
        status: "completed",
        refId: "read:a.md",
        source: "codebase",
        title: "a.md",
        uri: "repo://a.md",
        contentPreview: "Alpha body",
        truncated: false,
      },
      {
        ref: "missing.md",
        status: "provider-failed",
        truncated: false,
        error: "codebase read could not read the requested text file.",
      },
    ],
  });

  const agentContent = projection.agentContent as {
    readonly results?: readonly {
      readonly ref?: string;
      readonly status?: string;
      readonly contentPreview?: string;
      readonly error?: string;
      readonly truncated?: boolean;
    }[];
  };

  assert.equal(projection.display?.kind, "generic_tool_summary");
  assert.equal(agentContent.results?.[0]?.contentPreview, "Alpha body");
  assert.equal(agentContent.results?.[0]?.status, "completed");
  assert.equal(agentContent.results?.[1]?.ref, "missing.md");
  assert.equal(agentContent.results?.[1]?.status, "provider-failed");
  assert.equal(agentContent.results?.[1]?.error, "codebase read could not read the requested text file.");
  assert.equal(agentContent.results?.every((item) => typeof item.truncated === "boolean"), true);
});

test("read failure projection preserves HTTP error facts for model continuation", () => {
  const errorFacts = {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 65432,
    method: "GET",
    url: "http://127.0.0.1:65432/status",
    durationMs: 2,
  };
  const projection = projectToolResult({
    request: {
      callId: "call-read-http-failed",
      toolName: "read",
      input: { ref: "http://127.0.0.1:65432/status" },
    },
    output: {
      action: "read",
      ref: "http://127.0.0.1:65432/status",
      status: "provider-failed",
      trace: {
        traceId: "research-trace-test",
        action: "read",
        ref: "http://127.0.0.1:65432/status",
        requestedSources: ["page"],
        status: "provider-failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.001Z",
        sourceSteps: [
          {
            source: "page",
            status: "provider-failed",
            resultRefs: [],
            message: "http_request failed: ECONNREFUSED 127.0.0.1:65432",
            errorFacts,
          },
        ],
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly status?: string;
    readonly error?: string;
    readonly errorFacts?: Readonly<Record<string, unknown>>;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };

  assert.equal(projection.display?.kind, "read_result");
  assert.equal(agentContent.status, "provider-failed");
  assert.match(agentContent.error ?? "", /ECONNREFUSED/);
  assert.equal(agentContent.errorFacts?.code, "ECONNREFUSED");
  assert.equal(agentContent.errorFacts?.errno, -4078);
  assert.equal(agentContent.errorFacts?.address, "127.0.0.1");
  assert.equal(agentContent.errorFacts?.port, 65432);
  assert.equal(agentContent.errorFacts?.method, "GET");
  assert.equal(agentContent.metadata, undefined);
  const envelope = projection.envelope;
  assert.ok(envelope);
  assert.equal(envelope.errorFacts?.code, "ECONNREFUSED");
  const uiDisplay = envelope.uiDisplay;
  assert.ok(uiDisplay);
  if (uiDisplay.kind !== "read_result") {
    throw new Error("expected read_result display");
  }
  assert.equal(uiDisplay.errorFacts?.code, "ECONNREFUSED");
});

test("failed tool projection exposes errorFacts in model continuation and envelope", () => {
  const projection = projectToolFailure({
    request: {
      callId: "call-http-timeout",
      toolName: "http_request",
      input: { url: "https://example.test/slow" },
    },
    error: "http_request failed: http_request timed out after 20ms.",
    errorFacts: {
      code: "ETIMEDOUT",
      timedOut: true,
      timeoutMs: 20,
      method: "GET",
      url: "https://example.test/slow",
      durationMs: 21,
    },
    durationMs: 21,
  });

  const agentContent = projection.agentContent as {
    readonly status?: string;
    readonly errorFacts?: Readonly<Record<string, unknown>>;
    readonly facts?: Readonly<Record<string, unknown>>;
  };

  assert.equal(agentContent.status, "failed");
  assert.equal(agentContent.errorFacts?.code, "ETIMEDOUT");
  assert.equal(agentContent.errorFacts?.timedOut, true);
  assert.equal(agentContent.facts?.code, "ETIMEDOUT");
  assert.equal(projection.envelope?.errorFacts?.timeoutMs, 20);
  assert.equal(JSON.stringify(agentContent).includes("recoveryHint"), false);
});

test("search invalid input projection keeps the provider message visible", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-search-empty",
      toolName: "search",
      input: { query: "" },
    },
    output: {
      action: "search",
      query: "",
      status: "invalid-input",
      results: [],
      trace: {
        traceId: "research-trace-search-empty",
        action: "search",
        query: "",
        requestedSources: ["codebase"],
        status: "invalid-input",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.001Z",
        sourceSteps: [
          {
            source: "codebase",
            status: "invalid-input",
            resultRefs: [],
            message: "search requires a non-empty query.",
          },
        ],
      },
    },
  });

  assert.equal(projection.display?.kind, "search_results");
  const display = projection.display;
  if (display?.kind !== "search_results") {
    throw new Error("expected search_results display");
  }
  assert.equal(display.status, "invalid-input");
  assert.equal(display.message, "search requires a non-empty query.");
  assert.equal(display.results.length, 0);
  assert.equal(JSON.stringify(projection.agentContent).includes("search requires a non-empty query."), true);
  assert.equal(projection.envelope?.uiDisplay?.kind, "search_results");
  assert.equal(projection.envelope?.agentSummary.includes("search requires a non-empty query."), true);
});

test("command projection keeps commandLine as the single command fact for model continuation", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-shell",
      toolName: "shell_command",
      input: {
        commandLine: `node -e "console.log('fragile quoted shell')"`,
        command: "node",
        args: ["-e", "console.log('fragile quoted shell')"],
      },
    },
    output: {
      action: "shell_command",
      summary: "node -e \"console.log('fragile quoted shell')\" · exit 0",
      result: {
        command: "node",
        commandLine: `node -e "console.log('fragile quoted shell')"`,
        args: ["-e", "console.log('fragile quoted shell')"],
        exitCode: 0,
        stdout: "fragile quoted shell",
        stderr: "",
        shell: {
          kind: "cmd",
          label: "Windows Command Prompt",
          executable: "cmd.exe",
          syntax: "cmd",
          invocation: ["cmd.exe", "/d", "/s", "/c", "<commandLine>"],
        },
      },
    },
  });

  const display = projection.display;
  assert.equal(display?.kind, "command_summary");
  assert.equal(display?.kind === "command_summary" ? display.commandLine : undefined, `node -e "console.log('fragile quoted shell')"`);
  assert.equal(display?.kind === "command_summary" ? display.command : undefined, "node");

  const agentContent = projection.agentContent as {
    readonly command?: string;
    readonly commandLine?: string;
  };
  assert.equal(agentContent.command, "node");
  assert.equal(agentContent.commandLine, `node -e "console.log('fragile quoted shell')"`);
  assert.equal(JSON.stringify(agentContent).includes(`node -e "console.log('fragile quoted shell')" -e console.log('fragile quoted shell')`), false);
});

test("command projection keeps token-like stdout and stderr in model-visible agent content", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-command-secret",
      toolName: "shell_command",
      input: { commandLine: "print-secret" },
    },
    output: {
      action: "shell_command",
      summary: "print-secret · exit 1",
      result: {
        commandLine: "print-secret",
        exitCode: 1,
        stdout: "stdout token=sk-live-token password=hunter2",
        stderr: "stderr Bearer sk-error-token api_key=abc123",
        shell: { label: "PowerShell" },
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly truncated?: boolean;
    readonly rawStdoutRef?: string;
    readonly rawStderrRef?: string;
  };

  assert.equal(agentContent.stdout, "stdout token=sk-live-token password=hunter2");
  assert.equal(agentContent.stderr, "stderr Bearer sk-error-token api_key=abc123");
  assert.equal(agentContent.truncated, false);
  assert.equal(agentContent.rawStdoutRef, undefined);
  assert.equal(agentContent.rawStderrRef, undefined);
  assert.equal(JSON.stringify(agentContent).includes("[redacted"), false);
});

test("command projection exposes timeout and background recovery metadata to model continuation", () => {
  const backgroundProjection = projectToolResult({
    request: {
      callId: "call-command-background",
      toolName: "shell_command",
      input: { commandLine: "pnpm dev", background: true },
    },
    output: {
      action: "shell_command",
      summary: "pnpm dev · started background pid 123",
      result: {
        commandLine: "pnpm dev",
        cwd: "apps/web",
        exitCode: 0,
        timedOut: false,
        background: true,
        pid: 123,
        logPath: "C:/Temp/agentarbor-command-logs/pnpm-dev.log",
        stopCommand: "taskkill /pid 123 /T /F",
        stdout: "Started background process pid 123.",
        stderr: "",
        shell: { label: "Windows Command Prompt" },
      },
    },
  });

  const display = backgroundProjection.display;
  const agentContent = backgroundProjection.agentContent as {
    readonly cwd?: string;
    readonly background?: boolean;
    readonly pid?: number;
    readonly logPath?: string;
    readonly stopCommand?: string;
    readonly timedOut?: boolean;
  };

  assert.equal(display?.kind === "command_summary" ? display.background : undefined, true);
  assert.equal(display?.kind === "command_summary" ? display.pid : undefined, 123);
  assert.equal(display?.kind === "command_summary" ? display.cwd : undefined, "apps/web");
  assert.equal(agentContent.cwd, "apps/web");
  assert.equal(agentContent.background, true);
  assert.equal(agentContent.timedOut, false);
  assert.equal(agentContent.pid, 123);
  assert.equal(agentContent.logPath, "C:/Temp/agentarbor-command-logs/pnpm-dev.log");
  assert.equal(agentContent.stopCommand, "taskkill /pid 123 /T /F");

  const timeoutProjection = projectToolResult({
    request: {
      callId: "call-command-timeout",
      toolName: "shell_command",
      input: { commandLine: "pnpm dev" },
    },
    output: {
      action: "shell_command",
      summary: "pnpm dev · timed out (exit 124)",
      result: {
        commandLine: "pnpm dev",
        exitCode: 124,
        timedOut: true,
        stdout: "dev server booting",
        stderr: "Command timed out after 30000ms and was terminated.",
      },
    },
  });
  const timeoutContent = timeoutProjection.agentContent as {
    readonly timedOut?: boolean;
    readonly exitCode?: number;
    readonly stdout?: string;
    readonly stderr?: string;
  };

  assert.equal(timeoutContent.timedOut, true);
  assert.equal(timeoutContent.exitCode, 124);
  assert.match(timeoutContent.stdout ?? "", /dev server booting/);
  assert.match(timeoutContent.stderr ?? "", /timed out/);
});

test("workspace list and grep projections keep factual traversal metadata", () => {
  const listProjection = projectToolResult({
    request: {
      callId: "call-list",
      toolName: "list_dir",
      input: { path: ".", depth: 2 },
    },
    output: {
      action: "list_dir",
      summary: ". · 2 entries · depth 2",
      result: {
        path: ".",
        depth: 2,
        maxDepth: 3,
        entriesReturned: 2,
        totalEntries: 2,
        unreadableDirectories: 0,
        entries: [
          { path: "src", name: "src", kind: "directory", depth: 1 },
          { path: "src/index.ts", name: "index.ts", kind: "file", bytes: 12, depth: 2 },
        ],
      },
    },
  });
  const listContent = listProjection.agentContent as {
    readonly depth?: number;
    readonly entriesReturned?: number;
    readonly totalEntries?: number;
    readonly entries?: readonly {
      readonly path?: string;
      readonly name?: string;
      readonly depth?: number;
    }[];
  };

  assert.equal(listContent.depth, 2);
  assert.equal(listContent.entriesReturned, 2);
  assert.equal(listContent.totalEntries, 2);
  assert.equal(listContent.entries?.[1]?.path, "src/index.ts");
  assert.equal(listContent.entries?.[1]?.depth, 2);
  assert.equal(listProjection.display?.kind, "directory_listing");
  assert.equal(listProjection.display?.kind === "directory_listing" ? listProjection.display.totalEntries : undefined, 2);

  const grepProjection = projectToolResult({
    request: {
      callId: "call-grep",
      toolName: "grep_files",
      input: { path: ".", query: "needle" },
    },
    output: {
      action: "grep_files",
      summary: ". · 1 matches for needle",
      result: {
        query: "needle",
        path: ".",
        engine: "js",
        matches: [{ path: "src/index.ts", line: 1, preview: "needle" }],
        searchedFiles: 1,
        skippedFactsAvailable: true,
        skippedFactsComplete: true,
        skippedFiles: 2,
        skippedBinaryFiles: 1,
        skippedTooLargeFiles: 1,
        skippedUnreadableFiles: 0,
        skippedDirectories: 1,
        skippedOtherEntries: 0,
        skippedSamples: [
          { path: "dist", reason: "skipped_directory" },
          { path: "logo.png", reason: "binary", bytes: 3 },
        ],
      },
    },
  });
  const grepContent = grepProjection.agentContent as {
    readonly engine?: string;
    readonly searchedFiles?: number;
    readonly skippedFactsAvailable?: boolean;
    readonly skippedFiles?: number;
    readonly skippedSamples?: readonly { readonly path?: string; readonly reason?: string }[];
  };

  assert.equal(grepContent.engine, "js");
  assert.equal(grepContent.searchedFiles, 1);
  assert.equal(grepContent.skippedFactsAvailable, true);
  assert.equal(grepContent.skippedFiles, 2);
  assert.deepEqual(grepContent.skippedSamples?.map((sample) => sample.reason), ["skipped_directory", "binary"]);
  assert.equal(grepProjection.display?.kind, "file_search_results");
  assert.equal(grepProjection.display?.kind === "file_search_results" ? grepProjection.display.matches[0]?.path : undefined, "src/index.ts");
});

test("grep file search projection preserves project-scale match previews", () => {
  const matches = Array.from({ length: 30 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    line: index + 1,
    preview: `needle ${index}`,
  }));
  const projection = projectToolResult({
    request: {
      callId: "call-grep-large",
      toolName: "grep_files",
      input: { path: ".", query: "needle" },
    },
    output: {
      action: "grep_files",
      summary: ". · 30 matches for needle",
      result: {
        query: "needle",
        path: ".",
        engine: "js",
        matches,
        searchedFiles: 30,
      },
      truncated: false,
    },
  });

  assert.equal(projection.display?.kind, "file_search_results");
  assert.equal(projection.display?.kind === "file_search_results" ? projection.display.matches.length : undefined, 30);
  assert.equal(projection.display?.kind === "file_search_results" ? projection.display.matchesReturned : undefined, 30);
  assert.equal(projection.envelope?.uiDisplay?.kind, "file_search_results");
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_search_results" ? projection.envelope.uiDisplay.matches.length : undefined, 30);
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_search_results" ? projection.envelope.uiDisplay.matchesReturned : undefined, 30);
});

test("read_file projection keeps token-like file content in model-visible agent content", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-read-file-secret",
      toolName: "read_file",
      input: { path: "secrets.txt" },
    },
    output: {
      action: "read_file",
      summary: "secrets.txt 已读取。",
      result: {
        path: "secrets.txt",
        bytes: 54,
        content: "password=hunter2\napi_key=sk-file-secret\nplain text",
        truncated: false,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly content?: string;
    readonly truncated?: boolean;
    readonly rawContentRef?: string;
  };

  assert.equal(agentContent.content, "password=hunter2\napi_key=sk-file-secret\nplain text");
  assert.equal(agentContent.truncated, false);
  assert.equal(agentContent.rawContentRef, undefined);
  assert.equal(JSON.stringify(agentContent).includes("[redacted"), false);
});

test("truncated command stdout and stderr keep real prefixes and raw refs", () => {
  const longStdout = `stdout token=sk-${"x".repeat(130_000)}`;
  const longStderr = `stderr Bearer sk-${"y".repeat(70_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-command",
      toolName: "shell_command",
      input: { commandLine: "long-output" },
    },
    output: {
      action: "shell_command",
      result: {
        commandLine: "long-output",
        exitCode: 0,
        stdout: longStdout,
        stderr: longStderr,
        stdoutTruncated: true,
        stderrTruncated: true,
        stdoutChars: longStdout.length,
        stderrChars: longStderr.length,
        stdoutOmittedChars: 2_000,
        stderrOmittedChars: 1_000,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly truncated?: boolean;
    readonly stdoutTruncated?: boolean;
    readonly stderrTruncated?: boolean;
    readonly stdoutChars?: number;
    readonly stderrChars?: number;
    readonly stdoutOmittedChars?: number;
    readonly stderrOmittedChars?: number;
    readonly rawStdoutRef?: string;
    readonly rawStderrRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.stdoutTruncated, true);
  assert.equal(agentContent.stderrTruncated, true);
  assert.equal(agentContent.stdoutChars, longStdout.length);
  assert.equal(agentContent.stderrChars, longStderr.length);
  assert.equal(agentContent.stdoutOmittedChars, 2_000);
  assert.equal(agentContent.stderrOmittedChars, 1_000);
  assert.equal(agentContent.stdout?.startsWith("stdout token=sk-"), true);
  assert.equal(agentContent.stderr?.startsWith("stderr Bearer sk-"), true);
  assert.equal(agentContent.stdout?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.stderr?.endsWith("[truncated to 64000 chars]"), true);
  assert.equal(agentContent.rawStdoutRef, "tool:call-long-command:raw:shell_command:stdout");
  assert.equal(agentContent.rawStderrRef, "tool:call-long-command:raw:shell_command:stderr");
  assert.equal(agentContent.stdout?.includes("safe summary"), false);
});

test("truncated read_file content keeps real prefix and raw content ref", () => {
  const longContent = `password=hunter2\napi_key=sk-file-${"z".repeat(130_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-read-file",
      toolName: "read_file",
      input: { path: "secrets.txt" },
    },
    output: {
      action: "read_file",
      result: {
        path: "secrets.txt",
        bytes: longContent.length,
        content: longContent,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly content?: string;
    readonly truncated?: boolean;
    readonly rawContentRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.content?.startsWith("password=hunter2\napi_key=sk-file-"), true);
  assert.equal(agentContent.content?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.rawContentRef, "tool:call-long-read-file:raw:read_file:content");
});

test("line-range read continuations omit maxLength so next input stays executable", () => {
  const localProjection = projectToolResult({
    request: {
      callId: "call-line-read-file",
      toolName: "read_file",
      input: { path: "src/app.ts", startLine: 1, endLine: 2, maxLength: 5 },
    },
    output: {
      action: "read_file",
      result: {
        path: "src/app.ts",
        startLine: 1,
        endLine: 2,
        totalLines: 6,
        content: "line 1\nline 2",
        hasMoreAfter: true,
      },
      truncated: true,
    },
  });
  const localNextInput = ((localProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(localNextInput?.path, "src/app.ts");
  assert.equal(localNextInput?.startLine, 3);
  assert.equal("maxLength" in (localNextInput ?? {}), false);

  const attachmentProjection = projectToolResult({
    request: {
      callId: "call-line-read-context",
      toolName: "read_context_attachment_text",
      input: { attachmentId: "ctx_notes", path: "notes.txt", startLine: 10, endLine: 12, maxLength: 5 },
    },
    output: {
      action: "read_context_attachment_text",
      result: {
        attachmentId: "ctx_notes",
        path: "notes.txt",
        startLine: 10,
        endLine: 12,
        totalLines: 20,
        content: "line 10\nline 11\nline 12",
        hasMoreAfter: true,
      },
      truncated: true,
    },
  });
  const attachmentNextInput = ((attachmentProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(attachmentNextInput?.attachmentId, "ctx_notes");
  assert.equal(attachmentNextInput?.path, "notes.txt");
  assert.equal(attachmentNextInput?.startLine, 13);
  assert.equal("maxLength" in (attachmentNextInput ?? {}), false);
});

test("truncated research read preview keeps raw preview ref", () => {
  const longPreview = `page content token=sk-preview-${"p".repeat(130_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-read",
      toolName: "read",
      input: { ref: "research:web:1" },
    },
    output: {
      action: "read",
      ref: "research:web:1",
      result: {
        title: "Long page",
        uri: "https://example.test/long",
        contentPreview: longPreview,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly contentPreview?: string;
    readonly truncated?: boolean;
    readonly rawContentPreviewRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.contentPreview?.startsWith("page content token=sk-preview-"), true);
  assert.equal(agentContent.contentPreview?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.rawContentPreviewRef, "tool:call-long-read:raw:read:contentPreview");
});

test("web tool model results use model-visible body facts instead of UI previews", () => {
  const body = `${"a".repeat(1_500)}BODY_SENTINEL`;
  const projection = projectToolResult({
    request: {
      callId: "call-http-body",
      toolName: "http_request",
      input: { url: "https://example.test/api" },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
        body,
        durationMs: 10,
        startChar: 0,
        bodyChars: body.length,
        hasMoreAfter: false,
        truncated: false,
      },
    },
  });

  const text = projection.modelResult?.content[0]?.type === "text"
    ? projection.modelResult.content[0].text
    : "";
  const structured = projection.modelResult?.structuredContent as {
    readonly rawBodyRef?: string;
    readonly hasMoreAfter?: boolean;
  };

  assert.equal(projection.display?.kind === "http_response" ? projection.display.bodyPreview?.includes("BODY_SENTINEL") : false, false);
  assert.equal(text.includes("BODY_SENTINEL"), true);
  assert.equal(structured.hasMoreAfter, false);
  assert.equal(structured.rawBodyRef, undefined);
});

test("http and browser projections expose executable continuation input when truncated", () => {
  const httpProjection = projectToolResult({
    request: {
      callId: "call-http-truncated",
      toolName: "http_request",
      input: { url: "https://example.test/api", method: "GET", timeoutMs: 1000 },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: {},
        body: "first-window",
        durationMs: 10,
        startChar: 0,
        bodyChars: 12,
        hasMoreAfter: true,
        nextStartChar: 12,
        truncated: true,
      },
      truncated: true,
    },
  });
  const httpNextInput = ((httpProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const httpAgentNextInput = (((httpProjection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);

  assert.equal(httpNextInput?.url, "https://example.test/api");
  assert.equal(httpNextInput?.method, "GET");
  assert.equal(httpNextInput?.startChar, 12);
  assert.equal(httpAgentNextInput?.startChar, 12);

  const browserProjection = projectToolResult({
    request: {
      callId: "call-browser-truncated",
      toolName: "browser_snapshot",
      input: { url: "https://example.test/page", waitMs: 500, maxTextChars: 1000 },
    },
    output: {
      action: "browser_snapshot",
      summary: "Example · https://example.test/page",
      result: {
        url: "https://example.test/page",
        title: "Example",
        text: "visible-window",
        startChar: 0,
        textChars: 14,
        totalTextChars: 40,
        hasMoreAfter: true,
        nextStartChar: 14,
      },
      truncated: true,
    },
  });
  const browserNextInput = ((browserProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const browserAgentNextInput = (((browserProjection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);

  assert.equal(browserNextInput?.url, "https://example.test/page");
  assert.equal(browserNextInput?.waitMs, 500);
  assert.equal(browserNextInput?.maxTextChars, 1000);
  assert.equal(browserNextInput?.startChar, 14);
  assert.equal(browserAgentNextInput?.startChar, 14);
});

test("http and browser projections omit impossible continuation input at startChar ceiling", () => {
  const httpProjection = projectToolResult({
    request: {
      callId: "call-http-ceiling",
      toolName: "http_request",
      input: { url: "https://example.test/api", method: "GET" },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: {},
        body: "last-window",
        durationMs: 10,
        startChar: 2_000_000,
        bodyChars: 11,
        hasMoreAfter: true,
        reachedStartCharCeiling: true,
        startCharCeiling: 2_000_000,
        truncated: true,
      },
      truncated: true,
    },
  });
  const httpStructured = httpProjection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
  };
  const httpAgentContent = httpProjection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
    readonly continuation?: unknown;
  };

  assert.equal(httpProjection.modelResult?.continuation, undefined);
  assert.equal(httpStructured.hasMoreAfter, true);
  assert.equal(httpStructured.nextStartChar, undefined);
  assert.equal(httpStructured.reachedStartCharCeiling, true);
  assert.equal(httpStructured.startCharCeiling, 2_000_000);
  assert.equal(httpAgentContent.hasMoreAfter, true);
  assert.equal(httpAgentContent.nextStartChar, undefined);
  assert.equal(httpAgentContent.reachedStartCharCeiling, true);
  assert.equal(httpAgentContent.startCharCeiling, 2_000_000);
  assert.equal(httpAgentContent.continuation, undefined);
  assert.equal((httpProjection.modelResult?.truncation as { readonly truncated?: boolean } | undefined)?.truncated, true);

  const browserProjection = projectToolResult({
    request: {
      callId: "call-browser-ceiling",
      toolName: "browser_snapshot",
      input: { url: "https://example.test/page", waitMs: 500 },
    },
    output: {
      action: "browser_snapshot",
      summary: "Example · https://example.test/page",
      result: {
        url: "https://example.test/page",
        title: "Example",
        text: "last-window",
        startChar: 2_000_000,
        textChars: 11,
        totalTextChars: 2_000_012,
        hasMoreAfter: true,
        reachedStartCharCeiling: true,
        startCharCeiling: 2_000_000,
      },
      truncated: true,
    },
  });
  const browserStructured = browserProjection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
  };
  const browserAgentContent = browserProjection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
    readonly continuation?: unknown;
  };

  assert.equal(browserProjection.modelResult?.continuation, undefined);
  assert.equal(browserStructured.hasMoreAfter, true);
  assert.equal(browserStructured.nextStartChar, undefined);
  assert.equal(browserStructured.reachedStartCharCeiling, true);
  assert.equal(browserStructured.startCharCeiling, 2_000_000);
  assert.equal(browserAgentContent.hasMoreAfter, true);
  assert.equal(browserAgentContent.nextStartChar, undefined);
  assert.equal(browserAgentContent.reachedStartCharCeiling, true);
  assert.equal(browserAgentContent.startCharCeiling, 2_000_000);
  assert.equal(browserAgentContent.continuation, undefined);
  assert.equal((browserProjection.modelResult?.truncation as { readonly truncated?: boolean } | undefined)?.truncated, true);
});

test("attachment pdf and skill resource continuations match their executable schemas", () => {
  const pdfProjection = projectToolResult({
    request: {
      callId: "call-pdf-truncated",
      toolName: "read_context_attachment_pdf_text",
      input: { attachmentId: "ctx_pdf", path: "docs/report.pdf", maxLength: 1000 },
    },
    output: {
      action: "read_context_attachment_pdf_text",
      summary: "report.pdf · truncated",
      result: {
        attachmentId: "ctx_pdf",
        path: "docs/report.pdf",
        readable: true,
        content: "pdf window",
        startChar: 0,
        textChars: 10,
        charCount: 3000,
        hasMoreAfter: true,
        nextStartChar: 1000,
      },
      truncated: true,
    },
  });
  const pdfNextInput = ((pdfProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(pdfNextInput?.attachmentId, "ctx_pdf");
  assert.equal(pdfNextInput?.path, "docs/report.pdf");
  assert.equal(pdfNextInput?.maxLength, 1000);
  assert.equal(pdfNextInput?.startChar, 1000);
  assert.equal("startLine" in (pdfNextInput ?? {}), false);

  const skillProjection = projectToolResult({
    request: {
      callId: "call-skill-truncated",
      toolName: "read_skill_resource",
      input: { skillId: "repo-review", path: "references/checklist.md", type: "reference", maxChars: 1000 },
    },
    output: {
      action: "read_skill_resource",
      summary: "repo-review · checklist · truncated",
      result: {
        skillId: "repo-review",
        path: "references/checklist.md",
        type: "reference",
        content: "skill window",
        charCount: 3000,
        truncated: true,
      },
      truncated: true,
    },
  });
  const skillNextInput = ((skillProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(skillNextInput?.skillId, "repo-review");
  assert.equal(skillNextInput?.path, "references/checklist.md");
  assert.equal(skillNextInput?.type, "reference");
  assert.equal(skillNextInput?.maxChars, 2000);
  assert.equal("startLine" in (skillNextInput ?? {}), false);
});

test("table read projection exposes executable row continuation input when truncated", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-table-truncated",
      toolName: "read_context_attachment_table",
      input: { attachmentId: "ctx_table", path: "sales.csv", startRow: 2, rowCount: 1, headerRow: true },
    },
    output: {
      action: "read_context_attachment_table",
      summary: "sales.csv · rows 2-2 of 3 · 1 returned",
      result: {
        attachmentId: "ctx_table",
        kind: "file",
        title: "sales.csv",
        path: "sales.csv",
        table: true,
        format: "delimited",
        headerRow: true,
        totalRows: 3,
        columns: ["region", "revenue"],
        startRow: 2,
        rowCount: 1,
        requestedRowCount: 1,
        rows: [{ rowNumber: 2, values: ["north", "1200"], record: { region: "north", revenue: "1200" } }],
        rowsReturned: 1,
        hasMoreBefore: true,
        hasMoreAfter: true,
        nextStartRow: 3,
      },
      truncated: true,
    },
  });
  const nextInput = ((projection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const agentNextInput = (((projection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);
  const structured = projection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartRow?: number;
  };

  assert.equal(nextInput?.attachmentId, "ctx_table");
  assert.equal(nextInput?.path, "sales.csv");
  assert.equal(nextInput?.startRow, 3);
  assert.equal(nextInput?.rowCount, 1);
  assert.equal(nextInput?.headerRow, true);
  assert.equal(agentNextInput?.startRow, 3);
  assert.equal(structured.hasMoreAfter, true);
  assert.equal(structured.nextStartRow, 3);
});

test("table read projection omits impossible row continuation at ceiling", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-table-ceiling",
      toolName: "read_context_attachment_table",
      input: { attachmentId: "ctx_table", path: "sales.csv", startRow: 10000, rowCount: 1 },
    },
    output: {
      action: "read_context_attachment_table",
      summary: "sales.csv · row ceiling reached",
      result: {
        attachmentId: "ctx_table",
        path: "sales.csv",
        table: true,
        startRow: 10000,
        rowCount: 1,
        rows: [{ rowNumber: 10000, values: ["tail"] }],
        rowsReturned: 1,
        hasMoreAfter: true,
        reachedRowCeiling: true,
        rowCeiling: 10000,
      },
      truncated: true,
    },
  });
  const structured = projection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartRow?: number;
    readonly reachedRowCeiling?: boolean;
    readonly rowCeiling?: number;
  };
  const agentContent = projection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly continuation?: unknown;
  };

  assert.equal(projection.modelResult?.continuation, undefined);
  assert.equal(structured.hasMoreAfter, true);
  assert.equal(structured.nextStartRow, undefined);
  assert.equal(structured.reachedRowCeiling, true);
  assert.equal(structured.rowCeiling, 10000);
  assert.equal(agentContent.hasMoreAfter, true);
  assert.equal(agentContent.continuation, undefined);
});

test("custom file write action projects as file change display", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-custom-write",
      toolName: "workspace__write_file",
      input: { path: "notes/custom.md", content: "RAW_CUSTOM_BODY" },
    },
    output: {
      action: "write_file",
      summary: "notes/custom.md written",
      result: {
        path: "notes/custom.md",
        bytes: 15,
      },
    },
  });

  assert.equal(projection.display?.kind, "file_change_summary");
  assert.equal(projection.display?.kind === "file_change_summary" ? projection.display.path : undefined, "notes/custom.md");
  assert.equal(projection.display?.kind === "file_change_summary" ? projection.display.operation : undefined, "write");
  assert.equal(projection.envelope?.uiDisplay?.kind, "file_change_summary");
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_change_summary" ? projection.envelope.uiDisplay.operation : undefined, "write");
  assert.equal(projection.envelope?.evidenceRefs.includes("file:notes/custom.md"), true);
  assert.equal(JSON.stringify(projection.display).includes("RAW_CUSTOM_BODY"), false);
});

test("tool model result preserves read_file content and path facts", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-read-file",
      toolName: "read_file",
      input: { path: "src/app.ts" },
    },
    output: {
      action: "read_file",
      summary: "文件已读取。",
      result: {
        path: "src/app.ts",
        startLine: 10,
        endLine: 12,
        totalLines: 30,
        content: "export const value = 1;\nexport const next = 2;",
      },
    },
  });

  assert.equal(projection.modelResult?.content[0]?.type, "text");
  assert.match(projection.modelResult?.content[0]?.type === "text" ? projection.modelResult.content[0].text : "", /export const value/);
  const structured = projection.modelResult?.structuredContent as {
    readonly path?: string;
    readonly startLine?: number;
    readonly endLine?: number;
  };
  assert.equal(structured.path, "src/app.ts");
  assert.equal(structured.startLine, 10);
  assert.equal(structured.endLine, 12);
  assert.equal(/已完成|完成/.test(projection.uiSummary ?? ""), false);
});

test("tool model result preserves stdout stderr and exit facts", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-command",
      toolName: "shell_command",
      input: { commandLine: "pnpm test" },
    },
    output: {
      action: "shell_command",
      summary: "pnpm test · exit 1",
      result: {
        commandLine: "pnpm test",
        cwd: "Z:/AgentArbor",
        exitCode: 1,
        stdout: "stdout sentinel line",
        stderr: "stderr sentinel line",
        logRef: "command-log://run/tool",
      },
    },
  });

  const structured = projection.modelResult?.structuredContent as {
    readonly commandLine?: string;
    readonly cwd?: string;
    readonly exitCode?: number;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly logRef?: string;
  };

  assert.equal(projection.modelResult?.isError, true);
  assert.equal(structured.commandLine, "pnpm test");
  assert.equal(structured.cwd, "Z:/AgentArbor");
  assert.equal(structured.exitCode, 1);
  assert.equal(structured.stdout, "stdout sentinel line");
  assert.equal(structured.stderr, "stderr sentinel line");
  assert.equal(structured.logRef, "command-log://run/tool");
  assert.equal(JSON.stringify(projection.modelResult).includes("safe summary"), false);
  assert.equal(projection.display?.kind, "command_summary");
});

test("tool model result preserves MCP content structuredContent and isError", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-mcp",
      toolName: "docs__lookup",
      input: { query: "tool result" },
    },
    output: {
      summary: "Lookup failed with useful text.",
      mcpResult: {
        content: [{ type: "text", text: "Server says the lookup failed but returned context." }],
        structuredContent: {
          code: "LOOKUP_FAILED",
          retryable: false,
        },
        isError: true,
      },
      result: {
        text: "Server says the lookup failed but returned context.",
        structuredContent: {
          code: "LOOKUP_FAILED",
          retryable: false,
        },
      },
      isError: true,
    },
  });

  assert.equal(projection.modelResult?.isError, true);
  assert.deepEqual(projection.modelResult?.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(projection.modelResult?.content[0]?.type, "text");
  const agentContent = projection.agentContent as {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
    readonly structuredContent?: unknown;
    readonly isError?: boolean;
  };
  assert.deepEqual(agentContent.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(agentContent.isError, true);
  assert.equal(agentContent.content?.[0]?.text, "Server says the lookup failed but returned context.");
  assert.deepEqual(projection.modelResult?.structuredContent, {
    code: "LOOKUP_FAILED",
    retryable: false,
  });
  assert.equal(projection.modelResult?.isError, true);
});

test("tool model result keeps multi-file diffs as separate file blocks", () => {
  const diff = [
    "diff --git a/src/one.ts b/src/one.ts",
    "@@ line 1",
    "- old one",
    "+ new one",
    "diff --git a/src/two.ts b/src/two.ts",
    "@@ line 2",
    "- old two",
    "+ new two",
  ].join("\n");
  const projection = projectToolResult({
    request: {
      callId: "call-canonical-edit",
      toolName: "edit_file",
      input: { path: "src/one.ts" },
    },
    output: {
      action: "edit_file",
      summary: "2 files changed",
      display: {
        kind: "file_diff_preview",
        preview: diff,
      },
      result: {
        path: "src/one.ts",
        replacements: 2,
      },
    },
  });

  const structured = projection.modelResult?.structuredContent as {
    readonly files?: readonly { readonly path?: string; readonly diff: string }[];
  };

  assert.equal(projection.display?.kind, "file_diff_preview");
  assert.equal(structured.files?.length, 2);
  assert.equal(structured.files?.[0]?.path, "src/one.ts");
  assert.equal(structured.files?.[1]?.path, "src/two.ts");
  assert.equal(structured.files?.[0]?.diff.includes("new two"), false);
  assert.equal(structured.files?.[1]?.diff.includes("new one"), false);
});

test("approval projection exposes model approval shape", () => {
  const projection = projectToolApprovalRequired({
    request: {
      callId: "call-approval",
      toolName: "shell_command",
      input: { commandLine: "pnpm publish" },
    },
    toolName: "shell_command",
    operationType: "execute",
    actionSummary: "执行命令：pnpm publish",
  });

  const structured = projection.modelResult?.structuredContent as { readonly status?: string; readonly actionSummary?: string };
  assert.equal(structured.status, "waiting_approval");
  assert.equal(structured.actionSummary, "执行命令：pnpm publish");
  assert.equal(projection.modelResult?.content[0]?.type, "text");
  assert.equal(projection.uiSummary, "执行命令：pnpm publish");
});
