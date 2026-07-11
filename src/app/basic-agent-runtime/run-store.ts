import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import { BasicAgentRunEventHub, type BasicAgentRunReplay } from "./event-hub.js";

export type { BasicAgentRunReplay } from "./event-hub.js";

export type BasicAgentRunStoreSnapshot = {
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
};

export class BasicAgentRunStore {
  private readonly runs = new Map<string, BasicAgentRun>();
  private readonly eventHub = new BasicAgentRunEventHub();

  upsert(run: BasicAgentRun): BasicAgentRun {
    const stored = withCursor(run, this.eventHub.cursor(run.runId));
    this.runs.set(stored.runId, stored);
    return stored;
  }

  get(runId: string): BasicAgentRun | undefined {
    const run = this.runs.get(runId);
    return run === undefined ? undefined : withCursor(run, this.eventHub.cursor(runId));
  }

  publishEvent(event: Omit<RunEvent, "sequence"> & { readonly sequence?: number }): RunEvent {
    const published = this.eventHub.publish(event);
    this.refreshRunCursor(event.runId);
    return published;
  }

  replayEvents(runId: string, afterSequence = 0): BasicAgentRunReplay | undefined {
    if (!this.runs.has(runId)) {
      return undefined;
    }
    return this.eventHub.replay(runId, afterSequence);
  }

  restore(snapshot: BasicAgentRunStoreSnapshot): BasicAgentRun {
    for (const event of snapshot.events) {
      this.eventHub.publish(event);
    }
    return this.upsert(snapshot.run);
  }

  snapshot(runId: string): BasicAgentRunStoreSnapshot | undefined {
    const run = this.get(runId);
    if (run === undefined) {
      return undefined;
    }
    return {
      run,
      events: this.eventHub.replay(runId, 0).events,
    };
  }

  private refreshRunCursor(runId: string): void {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, withCursor(run, this.eventHub.cursor(runId)));
    }
  }
}

function withCursor(
  run: BasicAgentRun,
  cursor: { readonly lastSequence: number; readonly eventCount: number }
): BasicAgentRun {
  return {
    ...run,
    eventCursor: {
      lastSequence: cursor.lastSequence,
      eventCount: cursor.eventCount,
    },
  };
}
