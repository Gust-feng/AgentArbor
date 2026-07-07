import type {
  ConfirmationRequest,
  RunEvent,
  TranscriptNode,
  TranscriptNodePhase,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import {
  toolTranscriptTitleFromRunEvent,
  transcriptToolSummaryFromRunEvent,
} from "./work-view-transcript-tools.js";
import {
  completeOpenReasoningNodes,
  flushPendingReasoningNode,
  isReasoningTranscriptEvent,
  settlePendingReasoningNode,
  updatePendingReasoningNode,
  type PendingReasoningNode,
  type ReasoningTranscriptEvent,
} from "../transcript-reasoning.js";
import {
  appendTextStreamAssembly,
  emptyTextStreamAssembly,
  textStreamFragmentSourceFromEventId,
  type TextStreamAssembly,
} from "../readable-text-fragments.js";
import { cleanConfirmationSummary } from "../confirmation-copy.js";
import { redactOrdinaryText } from "../safe-projection.js";
import {
  isLowValueOrdinaryAgentNote,
  isOrdinaryTranscriptReasoningSettlementEvent,
  isOrdinaryTranscriptSuppressedEvent,
} from "../ordinary-transcript-event-policy.js";

export function transcriptNodesFromRunEvents(
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined
): readonly TranscriptNode[] {
  const confirmationToolRefs = new Set(
    events
      .filter((event) => event.type === "confirmation.needed")
      .flatMap(toolCallRefsForRunEvent)
  );
  const confirmationRequestSequences = requestSequencesBeforeConfirmations(events);
  const requestedByCallId = new Map<string, number>();
  const nodes: TranscriptNode[] = [];
  let pendingReasoning: PendingReasoningNode | undefined;
  let pendingBodyByModelCallId = new Map<string, PendingBodyNode>();

  for (const event of events) {
    const reasoningEvent = reasoningEventFromRunEvent(event);
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
    const node = transcriptNodeFromRunEvent(event, {
      confirmationToolRefs,
      confirmationRequestSequences,
      requestedByCallId,
      pendingConfirmation,
    });
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  flushPendingBodies(pendingBodyByModelCallId, nodes);
  flushPendingReasoningNode(pendingReasoning, nodes, compactReasoningSummary, reasoningNodeFromPending);

  return nodes;
}

function transcriptNodeFromRunEvent(
  event: RunEvent,
  context: {
    readonly confirmationToolRefs: ReadonlySet<string>;
    readonly confirmationRequestSequences: ReadonlySet<number>;
    readonly requestedByCallId: Map<string, number>;
    readonly pendingConfirmation: ConfirmationRequest | undefined;
  }
): TranscriptNode | undefined {
  if (event.type === "model.output.delta" || event.type === "model.output.completed") {
    return undefined;
  }
  if (isOrdinaryTranscriptSuppressedEvent(event)) {
    return undefined;
  }
  if (event.type === "model.output.side") {
    return undefined;
  }
  if (event.type === "model.side.completed") {
    const text = (event.detail?.preview ?? event.summary ?? "").trim();
    if (text.length === 0) {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "system",
      phase: "completed",
      title: "",
      summary: compactSafeLine(text, 220),
      text,
    });
  }
  if (event.type === "agent.note.delta" || event.type === "agent.note.completed") {
    const summary = event.summary?.trim();
    if (isLowValueOrdinaryAgentNote(summary)) {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "thinking",
      phase: event.type === "agent.note.delta" ? "noted" : "completed",
      title: "",
      summary,
    });
  }
  if (event.type === "tool.requested") {
    const callId = toolCallRefsForRunEvent(event)[0];
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
      title: toolTranscriptTitleFromRunEvent(event, phase),
      summary: transcriptToolSummaryFromRunEvent(event),
      display: event.detail?.display,
    });
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    const phase: TranscriptNodePhase = event.type === "tool.completed" ? "completed" : "failed";
    return transcriptNode(event, {
      kind: "tool",
      phase,
      title: toolTranscriptTitleFromRunEvent(event, phase),
      summary: transcriptToolSummaryFromRunEvent(event),
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
      title: event.type.startsWith("sub_agent_batch.") ? "子 Agent 批次" : event.detail?.subAgentName ?? "子 Agent",
      summary: event.summary,
    });
  }
  if (event.type === "confirmation.needed") {
    const pendingConfirmation = pendingConfirmationForEvent(event, context.pendingConfirmation);
    if (pendingConfirmation === undefined) {
      return undefined;
    }
    const summary = userFacingConfirmationSummary(event.summary);
    return transcriptNode(event, {
      kind: "confirmation",
      phase: "waiting_approval",
      title: "待处理",
      summary,
      confirmation: pendingConfirmation,
    });
  }
  if (event.type === "user_approval.received" || event.type === "user.guidance") {
    const phase = event.type === "user.guidance"
      ? "guidance"
      : event.detail?.action === "deny" || event.summary?.includes("拒绝") || event.summary?.includes("不执行") || event.status === "blocked"
        ? "denied"
        : "approved";
    if (phase === "approved") {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "user_decision",
      phase,
      title: phase === "denied" ? "已不执行" : "补充要求",
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
    });
  }
  if (event.type === "run.failed" || event.type === "run.blocked" || event.type === "run.cancelled") {
    return transcriptNode(event, {
      kind: "system",
      phase: event.type === "run.failed" ? "failed" : event.type === "run.cancelled" ? "cancelled" : "blocked",
      title: event.title,
      summary: event.summary,
    });
  }
  if (event.type === "context.compaction.completed" || event.type === "context.compaction.failed") {
    return transcriptNode(event, {
      kind: "system",
      phase: event.type === "context.compaction.completed" ? "completed" : "failed",
      title: event.title,
      summary: event.summary,
    });
  }
  if (event.type.startsWith("agent.")) {
    return transcriptNode(event, {
      kind: "system",
      phase: event.status === "failed" ? "failed" : event.status === "running" ? "executing" : "completed",
      title: event.title,
      summary: event.summary,
    });
  }
  return undefined;
}

type PendingBodyNode = {
  readonly modelCallId: string;
  readonly event: RunEvent;
  readonly stream: TextStreamAssembly;
};

function handlePendingBodyBeforeEvent(
  pending: Map<string, PendingBodyNode>,
  event: RunEvent,
  nodes: TranscriptNode[]
): Map<string, PendingBodyNode> {
  if (pending.size === 0) return pending;
  if (
    event.type === "tool.requested" ||
    event.type === "sub_agent.started" ||
    event.type === "sub_agent.completed" ||
    event.type === "sub_agent_batch.started" ||
    event.type === "sub_agent_batch.completed" ||
    event.type === "confirmation.needed" ||
    event.type === "run.failed" ||
    event.type === "run.blocked" ||
    event.type === "run.cancelled" ||
    event.type === "final.result"
  ) {
    flushPendingBodies(pending, nodes);
    return new Map();
  }
  return pending;
}

function handleBodyEvent(
  pending: Map<string, PendingBodyNode>,
  event: RunEvent,
  nodes: TranscriptNode[]
): Map<string, PendingBodyNode> {
  const modelCallIds = bodyModelTurnIdsForRunEvent(event);
  if (modelCallIds.length === 0) return pending;
  const next = new Map(pending);
  for (const modelCallId of modelCallIds) {
    const existing = next.get(modelCallId);
    if (event.type === "model.output.delta") {
      next.set(modelCallId, {
        modelCallId,
        event,
        stream: appendBodyStream(existing?.stream, event.id, event.delta ?? ""),
      });
      continue;
    }
    if (event.type === "model.output.completed") {
      const currentText = existing?.stream.text ?? "";
      next.set(modelCallId, {
        modelCallId,
        event,
        stream: appendBodyStream(existing?.stream, event.id, bodyCompletionFragment(currentText, event)),
      });
      continue;
    }
    if (
      event.type === "tool.requested" ||
      event.type === "sub_agent.started" ||
      event.type === "sub_agent.completed" ||
      event.type === "sub_agent_batch.started" ||
      event.type === "sub_agent_batch.completed" ||
      event.type === "confirmation.needed" ||
      event.type === "final.result" ||
      event.type === "run.failed" ||
      event.type === "run.blocked" ||
      event.type === "run.cancelled"
    ) {
      if (existing !== undefined) {
        nodes.push(bodyNodeFromPending(existing));
        next.delete(modelCallId);
      }
    }
  }
  return next;
}

function bodyModelTurnIdsForRunEvent(event: RunEvent): readonly string[] {
  const primary = modelCallRefsForRunEvent(event)[0];
  return primary === undefined ? [] : [primary];
}

function flushPendingBodies(pending: Map<string, PendingBodyNode>, nodes: TranscriptNode[]): void {
  for (const body of pending.values()) {
    if (body.stream.text.trim().length === 0) continue;
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
  });
}

function appendBodyStream(
  current: TextStreamAssembly | undefined,
  eventId: string,
  next: string
): TextStreamAssembly {
  return appendTextStreamAssembly(
    current ?? emptyTextStreamAssembly(),
    next,
    textStreamFragmentSourceFromEventId(eventId),
  );
}

function bodyCompletionFragment(
  currentText: string,
  event: Pick<RunEvent, "summary" | "detail">
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

function requestSequencesBeforeConfirmations(events: readonly RunEvent[]): ReadonlySet<number> {
  const sequences = new Set<number>();
  let latestRequested: RunEvent | undefined;
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
  event: RunEvent,
  input: {
    readonly kind: TranscriptNode["kind"];
    readonly phase: TranscriptNode["phase"];
    readonly title: string;
    readonly summary?: string;
    readonly text?: string;
    readonly display?: ToolDisplayProjection;
    readonly confirmation?: ConfirmationRequest;
  }
): TranscriptNode {
  return {
    nodeId: `${event.id}:node`,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.type,
    kind: input.kind,
    phase: input.phase,
    title: input.title,
    summary: input.summary,
    text: input.text,
    timestamp: event.timestamp,
    toolName: event.toolName,
    display: input.display,
    confirmation: input.confirmation,
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
    refs: event.refs,
  };
}

function subAgentTranscriptPhase(event: RunEvent): TranscriptNodePhase {
  if (event.type === "sub_agent.started" || event.type === "sub_agent_batch.started") {
    return "executing";
  }
  if (event.status === "failed" || event.detail?.subAgentStatus === "failed") {
    return "failed";
  }
  if (event.status === "cancelled" || event.detail?.subAgentStatus === "cancelled") {
    return "cancelled";
  }
  if (event.status === "approval_needed" || event.detail?.subAgentStatus === "approval_required") {
    return "waiting_approval";
  }
  return "completed";
}

function toolCallRefsForRunEvent(event: RunEvent): readonly string[] {
  return event.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function pendingConfirmationForEvent(
  event: RunEvent,
  pendingConfirmation: ConfirmationRequest | undefined
): ConfirmationRequest | undefined {
  if (pendingConfirmation === undefined) {
    return undefined;
  }
  const eventConfirmationId = confirmationIdFromRunEvent(event);
  if (eventConfirmationId !== undefined && eventConfirmationId !== pendingConfirmation.confirmationId) {
    return undefined;
  }
  return pendingConfirmation;
}

function confirmationIdFromRunEvent(event: RunEvent): string | undefined {
  const explicit = event.refs
    .map((ref) => ref.kind === "event" ? ref.id.match(/^confirmation:(.+)$/)?.[1] : undefined)
    .find((value): value is string => value !== undefined && value.trim().length > 0);
  if (explicit !== undefined) {
    return explicit.trim();
  }
  const toolCallRef = toolCallRefsForRunEvent(event)[0];
  return toolCallRef === undefined ? undefined : `confirmation-${toolCallRef}`;
}

function modelCallRefsForRunEvent(event: RunEvent): readonly string[] {
  return event.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
}

function uniqueObservationRefs(refs: readonly ObservationRef[]): readonly ObservationRef[] {
  return refs.filter((ref, index, values) =>
    values.findIndex((candidate) => candidate.kind === ref.kind && candidate.id === ref.id) === index
  );
}

function reasoningEventFromRunEvent(event: RunEvent): ReasoningTranscriptEvent {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    summary: event.summary,
    delta: event.delta,
    preview: event.detail?.preview,
    refs: event.refs,
    modelCallRefs: modelCallRefsForRunEvent(event),
  };
}

function compactReasoningSummary(text: string): string {
  return compactSafeLine(text, 180);
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
    ...transcriptNodeFromReasoningEvent(input.firstEvent, {
      kind: "thinking",
      phase: input.completed ? "completed" : "noted",
      title: "",
      summary: input.summary,
      text: input.text,
    }),
    nodeId: `${input.firstEvent.id}:reasoning-node`,
    eventType: input.eventType,
    refs: input.refs,
  };
}

function transcriptNodeFromReasoningEvent(
  event: ReasoningTranscriptEvent,
  input: {
    readonly kind: TranscriptNode["kind"];
    readonly phase: TranscriptNode["phase"];
    readonly title: string;
    readonly summary?: string;
    readonly text?: string;
  }
): TranscriptNode {
  return {
    nodeId: `${event.id}:node`,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.type,
    kind: input.kind,
    phase: input.phase,
    title: input.title,
    summary: input.summary,
    text: input.text,
    timestamp: event.timestamp,
    refs: event.refs,
  };
}

function compactSafeLine(value: string, maxLength: number): string {
  const normalized = redactOrdinaryText(value, maxLength).replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function userFacingConfirmationSummary(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length === 0 || /^User approval was requested\.?$/i.test(text)) {
    return "";
  }
  return cleanConfirmationSummary(text);
}
