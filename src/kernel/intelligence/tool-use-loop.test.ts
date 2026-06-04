import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { InMemoryEventLog } from "../events/in-memory-event-log.js";
import { nowIso } from "../id.js";
import { pendingModelOutputValidation } from "./validation.js";
import {
  executeToolUseLoop,
  resumeToolUseLoopFromApproval,
  resumeToolUseLoopFromConfirmationDecision,
} from "./tool-use-loop.js";

test("executeToolUseLoop executes one tool round and returns final model output", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer with tool result." }),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ results: [{ title: "A" }] }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      publishToolEvent: (message) => {
        eventLog.append(message);
      },
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.rounds, 1);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.completed"]);
  assert.equal(result.finalOutput.structuredOutput, channel.responses.at(-1)?.structuredOutput);
});

test("executeToolUseLoop completes on plain model text without exposing finish_task", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-text", "Final answer chosen by the agent."),
  ]);
  const center = new TestToolBroker();

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxModelRounds: 4,
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.equal(result.finalOutput.textOutput, "Final answer chosen by the agent.");
  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.tools?.some((tool) => tool.name === "finish_task"), false);
});

test("executeToolUseLoop can hide blocked internal tools from model-visible tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-text", "Final answer chosen by the agent."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));
  center.register("finish_task", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxModelRounds: 4,
      blockedToolNames: ["finish_task"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["web_search"]);
});

test("executeToolUseLoop returns tool results to the model before natural completion", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    textResponse("model-request-final", "Final answer with tool result."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ results: [{ title: "A" }] }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      maxModelRounds: 4,
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.finalOutput.textOutput, "Final answer with tool result.");
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
  assert.equal(center.getCallCount(), 1);
});

test("executeToolUseLoop runs context maintenance before continuing after tool results", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    textResponse("model-request-final", "Final answer with compacted context."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ results: [{ title: "A" }] }));
  let maintenanceCalls = 0;

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      maintainContext: async (input) => {
        maintenanceCalls += 1;
        if (maintenanceCalls === 2) {
          return {
            status: "compacted",
            messages: [
              { role: "system", content: "## Goal\n- Compacted context", ref: "context:compacted" },
              ...input.messages.slice(-2),
            ],
          };
        }
        return { status: "unchanged" };
      },
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(maintenanceCalls, 2);
  assert.equal(channel.requests[1]?.sanitizedMessages[0]?.ref, "context:compacted");
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
});

test("executeToolUseLoop pauses when context maintenance fails", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-final", "must not be requested"),
  ]);
  const center = new TestToolBroker();

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maintainContext: async () => ({
        status: "failed",
        message: "Context compaction failed.",
        requestId: "model-request-compaction",
      }),
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "context_overflow");
  assert.equal(result.finalOutput.status, "failed");
  assert.equal(channel.requests.length, 0);
});

test("executeToolUseLoop pauses out_of_fuel instead of forcing synthesis when tool fuel is exhausted", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      maxToolRounds: 0,
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "out_of_fuel");
  assert.equal(result.toolCalls.length, 0);
  assert.equal(center.getCallCount(), 0);
  assert.equal(channel.requests.length, 1);
});

test("executeToolUseLoop pauses out_of_fuel when model fuel is exhausted before no-tool response", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-text", "call-search", "web_search"),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxModelRounds: 1,
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "out_of_fuel");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.finalOutput.failure?.message.includes("final no-tool response"), true);
  assert.equal(channel.requests.length, 1);
});

test("executeToolUseLoop allows final model output after the last allowed tool round", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer after one allowed tool round." }),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxToolRounds: 1,
      allowedTools: ["web_search"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.rounds, 1);
  assert.equal(channel.requests.length, 2);
});

test("executeToolUseLoop pauses out_of_fuel when the model requests another tool after max rounds", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "web_search"),
    toolCallResponse("model-request-next", "call-2", "web_search"),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxToolRounds: 1,
      allowedTools: ["web_search"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "out_of_fuel");
  assert.equal(result.rounds, 1);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(channel.requests.length, 2);
});

test("executeToolUseLoop appends failed tool results without throwing", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-denied", "web_search"),
    completedResponse("model-request-final", { summary: "Fallback after tool failure." }),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: [],
      publishToolEvent: (message) => {
        eventLog.append(message);
      },
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.failed"]);
  assert.equal(channel.requests[1]?.sanitizedMessages.at(-1)?.role, "tool");
});

test("executeToolUseLoop preserves assistant protocol continuation fields across tool rounds", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...toolCallResponse("model-request-test", "call-search", "web_search"),
      assistantMessage: {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-search", toolName: "web_search", input: { query: "AgentArbor tools" } }],
        protocolExtensions: {
          reasoning_content: "provider-private continuation field",
        },
      },
    },
    completedResponse("model-request-final", { summary: "Final answer with continuation." }),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
    },
    createValidModelRequest()
  );

  const assistantMessage = channel.requests[1]?.sanitizedMessages.at(-2);
  assert.equal(result.stoppedReason, "completed");
  assert.equal(assistantMessage?.role, "assistant");
  assert.deepEqual(assistantMessage?.protocolExtensions, {
    reasoning_content: "provider-private continuation field",
  });
  assert.deepEqual(assistantMessage?.toolCalls, [
    { callId: "call-search", toolName: "web_search", input: { query: "AgentArbor tools" } },
  ]);
});

test("executeToolUseLoop does not inject iteration warning near round limits", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer after tool round." }),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxToolRounds: 1,
      allowedTools: ["web_search"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(channel.requests[1]?.sanitizedMessages.at(-1)?.ref, undefined);
});

test("executeToolUseLoop truncates verbose tool messages before model continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "read"),
    completedResponse("model-request-final", { summary: "Final answer after truncation." }),
  ]);
  const center = new TestToolBroker();
  center.register("read", async () => Object.fromEntries(
    Array.from({ length: 16 }, (_, fieldIndex) => [
      `field${fieldIndex}`,
      Array.from({ length: 8 }, (_, itemIndex) => `${fieldIndex}-${itemIndex}-` + Array.from({ length: 700 }, (__, index) => String(index % 10)).join("")),
    ])
  ));

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read"],
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.content.includes("tool message truncated"), true);
  assert.ok(toolMessage?.content.length !== undefined && toolMessage.content.length < 41_000);
});

test("executeToolUseLoop keeps verbose tool output out of EventLog and redacts tool messages", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read"),
    completedResponse("model-request-final", { summary: "Final answer with redacted tool result." }),
  ]);
  const center = new TestToolBroker();
  center.register("read", async () => ({
    action: "read",
    ref: "https://example.test/secret",
    status: "completed",
    result: {
      refId: "research:page:secret",
      source: "page",
      title: "Secret page",
      status: "completed",
      summary: "Short page summary with sk-event-secret-token and Bearer event-token-value.",
      contentPreview: "Complete page body must not enter EventLog. sk-preview-secret-token",
      truncated: false,
    },
    trace: {
      traceId: "research-trace-secret",
      action: "read",
      ref: "https://example.test/secret",
      requestedSources: ["page"],
      status: "completed",
      startedAt: "2026-05-04T00:00:00.000Z",
      completedAt: "2026-05-04T00:00:00.001Z",
      sourceSteps: [{ source: "page", status: "completed", resultRefs: ["research:page:secret"] }],
    },
  }));

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read"],
      publishToolEvent: (message) => {
        eventLog.append(message);
      },
    },
    createValidModelRequest()
  );

  const completedPayloadText = JSON.stringify(eventLog.list().at(-1)?.message.payload);
  const toolMessage = channel.requests[1]?.sanitizedMessages.at(-1);
  const toolMessageText = JSON.stringify(toolMessage);

  assert.equal(completedPayloadText.includes("contentPreview"), false);
  assert.equal(completedPayloadText.includes("Complete page body must not enter EventLog"), false);
  assert.equal(completedPayloadText.includes("sk-event-secret-token"), false);
  assert.equal(completedPayloadText.includes("Bearer event-token-value"), false);
  assert.equal(completedPayloadText.includes("research:page:secret"), true);
  assert.equal(completedPayloadText.includes("verboseOutputOmitted"), true);
  assert.equal(toolMessage?.role, "tool");
  assert.equal(toolMessageText.includes("sk-preview-secret-token"), false);
  assert.equal(toolMessageText.includes("Bearer event-token-value"), false);
  assert.equal(toolMessageText.includes("[redacted-secret]"), true);
  assert.equal(toolMessageText.includes("contentPreview"), true);
});

test("executeToolUseLoop uses projected agentContent for model tool continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read"),
    completedResponse("model-request-final", { summary: "Final answer with projected tool result." }),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [
      {
        name: "read",
        description: "Projected read tool.",
        metadata: {
          category: "research",
          riskLevel: "low",
          operationType: "read-only",
          requiresConfirmation: false,
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 800,
            omitRawOutput: true,
          },
        },
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "read",
    execute: async (request) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { raw: "raw-secret-output sk-raw-tool-secret" },
      status: "completed",
      durationMs: 1,
      projection: {
        agentContent: { summary: "projected model-safe content" },
        uiSummary: "safe UI summary",
        diagnosticRef: "tool:projected",
        envelope: {
          agentSummary: "envelope model-safe summary",
          evidenceRefs: ["tool:projected"],
          tokenEstimate: 8,
          truncated: false,
          redacted: true,
          diagnosticRef: "tool:projected",
          rawRetention: "diagnostic_ref_only",
        },
        truncated: false,
        redacted: true,
      },
    }),
    resetCallCount: () => undefined,
    getCallCount: () => 1,
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: broker,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read"],
    },
    createValidModelRequest()
  );

  const toolMessageText = JSON.stringify(channel.requests[1]?.sanitizedMessages.at(-1));
  assert.equal(toolMessageText.includes("envelope model-safe summary"), true);
  assert.equal(toolMessageText.includes("projected model-safe content"), false);
  assert.equal(toolMessageText.includes("raw-secret-output"), false);
  assert.equal(toolMessageText.includes("sk-raw-tool-secret"), false);
});

test("executeToolUseLoop returns a cancelled response when aborted before a model request", async () => {
  const abort = new AbortController();
  abort.abort();
  const channel = new SequenceIntelligenceChannel([completedResponse("unused", { summary: "unused" })]);
  const center = new TestToolBroker();

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      abortSignal: abort.signal,
    },
    createValidModelRequest()
  );

  assert.equal(result.finalOutput.status, "failed");
  assert.equal(result.stoppedReason, "cancelled");
  assert.equal(result.finalOutput.validation.issues[0]?.code, "cancelled");
  assert.equal(channel.requests.length, 0);
});

test("executeToolUseLoop executes explicitly read-only tool calls in parallel", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-a", toolName: "read_a", input: {} },
        { callId: "call-b", toolName: "read_b", input: {} },
      ],
      finishReason: "tool_call",
    },
    completedResponse("model-request-final", { summary: "Final answer." }),
  ]);
  const center = new TestToolBroker();
  let active = 0;
  let maxActive = 0;
  const execute = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { ok: true };
  };
  center.register("read_a", execute, "read-only");
  center.register("read_b", execute, "read-only");

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_a", "read_b"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.toolCalls.length, 2);
  assert.equal(maxActive, 2);
});

test("executeToolUseLoop keeps read-only URL confirmations on the approval pause path", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-local-url", toolName: "read", input: { url: "http://localhost:3000/debug" } },
        { callId: "call-read-file", toolName: "read_file", input: { path: "README.md" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer after approved local read."),
  ]);
  const center = new TestToolBroker();
  const order: string[] = [];
  center.register("read", async () => {
    order.push("read");
    return { ok: true };
  }, "read-only");
  center.register("read_file", async () => {
    order.push("read_file");
    return { ok: true };
  }, "read-only");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read", "read_file"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.confirmationId, "confirmation-call-local-url");
  assert.equal(paused.pendingApproval?.remainingToolCallsAfterApproval.length, 1);
  assert.deepEqual(order, []);

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read", "read_file"],
      approvedConfirmationIds: ["confirmation-call-local-url"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.deepEqual(order, ["read", "read_file"]);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
});

test("executeToolUseLoop executes non-read-only tool batches sequentially in model order", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-edit-1", toolName: "edit_file", input: { path: "a.txt" } },
        { callId: "call-edit-2", toolName: "edit_file", input: { path: "a.txt" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer."),
  ]);
  const center = new TestToolBroker();
  const order: string[] = [];
  center.register("edit_file", async (input) => {
    order.push(String((input as { readonly path?: string }).path ?? "missing"));
    return { ok: true };
  }, "read-write");

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["edit_file"],
      approvedConfirmationIds: ["confirmation-call-edit-1", "confirmation-call-edit-2"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.deepEqual(order, ["a.txt", "a.txt"]);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
});

test("executeToolUseLoop pauses on approval_required without final synthesis", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    completedResponse("model-request-final", { summary: "must not be requested before approval" }),
  ]);
  const center = new TestToolBroker();
  center.register("write_file", async () => ({ ok: true }), "read-write");

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "approval_required");
  assert.equal(result.pendingApproval?.confirmationId, "confirmation-call-write");
  assert.equal(result.toolCalls[0]?.status, "approval_required");
  assert.equal(center.getCallCount(), 0);
  assert.equal(channel.requests.length, 1);
  assert.deepEqual(eventLog.types(), ["tool.requested", "user_approval.requested"]);
});

test("resumeToolUseLoopFromApproval executes only a matching approved confirmation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    completedResponse("model-request-final", { summary: "Final answer after approved write." }),
  ]);
  const center = new TestToolBroker();
  center.register("write_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
    },
    request
  );

  assert.notEqual(paused.pendingApproval, undefined);
  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      approvedConfirmationIds: ["confirmation-call-write"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.toolCalls.some((call) => call.status === "approval_required"), false);
  assert.equal(resumed.toolCalls[0]?.status, "completed");
  assert.equal(center.getCallCount(), 1);
  assert.equal(channel.requests.length, 2);
});

test("resumeToolUseLoopFromApproval continues the remaining tool calls in the same batch", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-shell", toolName: "shell_command", input: { command: "echo" } },
        { callId: "call-read", toolName: "read_file", input: { path: "README.md" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer after batch."),
  ]);
  const center = new TestToolBroker();
  const order: string[] = [];
  center.register("shell_command", async () => {
    order.push("shell_command");
    return { ok: true };
  }, "execute");
  center.register("read_file", async () => {
    order.push("read_file");
    return { ok: true };
  }, "read-only");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command", "read_file"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.remainingToolCallsAfterApproval.length, 1);
  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command", "read_file"],
      approvedConfirmationIds: ["confirmation-call-shell"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.deepEqual(order, ["shell_command", "read_file"]);
  assert.equal(resumed.toolCalls.length, 2);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
});

test("resumeToolUseLoopFromApproval rejects the wrong confirmation id without executing", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    completedResponse("model-request-final", { summary: "must not be requested" }),
  ]);
  const center = new TestToolBroker();
  center.register("write_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
    },
    request
  );

  assert.notEqual(paused.pendingApproval?.confirmationRequest, undefined);
  const richPendingApproval = {
    ...paused.pendingApproval!,
    confirmationRequest: {
      ...paused.pendingApproval!.confirmationRequest!,
      title: "写入文件",
      actionSummary: "写入文件：src/app.ts",
      affectedResources: ["src/app.ts"],
    },
  };

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      approvedConfirmationIds: ["confirmation-other"],
    },
    request,
    richPendingApproval
  );

  assert.equal(resumed.stoppedReason, "approval_required");
  const confirmation = resumed.toolCalls.find((call) => call.status === "approval_required")?.confirmationRequest;
  assert.equal(confirmation?.title, "写入文件");
  assert.equal(confirmation?.actionSummary, "写入文件：src/app.ts");
  assert.deepEqual(confirmation?.affectedResources, ["src/app.ts"]);
  assert.equal(center.getCallCount(), 0);
  assert.equal(channel.requests.length, 1);
});

test("resumeToolUseLoopFromApproval requires the matching confirmation before continuing", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    textResponse("model-request-final", "Final answer after approved write."),
  ]);
  const center = new TestToolBroker();
  center.register("write_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  const wrong = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      approvedConfirmationIds: ["confirmation-other"],
    },
    request,
    paused.pendingApproval!
  );
  assert.equal(wrong.stoppedReason, "approval_required");
  assert.equal(center.getCallCount(), 0);

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      approvedConfirmationIds: ["confirmation-call-write"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.finalOutput.textOutput, "Final answer after approved write.");
  assert.equal(center.getCallCount(), 1);
});

test("resumeToolUseLoopFromConfirmationDecision returns denial as model-visible tool feedback", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    textResponse("model-request-final", "我不会执行写入，改为说明可选方案。"),
  ]);
  const center = new TestToolBroker();
  center.register("write_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    request
  );

  const resumed = await resumeToolUseLoopFromConfirmationDecision(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["write_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    request,
    paused.pendingApproval!,
    { confirmationId: "confirmation-call-write", decision: "deny" }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.finalOutput.textOutput, "我不会执行写入，改为说明可选方案。");
  assert.equal(center.getCallCount(), 0);
  assert.equal(resumed.toolCalls.at(-1)?.status, "cancelled");
  assert.equal(channel.requests.length, 2);
  const toolMessage = channel.requests[1]?.sanitizedMessages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  assert.equal(toolMessage?.content.includes("用户拒绝了本次工具执行"), true);
  assert.deepEqual(eventLog.types(), ["tool.requested", "user_approval.requested", "tool.failed"]);
});

test("resumeToolUseLoopFromConfirmationDecision returns guidance and skipped batch calls to the model", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-shell", toolName: "shell_command", input: { command: "pnpm test" } },
        { callId: "call-read", toolName: "read_file", input: { path: "README.md" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "收到指导，我会改用安全说明。"),
  ]);
  const center = new TestToolBroker();
  center.register("shell_command", async () => ({ ok: true }), "execute");
  center.register("read_file", async () => ({ ok: true }), "read-only");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command", "read_file"],
    },
    request
  );

  const resumed = await resumeToolUseLoopFromConfirmationDecision(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command", "read_file"],
    },
    request,
    paused.pendingApproval!,
    {
      confirmationId: "confirmation-call-shell",
      decision: "guidance",
      guidance: "不要执行命令，改为说明需要哪些材料。sk-guidance-secret-token",
    }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(center.getCallCount(), 0);
  assert.deepEqual(resumed.toolCalls.map((call) => call.status), ["failed", "cancelled"]);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
  const requestText = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(requestText.includes("sk-guidance-secret-token"), false);
  assert.equal(requestText.includes("[redacted-secret]"), true);
});

function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: "model-request-test",
    traceId: "trace-test",
    callerRef: { kind: "goal", id: "goal-test" },
    purpose: "rootlet_candidate",
    inputRefs: [{ kind: "goal", id: "goal-test" }],
    sanitizedMessages: [{ role: "user", content: "Build a helper.", ref: "goal-test" }],
    outputContract: {
      contractId: "test.candidate.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    requestedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
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
    outputKind: "candidate",
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
    finishReason: "stop",
  };
}

function toolCallResponse(requestId: string, callId: string, toolName: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    toolCalls: [{ callId, toolName, input: { query: "AgentArbor tools" } }],
    finishReason: "tool_call",
  };
}

class SequenceIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(readonly responses: readonly ModelResponse[]) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.responses[this.requests.length - 1] ?? this.responses.at(-1)!;
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

class TestToolBroker implements ToolExecutionBroker {
  private readonly tools = new Map<string, (input: unknown, context: ToolExecutionContext) => Promise<unknown>>();
  private readonly operationTypes = new Map<string, "read-only" | "read-write" | "execute" | "external-submit">();
  private callCount = 0;

  register(
    name: string,
    execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>,
    operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only"
  ): void {
    this.tools.set(name, execute);
    this.operationTypes.set(name, operationType);
  }

  list(): ToolDefinition[] {
    return [...this.tools.keys()].map((name) => ({
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: this.operationTypes.get(name) === "read-only" ? "low" : "high",
        operationType: this.operationTypes.get(name) ?? "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: { type: "object", properties: {} },
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const execute = this.tools.get(request.toolName);
    if (execute === undefined) {
      return failedToolResult(request, `Tool is not registered: ${request.toolName}`);
    }
    if (permission?.allowedTools !== undefined && !permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(request, `Tool ${request.toolName} is not allowed.`);
    }
    const operationType = this.operationTypes.get(request.toolName) ?? "read-only";
    const confirmationId = `confirmation-${request.callId}`;
    if (privateUrlFromInput(request.input) !== undefined && permission?.approvedConfirmationIds?.includes(confirmationId) !== true) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "approval_required",
        error: `Tool ${request.toolName} requires approval for local URL access.`,
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          runId: request.callId,
          title: "需要确认内部网络访问",
          actionSummary: `工具 ${request.toolName} 需要确认后才能读取本机或内网地址。`,
          affectedResources: [],
          riskLevel: "medium",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    }
    if (operationType !== "read-only" && permission?.approvedConfirmationIds?.includes(confirmationId) !== true) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "approval_required",
        error: `Tool ${request.toolName} requires approval.`,
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          runId: request.callId,
          title: "需要确认",
          actionSummary: `工具 ${request.toolName} 需要确认。`,
          affectedResources: [],
          riskLevel: "high",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    }
    this.callCount += 1;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: await execute(request.input, context),
      status: "completed",
      durationMs: 1,
    };
  }

  resetCallCount(): void {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

function privateUrlFromInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const url = (input as Readonly<Record<string, unknown>>).url;
  if (typeof url !== "string") {
    return undefined;
  }
  return /^https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/i.test(url)
    ? url
    : undefined;
}

function failedToolResult(request: ToolCallRequest, error: string): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "failed",
    error,
    durationMs: 0,
  };
}
