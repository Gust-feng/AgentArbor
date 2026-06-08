import type { ArborMessageType } from "../domain/common.js";
import type { ModelRunReasoningEffort, RunAgentDefinitionRef } from "../domain/config/index.js";
import {
  createRunObservationEventViews,
  type RunObservationEventView,
} from "../domain/observation/index.js";
import {
  modelReasoningOutputOrUndefined,
  safeReasoningOutputForPanel,
} from "./panel-transcript-model-calls.js";
import {
  asRecord,
  isString,
  stringOrUndefined,
  unique,
} from "./panel-read-model-utils.js";
import {
  type PanelRunStreamEventDetail,
  toolStreamDetail,
  toolSummary,
} from "./panel-stream-tool-projection.js";
import type { PanelObservationReadModel } from "./panel-run-tracking-contracts.js";
import type { PanelRunStatus } from "./panel-run-status.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import type { PanelRunSummaryPayload } from "./panel-run-summary.js";
import type { PanelRunStreamEvent, PanelRunStreamEventType } from "./panel-run-stream-contracts.js";
import {
  agentFabricLabel,
  agentFabricSummary,
  agentNoteForEvent,
  blockedRunSummary,
  chunkText,
  confirmationSummary,
  contextCompactionPreview,
  contextCompactionStreamSummary,
  finalResultSummary,
  finalSourceRefs,
  modelCompletedSummary,
  modelFailedSummary,
  modelFailureStreamDetail,
  modelRequestedSummary,
  runFailedSummary,
  runFailureStreamDetail,
  runStartedSummary,
  userGuidanceSummary,
  visibleOutputSummary,
  visibleOutputText,
} from "./panel-run-stream-copy.js";

export type { PanelRunStreamEvent, PanelRunStreamEventDetail, PanelRunStreamEventType } from "./panel-run-stream-contracts.js";

export function createPanelRunStreamEvents(input: {
  readonly runId: string;
  readonly status: PanelRunStatus;
  readonly eventEntries: readonly EventLogEntry[];
  readonly summary?: PanelRunSummaryPayload;
  readonly observation?: PanelObservationReadModel;
  readonly desktopMode?: "agent" | "deep";
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly agentDefinitionRef?: Pick<RunAgentDefinitionRef, "agentDisplayName">;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
}): readonly PanelRunStreamEvent[] {
  const events: PanelRunStreamEvent[] = [];
  const agentLabel = agentSelfLabel(input.agentDefinitionRef);
  const observationViews = createRunObservationEventViews(input.eventEntries);
  const viewBySequence = new Map(observationViews.map((view) => [view.sequence, view]));
  const ordinaryAgentProjection = isOrdinaryAgentProjection(input.desktopMode);
  const suppressOrdinaryChatProgress =
    ordinaryAgentProjection && !hasUserVisibleWorkActivity(input.eventEntries, ordinaryAgentProjection);
  const push = (event: Omit<PanelRunStreamEvent, "sequence">): void => {
    events.push({ ...event, sequence: events.length + 1 });
  };

  push({
    eventId: `${input.runId}:run.started`,
    runId: input.runId,
    type: "run.started",
    createdAt: input.createdAt,
    agentLabel,
    summary: runStartedSummary(input.desktopMode),
    status: input.status === "pending" ? "pending" : "running",
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: [],
  });

  for (const entry of input.eventEntries) {
    if (shouldSuppressOrdinaryGoalEvent(entry.type, input.desktopMode)) {
      continue;
    }
    if (ordinaryAgentProjection && !isOrdinaryAgentStreamEvent(entry.type)) {
      continue;
    }
    if (suppressOrdinaryChatProgress && shouldSuppressOrdinaryChatEvent(entry)) {
      continue;
    }
    const view = viewBySequence.get(entry.sequence);
    appendStreamEventsForEvent({
      runId: input.runId,
      entry,
      view,
      push,
    });
  }

  if (input.status === "completed") {
    const finalSummary = finalResultSummary(input);
    if (finalSummary !== undefined) {
      push({
        eventId: `${input.runId}:final.result`,
        runId: input.runId,
        type: "final.result",
        createdAt: input.updatedAt,
        agentLabel,
        summary: finalSummary,
        status: "completed",
        sourceRefs: finalSourceRefs(input),
        modelCallRefs: [],
        toolCallRefs: [],
      });
    }
  }

  if (input.status === "cancelled") {
    push({
      eventId: `${input.runId}:run.cancelled`,
      runId: input.runId,
      type: "run.cancelled",
      createdAt: input.updatedAt,
      agentLabel,
      summary: "已取消。",
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  if (input.status === "blocked") {
    push({
      eventId: `${input.runId}:run.blocked`,
      runId: input.runId,
      type: "run.blocked",
      createdAt: input.updatedAt,
      agentLabel,
      summary: blockedRunSummary(input.error),
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  if (input.status === "failed") {
    push({
      eventId: `${input.runId}:run.failed`,
      runId: input.runId,
      type: "run.failed",
      createdAt: input.updatedAt,
      agentLabel,
      summary: runFailedSummary(input.error),
      status: "failed",
      detail: runFailureStreamDetail(input.error),
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  return events;
}

function agentSelfLabel(ref: Pick<RunAgentDefinitionRef, "agentDisplayName"> | undefined): string {
  const label = ref?.agentDisplayName.trim();
  return label === undefined || label.length === 0 ? "AgentArbor" : label;
}

function isOrdinaryAgentProjection(desktopMode: "agent" | "deep" | undefined): boolean {
  return desktopMode === "agent";
}

function shouldSuppressOrdinaryGoalEvent(
  type: ArborMessageType,
  desktopMode: "agent" | "deep" | undefined
): boolean {
  return type === "goal.received" && desktopMode === "agent";
}

function hasUserVisibleWorkActivity(
  eventEntries: readonly EventLogEntry[],
  ordinaryAgentProjection: boolean
): boolean {
  return eventEntries.some((entry) => {
    if (entry.type === "tool.requested" || entry.type === "tool.completed" || entry.type === "tool.failed") {
      return true;
    }
    if (entry.type === "user_approval.requested") {
      return true;
    }
    if (entry.type === "user_approval.received") {
      return userApprovalReceivedKind(asRecord(entry.message.payload)) !== "approved";
    }
    return !ordinaryAgentProjection && isAgentFabricStreamType(entry.type);
  });
}

function isOrdinaryAgentStreamEvent(type: ArborMessageType): boolean {
  return type === "goal.received" ||
    type === "model.requested" ||
    type === "model.completed" ||
    type === "model.failed" ||
    type === "context.compaction.completed" ||
    type === "context.compaction.failed" ||
    type === "tool.requested" ||
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "user_approval.requested" ||
    type === "user_approval.received";
}

function shouldSuppressOrdinaryChatEvent(entry: EventLogEntry): boolean {
  if (entry.type === "goal.received" || entry.type === "model.requested") {
    return true;
  }
  if (entry.type !== "model.completed") {
    return false;
  }
  const payload = asRecord(entry.message.payload);
  return modelReasoningOutputOrUndefined(payload.reasoningOutput) === undefined;
}

function appendStreamEventsForEvent(input: {
  readonly runId: string;
  readonly entry: EventLogEntry;
  readonly view?: RunObservationEventView;
  readonly push: (event: Omit<PanelRunStreamEvent, "sequence">) => void;
}): void {
  const payload = asRecord(input.entry.message.payload);
  const base = {
    runId: input.runId,
    createdAt: input.entry.recordedAt,
    sourceRefs: sourceRefsForView(input.view),
    modelCallRefs: modelCallRefsFor(input.entry, payload),
    toolCallRefs: toolCallRefsFor(input.entry, payload),
  };

  if (input.entry.type === "model.requested") {
    const summary = modelRequestedSummary(payload);
    if (summary === undefined || summary.trim().length === 0) {
      return;
    }
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.delta`,
      type: "agent.note.delta",
      agentLabel: "助手",
      summary,
      status: "running",
    });
    return;
  }

  if (input.entry.type === "model.completed") {
    const reasoningOutput = safeReasoningOutputForPanel(payload.reasoningOutput);
    const reasoningChunks = chunkText(reasoningOutput?.content ?? "", 360);
    reasoningChunks.forEach((chunk, index) => {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:model.reasoning.delta:${index + 1}`,
        type: "model.reasoning.delta",
        agentLabel: "助手",
        delta: chunk,
        status: "running",
        detail: {
          kind: "thinking",
          preview: chunk,
          truncated: index === reasoningChunks.length - 1 ? reasoningOutput?.truncated === true : false,
        },
      });
    });
    if (reasoningChunks.length > 0) {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:model.reasoning.completed`,
        type: "model.reasoning.completed",
        agentLabel: "助手",
        status: "completed",
        detail: {
          kind: "thinking",
          preview: reasoningChunks.at(-1),
          truncated: reasoningOutput?.truncated === true,
        },
      });
    }
    if (stringOrUndefined(payload.finishReason) === "tool_call") {
      const sideText = visibleOutputText(payload.visibleOutput);
      if (sideText.trim().length > 0) {
        input.push({
          ...base,
          eventId: `${input.runId}:event:${input.entry.sequence}:model.side.completed`,
          type: "model.side.completed",
          agentLabel: "助手",
          summary: visibleOutputSummary(sideText, 220),
          status: "completed",
          detail: {
            kind: "thinking",
            preview: sideText,
            truncated: false,
          },
        });
      }
      return;
    }
    const text = visibleOutputText(payload.visibleOutput);
    const chunks = chunkText(text, 90);
    if (chunks.length === 0) {
      return;
    }
    chunks.forEach((chunk, index) => {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:model.output.delta:${index + 1}`,
        type: "model.output.delta",
        agentLabel: "助手",
        delta: chunk,
        status: "running",
      });
    });
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:model.output.completed`,
      type: "model.output.completed",
      agentLabel: "助手",
      summary: modelCompletedSummary(payload),
      status: "completed",
    });
    return;
  }

  if (input.entry.type === "model.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.completed`,
      type: "agent.note.completed",
      agentLabel: "助手",
      summary: modelFailedSummary(payload),
      status: "failed",
      detail: modelFailureStreamDetail(payload),
    });
    return;
  }

  if (input.entry.type === "tool.requested" || input.entry.type === "tool.completed" || input.entry.type === "tool.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: "工具",
      toolName: stringOrUndefined(payload.toolName),
      summary: toolSummary(input.entry.type, payload),
      status: input.entry.type === "tool.requested" ? "running" : input.entry.type === "tool.completed" ? "completed" : "failed",
      detail: toolStreamDetail(input.entry.type, payload),
    });
    return;
  }

  if (input.entry.type === "context.compaction.completed" || input.entry.type === "context.compaction.failed") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: "上下文",
      summary: contextCompactionStreamSummary(input.entry.type, payload),
      status: input.entry.type === "context.compaction.completed" ? "completed" : "failed",
      detail: {
        kind: "thinking",
        action: input.entry.type === "context.compaction.completed" ? "整理上下文" : "上下文整理失败",
        preview: contextCompactionPreview(payload),
        truncated: false,
      },
    });
    return;
  }

  if (input.entry.type === "user_approval.requested") {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:confirmation.needed`,
      type: "confirmation.needed",
      agentLabel: "待处理",
      summary: confirmationSummary(payload),
      status: "running",
    });
    return;
  }

  if (input.entry.type === "user_approval.received") {
    const decisionKind = userApprovalReceivedKind(payload);
    if (decisionKind === "approved") {
      return;
    }
    if (decisionKind === "denied") {
      input.push({
        ...base,
        eventId: `${input.runId}:event:${input.entry.sequence}:user_approval.received`,
        type: "user_approval.received",
        agentLabel: "用户",
        summary: deniedUserApprovalSummary(payload),
        status: "blocked",
      });
      return;
    }
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:user.guidance`,
      type: "user.guidance",
      agentLabel: "补充要求",
      summary: userGuidanceSummary(payload),
      status: "completed",
    });
    return;
  }

  if (isAgentFabricStreamType(input.entry.type)) {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:${input.entry.type}`,
      type: input.entry.type,
      agentLabel: agentFabricLabel(input.entry.type),
      summary: agentFabricSummary(input.entry.type, payload),
      status: input.entry.type === "agent.child.started" || input.entry.type === "agent.child.waiting" ? "running" : "completed",
    });
    return;
  }

  const note = agentNoteForEvent(input.entry, payload);
  if (note !== undefined) {
    input.push({
      ...base,
      eventId: `${input.runId}:event:${input.entry.sequence}:agent.note.completed`,
      type: "agent.note.completed",
      agentLabel: note.agentLabel,
      summary: note.summary,
      status: note.status,
    });
  }
}

type UserApprovalReceivedKind = "approved" | "denied" | "guidance";

function userApprovalReceivedKind(payload: Readonly<Record<string, unknown>>): UserApprovalReceivedKind {
  const decision = normalizedDecisionText(
    stringOrUndefined(payload.decision) ??
      stringOrUndefined(payload.status) ??
      stringOrUndefined(payload.action)
  );
  if (
    decision === "deny" ||
    decision === "denied" ||
    decision === "reject" ||
    decision === "rejected" ||
    decision === "refuse" ||
    decision === "refused" ||
    decision === "拒绝" ||
    decision === "不执行" ||
    decision === "取消"
  ) {
    return "denied";
  }
  if (
    decision === "guidance" ||
    decision === "needsinput" ||
    decision === "补充" ||
    decision === "补充要求"
  ) {
    return "guidance";
  }
  if (
    decision === "approveonce" ||
    decision === "approve" ||
    decision === "approved" ||
    decision === "continue" ||
    decision === "ok" ||
    decision === "批准" ||
    decision === "同意" ||
    decision === "继续" ||
    decision === "已批准"
  ) {
    return "approved";
  }
  return stringOrUndefined(payload.note) !== undefined || stringOrUndefined(payload.guidance) !== undefined
    ? "guidance"
    : "approved";
}

function deniedUserApprovalSummary(payload: Readonly<Record<string, unknown>>): string {
  const note = stringOrUndefined(payload.note) ?? stringOrUndefined(payload.guidance);
  return note === undefined ? "已不执行。" : `已不执行：${note}`;
}

function normalizedDecisionText(value: string | undefined): string {
  return value?.replace(/[\s_ -]/g, "").trim().toLowerCase() ?? "";
}

function isAgentFabricStreamType(type: ArborMessageType): type is Extract<
  PanelRunStreamEventType,
  "agent.delegation.planned" | "agent.child.started" | "agent.child.completed" | "agent.child.waiting" | "agent.parent_synthesis.completed"
> {
  return (
    type === "agent.delegation.planned" ||
    type === "agent.child.started" ||
    type === "agent.child.completed" ||
    type === "agent.child.waiting" ||
    type === "agent.parent_synthesis.completed"
  );
}

function sourceRefsForView(view: RunObservationEventView | undefined): readonly string[] {
  return (
    view?.refs
      .filter((ref) => ref.kind !== "model_call" && ref.kind !== "tool_call")
      .map((ref) => `${ref.kind}:${ref.id}`) ?? []
  );
}

function modelCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (
    entry.type !== "model.requested" &&
    entry.type !== "model.completed" &&
    entry.type !== "model.failed" &&
    entry.type !== "context.compaction.completed" &&
    entry.type !== "context.compaction.failed"
  ) {
    return [];
  }
  return unique([stringOrUndefined(payload.requestId), stringOrUndefined(payload.responseId)].filter(isString));
}

function toolCallRefsFor(entry: EventLogEntry, payload: Readonly<Record<string, unknown>>): readonly string[] {
  if (
    entry.type !== "tool.requested" &&
    entry.type !== "tool.completed" &&
    entry.type !== "tool.failed" &&
    entry.type !== "user_approval.requested"
  ) {
    return [];
  }
  return stringOrUndefined(payload.callId) === undefined ? [] : [stringOrUndefined(payload.callId) as string];
}
