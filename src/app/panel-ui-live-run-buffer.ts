export type LiveRunBuffer = {
  readonly runId: string;
  readonly turns: readonly LiveModelTurnBuffer[];
  readonly appliedEventKeys: readonly string[];
};

export type LiveModelTurnBuffer = {
  readonly requestId: string;
  readonly outputText: string;
  readonly sideText: string;
  readonly reasoningText: string;
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
      outputText: `${turn.outputText}${event.delta ?? ""}`,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "model.reasoning.delta") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningText: appendLiveText(turn.reasoningText, event.delta ?? event.detail?.preview ?? event.summary ?? ""),
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "model.reasoning.completed") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningCompleted: true,
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (event.type === "tool.requested" || event.type === "confirmation.needed") {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningCompleted: turn.reasoningText.trim().length > 0 ? true : turn.reasoningCompleted,
      sideText: appendLiveText(turn.sideText, turn.outputText),
      outputText: "",
      modelRefs,
      updatedAtSequence: Math.max(turn.updatedAtSequence, event.sequence),
    });
  }
  if (isLiveReasoningSettlementEvent(event)) {
    return withLiveModelTurn(nextRun, {
      ...turn,
      reasoningCompleted: turn.reasoningText.trim().length > 0 ? true : turn.reasoningCompleted,
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
    event.type === "model.side.completed" ||
    event.type === "agent.note.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "user_approval.received" ||
    event.type === "user.guidance" ||
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
    outputText: "",
    sideText: "",
    reasoningText: "",
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
  return `${current}${next}`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
