import type { BasicAgentRunExecutor } from "../basic-agent-runtime/index.js";
import type { PanelRunJob, PanelRunJobStore } from "../panel-run-jobs.js";
import {
  createPanelRunStreamEvents,
  type PanelRunStreamEvent,
} from "../panel-run-read-model.js";

export type PanelRunStreamSyncRuntime = {
  readonly runJobs: Pick<PanelRunJobStore, "syncStreamEvents">;
  readonly runExecutor: Pick<BasicAgentRunExecutor, "syncRunEvents">;
};

export function syncPanelRunStreamEventsForJob(
  runtime: PanelRunStreamSyncRuntime,
  job: PanelRunJob
): readonly PanelRunStreamEvent[] {
  const derived = createPanelRunStreamEvents({
    runId: job.runId,
    status: job.status,
    eventEntries: job.runtime?.eventLog.list() ?? [],
    summary: job.completed?.summary ?? job.blocked?.summary ?? job.failed?.summary,
    observation: job.completed?.observation ?? job.blocked?.observation,
    routeDecision: job.routeDecision,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });
  const events = runtime.runJobs.syncStreamEvents(job.runId, derived);
  runtime.runExecutor.syncRunEvents(job, events);
  return events;
}
