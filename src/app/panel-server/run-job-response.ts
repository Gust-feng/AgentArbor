import type {
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelConversationReadModel, PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import {
  createPanelRunTrace,
  createPanelRunTracking,
  createPanelRunTranscript,
  type PanelRunStreamCursor,
  type PanelRunStatus,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "../panel-run-read-model.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import {
  panelRunPayloadForStatus,
  type PanelRunJob,
  type PanelRunKind,
  type PanelRunMode,
} from "../panel-run-jobs.js";
import type { PanelRunSummaryPayload } from "../panel-run-summary.js";
import {
  summarizePanelRuntimeVisibility,
  type PanelRuntimeSummaryReadModel,
  type PanelRuntimeSummaryRegistry,
} from "../panel-read-model/run/panel-runtime-summary.js";
import {
  persistentPanelRunStreamEvents,
  syncPanelRunStreamEventsForJob,
  type PanelRunStreamSyncRuntime,
} from "./run-stream-sync.js";
import { projectPanelRunResponseBase, type PanelRunResponseBase } from "./run-response-base.js";

export type PanelRunJobResponseRuntime = PanelRunStreamSyncRuntime & {
  readonly conversations: Pick<PanelConversationStore, "getReadModel">;
  readonly processRegistry?: PanelRuntimeSummaryRegistry;
};

export type PanelRunJobResponse = PanelRunResponseBase & {
  readonly trace: PanelRunTraceReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
  readonly transcriptNodes: PanelRunTranscript["transcriptNodes"];
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly summary?: PanelRunSummaryPayload;
  readonly observation?: PanelObservationReadModel;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly runtimeSummary?: PanelRuntimeSummaryReadModel;
};

export function createPanelRunJobResponse(
  runtime: PanelRunJobResponseRuntime,
  job: PanelRunJob
): PanelRunJobResponse {
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const statusPayload = panelRunPayloadForStatus(job);
  const config = statusPayload?.config ?? job.config;
  const informationAccess = statusPayload?.informationAccess ?? job.informationAccess;
  const summary = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.summary;
  const responseSummary = statusPayload?.summary;
  const observation = statusPayload === undefined || !("observation" in statusPayload) ? undefined : statusPayload.observation;
  const agentRunTree = statusPayload === undefined || !("agentRunTree" in statusPayload) ? undefined : statusPayload.agentRunTree;
  const trace = createPanelRunTrace({ status: job.status, runMode: job.runMode, eventEntries });
  const tracking = createPanelRunTracking({
    status: job.status,
    runMode: job.runMode,
    config,
    informationAccess,
    requestedMode: job.aiMode,
    summary,
    observation,
    agentRunTree,
    eventEntries,
  });
  const streamEvents = persistentPanelRunStreamEvents(syncPanelRunStreamEventsForJob(runtime, job));
  const transcript = createPanelRunTranscript({
    runId: job.runId,
    status: job.status,
    eventEntries,
    streamEvents,
    summary,
    observation,
    agentRunTree,
    desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
    reasoningEffort: job.reasoningEffort,
    agentDefinitionRef: job.agentDefinitionRef,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
  });

  return {
    ...projectPanelRunResponseBase({
      runId: job.runId,
      runKind: job.runKind,
      runMode: job.runMode,
      status: job.status,
      agentDefinitionRef: job.agentDefinitionRef,
      capabilityResolution: statusPayload?.capabilityResolution ?? job.capabilityResolution,
      config,
      informationAccess,
      streamCursor: {
        runId: job.runId,
        lastSequence: transcript.events.at(-1)?.sequence ?? 0,
      },
      error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
      conversation:
        job.conversationId === undefined
          ? undefined
          : runtime.conversations.getReadModel(job.conversationId),
    }),
    trace,
    tracking,
    transcript,
    transcriptNodes: transcript.transcriptNodes,
    workNotes: transcript.workNotes,
    steps: transcript.steps,
    summary: responseSummary,
    observation,
    canvas: statusPayload?.canvas,
    runtimeSummary: summarizePanelRuntimeVisibility({
      runId: job.runId,
      processRegistry: runtime.processRegistry,
    }),
  };
}
