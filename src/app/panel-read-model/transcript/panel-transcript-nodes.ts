import type { TranscriptNode, TranscriptNodePhase } from "../../../domain/basic-agent/index.js";
import type { ModelUsage } from "../../../domain/intelligence/index.js";
import type { ObservationRef } from "../../../domain/observation/index.js";
import { type ToolDisplayProjection, type ToolErrorDomain, type ToolErrorFacts, type ToolResultEnvelope } from "../../../domain/tools/index.js";
import { toolDisplayName } from "../../../domain/tools/index.js";
import { cleanConfirmationSummary } from "../../text-projection/confirmation-copy.js";
import {
  completeOpenReasoningNodes,
  flushPendingReasoningNode,
  isReasoningTranscriptEvent,
  settlePendingReasoningNode,
  updatePendingReasoningNode,
  type PendingReasoningNode,
  type ReasoningTranscriptEvent,
} from "./transcript-reasoning.js";
import {
  appendTextStreamAssembly,
  emptyTextStreamAssembly,
  textStreamFragmentSourceFromEventId,
  type TextStreamAssembly,
} from "./readable-text-fragments.js";
import { cleanOrdinaryToolText } from "../../ordinary-tool-copy.js";
import { commandSummaryParts } from "./panel-transcript-tool-format.js";
import {
  isLowValueOrdinaryAgentNote,
  isOrdinaryTranscriptReasoningSettlementEvent,
  isOrdinaryTranscriptSuppressedEvent,
} from "./ordinary-transcript-event-policy.js";

export type PanelTranscriptStreamEvent = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status?: string;
  readonly toolName?: string;
  readonly detail?: {
    readonly kind?: string;
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly display?: ToolDisplayProjection;
    readonly envelope?: ToolResultEnvelope;
    readonly preview?: string;
    readonly truncated?: boolean;
    readonly error?: string;
    readonly errorDomain?: ToolErrorDomain;
    readonly errorFacts?: ToolErrorFacts;
    readonly modelUsage?: ModelUsage;
    readonly subAgentRunId?: string;
    readonly subAgentBatchId?: string;
    readonly subAgentName?: string;
    readonly subAgentStatus?: string;
    readonly subAgentTask?: string;
    readonly subAgentModelRounds?: number;
    readonly subAgentToolCalls?: number;
    readonly subAgentDurationMs?: number;
    readonly subAgentTotalCount?: number;
    readonly subAgentSuccessCount?: number;
    readonly subAgentFailedCount?: number;
    readonly subAgentCancelledCount?: number;
    readonly subAgentApprovalRequiredCount?: number;
    readonly subAgentNotStartedCount?: number;
  };
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export type PanelTranscriptNodeOptions = {
  readonly confirmationMode?: "all" | "current";
  readonly pendingConfirmation?: TranscriptNode["confirmation"];
};

export function createPanelTranscriptNodes(
  streamEvents: readonly PanelTranscriptStreamEvent[],
  options: PanelTranscriptNodeOptions = {}
): readonly TranscriptNode[] {
  const confirmationToolRefs = new Set(
    streamEvents
      .filter((event) => event.type === "confirmation.needed")
      .flatMap((event) => event.toolCallRefs)
  );
  const confirmationRequestSequences = requestSequencesBeforeConfirmations(streamEvents);
  const requestedByCallId = new Map<string, number>();
  const nodes: TranscriptNode[] = [];
  let pendingReasoning: PendingReasoningNode | undefined;
  let pendingBodyByModelCallId = new Map<string, PendingBodyNode>();

  for (const event of streamEvents) {
    const reasoningEvent = reasoningEventFromPanelEvent(event);
    if (isReasoningTranscriptEvent(reasoningEvent)) {
      pendingReasoning = updatePendingReasoningNode(pendingReasoning, reasoningEvent, nodes, compactReasoningSummary, reasoningNodeFromPending);
      continue;
    }
    pendingBodyByModelCallId = handlePendingBodyBeforeEvent(pendingBodyByModelCallId, event, nodes);
    pendingBodyByModelCallId = handleBodyEvent(pendingBodyByModelCallId, event, nodes);
    const settlesReasoning = isOrdinaryTranscriptReasoningSettlementEvent(event.type);
    if (settlesReasoning) {
      pendingReasoning = settlePendingReasoningNode(pendingReasoning, reasoningEvent);
      pendingReasoning = flushPendingReasoningNode(pendingReasoning, nodes, compactReasoningSummary, reasoningNodeFromPending);
      completeOpenReasoningNodes(nodes, reasoningEvent, compactReasoningSummary);
    }
    const node = transcriptNodeForEvent(event, {
      confirmationToolRefs,
      confirmationRequestSequences,
      requestedByCallId,
      confirmationMode: options.confirmationMode ?? "all",
      pendingConfirmation: options.pendingConfirmation,
    });
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  flushPendingBodies(pendingBodyByModelCallId, nodes, true);
  flushPendingReasoningNode(pendingReasoning, nodes, compactReasoningSummary, reasoningNodeFromPending);

  return nodes;
}

function transcriptNodeForEvent(
  event: PanelTranscriptStreamEvent,
  context: {
    readonly confirmationToolRefs: ReadonlySet<string>;
    readonly confirmationRequestSequences: ReadonlySet<number>;
    readonly requestedByCallId: Map<string, number>;
    readonly confirmationMode: "all" | "current";
    readonly pendingConfirmation?: TranscriptNode["confirmation"];
  }
): TranscriptNode | undefined {
  if (event.type === "model.output.delta" || event.type === "model.output.completed") {
    return undefined;
  }
  if (isOrdinaryTranscriptSuppressedEvent({ type: event.type })) {
    return undefined;
  }
  if (event.type === "model.output.side") {
    return undefined;
  }
  if (event.type === "model.side.completed") {
    if (event.summary === undefined || event.summary.trim().length === 0) {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "system",
      phase: "completed",
      title: "",
      summary: event.summary,
      text: event.detail?.preview ?? event.summary,
    });
  }
  if ((event.type === "agent.note.delta" || event.type === "agent.note.completed") && isLowValueOrdinaryAgentNote(event.summary)) {
    return undefined;
  }
  if (event.type === "model.failed") {
    return transcriptNode(event, {
      kind: "system",
      phase: "failed",
      title: "模型回复失败",
      summary: event.summary,
    });
  }
  if (event.type === "agent.note.delta" || event.type === "agent.note.completed") {
    if (event.summary === undefined || event.summary.trim().length === 0) {
      return undefined;
    }
    const failedDiagnostic = event.status === "failed" || event.detail?.error !== undefined;
    return transcriptNode(event, {
      kind: failedDiagnostic ? "system" : "thinking",
      phase: failedDiagnostic ? "failed" : event.type === "agent.note.delta" ? "noted" : "completed",
      title: failedDiagnostic ? event.agentLabel ?? "运行诊断" : "",
      summary: event.summary,
    });
  }
  if (event.type === "tool.requested") {
    const callId = event.toolCallRefs[0];
    const previousCount = callId === undefined ? 0 : context.requestedByCallId.get(callId) ?? 0;
    if (callId !== undefined) {
      context.requestedByCallId.set(callId, previousCount + 1);
    }
    const phase: TranscriptNodePhase =
      ((callId !== undefined && context.confirmationToolRefs.has(callId) && previousCount === 0) ||
        context.confirmationRequestSequences.has(event.sequence))
        ? "preparing"
        : "executing";
    return transcriptNode(event, {
      kind: "tool",
      phase,
      title: toolTranscriptTitle(event, phase),
      summary: transcriptToolSummary(event),
      display: event.detail?.display,
    });
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    const phase: TranscriptNodePhase = event.type === "tool.completed" ? "completed" : "failed";
    return transcriptNode(event, {
      kind: "tool",
      phase,
      title: toolTranscriptTitle(event, phase),
      summary: transcriptToolSummary(event),
      display: event.detail?.display,
    });
  }
  if (
    event.type === "sub_agent.started" ||
    event.type === "sub_agent.completed" ||
    event.type === "sub_agent_batch.started" ||
    event.type === "sub_agent_batch.completed"
  ) {
    return transcriptNode(event, {
      kind: "sub_agent",
      phase: subAgentTranscriptPhase(event),
      title: event.agentLabel ?? "子 Agent",
      summary: event.summary,
      subAgentRunId: event.detail?.subAgentRunId,
      subAgentBatchId: event.detail?.subAgentBatchId,
      subAgentName: event.detail?.subAgentName,
      subAgentTask: event.detail?.subAgentTask,
      subAgentTotalCount: event.detail?.subAgentTotalCount,
      subAgentSuccessCount: event.detail?.subAgentSuccessCount,
      subAgentFailedCount: event.detail?.subAgentFailedCount,
      subAgentCancelledCount: event.detail?.subAgentCancelledCount,
      subAgentApprovalRequiredCount: event.detail?.subAgentApprovalRequiredCount,
      subAgentNotStartedCount: event.detail?.subAgentNotStartedCount,
    });
  }
  if (event.type === "confirmation.needed") {
    const pendingConfirmation = pendingConfirmationForPanelEvent(event, context.pendingConfirmation);
    if (context.confirmationMode === "current" && pendingConfirmation === undefined) {
      return undefined;
    }
    const summary = userFacingConfirmationSummary(event.summary);
    return transcriptNode(event, {
      kind: "confirmation",
      phase: "waiting_approval",
      title: "待处理",
      summary,
      confirmation: pendingConfirmation ?? {
        confirmationId: confirmationIdForTranscriptEvent(event),
        runId: event.runId,
        title: "需要你判断",
        actionSummary: summary,
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: event.createdAt,
        sourceRefs: event.sourceRefs,
      },
    });
  }
  if (event.type === "user_approval.received" || event.type === "user.guidance") {
    const phase = userDecisionPhase(event);
    if (phase === "approved") {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "user_decision",
      phase,
      title: userDecisionTitle(phase),
      summary: event.summary,
    });
  }
  if (event.type === "run.resumed") {
    return undefined;
  }
  if (event.type === "final.result") {
    return transcriptNode(event, {
      kind: "answer",
      phase: "completed",
      title: "结果",
      summary: event.summary,
      modelUsage: event.detail?.modelUsage,
    });
  }
  if (event.type === "run.failed" || event.type === "run.blocked" || event.type === "run.cancelled") {
    return transcriptNode(event, {
      kind: "system",
      phase: event.type === "run.failed" ? "failed" : event.type === "run.cancelled" ? "cancelled" : "blocked",
      title: event.type === "run.failed" ? "运行未完成" : event.type === "run.cancelled" ? "运行已取消" : "运行中断",
      summary: event.summary,
    });
  }
  if (
    event.type === "context.compaction.requested" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed"
  ) {
    const phase = event.type === "context.compaction.requested"
      ? "executing"
      : event.type === "context.compaction.completed"
        ? "completed"
        : "failed";
    return transcriptNode(event, {
      kind: "system",
      phase,
      title: contextCompactionTranscriptTitle(event.type),
      summary: event.summary,
    });
  }
  if (event.type.startsWith("agent.")) {
    return transcriptNode(event, {
      kind: "system",
      phase: event.status === "failed" ? "failed" : event.status === "running" ? "executing" : "completed",
      title: event.agentLabel ?? "工作更新",
      summary: event.summary,
    });
  }
  return undefined;
}

function contextCompactionTranscriptTitle(type: string): string {
  if (type === "context.compaction.requested") return "正在压缩上下文";
  if (type === "context.compaction.completed") return "上下文压缩完成";
  return "上下文压缩失败";
}

function subAgentTranscriptPhase(event: PanelTranscriptStreamEvent): TranscriptNodePhase {
  if (event.status === "running") return "executing";
  if (event.status === "approval_needed") return "waiting_approval";
  if (event.status === "failed") return "failed";
  if (event.status === "cancelled") return "cancelled";
  return "completed";
}

type PendingBodyNode = {
  readonly modelCallId: string;
  readonly sequence: number;
  readonly event: PanelTranscriptStreamEvent;
  readonly stream: TextStreamAssembly;
};

function handlePendingBodyBeforeEvent(
  pending: Map<string, PendingBodyNode>,
  event: PanelTranscriptStreamEvent,
  nodes: TranscriptNode[]
): Map<string, PendingBodyNode> {
  if (pending.size === 0) {
    return pending;
  }
  if (event.type === "tool.requested" || event.type === "confirmation.needed" || event.type === "run.failed" || event.type === "run.blocked" || event.type === "run.cancelled" || event.type === "final.result") {
    flushPendingBodies(pending, nodes, false);
    return new Map();
  }
  return pending;
}

function handleBodyEvent(
  pending: Map<string, PendingBodyNode>,
  event: PanelTranscriptStreamEvent,
  nodes: TranscriptNode[]
): Map<string, PendingBodyNode> {
  const modelCallIds = bodyModelTurnIdsForPanelEvent(event);
  if (modelCallIds.length === 0) return pending;
  const next = new Map(pending);
  for (const modelCallId of modelCallIds) {
    const existing = next.get(modelCallId);
    if (event.type === "model.output.delta") {
      next.set(modelCallId, {
        modelCallId,
        sequence: event.sequence,
        event,
        stream: appendBodyStream(existing?.stream, event, event.delta ?? ""),
      });
      continue;
    }
    if (event.type === "model.output.completed") {
      const currentText = existing?.stream.text ?? "";
      next.set(modelCallId, {
        modelCallId,
        sequence: event.sequence,
        event,
        stream: appendBodyStream(existing?.stream, event, bodyCompletionFragment(currentText, event)),
      });
      continue;
    }
    if (event.type === "tool.requested" || event.type === "confirmation.needed" || event.type === "final.result" || event.type === "run.failed" || event.type === "run.blocked" || event.type === "run.cancelled") {
      if (existing !== undefined) {
        nodes.push(bodyNodeFromPending(existing));
        next.delete(modelCallId);
      }
    }
  }
  return next;
}

function bodyModelTurnIdsForPanelEvent(event: PanelTranscriptStreamEvent): readonly string[] {
  const primary = event.modelCallRefs[0];
  return primary === undefined ? [] : [primary];
}

function flushPendingBodies(pending: Map<string, PendingBodyNode>, nodes: TranscriptNode[], includeEmpty: boolean): void {
  for (const body of pending.values()) {
    if (!includeEmpty && body.stream.text.trim().length === 0) continue;
    nodes.push(bodyNodeFromPending(body));
  }
  pending.clear();
}

function bodyNodeFromPending(input: PendingBodyNode): TranscriptNode {
  return transcriptNode(input.event, {
    kind: "body",
    phase: "completed",
    title: "",
    summary: compactSafeLine(input.stream.text, 220),
    text: input.stream.text,
    modelUsage: input.event.detail?.modelUsage,
  });
}

function appendBodyStream(
  current: TextStreamAssembly | undefined,
  event: Pick<PanelTranscriptStreamEvent, "eventId">,
  next: string
): TextStreamAssembly {
  return appendTextStreamAssembly(
    current ?? emptyTextStreamAssembly(),
    next,
    textStreamFragmentSourceFromEventId(event.eventId),
  );
}

function bodyCompletionFragment(
  currentText: string,
  event: Pick<PanelTranscriptStreamEvent, "summary" | "detail">
): string {
  const preview = event.detail?.preview?.trim();
  if (preview !== undefined && preview.length > 0) {
    return preview;
  }
  const summary = event.summary?.trim() ?? "";
  if (summary.length === 0) {
    return "";
  }
  if (currentText.trim().length > 0 && isGenericCompletedBodySummary(summary)) {
    return "";
  }
  return summary;
}

function isGenericCompletedBodySummary(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s]/g, "");
  return normalized === "内容已整理" || normalized === "内容已整理并已进入报告或详情";
}

function requestSequencesBeforeConfirmations(events: readonly PanelTranscriptStreamEvent[]): ReadonlySet<number> {
  const sequences = new Set<number>();
  let latestRequested: PanelTranscriptStreamEvent | undefined;
  for (const event of events) {
    if (event.type === "tool.requested") {
      latestRequested = event;
      continue;
    }
    if (event.type === "confirmation.needed" && latestRequested !== undefined) {
      sequences.add(latestRequested.sequence);
      latestRequested = undefined;
      continue;
    }
    if (event.type === "tool.completed" || event.type === "tool.failed" || event.type === "final.result") {
      latestRequested = undefined;
    }
  }
  return sequences;
}

function transcriptNode(
  event: PanelTranscriptStreamEvent,
  input: {
    readonly kind: TranscriptNode["kind"];
    readonly phase: TranscriptNode["phase"];
    readonly title: string;
    readonly summary?: string;
    readonly text?: string;
    readonly display?: ToolDisplayProjection;
    readonly confirmation?: TranscriptNode["confirmation"];
    readonly modelUsage?: ModelUsage;
    readonly subAgentRunId?: string;
    readonly subAgentBatchId?: string;
    readonly subAgentName?: string;
    readonly subAgentTask?: string;
    readonly subAgentTotalCount?: number;
    readonly subAgentSuccessCount?: number;
    readonly subAgentFailedCount?: number;
    readonly subAgentCancelledCount?: number;
    readonly subAgentApprovalRequiredCount?: number;
    readonly subAgentNotStartedCount?: number;
  }
): TranscriptNode {
  return {
    nodeId: `${event.eventId}:node`,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.type,
    kind: input.kind,
    phase: input.phase,
    title: input.title,
    summary: input.summary,
    text: input.text,
    timestamp: event.createdAt,
    toolName: event.toolName,
    subAgentRunId: input.subAgentRunId,
    subAgentBatchId: input.subAgentBatchId,
    subAgentName: input.subAgentName,
    subAgentTask: input.subAgentTask,
    subAgentTotalCount: input.subAgentTotalCount,
    subAgentSuccessCount: input.subAgentSuccessCount,
    subAgentFailedCount: input.subAgentFailedCount,
    subAgentCancelledCount: input.subAgentCancelledCount,
    subAgentApprovalRequiredCount: input.subAgentApprovalRequiredCount,
    subAgentNotStartedCount: input.subAgentNotStartedCount,
    display: input.display,
    confirmation: input.confirmation,
    modelUsage: input.modelUsage,
    refs: transcriptRefsForEvent(event),
  };
}

function transcriptRefsForEvent(event: PanelTranscriptStreamEvent): readonly ObservationRef[] {
  return uniqueObservationRefs([
    ...event.sourceRefs.map(sourceRefToObservationRef),
    ...event.modelCallRefs.map((id): ObservationRef => ({ kind: "model_call", id })),
    ...event.toolCallRefs.map((id): ObservationRef => ({ kind: "tool_call", id })),
  ]);
}

function uniqueObservationRefs(refs: readonly ObservationRef[]): readonly ObservationRef[] {
  const seen = new Set<string>();
  const result: ObservationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function reasoningEventFromPanelEvent(event: PanelTranscriptStreamEvent): ReasoningTranscriptEvent {
  return {
    id: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    summary: event.summary,
    delta: event.delta,
    preview: event.detail?.preview,
    timestamp: event.createdAt,
    refs: transcriptRefsForEvent(event),
    modelCallRefs: event.modelCallRefs,
  };
}

function compactReasoningSummary(text: string): string {
  return compactSafeLine(text, 220);
}

function reasoningNodeFromPending(input: {
  readonly firstEvent: ReasoningTranscriptEvent;
  readonly text: string;
  readonly completed: boolean;
  readonly summary: string;
  readonly eventType: "model.reasoning.delta" | "model.reasoning.completed";
  readonly refs: readonly ObservationRef[];
}): TranscriptNode {
  return {
    nodeId: `${input.firstEvent.id}:reasoning-node`,
    runId: input.firstEvent.runId,
    sequence: input.firstEvent.sequence,
    eventType: input.eventType,
    kind: "thinking",
    phase: input.completed ? "completed" : "noted",
    title: "",
    summary: input.summary,
    text: input.text,
    timestamp: input.firstEvent.timestamp,
    refs: input.refs,
  };
}

function sourceRefToObservationRef(value: string): ObservationRef {
  const [rawKind, ...rest] = value.split(":");
  const id = rest.join(":");
  const kind = rawKind?.trim();
  if (kind !== undefined && kind.length > 0 && id.trim().length > 0 && isObservationRefKind(kind)) {
    return { kind, id: id.trim() };
  }
  return { kind: "event", id: value };
}

function isObservationRefKind(value: string): value is ObservationRef["kind"] {
  return value === "trace" ||
    value === "goal" ||
    value === "event" ||
    value === "task" ||
    value === "artifact" ||
    value === "direction_handoff" ||
    value === "direction_package" ||
    value === "growth_plan" ||
    value === "workflow" ||
    value === "rootlet" ||
    value === "candidate" ||
    value === "candidate_pool" ||
    value === "autonomy_decision" ||
    value === "convergence_review" ||
    value === "model_call" ||
    value === "tool_call" ||
    value === "agent_spec" ||
    value === "agent_run" ||
    value === "sub_agent_run" ||
    value === "sub_agent_batch" ||
    value === "agent_delegation" ||
    value === "parent_synthesis" ||
    value === "user_clarification" ||
    value === "verification" ||
    value === "fruit" ||
    value === "run_memory" ||
    value === "experience_candidate" ||
    value === "path_bias";
}

function transcriptToolSummary(event: PanelTranscriptStreamEvent): string | undefined {
  const display = event.detail?.display;
  if (display?.kind === "command_summary") {
    return commandSummaryParts({
      display,
      failed: event.type === "tool.failed",
    }).join(" · ") || undefined;
  }
  if (display?.kind === "search_results") {
    return [display.query, display.message, `${display.results.length} 条结果`]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join(" · ");
  }
  if (display?.kind === "directory_listing") {
    return directoryListingSummary(display);
  }
  if (display?.kind === "file_search_results") {
    return fileSearchSummary(display);
  }
  if (display?.kind === "read_result") {
    return display.title ?? display.uri ?? display.url ?? event.detail?.preview ?? event.summary;
  }
  if (display?.kind === "browser_snapshot") {
    return display.title ?? display.url ?? event.detail?.preview ?? event.summary;
  }
  if (display?.kind === "http_response") {
    return [
      display.method,
      display.url,
      display.statusCode === undefined ? undefined : `${display.statusCode}${display.statusText === undefined ? "" : ` ${display.statusText}`}`,
    ].filter(isString).join(" · ") || event.detail?.preview || event.summary;
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return fileDisplaySummary(display) ?? cleanOrdinaryToolText(event.detail?.preview) ?? cleanOrdinaryToolText(event.summary);
  }
  if (display?.kind === "generic_tool_summary") {
    const items = display.items?.slice(0, 6).map(cleanOrdinaryToolText).filter(isString) ?? [];
    return cleanOrdinaryToolText(display.summary) ??
      (items.length > 0 ? items.join("\n") : undefined) ??
      cleanOrdinaryToolText(event.detail?.preview) ??
      cleanOrdinaryToolText(event.summary);
  }
  return cleanOrdinaryToolText(event.detail?.preview) ?? cleanOrdinaryToolText(event.summary);
}

function toolTranscriptTitle(event: PanelTranscriptStreamEvent, phase: TranscriptNodePhase): string {
  const title = toolTranscriptTitleSet(event);
  if (phase === "preparing") return `准备${title.action}`;
  if (phase === "executing") return title.action;
  if (phase === "completed") return title.completed;
  if (phase === "failed") return title.failed;
  return title.action;
}

function toolTranscriptTitleSet(event: PanelTranscriptStreamEvent): {
  readonly action: string;
  readonly completed: string;
  readonly failed: string;
} {
  const display = event.detail?.display;
  const toolName = event.toolName?.trim().toLowerCase() ?? "";
  const fileMutationTitle = fileMutationTitleSet(toolName, display);
  if (display?.kind === "command_summary" || toolName === "run_command") {
    return { action: "运行命令", completed: "命令完成", failed: "命令未完成" };
  }
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) {
    return { action: "执行 Shell", completed: "Shell 完成", failed: "Shell 未完成" };
  }
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search") {
    return { action: "搜索资料", completed: "资料搜索完成", failed: "资料搜索未完成" };
  }
  if (display?.kind === "file_search_results") {
    return { action: "搜索文件", completed: "搜索完成", failed: "搜索未完成" };
  }
  if (display?.kind === "directory_listing") {
    return { action: "浏览目录", completed: "目录浏览完成", failed: "目录浏览未完成" };
  }
  if (fileMutationTitle !== undefined) {
    return fileMutationTitle;
  }
  if (display?.kind === "read_result") {
    return { action: "读取资料", completed: "资料读取完成", failed: "资料读取未完成" };
  }
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) {
    return { action: "读取网页", completed: "网页读取完成", failed: "网页读取未完成" };
  }
  if (display?.kind === "http_response" || toolName === "http_request") {
    return { action: "发送 HTTP 请求", completed: "HTTP 请求完成", failed: "HTTP 请求未完成" };
  }
  if (toolName === "grep_files" || toolName.includes("grep")) {
    return { action: "搜索文件", completed: "搜索完成", failed: "搜索未完成" };
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) {
    return { action: "浏览目录", completed: "目录浏览完成", failed: "目录浏览未完成" };
  }
  if (toolName === "read") {
    return { action: "读取资料", completed: "资料读取完成", failed: "资料读取未完成" };
  }
  if (toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) {
    return { action: "读取文件", completed: "读取完成", failed: "读取未完成" };
  }
  const action = event.detail?.action ??
    (event.detail?.display?.kind === "generic_tool_summary" ? event.detail.display.action : undefined);
  const fallback = action ?? (event.toolName === undefined ? "使用工具" : toolDisplayName(event.toolName));
  return { action: fallback, completed: `${fallback}完成`, failed: `${fallback}未完成` };
}

function fileMutationTitleSet(
  toolName: string,
  display: ToolDisplayProjection | undefined,
): { readonly action: string; readonly completed: string; readonly failed: string } | undefined {
  const genericText = display?.kind === "generic_tool_summary"
    ? [display.action, display.summary].filter((value): value is string => value !== undefined).join(" ").toLowerCase()
    : "";
  if (toolName === "delete_file" || toolName.includes("delete_file") || toolName.includes("remove_file") || mentionsDeleteFile(genericText)) {
    return { action: "删除文件", completed: "删除完成", failed: "删除未完成" };
  }
  if (toolName === "create_file" || toolName.includes("create_file") || mentionsCreateFile(genericText)) {
    return { action: "创建文件", completed: "创建完成", failed: "创建未完成" };
  }
  if (
    display?.kind === "file_diff_preview" ||
    toolName === "edit_file" ||
    toolName.includes("edit_file") ||
    toolName.includes("patch") ||
    toolName.includes("replace") ||
    mentionsEditFile(genericText)
  ) {
    return { action: "编辑文件", completed: "编辑完成", failed: "编辑未完成" };
  }
  if (display?.kind === "file_change_summary" || toolName === "write_file" || toolName.includes("write_file") || mentionsWriteFile(genericText)) {
    return { action: "写入文件", completed: "写入完成", failed: "写入未完成" };
  }
  return undefined;
}

function mentionsWriteFile(value: string): boolean {
  return value.includes("写入文件") || value.includes("write_file") || value.includes("write file") || value.includes("written");
}

function mentionsCreateFile(value: string): boolean {
  return value.includes("创建文件") || value.includes("create_file") || value.includes("create file") || value.includes("created");
}

function mentionsDeleteFile(value: string): boolean {
  return value.includes("删除文件") || value.includes("delete_file") || value.includes("delete file") || value.includes("deleted");
}

function mentionsEditFile(value: string): boolean {
  return value.includes("编辑文件") || value.includes("修改文件") || value.includes("edit_file") || value.includes("edit file");
}

function fileDisplaySummary(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): string | undefined {
  const changes =
    display.kind === "file_diff_preview"
      ? [
          display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
        ]
      : [
          display.append === true ? "追加写入" : undefined,
        ];
  return [display.path, ...changes]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" · ") || undefined;
}

function directoryListingSummary(display: Extract<ToolDisplayProjection, { readonly kind: "directory_listing" }>): string | undefined {
  const count = display.totalEntries ?? display.entriesReturned ?? display.entries.length;
  return [
    toolPathLabel(display.path),
    count <= 0 ? undefined : `${count} 项`,
    display.depth === undefined ? undefined : `深度 ${display.depth}`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || undefined;
}

function fileSearchSummary(display: Extract<ToolDisplayProjection, { readonly kind: "file_search_results" }>): string | undefined {
  return [
    cleanOrdinaryToolText(display.query),
    toolPathLabel(display.path),
    `${display.matches.length} 处匹配`,
  ].filter((value): value is string => value !== undefined && value.trim().length > 0).join(" · ") || undefined;
}

function toolPathLabel(value: string | undefined): string | undefined {
  if (value === ".") {
    return "当前目录";
  }
  return cleanOrdinaryToolText(value);
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function confirmationIdForTranscriptEvent(event: PanelTranscriptStreamEvent): string {
  const candidate = confirmationIdFromPanelEvent(event);
  if (candidate !== undefined) {
    return candidate;
  }
  return event.eventId.includes(":")
    ? event.eventId.split(":").at(-1) ?? event.eventId
    : event.eventId;
}

function pendingConfirmationForPanelEvent(
  event: PanelTranscriptStreamEvent,
  pendingConfirmation: TranscriptNode["confirmation"] | undefined
): TranscriptNode["confirmation"] | undefined {
  if (pendingConfirmation === undefined) {
    return undefined;
  }
  const eventConfirmationId = confirmationIdFromPanelEvent(event);
  if (eventConfirmationId !== undefined && eventConfirmationId !== pendingConfirmation.confirmationId) {
    return undefined;
  }
  return pendingConfirmation;
}

function confirmationIdFromPanelEvent(event: PanelTranscriptStreamEvent): string | undefined {
  const sourceRef = event.sourceRefs
    .map((ref) => ref.match(/^confirmation:(.+)$/)?.[1])
    .find((value): value is string => value !== undefined && value.trim().length > 0);
  if (sourceRef !== undefined) {
    return sourceRef.trim();
  }
  const toolCallRef = event.toolCallRefs[0];
  return toolCallRef === undefined || toolCallRef.trim().length === 0
    ? undefined
    : `confirmation-${toolCallRef.trim()}`;
}

function userDecisionPhase(event: PanelTranscriptStreamEvent): TranscriptNodePhase {
  if (event.type === "user.guidance") return "guidance";
  if (
    event.detail?.action === "deny" ||
    event.summary?.includes("拒绝") ||
    event.summary?.includes("不执行")
  ) {
    return "denied";
  }
  if (event.status === "blocked") return "denied";
  return "approved";
}

function userDecisionTitle(phase: TranscriptNodePhase): string {
  if (phase === "guidance") return "补充要求";
  if (phase === "denied") return "已不执行";
  return "继续处理";
}

function userFacingConfirmationSummary(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length === 0 || /^User approval was requested\.?$/i.test(text)) {
    return "";
  }
  return cleanConfirmationSummary(text);
}

function compactSafeLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
