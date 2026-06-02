import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeTranscriptNodesByRunId,
  transcriptNodesForConversation,
} from "./panel-ui-transcript-cache.js";

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

function node(nodeId: string, runId: string, sequence: number, text: string): TestNode {
  return { nodeId, runId, sequence, text };
}
