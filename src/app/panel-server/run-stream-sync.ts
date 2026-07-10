import type { BasicAgentRunExecutor } from "../basic-agent-runtime/index.js";
import { panelRunPayloadForStatus, type PanelRunJob, type PanelRunJobStore } from "./run-jobs.js";
import {
  createPanelRunStreamEvents,
  type PanelRunStreamEvent,
} from "../panel-run-read-model.js";

export type PanelRunStreamSyncRuntime = {
  readonly runJobs: Pick<PanelRunJobStore, "syncStreamEvents">;
  readonly runExecutor: Pick<BasicAgentRunExecutor, "syncRunEvents">;
};

export function persistentPanelRunStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly PanelRunStreamEvent[] {
  return events.filter((event) => !isVolatileLiveModelDelta(event));
}

export function syncPanelRunStreamEventsForJob(
  runtime: PanelRunStreamSyncRuntime,
  job: PanelRunJob
): readonly PanelRunStreamEvent[] {
  const statusPayload = panelRunPayloadForStatus(job);
  const derived = createPanelRunStreamEvents({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list() ?? [],
    summary: statusPayload?.summary,
    observation: statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });
  const events = runtime.runJobs.syncStreamEvents(job.runId, derived);
  runtime.runExecutor.syncRunEvents(job, persistentPanelRunStreamEvents(events));
  return events;
}

function isVolatileLiveModelDelta(event: PanelRunStreamEvent): boolean {
  return event.eventId.includes(":live:model.") &&
    (event.type === "model.output.delta" || event.type === "model.reasoning.delta");
}
