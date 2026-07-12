import type { ModelMessage, ModelResponse } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolContinuation,
  ToolFactValue,
  ToolResult,
} from "../../domain/tools/index.js";
import {
  toolModelAttachmentsFromOutput,
} from "../../domain/tools/index.js";
import { cloneModelMessage, cloneToolCallRequest } from "./tool-use-loop-cloning.js";
import { toolCallResultToModelToolResult } from "./tool-call-result-model-view.js";

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
  const attachments = toolModelAttachmentsFromOutput(result.output);
  const modelResult = toolCallResultToModelToolResult(result);
  const payload: ToolMessagePayload = {
    status: result.status,
    body: modelResult.body,
    error: modelResult.error,
  };
  return {
    role: "tool",
    content: stringifyToolMessagePayload(payload, MAX_TOOL_MESSAGE_CHARS),
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

// Final provider-transport guard. Larger facts continue through an explicit
// tool-owned reference instead of consuming an unbounded parent context.
const MAX_TOOL_MESSAGE_CHARS = 220_000;
const MAX_TRANSPORT_CONTINUATIONS = 32;
const MAX_TRANSPORT_CONTINUATION_ITEM_CHARS = 16_000;
const MAX_TRANSPORT_CONTINUATIONS_CHARS = 64_000;
const MAX_TRANSPORT_CONTINUATION_REF_CHARS = 4_096;
const MAX_TRANSPORT_CONTINUATION_NOTE_CHARS = 2_000;

type ToolMessagePayload = {
  readonly status: ToolCallResult["status"];
} & ToolResult;

function stringifyToolMessagePayload(payload: ToolMessagePayload, maxChars: number): string {
  try {
    const value = JSON.stringify(payload);
    if (value.length <= maxChars) {
      return value;
    }
    const truncated = JSON.stringify(transportTruncatedToolPayload(payload));
    if (truncated.length <= maxChars) {
      return truncated;
    }
    return JSON.stringify(transportGuardFailurePayload(payload));
  } catch (error) {
    return JSON.stringify(transportSerializationFailurePayload(error));
  }
}

function transportTruncatedToolPayload(
  payload: ToolMessagePayload
): ToolMessagePayload {
  const continuations = modelOutputContinuations(canonicalModelBody(payload.body));
  const continuationFacts = continuations.length === 1
    ? { continuation: continuations[0] }
    : continuations.length > 1
      ? { continuations }
      : {};
  const continuationAvailable = continuations.length > 0;
  const contractError = continuationAvailable
    ? undefined
    : {
        message: "Tool result exceeded the model transport budget without an explicit continuation.",
        domain: "runtime_error" as const,
        facts: {
          code: "tool_result_continuation_required",
        },
      };
  return {
    status: continuationAvailable ? payload.status : "failed",
    body: {
      format: "json",
      value: {
        truncated: true,
        reason: "tool_message_transport_budget_exceeded",
        ...continuationFacts,
        preview: compactJsonPreview(canonicalModelBody(payload.body), 4_000),
      },
    },
    error: contractError ?? payload.error,
  };
}

function modelOutputContinuations(value: unknown): readonly ToolContinuation[] {
  const record = asRecord(value);
  const single = toolContinuationFromUnknown(record.continuation);
  const multiple = Array.isArray(record.continuations)
    ? record.continuations
      .slice(0, MAX_TRANSPORT_CONTINUATIONS)
      .map(toolContinuationFromUnknown)
      .filter((item): item is ToolContinuation => item !== undefined)
    : [];
  return fitContinuationsWithinTransportBudget(
    uniqueContinuations(single === undefined ? multiple : [single, ...multiple])
      .slice(0, MAX_TRANSPORT_CONTINUATIONS)
  );
}

function uniqueContinuations(continuations: readonly ToolContinuation[]): readonly ToolContinuation[] {
  const seen = new Set<string>();
  const uniqueValues: ToolContinuation[] = [];
  for (const continuation of continuations) {
    const key = JSON.stringify(continuation);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueValues.push(continuation);
    }
  }
  return uniqueValues;
}

function toolContinuationFromUnknown(value: unknown): ToolContinuation | undefined {
  const record = asRecord(value);
  const rawRef = nonEmptyString(record.ref);
  const ref = rawRef !== undefined && rawRef.length <= MAX_TRANSPORT_CONTINUATION_REF_CHARS
    ? rawRef
    : undefined;
  const note = compactTransportText(nonEmptyString(record.note), MAX_TRANSPORT_CONTINUATION_NOTE_CHARS);
  const nextInput = continuationInputWithinTransportBudget(record.nextInput);
  if (ref === undefined && nextInput === undefined) {
    return undefined;
  }
  const full: ToolContinuation = {
    ...(ref === undefined ? {} : { ref }),
    ...(nextInput === undefined ? {} : { nextInput }),
    ...(note === undefined ? {} : { note }),
  };
  const candidates: ToolContinuation[] = [
    full,
    ...(note === undefined ? [] : [{
      ...(ref === undefined ? {} : { ref }),
      ...(nextInput === undefined ? {} : { nextInput }),
    }]),
    ...(nextInput === undefined ? [] : [{ nextInput }]),
    ...(ref === undefined ? [] : [{ ref, ...(note === undefined ? {} : { note }) }, { ref }]),
  ];
  return candidates.find(continuationWithinItemBudget);
}

function continuationWithinItemBudget(continuation: ToolContinuation): boolean {
  return JSON.stringify(continuation).length <= MAX_TRANSPORT_CONTINUATION_ITEM_CHARS;
}

function fitContinuationsWithinTransportBudget(
  continuations: readonly ToolContinuation[]
): readonly ToolContinuation[] {
  const selected: ToolContinuation[] = [];
  let remaining = MAX_TRANSPORT_CONTINUATIONS_CHARS;
  for (const continuation of continuations) {
    const chars = JSON.stringify(continuation).length;
    if (chars > remaining) {
      continue;
    }
    selected.push(continuation);
    remaining -= chars;
  }
  return selected;
}

function continuationInputWithinTransportBudget(value: unknown): ToolFactValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  const fact = value as ToolFactValue;
  return JSON.stringify(fact).length <= MAX_TRANSPORT_CONTINUATION_ITEM_CHARS
    ? globalThis.structuredClone(fact)
    : undefined;
}

function compactTransportText(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function transportGuardFailurePayload(payload: ToolMessagePayload): ToolMessagePayload {
  return {
    status: "failed",
    body: {
      format: "json",
      value: {
        truncated: true,
        reason: "tool_message_transport_budget_exceeded",
        preview: compactJsonPreview(canonicalModelBody(payload.body), 4_000),
      },
    },
    error: {
      message: "Tool result and its continuation metadata exceeded the model transport budget.",
      domain: "runtime_error",
      facts: {
        code: "tool_result_transport_budget_exceeded",
      },
    },
  };
}

function transportSerializationFailurePayload(error: unknown): ToolMessagePayload {
  const message = error instanceof Error && error.message.trim().length > 0
    ? compactTransportText(error.message, 500)
    : undefined;
  return {
    status: "failed",
    body: { format: "none" },
    error: {
      message: "Tool result could not be serialized for the model transport.",
      domain: "runtime_error",
      facts: {
        code: "tool_result_not_serializable",
        ...(message === undefined ? {} : { reason: message }),
      },
    },
  };
}

function canonicalModelBody(body: ToolResult["body"]): unknown {
  return body.format === "json" ? body.value : body.format === "text" ? body.text : undefined;
}

function compactJsonPreview(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value) ?? "undefined";
  if (serialized.length <= maxChars) {
    return serialized;
  }
  return `${serialized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
