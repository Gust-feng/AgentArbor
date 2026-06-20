import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "../../domain/basic-agent/contracts.js";
import { transcriptNodesFromRunEvents } from "./work-session-transcript.js";

test("work session transcript keeps one reasoning node and one deduplicated body across replay catch-up", () => {
  const nodes = transcriptNodesFromRunEvents([
    event({
      id: "run-1:live:model.reasoning.delta:model-1:1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "Now",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:live:model.reasoning.delta:model-1:2",
      sequence: 2,
      type: "model.reasoning.delta",
      delta: " let",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:live:model.output.delta:model-1:3",
      sequence: 3,
      type: "model.output.delta",
      delta: "先",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:live:model.output.delta:model-1:4",
      sequence: 4,
      type: "model.output.delta",
      delta: "说明",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:event:10:model.reasoning.delta:1",
      sequence: 10,
      type: "model.reasoning.delta",
      delta: "Now let me read files.",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:event:10:model.reasoning.completed",
      sequence: 11,
      type: "model.reasoning.completed",
      summary: "Now let me read files.",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:event:10:model.output.delta:1",
      sequence: 12,
      type: "model.output.delta",
      delta: "先说明",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:event:10:model.output.completed",
      sequence: 13,
      type: "model.output.completed",
      summary: "内容已整理。",
      modelCallRefs: ["model-1"],
    }),
    event({
      id: "run-1:event:11:tool.requested",
      sequence: 14,
      type: "tool.requested",
      modelCallRefs: ["model-1"],
      toolCallRefs: ["tool-1"],
    }),
  ], undefined);

  const thinking = nodes.filter((node) => node.kind === "thinking");
  const body = nodes.find((node) => node.kind === "body");

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking[0]?.text, "Now let me read files.");
  assert.equal(body?.text, "先说明");
});

test("work session transcript drops generic processing notes", () => {
  const nodes = transcriptNodesFromRunEvents([
    event({
      id: "run-1:event:1:agent.note.completed",
      sequence: 1,
      type: "agent.note.completed",
      summary: "任务处理中。",
    }),
    event({
      id: "run-1:event:2:agent.note.completed",
      sequence: 2,
      type: "agent.note.completed",
      summary: "正在整理结果。",
    }),
  ], undefined);

  assert.deepEqual(nodes, []);
});

function event(input: {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly modelCallRefs?: readonly string[];
  readonly toolCallRefs?: readonly string[];
}): RunEvent {
  return {
    id: input.id,
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    title: input.type,
    summary: input.summary,
    delta: input.delta,
    status: "running",
    timestamp: "2026-06-17T00:00:00.000Z",
    refs: [
      ...(input.modelCallRefs ?? []).map((id) => ({ kind: "model_call", id } as const)),
      ...(input.toolCallRefs ?? []).map((id) => ({ kind: "tool_call", id } as const)),
    ],
    visibility: "compact",
  };
}
