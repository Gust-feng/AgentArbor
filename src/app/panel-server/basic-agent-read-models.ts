import type {
  BasicAgentRun,
  ConfirmationRequest,
  DesktopWorkViewAnswer,
  DesktopWorkViewReadModel,
  RunEvent,
} from "../../domain/basic-agent/index.js";
import { isToolTerminalMessageType } from "../../domain/common.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import type { ToolDisplayProjection } from "../../domain/observation/index.js";
import {
  basicRunFromRuntimeSnapshot,
  createDesktopWorkViewReadModel,
  projectRunStreamEventToRunEvent,
} from "../basic-agent-runtime/index.js";
import { requireRestorableOrdinaryRuntimeSnapshot } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import { panelRunPayloadForStatus, type PanelRunJob } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import { restoredRunResultProjection } from "../run-read-model/restored-run-projection.js";
import type { BasicAgentOrdinaryRunFacts } from "../basic-agent-runtime/run-job.js";
import { observationRefs } from "../basic-agent-runtime/work-view-context.js";
import { createPersistedStreamEvents, panelStatusFromRuntimeStatus } from "./persisted-run-response.js";

export function createPersistedBasicAgentReplay(
  snapshot: RuntimeRunSnapshot,
  streamEvents?: readonly PanelRunStreamEvent[]
): {
  readonly events: readonly RunEvent[];
  readonly cursor: { readonly runId: string; readonly lastSequence: number; readonly eventCount: number };
} {
  const persistedSnapshot = requireRestorableOrdinaryRuntimeSnapshot(snapshot);
  const resolvedStreamEvents = streamEvents ?? createPersistedStreamEvents(
    persistedSnapshot,
    panelStatusFromRuntimeStatus(persistedSnapshot.run.status)
  );
  const events = resolvedStreamEvents.map(projectRunStreamEventToRunEvent);
  return {
    events,
    cursor: {
      runId: persistedSnapshot.run.runId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      eventCount: events.length,
    },
  };
}

export function createPersistedBasicAgentRun(
  snapshot: RuntimeRunSnapshot,
  streamEvents?: readonly PanelRunStreamEvent[]
): BasicAgentRun {
  const replay = createPersistedBasicAgentReplay(snapshot, streamEvents);
  return basicRunFromRuntimeSnapshot(snapshot, replay.events);
}

export function createLiveBasicAgentWorkViewReadModel(input: {
  readonly job: PanelRunJob;
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly streamEvents: readonly PanelRunStreamEvent[];
}): DesktopWorkViewReadModel {
  const statusPayload = panelRunPayloadForStatus(input.job);
  const base = createDesktopWorkViewReadModel({
    run: input.run,
    events: input.events,
    canvas: statusPayload?.canvas,
    taskSoilInput: input.job.taskSoilInput,
    toolDisplays: toolDisplaysFromStreamEvents(input.streamEvents),
    toolResultCount: terminalToolCallCount(input.streamEvents),
    subAgentRuns: input.job.runtime?.subAgentRunTraceStore.list() ?? [],
    pendingConfirmation: ordinaryPendingConfirmation(input.job, statusPayload?.ordinary),
    answer: ordinaryAnswer(statusPayload?.ordinary),
    restoredContextLedger: statusPayload?.ordinary?.contextLedger,
  }) satisfies DesktopWorkViewReadModel;
  return {
    ...base,
    transcriptNodes: createPanelTranscriptNodes(input.streamEvents, {
      confirmationMode: "current",
      pendingConfirmation: base.pendingConfirmation,
    }),
  } satisfies DesktopWorkViewReadModel;
}

function ordinaryAnswer(
  facts: BasicAgentOrdinaryRunFacts | undefined
): DesktopWorkViewAnswer | undefined {
  return facts?.answer === undefined
    ? undefined
    : {
        title: "已回答",
        content: facts.answer.content,
        evidenceRefs: observationRefs(facts.answer.evidenceRefs),
        nextActions: [],
      };
}

function ordinaryPendingConfirmation(
  job: PanelRunJob,
  facts: BasicAgentOrdinaryRunFacts | undefined
): ConfirmationRequest | undefined {
  const pending = facts?.pendingConfirmation;
  if (job.status !== "approval_needed" || pending === undefined) {
    return undefined;
  }
  return {
    ...pending,
    runId: job.runId,
    conversationId: job.conversationId,
  };
}

export function createPersistedBasicAgentWorkViewReadModel(
  snapshot: RuntimeRunSnapshot,
  streamEvents: readonly PanelRunStreamEvent[],
): DesktopWorkViewReadModel {
  const replay = createPersistedBasicAgentReplay(snapshot, streamEvents);
  const run = basicRunFromRuntimeSnapshot(snapshot, replay.events);
  return createDesktopWorkViewReadModel({
    run,
    events: replay.events,
    pendingConfirmation: snapshot.run.status === "approval_needed"
      ? restoredPendingConfirmation(snapshot.confirmations)
      : undefined,
    toolDisplays: toolDisplaysFromStreamEvents(streamEvents),
    toolResultCount: terminalToolCallCount(streamEvents),
    transcriptNodes: createPanelTranscriptNodes(streamEvents),
    restoredResult: restoredRunResultProjection(snapshot.run),
    restoredContextLedger: snapshot.contextLedger,
    subAgentRuns: snapshot.subAgentRuns,
  }) satisfies DesktopWorkViewReadModel;
}

function restoredPendingConfirmation(
  confirmations: readonly RuntimeConfirmationRecord[]
): DesktopWorkViewReadModel["pendingConfirmation"] {
  const pending = confirmations.find((confirmation) => confirmation.status === "pending");
  if (pending === undefined) {
    return undefined;
  }
  return {
    confirmationId: pending.confirmationId,
    runId: pending.runId,
    conversationId: pending.conversationId,
    title: pending.title,
    actionSummary: pending.actionSummary,
    affectedResources: pending.affectedResources,
    riskLevel: pending.riskLevel,
    resumeAvailability: "lost_after_restart",
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    sourceRefs: pending.sourceRefs ?? pending.eventRefs,
  };
}

function toolDisplaysFromStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly ToolDisplayProjection[] {
  const displays: ToolDisplayProjection[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const display = event.detail?.display;
    if (display === undefined) {
      continue;
    }
    const key = JSON.stringify(display);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    displays.push(display);
  }
  return displays;
}

function terminalToolCallCount(
  events: readonly PanelRunStreamEvent[]
): number {
  const seen = new Set<string>();
  for (const event of events) {
    if (!isToolTerminalMessageType(event.type)) {
      continue;
    }
    const callId = event.toolCallRefs[0];
    if (callId === undefined || seen.has(callId)) {
      continue;
    }
    seen.add(callId);
  }
  return seen.size;
}
