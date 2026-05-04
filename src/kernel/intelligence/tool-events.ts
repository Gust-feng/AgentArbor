import type { ArborMessage } from "../../domain/common.js";
import type { ToolCallRequest, ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import { createMessage } from "../messages/create-message.js";

export type ToolRequestedEventPayload = {
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
};

export type ToolCompletedEventPayload = ToolRequestedEventPayload & {
  readonly output: unknown;
  readonly durationMs: number;
};

export type ToolFailedEventPayload = ToolRequestedEventPayload & {
  readonly error: string;
  readonly durationMs: number;
};

export function createToolRequestedMessage(input: {
  readonly request: ToolCallRequest;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolRequestedEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.requested",
    intent: "request_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.request.callId,
      toolName: input.request.toolName,
      input: toSafeToolEventSummaryValue(input.request.input),
    },
  });
}

export function createToolCompletedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolCompletedEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.completed",
    intent: "complete_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      input: toSafeToolEventSummaryValue(input.result.input),
      output: toSafeToolEventSummaryValue(input.result.output),
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolFailedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolFailedEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.failed",
    intent: "fail_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      input: toSafeToolEventSummaryValue(input.result.input),
      error: sanitizeError(input.result.error ?? "Tool execution failed."),
      durationMs: input.result.durationMs,
    },
  });
}

export function toSafeToolEventValue(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: false });
}

function toSafeToolEventSummaryValue(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: true });
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? redactSensitiveText(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretLikeKey(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = toJsonSafe(item);
      }
    }
    return result;
  }
  return String(value);
}

function truncateDeep(
  value: unknown,
  depth: number,
  options: { readonly omitVerboseOutput: boolean }
): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map((item) => truncateDeep(item, depth + 1, options));
    return value.length > 8 ? [...items, "[truncated]"] : items;
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 4) {
      return "[truncated]";
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 16);
    const result: Record<string, unknown> = {};
    const hasVerboseOutput = options.omitVerboseOutput && entries.some(([key]) => isVerboseToolOutputKey(key));
    let verboseOutputOmitted = false;
    for (const [key, item] of entries) {
      if (options.omitVerboseOutput && (isVerboseToolOutputKey(key) || (hasVerboseOutput && isDerivedVerboseSummaryKey(key)))) {
        verboseOutputOmitted = true;
        continue;
      }
      result[key] = truncateDeep(item, depth + 1, options);
    }
    if (Object.keys(value as Record<string, unknown>).length > entries.length) {
      result.truncated = true;
    }
    if (verboseOutputOmitted) {
      result.verboseOutputOmitted = true;
    }
    return result;
  }
  return value;
}

function sanitizeError(value: string): string {
  return redactSensitiveText(value).slice(0, 500);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted-secret]")
    .replace(/tvly-[A-Za-z0-9_-]{6,}/g, "[redacted-secret]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_ -]?key\s*[:=]\s*[^;\s]+/gi, "api key=[redacted-secret]")
    .replace(/token\s*[:=]\s*[^;\s]+/gi, "token=[redacted-token]");
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("apikey") || normalized.includes("api_key") || normalized.includes("token") || normalized.includes("secret");
}

function isVerboseToolOutputKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "contentpreview" ||
    normalized === "raw" ||
    normalized === "rawoutput" ||
    normalized === "rawresponse" ||
    normalized === "providerresponse" ||
    normalized === "fulltext" ||
    normalized === "pagetext" ||
    normalized === "pagebody" ||
    normalized === "html" ||
    normalized === "body" ||
    normalized === "prompt" ||
    normalized === "sanitizedmessages" ||
    normalized === "messages"
  );
}

function isDerivedVerboseSummaryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "summary" || normalized === "title";
}
