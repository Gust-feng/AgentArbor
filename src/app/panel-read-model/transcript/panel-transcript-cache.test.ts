import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeTranscriptNodesByRunId,
  resetConversationTranscriptNodes,
  transcriptNodesByRunIdForConversation,
  transcriptNodesForConversation,
  updateConversationTranscriptNodes,
} from "./panel-transcript-cache.js";

type TestNode = {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly text: string;
};

test("transcript cache keeps completed run nodes when a later run becomes active", () => {
  const firstRun = mergeTranscriptNodesByRunId({}, "run-1", [
    node("run-1:thinking", "run-1", 1, "上一轮思考"),
    node("run-1:answer", "run-1", 2, "上一轮回答"),
  ]);
  const bothRuns = mergeTranscriptNodesByRunId(firstRun, "run-2", [
    node("run-2:thinking", "run-2", 1, "下一轮思考"),
  ]);

  const visible = transcriptNodesForConversation([
    { role: "user" },
    { role: "assistant", runId: "run-1" },
    { role: "user" },
    { role: "assistant", runId: "run-2" },
  ], bothRuns);

  assert.deepEqual(visible.map((item) => item.text), [
    "上一轮思考",
    "上一轮回答",
    "下一轮思考",
  ]);
});

test("transcript cache replaces only the targeted active run", () => {
  const cached = {
    "run-1": [node("run-1:thinking", "run-1", 1, "保留")],
    "run-2": [node("run-2:thinking", "run-2", 1, "旧内容")],
  };
  const updated = mergeTranscriptNodesByRunId(cached, "run-2", [
    node("run-2:thinking", "run-2", 1, "新内容"),
  ]);

  assert.equal(updated["run-1"]?.[0]?.text, "保留");
  assert.equal(updated["run-2"]?.[0]?.text, "新内容");
});

test("conversation transcript cache keeps the previous conversation readable before a new conversation fills", () => {
  const first = updateConversationTranscriptNodes({}, "conversation-a", {
    "run-a": [node("run-a:answer", "run-a", 1, "A 的历史")],
  });

  assert.deepEqual(
    transcriptNodesByRunIdForConversation(first, "conversation-a")["run-a"]?.map((item) => item.text),
    ["A 的历史"],
  );
  assert.deepEqual(transcriptNodesByRunIdForConversation(first, "conversation-b"), {});
  assert.deepEqual(
    transcriptNodesByRunIdForConversation(first, "conversation-a")["run-a"]?.map((item) => item.text),
    ["A 的历史"],
  );
});

test("conversation transcript cache updates one conversation without polluting another", () => {
  const first = updateConversationTranscriptNodes({}, "conversation-a", {
    "run-a": [node("run-a:answer", "run-a", 1, "A 的历史")],
  });
  const second = updateConversationTranscriptNodes(first, "conversation-b", {
    "run-b": [node("run-b:answer", "run-b", 1, "B 的历史")],
  });
  const updated = updateConversationTranscriptNodes(second, "conversation-a", {
    "run-a": [node("run-a:answer", "run-a", 1, "A 的更新")],
  });

  assert.deepEqual(
    transcriptNodesByRunIdForConversation(updated, "conversation-a")["run-a"]?.map((item) => item.text),
    ["A 的更新"],
  );
  assert.deepEqual(
    transcriptNodesByRunIdForConversation(updated, "conversation-b")["run-b"]?.map((item) => item.text),
    ["B 的历史"],
  );
});

test("conversation transcript cache reset removes only the selected conversation", () => {
  const cached = updateConversationTranscriptNodes(
    updateConversationTranscriptNodes({}, "conversation-a", {
      "run-a": [node("run-a:answer", "run-a", 1, "A 的历史")],
    }),
    "conversation-b",
    {
      "run-b": [node("run-b:answer", "run-b", 1, "B 的历史")],
    },
  );
  const reset = resetConversationTranscriptNodes(cached, "conversation-a");

  assert.deepEqual(transcriptNodesByRunIdForConversation(reset, "conversation-a"), {});
  assert.deepEqual(
    transcriptNodesByRunIdForConversation(reset, "conversation-b")["run-b"]?.map((item) => item.text),
    ["B 的历史"],
  );
});

test("transcript cache merges live and settled reasoning with different node ids", () => {
  const cached = mergeTranscriptNodesByRunId({}, "run-1", [
    transcriptNode({
      nodeId: "run-1:live:model-1:thinking",
      runId: "run-1",
      sequence: 1,
      kind: "thinking",
      eventType: "model.reasoning.delta",
      phase: "noted",
      text: "The user is asking me to demonstrate capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);
  const updated = mergeTranscriptNodesByRunId(cached, "run-1", [
    transcriptNode({
      nodeId: "run-1:event:9:model.reasoning.completed",
      runId: "run-1",
      sequence: 9,
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "The user is asking me to demonstrate capabilities and inspect the workspace.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);

  assert.equal(updated["run-1"]?.length, 1);
  // 终态事实保留权威内容，身份槽与序列保持首次出现的流式节点。
  assert.equal(updated["run-1"]?.[0]?.nodeId, "run-1:live:model-1:thinking");
  assert.equal(updated["run-1"]?.[0]?.sequence, 1);
  assert.equal(updated["run-1"]?.[0]?.text, "The user is asking me to demonstrate capabilities and inspect the workspace.");
});

test("transcript cache replaces the current run snapshot instead of matching display text", () => {
  const cached = mergeTranscriptNodesByRunId({}, "run-1", [
    transcriptNode({
      nodeId: "thinking-live",
      runId: "run-1",
      sequence: 1,
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-live" }],
    }),
  ]);
  const updated = mergeTranscriptNodesByRunId(cached, "run-1", [
    transcriptNode({
      nodeId: "thinking-settled",
      runId: "run-1",
      sequence: 3,
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-settled" }],
    }),
  ]);

  assert.deepEqual(updated["run-1"]?.map((item) => item.nodeId), ["thinking-settled"]);
});

test("transcript cache merges live and settled body nodes with different ids", () => {
  const cached = mergeTranscriptNodesByRunId({}, "run-1", [
    transcriptNode({
      nodeId: "body-live",
      runId: "run-1",
      sequence: 2,
      kind: "body",
      eventType: "model.output.delta",
      phase: "noted",
      text: "Let me showcase",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);
  const updated = mergeTranscriptNodesByRunId(cached, "run-1", [
    transcriptNode({
      nodeId: "body-settled",
      runId: "run-1",
      sequence: 5,
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      text: "Let me showcase my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
  ]);

  assert.deepEqual(updated["run-1"]?.map((item) => item.nodeId), ["body-live"]);
  assert.equal(updated["run-1"]?.[0]?.text, "Let me showcase my capabilities.");
  assert.equal(updated["run-1"]?.[0]?.sequence, 2);
});

function node(nodeId: string, runId: string, sequence: number, text: string): TestNode {
  return { nodeId, runId, sequence, text };
}

function transcriptNode(input: {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly eventType: string;
  readonly phase: string;
  readonly text: string;
  readonly refs?: readonly { readonly kind: string; readonly id: string }[];
}) {
  return {
    nodeId: input.nodeId,
    runId: input.runId,
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    summary: input.text,
    text: input.text,
    timestamp: "",
    refs: input.refs ?? [],
  };
}
