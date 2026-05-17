import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { AgentTurnPermissionPolicy } from "../../domain/common.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { createUndergroundAgentClusterManifests } from "../../app/agents/manifests.js";
import { InMemoryEventLog } from "../events/in-memory-event-log.js";
import { nowIso } from "../id.js";
import { pendingModelOutputValidation } from "./validation.js";
import { AgentTurnRuntime, type AgentTurnPolicy } from "./agent-turn-runtime.js";

test("AgentTurnRuntime skips model calls when policy disables model access", async () => {
  const channel = new SequenceIntelligenceChannel([]);
  const runtime = new AgentTurnRuntime({ intelligenceChannel: channel });
  const manifest = createUndergroundAgentClusterManifests().find(
    (candidate) => candidate.id === "underground-intent-core"
  );

  assert.equal(manifest?.turnPolicy.allowModel, false);
  const result = await runtime.execute(
    createTurnInput(policyFromManifest(manifest!.turnPolicy, { callerAgentId: manifest!.id }))
  );

  assert.equal(result.status, "disabled");
  assert.equal(result.stoppedReason, "model_disabled");
  assert.equal(result.modelRounds, 0);
  assert.equal(channel.requests.length, 0);
});

test("AgentTurnRuntime rejects unauthorized tool calls and publishes safe tool failure", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    completedResponse("model-request-final", { summary: "Fallback after denied tool." }),
  ]);
  const broker = new PermissionAwareToolBroker(["web_search"]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
    publishToolEvent: (message) => eventLog.append(message),
  });

  const result = await runtime.execute(createTurnInput({ allowedTools: [], maxModelRounds: 2 }));

  assert.equal(result.status, "completed");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.status, "failed");
  assert.equal(broker.executedCount, 0);
  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.failed"]);
});

test("AgentTurnRuntime executes one tool round and returns final model output", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    completedResponse("model-request-final", { summary: "Final answer with tool result." }),
  ]);
  const broker = new PermissionAwareToolBroker(["web_search"]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
    publishToolEvent: (message) => eventLog.append(message),
  });

  const result = await runtime.execute(createTurnInput({ allowedTools: ["web_search"], maxModelRounds: 2 }));

  assert.equal(result.status, "completed");
  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.modelRounds, 2);
  assert.equal(result.toolRounds, 1);
  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
  assert.deepEqual(eventLog.types(), ["tool.requested", "tool.completed"]);
});

test("AgentTurnRuntime completes on no-tool provider stop", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "Agent-owned final answer."),
  ]);
  const broker = new PermissionAwareToolBroker(["web_search"]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runtime.execute(createTurnInput({
    allowedTools: [],
    maxModelRounds: 2,
  }));

  assert.equal(result.status, "completed");
  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.equal(result.finalOutput?.textOutput, "Agent-owned final answer.");
  assert.equal(broker.executedCount, 0);
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), []);
});

test("AgentTurnRuntime exposes allowed external tools without finish_task", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "Plain text is the natural stop signal."),
  ]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new PermissionAwareToolBroker(["web_search"]),
  });

  const result = await runtime.execute(createTurnInput({
    allowedTools: ["web_search"],
    maxModelRounds: 1,
  }));

  assert.equal(result.status, "completed");
  assert.equal(result.stoppedReason, "no_tool_calls");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["web_search"]);
});

test("AgentTurnRuntime completes after a tool round when the model stops calling tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    textResponse("model-request-final", "Final answer after tool result."),
  ]);
  const broker = new PermissionAwareToolBroker(["web_search"]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runtime.execute(createTurnInput({
    allowedTools: ["web_search"],
    maxModelRounds: 3,
  }));

  assert.equal(result.status, "completed");
  assert.equal(result.stoppedReason, "completed");
  assert.equal(result.finalOutput?.textOutput, "Final answer after tool result.");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
});

test("AgentTurnRuntime pauses out_of_fuel when budgets end before provider stop", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
  ]);
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new PermissionAwareToolBroker(["web_search"]),
  });

  const result = await runtime.execute(createTurnInput({
    allowedTools: ["web_search"],
    maxModelRounds: 1,
    maxToolRounds: 2,
  }));

  assert.equal(result.status, "paused");
  assert.equal(result.stoppedReason, "out_of_fuel");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(channel.requests.length, 1);
});

test("AgentTurnRuntime returns approval_required and resumes with a matching confirmation", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-write", "write_file"),
    completedResponse("model-request-final", { summary: "Final answer after approval." }),
  ]);
  const broker = new PermissionAwareToolBroker(["write_file"], { write_file: "read-write" });
  const runtime = new AgentTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
    publishToolEvent: (message) => eventLog.append(message),
  });

  const paused = await runtime.execute(createTurnInput({
    allowedTools: ["write_file"],
    maxModelRounds: 3,
  }));

  assert.equal(paused.status, "approval_required");
  assert.equal(paused.stoppedReason, "approval_required");
  assert.equal(paused.pendingApproval?.confirmationId, "confirmation-call-write");
  assert.equal(broker.executedCount, 0);
  assert.deepEqual(eventLog.types(), ["tool.requested", "user_approval.requested"]);

  const resumed = await runtime.resume({
    pendingApproval: paused.pendingApproval!,
    approvedConfirmationIds: ["confirmation-call-write"],
  });

  assert.equal(resumed.status, "completed");
  assert.equal(resumed.stoppedReason, "completed");
  assert.equal(resumed.toolCalls[0]?.status, "completed");
  assert.equal(broker.executedCount, 1);
});

test("AgentTurnRuntime enforces tool and model round limits", async () => {
  const toolLimitRuntime = new AgentTurnRuntime({
    intelligenceChannel: new SequenceIntelligenceChannel([
      toolCallResponse("model-request-test", "call-search", "web_search"),
    ]),
    toolCenter: new PermissionAwareToolBroker(["web_search"]),
  });
  const toolLimited = await toolLimitRuntime.execute(
    createTurnInput({ allowedTools: ["web_search"], maxToolRounds: 0 })
  );

  assert.equal(toolLimited.status, "paused");
  assert.equal(toolLimited.stoppedReason, "out_of_fuel");
  assert.equal(toolLimited.toolCalls.length, 0);

  const modelLimitChannel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-search", "web_search"),
    completedResponse("unused", { summary: "unused" }),
  ]);
  const modelLimited = await new AgentTurnRuntime({
    intelligenceChannel: modelLimitChannel,
    toolCenter: new PermissionAwareToolBroker(["web_search"]),
  }).execute(createTurnInput({ allowedTools: ["web_search"], maxModelRounds: 1 }));

  assert.equal(modelLimited.status, "paused");
  assert.equal(modelLimited.stoppedReason, "out_of_fuel");
  assert.equal(modelLimited.modelRounds, 1);
  assert.equal(modelLimitChannel.requests.length, 1);
});

test("AgentTurnRuntime and ToolCenter keep kernel/app/underground import boundaries", () => {
  const kernelRuntime = readFileSync("src/kernel/intelligence/agent-turn-runtime.ts", "utf8");
  const toolLoop = readFileSync("src/kernel/intelligence/tool-use-loop.ts", "utf8");

  assert.equal(kernelRuntime.includes("../../app/tool-center"), false);
  assert.equal(toolLoop.includes("../../app/tool-center"), false);

  for (const file of listTypeScriptFiles("src/app/tool-center")) {
    const content = readFileSync(file, "utf8");
    assert.equal(content.includes("../underground"), false, `${file} must not import underground modules`);
    assert.equal(content.includes("../../underground"), false, `${file} must not import underground modules`);
  }
});

function createTurnInput(policyOverrides: Partial<AgentTurnPolicy> = {}) {
  const policy: AgentTurnPolicy = {
    allowModel: true,
    allowedTools: ["web_search"],
    maxModelRounds: 3,
    maxToolRounds: 2,
    fallback: "deterministic",
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
    purpose: "rootlet_candidate",
    outputContract: {
      contractId: "test.candidate.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    ...policyOverrides,
  };
  return {
    policy,
    callerRef: { kind: "goal" as const, id: "goal-test" },
    inputRefs: [{ kind: "goal" as const, id: "goal-test" }],
    sanitizedMessages: [{ role: "user" as const, content: "Build a helper.", ref: "goal-test" }],
    constraintRefs: [],
    requestId: "model-request-test",
    requestedAt: "2026-05-04T00:00:00.000Z",
  };
}

function policyFromManifest(
  manifestPolicy: AgentTurnPermissionPolicy,
  overrides: Partial<AgentTurnPolicy> = {}
): AgentTurnPolicy {
  return {
    ...createTurnInput().policy,
    allowModel: manifestPolicy.allowModel,
    allowedTools: manifestPolicy.allowedTools,
    maxModelRounds: manifestPolicy.maxModelRounds,
    maxToolRounds: manifestPolicy.maxToolRounds,
    fallback: manifestPolicy.fallback,
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

class PermissionAwareToolBroker implements ToolExecutionBroker {
  executedCount = 0;

  constructor(
    private readonly toolNames: readonly string[],
    private readonly operationTypes: Readonly<Record<string, "read-only" | "read-write" | "execute" | "external-submit">> = {}
  ) {}

  list(): ToolDefinition[] {
    return this.toolNames.map((name) => ({
      name,
      description: `${name} test tool`,
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "other",
        riskLevel: this.operationTypes[name] === undefined || this.operationTypes[name] === "read-only" ? "low" : "high",
        operationType: this.operationTypes[name] ?? "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
    }));
  }

  has(name: string): boolean {
    return this.toolNames.includes(name);
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    if (!this.has(request.toolName)) {
      return failedToolResult(request, `Tool is not registered: ${request.toolName}`);
    }
    if (permission?.allowedTools !== undefined && !permission.allowedTools.includes(request.toolName)) {
      return failedToolResult(request, `Tool ${request.toolName} is not allowed.`);
    }
    const operationType = this.operationTypes[request.toolName] ?? "read-only";
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
    this.executedCount += 1;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { ok: true },
      status: "completed",
      durationMs: 1,
    };
  }

  resetCallCount(): void {
    this.executedCount = 0;
  }

  getCallCount(): number {
    return this.executedCount;
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

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listTypeScriptFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
