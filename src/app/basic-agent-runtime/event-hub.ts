import type { AgentTaskStatus, RunEvent } from "../../domain/basic-agent/index.js";

export type BasicAgentRunCursor = {
  readonly runId: string;
  readonly lastSequence: number;
  readonly eventCount: number;
};

export type BasicAgentRunReplay = {
  readonly cursor: BasicAgentRunCursor;
  readonly events: readonly RunEvent[];
};

export class BasicAgentRunEventHub {
  private readonly eventsByRunId = new Map<string, RunEvent[]>();
  private readonly eventIdsByRunId = new Map<string, Set<string>>();
  private readonly statusesByRunId = new Map<string, AgentTaskStatus>();

  publish(event: Omit<RunEvent, "sequence"> & { readonly sequence?: number }): RunEvent {
    const events = this.eventsByRunId.get(event.runId) ?? [];
    const ids = this.eventIdsByRunId.get(event.runId) ?? new Set<string>();
    const existing = ids.has(event.id) ? events.find((item) => item.id === event.id) : undefined;
    if (existing !== undefined) {
      return existing;
    }
    const next: RunEvent = {
      ...event,
      sequence: event.sequence ?? nextSequence(events),
    };
    events.push(next);
    events.sort((left, right) => left.sequence - right.sequence);
    ids.add(next.id);
    this.eventsByRunId.set(event.runId, events);
    this.eventIdsByRunId.set(event.runId, ids);
    this.statusesByRunId.set(event.runId, latestStatus(events));
    return next;
  }

  replace(event: RunEvent): RunEvent {
    const events = this.eventsByRunId.get(event.runId) ?? [];
    const index = events.findIndex((item) => item.id === event.id);
    if (index < 0) {
      return this.publish(event);
    }
    events[index] = event;
    events.sort((left, right) => left.sequence - right.sequence);
    this.eventsByRunId.set(event.runId, events);
    this.statusesByRunId.set(event.runId, latestStatus(events));
    return event;
  }

  replay(runId: string, afterSequence = 0): BasicAgentRunReplay {
    const events = this.eventsByRunId.get(runId) ?? [];
    return {
      cursor: this.cursor(runId),
      events: events.filter((event) => event.sequence > afterSequence),
    };
  }

  cursor(runId: string): BasicAgentRunCursor {
    const events = this.eventsByRunId.get(runId) ?? [];
    return {
      runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    };
  }

  status(runId: string): AgentTaskStatus | undefined {
    return this.statusesByRunId.get(runId);
  }
}

function nextSequence(events: readonly RunEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

function latestStatus(events: readonly RunEvent[]): AgentTaskStatus {
  return events.at(-1)?.status ?? "queued";
}
