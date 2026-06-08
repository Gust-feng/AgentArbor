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
} from "./work-session-transcript-tools.js";
import {
  completeOpenReasoningNodes,
  flushPendingReasoningNode,
  isReasoningTranscriptEvent,
  settlePendingReasoningNode,
  updatePendingReasoningNode,
  type PendingReasoningNode,
  type ReasoningTranscriptEvent,
} from "../transcript-reasoning.js";
import { cleanConfirmationSummary } from "../confirmation-copy.js";
import { redactOrdinaryText } from "../safe-projection.js";

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

  for (const event of events) {
    const reasoningEvent = reasoningEventFromRunEvent(event);
    if (isReasoningTranscriptEvent(reasoningEvent)) {
      pendingReasoning = updatePendingReasoningNode(pendingReasoning, reasoningEvent, nodes, compactReasoningSummary, reasoningNodeFromPending);
      continue;
    }
    if (isReasoningSettlementRunEvent(event)) {
      pendingReasoning = settlePendingReasoningNode(pendingReasoning, reasoningEvent);
    }
    pendingReasoning = flushPendingReasoningNode(pendingReasoning, nodes, compactReasoningSummary, reasoningNodeFromPending);
    if (isReasoningSettlementRunEvent(event)) {
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
  if (event.visibility === "debug" || event.type === "run.started") {
    return undefined;
  }
  if (event.type === "model.output.delta" || event.type === "model.output.completed") {
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
    if (summary === undefined || summary.length === 0 || isLowValueAgentNote(summary)) {
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
  if (event.type === "confirmation.needed") {
    const summary = userFacingConfirmationSummary(event.summary);
    return transcriptNode(event, {
      kind: "confirmation",
      phase: "waiting_approval",
      title: "待确认",
      summary,
      confirmation: context.pendingConfirmation ?? {
        confirmationId: confirmationIdForRunEvent(event),
        runId: event.runId,
        title: "需要确认",
        actionSummary: summary,
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: event.timestamp,
        sourceRefs: event.refs.map((ref) => `${ref.kind}:${ref.id}`),
      },
    });
  }
  if (event.type === "user_approval.received" || event.type === "user.guidance") {
    const phase = event.type === "user.guidance"
      ? "guidance"
      : event.summary?.includes("拒绝") || event.status === "blocked"
        ? "denied"
        : "approved";
    return transcriptNode(event, {
      kind: "user_decision",
      phase,
      title: phase === "approved" ? "已确认" : phase === "denied" ? "已拒绝" : "补充要求",
      summary: event.summary,
    });
  }
  if (event.type === "run.resumed") {
    return transcriptNode(event, {
      kind: "user_decision",
      phase: "approved",
      title: "继续处理",
      summary: event.summary,
    });
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

function isReasoningSettlementRunEvent(event: RunEvent): boolean {
  return event.type === "model.output.completed" ||
    event.type === "model.side.completed" ||
    event.type === "agent.note.completed" ||
    event.type === "tool.requested" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "confirmation.needed" ||
    event.type === "user_approval.received" ||
    event.type === "user.guidance" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed" ||
    event.type === "final.result" ||
    event.type === "run.failed" ||
    event.type === "run.blocked" ||
    event.type === "run.cancelled";
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
    refs: event.refs,
  };
}

function toolCallRefsForRunEvent(event: RunEvent): readonly string[] {
  return event.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function confirmationIdForRunEvent(event: RunEvent): string {
  const toolCallRef = toolCallRefsForRunEvent(event)[0];
  return toolCallRef === undefined ? `confirmation-${event.sequence}` : `confirmation-${toolCallRef}`;
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

function isLowValueAgentNote(value: string): boolean {
  const text = value.trim();
  return text === "等待模型输出。" ||
    staleToolProgressNote(text) ||
    text === "Intelligence Channel requested model output." ||
    text === "Intelligence Channel completed model output validation.";
}

function staleToolProgressNote(value: string): boolean {
  const normalized = value.replace(/[。.!！?？；;:：、，,\s]/g, "");
  return normalized.includes("助手已选择使用工具") &&
    normalized.includes("工具结果") &&
    normalized.includes("后续处理");
}

function userFacingConfirmationSummary(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length === 0 || /^User approval was requested\.?$/i.test(text)) {
    return "";
  }
  return cleanConfirmationSummary(text);
}
