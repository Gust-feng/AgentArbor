import {
  appendLiveRunEvent,
  appendLiveRunEvents,
  type LiveRunBuffer,
} from "./panel-ui-live-run-buffer.js";
import {
  createRunReadModelPatch,
  detailForRun,
  type RunProjectionDetail,
  type RunProjectionNode,
  type RunProjectionWorkSession,
} from "./panel-ui-run-projection.js";

export type RunObservationEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly delta?: string;
  readonly summary?: string;
  readonly refs: readonly {
    readonly kind: string;
    readonly id: string;
  }[];
  readonly detail?: {
    readonly preview?: string;
  };
};

export type RunObservationState<
  TRun,
  TEvent extends RunObservationEvent,
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TNode extends RunProjectionNode
> = {
  readonly run?: TRun;
  readonly workSession?: TWorkSession;
  readonly transcriptNodes: readonly TNode[];
  readonly transcriptNodesByRunId: Record<string, readonly TNode[]>;
  readonly events: readonly TEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: TDetail;
};

export function mergeRunEvents<TEvent extends RunObservationEvent>(
  previous: readonly TEvent[],
  incoming: readonly TEvent[]
): readonly TEvent[] {
  const byId = new Map<string, TEvent>();
  for (const event of previous) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function stateWithObservedRunEvents<
  TNode extends RunProjectionNode,
  TRun,
  TEvent extends RunObservationEvent,
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TState extends RunObservationState<TRun, TEvent, TWorkSession, TDetail, TNode>
>(
  previous: TState,
  input: {
    readonly runId: string;
    readonly events: readonly TEvent[];
  }
): TState {
  if (input.events.length === 0) {
    return previous;
  }
  return {
    ...previous,
    live: appendLiveRunEvents(input.runId, previous.live, input.events),
    events: mergeRunEvents(previous.events, input.events),
  };
}

export function stateWithObservedRunProjection<
  TNode extends RunProjectionNode,
  TRun,
  TEvent extends RunObservationEvent,
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TState extends RunObservationState<TRun, TEvent, TWorkSession, TDetail, TNode>
>(
  previous: TState,
  input: {
    readonly runId: string;
    readonly run?: TRun;
    readonly events?: readonly TEvent[];
    readonly workSession?: TWorkSession;
    readonly detail?: TDetail;
  }
): TState {
  const events = input.events ?? [];
  const readModel = createRunReadModelPatch(previous, {
    runId: input.runId,
    workSession: input.workSession,
    detail: input.detail ?? detailForRun(input.runId, previous.detail),
  });
  return {
    ...previous,
    run: input.run ?? previous.run,
    live: events.length === 0
      ? previous.live
      : appendLiveRunEvents(input.runId, previous.live, events),
    events: events.length === 0
      ? previous.events
      : mergeRunEvents(previous.events, events),
    ...readModel,
  };
}

export function stateWithObservedRunEvent<
  TNode extends RunProjectionNode,
  TRun,
  TEvent extends RunObservationEvent,
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TState extends RunObservationState<TRun, TEvent, TWorkSession, TDetail, TNode>
>(
  previous: TState,
  input: {
    readonly runId: string;
    readonly event: TEvent;
    readonly run?: TRun;
    readonly workSession?: TWorkSession;
    readonly detail?: TDetail;
  }
): TState {
  return stateWithObservedRunProjection(previous, {
    runId: input.runId,
    run: input.run,
    events: [input.event],
    workSession: input.workSession,
    detail: input.detail,
  });
}

export function stateWithAppendOnlyRunEvent<
  TNode extends RunProjectionNode,
  TRun,
  TEvent extends RunObservationEvent,
  TWorkSession extends RunProjectionWorkSession<TNode>,
  TDetail extends RunProjectionDetail<TNode>,
  TState extends RunObservationState<TRun, TEvent, TWorkSession, TDetail, TNode>
>(
  previous: TState,
  input: {
    readonly runId: string;
    readonly event: TEvent;
  }
): TState {
  return {
    ...previous,
    live: appendLiveRunEvent(input.runId, previous.live, input.event),
    events: mergeRunEvents(previous.events, [input.event]),
  };
}
