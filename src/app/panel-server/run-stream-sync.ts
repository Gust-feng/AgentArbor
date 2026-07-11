import { panelRunPayloadForStatus, type PanelRunJob, type PanelRunJobStore } from "./run-jobs.js";
import {
  IncrementalPanelRunStreamProjector,
  type PanelRunStreamEvent,
} from "../panel-run-read-model.js";
import { appRunEventsAfterSequence } from "../run-runtime-core/event-stream.js";

export type PanelRunStreamProjectionRuntime = {
  readonly runJobs: Pick<PanelRunJobStore, "appendStreamEvents">;
};

type PanelRunStreamProjectionState = {
  readonly projector: IncrementalPanelRunStreamProjector;
  lastPublishedSequence: number;
};

const projectionStateByJob = new WeakMap<PanelRunJob, PanelRunStreamProjectionState>();

export function persistentPanelRunStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly PanelRunStreamEvent[] {
  return events.filter((event) => !isVolatileLiveModelDelta(event));
}

/**
 * Consumes new runtime facts and returns only transport events that have not
 * yet crossed into the Basic Agent event hub.
 *
 * Call this from run lifecycle/message publication paths. Read paths should
 * consume job.streamEvents directly and must never invoke this projection.
 */
export function projectPanelRunStreamEventsForJob(
  runtime: PanelRunStreamProjectionRuntime,
  job: PanelRunJob
): readonly PanelRunStreamEvent[] {
  const state = projectionStateFor(job);
  const statusPayload = panelRunPayloadForStatus(job);
  const derived = state.projector.project({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list(state.projector.lastSourceSequence) ?? [],
    summary: statusPayload?.summary,
    observation: statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });
  if (derived.length > 0) {
    runtime.runJobs.appendStreamEvents(job.runId, derived);
  }

  const lastPublishedSequence = state.lastPublishedSequence;
  state.lastPublishedSequence = Math.max(
    lastPublishedSequence,
    job.streamEvents.at(-1)?.sequence ?? 0
  );
  return persistentPanelRunStreamEvents(
    appRunEventsAfterSequence(job.streamEvents, lastPublishedSequence)
  );
}

function projectionStateFor(job: PanelRunJob): PanelRunStreamProjectionState {
  const existing = projectionStateByJob.get(job);
  if (existing !== undefined) {
    return existing;
  }
  const created: PanelRunStreamProjectionState = {
    projector: new IncrementalPanelRunStreamProjector(),
    lastPublishedSequence: 0,
  };
  projectionStateByJob.set(job, created);
  return created;
}

function isVolatileLiveModelDelta(event: PanelRunStreamEvent): boolean {
  return event.eventId.includes(":live:model.") &&
    (event.type === "model.output.delta" || event.type === "model.reasoning.delta");
}
