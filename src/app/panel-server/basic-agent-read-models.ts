import type {
  BasicAgentRun,
  DesktopWorkViewReadModel,
  RunEvent,
} from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
  createDesktopWorkViewReadModel,
} from "../basic-agent-runtime/index.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import { panelRunPayloadForStatus, type PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import { restoredRunResultProjection } from "../restored-run-projection.js";

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
    toolEvidence: toolEnvelopesFromStreamEvents(input.streamEvents),
    toolDisplays: toolDisplaysFromStreamEvents(input.streamEvents),
  }) satisfies DesktopWorkViewReadModel;
  return {
    ...base,
    transcriptNodes: createPanelTranscriptNodes(input.streamEvents, {
      confirmationMode: "current",
      pendingConfirmation: base.pendingConfirmation,
    }),
  } satisfies DesktopWorkViewReadModel;
}

export function createPersistedBasicAgentWorkViewReadModel(
  snapshot: RuntimeRunSnapshot
): DesktopWorkViewReadModel {
  const run = basicRunFromRuntimeSnapshot(snapshot);
  const replay = basicRunReplayFromRuntimeSnapshot(snapshot);
  return createDesktopWorkViewReadModel({
    run,
    events: replay.events,
    pendingConfirmation: restoredPendingConfirmation(snapshot.confirmations),
    toolEvidence: snapshot.toolCalls
      .map((call) => call.envelope)
      .filter((envelope): envelope is ToolResultEnvelope => envelope !== undefined),
    toolDisplays: snapshot.toolCalls
      .map((call) => call.display)
      .filter((display): display is ToolDisplayProjection => display !== undefined),
    restoredResult: restoredRunResultProjection(snapshot.run),
  }) satisfies DesktopWorkViewReadModel;
}

/**
 * @deprecated Compatibility name for older panel internals. New backend code
 * should use createLiveBasicAgentWorkViewReadModel.
 */
export const createLiveBasicAgentWorkSessionReadModel = createLiveBasicAgentWorkViewReadModel;

/**
 * @deprecated Compatibility name for older panel internals. New backend code
 * should use createPersistedBasicAgentWorkViewReadModel.
 */
export const createPersistedBasicAgentWorkSessionReadModel = createPersistedBasicAgentWorkViewReadModel;

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
    sourceRefs: pending.eventRefs,
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

function toolEnvelopesFromStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly ToolResultEnvelope[] {
  const envelopes: ToolResultEnvelope[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const envelope = event.detail?.envelope;
    if (envelope === undefined) {
      continue;
    }
    const key = envelope.diagnosticRef ?? JSON.stringify({
      summary: envelope.agentSummary,
      evidenceRefs: envelope.evidenceRefs,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    envelopes.push(envelope);
  }
  return envelopes;
}
