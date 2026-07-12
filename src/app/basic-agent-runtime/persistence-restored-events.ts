import type { RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeEventRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { restoredConfirmationContinuationIsLost } from "./persistence-confirmations.js";
import { requireRestorableOrdinaryRuntimeSnapshot } from "./persistence-snapshot-contract.js";

/** Durable Basic events are an index, not a persisted display/read-model cache. */
export function durableBasicRunEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  return events
    .filter((event) => event.visibility !== "debug")
    .map((event) => ({
      id: event.id,
      runId: event.runId,
      sequence: event.sequence,
      type: event.type,
      title: event.title,
      status: event.status,
      timestamp: event.timestamp,
      toolName: event.toolName,
      refs: event.refs,
      visibility: event.visibility,
    }));
}

export function restoredBasicEventsFromRuntimeSnapshot(
  snapshot: RuntimeRunSnapshot
): readonly RunEvent[] {
  const persisted = requireRestorableOrdinaryRuntimeSnapshot(snapshot);
  const runtimeById = new Map(persisted.events.map((event) => [event.eventId, event]));
  const confirmationById = new Map(
    persisted.confirmations.map((confirmation) => [confirmation.confirmationId, confirmation])
  );
  const confirmationByToolCallId = new Map(
    persisted.confirmations
      .filter((confirmation) => confirmation.toolCallId !== undefined)
      .map((confirmation) => [confirmation.toolCallId!, confirmation])
  );

  return durableBasicRunEvents(persisted.basicEvents).flatMap((event) => {
    const runtimeEvent = runtimeEventForBasicEvent(event, runtimeById);
    const confirmation = confirmationForBasicEvent({
      event,
      runtimeEvent,
      confirmationById,
      confirmationByToolCallId,
    });
    if (shouldOmitDecidedConfirmationEvent(persisted, event, confirmation)) {
      return [];
    }
    return runtimeEvent === undefined
      ? [event]
      : [{
          ...event,
          summary: runtimeEvent.summary,
        }];
  });
}

function runtimeEventForBasicEvent(
  event: RunEvent,
  runtimeById: ReadonlyMap<string, RuntimeEventRecord>,
): RuntimeEventRecord | undefined {
  for (const ref of event.refs) {
    if (ref.kind !== "event") {
      continue;
    }
    const runtimeEvent = runtimeById.get(ref.id);
    if (runtimeEvent !== undefined) {
      return runtimeEvent;
    }
  }
  return undefined;
}

function confirmationForBasicEvent(input: {
  readonly event: RunEvent;
  readonly runtimeEvent?: RuntimeEventRecord;
  readonly confirmationById: ReadonlyMap<string, RuntimeConfirmationRecord>;
  readonly confirmationByToolCallId: ReadonlyMap<string, RuntimeConfirmationRecord>;
}): RuntimeConfirmationRecord | undefined {
  const confirmationId = confirmationIdFromEventRefs(input.event) ??
    confirmationIdFromRuntimeEvent(input.runtimeEvent);
  if (confirmationId !== undefined) {
    const confirmation = input.confirmationById.get(confirmationId);
    if (confirmation !== undefined) {
      return confirmation;
    }
  }
  const toolCallId = input.event.refs.find((ref) => ref.kind === "tool_call")?.id;
  return toolCallId === undefined ? undefined : input.confirmationByToolCallId.get(toolCallId);
}

function confirmationIdFromEventRefs(event: RunEvent): string | undefined {
  for (const ref of event.refs) {
    if (ref.kind === "event" && ref.id.startsWith("confirmation:")) {
      return ref.id.slice("confirmation:".length);
    }
  }
  return undefined;
}

function confirmationIdFromRuntimeEvent(event: RuntimeEventRecord | undefined): string | undefined {
  if (event === undefined || !isRecord(event.payload)) {
    return undefined;
  }
  return stringValue(event.payload.confirmationId) ?? stringValue(event.payload.requestId);
}

function shouldOmitDecidedConfirmationEvent(
  snapshot: RuntimeRunSnapshot,
  event: RunEvent,
  confirmation: RuntimeConfirmationRecord | undefined,
): boolean {
  if (confirmation === undefined) {
    return false;
  }
  return (
    (event.type === "confirmation.needed" || event.type === "user_approval.received") &&
    restoredConfirmationContinuationIsLost(snapshot, confirmation)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
