import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { RuntimeRunContinuationAvailability } from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
} from "../basic-agent-runtime/index.js";
import type {
  PanelBasicAgentRunDetailReadModel,
  PanelBasicAgentRunViewReadModel,
} from "../panel-read-model/basic-agent-run-view-contracts.js";
import { panelRunPayloadForStatus, type PanelRunJob } from "./run-jobs.js";
import { summarizePanelRuntimeVisibility, type PanelRuntimeSummaryRegistry } from "../panel-read-model/run/panel-runtime-summary.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import { restoredRunResultProjection } from "../run-read-model/restored-run-projection.js";
import { createLiveBasicAgentWorkViewReadModel, createPersistedBasicAgentWorkViewReadModel } from "./basic-agent-read-models.js";
import { createPersistedStreamEvents, panelStatusFromRuntimeStatus } from "./persisted-run-response.js";
import type { PanelRuntime } from "./runtime.js";
import { persistentPanelRunStreamEvents } from "./run-stream-sync.js";

export type BasicAgentRunViewRuntime = {
  readonly runExecutor: Pick<PanelRuntime["runExecutor"], "get" | "replayEvents">;
  readonly runJobs: Pick<PanelRuntime["runJobs"], "get">;
  readonly runtimeDatabase?: Pick<NonNullable<PanelRuntime["runtimeDatabase"]>, "getRun">;
  readonly processRegistry?: PanelRuntimeSummaryRegistry;
};

export async function createBasicAgentRunViewReadModel(
  runtime: BasicAgentRunViewRuntime,
  runId: string,
  afterSequence = 0
): Promise<PanelBasicAgentRunViewReadModel | undefined> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    return createLiveBasicAgentRunViewReadModel(runtime, job, afterSequence);
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    return undefined;
  }
  return createPersistedBasicAgentRunViewReadModel(snapshot, afterSequence);
}

async function createLiveBasicAgentRunViewReadModel(
  runtime: Pick<BasicAgentRunViewRuntime, "runExecutor" | "runJobs" | "processRegistry">,
  job: PanelRunJob,
  afterSequence: number
): Promise<PanelBasicAgentRunViewReadModel | undefined> {
  const streamEvents = persistentPanelRunStreamEvents(job.streamEvents);
  const run = runtime.runExecutor.get(job.runId);
  const fullReplay = runtime.runExecutor.replayEvents(job.runId, 0);
  const replay = runtime.runExecutor.replayEvents(job.runId, afterSequence);
  if (run === undefined || fullReplay === undefined || replay === undefined) {
    return undefined;
  }
  const workView = createLiveBasicAgentWorkViewReadModel({
    job,
    run,
    events: fullReplay.events,
    streamEvents,
  });
  const statusPayload = panelRunPayloadForStatus(job);
  const agentDefinitionRef = job.agentDefinitionRef ?? run.agentDefinitionRef;
  const viewRun = agentDefinitionRef === run.agentDefinitionRef
    ? run
    : {
        ...run,
        agentDefinitionRef,
      };
  return {
    run: viewRun,
    agentDefinitionRef,
    capabilityResolution: statusPayload?.capabilityResolution ?? job.capabilityResolution,
    workView,
    detail: {
      runId: job.runId,
      status: job.status,
      error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
      stopReason: liveStopReasonForJob(job),
      continuationAvailability: liveContinuationAvailabilityForJob(job),
      transcript: {
        events: streamEvents,
        transcriptNodes: workView.transcriptNodes,
      },
      canvas: statusPayload?.canvas,
      runtimeSummary: summarizePanelRuntimeVisibility({
        runId: job.runId,
        processRegistry: runtime.processRegistry,
      }),
    },
    replay: {
      events: replay.events,
      cursor: {
        lastSequence: replay.cursor.lastSequence,
      },
    },
  };
}

async function createPersistedBasicAgentRunViewReadModel(
  snapshot: RuntimeRunSnapshot,
  afterSequence: number
): Promise<PanelBasicAgentRunViewReadModel> {
  const run = basicRunFromRuntimeSnapshot(snapshot);
  const fullReplay = basicRunReplayFromRuntimeSnapshot(snapshot);
  const workView = createPersistedBasicAgentWorkViewReadModel(snapshot);
  const replayEvents = fullReplay.events.filter((event) => event.sequence > afterSequence);
  const detail = createPersistedBasicAgentRunDetailReadModel(snapshot);
  return {
    run,
    agentDefinitionRef: run.agentDefinitionRef,
    capabilityResolution: snapshot.run.capabilityResolution,
    workView,
    detail,
    replay: {
      events: replayEvents,
      cursor: {
        lastSequence: fullReplay.cursor.lastSequence,
      },
    },
  };
}

function createPersistedBasicAgentRunDetailReadModel(
  snapshot: RuntimeRunSnapshot
): PanelBasicAgentRunDetailReadModel {
  const status = panelStatusFromRuntimeStatus(snapshot.run.status);
  const streamEvents = createPersistedStreamEvents(snapshot, status);
  return {
    runId: snapshot.run.runId,
    status,
    error: snapshot.run.error,
    stopReason: snapshot.run.stopReason,
    continuationAvailability: snapshot.run.continuationAvailability,
    transcript: {
      events: streamEvents,
      transcriptNodes: createPanelTranscriptNodes(streamEvents),
    },
    restoredResult: restoredRunResultProjection(snapshot.run),
  };
}

function liveStopReasonForJob(job: PanelRunJob): string | undefined {
  if (job.status === "approval_needed") {
    return "approval_required";
  }
  if (job.status === "needs_input") {
    return "needs_input";
  }
  if (job.status === "completed") {
    return "completed";
  }
  if (job.status === "failed") {
    return job.failed?.error.code ?? "failed";
  }
  if (job.status === "cancelled") {
    return job.cancelled?.reason.code ?? "cancelled";
  }
  if (job.status === "blocked") {
    return job.blocked?.reason.code ?? "blocked";
  }
  return undefined;
}

function liveContinuationAvailabilityForJob(job: PanelRunJob): RuntimeRunContinuationAvailability {
  if (job.status === "approval_needed") {
    return "live";
  }
  if (job.status === "needs_input") {
    return "new_turn";
  }
  const stopReason = liveStopReasonForJob(job);
  if (stopReason === "out_of_fuel" || stopReason === "context_overflow") {
    return "new_turn";
  }
  if (stopReason === "confirmation_continuation_lost") {
    return "lost_after_restart";
  }
  return "none";
}
