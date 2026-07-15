import {
  appendTextStreamAssembly,
  emptyTextStreamAssembly,
  appendReadableTextFragment,
  appendStreamTextEventFragment,
  appendSnapshotTextFragment,
  textStreamFragmentSourceFromEventId,
  type TextStreamAssembly,
} from "../transcript/readable-text-fragments.js";

export type LiveRunBuffer = {
  readonly runId: string;
  readonly turns: readonly LiveModelTurnBuffer[];
  readonly appliedEventKeys: readonly string[];
};

export type LiveModelTurnBuffer = {
  readonly requestId: string;
  readonly output: TextStreamAssembly;
  readonly outputSequence?: number;
  readonly outputCompleted?: boolean;
  readonly sideText: string;
  readonly sideTextSequence?: number;
  readonly reasoning: TextStreamAssembly;
  readonly reasoningSequence?: number;
  readonly reasoningCompleted: boolean;
  readonly modelRefs: readonly string[];
  readonly updatedAtSequence: number;
};

type RunEventLike = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly refs: readonly {
    readonly kind: string;
    readonly id: string;
  }[];
  readonly detail?: {
    readonly preview?: string;
  };
};

export function emptyLiveRun(runId: string): LiveRunBuffer {
  return {
    runId,
    turns: [],
    appliedEventKeys: [],
  };
}

export function liveRunHasVisibleText(live: LiveRunBuffer | undefined): boolean {
  return live?.turns.some((turn) =>
    turn.output.text.trim().length > 0 ||
    turn.sideText.trim().length > 0 ||
    turn.reasoning.text.trim().length > 0
  ) === true;
}

export function appendLiveRunEvents(
  runId: string,
  previous: LiveRunBuffer | undefined,
  events: readonly RunEventLike[]
): LiveRunBuffer {
  return events.reduce((current, event) => appendLiveRunEvent(runId, current, event), previous?.runId === runId ? previous : emptyLiveRun(runId));
}

export function appendLiveRunEvent(
  runId: string,
  previous: LiveRunBuffer | undefined,
  event: RunEventLike
): LiveRunBuffer {
  const current = previous?.runId === runId ? previous : emptyLiveRun(runId);
  const eventKey = liveRunEventKey(event);
  if (current.appliedEventKeys.includes(eventKey)) {
    return current;
  }
  const nextRun = {
    ...current,
    appliedEventKeys: [...current.appliedEventKeys, eventKey],
  };
  const requestId = liveModelRequestId(event) ?? current.turns.at(-1)?.requestId ?? "unknown";
  const turn = nextRun.turns.find((item) => item.requestId === requestId) ?? emptyLiveModelTurn(requestId);
  const modelRefs = uniqueStrings([
    ...turn.modelRefs,
    ...event.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id),
  ]);
  if (event.type === "model.output.delta") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      output: appendLiveTextFragment(turn.output, event.delta ?? "", event),
      outputSequence: Math.max(turn.outputSequence ?? 0, event.sequence),
      outputCompleted: turn.outputCompleted,
      reasoningCompleted: turn.reasoning.text.trim().length > 0 ? true : turn.reasoningCompleted,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "model.output.completed") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      output: appendCompletedOutputSnapshot(turn.output, event),
      outputSequence: Math.max(turn.outputSequence ?? 0, event.sequence),
      outputCompleted: true,
      reasoningCompleted: turn.reasoning.text.trim().length > 0 ? true : turn.reasoningCompleted,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "model.reasoning.delta") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoning: appendLiveTextFragment(turn.reasoning, event.delta ?? event.detail?.preview ?? event.summary ?? "", event),
      reasoningSequence: Math.max(turn.reasoningSequence ?? 0, event.sequence),
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "model.reasoning.completed") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoning: appendCompletedReasoningSnapshot(turn.reasoning, event),
      reasoningSequence: Math.max(turn.reasoningSequence ?? 0, event.sequence),
      reasoningCompleted: true,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "tool.requested" || event.type === "confirmation.needed") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningCompleted: turn.reasoning.text.trim().length > 0 ? true : turn.reasoningCompleted,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (isLiveReasoningSettlementEvent(event)) {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningCompleted: turn.reasoning.text.trim().length > 0 ? true : turn.reasoningCompleted,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  return withLiveModelTurn(nextRun, {
    ...turn,
    modelRefs,
    updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
  });
}

export function isLiveAppendOnlyEvent(event: RunEventLike): boolean {
  return event.type === "model.output.delta" || event.type === "model.reasoning.delta" || event.type === "model.reasoning.completed";
}

function isLiveReasoningSettlementEvent(event: RunEventLike): boolean {
  return event.type === "model.output.completed" ||
    event.type === "model.failed" ||
    event.type === "model.side.completed" ||
    event.type === "agent.note.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.cancelled" ||
    event.type === "user_approval.received" ||
    event.type === "user.guidance" ||
    event.type === "context.compaction.requested" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed" ||
    event.type === "final.result" ||
    event.type === "run.failed" ||
    event.type === "run.blocked" ||
    event.type === "run.cancelled";
}

function emptyLiveModelTurn(requestId: string): LiveModelTurnBuffer {
  return {
    requestId,
    output: emptyTextStreamAssembly(),
    outputSequence: 0,
    outputCompleted: false,
    sideText: "",
    sideTextSequence: 0,
    reasoning: emptyTextStreamAssembly(),
    reasoningSequence: 0,
    reasoningCompleted: false,
    modelRefs: [],
    updatedAtSequence: 0,
  };
}

function liveRunEventKey(event: RunEventLike): string {
  if (event.sequence > 0) return `${event.runId}:${event.sequence}:${event.type}`;
  return event.id.length > 0 ? event.id : `${event.runId}:${event.type}:${event.delta ?? ""}`;
}

function withLiveModelTurn(live: LiveRunBuffer, turn: LiveModelTurnBuffer): LiveRunBuffer {
  const exists = live.turns.some((item) => item.requestId === turn.requestId);
  return {
    ...live,
    turns: exists
      ? live.turns.map((item) => item.requestId === turn.requestId ? turn : item)
      : [...live.turns, turn],
  };
}

function liveModelRequestId(event: RunEventLike): string | undefined {
  return event.refs.find((ref) => ref.kind === "model_call")?.id;
}

function appendLiveText(current: string, next: string): string {
  return appendStreamTextEventFragment(current, next, undefined);
}

function appendLiveTextFragment(
  current: TextStreamAssembly,
  next: string,
  event: RunEventLike
): TextStreamAssembly {
  return appendTextStreamAssembly(
    current,
    next,
    textStreamFragmentSourceFromEventId(event.id)
  );
}

function appendCompletedReasoningSnapshot(
  current: TextStreamAssembly,
  event: RunEventLike
): TextStreamAssembly {
  const next = event.delta ?? event.detail?.preview ?? event.summary ?? "";
  if (!shouldUseCompletedReasoningSnapshot(current.text, next)) {
    return current;
  }
  return {
    text: preferredSnapshotText(current.text, next),
    replayCatchupText: "",
    liveSourceObserved: current.liveSourceObserved || textStreamFragmentSourceFromEventId(event.id) === "live",
  };
}

function appendCompletedOutputSnapshot(
  current: TextStreamAssembly,
  event: RunEventLike
): TextStreamAssembly {
  const next = completedOutputFragment(current.text, event);
  if (!shouldUseCompletedOutputSnapshot(current.text, next)) {
    return current;
  }
  return {
    text: preferredCompletedOutputText(current.text, next),
    replayCatchupText: "",
    liveSourceObserved: current.liveSourceObserved || textStreamFragmentSourceFromEventId(event.id) === "live",
  };
}

function shouldUseCompletedReasoningSnapshot(current: string, next: string): boolean {
  const normalizedNext = normalizeBoundaryText(next);
  if (normalizedNext.length === 0) return false;
  const normalizedCurrent = normalizeBoundaryText(current);
  return normalizedCurrent.length === 0 ||
    normalizedNext.startsWith(normalizedCurrent) ||
    normalizedCurrent.startsWith(normalizedNext);
}

function shouldUseCompletedOutputSnapshot(current: string, next: string): boolean {
  const normalizedNext = normalizeBoundaryText(next);
  if (normalizedNext.length === 0) return false;
  const normalizedCurrent = normalizeBoundaryText(current);
  return normalizedCurrent.length === 0 ||
    normalizedNext.startsWith(normalizedCurrent) ||
    normalizedCurrent.startsWith(normalizedNext);
}

function preferredSnapshotText(current: string, next: string): string {
  if (current.length === 0) return next;
  if (next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  const normalizedCurrent = normalizeBoundaryText(current);
  const normalizedNext = normalizeBoundaryText(next);
  if (
    normalizedCurrent.length > 0 &&
    normalizedNext.length > 0 &&
    (normalizedCurrent === normalizedNext || normalizedCurrent.startsWith(normalizedNext) || normalizedNext.startsWith(normalizedCurrent))
  ) {
    return current;
  }
  return appendSnapshotTextFragment(current, next);
}

function preferredCompletedOutputText(current: string, next: string): string {
  if (current.length === 0) return next;
  if (next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  const normalizedCurrent = normalizeBoundaryText(current);
  const normalizedNext = normalizeBoundaryText(next);
  if (normalizedCurrent.length === 0 || normalizedNext.length === 0) {
    return current;
  }
  if (normalizedCurrent === normalizedNext) {
    return current.length >= next.length ? current : next;
  }
  if (normalizedNext.startsWith(normalizedCurrent)) {
    return appendReadableTextFragment(current, normalizedNext.slice(normalizedCurrent.length));
  }
  if (normalizedCurrent.startsWith(normalizedNext)) {
    return current;
  }
  return current;
}

function completedOutputFragment(
  currentText: string,
  event: Pick<RunEventLike, "summary" | "detail">
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
  return normalized === "内容已整理" ||
    normalized === "内容已整理并已进入报告或详情" ||
    normalized === "回答完成" ||
    normalized === "回复完成" ||
    normalized === "已回答";
}

function normalizeBoundaryText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
