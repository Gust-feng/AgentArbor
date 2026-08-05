import { beforeEach, expect, test, vi } from "vitest";
import type { ToolCallResult } from "../../../domain/tools";
import type { TranscriptNode } from "./contracts/run";
import {
  getTranscriptCache,
  resetTranscriptCache,
  subscribeTranscriptCache,
  transcriptNodesCacheForConversation,
  transcriptToolResultsCacheForConversation,
  updateTranscriptRunCache,
} from "./panel-ui-transcript-store";

beforeEach(() => resetTranscriptCache());

test("transcript cache publishes nodes and canonical tool results as one run snapshot", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeTranscriptCache("conversation-1", listener);
  const nodes = [transcriptNode("run-1", "node-1", "tool-fact-1")];
  const results = [toolResult("tool-fact-1", "first output")];

  updateTranscriptRunCache("conversation-1", {
    nodesByRunId: { "run-1": nodes },
    toolResultsByRunId: { "run-1": results },
  });

  const snapshot = getTranscriptCache();
  expect(transcriptNodesCacheForConversation(snapshot, "conversation-1")["run-1"]).toBe(nodes);
  expect(transcriptToolResultsCacheForConversation(snapshot, "conversation-1")["run-1"]).toBe(results);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test("transcript cache keeps same-tool results isolated by run and fact identity", () => {
  updateTranscriptRunCache("conversation-1", {
    toolResultsByRunId: {
      "run-1": [toolResult("tool-fact-1", "first output")],
      "run-2": [toolResult("tool-fact-2", "second output")],
    },
  });

  const results = transcriptToolResultsCacheForConversation(getTranscriptCache(), "conversation-1");
  expect(results["run-1"]?.[0]?.output).toBe("first output");
  expect(results["run-2"]?.[0]?.output).toBe("second output");
});

test("transcript cache releases one conversation without touching another", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeTranscriptCache("conversation-1", listener);
  const nodes = [transcriptNode("run-1", "node-1", "tool-fact-1")];
  updateTranscriptRunCache("conversation-1", { nodesByRunId: { "run-1": nodes } });
  updateTranscriptRunCache("conversation-2", { nodesByRunId: { "run-2": nodes } });

  resetTranscriptCache("conversation-1");

  const snapshot = getTranscriptCache();
  expect(transcriptNodesCacheForConversation(snapshot, "conversation-1")).toEqual({});
  expect(transcriptNodesCacheForConversation(snapshot, "conversation-2")["run-2"]).toBe(nodes);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

function transcriptNode(runId: string, nodeId: string, factId: string): TranscriptNode {
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

function toolResult(factId: string, output: string): ToolCallResult {
  return {
    callId: "provider-call",
    factId,
    toolName: "Shell",
    input: { command: "echo test" },
    output,
    status: "completed",
    durationMs: 10,
  };
}
