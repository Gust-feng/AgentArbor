import { panelRunPayloadForStatus, type PanelRunJob, type PanelRunJobStore } from "./run-jobs.js";
import {
  IncrementalPanelRunStreamProjector,
  type PanelRunStreamEvent,
} from "../panel-run-read-model.js";
import { appRunEventsAfterSequence } from "../run-runtime-core/event-stream.js";

export type PanelRunStreamProjectionRuntime = {
  readonly runJobs: Pick<PanelRunJobStore, "appendStreamEvents">;
};

/**
 * Owns the incremental transport projector for each live Panel run.
 *
 * This is write-side projection state, not feature state: callers create one
 * owner with the Panel runtime, terminal runs release their projector, and
 * runtime shutdown clears any remaining non-terminal projectors.
 */
export class PanelRunStreamProjectionOwner {
  private readonly projectors = new Map<string, IncrementalPanelRunStreamProjector>();

  project(
    runtime: PanelRunStreamProjectionRuntime,
    job: PanelRunJob
  ): readonly PanelRunStreamEvent[] {
    const projector = this.projectors.get(job.runId) ?? new IncrementalPanelRunStreamProjector();
    this.projectors.set(job.runId, projector);
    try {
      return projectPanelRunStreamEventsWithProjector(runtime, job, projector);
    } finally {
      if (isTerminalPanelRunStatus(job.status)) {
        this.projectors.delete(job.runId);
      }
    }
  }

  clear(): void {
    this.projectors.clear();
  }
}

export function persistentPanelRunStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly PanelRunStreamEvent[] {
  return events.filter((event) => !isVolatileLiveModelDelta(event));
}

/**
 * Reprojects the current runtime facts and appends only event IDs the run job
 * has not seen. The job store owns de-duplication and transport sequencing.
 *
 * Call this from run lifecycle/message publication paths. Read paths should
 * consume job.streamEvents directly and must never invoke this projection.
 */
export function projectPanelRunStreamEventsForJob(
  runtime: PanelRunStreamProjectionRuntime,
  job: PanelRunJob,
  owner: PanelRunStreamProjectionOwner
): readonly PanelRunStreamEvent[] {
  return owner.project(runtime, job);
}

function projectPanelRunStreamEventsWithProjector(
  runtime: PanelRunStreamProjectionRuntime,
  job: PanelRunJob,
  projector: IncrementalPanelRunStreamProjector
): readonly PanelRunStreamEvent[] {
  const statusPayload = panelRunPayloadForStatus(job);
  const derived = projector.project({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list(projector.lastSourceSequence) ?? [],
    summary: statusPayload?.summary,
    observation: statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });
  const lastPublishedSequence = job.streamEvents.at(-1)?.sequence ?? 0;
  if (derived.length > 0) {
    runtime.runJobs.appendStreamEvents(job.runId, derived);
  }
  return persistentPanelRunStreamEvents(
    appRunEventsAfterSequence(job.streamEvents, lastPublishedSequence)
  );
}

function isTerminalPanelRunStatus(status: PanelRunJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function isVolatileLiveModelDelta(event: PanelRunStreamEvent): boolean {
  return event.eventId.includes(":live:model.") &&
    (event.type === "model.output.delta" || event.type === "model.reasoning.delta");
}
