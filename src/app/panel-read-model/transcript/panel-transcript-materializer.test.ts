import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeConversationTranscript,
  stableTranscriptNodesByRunIdMap,
  transcriptNodesForRunId,
} from "./panel-transcript-materializer.js";

test("transcript materializer keeps previously rendered nodes during same-conversation cache gaps", () => {
  const previous = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [node("node-1", "run-1", 1)],
      "run-2": [node("node-2", "run-2", 2)],
    },
    currentRunNodes: [],
  });

  const next = materializeConversationTranscript({
    previous,
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-2": [node("node-2", "run-2", 2)],
    },
    currentRunNodes: [],
  });

  assert.deepEqual(next.nodesByRunId["run-1"]?.map((item) => item.nodeId), ["node-1"]);
  assert.deepEqual(next.nodesByRunId["run-2"]?.map((item) => item.nodeId), ["node-2"]);
});

test("transcript materializer resets sticky nodes when the conversation changes", () => {
  const previous = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [node("node-1", "run-1", 1)],
    },
    currentRunNodes: [],
  });

  const next = materializeConversationTranscript({
    previous,
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

test("transcript materializer reuses previous run node references when refreshed nodes are unchanged", () => {
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
  const next = materializeConversationTranscript({
    previous,
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
      ],
    },
    currentRunNodes: [],
  });

  assert.equal(next, previous);
  assert.equal(next.nodesByRunId["run-1"], previous.nodesByRunId["run-1"]);
  assert.equal(next.nodesByRunId["run-1"]?.[0], previousBody);
});

test("transcript materializer semantically merges sticky model nodes with new settled nodes", () => {
  const previous = materializeConversationTranscript({
    conversationId: "conversation-1",
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "thinking-live",
          runId: "run-1",
          sequence: 1,
          kind: "thinking",
          eventType: "model.reasoning.delta",
          text: "The user is asking me to demonstrate capabilities.",
          refs: [{ kind: "model_call", id: "model-1" }],
        }),
      ],
    },
    currentRunNodes: [],
  });
  const next = materializeConversationTranscript({
    previous,
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

  assert.deepEqual(next.nodesByRunId["run-1"]?.map((item) => item.nodeId), ["thinking-live"]);
  assert.equal(next.nodesByRunId["run-1"]?.[0]?.sequence, 1);
  assert.equal(next.nodesByRunId["run-1"]?.[0]?.text, "The user is asking me to demonstrate capabilities and inspect the workspace.");
});

test("transcript materializer merges cached and current thinking nodes for the same run around body output", () => {
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
  assert.deepEqual(nodes.map((item) => item.nodeId), ["thinking-live", "body-1"]);
  assert.equal(nodes.filter((item) => item.kind === "thinking").length, 1);
  assert.equal(nodes[0]?.eventType, "model.reasoning.completed");
  assert.equal(nodes[0]?.phase, "completed");
});

test("transcript materializer merges cached thinking and current side narration for the same model narrative", () => {
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
  assert.deepEqual(nodes.map((item) => item.nodeId), ["thinking-1"]);
  assert.equal(nodes.filter((item) => item.kind === "thinking" || item.kind === "system").length, 1);
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
