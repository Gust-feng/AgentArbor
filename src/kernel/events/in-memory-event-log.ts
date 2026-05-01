import type { ArborMessage, ArborMessageType } from "../../domain/common.js";
import { nowIso } from "../id.js";

export type EventLogEntry<TPayload = unknown> = {
  sequence: number;
  type: ArborMessageType;
  message: ArborMessage<TPayload>;
  recordedAt: string;
};

export class InMemoryEventLog {
  private readonly entries: EventLogEntry[] = [];

  append<TPayload>(message: ArborMessage<TPayload>): EventLogEntry<TPayload> {
    const entry: EventLogEntry<TPayload> = {
      sequence: this.entries.length + 1,
      type: message.type,
      message: cloneFact(message),
      recordedAt: nowIso(),
    };
    this.entries.push(entry);
    return cloneEventLogEntry(entry);
  }

  list(): EventLogEntry[] {
    return this.entries.map(cloneEventLogEntry);
  }

  replay(): ArborMessage[] {
    return this.entries.map((entry) => cloneFact(entry.message));
  }

  types(): ArborMessageType[] {
    return this.entries.map((entry) => entry.type);
  }
}

function cloneEventLogEntry<TPayload>(entry: EventLogEntry<TPayload>): EventLogEntry<TPayload> {
  return {
    ...entry,
    message: cloneFact(entry.message),
  };
}

function cloneFact<T>(value: T): T {
  return globalThis.structuredClone(value);
}
