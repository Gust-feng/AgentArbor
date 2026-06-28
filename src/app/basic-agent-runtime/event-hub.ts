import type { AgentTaskStatus, RunEvent } from "../../domain/basic-agent/index.js";
import {
  AppRunEventHub,
  type AppRunEventCursor,
  type AppRunEventReplay,
} from "../run-runtime-core/event-stream.js";

export type BasicAgentRunCursor = AppRunEventCursor;

export type BasicAgentRunReplay = AppRunEventReplay<RunEvent>;

export class BasicAgentRunEventHub {
  private readonly events = new AppRunEventHub<RunEvent>();
  private readonly statusesByRunId = new Map<string, AgentTaskStatus>();

  publish(event: Omit<RunEvent, "sequence"> & { readonly sequence?: number }): RunEvent {
    const published = this.events.publish(event);
    this.refreshStatus(event.runId);
    return published;
  }

  replace(event: RunEvent): RunEvent {
    const replaced = this.events.replace(event);
    this.refreshStatus(event.runId);
    return replaced;
  }

  replay(runId: string, afterSequence = 0): BasicAgentRunReplay {
    return this.events.replay(runId, afterSequence);
  }

  cursor(runId: string): BasicAgentRunCursor {
    return this.events.cursor(runId);
  }

  status(runId: string): AgentTaskStatus | undefined {
    return this.statusesByRunId.get(runId);
  }

  private refreshStatus(runId: string): void {
    this.statusesByRunId.set(runId, latestStatus(this.events.all(runId)));
  }
}

function latestStatus(events: readonly RunEvent[]): AgentTaskStatus {
  return events.at(-1)?.status ?? "queued";
}
