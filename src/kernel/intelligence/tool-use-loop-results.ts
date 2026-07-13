import type { ModelMessage, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import type {
  ToolUseLoopConfirmationDecision,
  ToolUseLoopContextMaintenanceResult,
  ToolUseLoopModelResponseTrace,
  ToolUseLoopPendingApproval,
  ToolUseLoopResult,
} from "./tool-use-loop-contracts.js";
import { cloneToolResult } from "./tool-use-loop-cloning.js";

export function outOfFuelLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number,
  modelResponses: readonly ToolUseLoopModelResponseTrace[] = [],
  contextMessages: readonly ModelMessage[] = initialRequest.sanitizedMessages,
): ToolUseLoopResult {
  return {
    finalOutput: outOfFuelModelResponse(initialRequest),
    toolCalls,
    modelResponses,
    contextMessages,
    modelRounds,
    rounds,
    stoppedReason: "out_of_fuel",
  };
}

export function contextOverflowLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number,
  failure: Extract<ToolUseLoopContextMaintenanceResult, { readonly status: "failed" }>,
  modelResponses: readonly ToolUseLoopModelResponseTrace[] = [],
  contextMessages: readonly ModelMessage[] = initialRequest.sanitizedMessages,
): ToolUseLoopResult {
  return {
    finalOutput: contextOverflowModelResponse(initialRequest, failure),
    toolCalls,
    modelResponses,
    contextMessages,
    modelRounds,
    rounds,
    stoppedReason: "context_overflow",
  };
}

export function cancelledToolResult(request: ToolCallRequest): ToolCallResult {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "cancelled",
    error: "Tool execution cancelled.",
    durationMs: 0,
  };
}

export function cancelledPendingApprovalToolResult(
  pendingApproval: ToolUseLoopPendingApproval,
): ToolCallResult {
  const pendingResult = cloneToolResult(pendingApproval.pendingToolResult);
  return cancelledApprovalResult(pendingResult, {
    message: "Agent turn was cancelled while this tool was waiting for approval.",
    code: "approval_wait_cancelled",
    confirmationId: pendingApproval.confirmationId,
  });
}

export function cancelledApprovalAfterAbortToolResult(
  approvalResult: ToolCallResult,
): ToolCallResult {
  const confirmationId = approvalResult.confirmationRequest?.confirmationId
    ?? `confirmation-${approvalResult.callId}`;
  return cancelledApprovalResult(cloneToolResult(approvalResult), {
    message: "Agent turn was cancelled after the tool requested another approval.",
    code: "approval_resumption_cancelled",
    confirmationId,
  });
}

export function cancelledAdditionalParallelApprovalToolResult(
  approvalResult: ToolCallResult,
  activeConfirmationId: string,
): ToolCallResult {
  const confirmationId = approvalResult.confirmationRequest?.confirmationId
    ?? `confirmation-${approvalResult.callId}`;
  return cancelledApprovalResult(cloneToolResult(approvalResult), {
    message: "This read-only call also requested approval during the same parallel preflight. It was not executed and will not be resumed automatically.",
    code: "parallel_approval_not_selected",
    confirmationId,
    activeConfirmationId,
  });
}

export function abortedLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number,
  modelResponses: readonly ToolUseLoopModelResponseTrace[] = [],
  contextMessages: readonly ModelMessage[] = initialRequest.sanitizedMessages,
): ToolUseLoopResult {
  return {
    finalOutput: {
      responseId: `${initialRequest.requestId}-cancelled`,
      requestId: initialRequest.requestId,
      providerId: "agent-turn-runtime",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "cancelled",
      status: "failed",
      outputKind: initialRequest.outputContract.outputKind,
      finishReason: "error",
      validation: {
        status: "failed",
        checkedAt: new Date().toISOString(),
        issues: [{ code: "cancelled", message: "Agent turn was cancelled." }],
      },
      failure: {
        kind: "provider_response",
        message: "Agent turn was cancelled.",
        retryable: false,
      },
      completedAt: new Date().toISOString(),
    },
    toolCalls,
    modelResponses,
    contextMessages,
    modelRounds,
    rounds,
    stoppedReason: "cancelled",
  };
}

export function approvalStillRequiredModelResponse(
  initialRequest: ModelRequest,
  pendingApproval: ToolUseLoopPendingApproval
): ModelResponse {
  return {
    responseId: `${initialRequest.requestId}-approval-required`,
    requestId: pendingApproval.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "approval-required",
    status: "completed",
    outputKind: initialRequest.outputContract.outputKind,
    textOutput: "Tool execution is paused until the matching confirmation is approved.",
    finishReason: "stop",
    validation: {
      status: "passed",
      checkedAt: new Date().toISOString(),
      issues: [],
    },
    completedAt: new Date().toISOString(),
  };
}

export function approvalRequiredResultFromPending(pendingApproval: ToolUseLoopPendingApproval): ToolCallResult {
  const confirmationRequest = pendingApproval.confirmationRequest ?? fallbackConfirmationRequest(pendingApproval);
  const pendingResult = cloneToolResult(pendingApproval.pendingToolResult);
  return {
    ...pendingResult,
    status: "approval_required",
    confirmationRequest: globalThis.structuredClone(confirmationRequest),
  };
}

function fallbackConfirmationRequest(pendingApproval: ToolUseLoopPendingApproval): NonNullable<ToolCallResult["confirmationRequest"]> {
  const request = pendingApproval.pendingToolCall;
  return {
    confirmationId: pendingApproval.confirmationId,
    runId: request.callId,
    title: toolDisplayName(request.toolName),
    actionSummary: toolDisplayName(request.toolName),
    affectedResources: [],
    riskLevel: "medium",
    requestedAt: new Date().toISOString(),
    sourceRefs: [`tool:${request.callId}`],
  };
}

export function confirmationDecisionToolResult(
  pendingResult: ToolCallResult,
  decision: ToolUseLoopConfirmationDecision
): ToolCallResult {
  const summary = confirmationDecisionSummary(decision);
  const clonedResult = cloneToolResult(pendingResult);
  return {
    callId: clonedResult.callId,
    toolName: clonedResult.toolName,
    input: clonedResult.input,
    output: clonedResult.output,
    status: "cancelled",
    error: summary,
    errorFacts: {
      code: decision.decision === "deny" ? "confirmation_denied" : "confirmation_guidance",
      confirmationId: decision.confirmationId,
      decision: decision.decision,
    },
    durationMs: clonedResult.durationMs,
  };
}

export function confirmationDecisionSkippedToolResult(
  request: ToolCallRequest,
  decision: ToolUseLoopConfirmationDecision
): ToolCallResult {
  const summary = "同一轮中排在被拒绝或改写指导之后的工具没有执行。请基于用户确认结果重新判断下一步。";
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
    output: undefined,
    status: "cancelled",
    error: summary,
    errorFacts: {
      code: "confirmation_batch_call_skipped",
      confirmationId: decision.confirmationId,
      decision: decision.decision,
    },
    durationMs: 0,
  };
}

function outOfFuelModelResponse(initialRequest: ModelRequest): ModelResponse {
  return {
    responseId: `${initialRequest.requestId}-out-of-fuel`,
    requestId: initialRequest.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "out-of-fuel",
    status: "failed",
    outputKind: initialRequest.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: new Date().toISOString(),
      issues: [{ code: "out_of_fuel", message: "Agent run paused before the model returned a final no-tool response." }],
    },
    failure: {
      kind: "provider_response",
      message: "Agent run paused before the model returned a final no-tool response.",
      retryable: true,
    },
    completedAt: new Date().toISOString(),
  };
}

function contextOverflowModelResponse(
  initialRequest: ModelRequest,
  failure: Extract<ToolUseLoopContextMaintenanceResult, { readonly status: "failed" }>
): ModelResponse {
  return {
    responseId: failure.responseId ?? `${initialRequest.requestId}-context-overflow`,
    requestId: failure.requestId ?? initialRequest.requestId,
    providerId: "agent-turn-runtime",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "context-maintenance",
    status: "failed",
    outputKind: initialRequest.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: new Date().toISOString(),
      issues: [{ code: "context_overflow", message: failure.message }],
    },
    failure: {
      kind: "provider_response",
      message: failure.message,
      retryable: failure.retryable ?? true,
    },
    completedAt: new Date().toISOString(),
  };
}

function confirmationDecisionSummary(decision: ToolUseLoopConfirmationDecision): string {
  if (decision.decision === "deny") {
    return "用户拒绝了本次工具执行。不要执行该工具；请基于当前上下文判断是否改用其他方式、请求更多信息或直接回答。";
  }
  const guidance = decision.guidance?.trim();
  return guidance === undefined || guidance.length === 0
    ? "用户没有批准本次工具执行，并补充了指导。不要执行该工具；请基于当前上下文继续判断下一步。"
    : `用户没有批准本次工具执行，并补充了指导：${guidance}。不要执行该工具；请基于该指导继续判断下一步。`;
}

function cancelledApprovalResult(
  approvalResult: ToolCallResult,
  cancellation: {
    readonly message: string;
    readonly code: string;
    readonly confirmationId: string;
    readonly activeConfirmationId?: string;
  },
): ToolCallResult {
  return {
    callId: approvalResult.callId,
    toolName: approvalResult.toolName,
    input: approvalResult.input,
    output: approvalResult.output,
    status: "cancelled",
    error: cancellation.message,
    errorFacts: {
      code: cancellation.code,
      confirmationId: cancellation.confirmationId,
      ...(cancellation.activeConfirmationId === undefined
        ? {}
        : { activeConfirmationId: cancellation.activeConfirmationId }),
      ...(approvalResult.error === undefined ? {} : { preApprovalError: approvalResult.error }),
      ...(approvalResult.errorDomain === undefined
        ? {}
        : { preApprovalErrorDomain: approvalResult.errorDomain }),
      ...(approvalResult.errorFacts === undefined
        ? {}
        : { preApprovalErrorFacts: approvalResult.errorFacts }),
    },
    durationMs: approvalResult.durationMs,
    confirmationRequest: approvalResult.confirmationRequest,
  };
}
