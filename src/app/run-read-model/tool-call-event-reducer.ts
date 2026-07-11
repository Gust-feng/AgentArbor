import { isToolLifecycleMessageType, type ToolLifecycleMessageType } from "../../domain/common.js";
import type { ToolCallResult, ToolErrorDomain, ToolErrorFacts } from "../../domain/tools/index.js";
import { normalizeToolErrorFacts } from "../../domain/tools/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";

export type ToolCallEventFact = {
  readonly callId: string;
  readonly toolName?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status: "requested" | ToolCallResult["status"];
  readonly error?: string;
  readonly errorDomain?: ToolErrorDomain;
  readonly errorFacts?: ToolErrorFacts;
  readonly durationMs?: number;
  readonly confirmationId?: string;
  readonly eventSequences: readonly number[];
  readonly createdAt?: string;
  readonly terminalAt?: string;
};

export function reduceToolCallEventFacts(entries: readonly EventLogEntry[]): readonly ToolCallEventFact[] {
  const calls = new Map<string, ToolCallEventFact>();
  for (const entry of entries) {
    if (!isToolLifecycleMessageType(entry.type) && entry.type !== "user_approval.requested") {
      continue;
    }
    const payload = asRecord(entry.message.payload);
    const callId = stringValue(payload.callId);
    if (callId === undefined) {
      continue;
    }
    const previous = calls.get(callId);
    const nextStatus = statusFromEvent(entry.type);
    if (previous !== undefined && isTerminalStatus(previous.status)) {
      calls.set(callId, withEventSequence(previous, entry.sequence));
      continue;
    }
    const terminal = isTerminalStatus(nextStatus);
    calls.set(callId, {
      callId,
      toolName: stringValue(payload.toolName) ?? previous?.toolName,
      input: payload.input ?? previous?.input,
      output: payload.output ?? previous?.output,
      status: nextStatus,
      error: entry.type === "tool.cancelled"
        ? stringValue(payload.reason) ?? previous?.error
        : stringValue(payload.error) ?? previous?.error,
      errorDomain: toolErrorDomain(payload.errorDomain) ?? previous?.errorDomain,
      errorFacts: normalizeToolErrorFacts(payload.errorFacts) ?? previous?.errorFacts,
      durationMs: numberValue(payload.durationMs) ?? previous?.durationMs,
      confirmationId: stringValue(payload.confirmationId) ?? previous?.confirmationId,
      eventSequences: uniqueNumbers([...(previous?.eventSequences ?? []), entry.sequence]),
      createdAt: previous?.createdAt ?? entry.recordedAt,
      terminalAt: terminal ? entry.recordedAt : previous?.terminalAt,
    });
  }
  return [...calls.values()];
}

function statusFromEvent(type: ToolLifecycleMessageType | "user_approval.requested"): ToolCallEventFact["status"] {
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
