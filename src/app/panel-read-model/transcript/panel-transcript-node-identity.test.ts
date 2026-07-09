import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeReplacingTranscriptNodeLists,
  mergeTranscriptNodeLists,
  mergeTranscriptNodes,
  sameTranscriptNodeIdentity,
} from "./panel-transcript-node-identity.js";

test("transcript node identity matches the same node id only within the same run", () => {
  assert.equal(sameTranscriptNodeIdentity(
    node({ nodeId: "node-1", runId: "run-1", kind: "tool", text: "same" }),
    node({ nodeId: "node-1", runId: "run-1", kind: "tool", text: "same" }),
  ), true);
  assert.equal(sameTranscriptNodeIdentity(
    node({ nodeId: "node-1", runId: "run-1", kind: "tool", text: "same" }),
    node({ nodeId: "node-1", runId: "run-2", kind: "tool", text: "same" }),
  ), false);
});

test("transcript node identity merges exact repeated model activity even when refs differ", () => {
  const left = node({
    nodeId: "thinking-live",
    kind: "thinking",
    text: "The user is asking me to demonstrate my capabilities.",
    refs: [{ kind: "model_call", id: "model-live" }],
  });
  const right = node({
    nodeId: "thinking-settled",
    sequence: 3,
    kind: "thinking",
    text: "The user is asking me to demonstrate my capabilities.",
    refs: [{ kind: "model_call", id: "model-settled" }],
  });

  assert.equal(sameTranscriptNodeIdentity(left, right), true);
});

test("transcript node identity merges extendable model activity when refs overlap", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "thinking-live",
      kind: "thinking",
      eventType: "model.reasoning.delta",
      phase: "noted",
      text: "The user is asking me to demonstrate capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ], [
    node({
      nodeId: "thinking-settled",
      sequence: 9,
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "The user is asking me to demonstrate capabilities and inspect the workspace.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "thinking-live");
  assert.equal(merged[0]?.sequence, 1);
  assert.equal(merged[0]?.eventType, "model.reasoning.completed");
  assert.equal(merged[0]?.phase, "completed");
  assert.equal(merged[0]?.text, "The user is asking me to demonstrate capabilities and inspect the workspace.");
});

test("transcript node identity merges repeated model activity even when refs conflict", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "thinking-1",
      kind: "thinking",
      text: "Plan the next step.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ], [
    node({
      nodeId: "thinking-2",
      sequence: 2,
      kind: "thinking",
      text: "Plan the next step carefully.",
      refs: [{ kind: "model_call", id: "model-2" }],
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["thinking-1"]);
  assert.equal(merged[0]?.text, "Plan the next step carefully.");
});

test("transcript node identity merges repeated thinking and side narration across node kinds", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "thinking-1",
      kind: "thinking",
      eventType: "model.reasoning.completed",
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ], [
    node({
      nodeId: "side-1",
      sequence: 3,
      kind: "system",
      eventType: "model.side.completed",
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-side" }],
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["thinking-1"]);
  assert.equal(merged[0]?.kind, "thinking");
});

test("transcript node identity never merges non-model nodes by text", () => {
  const merged = mergeTranscriptNodeLists([
    node({
      nodeId: "tool-1",
      kind: "tool",
      text: "README.md",
    }),
  ], [
    node({
      nodeId: "tool-2",
      sequence: 2,
      kind: "tool",
      text: "README.md",
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["tool-1", "tool-2"]);
});

test("transcript node identity merges body handoff only when model refs are compatible", () => {
  const merged = mergeReplacingTranscriptNodeLists([
    node({
      nodeId: "body-live",
      kind: "body",
      eventType: "model.output.delta",
      phase: "noted",
      text: "Let me showcase",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ], [
    node({
      nodeId: "body-settled",
      sequence: 5,
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      text: "Let me showcase my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);

  assert.deepEqual(merged.map((item) => item.nodeId), ["body-live"]);
  assert.equal(merged[0]?.text, "Let me showcase my capabilities.");
});

test("transcript node identity preserves previous model-side presentation when narration arrived first", () => {
  const merged = mergeTranscriptNodes(
    node({
      nodeId: "side-live",
      kind: "system",
      eventType: "model.output.side",
      phase: "completed",
      text: "I will inspect the workspace.",
    }),
    node({
      nodeId: "thinking-settled",
      sequence: 4,
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "I will inspect the workspace.",
    }),
  );

  assert.equal(merged.nodeId, "side-live");
  assert.equal(merged.kind, "system");
  assert.equal(merged.eventType, "model.output.side");
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
    eventType: input.eventType ?? "model.reasoning.completed",
    kind: input.kind,
    phase: input.phase ?? "completed",
    title: input.kind,
    summary: input.text,
    text: input.text,
    timestamp: "",
    refs: input.refs ?? [],
  };
}
