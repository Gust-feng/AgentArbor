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
import { executeToolUseLoop, resumeToolUseLoopFromApproval } from "./tool-use-loop.js";

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

test("executeToolUseLoop forces a final synthesis when the model requests another tool after max rounds", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "web_search"),
    toolCallResponse("model-request-next", "call-2", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer without more tools." }),
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
  assert.equal(result.toolCalls.length, 1);
  assert.equal(channel.requests.length, 3);
  assert.equal(channel.requests[2]?.toolChoice, "none");
  assert.deepEqual(channel.requests[2]?.tools, []);
  assert.equal(
    channel.requests[2]?.sanitizedMessages.some((message) => message.ref === "prompt:tool_use.no_more_tools.v1"),
    true
  );
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

test("executeToolUseLoop injects iteration warning near round limits", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-1", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer after warning." }),
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
  assert.equal(channel.requests[1]?.sanitizedMessages.at(-1)?.ref, "prompt:tool_use.iteration_warning.v1");
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
    paused.pendingApproval!
  );

  assert.equal(resumed.stoppedReason, "approval_required");
  assert.equal(center.getCallCount(), 0);
  assert.equal(channel.requests.length, 1);
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
