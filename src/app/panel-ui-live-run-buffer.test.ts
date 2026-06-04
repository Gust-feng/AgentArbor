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

  assert.equal(replayed.turns[0]?.reasoning.text, "先分析");
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

  assert.equal(buffer.turns[0]?.reasoning.text, "重复片段");
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

  assert.equal(buffer.turns[0]?.reasoning.text, "同一段思考");
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

  assert.equal(buffer.turns[0]?.reasoning.text, "完整思考");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("reasoning completed can extend a partial reasoning snapshot", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "先确认",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.reasoning.completed",
      summary: "先确认问题，再检查上下文",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "先确认问题，再检查上下文");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("reasoning completed does not collapse spaced live text into compact snapshot", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.reasoning.delta:model-1:1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "The user is",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.reasoning.completed",
      summary: "Theuserisasking",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "The user is");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("reasoning completed keeps standalone completed text when no delta arrived", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.completed",
      summary: "先理解目标，再决定是否需要工具。",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "先理解目标，再决定是否需要工具。");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("reasoning completed does not append generic completion copy to existing reasoning", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "先确认问题",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.reasoning.completed",
      summary: "思考完成。",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "先确认问题");
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

  assert.equal(buffer.turns[0]?.reasoning.text, "阶段思考");
  assert.equal(buffer.turns[0]?.reasoningCompleted, true);
});

test("live run buffer keeps output and reasoning exact", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "hello",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.reasoning.delta",
      delta: "world",
    }),
    event({
      id: "event-3",
      sequence: 3,
      type: "model.output.delta",
      delta: "foo",
    }),
    event({
      id: "event-4",
      sequence: 4,
      type: "model.output.delta",
      delta: "bar",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "helloworld");
  assert.equal(buffer.turns[0]?.output.text, "foobar");
});

test("live run buffer preserves repeated live delta suffixes", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "ha",
    }),
    event({
      id: "run-1:live:model.output.delta:model-1:2",
      sequence: 2,
      type: "model.output.delta",
      delta: "ha",
    }),
    event({
      id: "run-1:live:model.reasoning.delta:model-1:3",
      sequence: 3,
      type: "model.reasoning.delta",
      delta: "想",
    }),
    event({
      id: "run-1:live:model.reasoning.delta:model-1:4",
      sequence: 4,
      type: "model.reasoning.delta",
      delta: "想",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "haha");
  assert.equal(buffer.turns[0]?.reasoning.text, "想想");
});

test("live run buffer deduplicates completed replay output without changing text", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "foo",
    }),
    event({
      id: "run-1:live:model.output.delta:model-1:2",
      sequence: 2,
      type: "model.output.delta",
      delta: "bar",
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "foobar",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "foobar");
});

test("live run buffer does not replace no-boundary live output with spaced replay", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "Hello",
    }),
    event({
      id: "run-1:live:model.output.delta:model-1:2",
      sequence: 2,
      type: "model.output.delta",
      delta: "World",
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "Hello ",
    }),
    event({
      id: "run-1:event:10:model.output.delta:2",
      sequence: 11,
      type: "model.output.delta",
      delta: "World",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "HelloWorld");
});

test("live run buffer keeps spaced live output when compact replay catches up without rewriting", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "The user is",
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "Theuser",
    }),
    event({
      id: "run-1:event:10:model.output.delta:2",
      sequence: 11,
      type: "model.output.delta",
      delta: "isasking",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "The user is");
});

test("live run buffer merges replay chunks that overlap already streamed text", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "abcdefghijklmnop",
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "abcdefghijkl",
    }),
    event({
      id: "run-1:event:10:model.output.delta:2",
      sequence: 11,
      type: "model.output.delta",
      delta: "ijklmnopqrstuvwxyz",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "abcdefghijklmnopqrstuvwxyz");
});

test("live run buffer preserves explicit output whitespace and punctuation", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "event-1",
      sequence: 1,
      type: "model.output.delta",
      delta: "Hello",
    }),
    event({
      id: "event-2",
      sequence: 2,
      type: "model.output.delta",
      delta: ", ",
    }),
    event({
      id: "event-3",
      sequence: 3,
      type: "model.output.delta",
      delta: "world",
    }),
    event({
      id: "event-4",
      sequence: 4,
      type: "model.output.delta",
      delta: "!",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "Hello, world!");
});

test("live run buffer treats completed replay reasoning as catch-up text", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.reasoning.delta:model-1:1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "先确认问题",
    }),
    event({
      id: "run-1:event:10:model.reasoning.delta:1",
      sequence: 10,
      type: "model.reasoning.delta",
      delta: "先确认问题",
    }),
  ]);

  assert.equal(buffer.turns[0]?.reasoning.text, "先确认问题");
});

test("live run buffer preserves repeated replay chunks when no live source exists", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "ha",
    }),
    event({
      id: "run-1:event:10:model.output.delta:2",
      sequence: 11,
      type: "model.output.delta",
      delta: "ha",
    }),
    event({
      id: "run-1:event:10:model.reasoning.delta:1",
      sequence: 12,
      type: "model.reasoning.delta",
      delta: "想",
    }),
    event({
      id: "run-1:event:10:model.reasoning.delta:2",
      sequence: 13,
      type: "model.reasoning.delta",
      delta: "想",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "haha");
  assert.equal(buffer.turns[0]?.reasoning.text, "想想");
});

test("live run buffer uses replay chunks to catch up incomplete live output", () => {
  const buffer = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    event({
      id: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "foo",
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "foo",
    }),
    event({
      id: "run-1:event:10:model.output.delta:2",
      sequence: 11,
      type: "model.output.delta",
      delta: "bar",
    }),
  ]);

  assert.equal(buffer.turns[0]?.output.text, "foobar");
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

  assert.equal(buffer.turns[0]?.output.text, "");
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
