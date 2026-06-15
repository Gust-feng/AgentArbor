import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRunEvents,
  stateWithAppendOnlyRunEvent,
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
