import type {
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type {
  RuntimeConfirmationRecord,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeToolCallRecord,
} from "../../domain/runtime-database/index.js";
import {
  createPanelRunTracking,
  createPanelTranscriptNodes,
  type PanelRunStatus,
  type PanelRunStreamEvent,
  type PanelRunStreamCursor,
  type PanelRunTraceReadModel,
  type PanelRunTrackingReadModel,
  type PanelRunTranscript,
} from "../panel-run-read-model.js";
import { restoredModelRequestedSummary } from "../panel-model-progress-copy.js";
import { friendlyUserFacingFailureText } from "../visible-text-safety.js";
import { compactRuntimeText } from "./runtime-records.js";
import type { PanelConversationReadModel } from "../panel-conversations.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";
import { cleanConfirmationSummary } from "../confirmation-copy.js";

export type PanelPersistedRunResponse = {
  readonly ok: true;
  readonly runId: string;
  readonly runKind: RuntimeRunRecord["runKind"];
  readonly runMode: RuntimeRunRecord["runMode"];
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
  readonly error?: RuntimeRunRecord["error"];
  readonly conversation?: PanelConversationReadModel;
  readonly restoredFromSnapshot: true;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly snapshot: {
    readonly run: RuntimeRunSnapshot["run"];
    readonly workspace?: RuntimeRunSnapshot["workspace"];
    readonly toolCalls: RuntimeRunSnapshot["toolCalls"];
    readonly artifacts: RuntimeRunSnapshot["artifacts"];
    readonly confirmations: RuntimeRunSnapshot["confirmations"];
  };
};

export function createPersistedPanelRunResponse(input: {
  readonly snapshot: RuntimeRunSnapshot;
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly conversation?: PanelConversationReadModel;
}): PanelPersistedRunResponse {
  const status = panelStatusFromRuntimeStatus(input.snapshot.run.status);
  const trace = createPersistedRunTrace(input.snapshot, status);
  const config = input.snapshot.run.capabilitySnapshot?.activeModel ?? input.config;
  const informationAccess = input.snapshot.run.informationAccess ?? input.informationAccess;
  const trackingBase = createPanelRunTracking({
    status,
    runMode: input.snapshot.run.runMode,
    config,
    informationAccess,
    requestedMode: input.snapshot.run.aiMode,
    eventEntries: [],
  });
  const streamEvents = createPersistedStreamEvents(input.snapshot, status);
  const transcriptNodes = createPanelTranscriptNodes(streamEvents);
  return {
    ok: true,
    runId: input.snapshot.run.runId,
    runKind: input.snapshot.run.runKind,
    runMode: input.snapshot.run.runMode,
    status,
    agentDefinitionRef: input.snapshot.run.agentDefinitionRef,
    capabilityResolution: input.snapshot.run.capabilityResolution,
    config,
    informationAccess,
    trace,
    tracking: {
      ...trackingBase,
      run: {
        ...trackingBase.run,
        status,
        phase: trace.currentPhase,
        stage: trace.currentStage,
        eventCount: trace.eventCursor.eventCount,
        lastEventType: trace.eventCursor.lastEventType,
        waitingPoint: trace.waitingPoint,
      },
      modelTotals: countPersistedModelCalls(input.snapshot.modelCalls),
      toolTotals: countPersistedToolCalls(input.snapshot.toolCalls),
    },
    transcript: {
      runId: input.snapshot.run.runId,
      status,
      updatedAt: input.snapshot.run.updatedAt,
      events: streamEvents,
      transcriptNodes,
      steps: [],
      workNotes: [],
      modelCalls: input.snapshot.modelCalls.map((call) => ({
        requestId: call.requestId,
        responseId: call.responseId,
        status: call.status,
        purpose: call.purpose,
        outputContractId: call.outputContractId,
        providerKind: call.providerKind,
        protocolKind: call.protocolKind,
        model: call.model,
        outputKind: call.outputKind,
        validationStatus: call.validationStatus,
        failureKind: call.failureKind,
        retryable: call.retryable,
        candidateRefs: [],
        eventRefs: [...call.eventRefs],
      })),
    },
    transcriptNodes,
    workNotes: [],
    steps: [],
    streamCursor: {
      runId: input.snapshot.run.runId,
      lastSequence: streamEvents.at(-1)?.sequence ?? 0,
    },
    error: input.snapshot.run.error,
    conversation: input.conversation,
    restoredFromSnapshot: true,
    restoredResult:
      input.snapshot.run.resultTitle === undefined && input.snapshot.run.resultSummary === undefined
        ? undefined
        : {
            title: input.snapshot.run.resultTitle ?? "上次结果",
            summary: input.snapshot.run.resultSummary ?? input.snapshot.run.resultTitle ?? "上次结果",
          },
    snapshot: {
      run: input.snapshot.run,
      workspace: input.snapshot.workspace,
      toolCalls: input.snapshot.toolCalls,
      artifacts: input.snapshot.artifacts,
      confirmations: input.snapshot.confirmations,
    },
  };
}

export function createPersistedRunTrace(
  snapshot: RuntimeRunSnapshot,
  status: PanelRunStatus
): PanelRunTraceReadModel {
  const events = snapshot.events.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    summary: event.summary,
    scope: event.scope,
    severity: event.severity,
    progress: event.progress,
    refs: event.refs,
    traceId: event.traceId,
    taskId: event.taskId,
    intent: event.intent,
    from: { id: "runtime-database", role: "runtime" },
    createdAt: event.createdAt,
    recordedAt: event.recordedAt,
  }));
  const lastEvent = lastPersistedTraceEvent(snapshot);
  return {
    status,
    currentPhase: persistedPhaseFor(lastEvent?.type, status, snapshot.run.runMode),
    currentStage: persistedStageFor(lastEvent?.type, status, snapshot.run.runMode),
    eventCursor: {
      eventCount: events.length,
      lastSequence: snapshot.events.at(-1)?.sequence ?? 0,
      lastEventType: snapshot.events.at(-1)?.type,
    },
    waitingPoint: persistedWaitingPoint(status, snapshot.run.runMode),
    events,
  };
}

function lastPersistedTraceEvent(snapshot: RuntimeRunSnapshot): RuntimeEventRecord | undefined {
  if (snapshot.run.runMode !== "agent") {
    return snapshot.events.at(-1);
  }
  return [...snapshot.events].reverse().find((event) => event.type === "goal.received" || isPersistedOrdinaryAgentRuntimeEvent(event.type));
}

export function createPersistedStreamEvents(
  snapshot: RuntimeRunSnapshot,
  status: PanelRunStatus
): readonly PanelRunStreamEvent[] {
  const agentLabel = persistedRunAgentLabel(snapshot);
  const suppressOrdinaryChatProgress =
    snapshot.run.runMode === "agent" && !hasPersistedUserVisibleWorkActivity(snapshot.events);
  const events: PanelRunStreamEvent[] = [];
  if (snapshot.run.runMode !== "agent") {
    const startedStatus: NonNullable<PanelRunStreamEvent["status"]> =
      status === "pending"
        ? "pending"
        : status === "completed" || status === "running"
          ? "running"
          : status;
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.started`,
      runId: snapshot.run.runId,
      sequence: 1,
      type: "run.started",
      createdAt: snapshot.run.createdAt,
      agentLabel,
      summary: "已从本地记录恢复这次运行。",
      status: startedStatus,
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }
  for (const record of snapshot.events) {
    if (snapshot.run.runMode === "agent" && record.type === "goal.received") {
      continue;
    }
    if (suppressOrdinaryChatProgress && shouldSuppressPersistedOrdinaryChatEvent(record.type)) {
      continue;
    }
    const streamType = streamTypeForRuntimeEvent(record.type, snapshot.run.runMode);
    if (streamType === undefined) {
      continue;
    }
    const restoredProgressSummary = record.type === "model.requested"
      ? restoredModelRequestedSummary(record.summary)
      : undefined;
    if (streamType === "agent.note.delta" && record.type === "model.requested" && restoredProgressSummary === undefined) {
      continue;
    }
    const toolCall = toolCallForPersistedEvent(record, snapshot.toolCalls);
    events.push({
      eventId: `${snapshot.run.runId}:restored:event:${record.sequence}:${streamType}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: streamType,
      createdAt: record.recordedAt,
      agentLabel: persistedStreamAgentLabel(streamType),
      summary: restoredProgressSummary ?? persistedStreamSummary(record),
      status: streamStatusFor(streamType),
      toolName: toolCall?.toolName,
      detail: toolCall === undefined ? undefined : persistedToolStreamDetail(toolCall),
      sourceRefs: record.refs
        .filter((ref) => ref.kind !== "model_call" && ref.kind !== "tool_call")
        .map((ref) => `${ref.kind}:${ref.id}`),
      modelCallRefs: record.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id),
      toolCallRefs: record.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id),
    });
  }
  for (const confirmation of snapshot.confirmations) {
    if (confirmation.decidedAt === undefined && confirmation.status === "pending") {
      events.push({
        eventId: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:pending`,
        runId: snapshot.run.runId,
        sequence: events.length + 1,
        type: "confirmation.needed",
        createdAt: confirmation.requestedAt,
        agentLabel: "待处理",
        summary: cleanConfirmationSummary(confirmation.actionSummary),
        status: "pending",
        sourceRefs: [`confirmation:${confirmation.confirmationId}`],
        modelCallRefs: [],
        toolCallRefs: [],
      });
      continue;
    }
    if (confirmation.decidedAt === undefined) {
      continue;
    }
    const type: PanelRunStreamEvent["type"] =
      confirmation.status === "approved"
        ? "run.resumed"
        : confirmation.status === "denied"
          ? "user_approval.received"
          : "user.guidance";
    events.push({
      eventId: `${snapshot.run.runId}:restored:confirmation:${confirmation.confirmationId}:${confirmation.status}`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type,
      createdAt: confirmation.decidedAt,
      agentLabel: type === "run.resumed" ? agentLabel : type === "user_approval.received" ? "继续处理" : "补充要求",
      summary: restoredConfirmationDecisionSummary(confirmation),
      status: confirmation.status === "denied" ? "blocked" : confirmation.status === "guidance" ? "pending" : "completed",
      sourceRefs: [`confirmation:${confirmation.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }
  const completedSummary = restoredCompletedSummary(snapshot);
  if (status === "completed" && completedSummary !== undefined) {
    events.push({
      eventId: `${snapshot.run.runId}:restored:final.result`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "final.result",
      createdAt: snapshot.run.updatedAt,
      agentLabel,
      summary: completedSummary,
      status: "completed",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "failed") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.failed`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.failed",
      createdAt: snapshot.run.updatedAt,
      agentLabel,
      summary: friendlyUserFacingFailureText(snapshot.run.error?.message ?? snapshot.run.resultSummary),
      status: "failed",
      detail: snapshot.run.error === undefined
        ? undefined
        : {
            kind: "thinking",
            action: "未完成",
            error: friendlyUserFacingFailureText(snapshot.run.error.message),
            truncated: false,
          },
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "cancelled") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.cancelled`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.cancelled",
      createdAt: snapshot.run.updatedAt,
      agentLabel,
      summary: snapshot.run.resultSummary ?? "已取消。",
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  if (status === "blocked") {
    events.push({
      eventId: `${snapshot.run.runId}:restored:run.blocked`,
      runId: snapshot.run.runId,
      sequence: events.length + 1,
      type: "run.blocked",
      createdAt: snapshot.run.updatedAt,
      agentLabel,
      summary: snapshot.run.resultSummary ?? snapshot.run.error?.message ?? "无法继续原操作。请重新发起或继续处理。",
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: snapshot.toolCalls.map((call) => call.callId),
    });
  }
  return events;
}

function persistedRunAgentLabel(snapshot: RuntimeRunSnapshot): string {
  const label = snapshot.run.agentDefinitionRef?.agentDisplayName.trim();
  return label === undefined || label.length === 0 ? "AgentArbor" : label;
}

function restoredCompletedSummary(snapshot: RuntimeRunSnapshot): string | undefined {
  if (snapshot.run.resultSummary !== undefined) {
    return snapshot.run.resultSummary;
  }
  return snapshot.run.runMode === "agent" ? undefined : "结果已经整理完成。";
}

export function panelStatusFromRuntimeStatus(status: RuntimeRunRecord["status"]): PanelRunStatus {
  if (
    status === "pending" ||
    status === "approval_needed" ||
    status === "needs_input" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  ) {
    return status;
  }
  if (status === "running") {
    return "blocked";
  }
  return "failed";
}

function restoredConfirmationDecisionSummary(confirmation: RuntimeConfirmationRecord): string {
  if (confirmation.status === "approved") {
    return "已继续。";
  }
  if (confirmation.status === "denied") {
    return "已不执行。";
  }
  return confirmation.guidance === undefined || confirmation.guidance.trim().length === 0
    ? "已补充要求。"
    : compactRuntimeText(confirmation.guidance, 240);
}

function hasPersistedUserVisibleWorkActivity(events: readonly RuntimeEventRecord[]): boolean {
  return events.some((event) => {
    if (event.type === "tool.requested" || event.type === "tool.completed" || event.type === "tool.failed") {
      return true;
    }
    if (event.type === "user_approval.requested" || event.type === "user_approval.received") {
      return true;
    }
    return false;
  });
}

function shouldSuppressPersistedOrdinaryChatEvent(type: RuntimeEventRecord["type"]): boolean {
  return type === "goal.received" || type === "model.requested" || type === "model.completed";
}

function persistedStreamAgentLabel(type: PanelRunStreamEvent["type"]): string {
  if (type.startsWith("tool.")) {
    return "工具";
  }
  if (type === "confirmation.needed") {
    return "待处理";
  }
  if (type === "user_approval.received") {
    return "继续处理";
  }
  if (type === "user.guidance") {
    return "补充要求";
  }
  if (
    type === "agent.note.delta" ||
    type === "agent.note.completed" ||
    type === "model.output.delta" ||
    type === "model.output.completed" ||
    type === "model.reasoning.delta" ||
    type === "model.reasoning.completed"
  ) {
    return "助手";
  }
  return "AgentArbor";
}

function persistedStreamSummary(record: RuntimeEventRecord): string {
  if (record.type === "tool.requested" || record.type === "tool.completed" || record.type === "tool.failed") {
    return cleanOrdinaryToolText(record.summary) ?? record.summary;
  }
  return record.summary;
}

function persistedPhaseFor(
  type: RuntimeEventRecord["type"] | undefined,
  status: PanelRunStatus,
  runMode: RuntimeRunRecord["runMode"]
): PanelRunTraceReadModel["currentPhase"] {
  if (type === undefined) {
    return status === "completed" ? "completed" : status === "blocked" || status === "cancelled" || status === "failed" ? "verification" : "not_started";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked" || status === "cancelled" || status === "failed") {
    return "verification";
  }
  if (runMode === "agent") {
    return type === "goal.received" ? "not_started" : "agent";
  }
  if (type.startsWith("direction_handoff.")) {
    return "handoff";
  }
  if (
    type.startsWith("artifact.") ||
    type.startsWith("task.") ||
    type.startsWith("workflow.") ||
    type.startsWith("growth_plan.")
  ) {
    return "aboveground";
  }
  if (type.startsWith("verification.") || type.startsWith("acceptance.")) {
    return "verification";
  }
  if (type.startsWith("fruit.") || type.startsWith("run_memory.") || type.startsWith("experience_candidate.") || type.startsWith("path_bias.")) {
    return "fruits";
  }
  if (type.startsWith("governance.")) {
    return "governance";
  }
  return type === "goal.received" ? "not_started" : "underground";
}

function isPersistedOrdinaryAgentRuntimeEvent(type: RuntimeEventRecord["type"]): boolean {
  return type === "model.requested" ||
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

function persistedStageFor(
  type: RuntimeEventRecord["type"] | undefined,
  status: PanelRunStatus,
  runMode: RuntimeRunRecord["runMode"]
): PanelRunTraceReadModel["currentStage"] {
  if (type === undefined) {
    return status === "running" ? "running" : "not_started";
  }
  if (runMode === "agent" && !isPersistedOrdinaryAgentRuntimeEvent(type)) {
    return status === "running" ? "running" : "not_started";
  }
  const normalized = type.replaceAll(".", "_");
  if (isPersistedRunStage(normalized)) {
    return normalized;
  }
  return status === "running" ? "running" : "not_started";
}

function isPersistedRunStage(value: string): value is PanelRunTraceReadModel["currentStage"] {
  return [
    "not_started",
    "goal_received",
    "model_requested",
    "model_completed",
    "model_failed",
    "tool_requested",
    "tool_completed",
    "tool_failed",
    "agent_delegation_planned",
    "agent_child_started",
    "agent_child_completed",
    "agent_child_interrupted",
    "agent_child_resumed",
    "agent_child_waiting",
    "agent_parent_synthesis_completed",
    "direction_handoff_completed",
    "user_approval_requested",
    "user_approval_received",
    "artifact_produced",
    "task_completed",
    "task_failed",
    "path_bias_suggested",
    "running",
  ].includes(value);
}

function persistedWaitingPoint(
  status: PanelRunStatus,
  runMode: RuntimeRunRecord["runMode"]
): string {
  if (runMode === "agent") {
    return "";
  }
  if (status === "pending") {
    return "等待开始。";
  }
  if (status === "approval_needed") {
    return "等待你判断下一步。";
  }
  if (status === "needs_input") {
    return "需要你补充材料后继续。";
  }
  if (status === "running") {
    return "记录显示仍在进行；如这是重启后的历史记录，需要重新发起后续任务。";
  }
  if (status === "cancelled") {
    return "已取消。";
  }
  if (status === "blocked") {
    return "无法继续原操作。请重新发起或继续处理。";
  }
  if (status === "failed") {
    return "未完成，请查看错误信息。";
  }
  return "已完成。";
}

function streamTypeForRuntimeEvent(
  type: RuntimeEventRecord["type"],
  runMode: RuntimeRunRecord["runMode"]
): PanelRunStreamEvent["type"] | undefined {
  if (runMode === "agent" && !isPersistedOrdinaryAgentRuntimeEvent(type)) {
    return undefined;
  }
  if (type === "model.requested") {
    return "agent.note.delta";
  }
  if (type === "model.completed") {
    return "model.output.completed";
  }
  if (type === "model.failed") {
    return "agent.note.completed";
  }
  if (type === "context.compaction.completed" || type === "context.compaction.failed") {
    return type;
  }
  if (type === "tool.requested" || type === "tool.completed" || type === "tool.failed") {
    return type;
  }
  if (
    type === "agent.delegation.planned" ||
    type === "agent.child.started" ||
    type === "agent.child.completed" ||
    type === "agent.child.waiting" ||
    type === "agent.parent_synthesis.completed"
  ) {
    return type;
  }
  if (type === "user_approval.requested") {
    return "confirmation.needed";
  }
  if (type === "user_approval.received") {
    return "user.guidance";
  }
  return "agent.note.completed";
}

function streamStatusFor(type: PanelRunStreamEvent["type"]): NonNullable<PanelRunStreamEvent["status"]> {
  if (type === "tool.requested" || type === "agent.note.delta" || type === "agent.child.started" || type === "agent.child.waiting") {
    return "running";
  }
  if (type === "confirmation.needed") {
    return "pending";
  }
  if (type === "user_approval.received") {
    return "completed";
  }
  if (type === "run.cancelled") {
    return "cancelled";
  }
  if (type === "run.blocked") {
    return "blocked";
  }
  if (type === "tool.failed" || type === "run.failed" || type === "context.compaction.failed") {
    return "failed";
  }
  return "completed";
}

function toolCallForPersistedEvent(
  event: RuntimeEventRecord,
  toolCalls: readonly RuntimeToolCallRecord[]
): RuntimeToolCallRecord | undefined {
  const toolRef = event.refs.find((ref) => ref.kind === "tool_call");
  return toolRef === undefined ? undefined : toolCalls.find((call) => call.callId === toolRef.id);
}

function persistedToolStreamDetail(call: RuntimeToolCallRecord): PanelRunStreamEvent["detail"] {
  return {
    kind: "tool",
    action: call.action ?? call.toolName,
    path: call.path,
    query: call.query,
    command: call.command,
    exitCode: call.exitCode,
    preview: call.error ?? cleanOrdinaryToolText(call.preview) ?? cleanOrdinaryToolText(call.summary),
    display: call.display,
    truncated: call.truncated,
    error: call.error,
  };
}

function countPersistedModelCalls(
  calls: readonly RuntimeModelCallRecord[]
): PanelRunTrackingReadModel["modelTotals"] {
  return {
    requested: calls.length,
    completed: calls.filter((call) => call.status === "completed").length,
    failed: calls.filter((call) => call.status === "failed").length,
  };
}

function countPersistedToolCalls(
  calls: readonly RuntimeToolCallRecord[]
): PanelRunTrackingReadModel["toolTotals"] {
  return {
    requested: calls.length,
    completed: calls.filter((call) => call.status === "completed").length,
    failed: calls.filter((call) => call.status === "failed").length,
  };
}
