import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallRequest, ToolCallResult, ToolExecutor } from "../../domain/tools/index.js";
import { toolModelAttachmentsFromOutput, withToolModelAttachments } from "../../domain/tools/index.js";
import { projectToolDisplay } from "../tool-projection/tool-display-projection.js";
import { createReadToolOutputTool } from "./adapters/tool-output-read-tool.js";
import { ToolCenter } from "./tool-center.js";
import { InMemoryToolOutputStore } from "./tool-output-store.js";

test("ToolCenter registers, lists, executes, and unregisters tools", async () => {
  const center = new ToolCenter();
  center.register(testTool("echo", async (input) => ({ input })));

  assert.equal(center.has("echo"), true);
  assert.deepEqual(center.list().map((tool) => tool.name), ["echo"]);

  const result = await center.execute(
    { callId: "call-1", toolName: "echo", input: { value: "hello" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("echo")
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { input: { value: "hello" } });

  center.unregister("echo");
  assert.equal(center.has("echo"), false);
});

test("ToolCenter rejects tools without explicit metadata", () => {
  const center = new ToolCenter();

  assert.throws(
    () =>
      center.register({
        definition: {
          name: "unsafe_tool",
          description: "Missing metadata must not default to low-risk read-only.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        async execute() {
          return { ok: true };
        },
      }),
    /cannot enter ToolCenter without metadata/
  );
  assert.equal(center.has("unsafe_tool"), false);
});

test("ToolCenter enforces allowedTools permissions", async () => {
  const center = new ToolCenter();
  center.register(testTool("web_search", async () => ({ ok: true })));

  const result = await center.execute(
    { callId: "call-1", toolName: "web_search", input: { query: "x" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("other_tool")
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /未授权/);
});

test("ToolCenter rejects permission records for a different caller agent", async () => {
  const center = new ToolCenter();
  center.register(testTool("web_search", async () => ({ ok: true })));

  const result = await center.execute(
    { callId: "call-1", toolName: "web_search", input: { query: "x" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "other-agent", allowedTools: ["web_search"] }
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /调用者身份与本轮工具授权不一致/);
});

test("ToolCenter does not retain run call budgets between executions", async () => {
  const center = new ToolCenter();
  center.register(testTool("echo", async () => ({ ok: true })));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const first = await center.execute({ callId: "call-1", toolName: "echo", input: {} }, context, allowTools("echo"));
  const second = await center.execute({ callId: "call-2", toolName: "echo", input: {} }, context, allowTools("echo"));

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
});

test("ToolCenter default does not add a small tool-call budget", async () => {
  const center = new ToolCenter();
  center.register(testTool("echo", async () => ({ ok: true })));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  for (let index = 0; index < 25; index += 1) {
    const result = await center.execute({ callId: `call-${index}`, toolName: "echo", input: {} }, context, allowTools("echo"));
    assert.equal(result.status, "completed");
  }
});

test("ToolCenter gates any tool metadata that requires confirmation before execution", async () => {
  let writes = 0;
  let deletes = 0;
  let executes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("custom_write", async () => {
    writes += 1;
    return { ok: true };
  }, "read-write"));
  center.register(testTool("delete_file", async () => {
    deletes += 1;
    return { ok: true };
  }, "read-write", { requiresConfirmation: true }));
  center.register(testTool("shell_command", async () => {
    executes += 1;
    return { ok: true };
  }, "execute", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const write = await center.execute({ callId: "call-write", toolName: "custom_write", input: {} }, context, allowTools("custom_write", "delete_file", "shell_command"));
  const deleteResult = await center.execute(
    { callId: "call-delete", toolName: "delete_file", input: { path: "notes.txt" } },
    context,
    allowTools("custom_write", "delete_file", "shell_command")
  );
  const execute = await center.execute(
    { callId: "call-exec", toolName: "shell_command", input: { commandLine: "pnpm test" } },
    context,
    allowTools("custom_write", "delete_file", "shell_command")
  );

  assert.equal(write.status, "completed");
  assert.equal(deleteResult.status, "approval_required");
  assert.equal(execute.status, "approval_required");
  assert.equal(deleteResult.error, undefined);
  assert.equal(execute.error, undefined);
  assert.equal(deleteResult.confirmationRequest?.confirmationId, "confirmation-call-delete");
  assert.equal(deleteResult.confirmationRequest?.affectedResources[0], "notes.txt");
  assert.equal(deleteResult.confirmationRequest?.consequence, "目标：notes.txt。批准后只执行本次删除文件。");
  assert.equal(execute.confirmationRequest?.confirmationId, "confirmation-call-exec");
  assert.equal(execute.confirmationRequest?.affectedResources[0], "pnpm test");
  assert.equal(execute.confirmationRequest?.consequence, "目标：pnpm test。批准后只执行本次Shell 命令。");
  assert.equal(writes, 1);
  assert.equal(deletes, 0);
  assert.equal(executes, 0);
});

test("ToolCenter keeps shell_command behind confirmation until the same confirmation id is approved", async () => {
  let executes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => {
    executes += 1;
    return { commandLine: "pnpm test", exitCode: 0 };
  }, "execute", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
  const request = {
    callId: "call-command",
    toolName: "shell_command",
    input: { commandLine: "pnpm test" },
  };

  const pending = await center.execute(
    request,
    context,
    allowTools("shell_command")
  );
  const result = await center.execute(
    request,
    context,
    { ...allowTools("shell_command"), approvedConfirmationIds: ["confirmation-call-command"] }
  );

  assert.equal(pending.status, "approval_required");
  assert.equal(pending.confirmationRequest?.confirmationId, "confirmation-call-command");
  assert.equal(pending.confirmationRequest?.actionSummary, "Shell 命令：pnpm test");
  assert.equal(result.status, "completed");
  assert.equal(executes, 1);
  assert.deepEqual(result.output, { commandLine: "pnpm test", exitCode: 0 });
});

test("ToolCenter can accept a tool executor supplied approval_required result", async () => {
  const center = new ToolCenter();
  center.register(testTool("delegating_tool", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "delegating_tool",
      input: { original: true },
      output: withToolModelAttachments(
        { delegated: true },
        [{
          kind: "image",
          source: { kind: "data", mimeType: "image/png", data: "cGFydGlhbA==" },
          attachmentId: "partial-attachment",
        }]
      ),
      status: "approval_required",
      error: "Delegated tool requires approval.",
      durationMs: 12,
      projection: { legacy: true },
      envelope: { legacy: true },
      confirmationRequest: {
        confirmationId: "confirmation-inner-call",
        runId: "inner-call",
        title: "内部工具确认",
        actionSummary: "内部工具需要确认",
        affectedResources: ["inner-resource"],
        riskLevel: "high",
        requestedAt: "2026-06-30T00:00:00.000Z",
        sourceRefs: ["tool:inner-call"],
        display: { legacy: true },
      },
    },
  })));

  const result = await center.execute(
    { callId: "call-parent", toolName: "delegating_tool", input: { task: "delegate" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("delegating_tool")
  );

  assert.equal(result.status, "approval_required");
  assert.equal(result.callId, "call-parent");
  assert.deepEqual(result.input, { task: "delegate" });
  assert.deepEqual(result.output, { delegated: true });
  assert.equal(toolModelAttachmentsFromOutput(result.output)?.[0]?.attachmentId, "partial-attachment");
  assert.equal(result.error, undefined);
  assert.equal("projection" in result, false);
  assert.equal("envelope" in result, false);
  assert.equal(result.confirmationRequest?.confirmationId, "confirmation-inner-call");
  assert.deepEqual(result.confirmationRequest?.affectedResources, ["inner-resource"]);
  assert.equal(result.confirmationRequest === undefined ? true : "display" in result.confirmationRequest, false);
});

test("ToolCenter preserves approval_required when partial output retention fails", async () => {
  const store = new InMemoryToolOutputStore({ maxItemChars: 8 });
  const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 4 });
  center.register(createReadToolOutputTool(store));
  center.register(testTool("delegating_tool", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "delegating_tool",
      input: {},
      output: { partial: "must remain recoverable" },
      status: "approval_required",
      durationMs: 1,
      confirmationRequest: {
        confirmationId: "confirmation-partial-output",
        runId: "inner-call",
        title: "内部工具确认",
        actionSummary: "内部工具需要确认",
        affectedResources: ["inner-resource"],
        riskLevel: "high",
        requestedAt: "2026-07-12T00:00:00.000Z",
        sourceRefs: ["tool:inner-call"],
      },
    },
  })));

  const result = await center.execute(
    { callId: "call-parent", toolName: "delegating_tool", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("delegating_tool", "read_tool_output"),
  );

  assert.equal(result.status, "approval_required");
  assert.equal(result.confirmationRequest?.confirmationId, "confirmation-partial-output");
  assert.equal(result.errorDomain, "runtime_error");
  assert.equal(result.errorFacts?.outputDeliveryPhase, "output_retention");
  assert.equal(result.errorFacts?.outputDeliveryCode, "tool_output_item_too_large");
  assert.equal(result.errorFacts?.originalStatus, "approval_required");
  assert.equal((result.output as { readonly retentionFailed?: unknown }).retentionFailed, true);
});

test("ToolCenter marks completed side-effect delivery failed without inviting a retry", async () => {
  const store = new InMemoryToolOutputStore({ maxItemChars: 8 });
  const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 4 });
  center.register(createReadToolOutputTool(store));
  let applied = 0;
  center.register(testTool("submit_fixture", async () => {
    applied += 1;
    return { receipt: "effect-already-applied" };
  }, "external-submit"));

  const result = await center.execute(
    { callId: "call-submit", toolName: "submit_fixture", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("submit_fixture", "read_tool_output"),
  );
  const delivery = result.output as Readonly<Record<string, unknown>>;

  assert.equal(applied, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.errorDomain, "runtime_error");
  assert.equal(result.errorFacts?.code, "tool_output_item_too_large");
  assert.equal(result.errorFacts?.outputDeliveryCode, "tool_output_item_too_large");
  assert.equal(result.errorFacts?.originalStatus, "completed");
  assert.equal(delivery.retentionFailed, true);
  assert.equal(delivery.contentIncomplete, true);
  assert.equal(delivery.deliveryStatus, "failed");
  assert.equal(delivery.sourceExecutionStatus, "completed");
  assert.equal(delivery.doNotBlindlyRetry, true);
  assert.equal(delivery.truncated, undefined);
  assert.equal(delivery.continuation, undefined);
});

test("ToolCenter rebuilds explicit failed results with JSON-safe error facts", async () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const center = new ToolCenter();
  center.register(testTool("explicit_failure", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "explicit_failure",
      input: { stale: true },
      output: { observed: true },
      status: "failed",
      error: "explicit failure",
      errorDomain: "invalid-domain",
      errorFacts: {
        nonFinite: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        bigint: 7n,
        circular,
      },
      durationMs: -1,
      projection: { legacy: true },
      envelope: { legacy: true },
      display: { legacy: true },
    },
  })));

  const result = await center.execute(
    { callId: "call-explicit-failure", toolName: "explicit_failure", input: { current: true } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("explicit_failure")
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.input, { current: true });
  assert.deepEqual(result.output, { observed: true });
  assert.equal(result.errorDomain, "tool_error");
  assert.equal(result.errorFacts?.nonFinite, "NaN");
  assert.equal(result.errorFacts?.infinity, "Infinity");
  assert.equal(result.errorFacts?.bigint, "7n");
  assert.deepEqual(result.errorFacts?.circular, { self: "[circular]" });
  assert.equal(result.durationMs >= 0, true);
  assert.equal("projection" in result, false);
  assert.equal("envelope" in result, false);
  assert.equal("display" in result, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("ToolCenter preserves complete errors from explicit executor results", async () => {
  const error = `explicit-error-${"x".repeat(800)}`;
  const detail = `explicit-fact-${"y".repeat(800)}`;
  const center = new ToolCenter();
  center.register(testTool("explicit_long_failure", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "explicit_long_failure",
      input: {},
      output: { observed: true },
      status: "failed",
      error,
      errorFacts: { detail },
      durationMs: 1,
    },
  })));

  const result = await center.execute(
    { callId: "call-explicit-long-failure", toolName: "explicit_long_failure", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("explicit_long_failure")
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error, error);
  assert.equal(result.errorFacts?.detail, detail);
});

test("ToolCenter retains oversized explicit failure evidence without losing original facts", async () => {
  const error = `explicit-error-start\n${"x".repeat(6_000)}\nexplicit-error-end`;
  const detail = `explicit-detail-start\n${"y".repeat(6_000)}\nexplicit-detail-end`;
  const store = new InMemoryToolOutputStore();
  const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 256 });
  center.register(createReadToolOutputTool(store));
  center.register(testTool("explicit_retained_failure", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "explicit_retained_failure",
      input: {},
      output: withToolModelAttachments(
        { observed: "upstream failure output" },
        [{
          kind: "image",
          source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
          attachmentId: "failure-attachment",
        }],
      ),
      status: "failed",
      error,
      errorDomain: "tool_error",
      errorFacts: { code: "upstream_failure", detail },
      durationMs: 1,
    },
  })));
  const permission = allowTools("explicit_retained_failure", "read_tool_output");

  const result = await center.execute(
    { callId: "call-explicit-retained-failure", toolName: "explicit_retained_failure", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    permission,
  );
  const delivery = result.output as {
    readonly continuation?: { readonly nextInput?: ToolCallRequest["input"] };
  };
  const read = await center.execute(
    {
      callId: "read-explicit-retained-failure",
      toolName: "read_tool_output",
      input: delivery.continuation?.nextInput,
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    permission,
  );
  const retained = JSON.parse((read.output as { readonly content: string }).content) as {
    readonly status: string;
    readonly output: { readonly observed: string };
    readonly error: string;
    readonly errorDomain: string;
    readonly errorFacts: { readonly code: string; readonly detail: string };
  };

  assert.equal(result.status, "failed");
  assert.equal(result.errorDomain, "tool_error");
  assert.equal(result.errorFacts?.code, "upstream_failure");
  assert.equal(result.errorFacts?.detail === detail, false);
  assert.equal(typeof result.errorFacts?.errorEvidenceRef, "string");
  assert.equal(toolModelAttachmentsFromOutput(result.output)?.[0]?.attachmentId, "failure-attachment");
  assert.equal(read.status, "completed");
  assert.deepEqual(retained, {
    status: "failed",
    output: { observed: "upstream failure output" },
    error,
    errorDomain: "tool_error",
    errorFacts: { code: "upstream_failure", detail },
  });
});

test("ToolCenter keeps original explicit failure semantics when evidence retention is unavailable", async () => {
  const center = new ToolCenter({ maxInlineOutputChars: 64 });
  center.register(testTool("explicit_unretained_failure", async (_input, context) => ({
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? "missing-call-id",
      toolName: "explicit_unretained_failure",
      input: {},
      output: { body: "z".repeat(2_000) },
      status: "failed",
      error: "MCP server reported its original failure.",
      errorDomain: "tool_error",
      errorFacts: { code: "mcp_tool_error", serverId: "fixture-server" },
      durationMs: 1,
    },
  })));

  const result = await center.execute(
    { callId: "call-explicit-unretained-failure", toolName: "explicit_unretained_failure", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("explicit_unretained_failure"),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error, "MCP server reported its original failure.");
  assert.equal(result.errorDomain, "tool_error");
  assert.equal(result.errorFacts?.code, "mcp_tool_error");
  assert.equal(result.errorFacts?.serverId, "fixture-server");
  assert.equal(result.errorFacts?.errorEvidenceCode, "tool_error_reader_unavailable");
  assert.equal((result.output as { readonly retentionFailed?: unknown }).retentionFailed, true);
});

test("ToolCenter preserves complete thrown errors that fit the inline result budget", async () => {
  const message = `thrown-message-${"x".repeat(800)}`;
  const detail = `thrown-fact-${"y".repeat(800)}`;
  const center = new ToolCenter({ maxInlineOutputChars: 5_000 });
  center.register(testTool("inline_thrown_failure", async () => {
    throw Object.assign(new Error(message), {
      errorDomain: "tool_error",
      facts: { detail },
    });
  }));

  const result = await center.execute(
    { callId: "call-inline-thrown-failure", toolName: "inline_thrown_failure", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("inline_thrown_failure"),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error, message);
  assert.equal(result.errorFacts?.detail, detail);
  assert.equal(result.output, undefined);
});

test("ToolCenter retains oversized thrown stderr and HTTP-like bodies behind read_tool_output", async () => {
  const cases = [
    {
      toolName: "shell_command",
      message: "shell command failed with exit code 1",
      errorDomain: "process_error" as const,
      evidenceName: "stderr",
      evidence: `stderr-start\n${"s".repeat(6_000)}\nstderr-end`,
      facts: { exitCode: 1 },
    },
    {
      toolName: "http_like_failure",
      message: "HTTP request failed with status 502",
      errorDomain: "tool_error" as const,
      evidenceName: "body",
      evidence: `response-start\n${"b".repeat(6_000)}\nresponse-end`,
      facts: { statusCode: 502, url: "https://example.test/failure" },
    },
  ];

  for (const fixture of cases) {
    let executions = 0;
    const store = new InMemoryToolOutputStore();
    const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 256 });
    center.register(createReadToolOutputTool(store));
    center.register(testTool(fixture.toolName, async () => {
      executions += 1;
      throw Object.assign(new Error(fixture.message), {
        errorDomain: fixture.errorDomain,
        facts: {
          ...fixture.facts,
          [fixture.evidenceName]: fixture.evidence,
        },
      });
    }));

    const permission = allowTools(fixture.toolName, "read_tool_output");
    const result = await center.execute(
      { callId: `call-${fixture.toolName}`, toolName: fixture.toolName, input: {} },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      permission,
    );
    const delivery = result.output as {
      readonly contentRef?: unknown;
      readonly truncated?: unknown;
      readonly continuationAvailability?: unknown;
      readonly continuation?: { readonly nextInput?: ToolCallRequest["input"] };
    };

    assert.equal(result.status, "failed");
    assert.equal(result.error, fixture.message);
    assert.equal(result.errorDomain, fixture.errorDomain);
    assert.notEqual(result.errorFacts?.[fixture.evidenceName], fixture.evidence);
    assert.equal(typeof delivery.contentRef, "string");
    assert.equal(delivery.truncated, true);
    assert.equal(delivery.continuationAvailability, "live_only");
    assert.notEqual(delivery.continuation?.nextInput, undefined);

    const read = await center.execute(
      {
        callId: `read-${fixture.toolName}`,
        toolName: "read_tool_output",
        input: delivery.continuation?.nextInput,
      },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      permission,
    );
    const retained = JSON.parse((read.output as { readonly content: string }).content) as {
      readonly message: string;
      readonly errorDomain: string;
      readonly facts: Readonly<Record<string, unknown>>;
    };

    assert.equal(read.status, "completed");
    assert.equal(retained.message, fixture.message);
    assert.equal(retained.errorDomain, fixture.errorDomain);
    assert.equal(retained.facts[fixture.evidenceName], fixture.evidence);
    assert.equal(executions, 1, "reading retained error evidence must not rerun the failed tool");
  }
});

test("ToolCenter retained output and error previews do not split UTF-16 surrogate pairs", async () => {
  const store = new InMemoryToolOutputStore();
  const center = new ToolCenter({ outputStore: store, maxInlineOutputChars: 10 });
  center.register(createReadToolOutputTool(store));
  center.register(testTool("large_unicode_output", async () => `${"a".repeat(3_998)}😀tail`));
  center.register(testTool("large_unicode_error", async () => {
    throw new Error(`${"e".repeat(3_998)}😀error-tail`);
  }));
  const permission = allowTools("large_unicode_output", "large_unicode_error", "read_tool_output");
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const output = await center.execute(
    { callId: "call-large-unicode-output", toolName: "large_unicode_output", input: {} },
    context,
    permission,
  );
  const failure = await center.execute(
    { callId: "call-large-unicode-error", toolName: "large_unicode_error", input: {} },
    context,
    permission,
  );
  const outputPreview = (output.output as { readonly contentPreview: string }).contentPreview;

  assert.equal(outputPreview, `${"a".repeat(3_998)}…`);
  assert.equal(hasUnpairedSurrogate(outputPreview), false);
  assert.equal(failure.error, `${"e".repeat(3_998)}…`);
  assert.equal(hasUnpairedSurrogate(failure.error ?? ""), false);
});

test("ToolCenter safely merges prototype-shaped facts from thrown errors", async () => {
  const facts = JSON.parse(`{
    "__proto__": { "polluted": true },
    "constructor": { "kind": "tool-error" },
    "prototype": "tool-prototype"
  }`) as Record<string, unknown>;
  const thrown = new Error("prototype-shaped tool failure");
  Object.defineProperty(thrown, "facts", {
    value: facts,
    enumerable: true,
  });
  const center = new ToolCenter();
  center.register(testTool("prototype_failure", async () => {
    throw thrown;
  }));

  const result = await center.execute(
    { callId: "call-prototype-failure", toolName: "prototype_failure", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("prototype_failure")
  );
  const errorFacts = result.errorFacts as Record<string, unknown>;

  assert.equal(result.status, "failed");
  assert.equal(Object.getPrototypeOf(errorFacts), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(errorFacts, "__proto__"), true);
  assert.deepEqual(errorFacts["__proto__"], { polluted: true });
  assert.deepEqual(errorFacts.constructor, { kind: "tool-error" });
  assert.equal(errorFacts.prototype, "tool-prototype");
  assert.equal((errorFacts as { readonly polluted?: boolean }).polluted, undefined);
  assert.equal(({} as { readonly polluted?: boolean }).polluted, undefined);
});

test("ToolCenter rejects invalid explicit statuses and approval requests", async () => {
  const center = new ToolCenter();
  center.register(testTool("invalid_status", async () => ({
    kind: "tool_call_result",
    result: {
      callId: "inner-status",
      toolName: "invalid_status",
      input: {},
      output: { observed: true },
      status: "done",
      durationMs: 1,
    },
  })));
  center.register(testTool("invalid_approval", async () => ({
    kind: "tool_call_result",
    result: {
      callId: "inner-approval",
      toolName: "invalid_approval",
      input: {},
      output: { paused: true },
      status: "approval_required",
      durationMs: 1,
    },
  })));

  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
  const invalidStatus = await center.execute(
    { callId: "call-invalid-status", toolName: "invalid_status", input: {} },
    context,
    allowTools("invalid_status")
  );
  const invalidApproval = await center.execute(
    { callId: "call-invalid-approval", toolName: "invalid_approval", input: {} },
    context,
    allowTools("invalid_approval")
  );

  assert.equal(invalidStatus.status, "failed");
  assert.equal(invalidStatus.errorFacts?.code, "invalid_tool_result_status");
  assert.equal(invalidApproval.status, "failed");
  assert.equal(invalidApproval.errorFacts?.code, "invalid_tool_confirmation_request");
});

test("ToolCenter lets full access mode execute confirmation-gated shell commands", async () => {
  let executes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => {
    executes += 1;
    return { commandLine: "pnpm test", exitCode: 0 };
  }, "execute", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

  const result = await center.execute(
    { callId: "call-command-full-access", toolName: "shell_command", input: { commandLine: "pnpm test" } },
    context,
    { ...allowTools("shell_command"), confirmationPolicy: "full_access" }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.confirmationRequest, undefined);
  assert.equal(executes, 1);
});

test("ToolCenter executes the same non-command tool call only after matching confirmation approval", async () => {
  let deletes = 0;
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("delete_file", async () => {
    deletes += 1;
    return { ok: true };
  }, "read-write", { requiresConfirmation: true }));
  const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };
  const request = { callId: "call-delete", toolName: "delete_file", input: { path: "notes.txt" } };

  const pending = await center.execute(request, context, allowTools("delete_file"));
  const wrongApproval = await center.execute(
    request,
    context,
    { ...allowTools("delete_file"), approvedConfirmationIds: ["confirmation-other"] }
  );
  const approved = await center.execute(
    request,
    context,
    { ...allowTools("delete_file"), approvedConfirmationIds: ["confirmation-call-delete"] }
  );

  assert.equal(pending.status, "approval_required");
  assert.equal(wrongApproval.status, "approval_required");
  assert.equal(approved.status, "completed");
  assert.equal(deletes, 1);
});

test("tool display projection preserves command facts without redaction", async () => {
  const center = new ToolCenter();
  center.register(testTool("shell_command", async () => ({
    command: "pnpm",
    args: ["test"],
    exitCode: 0,
    stdout: "ok\nAuthorization: Bearer sk-test-secret-token",
    stderr: "",
  }), "read-only"));

  const result = await center.execute(
    { callId: "call-shell", toolName: "shell_command", input: { command: "pnpm", args: ["test"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("shell_command")
  );

  assert.equal(result.status, "completed");
  const display = displayFor(result);
  assert.equal(display.kind, "command_summary");
  assert.equal(JSON.stringify(display).includes("sk-test-secret-token"), true);
});

test("tool display projection preserves search facts", async () => {
  const center = new ToolCenter();
  center.register(testTool("search", async () => ({
    query: "AgentArbor",
    researchStatus: "completed",
    results: [
      {
        refId: "research:web:one",
        source: "web",
        title: "AgentArbor result",
        uri: "https://example.test/agentarbor",
        snippet: "short safe snippet",
      },
    ],
  })));

  const result = await center.execute(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor" } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("search")
  );

  assert.equal(result.status, "completed");
  const display = displayFor(result);
  assert.equal(display.kind, "search_results");
  assert.equal(display.kind === "search_results" ? display.results[0]?.title : "", "AgentArbor result");
});

test("tool display projection ignores oldText/newText preview fields", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("edit_file", async () => ({
    path: "notes.md",
    previousLength: 32,
    nextLength: 18,
    replacements: 1,
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-edit",
      toolName: "edit_file",
      input: {
        path: "notes.md",
        oldText: "old file body sk-edit-secret",
        newText: "new file body sk-edit-secret",
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("edit_file")
  );

  const display = displayFor(result);
  const displayJson = JSON.stringify(display);
  assert.equal(result.status, "completed");
  assert.equal(display.kind, "file_diff_preview");
  assert.equal(displayJson.includes("old file body"), false);
  assert.equal(displayJson.includes("new file body"), false);
  assert.equal(displayJson.includes("sk-edit-secret"), false);
  assert.equal(display.kind === "file_diff_preview" ? display.replacements : 0, 1);
});

test("ToolCenter file diff display exposes bounded edit preview without redaction", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("edit_file", async () => ({
    path: "notes.md",
    previousLength: 32,
    nextLength: 36,
    replacements: 1,
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-edit-preview",
      toolName: "edit_file",
      input: {
        path: "notes.md",
        edits: [{ anchor: "old visible line\napi_key=sk-edit-secret", replacement: "new visible line\napi_key=sk-edit-secret" }],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("edit_file")
  );

  const display = displayFor(result);
  const displayJson = JSON.stringify(display);
  assert.equal(result.status, "completed");
  assert.equal(display?.kind, "file_diff_preview");
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("- old visible line") : false, true);
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("+ new visible line") : false, true);
  assert.equal(displayJson.includes("sk-edit-secret"), true);
});

test("ToolCenter file diff display prefers precise edit parameters in preview labels", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("edit_file", async () => ({
    path: "notes.md",
    previousLength: 20,
    nextLength: 22,
    replacements: 1,
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-edit-occurrence",
      toolName: "edit_file",
      input: {
        path: "notes.md",
        edits: [{ oldText: "same", newText: "updated", occurrence: 2, startLine: 3, endLine: 3 }],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("edit_file")
  );

  const display = displayFor(result);
  assert.equal(result.status, "completed");
  assert.equal(display?.kind, "file_diff_preview");
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("@@ occurrence 2 · line 3") : false, true);
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("- same") : false, true);
  assert.equal(display?.kind === "file_diff_preview" ? display.preview?.includes("+ updated") : false, true);
});

test("ToolCenter file change display exposes bounded create preview without redaction", async () => {
  const center = new ToolCenter({ platform: "linux" });
  center.register(testTool("create_file", async () => ({
    path: "created.md",
    bytes: 42,
  }), "read-write"));

  const result = await center.execute(
    {
      callId: "call-create-preview",
      toolName: "create_file",
      input: {
        path: "created.md",
        content: "visible created line\npassword=sk-create-secret",
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("create_file")
  );

  const display = displayFor(result);
  const displayJson = JSON.stringify(display);
  assert.equal(result.status, "completed");
  assert.equal(display?.kind, "file_change_summary");
  assert.equal(display?.kind === "file_change_summary" ? display.preview?.includes("+ visible created line") : false, true);
  assert.equal(displayJson.includes("sk-create-secret"), true);
  assert.equal(displayJson.includes("[redacted-secret]"), false);
});

test("ToolCenter preserves adapter error facts in failed results and projections", async () => {
  const center = new ToolCenter();
  center.register(testTool("shell_command", async () => {
    throw Object.assign(new Error("spawn pnpm ENOENT"), {
      code: "ENOENT",
      facts: {
        code: "ENOENT",
        syscall: "spawn",
        command: "pnpm",
        args: ["missing"],
      },
    });
  }));

  const result = await center.execute(
    { callId: "call-shell-failed", toolName: "shell_command", input: { command: "pnpm", args: ["missing"] } },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("shell_command")
  );
  assert.equal(result.status, "failed");
  assert.equal(result.errorDomain, "process_error");
  assert.equal(result.errorFacts?.code, "ENOENT");
  assert.equal(result.errorFacts?.syscall, "spawn");
  assert.equal(result.errorFacts?.command, "pnpm");
  assert.deepEqual(result.errorFacts?.args, ["missing"]);
});

test("ToolCenter list returns cloned metadata", () => {
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ ok: true }), "read-only"));

  const listed = center.list();
  (listed[0]!.metadata as { category: string }).category = "web";

  assert.equal(center.list()[0]?.metadata?.category, "other");
});

test("ToolCenter list returns cloned model contracts", () => {
  const center = new ToolCenter();
  const executor = testTool("read_file", async () => ({ ok: true }), "read-only");
  center.register({
    ...executor,
    definition: {
      ...executor.definition,
      modelContract: {
        purpose: "Read a file.",
        whenToUse: ["Need file contents."],
        whenNotToUse: ["Need to edit."],
        inputNotes: ["path is required."],
        usageNotes: ["Read before editing."],
        outputNotes: ["result.content has text."],
        runtimeHints: [{ label: "workspace root", value: "current workspace" }],
        examples: [{ title: "Read", input: { path: "README.md" } }],
      },
    },
  });

  const listed = center.list()[0]!;
  const listedContract = listed.modelContract! as {
    readonly examples: readonly { readonly input: { path: string } }[];
    readonly runtimeHints: { label: string; value: string }[];
    readonly whenToUse: string[];
  };
  listedContract.whenToUse.push("mutated");
  listedContract.examples[0]!.input.path = "changed.md";
  listedContract.runtimeHints[0]!.value = "changed";

  const fresh = center.list()[0]!.modelContract!;
  assert.deepEqual(fresh.whenToUse, ["Need file contents."]);
  assert.deepEqual(fresh.examples?.[0]?.input, { path: "README.md" });
  assert.equal(fresh.runtimeHints?.[0]?.value, "current workspace");
});

test("ToolCenter keeps undefined as a valid completed result", async () => {
  const center = new ToolCenter();
  center.register(testTool("no_result", async () => undefined));

  const result = await center.execute(
    { callId: "call-no-result", toolName: "no_result", input: {} },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("no_result")
  );

  assert.equal(result.status, "completed");
  assert.equal(result.output, undefined);
});

test("ToolCenter fails non-JSON-safe executor results at the fact boundary", async () => {
  for (const [name, output, expectedPath] of [
    ["cycle", (() => { const value: Record<string, unknown> = {}; value.self = value; return value; })(), "$.self"],
    ["bigint", { value: 1n }, "$.value"],
    ["function", { value: () => undefined }, "$.value"],
  ] as const) {
    const center = new ToolCenter();
    center.register(testTool(name, async () => output));

    const result = await center.execute(
      { callId: `call-${name}`, toolName: name, input: {} },
      { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
      allowTools(name)
    );

    assert.equal(result.status, "failed");
    assert.equal(result.output, undefined);
    assert.equal(result.errorDomain, "runtime_error");
    assert.equal(result.errorFacts?.code, "invalid_tool_output_fact");
    assert.equal(result.errorFacts?.phase, "output");
    assert.equal(result.errorFacts?.path, expectedPath);
    assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
    assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
    assert.equal(result.errorFacts?.outputDeliveryPhase, "executor_result_normalization");
    assert.match(result.error ?? "", /not JSON-safe/);
  }
});

test("ToolCenter rejects non-JSON-safe input before invoking an executor", async () => {
  let executions = 0;
  const center = new ToolCenter();
  center.register(testTool("input_contract", async () => {
    executions += 1;
    return { ok: true };
  }));
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const result = await center.execute(
    {
      callId: "call-invalid-input",
      toolName: "input_contract",
      input: circular as unknown as ToolCallRequest["input"],
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    allowTools("input_contract")
  );

  assert.equal(executions, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.input, undefined);
  assert.equal(result.errorDomain, "runtime_error");
  assert.equal(result.errorFacts?.code, "invalid_tool_input_fact");
  assert.equal(result.errorFacts?.phase, "input");
  assert.equal(result.errorFacts?.path, "$.self");
});

function testTool(
  name: string,
  execute: ToolExecutor["execute"],
  operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only",
  options: { readonly requiresConfirmation?: boolean } = {}
): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: operationType === "read-only" ? "low" : "high",
        operationType,
        requiresConfirmation: options.requiresConfirmation ?? false,
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

function allowTools(...allowedTools: readonly string[]) {
  return {
    callerAgentId: "agent-test",
    allowedTools,
  };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function displayFor(result: ToolCallResult) {
  return projectToolDisplay({
    callId: result.callId,
    toolName: result.toolName,
    input: result.input,
  }, result.output);
}
