import type { ModelMessage, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { redactOrdinaryToolText } from "../tools/index.js";
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
  const modelOutput = result.projection?.agentContent !== undefined
    ? sanitizeProjectedAgentContent(result.projection.agentContent)
    : envelope !== undefined
      ? {
          summary: envelope.agentSummary,
          evidenceRefs: envelope.evidenceRefs,
          truncated: envelope.truncated,
          redacted: envelope.redacted,
          diagnosticRef: envelope.diagnosticRef,
        }
      : toSafeToolEventValue(result.output);
  return {
    role: "tool",
    content: truncateToolMessageContent(JSON.stringify({
      callId: result.callId,
      toolName: result.toolName,
      status: result.status,
      output: modelOutput,
      error: safeToolErrorForModel(result.error),
      durationMs: result.durationMs,
    })),
    toolCallId: result.callId,
    toolName: result.toolName,
  };
}

// Final transport guard after ToolSafeProjection.agentContent has already
// shaped model-visible tool content. Keep this larger than the projection caps
// so stdout/stderr and file bodies are not silently replaced by a short message.
const MAX_TOOL_MESSAGE_CHARS = 220_000;

function safeToolErrorForModel(error: string | undefined): string | undefined {
  return error === undefined ? undefined : redactOrdinaryToolText(error, 1_000);
}

function sanitizeProjectedAgentContent(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeProjectedAgentContent);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeProjectedAgentContent(item);
    }
    return result;
  }
  return String(value);
}

function truncateToolMessageContent(value: string): string {
  if (value.length <= MAX_TOOL_MESSAGE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_TOOL_MESSAGE_CHARS - 80)}... [tool message truncated to ${MAX_TOOL_MESSAGE_CHARS} chars]`;
}
