import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
} from "../basic-agent-runtime/index.js";
import type {
  PanelBasicAgentRunDetailReadModel,
  PanelBasicAgentRunViewReadModel,
} from "../panel-basic-agent-run-view-contracts.js";
import { panelRunPayloadForStatus, type PanelRunJob } from "../panel-run-jobs.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import { createLiveBasicAgentWorkViewReadModel, createPersistedBasicAgentWorkViewReadModel } from "./basic-agent-read-models.js";
import { createPersistedStreamEvents, panelStatusFromRuntimeStatus } from "./persisted-run-response.js";
import type { PanelRuntime } from "./runtime.js";
import { syncPanelRunStreamEventsForJob } from "./run-stream-sync.js";

type BasicAgentRunViewCoreReadModel = Omit<PanelBasicAgentRunViewReadModel, "workSession">;

export type BasicAgentRunViewRuntime = {
  readonly runExecutor: Pick<PanelRuntime["runExecutor"], "get" | "replayEvents" | "syncRunEvents">;
  readonly runJobs: Pick<PanelRuntime["runJobs"], "get" | "syncStreamEvents">;
  readonly runtimeDatabase?: Pick<NonNullable<PanelRuntime["runtimeDatabase"]>, "getRun">;
};

export async function createBasicAgentRunViewReadModel(
  runtime: BasicAgentRunViewRuntime,
  runId: string,
  afterSequence = 0
): Promise<PanelBasicAgentRunViewReadModel | undefined> {
  const job = runtime.runJobs.get(runId);
  if (job !== undefined) {
    return addLegacyWorkSessionAlias(await createLiveBasicAgentRunViewReadModel(runtime, job, afterSequence));
  }
  const snapshot = await runtime.runtimeDatabase?.getRun(runId);
  if (snapshot === undefined) {
    return undefined;
  }
  return addLegacyWorkSessionAlias(await createPersistedBasicAgentRunViewReadModel(snapshot, afterSequence));
}

async function createLiveBasicAgentRunViewReadModel(
  runtime: Pick<BasicAgentRunViewRuntime, "runExecutor" | "runJobs">,
  job: PanelRunJob,
  afterSequence: number
): Promise<BasicAgentRunViewCoreReadModel | undefined> {
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
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
  return {
    run,
    agentDefinitionRef: job.agentDefinitionRef ?? run.agentDefinitionRef,
    capabilityResolution: statusPayload?.capabilityResolution ?? job.capabilityResolution,
    workView,
    detail: {
      runId: job.runId,
      status: job.status,
      error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
      transcript: {
        events: streamEvents,
        transcriptNodes: workView.transcriptNodes,
      },
      canvas: statusPayload?.canvas,
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
): Promise<BasicAgentRunViewCoreReadModel> {
  const run = basicRunFromRuntimeSnapshot(snapshot);
  const fullReplay = basicRunReplayFromRuntimeSnapshot(snapshot);
  const workView = createPersistedBasicAgentWorkViewReadModel(snapshot);
  const replayEvents = fullReplay.events.filter((event) => event.sequence > afterSequence);
  return {
    run,
    agentDefinitionRef: run.agentDefinitionRef,
    capabilityResolution: snapshot.run.capabilityResolution,
    workView,
    detail: createPersistedBasicAgentRunDetailReadModel(snapshot),
    replay: {
      events: replayEvents,
      cursor: {
        lastSequence: fullReplay.cursor.lastSequence,
      },
    },
  };
}

function addLegacyWorkSessionAlias(
  view: BasicAgentRunViewCoreReadModel | undefined
): PanelBasicAgentRunViewReadModel | undefined {
  return view === undefined
    ? undefined
    : {
        ...view,
        workSession: view.workView,
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
    transcript: {
      events: streamEvents,
      transcriptNodes: createPanelTranscriptNodes(streamEvents),
    },
    restoredResult:
      snapshot.run.resultTitle === undefined && snapshot.run.resultSummary === undefined
        ? undefined
        : {
            title: snapshot.run.resultTitle ?? "上次结果",
            summary: snapshot.run.resultSummary ?? "结果已经整理完成。",
          },
  };
}
