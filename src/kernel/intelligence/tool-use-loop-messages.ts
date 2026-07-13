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
import {
  toolCallOutputToModelBody,
  toolCallResultToModelToolResult,
} from "./tool-call-result-model-view.js";

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

export function toolResultMessagesWithResolvedApprovals(
  results: readonly ToolCallResult[],
  preApprovalResults: readonly ToolCallResult[] = [],
): ModelMessage[] {
  const preApprovalByCallId = new Map<string, ToolCallResult[]>();
  for (const result of preApprovalResults) {
    const existing = preApprovalByCallId.get(result.callId) ?? [];
    existing.push(result);
    preApprovalByCallId.set(result.callId, existing);
  }
  return results.map((result) => {
    const preApprovals = preApprovalByCallId.get(result.callId);
    return preApprovals === undefined
      ? toolResultMessage(result)
      : resolvedApprovalToolResultMessage(preApprovals, result);
  });
}

// Final provider-transport guard. Larger facts continue through an explicit
// tool-owned reference instead of consuming an unbounded parent context.
const MAX_TOOL_MESSAGE_CHARS = 220_000;
const MAX_TRANSPORT_CONTINUATIONS = 32;
const MAX_TRANSPORT_CONTINUATION_ITEM_CHARS = 16_000;
const MAX_TRANSPORT_CONTINUATIONS_CHARS = 64_000;
const MAX_TRANSPORT_CONTINUATION_REF_CHARS = 4_096;
const MAX_TRANSPORT_CONTINUATION_NOTE_CHARS = 2_000;
const MAX_TRANSPORT_STAGE_PREVIEWS = 64;
const MAX_TRANSPORT_STAGE_PREVIEW_CHARS = 32_000;

type ToolMessagePayload = {
  readonly status: ToolCallResult["status"];
  readonly preApprovals?: readonly {
    readonly status: "approval_required";
    readonly body: ToolResult["body"];
    readonly error?: ToolResult["error"];
    readonly confirmation?: ToolCallResult["confirmationRequest"];
  }[];
} & ToolResult;

function resolvedApprovalToolResultMessage(
  preApprovalResults: readonly ToolCallResult[],
  resolvedResult: ToolCallResult,
): ModelMessage {
  const resolvedModelResult = toolCallResultToModelToolResult(resolvedResult);
  const payload: ToolMessagePayload = {
    status: resolvedResult.status,
    body: resolvedModelResult.body,
    error: resolvedModelResult.error,
    preApprovals: preApprovalResults.map((preApprovalResult) => {
      const preApprovalModelResult = toolCallResultToModelToolResult(preApprovalResult);
      return {
        status: "approval_required",
        body: toolCallOutputToModelBody(preApprovalResult.output),
        error: preApprovalModelResult.error,
        confirmation: preApprovalResult.confirmationRequest,
      };
    }),
  };
  const attachments = uniqueModelAttachments([
    ...(toolModelAttachmentsFromOutput(resolvedResult.output) ?? []),
    ...preApprovalResults.flatMap((result) => toolModelAttachmentsFromOutput(result.output) ?? []),
  ]);
  return {
    role: "tool",
    content: stringifyToolMessagePayload(payload, MAX_TOOL_MESSAGE_CHARS),
    toolCallId: resolvedResult.callId,
    toolName: resolvedResult.toolName,
    attachments: attachments.length === 0 ? undefined : attachments,
  };
}

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
  const continuations = fitContinuationsWithinTransportBudget(uniqueContinuations([
    ...modelOutputContinuationCandidates(canonicalModelBody(payload.body)),
    ...(payload.preApprovals ?? []).flatMap((preApproval) =>
      modelOutputContinuationCandidates(canonicalModelBody(preApproval.body))
    ),
  ]).slice(0, MAX_TRANSPORT_CONTINUATIONS));
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
        preview: transportStagePreviews(payload),
      },
    },
    error: contractError ?? payload.error,
  };
}

function transportStagePreviews(payload: ToolMessagePayload): ToolFactValue {
  const preApprovalStages = (payload.preApprovals ?? []).map((preApproval, index) => ({
    phase: "pre_approval" as const,
    index,
    status: preApproval.status,
    confirmationId: preApproval.confirmation?.confirmationId,
    body: canonicalModelBody(preApproval.body),
    error: preApproval.error,
  }));
  const stages = [
    ...preApprovalStages,
    {
      phase: "resolved" as const,
      index: preApprovalStages.length,
      status: payload.status,
      confirmationId: undefined,
      body: canonicalModelBody(payload.body),
      error: payload.error,
    },
  ];
  const selectedStages = stages.length <= MAX_TRANSPORT_STAGE_PREVIEWS
    ? stages
    : [
        ...stages.slice(0, MAX_TRANSPORT_STAGE_PREVIEWS / 2),
        ...stages.slice(-(MAX_TRANSPORT_STAGE_PREVIEWS / 2)),
      ];
  const perStageChars = Math.max(
    256,
    Math.floor(MAX_TRANSPORT_STAGE_PREVIEW_CHARS / selectedStages.length),
  );
  return {
    totalStages: stages.length,
    omittedMiddleStages: stages.length - selectedStages.length,
    stages: selectedStages.map((stage) => ({
      phase: stage.phase,
      index: stage.index,
      status: stage.status,
      ...(stage.confirmationId === undefined ? {} : { confirmationId: stage.confirmationId }),
      content: compactJsonPreview({ body: stage.body, error: stage.error }, perStageChars),
    })),
  };
}

function modelOutputContinuationCandidates(value: unknown): readonly ToolContinuation[] {
  const record = asRecord(value);
  return uniqueContinuations([
    ...continuationsFromRecord(record),
    ...continuationsFromRecord(asRecord(record.partialOutput)),
  ]);
}

function continuationsFromRecord(record: Readonly<Record<string, unknown>>): readonly ToolContinuation[] {
  const single = toolContinuationFromUnknown(record.continuation);
  const multiple = Array.isArray(record.continuations)
    ? record.continuations
      .slice(0, MAX_TRANSPORT_CONTINUATIONS)
      .map(toolContinuationFromUnknown)
      .filter((item): item is ToolContinuation => item !== undefined)
    : [];
  return single === undefined ? multiple : [single, ...multiple];
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

function uniqueModelAttachments(
  attachments: NonNullable<ModelMessage["attachments"]>,
): NonNullable<ModelMessage["attachments"]> {
  const selected: NonNullable<ModelMessage["attachments"]>[number][] = [];
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const key = attachment.attachmentId === undefined
      ? attachment.inputRef === undefined ? undefined : `input:${attachment.kind}:${attachment.inputRef}`
      : `attachment:${attachment.kind}:${attachment.attachmentId}`;
    if (key !== undefined && seen.has(key)) {
      continue;
    }
    if (key !== undefined) {
      seen.add(key);
    }
    selected.push(globalThis.structuredClone(attachment));
  }
  return selected;
}
