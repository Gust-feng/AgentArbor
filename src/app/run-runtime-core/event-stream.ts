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

  replay(runId: string, afterSequence = 0): AppRunEventReplay<TEvent> {
    const events = this.eventsByRunId.get(runId) ?? [];
    return {
      cursor: this.cursor(runId),
      events: appRunEventsAfterSequence(events, afterSequence),
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

/** Returns the append-only suffix without rescanning the already-consumed prefix. */
export function appRunEventsAfterSequence<TEvent extends Pick<AppRunEventBase, "sequence">>(
  events: readonly TEvent[],
  afterSequence: number
): readonly TEvent[] {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((events[middle]?.sequence ?? 0) <= afterSequence) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return events.slice(low);
}

function nextSequence(events: readonly AppRunEventBase[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
}

function sortBySequence(events: AppRunEventBase[]): void {
  events.sort((left, right) => left.sequence - right.sequence);
}
