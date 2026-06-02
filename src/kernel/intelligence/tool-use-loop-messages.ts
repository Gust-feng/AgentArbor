import type { ModelMessage, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { toSafeToolEventValue } from "./tool-events.js";
import { cloneModelMessage, cloneToolCallRequest } from "./tool-use-loop-cloning.js";

export function assistantToolCallMessage(
  response: ModelResponse,
  requestedToolCalls: readonly ToolCallRequest[]
): ModelMessage {
  if (response.assistantMessage?.role === "assistant") {
    return cloneModelMessage({
      ...response.assistantMessage,
      content: response.assistantMessage.content ?? response.textOutput ?? "",
      toolCalls: requestedToolCalls.map(cloneToolCallRequest),
    });
  }
  return {
    role: "assistant",
    content: response.textOutput ?? "",
    toolCalls: requestedToolCalls.map(cloneToolCallRequest),
  };
}

export function toolResultMessage(result: ToolCallResult): ModelMessage {
  const envelope = result.projection?.envelope;
  const modelOutput = envelope !== undefined
    ? {
        summary: envelope.agentSummary,
        evidenceRefs: envelope.evidenceRefs,
        truncated: envelope.truncated,
        redacted: envelope.redacted,
        diagnosticRef: envelope.diagnosticRef,
      }
    : result.projection?.agentContent !== undefined
      ? result.projection.agentContent
      : toSafeToolEventValue(result.output);
  return {
    role: "tool",
    content: truncateToolMessageContent(JSON.stringify({
      callId: result.callId,
      toolName: result.toolName,
      status: result.status,
      output: modelOutput,
      error: result.error,
      durationMs: result.durationMs,
    })),
    toolCallId: result.callId,
    toolName: result.toolName,
  };
}

const MAX_TOOL_MESSAGE_CHARS = 40_000;

function truncateToolMessageContent(value: string): string {
  if (value.length <= MAX_TOOL_MESSAGE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_TOOL_MESSAGE_CHARS - 80)}... [tool message truncated to ${MAX_TOOL_MESSAGE_CHARS} chars]`;
}
