import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeReplacingTranscriptNodeLists,
  mergeTranscriptNodeLists,
  sameTranscriptNodeIdentity,
  transcriptNodeIdentityKey,
} from "./panel-transcript-node-identity.js";

test("transcript identity is scoped to one run", () => {
  assert.equal(sameTranscriptNodeIdentity(
    node({ nodeId: "node-1", runId: "run-1", kind: "tool" }),
    node({ nodeId: "node-1", runId: "run-1", kind: "tool" }),
  ), true);
  assert.equal(sameTranscriptNodeIdentity(
    node({ nodeId: "node-1", runId: "run-1", kind: "tool" }),
    node({ nodeId: "node-1", runId: "run-2", kind: "tool" }),
  ), false);
});

test("reasoning identity uses model_call and terminal durable content replaces live content", () => {
  const live = node({
    nodeId: "reasoning-live",
    kind: "thinking",
    eventType: "model.reasoning.delta",
    phase: "noted",
    text: "短思考",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const durable = node({
    nodeId: "reasoning-durable",
    sequence: 8,
    kind: "thinking",
    eventType: "model.reasoning.completed",
    phase: "completed",
    text: "权威完整思考",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const merged = mergeTranscriptNodeLists([live], [durable]);

  assert.equal(transcriptNodeIdentityKey(live), "run-1:reasoning:model-1");
  assert.deepEqual(merged.map((item) => item.nodeId), ["reasoning-durable"]);
  assert.equal(merged[0]?.text, "权威完整思考");
});

test("identical text from different model calls remains distinct", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "reasoning-1",
      kind: "thinking",
      text: "相同文本",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ], [
    node({
      nodeId: "reasoning-2",
      sequence: 2,
      kind: "thinking",
      text: "相同文本",
      refs: [{ kind: "model_call", id: "model-2" }],
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["reasoning-1", "reasoning-2"]);
});

test("reasoning and side narration remain distinct even for the same model call and text", () => {
  const reasoning = node({
    nodeId: "reasoning-1",
    kind: "thinking",
    text: "相同文本",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const narration = node({
    nodeId: "side-1",
    sequence: 2,
    kind: "system",
    eventType: "model.side.completed",
    text: "相同文本",
    refs: [{ kind: "model_call", id: "model-1" }],
  });

  assert.equal(sameTranscriptNodeIdentity(reasoning, narration), false);
  assert.deepEqual(mergeTranscriptNodeLists([reasoning], [narration]).map((item) => item.nodeId), [
    "reasoning-1",
    "side-1",
  ]);
});

test("body reconciles by model_call while tool active and terminal facts remain distinct", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "body-live",
      kind: "body",
      eventType: "model.output.delta",
      phase: "noted",
      text: "输出中",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "tool-requested",
      sequence: 3,
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      refs: [{ kind: "tool_call", id: "tool-call-1" }],
    }),
  ], [
    node({
      nodeId: "body-durable",
      sequence: 2,
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      text: "完整输出",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "tool-completed",
      sequence: 4,
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      refs: [{ kind: "tool_call", id: "tool-call-1" }],
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["body-durable", "tool-requested", "tool-completed"]);
});

test("replacing merge does not retain facts absent from the current canonical input", () => {
  const merged = mergeReplacingTranscriptNodeLists(
    [node({ nodeId: "stale", kind: "system" })],
    [node({ nodeId: "current", kind: "system" })],
  );
  assert.deepEqual(merged.map((item) => item.nodeId), ["current"]);
});

function node(input: {
  readonly nodeId: string;
  readonly runId?: string;
  readonly sequence?: number;
  readonly kind: string;
  readonly eventType?: string;
  readonly phase?: string;
  readonly text?: string;
  readonly refs?: readonly { readonly kind: string; readonly id: string }[];
}) {
  return {
    nodeId: input.nodeId,
    runId: input.runId ?? "run-1",
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "test.event",
    kind: input.kind,
    phase: input.phase ?? "completed",
    title: input.kind,
    summary: input.text,
    text: input.text,
    timestamp: "",
    refs: input.refs ?? [],
  };
}
