import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import type { ToolUseLoopPendingApproval } from "./tool-use-loop-contracts.js";

export function clonePendingApproval(pendingApproval: ToolUseLoopPendingApproval): ToolUseLoopPendingApproval {
  return {
    confirmationId: pendingApproval.confirmationId,
    pendingToolCall: cloneToolCallRequest(pendingApproval.pendingToolCall),
    confirmationRequest:
      pendingApproval.confirmationRequest === undefined ? undefined : globalThis.structuredClone(pendingApproval.confirmationRequest),
    remainingToolCallsAfterApproval: pendingApproval.remainingToolCallsAfterApproval.map(cloneToolCallRequest),
    messagesBeforeToolCall: cloneMessages(pendingApproval.messagesBeforeToolCall),
    assistantMessage: cloneModelMessage(pendingApproval.assistantMessage),
    completedToolResults: cloneToolResults(pendingApproval.completedToolResults),
    toolCallsBeforeApproval: cloneToolResults(pendingApproval.toolCallsBeforeApproval),
    modelRounds: pendingApproval.modelRounds,
    rounds: pendingApproval.rounds,
    requestId: pendingApproval.requestId,
  };
}

export function cloneMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map(cloneModelMessage);
}

export function cloneModelMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : globalThis.structuredClone(message.protocolExtensions),
    toolCalls: message.toolCalls?.map(cloneToolCallRequest),
  };
}

export function cloneToolCallRequest(request: ToolCallRequest): ToolCallRequest {
  return {
    callId: request.callId,
    toolName: request.toolName,
    input: globalThis.structuredClone(request.input),
  };
}

export function cloneToolResults(results: readonly ToolCallResult[]): ToolCallResult[] {
  return results.map((result) => ({
    ...result,
    input: globalThis.structuredClone(result.input),
    output: globalThis.structuredClone(result.output),
    projection:
      result.projection === undefined ? undefined : globalThis.structuredClone(result.projection),
    confirmationRequest:
      result.confirmationRequest === undefined ? undefined : globalThis.structuredClone(result.confirmationRequest),
  }));
}
