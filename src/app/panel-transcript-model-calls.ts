import type { ModelReasoningOutputProjection, ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

export type PanelTranscriptModelCall = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly status: "requested" | "completed" | "failed";
  readonly purpose?: string;
  readonly outputContractId?: string;
  readonly rootletKind?: RootletClusterKind;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly model?: string;
  readonly outputKind?: string;
  readonly validationStatus?: string;
  readonly failureKind?: string;
  readonly retryable?: boolean;
  readonly sanitizedErrorRef?: string;
  readonly visibleOutput?: ModelVisibleOutputProjection;
  readonly reasoningOutput?: ModelReasoningOutputProjection;
  readonly candidateRefs: readonly string[];
  readonly eventRefs: readonly string[];
};

export function createPanelTranscriptModelCalls(
  eventEntries: readonly EventLogEntry[],
  summary: UndergroundDemoSummary | undefined
): readonly PanelTranscriptModelCall[] {
  const calls = new Map<string, PanelTranscriptModelCall>();
  const summaryCalls = new Map(summary?.ai.modelCallRefs.map((call) => [call.requestId, call]) ?? []);

  for (const entry of eventEntries) {
    if (entry.type !== "model.requested" && entry.type !== "model.completed" && entry.type !== "model.failed") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const requestId = stringOrUndefined(payload.requestId);
    if (requestId === undefined) {
      continue;
    }
    const existing = calls.get(requestId);
    const summaryCall = summaryCalls.get(requestId);
    const outputContract = asRecord(payload.outputContract);
    const next: PanelTranscriptModelCall = {
      requestId,
      responseId: stringOrUndefined(payload.responseId) ?? existing?.responseId ?? summaryCall?.responseId,
      status: entry.type === "model.failed" ? "failed" : entry.type === "model.completed" ? "completed" : existing?.status ?? "requested",
      purpose: stringOrUndefined(payload.purpose) ?? existing?.purpose,
      outputContractId:
        stringOrUndefined(outputContract.contractId) ??
        existing?.outputContractId ??
        summaryCall?.visibleOutput?.contractId,
      rootletKind:
        summaryCall?.rootletKind ??
        existing?.rootletKind ??
        rootletKindFromAdviceContractId(stringOrUndefined(outputContract.contractId)),
      providerKind: stringOrUndefined(payload.providerKind) ?? existing?.providerKind ?? summaryCall?.providerKind,
      protocolKind: stringOrUndefined(payload.protocolKind) ?? existing?.protocolKind ?? summaryCall?.protocolKind,
      model: stringOrUndefined(payload.model) ?? existing?.model ?? summaryCall?.model,
      outputKind: stringOrUndefined(payload.outputKind) ?? existing?.outputKind ?? summaryCall?.outputKind,
      validationStatus: stringOrUndefined(payload.validationStatus) ?? existing?.validationStatus ?? summaryCall?.validationStatus,
      failureKind: stringOrUndefined(payload.failureKind) ?? existing?.failureKind,
      retryable: typeof payload.retryable === "boolean" ? payload.retryable : existing?.retryable,
      sanitizedErrorRef: stringOrUndefined(payload.sanitizedErrorRef) ?? existing?.sanitizedErrorRef,
      visibleOutput:
        modelVisibleOutputOrUndefined(payload.visibleOutput) ?? existing?.visibleOutput ?? summaryCall?.visibleOutput,
      reasoningOutput:
        modelReasoningOutputOrUndefined(payload.reasoningOutput) ?? existing?.reasoningOutput,
      candidateRefs: summaryCall?.candidateRefs ?? existing?.candidateRefs ?? [],
      eventRefs: unique([...(existing?.eventRefs ?? []), entry.message.id]),
    };
    calls.set(requestId, next);
  }

  return [...calls.values()];
}

export function rootletKindFromAdviceContractId(contractId: string | undefined): RootletClusterKind | undefined {
  if (contractId === undefined) {
    return undefined;
  }
  const prefix = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(prefix)) {
    return undefined;
  }
  const kind = contractId.slice(prefix.length).split(".")[0];
  return isRootletClusterKind(kind) ? kind : undefined;
}

export function modelVisibleOutputOrUndefined(value: unknown): ModelVisibleOutputProjection | undefined {
  const record = asRecord(value);
  if (
    typeof record.contractId !== "string" ||
    typeof record.outputKind !== "string" ||
    (record.source !== "structured_output" && record.source !== "text_output") ||
    record.validationStatus !== "passed" ||
    !Array.isArray(record.items)
  ) {
    return undefined;
  }
  return record as unknown as ModelVisibleOutputProjection;
}

export function modelReasoningOutputOrUndefined(value: unknown): ModelReasoningOutputProjection | undefined {
  const record = asRecord(value);
  if (
    typeof record.content !== "string" ||
    record.content.trim().length === 0 ||
    typeof record.truncated !== "boolean" ||
    (
      record.source !== "openai_responses_reasoning_summary" &&
      record.source !== "openai_chat_reasoning_content" &&
      record.source !== "provider_reasoning_content"
    )
  ) {
    return undefined;
  }
  return record as unknown as ModelReasoningOutputProjection;
}

export function safeReasoningOutputForPanel(value: unknown): ModelReasoningOutputProjection | undefined {
  const output = modelReasoningOutputOrUndefined(value);
  if (output === undefined) {
    return undefined;
  }
  if (
    output.source !== "openai_responses_reasoning_summary" &&
    output.source !== "openai_chat_reasoning_content"
  ) {
    return undefined;
  }
  return output;
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return (
    value === "option" ||
    value === "risk" ||
    value === "asset_fit" ||
    value === "evidence" ||
    value === "constraint" ||
    value === "counterfactual"
  );
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
