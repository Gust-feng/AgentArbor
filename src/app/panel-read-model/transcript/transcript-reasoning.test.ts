import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../../domain/observation/index.js";
import {
  completeOpenReasoningNodes,
  flushPendingReasoningNode,
  isReasoningTranscriptEvent,
  settlePendingReasoningNode,
  updatePendingReasoningNode,
  type PendingReasoningNode,
  type ReasoningTranscriptEvent,
} from "./transcript-reasoning.js";

test("reasoning transcript helper merges deltas and completes on matching completion", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  for (const event of [
    reasoningEvent("event-1", "model.reasoning.delta", "先", ["model-1"]),
    reasoningEvent("event-2", "model.reasoning.delta", "分析", ["model-1"]),
    reasoningEvent("event-3", "model.reasoning.completed", undefined, ["model-1"]),
  ]) {
    assert.equal(isReasoningTranscriptEvent(event), true);
    pending = updatePendingReasoningNode(pending, event, nodes, summary, nodeFactory);
  }

  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.phase, "completed");
  assert.equal(nodes[0]?.text, "先分析");
  assert.deepEqual(nodes[0]?.refs.map((ref) => `${ref.kind}:${ref.id}`), ["model_call:model-1", "event:event-1", "event:event-2", "event:event-3"]);
});

test("reasoning transcript helper preserves explicit word boundaries", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("event-1", "model.reasoning.delta", "Check", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-2", "model.reasoning.delta", " files", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-3", "model.reasoning.delta", ".", ["model-1"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes[0]?.text, "Check files.");
});

test("reasoning transcript helper preserves provider whitespace at fragment boundaries", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("event-1", "model.reasoning.delta", " The", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-2", "model.reasoning.delta", " user", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-3", "model.reasoning.delta", "\nsaid hello. ", ["model-1"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes[0]?.text, " The user\nsaid hello. ");
});

test("reasoning transcript helper preserves exact word deltas without inserted spaces", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("event-1", "model.reasoning.delta", "The", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-2", "model.reasoning.delta", "user", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-3", "model.reasoning.delta", "asked", ["model-1"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes[0]?.text, "Theuserasked");
});

test("reasoning transcript helper preserves repeated live suffix deltas", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("run-1:live:model.reasoning.delta:model-1:1", "model.reasoning.delta", "想", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("run-1:live:model.reasoning.delta:model-1:2", "model.reasoning.delta", "想", ["model-1"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes[0]?.text, "想想");
});

test("reasoning transcript helper keeps different model calls separate", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("event-1", "model.reasoning.delta", "A", ["model-a"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-2", "model.reasoning.delta", "B", ["model-b"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.text, "A");
  assert.equal(nodes[1]?.text, "B");
  assert.equal(nodes[0]?.eventType, "model.reasoning.delta");
  assert.equal(nodes[1]?.eventType, "model.reasoning.delta");
});

test("reasoning transcript helper settles open node on matching non-reasoning event", () => {
  const nodes: TranscriptNode[] = [];
  let pending = updatePendingReasoningNode(
    undefined,
    reasoningEvent("event-1", "model.reasoning.delta", "待完成", ["model-1"]),
    nodes,
    summary,
    nodeFactory
  );
  pending = settlePendingReasoningNode(pending, nonReasoningEvent("event-2", ["model-1"]));
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.phase, "completed");
});

test("reasoning transcript helper completes an existing live node without replaying text", () => {
  const nodes: TranscriptNode[] = [];
  let pending = updatePendingReasoningNode(
    undefined,
    reasoningEvent("event-1", "model.reasoning.delta", "已有", ["model-1"]),
    nodes,
    summary,
    nodeFactory
  );
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);
  pending = undefined;

  pending = updatePendingReasoningNode(
    pending,
    reasoningEvent("event-2", "model.reasoning.completed", "已有", ["model-1"]),
    nodes,
    summary,
    nodeFactory
  );

  assert.equal(pending, undefined);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.text, "已有");
});

test("reasoning transcript helper treats replayed full reasoning as catch-up text", () => {
  const nodes: TranscriptNode[] = [];
  let pending: PendingReasoningNode | undefined;

  pending = updatePendingReasoningNode(pending, reasoningEvent("run-1:live:model.reasoning.delta:model-1:1", "model.reasoning.delta", "先确认问题", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("run-1:event:10:model.reasoning.delta:1", "model.reasoning.delta", "先确认问题", ["model-1"]), nodes, summary, nodeFactory);
  pending = updatePendingReasoningNode(pending, reasoningEvent("event-3", "model.reasoning.completed", undefined, ["model-1"]), nodes, summary, nodeFactory);
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.text, "先确认问题");
});

test("reasoning transcript helper completes open nodes after output settles", () => {
  const nodes: TranscriptNode[] = [];
  const pending = updatePendingReasoningNode(
    undefined,
    reasoningEvent("event-1", "model.reasoning.delta", "开放", ["model-1"]),
    nodes,
    summary,
    nodeFactory
  );
  flushPendingReasoningNode(pending, nodes, summary, nodeFactory);

  completeOpenReasoningNodes(nodes, nonReasoningEvent("event-2", ["model-1"]), summary);

  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.phase, "completed");
});

function reasoningEvent(
  id: string,
  type: "model.reasoning.delta" | "model.reasoning.completed",
  delta: string | undefined,
  modelCallRefs: readonly string[]
): ReasoningTranscriptEvent & { readonly type: "model.reasoning.delta" | "model.reasoning.completed" } {
  const refs: ObservationRef[] = [
    ...modelCallRefs.map((modelCallRef) => ({ kind: "model_call" as const, id: modelCallRef })),
    { kind: "event", id },
  ];
  return {
    id,
    runId: "run-1",
    sequence: Number(id.replace(/\D/g, "")),
    type,
    timestamp: "2026-05-31T00:00:00.000Z",
    delta,
    refs,
    modelCallRefs,
  };
}

function nonReasoningEvent(id: string, modelCallRefs: readonly string[]): ReasoningTranscriptEvent {
  return {
    id,
    runId: "run-1",
    sequence: Number(id.replace(/\D/g, "")),
    type: "model.output.completed",
    timestamp: "2026-05-31T00:00:00.000Z",
    refs: modelCallRefs.map((modelCallRef) => ({ kind: "model_call" as const, id: modelCallRef })),
    modelCallRefs,
  };
}

function summary(text: string): string {
  return text.length <= 8 ? text : `${text.slice(0, 7)}…`;
}

function nodeFactory(input: {
  readonly firstEvent: ReasoningTranscriptEvent;
  readonly text: string;
  readonly completed: boolean;
  readonly summary: string;
  readonly eventType: "model.reasoning.delta" | "model.reasoning.completed";
  readonly refs: readonly ObservationRef[];
}): TranscriptNode {
  return {
    nodeId: `${input.firstEvent.id}:reasoning-node`,
    runId: input.firstEvent.runId,
    sequence: input.firstEvent.sequence,
    eventType: input.eventType,
    kind: "thinking",
    phase: input.completed ? "completed" : "noted",
    title: "",
    summary: input.summary,
    text: input.text,
    timestamp: input.firstEvent.timestamp,
    refs: input.refs,
  };
}
