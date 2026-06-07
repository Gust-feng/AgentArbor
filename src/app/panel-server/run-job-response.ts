import type {
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelConversationReadModel, PanelConversationStore } from "../panel-conversations.js";
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
import { syncPanelRunStreamEventsForJob, type PanelRunStreamSyncRuntime } from "./run-stream-sync.js";

export type PanelRunJobResponseRuntime = PanelRunStreamSyncRuntime & {
  readonly conversations: Pick<PanelConversationStore, "getReadModel">;
};

export type PanelRunJobResponse = {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly status: PanelRunStatus;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly trace: PanelRunTraceReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
  readonly transcriptNodes: PanelRunTranscript["transcriptNodes"];
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly summary?: PanelRunSummaryPayload;
  readonly observation?: PanelObservationReadModel;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly conversation?: PanelConversationReadModel;
  readonly restoredFromSnapshot?: true;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly snapshot?: {
    readonly run: RuntimeRunSnapshot["run"];
    readonly workspace?: RuntimeRunSnapshot["workspace"];
    readonly toolCalls: RuntimeRunSnapshot["toolCalls"];
    readonly artifacts: RuntimeRunSnapshot["artifacts"];
    readonly confirmations: RuntimeRunSnapshot["confirmations"];
  };
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
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
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
    ok: true,
    runId: job.runId,
    runKind: job.runKind,
    runMode: job.runMode,
    status: job.status,
    agentDefinitionRef: job.agentDefinitionRef,
    capabilityResolution: statusPayload?.capabilityResolution ?? job.capabilityResolution,
    config,
    informationAccess,
    trace,
    tracking,
    transcript,
    transcriptNodes: transcript.transcriptNodes,
    workNotes: transcript.workNotes,
    steps: transcript.steps,
    streamCursor: {
      runId: job.runId,
      lastSequence: transcript.events.at(-1)?.sequence ?? 0,
    },
    summary: responseSummary,
    observation,
    canvas: statusPayload?.canvas,
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
    conversation:
      job.conversationId === undefined
        ? undefined
        : runtime.conversations.getReadModel(job.conversationId),
  };
}
