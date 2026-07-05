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
  const attachments = result.projection?.modelAttachments;
  const modelOutput = result.projection?.modelResult !== undefined
    ? sanitizeProjectedAgentContent(result.projection.modelResult)
    : result.projection?.agentContent !== undefined
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
    }), toolMessageContentBudget(result)),
    toolCallId: result.callId,
    toolName: result.toolName,
    attachments: attachments === undefined || attachments.length === 0
      ? undefined
      : attachments.map((attachment) => globalThis.structuredClone(attachment)),
  };
}

export function toolResultMessages(results: readonly ToolCallResult[]): ModelMessage[] {
  return results.map(toolResultMessage);
}

// Final transport guard after ToolSafeProjection.agentContent has already
// shaped model-visible tool content. Keep this larger than the projection caps
// so stdout/stderr and file bodies are not silently replaced by a short message.
const MAX_TOOL_MESSAGE_CHARS = 220_000;
const MAX_SUB_AGENT_TOOL_MESSAGE_CHARS = 1_000_000;
const SUB_AGENT_TOOL_NAMES = new Set(["call_sub_agent", "call_sub_agents", "spawn_sub_agent"]);

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

function toolMessageContentBudget(result: ToolCallResult): number {
  return SUB_AGENT_TOOL_NAMES.has(result.toolName) ? MAX_SUB_AGENT_TOOL_MESSAGE_CHARS : MAX_TOOL_MESSAGE_CHARS;
}

function truncateToolMessageContent(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 80)}... [tool message truncated to ${maxChars} chars]`;
}
