import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolExecutor,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import {
  normalizeToolFactValue,
  toolModelAttachmentsFromOutput,
  withToolModelAttachments,
} from "../../domain/tools/index.js";
import { InMemoryEventLog } from "../events/in-memory-event-log.js";
import { nowIso } from "../id.js";
import { pendingModelOutputValidation } from "./validation.js";
import {
  executeToolUseLoop,
  resumeToolUseLoopFromApproval,
  resumeToolUseLoopFromConfirmationDecision,
  type ToolUseLoopOptions,
} from "./tool-use-loop.js";
import { executeToolCalls } from "./tool-use-loop-execution.js";
import {
  toolResultMessage,
  toolResultMessages,
  toolResultMessagesWithResolvedApprovals,
} from "./tool-use-loop-messages.js";

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
      allowedTools: [],
      maxModelRounds: 4,
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.equal(result.finalOutput.textOutput, "Final answer chosen by the agent.");
  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.tools?.some((tool) => tool.name === "finish_task"), false);
});

test("executeToolUseLoop exposes only allowed registered tools to the model", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-text", "Final answer with filtered tool catalog."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));
  center.register("read_file", async () => ({ ok: true }));
  center.register("delete_file", async () => ({ ok: true }), "read-write");

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

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["web_search"]);
  assert.equal(center.executionCount(), 0);
});

test("executeToolUseLoop uses frozen tool definitions instead of current broker definitions", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-text", "Final answer with frozen tool contract."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));
  const frozenTool: ToolDefinition = {
    name: "web_search",
    description: "Frozen web search contract from the run capability snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Frozen query text." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    modelContract: {
      purpose: "Use the frozen web search contract.",
      whenToUse: ["Use for frozen search tests."],
      inputNotes: ["query: frozen query text."],
      outputNotes: ["Returns frozen search results."],
      runtimeHints: [{ label: "source", value: "capability_snapshot" }],
      examples: [{ input: { query: "AgentArbor" } }],
    },
    metadata: {
      category: "research",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      toolDefinitions: [frozenTool],
    },
    createValidModelRequest()
  );

  const visibleTool = channel.requests[0]?.tools?.[0];
  assert.equal(visibleTool?.description, "Frozen web search contract from the run capability snapshot.");
  assert.deepEqual(visibleTool?.inputSchema.required, ["query"]);
  assert.equal(visibleTool?.modelContract?.runtimeHints?.[0]?.value, "capability_snapshot");
});

test("executeToolUseLoop passes tools through request schema without mutating prompt messages", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-text", "Final answer with structured tools."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ ok: true }));
  center.register("read_file", async () => ({ ok: true }));
  const request = createValidModelRequest({
    sanitizedMessages: [
      { role: "system", content: "Follow the ordinary agent contract.", ref: "system:test" },
      { role: "user", content: "Use the available runtime safely.", ref: "goal-test" },
    ],
  });

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search", "read_file"],
    },
    request
  );

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["web_search", "read_file"]);
  assert.deepEqual(
    channel.requests[0]?.sanitizedMessages.map((message) => ({
      role: message.role,
      content: message.content,
      ref: message.ref,
    })),
    request.sanitizedMessages.map((message) => ({
      role: message.role,
      content: message.content,
      ref: message.ref,
    }))
  );
  assert.equal(JSON.stringify(channel.requests[0]?.sanitizedMessages).includes("web_search"), false);
  assert.equal(JSON.stringify(channel.requests[0]?.sanitizedMessages).includes("read_file"), false);
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
      allowedTools: ["web_search", "finish_task"],
      blockedToolNames: ["finish_task"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["web_search"]);
});

test("executeToolUseLoop rejects blocked internal tool calls before broker execution", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-finish", "finish_task"),
    textResponse("model-request-final", "Final answer after blocked internal tool."),
  ]);
  const center = new PermissionIgnoringToolBroker();
  center.register("finish_task", async () => ({ ok: true }));

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      maxModelRounds: 4,
      allowedTools: ["finish_task"],
      blockedToolNames: ["finish_task"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.match(result.toolCalls[0]?.error ?? "", /当前不可用/);
  assert.equal(center.executionCount(), 0);
  assert.deepEqual(channel.requests[1]?.tools?.map((tool) => tool.name), []);
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
  assert.equal(center.executionCount(), 1);
});

test("executeToolUseLoop preserves user message attachments across tool rounds", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    textResponse("model-request-final", "Final answer after inspecting image and tool result."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => ({ results: [{ title: "A" }] }));
  const request = createValidModelRequest({
    sanitizedMessages: [{
      role: "user",
      content: "Describe the screenshot and search for related context.",
      attachments: [{
        kind: "image",
        attachmentId: "ctx-screenshot",
        inputRef: "local-file:C:/tmp/screenshot.png",
        source: { kind: "data", mimeType: "image/png", data: "aW1hZ2U=" },
        filename: "screenshot.png",
        detail: "auto",
        byteLength: 5,
      }],
      ref: "goal-test",
    }],
  });

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
    request
  );

  const firstUser = channel.requests[0]?.sanitizedMessages.find((message) => message.role === "user");
  const secondUser = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "user");
  assert.equal(result.stoppedReason, "completed");
  assert.equal(firstUser?.attachments?.[0]?.attachmentId, "ctx-screenshot");
  assert.equal(secondUser?.attachments?.[0]?.attachmentId, "ctx-screenshot");
  assert.equal(secondUser?.attachments?.[0]?.source.kind, "data");
  assert.equal(JSON.stringify(secondUser).includes("aW1hZ2U="), true);
});

test("executeToolUseLoop carries model attachments from the execution output", async () => {
  const attachmentData = "aW1hZ2UtYnl0ZXM=";
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read-image", "read_context_attachment_image"),
    textResponse("model-request-final", "Final answer after inspecting tool-provided image."),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [
      {
        name: "read_context_attachment_image",
        description: "Projected image read tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "read_context_attachment_image",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: withToolModelAttachments({
        attachmentId: "ctx-image",
        modelInput: { attached: true, detail: "auto" },
      }, [{
        kind: "image",
        attachmentId: "ctx-image",
        inputRef: "local-file:C:/secret/screenshot.png",
        filename: "screenshot.png",
        detail: "auto",
        byteLength: 11,
        source: { kind: "data", mimeType: "image/png", data: attachmentData },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: broker,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_context_attachment_image"],
    },
    createValidModelRequest()
  );

  const messages = channel.requests[1]?.sanitizedMessages ?? [];
  const toolMessageIndex = messages.findIndex((message) => message.role === "tool");
  const toolMessage = messages[toolMessageIndex];

  assert.ok(toolMessageIndex >= 0);
  assert.equal(toolMessage?.content.includes("ctx-image"), true);
  assert.equal(toolMessage?.content.includes(attachmentData), false);
  assert.equal(toolMessage?.attachments?.[0]?.kind, "image");
  assert.equal(toolMessage?.attachments?.[0]?.attachmentId, "ctx-image");
  assert.equal(toolMessage?.attachments?.[0]?.source.kind, "data");
  if (toolMessage?.attachments?.[0]?.source.kind === "data") {
    assert.equal(toolMessage.attachments[0].source.mimeType, "image/png");
    assert.equal(toolMessage.attachments[0].source.data, attachmentData);
  }
});

test("executeToolUseLoop returns tool execution failures as model-visible observations", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    textResponse("model-request-final", "Final answer after observing tool failure."),
  ]);
  const center = new TestToolBroker();
  center.register("web_search", async () => {
    throw new Error("fixture backend unavailable");
  });

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["web_search"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.at(-1);
  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.failed"]);
  assert.equal(toolMessage?.role, "tool");
  assert.equal(toolMessage?.toolCallId, "call-search");
  assert.match(toolMessage?.content ?? "", /"status":"failed"/);
  assert.match(toolMessage?.content ?? "", /fixture backend unavailable/);
  assert.equal(center.executionCount(), 1);
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
      allowedTools: [],
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
  assert.equal(center.executionCount(), 0);
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
      allowedTools: ["web_search"],
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

test("executeToolUseLoop rejects unauthorized tool calls before broker execution", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-denied", "web_search"),
    completedResponse("model-request-final", { summary: "Fallback after tool failure." }),
  ]);
  const center = new PermissionIgnoringToolBroker();
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
  assert.match(result.toolCalls[0]?.error ?? "", /未授权/);
  assert.equal(center.executionCount(), 0);
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

test("executeToolUseLoop keeps transport-truncated tool messages recoverable with refs", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "shell_command"),
    completedResponse("model-request-final", { summary: "Final answer after truncation." }),
  ]);
  const verboseText = Array.from({ length: 240_000 }, (_, index) => String(index % 10)).join("");
  const center: ToolExecutionBroker = {
    list: () => [
      {
        name: "shell_command",
        description: "Verbose command tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "shell_command",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        command: "verbose-command",
        exitCode: 0,
        stdout: verboseText,
        logRef: "command-log://tool-loop-verbose-output",
        continuation: {
          ref: "command-log://tool-loop-verbose-output",
          nextInput: { ref: "command-log://tool-loop-verbose-output", maxLength: 30_000 },
        },
      },
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly body?: {
      readonly format?: string;
      readonly value?: {
        readonly truncated?: boolean;
        readonly reason?: string;
        readonly continuation?: {
          readonly nextInput?: {
            readonly ref?: string;
            readonly maxLength?: number;
          };
        };
      };
    };
  };
  assert.equal(parsed.body?.format, "json");
  assert.equal(parsed.body?.value?.truncated, true);
  assert.equal(parsed.body?.value?.reason, "tool_message_transport_budget_exceeded");
  assert.equal(parsed.body?.value?.continuation?.nextInput?.ref, "command-log://tool-loop-verbose-output");
  assert.equal(parsed.body?.value?.continuation?.nextInput?.maxLength, 30_000);
  assert.ok(toolMessage?.content.length !== undefined && toolMessage.content.length < 221_000);
});

test("executeToolUseLoop bounds sub-agent output and keeps explicit continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "call_sub_agent"),
    completedResponse("model-request-final", { summary: "Final answer after sub-agent result." }),
  ]);
  const tail = "SUB_AGENT_LONG_OUTPUT_TAIL";
  const continuation = {
    ref: "sub-agent-output:sub-agent-run-budget",
    nextInput: { sub_run_id: "sub-agent-run-budget", start_char: 0, max_chars: 100_000 },
  };
  const fullOutput = `${Array.from({ length: 240_000 }, (_, index) => String(index % 10)).join("")}${tail}`;
  const center: ToolExecutionBroker = {
    list: () => [
      {
        name: "call_sub_agent",
        description: "Projected sub-agent tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "call_sub_agent",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { full_output: fullOutput, continuation },
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["call_sub_agent"],
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly body?: { readonly value?: { readonly continuation?: { readonly ref?: string } } };
  };
  assert.equal(toolMessage?.content.includes(tail), false);
  assert.equal(parsed.body?.value?.continuation?.ref, "sub-agent-output:sub-agent-run-budget");
  assert.ok(toolMessage?.content.length !== undefined && toolMessage.content.length < 221_000);
});

test("executeToolUseLoop keeps oversized sub-agent output recoverable with continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "call_sub_agent"),
    completedResponse("model-request-final", { summary: "Final answer after sub-agent continuation." }),
  ]);
  const subRunId = "sub-agent-run-long";
  const continuation = {
    ref: `sub-agent-output:${subRunId}`,
    nextInput: {
      sub_run_id: subRunId,
      start_char: 0,
      max_chars: 100_000,
    },
    note: "Use read_sub_agent_output with nextInput to inspect more.",
  };
  const fullOutput = Array.from({ length: 1_050_000 }, (_, index) => String(index % 10)).join("");
  const center: ToolExecutionBroker = {
    list: () => [
      {
        name: "call_sub_agent",
        description: "Projected sub-agent tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "call_sub_agent",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { full_output: fullOutput, continuation },
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["call_sub_agent"],
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly body?: {
      readonly value?: {
        readonly truncated?: boolean;
        readonly reason?: string;
        readonly continuation?: {
          readonly nextInput?: {
            readonly sub_run_id?: string;
            readonly start_char?: number;
            readonly max_chars?: number;
          };
        };
      };
    };
  };
  assert.equal(parsed.body?.value?.truncated, true);
  assert.equal(parsed.body?.value?.reason, "tool_message_transport_budget_exceeded");
  assert.equal(parsed.body?.value?.continuation?.nextInput?.sub_run_id, subRunId);
  assert.equal(parsed.body?.value?.continuation?.nextInput?.start_char, 0);
  assert.equal(parsed.body?.value?.continuation?.nextInput?.max_chars, 100_000);
  assert.ok(toolMessage?.content.length !== undefined && toolMessage.content.length < 221_000);
});

test("executeToolUseLoop keeps oversized batch sub-agent outputs recoverable with every continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "call_sub_agents"),
    completedResponse("model-request-final", { summary: "Final answer after batch sub-agent continuations." }),
  ]);
  const firstContinuation = {
    ref: "sub-agent-output:batch-sub-run-first",
    nextInput: {
      sub_run_id: "batch-sub-run-first",
      start_char: 0,
      max_chars: 100_000,
    },
    note: "Read first batch output.",
  };
  const secondContinuation = {
    ref: "sub-agent-output:batch-sub-run-second",
    nextInput: {
      sub_run_id: "batch-sub-run-second",
      start_char: 0,
      max_chars: 100_000,
    },
    note: "Read second batch output.",
  };
  const firstOutput = "a".repeat(610_000);
  const secondOutput = "b".repeat(610_000);
  const center: ToolExecutionBroker = {
    list: () => [
      {
        name: "call_sub_agents",
        description: "Projected batch sub-agent tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "call_sub_agents",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        results: [
          { full_output: firstOutput },
          { full_output: secondOutput },
        ],
        continuations: [firstContinuation, secondContinuation],
      },
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["call_sub_agents"],
    },
    createValidModelRequest()
  );

  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) => message.role === "tool");
  const parsed = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly body?: {
      readonly value?: {
        readonly truncated?: boolean;
        readonly reason?: string;
        readonly continuations?: readonly {
          readonly nextInput?: { readonly sub_run_id?: string };
        }[];
      };
    };
  };
  const structuredContinuations = parsed.body?.value?.continuations ?? [];
  assert.equal(parsed.body?.value?.truncated, true);
  assert.equal(parsed.body?.value?.reason, "tool_message_transport_budget_exceeded");
  assert.deepEqual(
    structuredContinuations.map((continuation) => continuation.nextInput?.sub_run_id),
    ["batch-sub-run-first", "batch-sub-run-second"]
  );
  assert.ok(toolMessage?.content.length !== undefined && toolMessage.content.length < 221_000);
});

test("executeToolUseLoop preserves the same read fact for event and model consumers", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read"),
    completedResponse("model-request-final", { summary: "Final answer with tool result." }),
  ]);
  const center = new TestToolBroker();
  center.register("read", async () => ({
    ref: "https://example.test/secret",
    researchStatus: "completed",
    refId: "research:page:secret",
    source: "page",
    title: "Secret page",
    contentPreview: "Complete page body must not enter EventLog. sk-preview-secret-token",
    truncated: false,
    traceId: "research-trace-secret",
    requestedSources: ["page"],
    startedAt: "2026-05-04T00:00:00.000Z",
    completedAt: "2026-05-04T00:00:00.001Z",
    sourceSteps: [{ source: "page", status: "completed", resultRefs: ["research:page:secret"] }],
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

  const toolMessage = channel.requests[1]?.sanitizedMessages.at(-1);

  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.completed"]);
  assert.equal(toolMessage?.role, "tool");
});

test("executeToolUseLoop derives model continuation from execution facts", async () => {
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
        },
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "read",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        refId: "research:page:raw",
        source: "page",
        contentPreview: "raw-secret-output sk-raw-tool-secret",
      },
      status: "completed",
      durationMs: 1,
    }),
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
  assert.equal(toolMessageText.includes("raw-secret-output"), true);
  assert.equal(toolMessageText.includes("sk-raw-tool-secret"), true);
});

test("executeToolUseLoop preserves command stdout and stderr from execution facts", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-shell", "shell_command"),
    completedResponse("model-request-final", { summary: "Final answer with command output." }),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [
      {
        name: "shell_command",
        description: "Projected shell tool.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    has: (name) => name === "shell_command",
    execute: async (request, _context, _permission) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        command: "print-secret",
        exitCode: 1,
        stdout: "stdout token=sk-loop-token password=hunter2",
        stderr: "stderr Bearer sk-loop-error api_key=abc123",
      },
      status: "completed",
      durationMs: 1,
    }),
  };

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: broker,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
    },
    createValidModelRequest()
  );

  const toolMessageText = JSON.stringify(channel.requests[1]?.sanitizedMessages.at(-1));
  assert.equal(toolMessageText.includes("stdout token=sk-loop-token password=hunter2"), true);
  assert.equal(toolMessageText.includes("stderr Bearer sk-loop-error api_key=abc123"), true);
  assert.equal(toolMessageText.includes("Short UI summary"), false);
  assert.equal(toolMessageText.includes("[redacted"), false);
});

test("executeToolUseLoop preserves tool failure errors before model continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read"),
    textResponse("model-request-final", "Final answer after tool failure."),
  ]);
  const center = new TestToolBroker();
  center.register("read", async () => {
    throw new Error("read failed with raw stderr api_key=sk-tool-error-secret-123456");
  });

  const result = await executeToolUseLoop(
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

  const toolMessageText = JSON.stringify(channel.requests[1]?.sanitizedMessages.at(-1));
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.equal(toolMessageText.includes("read failed with raw stderr"), true);
  assert.equal(toolMessageText.includes("sk-tool-error-secret"), true);
  assert.equal(toolMessageText.includes("[redacted-secret]"), false);
});

test("executeToolUseLoop sends full workspace tool facts to the next model turn", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-read-file", toolName: "read_file", input: { path: "README.md" } },
        { callId: "call-grep", toolName: "grep_files", input: { query: "AgentArbor" } },
        { callId: "call-command", toolName: "shell_command", input: { command: "pnpm", args: ["test"] } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer with tool facts."),
  ]);
  const center = new ExecutionFactToolBroker({
    read_file: {
      path: "README.md",
      bytes: 42,
      content: "# AgentArbor\nA local desktop agent workspace.",
      truncated: false,
    },
    grep_files: {
      query: "AgentArbor",
      path: ".",
      matches: [{ path: "README.md", line: 1, preview: "# AgentArbor" }],
      truncated: false,
    },
    shell_command: {
      command: "pnpm",
      args: ["test"],
      exitCode: 0,
      stdout: "tests 828\npass 828\n",
      stderr: "",
      truncated: false,
    },
  });

  await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_file", "grep_files", "shell_command"],
      approvedConfirmationIds: ["confirmation-call-command"],
    },
    createValidModelRequest()
  );

  const nextModelRequestText = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(nextModelRequestText.includes("A local desktop agent workspace."), true);
  assert.equal(nextModelRequestText.includes("# AgentArbor"), true);
  assert.equal(nextModelRequestText.includes("tests 828"), true);
  assert.equal(nextModelRequestText.includes("exitCode"), true);
});


test("executeToolUseLoop fails instead of completing on incomplete final model finish reasons", async () => {
  for (const finishReason of ["length", "content_filter", "error"] as const) {
    const channel = new SequenceIntelligenceChannel([
      {
        ...textResponse(`model-request-${finishReason}`, "Incomplete final answer."),
        finishReason,
      },
    ]);
    const result = await executeToolUseLoop(
      {
        intelligenceChannel: channel,
        toolCenter: new TestToolBroker(),
        callerAgentId: "agent-test",
        traceId: "trace-test",
        goalId: "goal-test",
        allowedTools: [],
      },
      createValidModelRequest()
    );

    assert.equal(result.stoppedReason, "error");
    assert.equal(result.finalOutput.status, "failed");
    assert.equal(result.finalOutput.failure?.kind, "provider_response");
  }
});

test("executeToolUseLoop fails instead of completing on failed model responses", async () => {
  const channel = new SequenceIntelligenceChannel([
    failedResponse("model-request-failed", "Provider returned an error response."),
  ]);

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: new TestToolBroker(),
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: [],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "error");
  assert.equal(result.finalOutput.status, "failed");
  assert.equal(result.finalOutput.failure?.kind, "provider_response");
  assert.equal(result.toolCalls.length, 0);
  assert.equal(channel.requests.length, 1);
});

test("executeToolUseLoop returns continuation context after completed tools then model failure", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search-context", "web_search"),
    failedResponse("model-request-failed", "other side closed"),
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
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "error");
  assert.equal(result.finalOutput.status, "failed");
  assert.equal(result.contextMessages?.some((message) =>
    message.role === "assistant" && message.toolCalls?.[0]?.callId === "call-search-context"
  ), true);
  assert.equal(result.contextMessages?.some((message) =>
    message.role === "tool" && message.toolCallId === "call-search-context"
  ), true);
  assert.equal(result.contextMessages?.some((message) => message.ref === "model-request-failed-response"), false);
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
      allowedTools: [],
      abortSignal: abort.signal,
    },
    createValidModelRequest()
  );

  assert.equal(result.finalOutput.status, "failed");
  assert.equal(result.stoppedReason, "cancelled");
  assert.equal(result.finalOutput.validation.issues[0]?.code, "cancelled");
  assert.equal(channel.requests.length, 0);
});

test("executeToolCalls emits a complete lifecycle for serial calls skipped after abort", async () => {
  const abort = new AbortController();
  const executedCallIds: string[] = [];
  const eventLog = new InMemoryEventLog();
  const requests: readonly ToolCallRequest[] = [
    { callId: "call-first", toolName: "serial_first", input: {} },
    { callId: "call-second", toolName: "serial_second", input: {} },
    { callId: "call-third", toolName: "serial_third", input: {} },
  ];
  const definitions: readonly ToolDefinition[] = requests.map((request) =>
    testToolDefinition(request.toolName, "execute")
  );
  const center: ToolExecutionBroker = {
    list: () => [...definitions],
    has: (name) => definitions.some((definition) => definition.name === name),
    execute: async (request) => {
      executedCallIds.push(request.callId);
      abort.abort();
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: normalizeToolFactValue({ completed: true }),
        status: "completed",
        durationMs: 1,
      };
    },
  };

  const result = await executeToolCalls({
    options: {
      intelligenceChannel: new SequenceIntelligenceChannel([]),
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: definitions.map((definition) => definition.name),
      abortSignal: abort.signal,
      publishToolEvent: (message) => eventLog.append(message),
    },
    requests,
    toolDefinitions: definitions,
  });

  assert.deepEqual(executedCallIds, ["call-first"]);
  assert.deepEqual(result.results.map((toolResult) => toolResult.status), [
    "completed",
    "cancelled",
    "cancelled",
  ]);
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "tool.completed",
    "tool.requested",
    "tool.cancelled",
    "tool.requested",
    "tool.cancelled",
  ]);
  assert.deepEqual(
    eventLog.list().map((entry) => (entry.message.payload as { readonly callId: string }).callId),
    ["call-first", "call-first", "call-second", "call-second", "call-third", "call-third"],
  );
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

test("executeToolUseLoop pauses when a parallel read-only executor dynamically requires approval", async () => {
  const channel = new SequenceIntelligenceChannel([{
    ...completedResponse("model-request-test", undefined),
    toolCalls: [
      { callId: "call-read-ready", toolName: "read_ready", input: {} },
      { callId: "call-read-gated", toolName: "read_gated", input: {} },
    ],
    finishReason: "tool_call",
  }, completedResponse("model-request-final", { summary: "must not run before approval" })]);
  const broker: ToolExecutionBroker = {
    list: () => [
      testToolDefinition("read_ready", "read-only"),
      testToolDefinition("read_gated", "read-only"),
    ],
    has: (name) => name === "read_ready" || name === "read_gated",
    execute: async (request) => request.toolName === "read_gated"
      ? {
          callId: request.callId,
          toolName: request.toolName,
          input: request.input,
          output: { partial: "approval discovered during read preflight" },
          status: "approval_required",
          durationMs: 1,
          confirmationRequest: {
            confirmationId: "confirmation-read-gated",
            toolCallFactId: request.factId ?? request.callId,
            title: "Confirm gated read",
            actionSummary: "Confirm access before continuing the read.",
            affectedResources: ["fixture://gated-read"],
            riskLevel: "medium",
            requestedAt: nowIso(),
            sourceRefs: [`tool:${request.callId}`],
          },
        }
      : {
          callId: request.callId,
          toolName: request.toolName,
          input: request.input,
          output: { ready: true },
          status: "completed",
          durationMs: 1,
        },
  };

  const result = await executeToolUseLoop({
    intelligenceChannel: channel,
    toolCenter: broker,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["read_ready", "read_gated"],
  }, createValidModelRequest());

  assert.equal(result.stoppedReason, "approval_required");
  assert.equal(result.pendingApproval?.confirmationId, "confirmation-read-gated");
  assert.equal(result.pendingApproval?.completedToolResults[0]?.toolName, "read_ready");
  assert.deepEqual(result.pendingApproval?.pendingToolResult.output, {
    partial: "approval discovered during read preflight",
  });
  assert.equal(channel.requests.length, 1);
});

test("executeToolUseLoop closes an approval that races with initial cancellation", async () => {
  const abort = new AbortController();
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-racing-approval", "racing_approval"),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [testToolDefinition("racing_approval", "read-only")],
    has: (name) => name === "racing_approval",
    execute: async (request) => {
      abort.abort();
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: { partialFact: "work completed before approval was discovered" },
        status: "approval_required",
        error: "The completed preflight discovered a gated follow-up.",
        errorDomain: "runtime_error",
        errorFacts: { code: "dynamic_approval_required" },
        durationMs: 1,
        confirmationRequest: {
          confirmationId: "confirmation-racing-approval",
          toolCallFactId: request.factId ?? request.callId,
          title: "Confirm follow-up",
          actionSummary: "Confirm the gated follow-up.",
          affectedResources: [],
          riskLevel: "medium",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    },
  };

  const result = await executeToolUseLoop({
    intelligenceChannel: channel,
    toolCenter: broker,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["racing_approval"],
    abortSignal: abort.signal,
    publishToolEvent: (message) => eventLog.append(message),
  }, createValidModelRequest());

  assert.equal(result.stoppedReason, "cancelled");
  assert.equal(result.pendingApproval, undefined);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.status, "cancelled");
  assert.deepEqual(result.toolCalls[0]?.output, {
    partialFact: "work completed before approval was discovered",
  });
  assert.equal(result.toolCalls[0]?.errorFacts?.code, "approval_wait_cancelled");
  const preApprovalErrorFacts = result.toolCalls[0]?.errorFacts?.preApprovalErrorFacts as
    | { readonly code?: string }
    | undefined;
  assert.equal(preApprovalErrorFacts?.code, "dynamic_approval_required");
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "user_approval.requested",
    "tool.cancelled",
  ]);
});

test("parallel read-only preflights publish requests first and never replay additional dynamic approvals", async () => {
  const eventLog = new InMemoryEventLog();
  const executionCounts = new Map<string, number>();
  const channel = new SequenceIntelligenceChannel([{
    ...completedResponse("model-request-test", undefined),
    toolCalls: [
      { callId: "call-gated-first", toolName: "read_gated_first", input: { target: "first" } },
      { callId: "call-gated-second", toolName: "read_gated_second", input: { target: "second" } },
    ],
    finishReason: "tool_call",
  }, textResponse("model-request-final", "Handled the dynamic approval facts once.")]);
  const broker: ToolExecutionBroker = {
    list: () => [
      testToolDefinition("read_gated_first", "read-only"),
      testToolDefinition("read_gated_second", "read-only"),
    ],
    has: (name) => name === "read_gated_first" || name === "read_gated_second",
    execute: async (request, _context, permission) => {
      const requestedCallIds = eventLog.list()
        .filter((entry) => entry.type === "tool.requested")
        .map((entry) => (entry.message.payload as { readonly callId?: string }).callId);
      assert.equal(requestedCallIds.includes(request.callId), true);
      executionCounts.set(request.callId, (executionCounts.get(request.callId) ?? 0) + 1);
      const confirmationId = `confirmation-${request.callId}`;
      if (permission.approvedConfirmationIds?.includes(confirmationId) === true) {
        return {
          callId: request.callId,
          toolName: request.toolName,
          input: request.input,
          output: { completedAfterApproval: request.callId },
          status: "completed",
          durationMs: 1,
        };
      }
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: { partialFact: `preflight-${request.callId}` },
        status: "approval_required",
        durationMs: 1,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: `Confirm ${request.toolName}`,
          actionSummary: `Confirm ${request.toolName}.`,
          affectedResources: [`fixture://${request.callId}`],
          riskLevel: "medium",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    },
  };
  const request = createValidModelRequest();
  const baseOptions = {
    intelligenceChannel: channel,
    toolCenter: broker,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["read_gated_first", "read_gated_second"],
    publishToolEvent: (message: Parameters<NonNullable<ToolUseLoopOptions["publishToolEvent"]>>[0]) =>
      eventLog.append(message),
  };

  const paused = await executeToolUseLoop(baseOptions, request);

  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.confirmationId, "confirmation-call-gated-first");
  assert.deepEqual([...executionCounts.entries()], [
    ["call-gated-first", 1],
    ["call-gated-second", 1],
  ]);
  const secondFact = paused.pendingApproval?.completedToolResults.find((result) =>
    result.callId === "call-gated-second"
  );
  assert.equal(secondFact?.status, "cancelled");
  assert.deepEqual(secondFact?.output, { partialFact: "preflight-call-gated-second" });
  assert.equal(secondFact?.errorFacts?.code, "parallel_approval_not_selected");
  assert.equal(secondFact?.errorFacts?.confirmationId, "confirmation-call-gated-second");
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "tool.requested",
    "user_approval.requested",
    "tool.cancelled",
  ]);
  const replayedParallelCancellation = eventLog.replay().find((message) =>
    message.type === "tool.cancelled" &&
    (message.payload as { readonly callId?: unknown }).callId === "call-gated-second"
  );
  const replayedParallelFacts = (replayedParallelCancellation?.payload as {
    readonly errorFacts?: Readonly<Record<string, unknown>>;
  } | undefined)?.errorFacts;
  assert.equal(replayedParallelFacts?.code, "parallel_approval_not_selected");
  assert.equal(replayedParallelFacts?.confirmationId, "confirmation-call-gated-second");
  assert.equal(replayedParallelFacts?.activeConfirmationId, "confirmation-call-gated-first");

  const resumed = await resumeToolUseLoopFromApproval({
    ...baseOptions,
    approvedConfirmationIds: ["confirmation-call-gated-first"],
  }, request, paused.pendingApproval!);

  assert.equal(resumed.stoppedReason, "completed");
  assert.deepEqual([...executionCounts.entries()], [
    ["call-gated-first", 2],
    ["call-gated-second", 1],
  ]);
  const resumedRequest = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(resumedRequest.includes("preflight-call-gated-second"), true);
  assert.equal(resumedRequest.includes("parallel_approval_not_selected"), true);
});

test("executeToolUseLoop does not send unauthorized read-only batch calls to the broker", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-a", toolName: "read_a", input: {} },
        { callId: "call-b", toolName: "read_b", input: {} },
      ],
      finishReason: "tool_call",
    },
    completedResponse("model-request-final", { summary: "Final answer after filtered batch." }),
  ]);
  const center = new PermissionIgnoringToolBroker();
  const executedTools: string[] = [];
  center.register("read_a", async () => {
    executedTools.push("read_a");
    return { ok: true };
  }, "read-only");
  center.register("read_b", async () => {
    executedTools.push("read_b");
    return { ok: true };
  }, "read-only");

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_a"],
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "completed");
  assert.deepEqual(result.toolCalls.map((call) => call.status), ["completed", "failed"]);
  assert.match(result.toolCalls[1]?.error ?? "", /未授权/);
  assert.deepEqual(executedTools, ["read_a"]);
  assert.equal(center.executionCount(), 1);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
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
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    completedResponse("model-request-final", { summary: "must not be requested before approval" }),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ ok: true }), "read-write");

  const result = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    createValidModelRequest()
  );

  assert.equal(result.stoppedReason, "approval_required");
  assert.equal(result.pendingApproval?.confirmationId, "confirmation-call-delete");
  assert.equal(result.toolCalls[0]?.status, "approval_required");
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 1);
  assert.deepEqual(eventLog.types(), ["tool.requested", "user_approval.requested"]);
  const approvalEvent = eventLog.list().find((entry) => entry.type === "user_approval.requested");
  assert.equal(approvalEvent?.message.from.id, "agent-test");
  assert.equal(approvalEvent?.message.from.role, "agent");
});

test("approval pauses preserve partial sub-agent output across clones and unresolved resumes", async () => {
  const attachmentData = Buffer.from("partial-sub-agent-image").toString("base64");
  const partialOutput = withToolModelAttachments(
    {
      sub_run_id: "sub-run-partial",
      summary: "The sub-agent completed its analysis before requesting confirmation.",
      continuation: {
        ref: "sub-agent-output:sub-run-partial",
        nextInput: { sub_run_id: "sub-run-partial", start_char: 0, max_chars: 100_000 },
      },
    },
    [{
      kind: "image",
      source: { kind: "data", mimeType: "image/png", data: attachmentData },
      attachmentId: "partial-image",
    }]
  );
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent", "call_sub_agent"),
    textResponse("model-request-final", "Final answer after continuing the sub-agent."),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput);
  const request = createValidModelRequest();
  const options = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
  };

  const paused = await executeToolUseLoop(options, request);

  assert.equal(paused.stoppedReason, "approval_required");
  assert.deepEqual(paused.toolCalls[0]?.output, partialOutput);
  assert.deepEqual(paused.pendingApproval?.pendingToolResult.output, partialOutput);
  assert.notEqual(paused.pendingApproval?.pendingToolResult.output, partialOutput);
  assert.equal(
    toolModelAttachmentsFromOutput(paused.pendingApproval?.pendingToolResult.output)?.[0]?.attachmentId,
    "partial-image"
  );
  const approvalMessage = toolResultMessage(paused.toolCalls[0]!);
  const approvalPayload = JSON.parse(approvalMessage.content) as {
    readonly body?: {
      readonly value?: {
        readonly confirmation?: { readonly confirmationId?: string };
        readonly partialOutput?: { readonly summary?: string };
      };
    };
  };
  assert.equal(approvalPayload.body?.value?.confirmation?.confirmationId, "confirmation-call-sub-agent");
  assert.equal(
    approvalPayload.body?.value?.partialOutput?.summary,
    "The sub-agent completed its analysis before requesting confirmation."
  );

  const unresolved = await resumeToolUseLoopFromApproval(
    { ...options, approvedConfirmationIds: ["confirmation-other"] },
    request,
    paused.pendingApproval!
  );

  assert.equal(unresolved.stoppedReason, "approval_required");
  assert.deepEqual(unresolved.toolCalls.at(-1)?.output, partialOutput);
  assert.deepEqual(unresolved.pendingApproval?.pendingToolResult.output, partialOutput);
  assert.notEqual(unresolved.pendingApproval?.pendingToolResult.output, paused.pendingApproval?.pendingToolResult.output);
  assert.equal(
    toolModelAttachmentsFromOutput(unresolved.pendingApproval?.pendingToolResult.output)?.[0]?.attachmentId,
    "partial-image"
  );
  assert.equal(center.executionCount(), 0);

  const resumed = await resumeToolUseLoopFromApproval(
    { ...options, approvedConfirmationIds: ["confirmation-call-sub-agent"] },
    request,
    unresolved.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(center.executionCount(), 1);
  assert.equal(channel.requests.length, 2);
  const resumedToolMessage = channel.requests[1]?.sanitizedMessages.find((message) =>
    message.role === "tool" && message.toolCallId === "call-sub-agent"
  );
  const resumedPayload = JSON.parse(resumedToolMessage?.content ?? "{}") as {
    readonly body?: { readonly value?: { readonly resumed?: boolean } };
    readonly preApprovals?: readonly {
      readonly body?: {
        readonly value?: { readonly summary?: string };
      };
    }[];
  };
  assert.equal(resumedPayload.body?.value?.resumed, true);
  assert.equal(
    resumedPayload.preApprovals?.[0]?.body?.value?.summary,
    "The sub-agent completed its analysis before requesting confirmation."
  );
  assert.equal(resumedToolMessage?.attachments?.[0]?.attachmentId, "partial-image");
});

test("approval tool messages keep nested partial-output continuation when transport truncates", () => {
  const message = toolResultMessage({
    callId: "call-large-approval",
    toolName: "call_sub_agent",
    input: {},
    output: {
      evidence: "x".repeat(230_000),
      continuation: {
        ref: "sub-agent-output:large-approval",
        nextInput: { sub_run_id: "large-approval", start_char: 0, max_chars: 30_000 },
      },
    },
    status: "approval_required",
    durationMs: 1,
    confirmationRequest: {
      confirmationId: "confirmation-large-approval",
      toolCallFactId: "tool-fact-large-approval",
      title: "Continue large approval",
      actionSummary: "Continue after inspecting the retained partial result.",
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: nowIso(),
      sourceRefs: ["tool:call-large-approval"],
    },
  });
  const payload = JSON.parse(message.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuation?: { readonly ref?: string };
      };
    };
  };

  assert.equal(payload.status, "approval_required");
  assert.equal(payload.body?.value?.continuation?.ref, "sub-agent-output:large-approval");
});

test("resolved approval history keeps every externalized continuation under aggregate transport pressure", () => {
  const preApprovals: ToolCallResult[] = ["first", "second"].map((label) => ({
    callId: "call-multi-stage",
    toolName: "multi_stage_tool",
    input: {},
    output: {
      evidence: label.repeat(60_000),
      continuation: {
        ref: `tool-output://${label}`,
        nextInput: { ref: `tool-output://${label}`, startChar: 0, maxChars: 30_000 },
      },
    },
    status: "approval_required",
    durationMs: 1,
    confirmationRequest: {
      confirmationId: `confirmation-${label}`,
      toolCallFactId: `tool-fact-${label}`,
      title: `Confirm ${label}`,
      actionSummary: `Confirm ${label} stage.`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: nowIso(),
      sourceRefs: ["tool:call-multi-stage"],
    },
  }));
  const [message] = toolResultMessagesWithResolvedApprovals([{
    callId: "call-multi-stage",
    toolName: "multi_stage_tool",
    input: {},
    output: { completed: true },
    status: "completed",
    durationMs: 1,
  }], preApprovals);
  const payload = JSON.parse(message!.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuations?: readonly { readonly ref?: string }[];
      };
    };
  };

  assert.equal(payload.status, "completed");
  assert.deepEqual(
    payload.body?.value?.continuations?.map((continuation) => continuation.ref),
    ["tool-output://first", "tool-output://second"],
  );
});

test("resolved approval aggregate failure preserves a fair preview of every stage without dead refs", () => {
  const preApprovals: ToolCallResult[] = ["first-stage-fact", "second-stage-fact"].map((marker, index) => ({
    callId: "call-unretained-multi-stage",
    toolName: "unretained_multi_stage_tool",
    input: {},
    output: { marker, evidence: String(index).repeat(120_000) },
    status: "approval_required",
    durationMs: 1,
    confirmationRequest: {
      confirmationId: `confirmation-unretained-${index}`,
      toolCallFactId: `tool-fact-unretained-${index}`,
      title: `Confirm stage ${index}`,
      actionSummary: `Confirm stage ${index}.`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: nowIso(),
      sourceRefs: ["tool:call-unretained-multi-stage"],
    },
  }));
  const [message] = toolResultMessagesWithResolvedApprovals([{
    callId: "call-unretained-multi-stage",
    toolName: "unretained_multi_stage_tool",
    input: {},
    output: { completed: true },
    status: "completed",
    durationMs: 1,
  }], preApprovals);
  const payload = JSON.parse(message!.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuation?: unknown;
        readonly continuations?: unknown;
        readonly preview?: {
          readonly totalStages?: number;
          readonly stages?: readonly { readonly content?: string }[];
        };
      };
    };
    readonly error?: { readonly facts?: { readonly code?: string } };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.error?.facts?.code, "tool_result_continuation_required");
  assert.equal(payload.body?.value?.continuation, undefined);
  assert.equal(payload.body?.value?.continuations, undefined);
  assert.equal(payload.body?.value?.preview?.totalStages, 3);
  const previews = payload.body?.value?.preview?.stages?.map((stage) => stage.content) ?? [];
  assert.equal(previews.some((content) => content?.includes("first-stage-fact")), true);
  assert.equal(previews.some((content) => content?.includes("second-stage-fact")), true);
});

test("resolved approval aggregate fails when only one truncated stage has a continuation", () => {
  const preApprovals: ToolCallResult[] = [
    {
      marker: "recoverable-stage",
      evidence: "r".repeat(100_000),
      continuation: { ref: "tool-output://recoverable-stage" },
    },
    { marker: "lost-stage-one", evidence: "1".repeat(100_000) },
    { marker: "lost-stage-two", evidence: "2".repeat(100_000) },
  ].map((output, index) => ({
    callId: "call-partially-retained-multi-stage",
    toolName: "partially_retained_multi_stage_tool",
    input: {},
    output,
    status: "approval_required",
    durationMs: 1,
    confirmationRequest: {
      confirmationId: `confirmation-partially-retained-${index}`,
      toolCallFactId: `tool-fact-partially-retained-${index}`,
      title: `Confirm stage ${index}`,
      actionSummary: `Confirm stage ${index}.`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: nowIso(),
      sourceRefs: ["tool:call-partially-retained-multi-stage"],
    },
  }));
  const [message] = toolResultMessagesWithResolvedApprovals([{
    callId: "call-partially-retained-multi-stage",
    toolName: "partially_retained_multi_stage_tool",
    input: {},
    output: { marker: "lost-resolved-stage", evidence: "z".repeat(100_000) },
    status: "completed",
    durationMs: 1,
  }], preApprovals);
  const payload = JSON.parse(message!.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuation?: { readonly ref?: string };
        readonly continuations?: readonly { readonly ref?: string }[];
      };
    };
    readonly error?: {
      readonly facts?: {
        readonly code?: string;
        readonly sourceExecutionStatus?: string;
        readonly doNotBlindlyRetry?: boolean;
        readonly unrecoverableStageCount?: number;
        readonly unrecoverableStages?: readonly {
          readonly phase?: string;
          readonly index?: number;
          readonly confirmationId?: string;
        }[];
      };
    };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.error?.facts?.code, "tool_result_stage_continuation_required");
  assert.equal(payload.error?.facts?.sourceExecutionStatus, "completed");
  assert.equal(payload.error?.facts?.doNotBlindlyRetry, true);
  assert.equal(payload.error?.facts?.unrecoverableStageCount, 3);
  assert.deepEqual(payload.error?.facts?.unrecoverableStages, [
    {
      phase: "pre_approval",
      index: 1,
      confirmationId: "confirmation-partially-retained-1",
    },
    {
      phase: "pre_approval",
      index: 2,
      confirmationId: "confirmation-partially-retained-2",
    },
    { phase: "resolved", index: 3 },
  ]);
  const availableContinuations = payload.body?.value?.continuations
    ?? (payload.body?.value?.continuation === undefined ? [] : [payload.body.value.continuation]);
  assert.deepEqual(availableContinuations.map((continuation) => continuation.ref), [
    "tool-output://recoverable-stage",
  ]);
});

test("tool result transport fails explicitly when more continuations exist than it can deliver", () => {
  const continuations = Array.from({ length: 33 }, (_, index) => ({
    ref: `tool-output://continuation-${index}`,
  }));
  const [message] = toolResultMessages([{
    callId: "call-too-many-continuations",
    toolName: "continuation_fanout",
    input: {},
    output: {
      evidence: "x".repeat(240_000),
      continuations,
    },
    status: "completed",
    durationMs: 1,
  }]);
  const payload = JSON.parse(message!.content) as {
    readonly status?: string;
    readonly body?: {
      readonly value?: {
        readonly continuations?: readonly { readonly ref?: string }[];
      };
    };
    readonly error?: {
      readonly facts?: {
        readonly code?: string;
        readonly detectedContinuationCount?: number;
        readonly detectedContinuationCountIsLowerBound?: boolean;
        readonly deliveredContinuationCount?: number;
      };
    };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.error?.facts?.code, "tool_result_continuations_incomplete");
  assert.equal(payload.error?.facts?.detectedContinuationCount, 33);
  assert.equal(payload.error?.facts?.detectedContinuationCountIsLowerBound, true);
  assert.equal(payload.error?.facts?.deliveredContinuationCount, 32);
  assert.equal(payload.body?.value?.continuations?.length, 32);
});

test("tool result serialization failure preserves the source execution fact", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const [message] = toolResultMessages([{
    callId: "call-nonserializable-result",
    toolName: "external_side_effect",
    input: {},
    output: cyclic as never,
    status: "completed",
    durationMs: 1,
  }]);
  const payload = JSON.parse(message!.content) as {
    readonly status?: string;
    readonly error?: {
      readonly facts?: {
        readonly code?: string;
        readonly sourceExecutionStatus?: string;
        readonly doNotBlindlyRetry?: boolean;
        readonly outputDeliveryPhase?: string;
      };
    };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.error?.facts?.code, "tool_result_not_serializable");
  assert.equal(payload.error?.facts?.sourceExecutionStatus, "completed");
  assert.equal(payload.error?.facts?.doNotBlindlyRetry, true);
  assert.equal(payload.error?.facts?.outputDeliveryPhase, "model_transport_serialization");
});

test("approval cancellation preserves pending partial output and attachments", async () => {
  const eventLog = new InMemoryEventLog();
  const attachmentData = Buffer.from("cancelled-approval-image").toString("base64");
  const partialOutput = withToolModelAttachments({
    summary: "Evidence produced before the approval was cancelled.",
  }, [{
    kind: "image",
    attachmentId: "cancelled-approval-image",
    source: { kind: "data", mimeType: "image/png", data: attachmentData },
  }]);
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent", "call_sub_agent"),
    textResponse("model-request-final", "must not run after cancellation"),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput);
  const request = createValidModelRequest();
  const baseOptions = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
    publishToolEvent: (message: Parameters<NonNullable<ToolUseLoopOptions["publishToolEvent"]>>[0]) =>
      eventLog.append(message),
  };
  const paused = await executeToolUseLoop(baseOptions, request);
  const abort = new AbortController();
  abort.abort();

  const cancelled = await resumeToolUseLoopFromApproval({
    ...baseOptions,
    approvedConfirmationIds: ["confirmation-call-sub-agent"],
    abortSignal: abort.signal,
  }, request, paused.pendingApproval!);

  assert.equal(cancelled.stoppedReason, "cancelled");
  assert.equal(cancelled.toolCalls.at(-1)?.status, "cancelled");
  assert.equal(cancelled.toolCalls.at(-1)?.errorDomain, undefined);
  assert.deepEqual(cancelled.toolCalls.at(-1)?.output, partialOutput);
  const toolMessage = cancelled.contextMessages?.find((message) =>
    message.role === "tool" && message.toolCallId === "call-sub-agent"
  );
  assert.equal(toolMessage?.content.includes("Evidence produced before the approval was cancelled."), true);
  assert.equal(toolMessage?.attachments?.[0]?.attachmentId, "cancelled-approval-image");
  assert.equal(channel.requests.length, 1);
  assert.equal(center.executionCount(), 0);
  const replayedCancellation = eventLog.replay().find((message) => message.type === "tool.cancelled");
  const replayedCancellationFacts = (replayedCancellation?.payload as {
    readonly errorFacts?: Readonly<Record<string, unknown>>;
  } | undefined)?.errorFacts;
  assert.equal(replayedCancellationFacts?.code, "approval_wait_cancelled");
  assert.equal(replayedCancellationFacts?.confirmationId, "confirmation-call-sub-agent");
});

test("confirmation decision cancellation preserves the pending tool fact", async () => {
  const partialOutput = { summary: "Keep this decision-time partial fact." };
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent", "call_sub_agent"),
    textResponse("model-request-final", "must not run after cancellation"),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput);
  const request = createValidModelRequest();
  const baseOptions = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
  };
  const paused = await executeToolUseLoop(baseOptions, request);
  const abort = new AbortController();
  abort.abort();

  const cancelled = await resumeToolUseLoopFromConfirmationDecision({
    ...baseOptions,
    abortSignal: abort.signal,
  }, request, paused.pendingApproval!, {
    confirmationId: "confirmation-call-sub-agent",
    decision: "guidance",
    guidance: "This guidance must not erase the partial fact.",
  });

  assert.equal(cancelled.stoppedReason, "cancelled");
  assert.deepEqual(cancelled.toolCalls.at(-1)?.output, partialOutput);
  assert.equal(JSON.stringify(cancelled.contextMessages).includes(partialOutput.summary), true);
  assert.equal(channel.requests.length, 1);
  assert.equal(center.executionCount(), 0);
});

test("abort after approved execution keeps both pre-approval and completed facts", async () => {
  const abort = new AbortController();
  const partialOutput = { summary: "Fact produced before approval." };
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent", "call_sub_agent"),
    textResponse("model-request-final", "must not run after cancellation"),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput, () => abort.abort());
  const request = createValidModelRequest();
  const baseOptions = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
  };
  const paused = await executeToolUseLoop(baseOptions, request);

  const cancelled = await resumeToolUseLoopFromApproval({
    ...baseOptions,
    approvedConfirmationIds: ["confirmation-call-sub-agent"],
    abortSignal: abort.signal,
  }, request, paused.pendingApproval!);

  assert.equal(cancelled.stoppedReason, "cancelled");
  assert.equal(cancelled.toolCalls.at(-1)?.status, "completed");
  assert.deepEqual(cancelled.toolCalls.at(-1)?.output, {
    resumed: true,
    reusedCompletedMaterial: true,
  });
  const contextText = JSON.stringify(cancelled.contextMessages);
  assert.equal(contextText.includes("Fact produced before approval."), true);
  assert.equal(contextText.includes("reusedCompletedMaterial"), true);
  assert.equal(channel.requests.length, 1);
  assert.equal(center.executionCount(), 1);
});

test("abort closes a new approval returned by approved execution as one cancelled fact", async () => {
  const abort = new AbortController();
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-multi-approval", "multi_approval_tool"),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [testToolDefinition("multi_approval_tool", "read-only")],
    has: (name) => name === "multi_approval_tool",
    execute: async (request, _context, permission) => {
      const approved = permission.approvedConfirmationIds?.includes("confirmation-stage-one") === true;
      if (approved) {
        abort.abort();
      }
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: { stageFact: approved ? "second-stage-partial" : "first-stage-partial" },
        status: "approval_required",
        durationMs: 1,
        confirmationRequest: {
          confirmationId: approved ? "confirmation-stage-two" : "confirmation-stage-one",
          toolCallFactId: request.factId ?? request.callId,
          title: approved ? "Confirm stage two" : "Confirm stage one",
          actionSummary: approved ? "Confirm stage two." : "Confirm stage one.",
          affectedResources: [],
          riskLevel: "medium",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    },
  };
  const request = createValidModelRequest();
  const baseOptions: ToolUseLoopOptions = {
    intelligenceChannel: channel,
    toolCenter: broker,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["multi_approval_tool"],
    publishToolEvent: (message) => eventLog.append(message),
  };
  const paused = await executeToolUseLoop(baseOptions, request);

  const cancelled = await resumeToolUseLoopFromApproval({
    ...baseOptions,
    approvedConfirmationIds: ["confirmation-stage-one"],
    abortSignal: abort.signal,
  }, request, paused.pendingApproval!);

  assert.equal(cancelled.stoppedReason, "cancelled");
  assert.equal(cancelled.pendingApproval, undefined);
  assert.equal(cancelled.toolCalls.at(-1)?.status, "cancelled");
  assert.equal(cancelled.toolCalls.at(-1)?.errorDomain, undefined);
  assert.equal(cancelled.toolCalls.at(-1)?.errorFacts?.code, "approval_resumption_cancelled");
  assert.deepEqual(cancelled.toolCalls.at(-1)?.output, { stageFact: "second-stage-partial" });
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "user_approval.requested",
    "user_approval.requested",
    "tool.cancelled",
  ]);
  assert.equal(eventLog.list().at(-1)?.type, "tool.cancelled");
});

test("confirmation guidance returns partial sub-agent output and the decision to the parent model", async () => {
  const partialOutput = {
    sub_run_id: "sub-run-guidance",
    summary: "Completed evidence gathered before the confirmation pause.",
    evidence: ["src/app/sub-agents/sub-agent-tools.ts"],
  };
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent-guidance", "call_sub_agent"),
    textResponse("model-request-final", "I used the completed evidence and followed the guidance."),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput);
  const request = createValidModelRequest();
  const options = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
  };
  const paused = await executeToolUseLoop(options, request);

  const resumed = await resumeToolUseLoopFromConfirmationDecision(
    options,
    request,
    paused.pendingApproval!,
    {
      confirmationId: "confirmation-call-sub-agent-guidance",
      decision: "guidance",
      guidance: "Do not perform the pending write; synthesize from the completed evidence.",
    }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(center.executionCount(), 0);
  assert.equal(resumed.toolCalls.at(-1)?.status, "cancelled");
  assert.deepEqual(resumed.toolCalls.at(-1)?.output, partialOutput);
  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) =>
    message.role === "tool" && message.toolCallId === "call-sub-agent-guidance"
  );
  const payload = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly status?: string;
    readonly body?: { readonly value?: { readonly summary?: string } };
    readonly error?: { readonly message?: string; readonly facts?: { readonly decision?: string } };
  };
  assert.equal(payload.status, "cancelled");
  assert.equal(payload.body?.value?.summary, "Completed evidence gathered before the confirmation pause.");
  assert.equal(payload.error?.facts?.decision, "guidance");
  assert.equal(payload.error?.message?.includes("Do not perform the pending write"), true);
});

test("confirmation guidance preserves the pre-approval error fact", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-guidance-error", "gated_analysis"),
    textResponse("model-request-final", "I kept the diagnostic and followed the guidance."),
  ]);
  const broker: ToolExecutionBroker = {
    list: () => [testToolDefinition("gated_analysis", "read-only")],
    has: (name) => name === "gated_analysis",
    execute: async (request) => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { partialFact: "diagnostic material" },
      status: "approval_required",
      error: "A gated step remains after the diagnostic.",
      errorDomain: "runtime_error",
      errorFacts: { code: "gated_step_pending", diagnosticId: "diagnostic-1" },
      durationMs: 1,
      confirmationRequest: {
        confirmationId: "confirmation-guidance-error",
        toolCallFactId: request.factId ?? request.callId,
        title: "Confirm gated step",
        actionSummary: "Confirm the gated step.",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: nowIso(),
        sourceRefs: [`tool:${request.callId}`],
      },
    }),
  };
  const options: ToolUseLoopOptions = {
    intelligenceChannel: channel,
    toolCenter: broker,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["gated_analysis"],
  };
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(options, request);

  const resumed = await resumeToolUseLoopFromConfirmationDecision(
    options,
    request,
    paused.pendingApproval!,
    {
      confirmationId: "confirmation-guidance-error",
      decision: "guidance",
      guidance: "Use the diagnostic without the gated step.",
    },
  );

  const decisionResult = resumed.toolCalls.at(-1);
  assert.equal(decisionResult?.status, "cancelled");
  assert.equal(decisionResult?.errorFacts?.preApprovalError, "A gated step remains after the diagnostic.");
  assert.equal(decisionResult?.errorFacts?.preApprovalErrorDomain, "runtime_error");
  assert.deepEqual(decisionResult?.errorFacts?.preApprovalErrorFacts, {
    code: "gated_step_pending",
    diagnosticId: "diagnostic-1",
  });
  assert.equal(decisionResult?.confirmationRequest?.confirmationId, "confirmation-guidance-error");
  const modelRequest = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(modelRequest.includes("gated_step_pending"), true);
  assert.equal(modelRequest.includes("diagnostic-1"), true);
});

test("confirmation denial returns partial sub-agent output and the denial to the parent model", async () => {
  const partialOutput = {
    sub_run_id: "sub-run-denied",
    summary: "Completed evidence remains useful after the pending action is denied.",
  };
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-sub-agent-denied", "call_sub_agent"),
    textResponse("model-request-final", "I kept the completed evidence and did not perform the action."),
  ]);
  const center = new PartialApprovalToolBroker(partialOutput);
  const request = createValidModelRequest();
  const options = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["call_sub_agent"],
  };
  const paused = await executeToolUseLoop(options, request);

  const resumed = await resumeToolUseLoopFromConfirmationDecision(
    options,
    request,
    paused.pendingApproval!,
    {
      confirmationId: "confirmation-call-sub-agent-denied",
      decision: "deny",
    }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(center.executionCount(), 0);
  assert.deepEqual(resumed.toolCalls.at(-1)?.output, partialOutput);
  const toolMessage = channel.requests[1]?.sanitizedMessages.find((message) =>
    message.role === "tool" && message.toolCallId === "call-sub-agent-denied"
  );
  const payload = JSON.parse(toolMessage?.content ?? "{}") as {
    readonly status?: string;
    readonly body?: { readonly value?: { readonly summary?: string } };
    readonly error?: { readonly message?: string; readonly facts?: { readonly decision?: string } };
  };
  assert.equal(payload.status, "cancelled");
  assert.equal(payload.body?.value?.summary, "Completed evidence remains useful after the pending action is denied.");
  assert.equal(payload.error?.facts?.decision, "deny");
  assert.equal(payload.error?.message?.includes("用户拒绝了本次工具执行"), true);
});

test("resumeToolUseLoopFromApproval executes only a matching approved confirmation", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    completedResponse("model-request-final", { summary: "Final answer after approved delete." }),
  ]);
  const center = new TestToolBroker();
  const eventLog = new InMemoryEventLog();
  center.register("delete_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
      publishToolEvent: (message) => eventLog.append(message),
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
      allowedTools: ["delete_file"],
      approvedConfirmationIds: ["confirmation-call-delete"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.toolCalls.some((call) => call.status === "approval_required"), false);
  assert.equal(resumed.toolCalls[0]?.status, "completed");
  assert.equal(center.executionCount(), 1);
  assert.equal(channel.requests.length, 2);
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "user_approval.requested",
    "tool.completed",
  ]);
});

test("resumeToolUseLoopFromApproval waits for tool completion before requesting the next model turn", async () => {
  let releaseCommand: (() => void) | undefined;
  const commandFinished = new Promise<void>((resolve) => {
    releaseCommand = resolve;
  });
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [{ callId: "call-shell", toolName: "shell_command", input: { command: "dir" } }],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer after command output."),
  ]);
  const center = new TestToolBroker();
  center.register("shell_command", async () => {
    await commandFinished;
    return {
      stdout: "README.md\nsrc\n",
      stderr: "",
      exitCode: 0,
    };
  }, "execute");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  const resumedPromise = resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell"],
    },
    request,
    paused.pendingApproval!
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(center.executionCount(), 1);
  assert.equal(channel.requests.length, 1);
  releaseCommand?.();
  const resumed = await resumedPromise;

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(channel.requests.length, 2);
  const nextModelRequest = channel.requests[1];
  const toolMessage = nextModelRequest?.sanitizedMessages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.content.includes("README.md"), true);
  assert.equal(toolMessage?.content.includes("exitCode"), true);
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

test("approval pause cloning preserves attachments from tools completed earlier in the batch", async () => {
  const attachmentData = Buffer.from("approval-image").toString("base64");
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-image", toolName: "read_context_attachment_image", input: { attachmentId: "ctx-image" } },
        { callId: "call-shell", toolName: "shell_command", input: { command: "echo approved" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer after image and command."),
  ]);
  const center = new TestToolBroker();
  center.register("read_context_attachment_image", async () => withToolModelAttachments(
    { attachmentId: "ctx-image", readable: true },
    [{
      kind: "image",
      source: { kind: "data", mimeType: "image/png", data: attachmentData },
      attachmentId: "ctx-image",
    }]
  ), "read-only");
  center.register("shell_command", async () => ({ exitCode: 0 }), "execute");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_context_attachment_image", "shell_command"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.completedToolResults.length, 1);

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["read_context_attachment_image", "shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell"],
    },
    request,
    paused.pendingApproval!
  );
  const imageMessage = channel.requests[1]?.sanitizedMessages
    .find((message) => message.role === "tool" && message.toolCallId === "call-image");

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(imageMessage?.attachments?.[0]?.kind, "image");
  assert.equal(imageMessage?.attachments?.[0]?.attachmentId, "ctx-image");
  assert.equal(imageMessage?.attachments?.[0]?.source.kind, "data");
  if (imageMessage?.attachments?.[0]?.source.kind === "data") {
    assert.equal(imageMessage.attachments[0].source.data, attachmentData);
  }
});

test("resumeToolUseLoopFromApproval waits for every approval in a model-requested batch before model continuation", async () => {
  const channel = new SequenceIntelligenceChannel([
    {
      ...completedResponse("model-request-test", undefined),
      toolCalls: [
        { callId: "call-shell-a", toolName: "shell_command", input: { command: "cat a.txt" } },
        { callId: "call-shell-b", toolName: "shell_command", input: { command: "cat b.txt" } },
      ],
      finishReason: "tool_call",
    },
    textResponse("model-request-final", "Final answer after both commands."),
  ]);
  const center = new TestToolBroker();
  const executedCommands: string[] = [];
  center.register("shell_command", async (input) => {
    const command = String((input as { readonly command?: string }).command ?? "");
    executedCommands.push(command);
    return {
      stdout: `${command}\n`,
      stderr: "",
      exitCode: 0,
    };
  }, "execute");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.confirmationId, "confirmation-call-shell-a");
  assert.equal(paused.pendingApproval?.remainingToolCallsAfterApproval.length, 1);
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 1);

  const afterFirstApproval = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell-a"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(afterFirstApproval.stoppedReason, "approval_required");
  assert.equal(afterFirstApproval.pendingApproval?.confirmationId, "confirmation-call-shell-b");
  assert.equal(afterFirstApproval.pendingApproval?.completedToolResults.length, 1);
  assert.deepEqual(executedCommands, ["cat a.txt"]);
  assert.equal(center.executionCount(), 1);
  assert.equal(channel.requests.length, 1);

  const afterSecondApproval = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell-b"],
    },
    request,
    afterFirstApproval.pendingApproval!
  );

  assert.equal(afterSecondApproval.stoppedReason, "completed");
  assert.deepEqual(executedCommands, ["cat a.txt", "cat b.txt"]);
  assert.equal(center.executionCount(), 2);
  assert.equal(channel.requests.length, 2);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
  const nextModelRequestText = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(nextModelRequestText.includes("cat a.txt"), true);
  assert.equal(nextModelRequestText.includes("cat b.txt"), true);
});

test("resumeToolUseLoopFromApproval rejects the wrong confirmation id without executing", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    completedResponse("model-request-final", { summary: "must not be requested" }),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
    },
    request
  );

  assert.notEqual(paused.pendingApproval?.confirmationRequest, undefined);
  const richConfirmationRequest = {
    ...paused.pendingApproval!.confirmationRequest!,
    title: "删除文件",
    actionSummary: "删除文件：src/app.ts",
    affectedResources: ["src/app.ts"],
  };
  const richPendingApproval = {
    ...paused.pendingApproval!,
    pendingToolResult: {
      ...paused.pendingApproval!.pendingToolResult,
      confirmationRequest: richConfirmationRequest,
    },
    confirmationRequest: richConfirmationRequest,
  };

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
      approvedConfirmationIds: ["confirmation-other"],
    },
    request,
    richPendingApproval
  );

  assert.equal(resumed.stoppedReason, "approval_required");
  const confirmation = resumed.toolCalls.find((call) => call.status === "approval_required")?.confirmationRequest;
  assert.equal(confirmation?.title, "删除文件");
  assert.equal(confirmation?.actionSummary, "删除文件：src/app.ts");
  assert.deepEqual(confirmation?.affectedResources, ["src/app.ts"]);
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 1);
});

test("resumeToolUseLoopFromApproval requires the matching confirmation before continuing", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    textResponse("model-request-final", "Final answer after approved delete."),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
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
      allowedTools: ["delete_file"],
      approvedConfirmationIds: ["confirmation-other"],
    },
    request,
    paused.pendingApproval!
  );
  assert.equal(wrong.stoppedReason, "approval_required");
  assert.equal(center.executionCount(), 0);

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
      approvedConfirmationIds: ["confirmation-call-delete"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.finalOutput.textOutput, "Final answer after approved delete.");
  assert.equal(center.executionCount(), 1);
});

test("resumeToolUseLoopFromApproval does not execute pending tool if resumed policy no longer allows it", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    textResponse("model-request-final", "Final answer after denied delete."),
  ]);
  const center = new PermissionIgnoringToolBroker();
  center.register("delete_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
    },
    request
  );

  assert.equal(paused.stoppedReason, "approval_required");

  const resumed = await resumeToolUseLoopFromApproval(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: [],
      approvedConfirmationIds: ["confirmation-call-delete"],
    },
    request,
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.toolCalls[0]?.status, "failed");
  assert.match(resumed.toolCalls[0]?.error ?? "", /未授权/);
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 2);
  assert.equal(channel.requests[1]?.tools?.length, 0);
});

test("resumeToolUseLoopFromConfirmationDecision returns denial as model-visible tool feedback", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    textResponse("model-request-final", "我不会执行删除，改为说明可选方案。"),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ ok: true }), "read-write");
  const request = createValidModelRequest();
  const paused = await executeToolUseLoop(
    {
      intelligenceChannel: channel,
      toolCenter: center,
      callerAgentId: "agent-test",
      traceId: "trace-test",
      goalId: "goal-test",
      allowedTools: ["delete_file"],
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
      allowedTools: ["delete_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    request,
    paused.pendingApproval!,
    { confirmationId: "confirmation-call-delete", decision: "deny" }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.finalOutput.textOutput, "我不会执行删除，改为说明可选方案。");
  assert.equal(center.executionCount(), 0);
  assert.equal(resumed.toolCalls.at(-1)?.status, "cancelled");
  assert.equal(channel.requests.length, 2);
  const toolMessage = channel.requests[1]?.sanitizedMessages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  assert.equal(toolMessage?.content.includes("用户拒绝了本次工具执行"), true);
  assert.equal(toolMessage?.content.includes("confirmation_decision"), false);
  assert.equal(occurrences(toolMessage?.content ?? "", "用户拒绝了本次工具执行"), 1);
  assert.deepEqual(eventLog.types(), ["tool.requested", "user_approval.requested", "tool.cancelled"]);
});

test("confirmation decision with the wrong id never executes an otherwise approved tool", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
    textResponse("model-request-final", "must not run for wrong confirmation id"),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ deleted: true }), "read-write");
  const request = createValidModelRequest();
  const baseOptions = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["delete_file"],
  };
  const paused = await executeToolUseLoop(baseOptions, request);

  const unresolved = await resumeToolUseLoopFromConfirmationDecision({
    ...baseOptions,
    approvedConfirmationIds: ["confirmation-call-delete"],
  }, request, paused.pendingApproval!, {
    confirmationId: "confirmation-forged",
    decision: "deny",
  });

  assert.equal(unresolved.stoppedReason, "approval_required");
  assert.equal(unresolved.pendingApproval?.confirmationId, "confirmation-call-delete");
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 1);
});

test("confirmation resume rejects inconsistent pending approval identity", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-delete", "delete_file"),
  ]);
  const center = new TestToolBroker();
  center.register("delete_file", async () => ({ deleted: true }), "read-write");
  const request = createValidModelRequest();
  const options = {
    intelligenceChannel: channel,
    toolCenter: center,
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools: ["delete_file"],
  };
  const paused = await executeToolUseLoop(options, request);
  const forged = {
    ...paused.pendingApproval!,
    pendingToolResult: {
      ...paused.pendingApproval!.pendingToolResult,
      callId: "call-forged",
    },
  };

  await assert.rejects(
    resumeToolUseLoopFromApproval({
      ...options,
      approvedConfirmationIds: ["confirmation-call-delete"],
    }, request, forged),
    /Pending tool approval facts are inconsistent/,
  );

  const forgedInput = {
    ...paused.pendingApproval!,
    pendingToolResult: {
      ...paused.pendingApproval!.pendingToolResult,
      input: { forged: true },
    },
  };
  await assert.rejects(
    resumeToolUseLoopFromApproval({
      ...options,
      approvedConfirmationIds: ["confirmation-call-delete"],
    }, request, forgedInput),
    /Pending tool approval facts are inconsistent/,
  );

  assert.ok(paused.pendingApproval!.confirmationRequest);
  const forgedVisibleConfirmation = {
    ...paused.pendingApproval!,
    confirmationRequest: {
      ...paused.pendingApproval!.confirmationRequest,
      title: "读取文件",
      actionSummary: "读取 README.md",
      affectedResources: ["README.md"],
      riskLevel: "low" as const,
    },
  };
  await assert.rejects(
    resumeToolUseLoopFromApproval({
      ...options,
      approvedConfirmationIds: ["confirmation-call-delete"],
    }, request, forgedVisibleConfirmation),
    /Pending tool approval facts are inconsistent/,
  );

  const forgedAssistantPairing = {
    ...paused.pendingApproval!,
    assistantMessage: {
      ...paused.pendingApproval!.assistantMessage,
      toolCalls: paused.pendingApproval!.assistantMessage.toolCalls?.map((call) =>
        call.callId === paused.pendingApproval!.pendingToolCall.callId
          ? { ...call, input: { forged: true } }
          : call
      ),
    },
  };
  await assert.rejects(
    resumeToolUseLoopFromApproval({
      ...options,
      approvedConfirmationIds: ["confirmation-call-delete"],
    }, request, forgedAssistantPairing),
    /Pending tool approval facts are inconsistent/,
  );
  assert.equal(center.executionCount(), 0);
  assert.equal(channel.requests.length, 1);
});

test("resumeToolUseLoopFromConfirmationDecision returns guidance and skipped batch calls to the model", async () => {
  const guidance = `不要执行命令，改为说明需要哪些材料。${"请保留完整指导。".repeat(180)}sk-guidance-secret-token`;
  const eventLog = new InMemoryEventLog();
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
      allowedTools: ["shell_command", "read_file"],
      publishToolEvent: (message) => eventLog.append(message),
    },
    request,
    paused.pendingApproval!,
    {
      confirmationId: "confirmation-call-shell",
      decision: "guidance",
      guidance,
    }
  );

  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(center.executionCount(), 0);
  assert.deepEqual(resumed.toolCalls.map((call) => call.status), ["cancelled", "cancelled"]);
  assert.equal(channel.requests[1]?.sanitizedMessages.filter((message) => message.role === "tool").length, 2);
  const requestText = JSON.stringify(channel.requests[1]?.sanitizedMessages);
  assert.equal(requestText.includes(guidance), true);
  assert.equal(requestText.includes("sk-guidance-secret-token"), true);
  assert.equal(occurrences(requestText, "sk-guidance-secret-token"), 1);
  assert.equal(requestText.includes("confirmation_decision"), false);
  assert.equal(requestText.includes("[redacted-secret]"), false);
  assert.deepEqual(eventLog.types(), [
    "tool.requested",
    "user_approval.requested",
    "tool.cancelled",
    "tool.requested",
    "tool.cancelled",
  ]);
  const skippedRequest = eventLog.list().find((entry) =>
    entry.type === "tool.requested" &&
    (entry.message.payload as { readonly callId?: unknown }).callId === "call-read"
  );
  assert.deepEqual(
    (skippedRequest?.message.payload as { readonly input?: unknown } | undefined)?.input,
    { path: "README.md" }
  );
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

function failedResponse(requestId: string, message: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    status: "failed",
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: nowIso(),
      issues: [{ code: "MODEL_PROVIDER_RESPONSE", message }],
    },
    failure: {
      kind: "provider_response",
      retryable: true,
      message,
    },
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

function testToolDefinition(
  name: string,
  operationType: "read-only" | "read-write" | "execute" | "external-submit",
  requiresConfirmation = false
): ToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    metadata: {
      category: operationType === "execute" ? "terminal" : "filesystem",
      riskLevel: operationType === "read-only" ? "low" : operationType === "read-write" ? "medium" : "high",
      operationType,
      requiresConfirmation,
    },
    inputSchema: { type: "object", properties: {} },
  };
}

class ExecutionFactToolBroker implements ToolExecutionBroker {
  private callCount = 0;

  constructor(private readonly factsByToolName: Readonly<Record<string, unknown>>) {}

  list(): ToolDefinition[] {
    return Object.keys(this.factsByToolName).map((name) => testToolDefinition(name, name === "shell_command" ? "execute" : "read-only"));
  }

  has(name: string): boolean {
    return name in this.factsByToolName;
  }

  async execute(request: ToolCallRequest, _context: ToolExecutionContext, permission: ToolPermissionCheck): Promise<ToolCallResult> {
    if (!permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(request, `Tool ${request.toolName} is not allowed.`);
    }
    this.callCount += 1;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: normalizeToolFactValue(this.factsByToolName[request.toolName]),
      status: "completed",
      durationMs: 1,
    };
  }

  executionCount(): number {
    return this.callCount;
  }
}

class PermissionIgnoringToolBroker implements ToolExecutionBroker {
  private readonly tools = new Map<string, (input: unknown, context: ToolExecutionContext) => Promise<unknown>>();
  private readonly operationTypes = new Map<string, "read-only" | "read-write" | "execute" | "external-submit">();
  private callCount = 0;

  register(executor: ToolExecutor): void;
  register(
    name: string,
    execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>,
    operationType?: "read-only" | "read-write" | "execute" | "external-submit"
  ): void;
  register(
    executorOrName: ToolExecutor | string,
    execute?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>,
    operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only"
  ): void {
    if (typeof executorOrName === "string") {
      this.tools.set(executorOrName, execute!);
      this.operationTypes.set(executorOrName, operationType);
    } else {
      const executor = executorOrName;
      this.tools.set(executor.definition.name, executor.execute.bind(executor));
      const opType = executor.definition.metadata?.operationType ?? "read-only";
      this.operationTypes.set(executor.definition.name, opType);
    }
  }

  list(): ToolDefinition[] {
    return [...this.tools.keys()].map((name) => testToolDefinition(
      name,
      this.operationTypes.get(name) ?? "read-only"
    ));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const execute = this.tools.get(request.toolName);
    if (execute === undefined) {
      return failedToolResult(request, `Tool is not registered: ${request.toolName}`);
    }
    const operationType = this.operationTypes.get(request.toolName) ?? "read-only";
    const confirmationId = `confirmation-${request.callId}`;
    if (operationType !== "read-only" && permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
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
          toolCallFactId: request.factId ?? request.callId,
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
      output: normalizeToolFactValue(await execute(request.input, context)),
      status: "completed",
      durationMs: 1,
    };
  }

  executionCount(): number {
    return this.callCount;
  }
}

class TestToolBroker implements ToolExecutionBroker {
  private readonly tools = new Map<string, (input: unknown, context: ToolExecutionContext) => Promise<unknown>>();
  private readonly operationTypes = new Map<string, "read-only" | "read-write" | "execute" | "external-submit">();
  private callCount = 0;

  register(executor: ToolExecutor): void;
  register(
    name: string,
    execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>,
    operationType?: "read-only" | "read-write" | "execute" | "external-submit"
  ): void;
  register(
    executorOrName: ToolExecutor | string,
    execute?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>,
    operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only"
  ): void {
    if (typeof executorOrName === "string") {
      this.tools.set(executorOrName, execute!);
      this.operationTypes.set(executorOrName, operationType);
    } else {
      const executor = executorOrName;
      this.tools.set(executor.definition.name, executor.execute.bind(executor));
      const opType = executor.definition.metadata?.operationType ?? "read-only";
      this.operationTypes.set(executor.definition.name, opType);
    }
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
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const execute = this.tools.get(request.toolName);
    if (execute === undefined) {
      return failedToolResult(request, `Tool is not registered: ${request.toolName}`);
    }
    if (!permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(request, `Tool ${request.toolName} is not allowed.`);
    }
    const operationType = this.operationTypes.get(request.toolName) ?? "read-only";
    const confirmationId = `confirmation-${request.callId}`;
    if (privateUrlFromInput(request.input) !== undefined && permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
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
          toolCallFactId: request.factId ?? request.callId,
          title: "需要确认内部网络访问",
          actionSummary: `工具 ${request.toolName} 需要确认后才能读取本机或内网地址。`,
          affectedResources: [],
          riskLevel: "medium",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    }
    if (operationType !== "read-only" && permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
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
          toolCallFactId: request.factId ?? request.callId,
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
      output: normalizeToolFactValue(await execute(request.input, context)),
      status: "completed",
      durationMs: 1,
    };
  }

  executionCount(): number {
    return this.callCount;
  }
}

class PartialApprovalToolBroker implements ToolExecutionBroker {
  private callCount = 0;

  constructor(
    private readonly partialOutput: ToolCallResult["output"],
    private readonly onApproved?: () => void,
  ) {}

  list(): ToolDefinition[] {
    return [{
      name: "call_sub_agent",
      description: "Sub-agent tool that can pause after producing partial output.",
      metadata: {
        category: "other",
        riskLevel: "high",
        operationType: "execute",
        requiresConfirmation: true,
      },
      inputSchema: { type: "object", properties: {} },
    }];
  }

  has(name: string): boolean {
    return name === "call_sub_agent";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const confirmationId = `confirmation-${request.callId}`;
    if (permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: this.partialOutput,
        status: "approval_required",
        durationMs: 7,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: "Sub-agent action requires confirmation",
          actionSummary: "Continue the pending sub-agent action.",
          affectedResources: ["pending-resource"],
          riskLevel: "high",
          requestedAt: nowIso(),
          sourceRefs: [`tool:${request.callId}`],
        },
      };
    }
    this.callCount += 1;
    this.onApproved?.();
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { resumed: true, reusedCompletedMaterial: true },
      status: "completed",
      durationMs: 3,
    };
  }

  executionCount(): number {
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

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
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
