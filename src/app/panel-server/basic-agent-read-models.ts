import type {
  BasicAgentRun,
  DesktopWorkViewReadModel,
  RunEvent,
  ToolCallEvidence,
} from "../../domain/basic-agent/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeRunSnapshot,
  RuntimeToolCallRecord,
} from "../../domain/runtime-database/index.js";
import type { ToolDisplayProjection } from "../../domain/observation/index.js";
import {
  basicRunFromRuntimeSnapshot,
  basicRunReplayFromRuntimeSnapshot,
  createDesktopWorkViewReadModel,
} from "../basic-agent-runtime/index.js";
import { createPanelTranscriptNodes } from "../panel-run-read-model.js";
import { projectToolDisplay } from "../tool-projection/tool-display-projection.js";
import { panelRunPayloadForStatus, type PanelRunJob } from "./run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import { restoredRunResultProjection } from "../run-read-model/restored-run-projection.js";

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
    toolEvidence: toolEvidenceFromStreamEvents(input.streamEvents),
    toolDisplays: toolDisplaysFromStreamEvents(input.streamEvents),
    subAgentRuns: input.job.runtime?.subAgentRunTraceStore.list() ?? [],
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
    toolEvidence: toolEvidenceFromRuntimeToolCalls(snapshot.toolCalls),
    toolDisplays: snapshot.toolCalls
      .filter((call) => call.toolName !== undefined)
      .map((call) => call.toolName === "shell_command" || call.toolName === "run_command"
        ? { kind: "command_summary" as const, commandLine: call.command, exitCode: call.exitCode }
        : projectToolDisplay(
          { callId: call.callId, toolName: call.toolName!, input: { path: call.path, query: call.query, command: call.command } },
          { action: call.action, summary: call.summary, preview: call.preview, truncated: call.truncated, result: { path: call.path, query: call.query, command: call.command, exitCode: call.exitCode, preview: call.preview } },
        ))
      .filter((display): display is ToolDisplayProjection => display !== undefined),
    restoredResult: restoredRunResultProjection(snapshot.run),
    restoredContextLedger: snapshot.contextLedger,
    subAgentRuns: snapshot.subAgentRuns,
  }) satisfies DesktopWorkViewReadModel;
}

export function toolEvidenceFromRuntimeToolCalls(
  calls: readonly RuntimeToolCallRecord[],
): readonly ToolCallEvidence[] {
  return calls
    .filter((call) => call.status === "completed" || call.status === "failed" || call.status === "cancelled")
    .map((call): ToolCallEvidence => ({
        callId: call.callId,
        toolName: call.toolName,
        status: call.status as ToolCallEvidence["status"],
        summary: call.summary,
        evidenceRefs: call.eventRefs,
        truncated: call.truncated,
        error: call.error,
        errorDomain: call.errorDomain,
        errorFacts: call.errorFacts,
      }));
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

export function toolEvidenceFromStreamEvents(
  events: readonly PanelRunStreamEvent[]
): readonly ToolCallEvidence[] {
  const evidence: ToolCallEvidence[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool.completed" && event.type !== "tool.failed" && event.type !== "tool.cancelled") {
      continue;
    }
    const callId = event.toolCallRefs[0];
    if (callId === undefined || seen.has(callId)) {
      continue;
    }
    seen.add(callId);
    evidence.push({
      callId,
      toolName: event.toolName,
      status: event.type === "tool.completed" ? "completed" : event.type === "tool.cancelled" ? "cancelled" : "failed",
      summary: event.summary,
      evidenceRefs: event.sourceRefs.length > 0 ? event.sourceRefs : event.toolCallRefs,
      truncated: event.detail?.truncated,
      error: event.detail?.error,
      errorDomain: event.detail?.errorDomain,
      errorFacts: event.detail?.errorFacts,
    });
  }
  return evidence;
}
