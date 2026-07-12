/**
 * Maps a deep child model turn into its durable child-run result.
 *
 * The runner owns model execution and continuation storage. This module owns
 * the domain transition, failure facts, trace projection, and prompt/spec
 * projection that must remain identical for initial and resumed turns.
 */
import type {
  ChildAgentRun,
  ChildAgentRunExecution,
  ChildAgentRunFailureDetail,
  ChildAgentRunPendingApproval,
} from "../../domain/underground/agent-fabric.js";
import {
  blockChildAgentRun,
  completeChildAgentRun,
  failChildAgentRun,
  interruptChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntimeResult } from "../../kernel/intelligence/agent-turn-runtime.js";
import { nowIso } from "../../kernel/id.js";
import type { DeepChildSpec, DeepChildSummary } from "./contracts.js";
import {
  DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
  DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
  DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
  normalizeDeepChildRoundLimit,
  type DeepChildAgentPrompt,
  type DeepChildAgentRunResult,
} from "./deep-child-run-contracts.js";

export type DeepChildTurnDisposition =
  | "output_validation_failure"
  | "blocked"
  | "interrupted"
  | "completed"
  | "unexpected";

export function classifyDeepChildTurn(turn: AgentTurnRuntimeResult): DeepChildTurnDisposition {
  if (turn.status === "failed" &&
    turn.stoppedReason === "model_failed" &&
    turn.finalOutput?.failure?.kind === "output_validation") {
    return "output_validation_failure";
  }
  if (turn.status === "approval_required" ||
    (turn.status === "paused" && (
      turn.stoppedReason === "out_of_fuel" ||
      turn.stoppedReason === "context_overflow"
    ))) {
    return "blocked";
  }
  if (turn.status === "cancelled" ||
    turn.stoppedReason === "cancelled" ||
    (turn.status === "failed" && (
      turn.stoppedReason === "model_failed" ||
      turn.stoppedReason === "runtime_error"
    ) && turn.finalOutput?.failure?.kind !== "output_validation")) {
    return "interrupted";
  }
  return turn.status === "completed" && turn.finalOutput?.status === "completed"
    ? "completed"
    : "unexpected";
}

export function buildCompletedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly summary: DeepChildSummary;
  readonly turn: AgentTurnRuntimeResult;
  readonly completedAt: string;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const execution = executionStatsFromTurn(input.turn);
  const completedRun = completeChildAgentRun({
    run: input.childRun,
    outputRefs: input.summary.evidenceRefs.slice(0, 6),
    evidenceRefs: input.summary.evidenceRefs,
    confidence: input.summary.confidence,
    uncertainty: input.summary.uncertainty,
    execution,
    completedAt: input.completedAt,
  });
  return {
    summary: withSummaryRuntimeDetails(input.summary, {
      continuationContextRef: input.continuationContextRef,
    }),
    completedRun: withChildRunRuntimeDetails(completedRun, {
      continuationContextRef: input.continuationContextRef,
    }),
    prompt: promptFromChildSpec(input.childSpec),
    execution,
  };
}

export function buildBlockedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly blockedAt: string;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const block = describeBlockedTurn(input.turn);
  const evidenceRefs = input.turn.toolCalls.map((call) => call.callId);
  const execution = executionStatsFromTurn(input.turn);
  const blockedRun = withChildRunRuntimeDetails(blockChildAgentRun({
    run: input.childRun,
    reason: block.reason,
    evidenceRefs,
    confidence: 0,
    uncertainty: block.uncertainty,
    execution,
    pendingApproval: pendingApprovalFromTurn(input.turn),
    blockedAt: input.blockedAt,
  }), {
    continuationContextRef: input.continuationContextRef,
  });
  return {
    summary: withSummaryRuntimeDetails({
      childRunId: input.childRun.childRunId,
      spec: input.childSpec,
      status: "blocked",
      summary: block.summary,
      findings: block.findings,
      evidenceRefs,
      confidence: 0,
      uncertainty: block.uncertainty,
    }, {
      continuationContextRef: input.continuationContextRef,
    }),
    completedRun: blockedRun,
    prompt: promptFromChildSpec(input.childSpec),
    execution,
    pendingContinuation: input.turn.pendingApproval === undefined
      ? undefined
      : {
          childRunId: input.childRun.childRunId,
          confirmationId: input.turn.pendingApproval.confirmationId,
          childRun: blockedRun,
          childSpec: input.childSpec,
          pendingApproval: input.turn.pendingApproval,
        },
  };
}

export function buildInterruptedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly turn: AgentTurnRuntimeResult;
  readonly interruptedAt: string;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const failureDetail = failureDetailFromTurn(input.turn);
  const execution = executionStatsFromTurn(input.turn);
  const evidenceRefs = input.turn.toolCalls.map((call) => call.callId);
  const interruptedRun = withChildRunRuntimeDetails(interruptChildAgentRun(
    input.childRun,
    failureDetail.message,
    input.interruptedAt,
    execution,
  ), {
    failureDetail,
    continuationContextRef: input.continuationContextRef,
  });
  return {
    summary: withSummaryRuntimeDetails({
      childRunId: input.childRun.childRunId,
      spec: input.childSpec,
      status: "interrupted",
      summary: interruptedChildSummary(failureDetail),
      findings: [],
      evidenceRefs,
      confidence: 0,
      uncertainty: "This child Agent did not produce governed child material before the loop stopped; the parent can review and continue the same child run.",
    }, {
      failureDetail,
      continuationContextRef: input.continuationContextRef,
    }),
    completedRun: interruptedRun,
    prompt: promptFromChildSpec(input.childSpec),
    execution,
  };
}

export function buildFailedDeepChildAgentRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly reason: string;
  readonly failedAt: string;
  readonly execution?: ChildAgentRunExecution;
  readonly failureDetail?: ChildAgentRunFailureDetail;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  const childSpec = resolveRuntimeChildSpec({ childRun: input.childRun, childSpec: input.childSpec });
  const failedRun = withChildRunRuntimeDetails(
    failChildAgentRun(input.childRun, input.reason, input.failedAt, input.execution),
    {
      failureDetail: input.failureDetail,
      continuationContextRef: input.continuationContextRef,
    },
  );
  const trimmedReason = input.reason.trim().length > 0 ? input.reason.trim() : "unknown exploration error";
  return {
    summary: withSummaryRuntimeDetails({
      childRunId: input.childRun.childRunId,
      spec: childSpec,
      status: "failed",
      summary: `Child Agent run failed: ${trimmedReason}`,
      findings: [],
      evidenceRefs: [],
      confidence: 0,
      uncertainty: `This child Agent run failed (${trimmedReason}); no usable evidence collected.`,
    }, {
      failureDetail: input.failureDetail,
      continuationContextRef: input.continuationContextRef,
    }),
    completedRun: failedRun,
    prompt: promptFromChildSpec(childSpec),
    execution: input.execution ?? {
      modelRounds: 0,
      toolRounds: 0,
      toolCalls: [],
    },
  };
}

export function buildInvalidDeepChildMaterialRun(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly reason: string;
  readonly failedAt: string;
  readonly turn: AgentTurnRuntimeResult;
  readonly continuationContextRef?: string;
}): DeepChildAgentRunResult {
  return buildFailedDeepChildAgentRun({
    childRun: input.childRun,
    childSpec: input.childSpec,
    reason: `invalid child material: ${input.reason}`,
    failedAt: input.failedAt,
    execution: executionStatsFromTurn(input.turn),
    failureDetail: {
      layer: "output_validation",
      failureKind: "invalid_child_material",
      retryable: false,
      message: input.reason,
    },
    continuationContextRef: input.continuationContextRef,
  });
}

export function invalidOutputFailureReason(failureDetail: ChildAgentRunFailureDetail): string {
  const message = failureDetail.message.trim();
  return message.length === 0
    ? "invalid child material: output validation failed"
    : `invalid child material: ${message}`;
}

export function failureDetailFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunFailureDetail {
  if (turn.status === "cancelled" || turn.stoppedReason === "cancelled") {
    return {
      layer: "user_or_parent",
      failureKind: "cancelled",
      retryable: false,
      message: "child Agent loop was cancelled",
    };
  }
  const failure = turn.finalOutput?.failure;
  const message = failure?.message?.trim();
  if (failure?.kind === "output_validation") {
    return {
      layer: "output_validation",
      failureKind: failure.kind,
      retryable: failure.retryable,
      message: message && message.length > 0 ? message : "child Agent output validation failed",
    };
  }
  if (turn.stoppedReason === "runtime_error") {
    return {
      layer: "agent_runtime",
      failureKind: failure?.kind ?? "runtime_error",
      retryable: failure?.retryable,
      message: message && message.length > 0 ? message : "child Agent runtime stopped unexpectedly",
    };
  }
  if (turn.stoppedReason === "model_failed") {
    return {
      layer: "model_provider",
      failureKind: failure?.kind ?? "provider_response",
      retryable: failure?.retryable,
      message: message && message.length > 0 ? message : "child Agent model call stopped unexpectedly",
    };
  }
  return {
    layer: "unknown",
    failureKind: turn.stoppedReason,
    retryable: false,
    message: `child Agent loop stopped unexpectedly (${turn.stoppedReason})`,
  };
}

export function resolveRuntimeChildSpec(input: {
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
}): DeepChildSpec {
  const delegated = input.childSpec;
  return {
    ...delegated,
    allowedTools: intersectPreserveLeftOrder(
      delegated.allowedTools,
      input.childRun.spec.permissions.allowedTools,
    ),
    inputRefs: uniqueStrings([...delegated.inputRefs, ...input.childRun.inputRefs]),
    maxModelRounds: optionalDeepChildRoundLimit(
      delegated.maxModelRounds ?? input.childRun.spec.permissions.maxModelRounds ?? input.childRun.spec.budget.maxModelRounds,
      DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
    ),
    maxToolRounds: optionalDeepChildRoundLimit(
      delegated.maxToolRounds ?? input.childRun.spec.permissions.maxToolRounds ?? input.childRun.spec.budget.maxToolRounds,
      DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
    ),
  };
}

export function executionStatsFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunExecution {
  return {
    modelRounds: turn.modelRounds,
    toolRounds: turn.toolRounds,
    modelRequestId: turn.modelRequestId,
    modelResponseId: turn.modelResponseId,
    modelMessages: turn.modelResponses.map((response) => ({
      requestId: response.requestId,
      responseId: response.responseId,
      status: response.status,
      text: response.text,
      reasoningSummary: response.reasoningSummary,
      toolCallIds: [...response.toolCallIds],
      finishReason: response.finishReason,
      completedAt: response.completedAt,
    })),
    toolCalls: turn.toolCalls.map((toolCall) => {
      const summary = toolCallSummary(toolCall);
      const inputSummary = summarizeToolInput(toolCall.input);
      return {
        callId: toolCall.callId,
        toolName: toolCall.toolName,
        status: toolCall.status,
        ...(summary === undefined ? {} : { summary }),
        ...(inputSummary === undefined ? {} : { inputSummary }),
        durationMs: toolCall.durationMs,
      };
    }),
  };
}

function promptFromChildSpec(childSpec: DeepChildSpec): DeepChildAgentPrompt {
  return {
    templateId: DEEP_CHILD_AGENT_PROMPT_TEMPLATE_ID,
    objective: childSpec.objective,
    role: childSpec.role,
    displayName: childSpec.displayName,
    inputRefs: [...childSpec.inputRefs],
  };
}

function withChildRunRuntimeDetails(
  run: ChildAgentRun,
  details: {
    readonly failureDetail?: ChildAgentRunFailureDetail;
    readonly continuationContextRef?: string;
  },
): ChildAgentRun {
  return {
    ...run,
    failureDetail: details.failureDetail ?? run.failureDetail,
    continuationContextRef: details.continuationContextRef ?? run.continuationContextRef,
  };
}

function withSummaryRuntimeDetails(
  summary: DeepChildSummary,
  details: {
    readonly failureDetail?: ChildAgentRunFailureDetail;
    readonly continuationContextRef?: string;
  },
): DeepChildSummary {
  return {
    ...summary,
    failureDetail: details.failureDetail ?? summary.failureDetail,
    continuationContextRef: details.continuationContextRef ?? summary.continuationContextRef,
  };
}

function interruptedChildSummary(failureDetail: ChildAgentRunFailureDetail): string {
  switch (failureDetail.failureKind) {
    case "provider_network":
      return `模型通道暂时中断：${failureDetail.message}`;
    case "provider_timeout":
      return `模型通道请求超时：${failureDetail.message}`;
    case "provider_rate_limit":
      return `模型通道被限流：${failureDetail.message}`;
    case "cancelled":
      return `子 Agent 已取消：${failureDetail.message}`;
    default:
      return failureDetail.layer === "agent_runtime"
        ? `子 Agent 运行时异常：${failureDetail.message}`
        : `模型通道异常：${failureDetail.message}`;
  }
}

function describeBlockedTurn(turn: AgentTurnRuntimeResult): {
  readonly reason: string;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly uncertainty: string;
} {
  if (turn.status === "approval_required") {
    const approvalTools = uniqueStrings(
      turn.toolCalls
        .filter((call) => call.status === "approval_required")
        .map((call) => call.toolName),
    );
    const toolList = approvalTools.length === 0 ? "tool" : approvalTools.join(", ");
    return {
      reason: "waiting for tool confirmation",
      summary: `Child Agent blocked: waiting for confirmation to use ${toolList}.`,
      findings: [`Waiting for tool confirmation: ${toolList}.`],
      uncertainty: "This child Agent needs confirmation before it can continue its standard tool loop.",
    };
  }
  if (turn.stoppedReason === "context_overflow") {
    return {
      reason: "context overflow",
      summary: "Child Agent blocked: context overflow prevented completion.",
      findings: ["Context overflow prevented this child Agent from producing a final material summary."],
      uncertainty: "The child Agent needs a smaller context or better context maintenance before continuing.",
    };
  }
  return {
    reason: "round budget exhausted",
    summary: "达到探索上限，可基于已保留上下文继续或综合。",
    findings: ["The child Agent reached its model/tool exploration limit before producing final material."],
    uncertainty: "The parent Agent can continue this same child from preserved context or synthesize from available material.",
  };
}

function optionalDeepChildRoundLimit(value: number | undefined, maxValue: number): number | undefined {
  return value === undefined ? undefined : normalizeDeepChildRoundLimit(value, maxValue);
}

function pendingApprovalFromTurn(turn: AgentTurnRuntimeResult): ChildAgentRunPendingApproval | undefined {
  const pending = turn.pendingApproval;
  if (pending === undefined) {
    return undefined;
  }
  const request = pending.toolLoop.pendingToolCall;
  const confirmation = pending.toolLoop.confirmationRequest;
  return {
    confirmationId: pending.confirmationId,
    toolCallId: request.callId,
    toolName: request.toolName,
    title: confirmation?.title ?? "需要确认",
    actionSummary: confirmation?.actionSummary ?? request.toolName,
    affectedResources: [...(confirmation?.affectedResources ?? [])],
    riskLevel: confirmation?.riskLevel ?? "medium",
    resumeAvailability: confirmation?.resumeAvailability,
    requestedAt: confirmation?.requestedAt ?? nowIso(),
    expiresAt: confirmation?.expiresAt,
    sourceRefs: [...(confirmation?.sourceRefs ?? [request.callId])],
  };
}

function toolCallSummary(toolCall: AgentTurnRuntimeResult["toolCalls"][number]): string | undefined {
  return compactTraceText(toolCall.error, 500);
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function summarizeToolInput(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input === "string") {
    return compactTraceText(input, 240);
  }
  try {
    return compactTraceText(JSON.stringify(input), 240);
  } catch {
    return undefined;
  }
}

function compactTraceText(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function intersectPreserveLeftOrder(left: readonly string[], right: readonly string[]): string[] {
  const allowed = new Set(right);
  return uniqueStrings(left).filter((toolName) => allowed.has(toolName));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
