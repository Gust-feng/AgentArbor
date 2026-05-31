import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLiveRunEvent,
  appendLiveRunEvents,
  emptyLiveRun,
} from "./panel-ui-live-run-buffer.js";

type TestRunEvent = Parameters<typeof appendLiveRunEvent>[2];

test("live run buffer ignores replayed reasoning delta events", () => {
  const first = event({
    id: "event-1",
    sequence: 1,
    type: "model.reasoning.delta",
    delta: "先分析",
  });

  const buffer = appendLiveRunEvent("run-1", emptyLiveRun("run-1"), first);
  const replayed = appendLiveRunEvent("run-1", buffer, first);

  assert.equal(replayed.turns[0]?.reasoningText, "先分析");
  assert.equal(replayed.appliedEventKeys.length, 1);
});

test("live run buffer deduplicates fallback events without ids", () => {
  const replayed = event({
    id: "",
    sequence: 7,
    type: "model.reasoning.delta",
    delta: "重复片段",
  });

  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [replayed, replayed]);

  assert.equal(buffer.turns[0]?.reasoningText, "重复片段");
  assert.equal(buffer.appliedEventKeys.length, 1);
});

test("live run buffer deduplicates restored events with rewritten ids", () => {
  const live = event({
    id: "live-event-1",
    sequence: 3,
    type: "model.reasoning.delta",
    delta: "同一段思考",
  });
  const restored = event({
    id: "run-1:restored:event:3:model.reasoning.delta",
    sequence: 3,
    type: "model.reasoning.delta",
    delta: "同一段思考",
  });

  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [live, restored]);

  assert.equal(buffer.turns[0]?.reasoningText, "同一段思考");
  assert.equal(buffer.appliedEventKeys.length, 1);
});

test("reasoning completed marks the turn without appending full summary again", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "完整思考",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.reasoning.completed",
      summary: "完整思考",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoningText, "完整思考");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("model turn settlement stops live reasoning without an explicit completed event", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "阶段思考",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.output.delta",
      delta: "回答",
    }),
    event({
      id: "event-3",
      sequence: 3,
      type: "model.output.completed",
      summary: "回答完成。",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoningText, "阶段思考");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("tool requests move live output into side text only once", () => {
  const output = event({
    id: "event-1",
    sequence: 1,
    type: "model.output.delta",
    delta: "准备读取文件",
  });
  const requested = event({
    id: "event-2",
    sequence: 2,
    type: "tool.requested",
  });

  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [output, requested, requested]);

  assert.equal(buffer.turns[0]?.outputText, "");
  assert.equal(buffer.turns[0]?.sideText, "准备读取文件");
});

function event(input: {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly delta?: string;
  readonly summary?: string;
}): TestRunEvent {
  return {
    id: input.id,
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    summary: input.summary,
    delta: input.delta,
    refs: [{ kind: "model_call", id: "model-1" }],
  };
}
