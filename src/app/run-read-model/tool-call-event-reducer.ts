import {
  isToolCallEventMessageType,
  type ToolCallEventMessageType,
} from "../../domain/common.js";
import type { ToolCallResult, ToolErrorDomain, ToolErrorFacts, ToolFactValue } from "../../domain/tools/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";

export type ToolCallEventEntry = {
  readonly sequence: number;
  readonly type: EventLogEntry["type"];
  readonly recordedAt: string;
  readonly message?: Pick<EventLogEntry["message"], "payload">;
  readonly payload?: ToolFactValue;
};

export type ToolCallEventFact = {
  readonly callId: string;
  readonly toolName?: string;
  readonly input?: ToolFactValue;
  readonly output?: ToolFactValue;
  readonly status: "requested" | ToolCallResult["status"];
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
  readonly confirmationId?: string;
  readonly factTruncation?: {
    readonly input?: true;
    readonly output?: true;
    readonly errorFacts?: true;
  };
  readonly eventSequences: readonly number[];
  readonly createdAt?: string;
  readonly terminalAt?: string;
};

export type ToolCallEventTimeline = {
  readonly facts: readonly ToolCallEventFact[];
  readonly factBySequence: ReadonlyMap<number, ToolCallEventFact>;
};

export function toolCallEventFactPayload(
  fact: ToolCallEventFact,
  eventType: ToolCallEventEntry["type"],
): Readonly<Record<string, unknown>> {
  return {
    callId: fact.callId,
    toolName: fact.toolName,
    input: fact.input,
    output: fact.output,
    status: fact.status,
    ...(eventType === "tool.cancelled" ? { reason: fact.error } : { error: fact.error }),
    errorDomain: fact.errorDomain,
    errorFacts: fact.errorFacts,
    durationMs: fact.durationMs,
    confirmationId: fact.confirmationId,
    factTruncation: fact.factTruncation,
  };
}

export function reduceToolCallEventFacts(entries: readonly ToolCallEventEntry[]): readonly ToolCallEventFact[] {
  return reduceToolCallEventTimeline(entries).facts;
}

export function reduceToolCallEventTimeline(entries: readonly ToolCallEventEntry[]): ToolCallEventTimeline {
  const calls = new Map<string, ToolCallEventFact>();
  const factBySequence = new Map<number, ToolCallEventFact>();
  for (const entry of entries) {
    const transitioned = reduceToolCallEvent(calls, entry);
    if (transitioned !== undefined) {
      factBySequence.set(entry.sequence, transitioned);
    }
  }
  return {
    facts: [...calls.values()],
    factBySequence,
  };
}

function reduceToolCallEvent(
  calls: Map<string, ToolCallEventFact>,
  entry: ToolCallEventEntry,
): ToolCallEventFact | undefined {
  if (!isToolCallEventMessageType(entry.type)) {
    return undefined;
  }
  const payload = asRecord(entry.message?.payload ?? entry.payload);
  const callId = stringValue(payload.callId);
  if (callId === undefined) {
    return undefined;
  }
  const previous = calls.get(callId);
  if (previous !== undefined && isTerminalStatus(previous.status)) {
    const fact = withEventSequence(previous, entry.sequence);
    calls.set(callId, fact);
    return fact;
  }
  const nextStatus = statusFromEvent(entry.type);
  const inputFact = factValue(payload.input);
  const outputFact = factValue(payload.output);
  const fact: ToolCallEventFact = {
    callId,
    toolName: stringValue(payload.toolName) ?? previous?.toolName,
    input: inputFact === undefined ? previous?.input : inputFact,
    output: outputFact === undefined ? previous?.output : outputFact,
    status: nextStatus,
    error: entry.type === "tool.cancelled"
      ? stringValue(payload.reason) ?? previous?.error
      : stringValue(payload.error) ?? previous?.error,
    errorDomain: toolErrorDomain(payload.errorDomain) ?? previous?.errorDomain,
    errorFacts: errorFactsValue(payload.errorFacts) ?? previous?.errorFacts,
    durationMs: numberValue(payload.durationMs) ?? previous?.durationMs,
    confirmationId: stringValue(payload.confirmationId) ?? previous?.confirmationId,
    factTruncation: mergeFactTruncation(previous?.factTruncation, payload.factTruncation),
    eventSequences: uniqueNumbers([...(previous?.eventSequences ?? []), entry.sequence]),
    createdAt: previous?.createdAt ?? entry.recordedAt,
    terminalAt: isTerminalStatus(nextStatus) ? entry.recordedAt : previous?.terminalAt,
  };
  calls.set(callId, fact);
  return fact;
}

function statusFromEvent(type: ToolCallEventMessageType): ToolCallEventFact["status"] {
  switch (type) {
    case "tool.completed": return "completed";
    case "tool.failed": return "failed";
    case "tool.cancelled": return "cancelled";
    case "user_approval.requested": return "approval_required";
    case "tool.requested": return "requested";
    default: return assertNever(type);
  }
}

function isTerminalStatus(status: ToolCallEventFact["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function withEventSequence(fact: ToolCallEventFact, sequence: number): ToolCallEventFact {
  return {
    ...fact,
    eventSequences: uniqueNumbers([...fact.eventSequences, sequence]),
  };
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function factValue(value: unknown): ToolFactValue | undefined {
  return value === undefined ? undefined : globalThis.structuredClone(value as ToolFactValue);
}

function errorFactsValue(value: unknown): ToolErrorFacts | undefined {
  return isRecord(value) ? globalThis.structuredClone(value as ToolErrorFacts) : undefined;
}

function mergeFactTruncation(
  previous: ToolCallEventFact["factTruncation"],
  value: unknown,
): ToolCallEventFact["factTruncation"] {
  const record = asRecord(value);
  const input = previous?.input === true || record.input === true ? true : undefined;
  const output = previous?.output === true || record.output === true ? true : undefined;
  const errorFacts = previous?.errorFacts === true || record.errorFacts === true ? true : undefined;
  return input === undefined && output === undefined && errorFacts === undefined
    ? undefined
    : { input, output, errorFacts };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolErrorDomain(value: unknown): ToolErrorDomain | undefined {
  return value === "model_error" ||
    value === "tool_error" ||
    value === "process_error" ||
    value === "runtime_error" ||
    value === "ui_submit_error"
    ? value
    : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported tool lifecycle event: ${String(value)}`);
}
