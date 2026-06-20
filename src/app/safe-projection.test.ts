import assert from "node:assert/strict";
import test from "node:test";
import { projectToolFailure, projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

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
