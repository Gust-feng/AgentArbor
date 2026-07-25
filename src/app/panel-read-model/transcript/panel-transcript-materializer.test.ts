import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeConversationTranscript,
  stableTranscriptNodesByRunIdMap,
  transcriptNodesForRunId,
} from "./panel-transcript-materializer.js";

test("transcript materializer projects only current canonical inputs during cache changes", () => {
  const next = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-2": [node("node-2", "run-2", 2)],
    },
    currentRunNodes: [],
  });

  assert.equal(next.nodesByRunId["run-1"], undefined);
  assert.deepEqual(next.nodesByRunId["run-2"]?.map((item) => item.nodeId), ["node-2"]);
});

test("transcript materializer isolates nodes when the conversation changes", () => {
  const next = materializeConversationTranscript({
    conversationId: "conversation-2",
    cachedNodesByRunId: {},
    currentRunNodes: [],
  });

  assert.deepEqual(next.nodesByRunId, {});
});

test("stable transcript map reuses array references for unchanged runs", () => {
  const original = node("node-1", "run-1", 1);
  const first = stableTranscriptNodesByRunIdMap(undefined, {
    "run-1": [original],
  });
  const second = stableTranscriptNodesByRunIdMap(first, {
    "run-1": [original],
  });

  assert.equal(second.get("run-1"), first.get("run-1"));
  assert.deepEqual(transcriptNodesForRunId(second, "run-1").map((item) => item.nodeId), ["node-1"]);
  assert.deepEqual(transcriptNodesForRunId(second, undefined), []);
});

test("transcript materializer never hides metadata-only node updates behind an old snapshot", () => {
  const previousBody = transcriptNode({
    nodeId: "body-1",
    runId: "run-1",
    sequence: 1,
    kind: "body",
    eventType: "model.output.completed",
    text: "第一段正文。",
  });
  const previous = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [previousBody],
    },
    currentRunNodes: [],
  });
  const nextBody = {
    ...previousBody,
    modelUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
  const next = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [nextBody],
    },
    currentRunNodes: [],
  });

  assert.notEqual(next, previous);
  assert.equal(next.nodesByRunId["run-1"]?.[0], nextBody);
  assert.deepEqual(next.nodesByRunId["run-1"]?.[0]?.modelUsage, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  });
});

test("transcript materializer replaces live reasoning with the durable fact by model_call identity", () => {
  const next = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "thinking-settled",
          runId: "run-1",
          sequence: 8,
          kind: "thinking",
          eventType: "model.reasoning.completed",
          text: "The user is asking me to demonstrate capabilities and inspect the workspace.",
          refs: [{ kind: "model_call", id: "model-1" }],
        }),
      ],
    },
    currentRunNodes: [],
  });

  assert.deepEqual(next.nodesByRunId["run-1"]?.map((item) => item.nodeId), ["thinking-settled"]);
  assert.equal(next.nodesByRunId["run-1"]?.[0]?.sequence, 8);
  assert.equal(next.nodesByRunId["run-1"]?.[0]?.text, "The user is asking me to demonstrate capabilities and inspect the workspace.");
});

test("transcript materializer preserves different model calls even when their thinking text matches", () => {
  const materialized = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "thinking-live",
          runId: "run-1",
          sequence: 1,
          kind: "thinking",
          eventType: "model.reasoning.delta",
          text: "The user is asking me to demonstrate my capabilities.",
          refs: [{ kind: "model_call", id: "model-live" }],
        }),
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 2,
          kind: "body",
          eventType: "model.output.completed",
          text: "Let me showcase my capabilities by exploring the workspace.",
        }),
      ],
    },
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "thinking-settled",
        runId: "run-1",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
    ],
  });

  const nodes = materialized.nodesByRunId["run-1"] ?? [];
  assert.deepEqual(nodes.map((item) => item.nodeId), ["thinking-live", "body-1", "thinking-settled"]);
  assert.equal(nodes.filter((item) => item.kind === "thinking").length, 2);
});

test("transcript materializer preserves reasoning and side narration as different fact types", () => {
  const materialized = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "thinking-1",
          runId: "run-1",
          sequence: 1,
          kind: "thinking",
          eventType: "model.reasoning.completed",
          text: "The user is asking me to demonstrate my capabilities.",
          refs: [{ kind: "model_call", id: "model-thinking" }],
        }),
      ],
    },
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "side-1",
        runId: "run-1",
        sequence: 3,
        kind: "system",
        eventType: "model.side.completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-side" }],
      }),
    ],
  });

  const nodes = materialized.nodesByRunId["run-1"] ?? [];
  assert.deepEqual(nodes.map((item) => item.nodeId), ["thinking-1", "side-1"]);
  assert.equal(nodes.filter((item) => item.kind === "thinking" || item.kind === "system").length, 2);
});

function node(nodeId: string, runId: string, sequence: number) {
  return {
    nodeId,
    runId,
    sequence,
  };
}

function transcriptNode(input: {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly eventType: string;
  readonly text: string;
  readonly refs?: readonly { readonly kind: string; readonly id: string }[];
}) {
  return {
    nodeId: input.nodeId,
    runId: input.runId,
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: "completed",
    title: input.kind,
    summary: input.text,
    text: input.text,
    timestamp: "",
    refs: input.refs ?? [],
  };
}
