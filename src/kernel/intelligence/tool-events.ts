import type { ArborMessage } from "../../domain/common.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolExecutionContext,
  ToolFactValue,
} from "../../domain/tools/index.js";
import { toolDisplayName } from "../../domain/tools/index.js";
import { createMessage } from "../messages/create-message.js";

const TOOL_EVENT_INPUT_FACT_MAX_CHARS = 12_000;
const TOOL_EVENT_OUTPUT_FACT_MAX_CHARS = 24_000;
const TOOL_EVENT_FIELD_STRING_MAX_CHARS = 8_000;
const TOOL_EVENT_ARRAY_MAX_ITEMS = 64;
const TOOL_EVENT_OBJECT_MAX_FIELDS = 96;
const TOOL_EVENT_MAX_DEPTH = 12;

export type ToolEventFactTruncation = {
  readonly input?: true;
  readonly output?: true;
};

type ToolEventIdentityPayload = {
  readonly traceId: string;
  readonly goalId: string;
  readonly callerAgentId: string;
  readonly callId: string;
  readonly toolName: string;
};

export type ToolRequestedEventPayload = ToolEventIdentityPayload & {
  readonly input: ToolFactValue | undefined;
  readonly factTruncation?: ToolEventFactTruncation;
};

export type ToolCompletedEventPayload = ToolEventIdentityPayload & {
  readonly output: ToolFactValue | undefined;
  readonly factTruncation?: ToolEventFactTruncation;
  readonly durationMs: number;
};

export type ToolFailedEventPayload = ToolEventIdentityPayload & {
  readonly output?: ToolFactValue;
  readonly factTruncation?: ToolEventFactTruncation;
  readonly error: string;
  readonly errorDomain?: ToolCallResult["errorDomain"];
  readonly errorFacts?: ToolCallResult["errorFacts"];
  readonly durationMs: number;
};

export type ToolCancelledEventPayload = ToolEventIdentityPayload & {
  readonly output?: ToolFactValue;
  readonly factTruncation?: ToolEventFactTruncation;
  readonly reason: string;
  readonly durationMs: number;
};

export function createToolRequestedMessage(input: {
  readonly request: ToolCallRequest;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolRequestedEventPayload> {
  const inputFact = snapshotToolEventFact(input.request.input, TOOL_EVENT_INPUT_FACT_MAX_CHARS);
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
      input: inputFact.value,
      factTruncation: inputFact.truncated ? { input: true } : undefined,
    },
  });
}

export function createToolCompletedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolCompletedEventPayload> {
  const outputFact = snapshotToolEventFact(input.result.output, TOOL_EVENT_OUTPUT_FACT_MAX_CHARS);
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
      output: outputFact.value,
      factTruncation: outputFact.truncated ? { output: true } : undefined,
      durationMs: input.result.durationMs,
    },
  });
}

export function createToolFailedMessage(input: {
  readonly result: ToolCallResult;
  readonly context: ToolExecutionContext;
}): ArborMessage<ToolFailedEventPayload> {
  const errorDomain = input.result.errorDomain;
  const errorFacts = cloneToolFact(input.result.errorFacts);
  const outputFact = snapshotToolEventFact(input.result.output, TOOL_EVENT_OUTPUT_FACT_MAX_CHARS);
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
      output: outputFact.value,
      factTruncation: outputFact.truncated ? { output: true } : undefined,
      error: input.result.error ?? "Tool execution failed.",
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
  const outputFact = snapshotToolEventFact(input.result.output, TOOL_EVENT_OUTPUT_FACT_MAX_CHARS);
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
      output: outputFact.value,
      factTruncation: outputFact.truncated ? { output: true } : undefined,
      reason: input.result.error ?? "Tool execution was cancelled.",
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

/**
 * ToolCenter is the sole JSON-fact normalization boundary. Event publication
 * makes one bounded snapshot of that strong contract so the live event log and
 * durable replay consume identical facts without copying large model bodies.
 */
function cloneToolFact<T extends ToolFactValue | undefined>(value: T): T {
  return value === undefined ? value : globalThis.structuredClone(value);
}

type ToolEventFactSnapshot = {
  readonly value: ToolFactValue | undefined;
  readonly truncated: boolean;
};

type ToolEventFactBudget = {
  remaining: number;
  truncated: boolean;
};

function snapshotToolEventFact(
  value: ToolFactValue | undefined,
  maxChars: number,
): ToolEventFactSnapshot {
  if (value === undefined) {
    return { value: undefined, truncated: false };
  }
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) {
    return { value: cloneToolFact(value), truncated: false };
  }
  const budget: ToolEventFactBudget = { remaining: maxChars, truncated: false };
  const bounded = boundedToolEventFact(value, budget, 0);
  return {
    value: bounded,
    truncated: budget.truncated || bounded === undefined,
  };
}

function boundedToolEventFact(
  value: ToolFactValue,
  budget: ToolEventFactBudget,
  depth: number,
): ToolFactValue | undefined {
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return undefined;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    const chars = JSON.stringify(value).length;
    if (chars > budget.remaining) {
      budget.truncated = true;
      return undefined;
    }
    budget.remaining -= chars;
    return value;
  }
  if (typeof value === "string") {
    const maxContentChars = Math.max(
      0,
      Math.min(TOOL_EVENT_FIELD_STRING_MAX_CHARS, budget.remaining - 2),
    );
    if (value.length <= maxContentChars) {
      budget.remaining -= JSON.stringify(value).length;
      return value;
    }
    budget.truncated = true;
    const suffix = maxContentChars >= 3 ? "..." : "";
    const text = `${value.slice(0, Math.max(0, maxContentChars - suffix.length))}${suffix}`;
    budget.remaining = Math.max(0, budget.remaining - JSON.stringify(text).length);
    return text;
  }
  if (depth >= TOOL_EVENT_MAX_DEPTH) {
    budget.truncated = true;
    return undefined;
  }
  if (Array.isArray(value)) {
    const output: ToolFactValue[] = [];
    budget.remaining = Math.max(0, budget.remaining - 2);
    const limit = Math.min(value.length, TOOL_EVENT_ARRAY_MAX_ITEMS);
    for (let index = 0; index < limit; index += 1) {
      const item = boundedToolEventFact(value[index]!, budget, depth + 1);
      if (item === undefined) {
        budget.truncated = true;
        break;
      }
      output.push(item);
      budget.remaining = Math.max(0, budget.remaining - 1);
    }
    if (value.length > output.length) {
      budget.truncated = true;
    }
    return output;
  }

  const output: Record<string, ToolFactValue> = {};
  budget.remaining = Math.max(0, budget.remaining - 2);
  const entries = Object.entries(value);
  const continuationEntries = entries.filter(([key]) => key === "continuation" || key === "continuations");
  const ordinaryEntries = entries.filter(([key]) => key !== "continuation" && key !== "continuations");
  const limitedEntries = [
    ...continuationEntries,
    ...ordinaryEntries.slice(0, TOOL_EVENT_OBJECT_MAX_FIELDS),
  ];
  for (const [key, item] of limitedEntries) {
    if (item === undefined) {
      continue;
    }
    const keyChars = JSON.stringify(key).length + 1;
    if (keyChars >= budget.remaining) {
      budget.truncated = true;
      break;
    }
    budget.remaining -= keyChars;
    const bounded = boundedToolEventFact(item, budget, depth + 1);
    if (bounded === undefined) {
      budget.truncated = true;
      break;
    }
    Object.defineProperty(output, key, {
      value: bounded,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    budget.remaining = Math.max(0, budget.remaining - 1);
  }
  if (ordinaryEntries.length > TOOL_EVENT_OBJECT_MAX_FIELDS || Object.keys(output).length < entries.length) {
    budget.truncated = true;
  }
  return output;
}
