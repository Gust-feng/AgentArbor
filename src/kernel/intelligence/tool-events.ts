import type { ArborMessage } from "../../domain/common.js";
import type { ToolCallRequest, ToolCallResult, ToolExecutionContext } from "../../domain/tools/index.js";
import { normalizeToolErrorFacts, toolDisplayName } from "../../domain/tools/index.js";
import { createMessage } from "../messages/create-message.js";
import { redactSensitiveText } from "../redaction.js";

export type ToolRequestedEventPayload = {
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly toolDisplayName: string;
  readonly input: unknown;
};

export type ToolCompletedEventPayload = ToolRequestedEventPayload & {
  readonly output: unknown;
  readonly durationMs: number;
};

export type ToolFailedEventPayload = ToolRequestedEventPayload & {
  readonly output?: unknown;
  readonly error: string;
  readonly errorDomain?: ToolCallResult["errorDomain"];
  readonly errorFacts?: ToolCallResult["errorFacts"];
  readonly durationMs: number;
};

export type ToolCancelledEventPayload = ToolRequestedEventPayload & {
  readonly output?: unknown;
  readonly reason: string;
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
      toolDisplayName: toolDisplayName(input.request.toolName),
      input: toSafeToolEventValue(input.request.input),
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
      toolDisplayName: toolDisplayName(input.result.toolName),
      input: toSafeToolEventValue(input.result.input),
      output: toStableToolEventFact(input.result.output),
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolFailedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolFailedEventPayload> {
  const errorDomain = input.result.errorDomain;
  const errorFacts = normalizeToolErrorFacts(input.result.errorFacts);
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
      toolDisplayName: toolDisplayName(input.result.toolName),
      input: toSafeToolEventValue(input.result.input),
      output: input.result.output === undefined ? undefined : toStableToolEventFact(input.result.output),
      error: sanitizeError(input.result.error ?? "Tool execution failed."),
      errorDomain,
      errorFacts,
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolCancelledMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolCancelledEventPayload> {
  return createMessage({
    traceId: input.context.traceId,
    from: { id: "tool-center", role: "runtime" },
    to: { role: "runtime" },
    type: "tool.cancelled",
    intent: "cancel_tool_execution",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      toolDisplayName: toolDisplayName(input.result.toolName),
      input: toSafeToolEventValue(input.result.input),
      output: input.result.output === undefined ? undefined : toStableToolEventFact(input.result.output),
      reason: sanitizeError(input.result.error ?? "Tool execution was cancelled."),
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolApprovalRequiredMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage {
  const confirmation = input.result.confirmationRequest;
  return createMessage({
    traceId: input.context.traceId,
    from: { id: input.context.callerAgentId, role: "agent" },
    to: { role: "runtime" },
    type: "user_approval.requested",
    intent: "request_tool_confirmation",
    payload: {
      traceId: input.context.traceId,
      goalId: input.context.goalId,
      callerAgentId: input.context.callerAgentId,
      callId: input.result.callId,
      toolName: input.result.toolName,
      toolDisplayName: toolDisplayName(input.result.toolName),
      confirmationId: confirmation?.confirmationId ?? `confirmation-${input.result.callId}`,
      title: confirmation?.title ?? "需要确认",
      question: confirmation?.actionSummary ?? toolDisplayName(input.result.toolName),
      consequence: confirmationConsequenceFromRequest(
        confirmation,
        toolDisplayName(input.result.toolName)
      ),
      riskLevel: confirmation?.riskLevel ?? "medium",
      affectedResources: confirmation?.affectedResources ?? [],
      sourceRefs: confirmation?.sourceRefs ?? [`tool:${input.result.callId}`],
    },
  });
}

function confirmationConsequenceFromRequest(
  confirmation: ToolCallResult["confirmationRequest"] | undefined,
  fallbackTitle: string
): string {
  if (confirmation?.consequence !== undefined && confirmation.consequence.trim().length > 0) {
    return confirmation.consequence;
  }
  const title = confirmation?.title ?? fallbackTitle;
  const resources = confirmation?.affectedResources ?? [];
  const target = resources.length === 0 ? "" : `目标：${resources.slice(0, 4).join("、")}。`;
  return `${target}批准后只执行本次${title}。`;
}

export function toSafeToolEventValue(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: false });
}

/** Keeps durable metadata and continuation refs without copying large bodies. */
function toStableToolEventFact(value: unknown): unknown {
  return truncateDeep(toJsonSafe(value), 0, { omitVerboseOutput: true });
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(item);
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

function isVerboseToolOutputKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "content" ||
    normalized === "contentpreview" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "output" ||
    normalized === "preview" ||
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
