import type { ModelMessage, ModelResponse } from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolCallResult, ToolContinuation } from "../../domain/tools/index.js";
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
  const payload = {
    callId: result.callId,
    toolName: result.toolName,
    status: result.status,
    output: modelOutput,
    error: safeToolErrorForModel(result.error),
    durationMs: result.durationMs,
  };
  return {
    role: "tool",
    content: stringifyToolMessagePayload(payload, toolMessageContentBudget(result)),
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

type ToolMessagePayload = {
  readonly callId: string;
  readonly toolName: string;
  readonly status: ToolCallResult["status"];
  readonly output: unknown;
  readonly error?: string;
  readonly durationMs: number;
};

function stringifyToolMessagePayload(payload: ToolMessagePayload, maxChars: number): string {
  const value = JSON.stringify(payload);
  if (value.length <= maxChars) {
    return value;
  }
  return JSON.stringify(transportTruncatedToolPayload(payload, value.length, maxChars));
}

function transportTruncatedToolPayload(
  payload: ToolMessagePayload,
  originalChars: number,
  maxChars: number
): ToolMessagePayload {
  const continuation = modelOutputContinuation(payload.output);
  const omittedChars = Math.max(0, originalChars - maxChars);
  return {
    callId: payload.callId,
    toolName: payload.toolName,
    status: payload.status,
    output: {
      content: [{
        type: "text",
        text: continuation === undefined
          ? "Tool result exceeded the model transport budget. No continuation reference was supplied by the tool result."
          : "Tool result exceeded the model transport budget. Use the supplied continuation reference to inspect more.",
      }],
      structuredContent: {
        truncated: true,
        reason: "tool_message_transport_budget_exceeded",
        originalChars,
        maxChars,
        omittedChars,
        continuationAvailable: continuation !== undefined,
        unrecoverable: continuation === undefined,
        continuation,
        preview: compactJsonPreview(payload.output, 4_000),
      },
      truncation: {
        truncated: true,
        reason: "tool_message_transport_budget_exceeded",
        omittedChars,
        continuation,
      },
      continuation,
    },
    error: payload.error,
    durationMs: payload.durationMs,
  };
}

function modelOutputContinuation(value: unknown): ToolContinuation | undefined {
  const record = asRecord(value);
  return toolContinuationFromUnknown(record.continuation) ??
    toolContinuationFromUnknown(asRecord(record.truncation).continuation) ??
    continuationFromKnownRef(value);
}

function continuationFromKnownRef(value: unknown): ToolContinuation | undefined {
  const logRef = findStringField(value, new Set(["logRef"]));
  if (logRef !== undefined) {
    return {
      ref: logRef,
      nextInput: { ref: logRef, maxLength: 30_000 },
      note: "Use the read tool with this logRef to inspect the complete tool output.",
    };
  }
  const rawRef = findStringField(value, new Set([
    "rawRef",
    "rawTextRef",
    "rawBodyRef",
    "rawContentRef",
    "rawContentPreviewRef",
    "rawStdoutRef",
    "rawStderrRef",
  ]));
  if (rawRef === undefined) {
    return undefined;
  }
  return {
    ref: rawRef,
    nextInput: { ref: rawRef, maxLength: 30_000 },
    note: "Use the read tool with this raw ref to inspect the complete tool output.",
  };
}

function findStringField(value: unknown, keys: ReadonlySet<string>, depth = 0): string | undefined {
  if (depth > 6 || value === null || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 32)) {
      const found = findStringField(item, keys, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  for (const item of Object.values(record).slice(0, 64)) {
    const found = findStringField(item, keys, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function toolContinuationFromUnknown(value: unknown): ToolContinuation | undefined {
  const record = asRecord(value);
  const ref = typeof record.ref === "string" && record.ref.trim().length > 0 ? record.ref : undefined;
  const note = typeof record.note === "string" && record.note.trim().length > 0 ? record.note : undefined;
  const nextInput = record.nextInput === undefined ? undefined : sanitizeProjectedAgentContent(record.nextInput);
  if (ref === undefined && note === undefined && nextInput === undefined) {
    return undefined;
  }
  const continuation: Record<string, unknown> = {};
  if (ref !== undefined) continuation.ref = ref;
  if (nextInput !== undefined) continuation.nextInput = nextInput;
  if (note !== undefined) continuation.note = note;
  return continuation as ToolContinuation;
}

function compactJsonPreview(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value) ?? "undefined";
  if (serialized.length <= maxChars) {
    return serialized;
  }
  return `${serialized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
