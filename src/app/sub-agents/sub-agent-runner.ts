import { isToolLifecycleMessageType, type ArborMessage } from "../../domain/common.js";
import type {
  IntelligenceChannel,
  ModelMessage,
  ModelOutputContract,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/contracts.js";
import type {
  SubAgentModelExchange,
  SubAgentRunTrace,
  SubAgentRunTraceSink,
  SubAgentToolTrace,
} from "../../domain/sub-agents/contracts.js";
import type { ToolCallResult } from "../../domain/tools/contracts.js";
import type { ToolConfirmationPolicy, ToolExecutionBroker } from "../../domain/tools/contracts.js";
import type {
  AgentTurnPendingApproval,
  AgentTurnPolicy,
  AgentTurnRuntimeResult,
} from "../../kernel/intelligence/agent-turn-runtime.js";
import { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { createId, nowIso } from "../../kernel/id.js";
import {
  createSubAgentCompletedMessage,
  createSubAgentStartedMessage,
} from "./sub-agent-events.js";
import type { SubAgentDefinition } from "./sub-agent-loader.js";
import { loadSubAgentBody } from "./sub-agent-loader.js";

const SUB_AGENT_OUTPUT_CONTRACT_ID = "sub_agent.free_text.v1";
const SUB_AGENT_TURN_SEMANTICS = {
  blockedToolNames: [],
  exposeNonFinalOutput: false,
} as const;
export const SUB_AGENT_DEFAULT_MAX_STEPS = 30;
const DISPLAY_SUMMARY_MAX_CHARS = 500;
const SUB_AGENT_TOOL_NAMES = new Set([
  "call_sub_agent",
  "call_sub_agents",
  "spawn_sub_agent",
  "read_sub_agent_output",
]);

export type SubAgentRunnerInput = {
  readonly subAgent: SubAgentDefinition;
  readonly task: string;
  readonly context?: string;
  readonly parentRunId?: string;
  readonly parentToolCallId?: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly conversationId?: string;
  readonly toolBroker: ToolExecutionBroker;
  readonly channel: IntelligenceChannel;
  readonly allowedTools: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly publishToolEvent?: (message: ArborMessage) => void;
  readonly traceSink?: SubAgentRunTraceSink;
  readonly pendingApproval?: AgentTurnPendingApproval;
  readonly approvedConfirmationIds?: readonly string[];
  readonly policyOverrides?: Partial<AgentTurnPolicy>;
  readonly abortSignal?: AbortSignal;
  readonly eventLog?: { append: (message: ArborMessage) => void };
};

export type SubAgentRunnerResult = {
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly summary: string;
  readonly fullOutput?: string;
  readonly toolCalls: number;
  readonly modelRounds: number;
  readonly durationMs: number;
  readonly runId?: string;
  readonly error?: string;
  readonly pendingApproval?: AgentTurnPendingApproval;
  readonly trace?: SubAgentRunTrace;
};

export async function runSubAgent(input: SubAgentRunnerInput): Promise<SubAgentRunnerResult> {
  const startTime = Date.now();
  const startedAt = nowIso();
  const runId = input.pendingApproval?.policy.goalId ?? createId("sub-agent-run");
  const traceId = input.conversationId ?? input.pendingApproval?.policy.traceId ?? runId;
  const recorder = new SubAgentTraceRecorder({
    subRunId: runId,
    parentRunId: input.parentRunId,
    parentToolCallId: input.parentToolCallId,
    batchId: input.batchId,
    batchIndex: input.batchIndex,
    subAgentId: input.subAgent.id,
    subAgentName: input.subAgent.name,
    task: input.task,
    context: input.context,
    startedAt,
  });

  input.eventLog?.append(
    createSubAgentStartedMessage({
      traceId,
      runId: input.parentRunId ?? traceId,
      subRunId: runId,
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      task: input.task,
      parentRunId: input.parentRunId,
      timestamp: nowIso(),
    })
  );

  let result: SubAgentRunnerResult;

  try {
    const systemPrompt = await buildSubAgentSystemPrompt(input.subAgent);
    const messages: readonly ModelMessage[] = [
      {
        role: "system",
        ref: `sub-agent:system:${input.subAgent.id}`,
        content: systemPrompt,
      },
      {
        role: "user",
        ref: `sub-agent:task:${input.subAgent.id}`,
        content: buildSubAgentTaskMessage(input.task, input.context),
      },
    ];

    const policy = buildSubAgentPolicy({
      subAgent: input.subAgent,
      traceId,
      runId,
      allowedTools: input.allowedTools,
      confirmationPolicy: input.confirmationPolicy,
      overrides: input.policyOverrides,
    });

    const turnRuntime = new AgentTurnRuntime({
      intelligenceChannel: recorder.wrapChannel(input.channel),
      toolCenter: input.toolBroker,
      publishToolEvent: (message) => {
        recorder.observeToolEvent(message);
        input.publishToolEvent?.(message);
      },
    });

    const callerRef = {
      kind: "agent_run" as const,
      id: runId,
      label: `sub_agent:${input.subAgent.id}`,
    };

    const turn = input.pendingApproval === undefined
      ? await turnRuntime.execute({
          policy,
          callerRef,
          inputRefs: [],
          sanitizedMessages: messages,
          constraintRefs: [],
          toolChoice: "auto",
          requestedAt: nowIso(),
          abortSignal: input.abortSignal,
        }, SUB_AGENT_TURN_SEMANTICS)
      : await turnRuntime.resume({
          pendingApproval: input.pendingApproval,
          approvedConfirmationIds: input.approvedConfirmationIds ?? [],
          abortSignal: input.abortSignal,
        }, SUB_AGENT_TURN_SEMANTICS);

    result = buildResultFromTurn({
      turn,
      runId,
      startTime,
      subAgentId: input.subAgent.id,
    });
    recorder.observeToolResults(turn.toolCalls);
  } catch (error) {
    result = {
      status: "failed",
      summary: `子 Agent 执行异常: ${errorMessage(error)}`,
      toolCalls: 0,
      modelRounds: 0,
      durationMs: Date.now() - startTime,
      runId,
      error: errorMessage(error),
    };
  }

  const trace = recorder.finalize({
    status: result.status,
    summary: result.summary,
    fullOutput: result.fullOutput,
    error: result.error,
    toolCalls: result.toolCalls,
    modelRounds: result.modelRounds,
    durationMs: result.durationMs,
  });
  input.traceSink?.upsert(trace);
  result = {
    ...result,
    trace,
  };

  input.eventLog?.append(
    createSubAgentCompletedMessage({
      traceId,
      runId: input.parentRunId ?? traceId,
      subRunId: runId,
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      status: result.status,
      summary: result.summary,
      toolCalls: result.toolCalls,
      modelRounds: result.modelRounds,
      durationMs: result.durationMs,
      timestamp: nowIso(),
    })
  );

  return result;
}

type SubAgentTraceRecorderInput = {
  readonly subRunId: string;
  readonly parentRunId?: string;
  readonly parentToolCallId?: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly subAgentId: string;
  readonly subAgentName: string;
  readonly task: string;
  readonly context?: string;
  readonly startedAt: string;
};

class SubAgentTraceRecorder {
  private readonly input: SubAgentTraceRecorderInput;
  private readonly exchanges = new Map<string, SubAgentModelExchange>();
  private readonly tools = new Map<string, SubAgentToolTrace>();

  constructor(input: SubAgentTraceRecorderInput) {
    this.input = input;
  }

  wrapChannel(channel: IntelligenceChannel): IntelligenceChannel {
    return {
      request: async (request: ModelRequest, options?: ModelRequestOptions): Promise<ModelResponse> => {
        this.recordRequest(request);
        const response = await channel.request(request, options);
        this.recordResponse(response);
        return response;
      },
      validateResponse: (request, response) => channel.validateResponse(request, response),
    };
  }

  observeToolEvent(message: ArborMessage): void {
    if (!isToolLifecycleMessageType(message.type)) {
      return;
    }
    const payload = asRecord(message.payload);
    const callId = stringFrom(payload.callId) ?? stringFrom(payload.requestId);
    const toolName = stringFrom(payload.toolName);
    if (callId === undefined || toolName === undefined) {
      return;
    }
    const previous = this.tools.get(callId);
    if (message.type === "tool.requested") {
      this.tools.set(callId, {
        ...previous,
        callId,
        toolName,
        input: payload.input ?? previous?.input,
        status: "requested",
        startedAt: previous?.startedAt ?? message.createdAt,
      });
      return;
    }
    const output = asRecord(payload.output);
    const status = toolStatusFromEvent(message.type, output.status);
    this.tools.set(callId, {
      ...previous,
      callId,
      toolName,
      input: previous?.input ?? payload.input,
      status,
      startedAt: previous?.startedAt,
      completedAt: message.createdAt,
      durationMs: numberFrom(payload.durationMs) ?? numberFrom(output.durationMs) ?? previous?.durationMs,
      confirmationId: stringFrom(asRecord(output.confirmationRequest).confirmationId) ?? previous?.confirmationId,
      outputSummary: stringFrom(output.summary) ?? previous?.outputSummary,
      error: stringFrom(payload.error) ?? stringFrom(output.error) ?? previous?.error,
      errorFacts: toolErrorFactsFrom(output.errorFacts) ?? previous?.errorFacts,
    });
  }

  observeToolResults(results: readonly ToolCallResult[]): void {
    for (const result of results) {
      const previous = this.tools.get(result.callId);
      this.tools.set(result.callId, {
        ...previous,
        callId: result.callId,
        toolName: result.toolName,
        input: previous?.input ?? result.input,
        status: result.status === "approval_required" ? "approval_required" : result.status,
        startedAt: previous?.startedAt,
        completedAt: previous?.completedAt,
        durationMs: result.durationMs,
        confirmationId: result.confirmationRequest?.confirmationId ?? previous?.confirmationId,
        outputSummary: stringFrom(asRecord(result.output).summary) ?? previous?.outputSummary,
        error: result.error ?? previous?.error,
        errorFacts: result.errorFacts ?? previous?.errorFacts,
      });
    }
  }

  finalize(input: {
    readonly status: SubAgentRunnerResult["status"];
    readonly summary: string;
    readonly fullOutput?: string;
    readonly error?: string;
    readonly toolCalls: number;
    readonly modelRounds: number;
    readonly durationMs: number;
  }): SubAgentRunTrace {
    const completedAt = nowIso();
    return {
      ...this.input,
      status: input.status,
      completedAt,
      durationMs: input.durationMs,
      modelRounds: input.modelRounds,
      toolCalls: input.toolCalls,
      summary: input.summary,
      fullOutput: input.fullOutput,
      error: input.error,
      modelExchanges: [...this.exchanges.values()],
      toolTraces: [...this.tools.values()],
    };
  }

  private recordRequest(request: ModelRequest): void {
    this.exchanges.set(request.requestId, {
      requestId: request.requestId,
      status: "requested",
      purpose: request.purpose,
      requestedAt: request.requestedAt,
      messages: request.sanitizedMessages.map(cloneModelMessage),
      tools: (request.tools ?? []).map((tool) => tool.name),
      toolCalls: [],
    });
  }

  private recordResponse(response: ModelResponse): void {
    const previous = this.exchanges.get(response.requestId);
    this.exchanges.set(response.requestId, {
      requestId: response.requestId,
      responseId: response.responseId,
      status: response.status,
      purpose: previous?.purpose,
      requestedAt: previous?.requestedAt ?? response.completedAt,
      completedAt: response.completedAt,
      messages: previous?.messages ?? [],
      tools: previous?.tools ?? [],
      textOutput: response.textOutput ?? response.assistantMessage?.content,
      toolCalls: (response.toolCalls ?? []).map((call) => ({
        callId: call.callId,
        toolName: call.toolName,
        input: cloneUnknown(call.input),
      })),
      failureKind: response.failure?.kind,
      failureMessage: response.failure?.message,
      retryable: response.failure?.retryable,
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }
}

async function buildSubAgentSystemPrompt(subAgent: SubAgentDefinition): Promise<string> {
  const body = subAgent.inlineSystemPrompt ?? await loadSubAgentBody(subAgent);
  const basePrompt = body.trim().length > 0 ? body : subAgent.description;

  const sections: string[] = [];

  sections.push(basePrompt);
  sections.push("");
  sections.push(`你是「${subAgent.name}」专家，正在被主 Agent 调用执行子任务。`);
  sections.push(`你的角色是: ${subAgent.description}`);

  sections.push("");
  sections.push("## 执行要求");
  sections.push("1. 专注完成上述子任务，不要超出范围");
  sections.push("2. 可以使用分配给你的工具来获取信息和执行操作");
  sections.push("3. 在最终回复中提供清晰、完整的结果");
  sections.push("4. 如果遇到无法解决的问题，如实说明原因");

  return sections.join("\n");
}

function buildSubAgentTaskMessage(task: string, context?: string): string {
  const sections: string[] = [];

  sections.push("## 任务描述");
  sections.push(task.trim());

  if (context !== undefined && context.trim().length > 0) {
    sections.push("");
    sections.push("## 额外上下文");
    sections.push(context.trim());
  }

  return sections.join("\n");
}

function buildSubAgentPolicy(input: {
  readonly subAgent: SubAgentDefinition;
  readonly traceId: string;
  readonly runId: string;
  readonly allowedTools: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly overrides?: Partial<AgentTurnPolicy>;
}): AgentTurnPolicy {
  const allowedTools = effectiveSubAgentAllowedTools({
    parentAllowedTools: input.allowedTools,
    subAgentAllowedTools: input.subAgent.allowedTools,
  });

  const maxSteps = normalizeOptionalRoundLimit(input.subAgent.maxSteps) ?? SUB_AGENT_DEFAULT_MAX_STEPS;

  const basePolicy: AgentTurnPolicy = {
    allowModel: true,
    allowedTools,
    maxModelRounds: maxSteps,
    maxToolRounds: maxSteps,
    confirmationPolicy: input.confirmationPolicy,
    fallback: "disabled",
    callerAgentId: `sub-agent:${input.subAgent.id}`,
    traceId: input.traceId,
    goalId: input.runId,
    purpose: "desktop_agent",
    outputContract: freeTextOutputContract(),
    sensitivity: "internal",
    budget: {},
  };

  const overrides = input.overrides ?? {};
  return {
    ...basePolicy,
    ...overrides,
    allowedTools,
    callerAgentId: basePolicy.callerAgentId,
    traceId: basePolicy.traceId,
    goalId: basePolicy.goalId,
    purpose: basePolicy.purpose,
    outputContract: basePolicy.outputContract,
  };
}

function effectiveSubAgentAllowedTools(input: {
  readonly parentAllowedTools: readonly string[];
  readonly subAgentAllowedTools: readonly string[];
}): readonly string[] {
  const inherited = uniqueToolNames(input.parentAllowedTools)
    .filter((toolName) => !SUB_AGENT_TOOL_NAMES.has(toolName));
  const declared = uniqueToolNames(input.subAgentAllowedTools)
    .filter((toolName) => !SUB_AGENT_TOOL_NAMES.has(toolName));
  if (declared.length === 0) {
    return inherited;
  }
  const declaredSet = new Set(declared);
  return inherited.filter((toolName) => declaredSet.has(toolName));
}

function uniqueToolNames(values: readonly string[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const toolName = value.trim();
    if (toolName.length === 0 || seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    names.push(toolName);
  }
  return names;
}

function freeTextOutputContract(): ModelOutputContract {
  return {
    contractId: SUB_AGENT_OUTPUT_CONTRACT_ID,
    outputKind: "explanation",
    format: "text",
  };
}

function buildResultFromTurn(input: {
  readonly turn: AgentTurnRuntimeResult;
  readonly runId: string;
  readonly startTime: number;
  readonly subAgentId: string;
}): SubAgentRunnerResult {
  const durationMs = Date.now() - input.startTime;
  const toolCalls = input.turn.toolCalls.length;
  const modelRounds = input.turn.modelRounds;

  const fullOutput = extractTextOutput(input.turn);
  const summary = generateSummary(fullOutput, input.turn);

  if (input.turn.status === "cancelled" || input.turn.stoppedReason === "cancelled") {
    return {
      status: "cancelled",
      summary: summary || "子 Agent 执行已取消",
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
    };
  }

  if (input.turn.status === "approval_required") {
    return {
      status: "approval_required",
      summary: summary || "子 Agent 需要工具确认才能继续",
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
      pendingApproval: input.turn.pendingApproval,
    };
  }

  if (isFailedTurn(input.turn)) {
    const error = extractError(input.turn);
    return {
      status: "failed",
      summary: summary || `子 Agent 执行失败: ${error}`,
      fullOutput,
      toolCalls,
      modelRounds,
      durationMs,
      runId: input.runId,
      error,
    };
  }

  return {
    status: "completed",
    summary,
    fullOutput,
    toolCalls,
    modelRounds,
    durationMs,
    runId: input.runId,
  };
}

function isFailedTurn(turn: AgentTurnRuntimeResult): boolean {
  if (turn.status === "failed") {
    return true;
  }
  if (turn.status === "approval_required") {
    return false;
  }
  if (turn.status === "paused") {
    return true;
  }
  if (turn.status === "completed" && turn.finalOutput?.status === "failed") {
    return true;
  }
  return false;
}

function extractTextOutput(turn: AgentTurnRuntimeResult): string | undefined {
  const output = turn.finalOutput;
  if (output === undefined) {
    return undefined;
  }
  if (output.textOutput !== undefined) {
    return output.textOutput;
  }
  if (output.assistantMessage?.content !== undefined) {
    return output.assistantMessage.content;
  }
  return undefined;
}

function generateSummary(fullOutput: string | undefined, turn: AgentTurnRuntimeResult): string {
  if (fullOutput !== undefined && fullOutput.trim().length > 0) {
    const trimmed = fullOutput.trim();
    if (trimmed.length <= DISPLAY_SUMMARY_MAX_CHARS) {
      return trimmed;
    }
    if (turn.status === "cancelled" || turn.stoppedReason === "cancelled") {
      return `子 Agent 已取消，保留完整输出（${trimmed.length} 字）。`;
    }
    if (turn.status === "approval_required") {
      return `子 Agent 等待确认，已保留当前完整输出（${trimmed.length} 字）。`;
    }
    if (isFailedTurn(turn)) {
      return `子 Agent 未完成，保留完整输出（${trimmed.length} 字）。`;
    }
    return `子 Agent 已完成，完整输出 ${trimmed.length} 字。`;
  }

  if (turn.status === "cancelled" || turn.stoppedReason === "cancelled") {
    return "子 Agent 执行已取消";
  }

  if (turn.stoppedReason === "out_of_fuel") {
    return "子 Agent 达到最大步数限制，未能完成任务";
  }

  if (turn.stoppedReason === "context_overflow") {
    return "子 Agent 上下文溢出，未能完成任务";
  }

  if (turn.stoppedReason === "model_failed") {
    return "子 Agent 模型调用失败";
  }

  if (turn.stoppedReason === "runtime_error") {
    return "子 Agent 运行时错误";
  }

  if (turn.status === "approval_required") {
    return "子 Agent 需要工具确认才能继续";
  }

  return "子 Agent 执行完毕";
}

function extractError(turn: AgentTurnRuntimeResult): string {
  const output = turn.finalOutput;
  if (output?.failure?.message !== undefined) {
    return output.failure.message;
  }
  if (turn.stoppedReason === "out_of_fuel") {
    return "达到最大步数限制";
  }
  if (turn.stoppedReason === "context_overflow") {
    return "上下文溢出";
  }
  if (turn.stoppedReason === "model_failed") {
    return "模型调用失败";
  }
  if (turn.stoppedReason === "runtime_error") {
    return "运行时错误";
  }
  if (turn.status === "approval_required") {
    return "需要工具确认";
  }
  return `未知错误 (status=${turn.status}, reason=${turn.stoppedReason})`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    attachments: message.attachments?.map(cloneUnknown),
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : cloneUnknown(message.protocolExtensions) as Readonly<Record<string, unknown>>,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      input: cloneUnknown(toolCall.input),
    })),
  };
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return globalThis.structuredClone(value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolStatusFromEvent(
  type: ArborMessage["type"],
  outputStatus: unknown
): SubAgentToolTrace["status"] {
  if (outputStatus === "approval_required") {
    return "approval_required";
  }
  if (type === "tool.completed") {
    return "completed";
  }
  if (type === "tool.cancelled") {
    return "cancelled";
  }
  return "failed";
}

function toolErrorFactsFrom(value: unknown): SubAgentToolTrace["errorFacts"] | undefined {
  const facts = asRecord(value);
  return Object.keys(facts).length === 0 ? undefined : facts as SubAgentToolTrace["errorFacts"];
}

function normalizeOptionalRoundLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}
