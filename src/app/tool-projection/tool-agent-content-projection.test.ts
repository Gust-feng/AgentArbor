import assert from "node:assert/strict";
import test from "node:test";
import { projectToolApprovalRequired, projectToolFailure, projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

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

test("batch sub-agent projection exposes every output continuation ref", () => {
  const firstContinuation = {
    ref: "sub-agent-output:sub-run-first",
    nextInput: { sub_run_id: "sub-run-first", start_char: 0, max_chars: 100_000 },
    note: "Read first output.",
  };
  const secondContinuation = {
    ref: "sub-agent-output:sub-run-second",
    nextInput: { sub_run_id: "sub-run-second", start_char: 0, max_chars: 100_000 },
    note: "Read second output.",
  };
  const projection = projectToolResult({
    request: {
      callId: "call-sub-agents-continuations",
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
            summary: "first summary",
            full_output: "a".repeat(140_000),
            full_output_ref: "sub-agent-output:sub-run-first",
            continuation: firstContinuation,
            run_id: "sub-run-first",
          },
          {
            index: 1,
            sub_agent_name: "review-expert",
            status: "completed",
            summary: "second summary",
            full_output: "b".repeat(140_000),
            full_output_ref: "sub-agent-output:sub-run-second",
            continuation: secondContinuation,
            run_id: "sub-run-second",
          },
        ],
        stats: { total: 2, completed: 2 },
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly continuations?: readonly {
      readonly index?: number;
      readonly continuation?: { readonly nextInput?: { readonly sub_run_id?: string } };
    }[];
    readonly result?: {
      readonly results?: readonly {
        readonly continuation?: { readonly nextInput?: { readonly sub_run_id?: string } };
      }[];
    };
  };
  const structuredContent = projection.modelResult?.structuredContent as {
    readonly continuations?: readonly {
      readonly index?: number;
      readonly continuation?: { readonly nextInput?: { readonly sub_run_id?: string } };
    }[];
  };

  assert.equal(agentContent.result?.results?.[0]?.continuation?.nextInput?.sub_run_id, "sub-run-first");
  assert.equal(agentContent.result?.results?.[1]?.continuation?.nextInput?.sub_run_id, "sub-run-second");
  assert.equal(agentContent.continuations?.length, 2);
  assert.equal(agentContent.continuations?.[0]?.index, 0);
  assert.equal(agentContent.continuations?.[0]?.continuation?.nextInput?.sub_run_id, "sub-run-first");
  assert.equal(agentContent.continuations?.[1]?.index, 1);
  assert.equal(agentContent.continuations?.[1]?.continuation?.nextInput?.sub_run_id, "sub-run-second");
  assert.equal(structuredContent.continuations?.length, 2);
  assert.equal(structuredContent.continuations?.[0]?.continuation?.nextInput?.sub_run_id, "sub-run-first");
  assert.equal(structuredContent.continuations?.[1]?.continuation?.nextInput?.sub_run_id, "sub-run-second");
  assert.equal(
    (projection.modelResult?.continuation as { readonly nextInput?: { readonly sub_run_id?: string } } | undefined)
      ?.nextInput?.sub_run_id,
    "sub-run-first"
  );
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
