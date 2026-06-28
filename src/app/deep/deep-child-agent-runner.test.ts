import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { createChildAgentRun, type ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import type { DeepChildSpec } from "./contracts.js";
import { createDeepChildAgentSpec, DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
import { continueDeepChildAgent, resumeDeepChildAgent, runDeepChildAgent } from "./deep-child-agent-runner.js";
import { createDeepTurnRuntime } from "./deep-turn.js";

test("runDeepChildAgent runs the standard model-tool-model loop and preserves the parent-created objective", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "核查 OAuth2 迁移风险，并用工具收集至少一条证据。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search", "search", { query: "OAuth2 migration risk" }),
    completedJsonResponse({
      summary: "风险角度：工具证据表明迁移需要重点处理回调兼容。",
      findings: ["回调兼容性是首要风险"],
      evidenceRefs: ["tool:search:oauth-risk"],
      uncertainty: "仍需结合项目代码确认具体影响面。",
      confidence: 0.72,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.status, "completed");
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.execution.toolRounds, 1);
  assert.equal(result.completedRun.execution?.modelRounds, 2);
  assert.equal(result.completedRun.execution?.toolRounds, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "completed");
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(channel.requests[0]?.budget, {});
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
  assert.equal(result.prompt.objective, childSpec.objective);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes(childSpec.objective)),
    true,
  );
});

test("runDeepChildAgent does not impose default child round budgets when parent omits them", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "连续核查 OAuth2 迁移风险，必要时多次使用工具后再总结。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search-1", "search", { query: "OAuth2 migration callback risk" }),
    toolCallResponse("call-search-2", "search", { query: "OAuth2 migration rollback risk" }),
    completedJsonResponse({
      summary: "风险角度：两轮工具核查后确认回调兼容和回滚路径是主要风险。",
      findings: ["回调兼容性需要迁移前验证", "回滚路径需要保留旧认证入口"],
      evidenceRefs: ["tool:search:callback-risk", "tool:search:rollback-risk"],
      uncertainty: "仍需结合项目代码确认实际接口数量。",
      confidence: 0.76,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.status, "completed");
  assert.equal(result.execution.modelRounds, 3);
  assert.equal(result.execution.toolRounds, 2);
  assert.equal(result.completedRun.execution?.modelRounds, 3);
  assert.equal(result.completedRun.execution?.toolRounds, 2);
  assert.deepEqual(broker.executedToolNames(), ["search", "search"]);
  assert.equal(channel.requests.length, 3);
  assert.deepEqual(channel.requests.map((request) => request.budget), [{}, {}, {}]);
});

test("runDeepChildAgent intersects parent prompt tools with the frozen child run permissions", async () => {
  const parentSpec = sampleChildSpec({
    allowedTools: ["search", "read_file"],
    objective: "尝试通过文件读取和搜索核查风险。",
  });
  const frozenRunSpec = { ...parentSpec, allowedTools: ["search"] };
  const childRun = makeChildRun(frozenRunSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-read", "read_file", { path: "secret.txt" }),
    completedJsonResponse({
      summary: "权限外工具未执行，材料仅记录授权边界。",
      findings: ["read_file 未授权给该 child run"],
      evidenceRefs: [],
      uncertainty: "缺少文件读取证据。",
      confidence: 0.31,
    }),
  ]);
  const broker = new RecordingToolBroker(["search", "read_file"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec: parentSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(broker.executedToolNames(), []);
  assert.equal(result.execution.toolCalls[0]?.toolName, "read_file");
  assert.equal(result.execution.toolCalls[0]?.status, "failed");
  assert.equal(result.summary.status, "completed");
});

test("runDeepChildAgent restores the frozen parent objective when childSpec is omitted", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: [],
    objective: "恢复运行时必须沿用父 Agent 生成的原始子任务目标。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    completedJsonResponse({
      summary: "恢复路径沿用冻结目标完成探索。",
      findings: ["冻结 objective 被注入 child prompt"],
      evidenceRefs: ["child:restored-objective"],
      uncertainty: "无",
      confidence: 0.81,
    }),
  ]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new RecordingToolBroker([]),
  });

  const result = await runDeepChildAgent({
    childRun,
    goal: "评估恢复路径",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.prompt.objective, childSpec.objective);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes(childSpec.objective)),
    true,
  );
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes("Explore from angle")),
    false,
  );
});

test("runDeepChildAgent maps approval_required to a blocked child Agent run", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["write_file"],
    objective: "需要写入文件时先等待用户确认。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-write", "write_file", { path: "notes.md" }),
  ]);
  const broker = new RecordingToolBroker(["write_file"], ["write_file"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "整理迁移风险笔记",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    confirmationPolicy: "prompt",
  });

  assert.equal(result.summary.status, "blocked");
  assert.equal(result.completedRun.status, "blocked");
  assert.equal(result.completedRun.failureReason, "waiting for tool confirmation");
  assert.deepEqual(result.summary.evidenceRefs, ["call-write"]);
  assert.equal(result.execution.toolCalls[0]?.status, "approval_required");
  assert.equal(result.completedRun.execution?.modelRounds, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "approval_required");
  assert.equal(result.completedRun.pendingApproval?.confirmationId, "confirm-call-write");
  assert.equal(result.pendingContinuation?.childRunId, childRun.childRunId);
  assert.equal(result.pendingContinuation?.confirmationId, "confirm-call-write");
  assert.equal(result.pendingContinuation?.pendingApproval.confirmationId, "confirm-call-write");
  assert.equal(result.completedRun.pendingApproval?.toolCallId, "call-write");
  assert.equal(result.completedRun.pendingApproval?.toolName, "write_file");
  assert.equal(result.completedRun.pendingApproval?.title, "需要确认工具调用");
  assert.equal(result.completedRun.pendingApproval?.actionSummary, "运行 write_file");
  assert.deepEqual(result.completedRun.pendingApproval?.affectedResources, ["write_file"]);
  assert.equal(result.completedRun.pendingApproval?.riskLevel, "medium");
  assert.deepEqual(result.completedRun.pendingApproval?.sourceRefs, ["call-write"]);
  assert.equal(channel.requests.length, 1);
});

test("runDeepChildAgent maps unexpected model stop to an interrupted child Agent run", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: [],
    objective: "模型调用异常停止时保留同一个子 Agent，等待父层审查后继续。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    failedModelResponse("provider stopped before child material was produced"),
  ]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new RecordingToolBroker([]),
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估异常停止后的恢复路径",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "interrupted");
  assert.equal(result.completedRun.status, "interrupted");
  assert.match(result.completedRun.failureReason ?? "", /provider stopped/);
  assert.equal(result.execution.modelRounds, 1);
  assert.equal(result.completedRun.executionHistory?.length, 1);
  assert.equal(result.completedRun.executionHistory?.[0]?.outcome, "interrupted");
  assert.equal(result.completedRun.childRunId, childRun.childRunId);
});

test("resumeDeepChildAgent approves a blocked child confirmation and completes the same child run", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["write_file"],
    objective: "确认后继续同一个子 Agent 写入证据并输出材料。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-write", "write_file", { path: "notes.md" }),
    completedJsonResponse({
      summary: "确认后继续执行同一个子 Agent，并补齐写入后的材料。",
      findings: ["写入确认通过后，子 Agent 使用同一条工具 loop 完成材料输出"],
      evidenceRefs: ["tool:write_file:oauth-risk"],
      uncertainty: "仍需父层综合判断是否纳入最终结论。",
      confidence: 0.69,
    }),
  ]);
  const broker = new RecordingToolBroker(["write_file"], ["write_file"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const blocked = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "整理迁移风险笔记",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    confirmationPolicy: "prompt",
  });

  assert.equal(blocked.completedRun.status, "blocked");
  assert.equal(blocked.pendingContinuation?.confirmationId, "confirm-call-write");

  const resumed = await resumeDeepChildAgent({
    childRun: blocked.completedRun,
    childSpec,
    pendingApproval: blocked.pendingContinuation!.pendingApproval,
    decision: { decision: "approve_once" },
    turnRuntime,
  });

  assert.equal(resumed.completedRun.childRunId, childRun.childRunId);
  assert.equal(resumed.summary.status, "completed");
  assert.equal(resumed.completedRun.status, "completed");
  assert.equal(resumed.completedRun.pendingApproval, undefined);
  assert.equal(resumed.execution.modelRounds, 2);
  assert.equal(resumed.execution.toolRounds, 1);
  assert.equal(resumed.completedRun.executionHistory?.length, 2);
  assert.deepEqual(
    resumed.completedRun.executionHistory?.map((segment) => segment.outcome),
    ["blocked", "completed"],
  );
  assert.equal(resumed.completedRun.executionHistory?.[0]?.toolCalls[0]?.status, "approval_required");
  assert.equal(resumed.completedRun.executionHistory?.[1]?.toolCalls[0]?.status, "completed");
  assert.deepEqual(broker.executedToolNames(), ["write_file"]);
  assert.equal(channel.requests.length, 2);
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
});

test("continueDeepChildAgent appends parent instruction and keeps the same child standard loop", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "继续核查 OAuth2 迁移风险，补齐回滚证据。",
  });
  const childRun: ChildAgentRun = {
    ...makeChildRun(childSpec),
    execution: {
      modelRounds: 1,
      toolRounds: 0,
      toolCalls: [],
    },
    executionHistory: [
      {
        modelRounds: 1,
        toolRounds: 0,
        toolCalls: [],
        outcome: "blocked",
        recordedAt: "2026-05-01T00:00:01.000Z",
      },
    ],
    parentInstructions: [
      {
        instructionId: "instruction-risk-1",
        messageRef: "child_message:instruction-risk-1",
        source: "manager",
        status: "queued",
        instructionSummary: "先补齐风险边界。",
        requestedAt: "2026-05-01T00:00:01.500Z",
        queuedAt: "2026-05-01T00:00:01.500Z",
      },
    ],
  };
  const channel = new SequenceChannel([
    toolCallResponse("call-search-followup", "search", { query: "OAuth2 rollback evidence" }),
    completedJsonResponse({
      summary: "继续后补齐了回滚证据，确认需要保留旧认证入口。",
      findings: ["回滚证据显示旧入口保留可降低迁移风险"],
      evidenceRefs: ["tool:search:rollback-evidence"],
      uncertainty: "仍需项目内验证具体入口数量。",
      confidence: 0.74,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker });

  const result = await continueDeepChildAgent({
    childRun,
    childSpec,
    previousSummary: {
      childRunId: childRun.childRunId,
      spec: childSpec,
      status: "blocked",
      summary: "初轮缺少回滚证据。",
      findings: ["需要补证据"],
      evidenceRefs: [],
      uncertainty: "缺少回滚证据。",
      confidence: 0.2,
    },
    parentInstruction: "请沿用同一个子 Agent，重点补齐回滚路径证据。",
    currentParentReview: {
      decision: "needs_followup",
      reason: "父层审查发现初轮材料缺少可执行回滚证据。",
      evidenceRefs: ["child:risk:initial"],
      confidence: 0.63,
    },
    parentMessageHistory: [
      {
        messageRef: "child_message:instruction-risk-0",
        source: "control_api",
        status: "executed",
        content: "上一轮父层原文：先检查旧认证入口是否必须保留。",
        updatedAt: "2026-05-01T00:00:00.500Z",
      },
    ],
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.childRunId, childRun.childRunId);
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.completedRun.executionHistory?.length, 2);
  assert.deepEqual(
    result.completedRun.executionHistory?.map((segment) => segment.outcome),
    ["blocked", "completed"],
  );
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) =>
      message.content.includes("Parent Agent follow-up instruction") &&
      message.content.includes("重点补齐回滚路径证据"),
    ),
    true,
  );
  const continuationPrompt = channel.requests[0]?.sanitizedMessages.find((message) =>
    message.ref === `context:deep:child_parent_instruction:${childRun.childRunId}`,
  )?.content ?? "";
  assert.match(continuationPrompt, /Execution segments so far: 1/);
  assert.match(continuationPrompt, /Execution segment history: 1\.blocked; modelRounds=1; toolRounds=0; toolCalls=\(none\)/);
  assert.match(continuationPrompt, /Latest execution: modelRounds=1; toolRounds=0; toolCalls=\(none\)/);
  assert.match(continuationPrompt, /Current parent review decision: needs_followup/);
  assert.match(continuationPrompt, /Current parent review reason: 父层审查发现初轮材料缺少可执行回滚证据。/);
  assert.match(continuationPrompt, /Current parent review evidence refs: child:risk:initial/);
  assert.match(continuationPrompt, /manager\/queued \(child_message:instruction-risk-1\): 先补齐风险边界。/);
  assert.match(continuationPrompt, /Parent message history \(internal, raw parent-to-child messages\):/);
  assert.match(continuationPrompt, /control_api\/executed \(child_message:instruction-risk-0, 2026-05-01T00:00:00.500Z\): 上一轮父层原文：先检查旧认证入口是否必须保留。/);
});

test("runDeepChildAgent maps invalid child material to failed child run while preserving loop execution facts", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "工具核查后如果材料不合约，也要保留这段子 Agent 运行事实。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search", "search", { query: "OAuth2 migration risk" }),
    completedJsonResponse({
      findings: ["缺少 summary 字段，无法作为有效 child material"],
      evidenceRefs: ["tool:search:invalid-material"],
      uncertainty: "输出结构不完整。",
      confidence: 0.4,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.completedRun.status, "failed");
  assert.match(result.completedRun.failureReason ?? "", /invalid child material/);
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.execution.toolRounds, 1);
  assert.equal(result.completedRun.execution?.modelRounds, 2);
  assert.equal(result.completedRun.execution?.toolRounds, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
});

function sampleChildSpec(input: {
  readonly allowedTools: readonly string[];
  readonly objective: string;
}): DeepChildSpec {
  return {
    specId: "child-spec-risk",
    displayName: "风险视角",
    role: "risk",
    objective: input.objective,
    allowedTools: input.allowedTools,
    inputRefs: ["goal:goal-test"],
  };
}

function makeChildRun(childSpec: DeepChildSpec) {
  const spec = createDeepChildAgentSpec({
    childSpec,
    index: 0,
    goalId: "goal-test",
    traceId: "trace-test",
    createdAt: "2026-05-01T00:00:00.000Z",
  });
  return createChildAgentRun({
    childRunId: "deep-child-run-test",
    parentAgentId: DEEP_MANAGER_AGENT_ID,
    spec,
    inputRefs: spec.inputRefs,
    startedAt: "2026-05-01T00:00:00.000Z",
  });
}

type ResponseStep = (request: ModelRequest) => ModelResponse;

class SequenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly steps: readonly ResponseStep[]) {}

  async request(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    const step = this.steps[this.index];
    this.index += 1;
    if (step === undefined) {
      throw new Error(`Missing test model response at index ${this.index - 1}`);
    }
    return step(request);
  }

  validateResponse(_request: ModelRequest, _response: ModelResponse): ModelOutputValidationResult {
    return pendingModelOutputValidation();
  }
}

class RecordingToolBroker implements ToolExecutionBroker {
  private readonly definitions: readonly ToolDefinition[];
  private readonly executed: ToolCallRequest[] = [];

  constructor(
    toolNames: readonly string[],
    private readonly approvalRequiredToolNames: readonly string[] = [],
  ) {
    this.definitions = toolNames.map((name) => ({
      name,
      description: `${name} test tool`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    }));
  }

  list(): ToolDefinition[] {
    return this.definitions.map((definition) => ({ ...definition }));
  }

  has(name: string): boolean {
    return this.definitions.some((definition) => definition.name === name);
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    const confirmationId = `confirm-${request.callId}`;
    if (
      this.approvalRequiredToolNames.includes(request.toolName) &&
      permission.approvedConfirmationIds?.includes(confirmationId) !== true
    ) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "approval_required",
        durationMs: 1,
        confirmationRequest: {
          confirmationId,
          runId: "deep-child-run-test",
          title: "需要确认工具调用",
          actionSummary: `运行 ${request.toolName}`,
          affectedResources: [request.toolName],
          riskLevel: "medium",
          requestedAt: "2026-05-01T00:00:00.000Z",
          sourceRefs: [request.callId],
        },
      };
    }
    this.executed.push(request);
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: { evidenceRef: `tool:${request.toolName}:oauth-risk` },
      status: "completed",
      durationMs: 1,
    };
  }

  resetCallCount(): void {
    this.executed.length = 0;
  }

  getCallCount(): number {
    return this.executed.length;
  }

  executedToolNames(): readonly string[] {
    return this.executed.map((request) => request.toolName);
  }
}

function toolCallResponse(callId: string, toolName: string, input: unknown): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: `response-${callId}`,
    toolCalls: [{ callId, toolName, input }],
    finishReason: "tool_call",
  });
}

function completedJsonResponse(output: unknown): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: "response-final",
    structuredOutput: output,
    finishReason: "stop",
  });
}

function failedModelResponse(message: string): ResponseStep {
  return (request) => ({
    ...baseResponse(request),
    responseId: "response-failed",
    status: "failed",
    finishReason: "error",
    failure: {
      kind: "provider_response",
      retryable: true,
      message,
      sanitizedErrorRef: "model-error:provider_response",
    },
  });
}

function baseResponse(request: ModelRequest): ModelResponse {
  return {
    responseId: "response-test",
    requestId: request.requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: request.outputContract.outputKind,
    validation: pendingModelOutputValidation(),
    completedAt: "2026-05-01T00:00:01.000Z",
  };
}
