import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { SubAgentRunTrace } from "../../domain/sub-agents/contracts.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { nowIso } from "../../kernel/id.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { ToolCenter } from "../tool-center/tool-center.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import { InMemorySubAgentRunTraceStore } from "./sub-agent-trace-store.js";
import { createSubAgentToolExecutors } from "./sub-agent-tools.js";
import { runSubAgent } from "./sub-agent-runner.js";

test("runSubAgent inherits parent allowed tools and hides sub-agent recursion tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read_file", { path: "README.md" }),
    textResponse("model-request-final", "read completed"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("spawn_sub_agent", async () => ({ should_not_run: true })));

  const result = await runSubAgent({
    subAgent: testSubAgent({ allowedTools: [] }),
    task: "read a file",
    toolBroker: center,
    channel,
    allowedTools: ["read_file", "spawn_sub_agent"],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

test("runSubAgent sends instructions as system and the delegated task as user input", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "task completed"),
  ]);
  const center = new ToolCenter();

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "generate three ideas",
    context: "Use today's schedule.",
    toolBroker: center,
    channel,
    allowedTools: [],
  });

  assert.equal(result.status, "completed");

  const messages = channel.requests[0]?.sanitizedMessages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  assert.match(messages[0]?.content ?? "", /你是「test-helper」专家/);
  assert.doesNotMatch(messages[0]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 任务描述/);
  assert.match(messages[1]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 额外上下文/);
  assert.match(messages[1]?.content ?? "", /Use today's schedule\./);
  assert.equal(result.trace?.subRunId, result.runId);
  assert.equal(result.trace?.modelExchanges[0]?.messages[0]?.role, "system");
  assert.match(result.trace?.modelExchanges[0]?.messages[1]?.content ?? "", /generate three ideas/);
  assert.equal(result.trace?.modelExchanges[0]?.textOutput, "task completed");
});

test("runSubAgent trace captures model tool calls and failed responses", async () => {
  const failedChannel = new SequenceIntelligenceChannel([
    failedResponse("model-request-failed", "upstream unavailable"),
  ]);
  const failed = await runSubAgent({
    subAgent: testSubAgent(),
    task: "fail",
    toolBroker: new ToolCenter(),
    channel: failedChannel,
    allowedTools: [],
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.trace?.modelExchanges[0]?.failureMessage, "upstream unavailable");

  const toolChannel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-tool", "call-read", "read_file", { path: "README.md" }),
    textResponse("model-request-final", "read completed"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "read",
    toolBroker: center,
    channel: toolChannel,
    allowedTools: ["read_file"],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.trace?.modelExchanges[0]?.toolCalls[0]?.toolName, "read_file");
  assert.equal(result.trace?.toolTraces[0]?.toolName, "read_file");
  assert.equal(result.trace?.toolTraces[0]?.status, "completed");
});

test("runSubAgent preserves long output separately from display summary", async () => {
  const sentinel = "TAIL_SENTINEL_FULL_OUTPUT";
  const fullOutput = `${"0123456789".repeat(80)}${sentinel}`;
  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "produce a long result",
    toolBroker: new ToolCenter(),
    channel: new SequenceIntelligenceChannel([
      textResponse("model-request-long", fullOutput),
    ]),
    allowedTools: [],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.fullOutput, fullOutput);
  assert.equal(result.trace?.fullOutput, fullOutput);
  assert.match(result.summary, /^子 Agent 已完成，完整输出 \d+ 字。$/);
  assert.equal(result.summary.includes(sentinel), false);
});

test("call_sub_agent projection exposes full output to parent model continuation", async () => {
  const sentinel = "PARENT_VISIBLE_TAIL_SENTINEL";
  const fullOutput = `${"abcdef".repeat(120)}${sentinel}`;
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-sub-agent", fullOutput),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent"],
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-parent-sub-agent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "test-helper", task: "return long output" },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agent"] }
  );

  const output = result.output as {
    readonly result?: { readonly full_output?: string };
    readonly summary?: string;
  };
  const agentContent = result.projection?.agentContent as {
    readonly full_output?: string;
    readonly result?: { readonly full_output?: string };
    readonly summary?: string;
  };

  assert.equal(result.status, "completed");
  assert.equal(output.result?.full_output, fullOutput);
  assert.equal(agentContent.full_output, fullOutput);
  assert.equal(agentContent.result?.full_output, fullOutput);
  assert.equal(agentContent.summary?.includes(sentinel), false);
});

test("sub-agent tool approval bubbles as the parent tool pending confirmation and resumes after approve", async () => {
  let shellRuns = 0;
  const eventLog = new InMemoryEventLog();
  const traces = new InMemorySubAgentRunTraceStore();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-child", "call-shell", "shell_command", { commandLine: "pnpm test" }),
    textResponse("model-request-child-final", "shell finished"),
  ]);
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => {
    shellRuns += 1;
    return { summary: "shell executed" };
  }, "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "shell_command"],
    confirmationPolicy: () => "prompt",
    publishToolEvent: (message) => eventLog.append(message),
    traceSink: traces,
    includeSpawnTool: true,
    eventLog,
  })) {
    center.register(executor);
  }

  const request = {
    callId: "call-parent-sub-agent",
    toolName: "call_sub_agent",
    input: {
      sub_agent_name: "test-helper",
      task: "run shell",
    },
  };
  const context = {
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
  };

  const paused = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    confirmationPolicy: "prompt",
  });

  assert.equal(paused.status, "approval_required");
  assert.equal(paused.callId, "call-parent-sub-agent");
  assert.equal(paused.toolName, "call_sub_agent");
  assert.equal(paused.confirmationRequest?.confirmationId, "confirmation-call-shell");
  assert.equal(paused.confirmationRequest?.title, "Shell 命令");
  assert.deepEqual(paused.confirmationRequest?.affectedResources, ["pnpm test"]);
  assert.equal(shellRuns, 0);
  assert.equal(eventLog.types().includes("user_approval.requested"), true);
  assert.equal(traces.list().length, 1);
  assert.equal(traces.list()[0]?.status, "approval_required");
  assert.equal(traces.list()[0]?.toolTraces[0]?.status, "approval_required");

  const resumed = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    approvedConfirmationIds: ["confirmation-call-shell"],
    confirmationPolicy: "prompt",
  });

  assert.equal(resumed.status, "completed");
  assert.equal(shellRuns, 1);
  assert.equal((resumed.output as { readonly status?: string }).status, "completed");
  assert.equal(channel.requests.length, 2);
  const mergedTrace = traces.list()[0];
  assert.equal(traces.list().length, 1);
  assert.equal(mergedTrace?.status, "completed");
  assert.equal(mergedTrace?.modelExchanges.length, 2);
  assert.equal(mergedTrace?.toolTraces.length, 1);
  assert.equal(mergedTrace?.toolTraces[0]?.status, "completed");
});

test("call_sub_agent and batch calls link traces to parent tool calls and batch ids", async () => {
  const collected: SubAgentRunTrace[] = [];
  const traces = {
    upsert(trace: SubAgentRunTrace) {
      collected.push(trace);
    },
  };
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-one", "one done"),
    textResponse("model-request-two", "two done"),
    textResponse("model-request-three", "three done"),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "call_sub_agents"],
    traceSink: traces,
  })) {
    center.register(executor);
  }

  await center.execute(
    {
      callId: "call-single-parent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "test-helper", task: "single" },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agent"] }
  );
  await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
        ],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agents"] }
  );

  assert.equal(collected[0]?.parentToolCallId, "call-single-parent");
  assert.equal(collected[1]?.parentToolCallId, "call-batch-parent");
  assert.equal(collected[1]?.batchIndex, 0);
  assert.equal(collected[2]?.batchIndex, 1);
  assert.equal(collected[1]?.batchId, collected[2]?.batchId);
});

test("call_sub_agents records pending and not-started batch stats when approval pauses execution", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-one", "one done"),
    toolCallResponse("model-request-two", "call-shell", "shell_command", { commandLine: "pnpm test" }),
    textResponse("model-request-two-final", "two done"),
  ]);
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => ({ summary: "shell executed" }), "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agents", "shell_command"],
    confirmationPolicy: () => "prompt",
    includeSpawnTool: true,
    eventLog,
  })) {
    center.register(executor);
  }

  const paused = await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
          { sub_agent_name: "test-helper", task: "third" },
        ],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    {
      callerAgentId: "agent-test",
      allowedTools: ["call_sub_agents", "shell_command"],
      confirmationPolicy: "prompt",
    }
  );

  assert.equal(paused.status, "approval_required");
  const batchCompleted = eventLog.list().find((entry) => entry.type === "sub_agent_batch.completed");
  const payload = batchCompleted?.message.payload as {
    readonly successCount?: number;
    readonly failedCount?: number;
    readonly approvalRequiredCount?: number;
    readonly notStartedCount?: number;
    readonly results?: readonly { readonly status: string }[];
  } | undefined;
  assert.equal(payload?.successCount, 1);
  assert.equal(payload?.failedCount, 0);
  assert.equal(payload?.approvalRequiredCount, 1);
  assert.equal(payload?.notStartedCount, 1);
  assert.deepEqual(payload?.results?.map((result) => result.status), ["completed", "approval_required"]);

  const resumed = await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
          { sub_agent_name: "test-helper", task: "third" },
        ],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    {
      callerAgentId: "agent-test",
      allowedTools: ["call_sub_agents", "shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell"],
      confirmationPolicy: "prompt",
    }
  );

  assert.equal(resumed.status, "completed");
  const finalBatchCompleted = eventLog.list().filter((entry) => entry.type === "sub_agent_batch.completed").at(-1);
  const finalPayload = finalBatchCompleted?.message.payload as {
    readonly successCount?: number;
    readonly approvalRequiredCount?: number;
    readonly notStartedCount?: number;
    readonly results?: readonly { readonly status: string }[];
  } | undefined;
  assert.equal(finalPayload?.successCount, 2);
  assert.equal(finalPayload?.approvalRequiredCount, 0);
  assert.equal(finalPayload?.notStartedCount, 1);
  assert.deepEqual(finalPayload?.results?.map((result) => result.status), ["completed", "completed"]);
});

test("spawn_sub_agent uses system_prompt as the temporary sub-agent system body", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-spawn", "spawned finished"),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["spawn_sub_agent"],
    includeSpawnTool: true,
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-spawn",
      toolName: "spawn_sub_agent",
      input: {
        role: "Temporary Reviewer",
        system_prompt: "CUSTOM SYSTEM BODY FOR TEMP AGENT",
        task: "review",
        allowed_tools: ["read_file"],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["spawn_sub_agent"] }
  );

  assert.equal(result.status, "completed");
  assert.match(channel.requests[0]?.sanitizedMessages[0]?.content ?? "", /CUSTOM SYSTEM BODY FOR TEMP AGENT/);
  assert.equal(channel.requests[0]?.sanitizedMessages[1]?.role, "user");
  assert.match(channel.requests[0]?.sanitizedMessages[1]?.content ?? "", /review/);
});

function testSubAgent(input: {
  readonly allowedTools?: readonly string[];
} = {}) {
  return {
    id: "test-helper",
    name: "test-helper",
    description: "Test helper",
    enabled: true,
    sourcePath: path.join(tmpdir(), "missing-sub-agent.md"),
    whenToUse: [],
    whenNotToUse: [],
    allowedTools: input.allowedTools ?? [],
    sourceKind: "custom" as const,
    sourceRootId: "test",
    sourcePrecedence: 0,
    sourceRootPath: "",
    packageName: "test-helper",
    packagePath: "",
    contentHash: "",
    bodyHash: "",
    metadataHash: "",
  };
}

async function tempRegistry(): Promise<SubAgentRegistry> {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  writeFileSync(
    path.join(packageDir, "SUB_AGENT.md"),
    [
      "---",
      "name: test-helper",
      "description: Test helper",
      "enabled: true",
      "---",
      "",
      "You are a test helper.",
      "",
    ].join("\n"),
    "utf8"
  );
  const registry = new SubAgentRegistry({ roots: [root] });
  await registry.list();
  return registry;
}

function testTool(
  name: string,
  execute: ToolExecutor["execute"],
  operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only",
  requiresConfirmation = false
): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: operationType === "read-only" ? "low" : "high",
        operationType,
        requiresConfirmation,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

class SequenceIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: readonly ModelResponse[]) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1] ?? this.responses.at(-1)!;
    return {
      ...response,
      requestId: request.requestId,
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

function completedResponse(requestId: string, output: unknown): ModelResponse {
  return {
    responseId: `${requestId}-response`,
    requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: "explanation",
    structuredOutput: output,
    finishReason: "stop",
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function textResponse(requestId: string, text: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    textOutput: text,
  };
}

function toolCallResponse(
  requestId: string,
  callId: string,
  toolName: string,
  input: unknown
): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    toolCalls: [{ callId, toolName, input }],
    finishReason: "tool_call",
  };
}

function failedResponse(requestId: string, message: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    status: "failed",
    textOutput: undefined,
    failure: {
      kind: "provider_response",
      retryable: true,
      message,
    },
    finishReason: "error",
  };
}
