import { expect, test } from "vitest";
import type { ToolCallResult } from "../../../domain/tools";
import type { ActivityItem } from "../../panel-read-model/transcript/panel-transcript-activity-copy";
import type { TranscriptNode } from "./contracts/run";
import { toolResultForActivity } from "./tool-result-association";

test("associates repeated tool calls by run and tool fact identity", () => {
  const nodes = [
    node("run-1", "node-1", "fact-1"),
    node("run-1", "node-2", "fact-2"),
    node("run-2", "node-3", "fact-1"),
  ];
  const results = {
    "run-1": [result("call-1", "fact-1", "first"), result("call-2", "fact-2", "second")],
    "run-2": [result("call-3", "fact-1", "other run")],
  };

  expect(toolResultForActivity(item("node-2", "fact-2"), nodes, results)?.output).toBe("second");
  expect(toolResultForActivity(item("node-3", "fact-1"), nodes, results)?.output).toBe("other run");
});

function item(nodeId: string, toolCallFactId: string): ActivityItem {
  return {
    nodeId,
    key: nodeId,
    eventType: "tool.completed",
    toolCallFactId,
    copy: { detail: "Shell" },
    tone: "tool",
    phase: "completed",
  };
}

function node(runId: string, nodeId: string, factId: string): TranscriptNode {
  return {
    nodeId,
    runId,
    sequence: 1,
    eventType: "tool.completed",
    kind: "tool",
    phase: "completed",
    title: "Shell",
    timestamp: "2026-07-31T00:00:00.000Z",
    refs: [{ kind: "tool_call", id: factId }],
  };
}

function result(callId: string, factId: string, output: string): ToolCallResult {
  return {
    callId,
    factId,
    toolName: "Shell",
    input: undefined,
    output,
    status: "completed",
    durationMs: 1,
  };
}
