import type { TranscriptNode } from "../../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../../domain/observation/index.js";
import {
  appendTextStreamAssembly,
  textStreamAssemblyFromText,
  textStreamFragmentSourceFromEventId,
  type TextStreamAssembly,
} from "./readable-text-fragments.js";

export type ReasoningTranscriptEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly preview?: string;
  readonly refs: readonly ObservationRef[];
  readonly modelCallRefs: readonly string[];
};

export type PendingReasoningNode = {
  readonly firstEvent: ReasoningTranscriptEvent;
  readonly events: readonly ReasoningTranscriptEvent[];
  readonly stream: TextStreamAssembly;
  readonly completed: boolean;
};

export type ReasoningNodeFactory = (input: {
  readonly firstEvent: ReasoningTranscriptEvent;
  readonly events: readonly ReasoningTranscriptEvent[];
  readonly text: string;
  readonly completed: boolean;
  readonly summary: string;
  readonly eventType: "model.reasoning.delta" | "model.reasoning.completed";
  readonly refs: readonly ObservationRef[];
}) => TranscriptNode;

export type ReasoningSummaryFormatter = (text: string) => string | undefined;

export function isReasoningTranscriptEvent(
  event: ReasoningTranscriptEvent
): event is ReasoningTranscriptEvent & { readonly type: "model.reasoning.delta" | "model.reasoning.completed" } {
  return event.type === "model.reasoning.delta" || event.type === "model.reasoning.completed";
}

export function updatePendingReasoningNode(
  pending: PendingReasoningNode | undefined,
  event: ReasoningTranscriptEvent & { readonly type: "model.reasoning.delta" | "model.reasoning.completed" },
  nodes: TranscriptNode[],
  summaryFormatter: ReasoningSummaryFormatter,
  nodeFactory: ReasoningNodeFactory
): PendingReasoningNode | undefined {
  const text = event.delta ?? event.preview ?? event.summary;
  if (event.type === "model.reasoning.completed" && pending !== undefined && sameReasoningRefs(pending.firstEvent.modelCallRefs, event.modelCallRefs)) {
    return {
      firstEvent: pending.firstEvent,
      events: [...pending.events, event],
      stream: pending.stream,
      completed: true,
    };
  }
  if (event.type === "model.reasoning.completed" && completeExistingReasoningNode(nodes, event, text, summaryFormatter)) {
    return pending;
  }
  if (text === undefined || text.trim().length === 0) {
    return pending;
  }
  if (pending === undefined || !sameReasoningRefs(pending.firstEvent.modelCallRefs, event.modelCallRefs)) {
    flushPendingReasoningNode(pending, nodes, summaryFormatter, nodeFactory);
    if (event.type === "model.reasoning.delta" && appendExistingReasoningNode(nodes, event, text, summaryFormatter)) {
      return undefined;
    }
    return {
      firstEvent: event,
      events: [event],
      stream: textStreamAssemblyFromText(text, textStreamFragmentSourceFromEventId(event.id)),
      completed: event.type === "model.reasoning.completed",
    };
  }
  return {
    firstEvent: pending.firstEvent,
    events: [...pending.events, event],
    stream: appendReasoningFragment(pending.stream, text, event),
    completed: pending.completed || event.type === "model.reasoning.completed",
  };
}

export function settlePendingReasoningNode(
  pending: PendingReasoningNode | undefined,
  event: ReasoningTranscriptEvent
): PendingReasoningNode | undefined {
  if (pending === undefined) return undefined;
  if (event.modelCallRefs.length > 0 && !sameReasoningRefs(pending.firstEvent.modelCallRefs, event.modelCallRefs)) {
    return pending;
  }
  return {
    ...pending,
    completed: true,
  };
}

export function flushPendingReasoningNode(
  pending: PendingReasoningNode | undefined,
  nodes: TranscriptNode[],
  summaryFormatter: ReasoningSummaryFormatter,
  nodeFactory: ReasoningNodeFactory
): undefined {
  if (pending === undefined) return undefined;
  const text = pending.stream.text;
  if (text.trim().length === 0) return undefined;
  const eventType = pending.completed ? "model.reasoning.completed" : "model.reasoning.delta";
  nodes.push(nodeFactory({
    firstEvent: pending.firstEvent,
    events: pending.events,
    text,
    completed: pending.completed,
    summary: summaryFormatter(text) ?? text,
    eventType,
    refs: uniqueObservationRefs(pending.events.flatMap((event) => event.refs)),
  }));
  return undefined;
}

export function completeOpenReasoningNodes(
  nodes: TranscriptNode[],
  event: ReasoningTranscriptEvent,
  summaryFormatter: ReasoningSummaryFormatter
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const existing = nodes[index];
    if (
      existing === undefined ||
      existing.kind !== "thinking" ||
      existing.eventType !== "model.reasoning.delta" ||
      existing.phase === "completed"
    ) {
      continue;
    }
    if (event.modelCallRefs.length > 0 && !sameReasoningRefs(modelCallRefsForTranscriptNode(existing), event.modelCallRefs)) {
      continue;
    }
    const text = existing.text ?? existing.summary ?? "";
    if (text.trim().length === 0) continue;
    nodes[index] = {
      ...existing,
      eventType: "model.reasoning.completed",
      phase: "completed",
      summary: summaryFormatter(text),
      text,
      refs: uniqueObservationRefs([...existing.refs, ...event.refs]),
    };
  }
}

export function sameReasoningRefs(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length;
  }
  return left.some((id) => right.includes(id));
}

function completeExistingReasoningNode(
  nodes: TranscriptNode[],
  event: ReasoningTranscriptEvent,
  text: string | undefined,
  summaryFormatter: ReasoningSummaryFormatter
): boolean {
  const index = findExistingReasoningNodeIndex(nodes, event);
  if (index < 0) return false;
  const existing = nodes[index];
  if (existing === undefined) return false;
  const existingText = existing.text ?? existing.summary ?? "";
  const nextText = existingText.trim().length > 0 ? existingText : text ?? "";
  if (nextText.trim().length === 0) return false;
  nodes[index] = {
    ...existing,
    eventType: "model.reasoning.completed",
    phase: "completed",
    summary: summaryFormatter(nextText),
    text: nextText,
    refs: uniqueObservationRefs([...existing.refs, ...event.refs]),
  };
  return true;
}

function appendExistingReasoningNode(
  nodes: TranscriptNode[],
  event: ReasoningTranscriptEvent,
  text: string,
  summaryFormatter: ReasoningSummaryFormatter
): boolean {
  const index = findExistingReasoningNodeIndex(nodes, event);
  if (index < 0) return false;
  const existing = nodes[index];
  if (existing === undefined || existing.phase === "completed") return false;
  const existingText = existing.text ?? existing.summary ?? "";
  const existingStream = textStreamAssemblyFromText(
    existingText,
    existing.eventType === "model.reasoning.delta" && textStreamFragmentSourceFromEventId(event.id) === "replay"
      ? "live"
      : "ordinary"
  );
  const nextText = appendReasoningFragment(existingStream, text, event).text;
  nodes[index] = {
    ...existing,
    summary: summaryFormatter(nextText),
    text: nextText,
    refs: uniqueObservationRefs([...existing.refs, ...event.refs]),
  };
  return true;
}

function findExistingReasoningNodeIndex(nodes: readonly TranscriptNode[], event: ReasoningTranscriptEvent): number {
  if (event.modelCallRefs.length === 0) return -1;
  return nodes.findIndex((node) =>
    node.kind === "thinking" &&
    (node.eventType === "model.reasoning.delta" || node.eventType === "model.reasoning.completed") &&
    sameReasoningRefs(modelCallRefsForTranscriptNode(node), event.modelCallRefs)
  );
}

function modelCallRefsForTranscriptNode(node: TranscriptNode): readonly string[] {
  return node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
}

function appendReasoningFragment(
  current: TextStreamAssembly,
  next: string,
  event: ReasoningTranscriptEvent
): TextStreamAssembly {
  return appendTextStreamAssembly(current, next, textStreamFragmentSourceFromEventId(event.id));
}

function uniqueObservationRefs(refs: readonly ObservationRef[]): readonly ObservationRef[] {
  return refs.filter((ref, index, values) =>
    values.findIndex((candidate) => candidate.kind === ref.kind && candidate.id === ref.id) === index
  );
}
