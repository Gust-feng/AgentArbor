import type { ArborMessage, ArborMessageType } from "../../domain/contracts.js";
import { nowIso } from "../id.js";

export type EventLogEntry<TPayload = unknown> = {
  sequence: number;
  type: ArborMessageType;
  message: ArborMessage<TPayload>;
  recordedAt: string;
};

export class InMemoryEventLog {
  private readonly entries: EventLogEntry[] = [];

  append(message: ArborMessage): EventLogEntry {
    const entry: EventLogEntry = {
      sequence: this.entries.length + 1,
      type: message.type,
      message,
      recordedAt: nowIso(),
    };
    this.entries.push(entry);
    return entry;
  }

  list(): EventLogEntry[] {
    return [...this.entries];
  }

  replay(): ArborMessage[] {
    return this.entries.map((entry) => entry.message);
  }

  types(): ArborMessageType[] {
    return this.entries.map((entry) => entry.type);
  }
}
