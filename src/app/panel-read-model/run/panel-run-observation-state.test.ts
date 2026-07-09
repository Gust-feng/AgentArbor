import assert from "node:assert/strict";
import test from "node:test";
import {
  canApplyRunSubscriptionToState,
  createAppendOnlyRunEventBatcher,
  mergeRunEvents,
  stateWithAppendOnlyRunEvent,
  stateWithAppendOnlyRunEvents,
  stateWithConversationGuard,
  stateWithObservedRunProjection,
  type RunObservationEvent,
  type RunObservationState,
} from "./panel-run-observation-state.js";

type TestRun = {
  readonly runId: string;
  readonly status: "running" | "completed";
};

type TestNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly text?: string;
};

type TestWorkView = {
  readonly run: {
    readonly runId: string;
  };
  readonly transcriptNodes?: readonly TestNode[];
};

type TestDetail = {
  readonly runId: string;
  readonly transcript?: {
    readonly transcriptNodes?: readonly TestNode[];
  };
};

type TestState = RunObservationState<TestRun, RunObservationEvent, TestWorkView, TestDetail, TestNode>;

test("run observation state merges events by id and sequence", () => {
  const merged = mergeRunEvents(
    [event({ id: "event-2", sequence: 2, delta: "old" })],
    [
      event({ id: "event-1", sequence: 1, delta: "first" }),
      event({ id: "event-2", sequence: 2, delta: "new" }),
    ]
  );

  assert.deepEqual(merged.map((item) => item.id), ["event-1", "event-2"]);
  assert.equal(merged[1]?.delta, "new");
});

test("append-only observation updates live text without touching run read model", () => {
  const next = stateWithAppendOnlyRunEvent(initialState(), {
    runId: "run-1",
    event: event({ type: "model.output.delta", delta: "正在输出" }),
  });

  assert.equal(next.events.length, 0);
  assert.equal(next.live?.runId, "run-1");
  assert.equal(next.live?.turns[0]?.output.text, "正在输出");
  assert.equal(next.workView, undefined);
  assert.deepEqual(next.transcriptNodes, []);
});

test("append-only observation batch updates live text without touching run read model", () => {
  const next = stateWithAppendOnlyRunEvents(initialState(), {
    runId: "run-1",
    events: [
      event({ sequence: 1, type: "model.output.delta", delta: "正在" }),
      event({ sequence: 2, type: "model.output.delta", delta: "输出" }),
    ],
  });

  assert.equal(next.events.length, 0);
  assert.equal(next.live?.runId, "run-1");
  assert.equal(next.live?.turns[0]?.output.text, "正在输出");
  assert.equal(next.workView, undefined);
  assert.deepEqual(next.transcriptNodes, []);
});

test("append-only batcher coalesces multiple events into one state application", () => {
  let state = initialState();
  let scheduledFlush: (() => void) | undefined;
  let applicationCount = 0;
  const batcher = createAppendOnlyRunEventBatcher<RunObservationEvent>({
    schedule: (flush) => {
      scheduledFlush = flush;
      return undefined;
    },
    apply: (events) => {
      applicationCount += 1;
      state = stateWithAppendOnlyRunEvents(state, { runId: "run-1", events });
    },
  });

  batcher.enqueue(event({ sequence: 1, type: "model.output.delta", delta: "A" }));
  batcher.enqueue(event({ sequence: 2, type: "model.output.delta", delta: "B" }));
  batcher.enqueue(event({ sequence: 3, type: "model.reasoning.delta", delta: "C" }));

  assert.equal(applicationCount, 0);
  assert.equal(batcher.pendingCount(), 3);

  scheduledFlush?.();

  assert.equal(applicationCount, 1);
  assert.equal(batcher.pendingCount(), 0);
  assert.equal(state.live?.turns[0]?.output.text, "AB");
  assert.equal(state.live?.turns[0]?.reasoning.text, "C");
});

test("append-only batcher flushes pending events immediately before structural handling", () => {
  let state = initialState();
  let scheduledFlush: (() => void) | undefined;
  let cancelCount = 0;
  let applicationCount = 0;
  const batcher = createAppendOnlyRunEventBatcher<RunObservationEvent>({
    schedule: (flush) => {
      scheduledFlush = flush;
      return () => {
        cancelCount += 1;
      };
    },
    apply: (events) => {
      applicationCount += 1;
      state = stateWithAppendOnlyRunEvents(state, { runId: "run-1", events });
    },
  });

  batcher.enqueue(event({ sequence: 1, type: "model.output.delta", delta: "A" }));
  batcher.enqueue(event({ sequence: 2, type: "model.output.delta", delta: "B" }));
  batcher.flush();
  const stateBeforeStructuralEvent = state;

  assert.equal(applicationCount, 1);
  assert.equal(cancelCount, 1);
  assert.equal(batcher.pendingCount(), 0);
  assert.equal(stateBeforeStructuralEvent.live?.turns[0]?.output.text, "AB");

  scheduledFlush?.();

  assert.equal(applicationCount, 1);
  assert.equal(state.live?.turns[0]?.output.text, "AB");
});

test("observed run projection updates run, events, live buffer, and transcript cache together", () => {
  const run = basicRun("run-1", "running");
  const transcriptNode = node("run-1", 4, "正在整理结果");
  const workView: TestWorkView = {
    run,
    transcriptNodes: [transcriptNode],
  };

  const next = stateWithObservedRunProjection(initialState(), {
    runId: "run-1",
    run,
    events: [event({ sequence: 4, type: "model.reasoning.delta", delta: "分析" })],
    workView,
  });

  assert.equal(next.run?.runId, "run-1");
  assert.equal(next.events[0]?.delta, "分析");
  assert.equal(next.live?.turns[0]?.reasoning.text, "分析");
  assert.equal(next.workView, workView);
  assert.deepEqual(next.transcriptNodes, [transcriptNode]);
  assert.deepEqual(next.transcriptNodesByRunId["run-1"], [transcriptNode]);
});

test("run subscription guard rejects stale epochs", () => {
  assert.equal(canApplyRunSubscriptionToState({
    previous: { conversation: { conversationId: "conversation-1" } },
    activeRunId: "run-1",
    currentEpoch: 2,
    runId: "run-1",
    conversationId: "conversation-1",
    epoch: 1,
  }), false);
});

test("run subscription guard rejects mismatched conversations", () => {
  assert.equal(canApplyRunSubscriptionToState({
    previous: { conversation: { conversationId: "conversation-2" } },
    activeRunId: "run-1",
    currentEpoch: 1,
    runId: "run-1",
    conversationId: "conversation-1",
    epoch: 1,
  }), false);
});

test("settled projection guard leaves old conversation state unchanged", () => {
  const previous = {
    conversation: { conversationId: "conversation-old", title: "old", turns: [] },
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
  };
  const next = {
    ...previous,
    conversation: { conversationId: "conversation-new", title: "new", turns: [] },
  };

  assert.equal(stateWithConversationGuard(previous, {
    expectedConversationId: "conversation-new",
    next,
  }), previous);
});

function initialState(): TestState {
  return {
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
  };
}

function basicRun(runId: string, status: TestRun["status"]): TestRun {
  return { runId, status };
}

function event(input: {
  readonly id?: string;
  readonly sequence?: number;
  readonly type?: string;
  readonly delta?: string;
}): RunObservationEvent {
  const sequence = input.sequence ?? 1;
  return {
    id: input.id ?? `event-${sequence}`,
    runId: "run-1",
    sequence,
    type: input.type ?? "model.output.delta",
    delta: input.delta,
    refs: [{ kind: "model_call", id: "model-1" }],
  };
}

function node(runId: string, sequence: number, text: string): TestNode {
  return {
    nodeId: `node-${sequence}`,
    runId,
    sequence,
    text,
  };
}
