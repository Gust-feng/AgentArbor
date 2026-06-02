import type {
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  explainDesktopIntentDecision,
  type DesktopIntentDecision,
  type DesktopIntentRoute,
} from "../desktop-intent-router.js";
import type { PanelConversationReadModel, PanelConversationStore } from "../panel-conversations.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import {
  createPanelRunTrace,
  createPanelTranscriptNodes,
  createPanelRunTracking,
  createPanelRunTranscript,
  type PanelRunStreamCursor,
  type PanelRunStatus,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "../panel-run-read-model.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { PanelDesktopRunMode, PanelRunJob, PanelRunKind } from "../panel-run-jobs.js";
import type { UndergroundDemoSummary } from "../underground-demo-summary.js";
import { syncPanelRunStreamEventsForJob, type PanelRunStreamSyncRuntime } from "./run-stream-sync.js";

export type PanelRunJobResponseRuntime = PanelRunStreamSyncRuntime & {
  readonly conversations: Pick<PanelConversationStore, "getReadModel">;
};

export type PanelRunJobResponse = {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly status: PanelRunStatus;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly trace: PanelRunTraceReadModel;
  readonly tracking: PanelRunTrackingReadModel;
  readonly transcript: PanelRunTranscript;
  readonly transcriptNodes: PanelRunTranscript["transcriptNodes"];
  readonly workNotes: PanelRunTranscript["workNotes"];
  readonly steps: PanelRunTranscript["steps"];
  readonly streamCursor: PanelRunStreamCursor;
  readonly summary?: UndergroundDemoSummary | { readonly ai: UndergroundDemoSummary["ai"] };
  readonly observation?: PanelObservationReadModel;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly route?: PanelDesktopRouteReadModel;
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

type PanelDesktopRouteReadModel = {
  readonly route: DesktopIntentRoute;
  readonly reason: string;
  readonly title: string;
  readonly summary: string;
};

export function createPanelRunJobResponse(
  runtime: PanelRunJobResponseRuntime,
  job: PanelRunJob
): PanelRunJobResponse {
  const eventEntries = job.runtime?.eventLog.list() ?? [];
  const config = job.completed?.config ?? job.failed?.config ?? job.cancelled?.config ?? job.blocked?.config ?? job.config;
  const informationAccess =
    job.completed?.informationAccess ??
    job.failed?.informationAccess ??
    job.cancelled?.informationAccess ??
    job.blocked?.informationAccess ??
    job.informationAccess;
  const summary = job.completed?.summary ?? job.blocked?.summary;
  const observation = job.completed?.observation ?? job.blocked?.observation;
  const agentRunTree = job.completed?.agentRunTree ?? job.blocked?.agentRunTree;
  const trace = createPanelRunTrace({ status: job.status, eventEntries });
  const tracking = createPanelRunTracking({
    status: job.status,
    config,
    informationAccess,
    requestedMode: job.aiMode,
    summary,
    observation,
    agentRunTree,
    eventEntries,
  });
  const streamEvents = syncPanelRunStreamEventsForJob(runtime, job);
  const transcript = {
    ...createPanelRunTranscript({
      runId: job.runId,
      status: job.status,
      eventEntries,
      summary,
      observation,
      agentRunTree,
      routeDecision: job.routeDecision,
      desktopMode: job.runKind === "desktop" ? job.runMode : undefined,
      reasoningEffort: job.reasoningEffort,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
    events: streamEvents,
    transcriptNodes: createPanelTranscriptNodes(streamEvents),
  };

  return {
    ok: true,
    runId: job.runId,
    runKind: job.runKind,
    runMode: job.runMode,
    status: job.status,
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
    summary: job.completed?.summary ?? job.blocked?.summary ?? job.failed?.summary,
    observation: job.completed?.observation ?? job.blocked?.observation,
    canvas: job.completed?.canvas ?? job.blocked?.canvas,
    route: routeReadModel(job.routeDecision),
    error: job.failed?.error ?? job.cancelled?.reason ?? job.blocked?.reason,
    conversation:
      job.conversationId === undefined
        ? undefined
        : runtime.conversations.getReadModel(job.conversationId),
  };
}

function routeReadModel(decision: DesktopIntentDecision | undefined): PanelDesktopRouteReadModel | undefined {
  if (decision === undefined) {
    return undefined;
  }
  const explanation = explainDesktopIntentDecision(decision);
  return {
    route: decision.route,
    reason: decision.reason,
    title: explanation.title,
    summary: explanation.summary,
  };
}
