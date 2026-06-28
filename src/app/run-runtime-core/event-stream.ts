export type AppRunEventBase = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
};

export type AppRunEventPublishInput<TEvent extends AppRunEventBase> =
  Omit<TEvent, "sequence"> & { readonly sequence?: number };

export type AppRunEventCursor = {
  readonly runId: string;
  readonly lastSequence: number;
  readonly eventCount: number;
};

export type AppRunEventReplay<TEvent extends AppRunEventBase> = {
  readonly cursor: AppRunEventCursor;
  readonly events: readonly TEvent[];
};

export class AppRunEventHub<TEvent extends AppRunEventBase> {
  private readonly eventsByRunId = new Map<string, TEvent[]>();
  private readonly eventIdsByRunId = new Map<string, Set<string>>();

  publish(event: AppRunEventPublishInput<TEvent>): TEvent {
    const events = this.eventsByRunId.get(event.runId) ?? [];
    const ids = this.eventIdsByRunId.get(event.runId) ?? new Set<string>();
    const existing = ids.has(event.id) ? events.find((item) => item.id === event.id) : undefined;
    if (existing !== undefined) {
      return existing;
    }
    const next = {
      ...event,
      sequence: event.sequence ?? nextSequence(events),
    } as TEvent;
    events.push(next);
    sortBySequence(events);
    ids.add(next.id);
    this.eventsByRunId.set(event.runId, events);
    this.eventIdsByRunId.set(event.runId, ids);
    return next;
  }

  replace(event: TEvent): TEvent {
    const events = this.eventsByRunId.get(event.runId) ?? [];
    const index = events.findIndex((item) => item.id === event.id);
    if (index < 0) {
      return this.publish(event);
    }
    events[index] = event;
    sortBySequence(events);
    this.eventsByRunId.set(event.runId, events);
    return event;
  }

  replay(runId: string, afterSequence = 0): AppRunEventReplay<TEvent> {
    const events = this.eventsByRunId.get(runId) ?? [];
    return {
      cursor: this.cursor(runId),
      events: events.filter((event) => event.sequence > afterSequence),
    };
  }

  all(runId: string): readonly TEvent[] {
    return [...(this.eventsByRunId.get(runId) ?? [])];
  }

  latest(runId: string): TEvent | undefined {
    return this.eventsByRunId.get(runId)?.at(-1);
  }

  cursor(runId: string): AppRunEventCursor {
    const events = this.eventsByRunId.get(runId) ?? [];
    return {
      runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    };
  }
}

function nextSequence(events: readonly AppRunEventBase[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
}

function sortBySequence(events: AppRunEventBase[]): void {
  events.sort((left, right) => left.sequence - right.sequence);
}
