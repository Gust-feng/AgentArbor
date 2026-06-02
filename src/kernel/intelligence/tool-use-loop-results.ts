import type { ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { projectToolStatusEnvelope } from "../tools/index.js";
import type {
  ToolUseLoopContextMaintenanceResult,
  ToolUseLoopPendingApproval,
  ToolUseLoopResult,
} from "./tool-use-loop-contracts.js";

export function outOfFuelLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number
): ToolUseLoopResult {
  return {
    finalOutput: outOfFuelModelResponse(initialRequest),
    toolCalls,
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
  failure: Extract<ToolUseLoopContextMaintenanceResult, { readonly status: "failed" }>
): ToolUseLoopResult {
  return {
    finalOutput: contextOverflowModelResponse(initialRequest, failure),
    toolCalls,
    modelRounds,
    rounds,
    stoppedReason: "context_overflow",
  };
}

export function cancelledToolResult(request: ToolCallRequest): ToolCallResult {
  const diagnosticRef = `tool:${request.callId}:cancelled`;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: request.input,
    output: undefined,
    status: "cancelled",
    error: "Tool execution cancelled.",
    durationMs: 0,
    projection: {
      uiSummary: "工具执行已取消。",
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "cancelled",
        summary: "Tool execution cancelled.",
        diagnosticRef,
      }),
      truncated: false,
      redacted: true,
    },
  };
}

export function abortedLoopResult(
  initialRequest: ModelRequest,
  toolCalls: readonly ToolCallResult[],
  modelRounds: number,
  rounds: number
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
  const request = pendingApproval.pendingToolCall;
  const diagnosticRef = `tool:${request.callId}:confirmation-required`;
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
    output: undefined,
    status: "approval_required",
    error: `${toolDisplayName(request.toolName)}仍需要用户确认。`,
    durationMs: 0,
    projection: {
      uiSummary: `${toolDisplayName(request.toolName)}仍在等待用户确认。`,
      diagnosticRef,
      envelope: projectToolStatusEnvelope({
        request,
        status: "approval_required",
        summary: `${toolDisplayName(request.toolName)}仍在等待用户确认。`,
        diagnosticRef,
      }),
      truncated: false,
      redacted: true,
    },
    confirmationRequest: {
      confirmationId: pendingApproval.confirmationId,
      runId: request.callId,
      title: toolDisplayName(request.toolName),
      actionSummary: `${toolDisplayName(request.toolName)}需要用户确认后才能执行。`,
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: new Date().toISOString(),
      sourceRefs: [`tool:${request.callId}`],
    },
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
