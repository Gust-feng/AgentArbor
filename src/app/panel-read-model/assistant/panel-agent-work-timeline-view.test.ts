import assert from "node:assert/strict";
import test from "node:test";
import { projectAgentWorkTimelineView } from "./panel-agent-work-timeline-view.js";
import type { ProjectableTranscriptNode } from "../transcript/panel-transcript-node-projection.js";

test("agent work timeline view projects items and current confirmation outside React", () => {
  const pending = { confirmationId: "confirmation-1", runId: "run-1" };
  const view = projectAgentWorkTimelineView({
    nodes: [
      node({
        nodeId: "thinking-1",
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断目标",
      }),
      node({
        nodeId: "confirmation-node",
        kind: "confirmation",
        eventType: "confirmation.needed",
        phase: "waiting_approval",
        summary: "需要确认",
        confirmation: pending,
      }),
    ],
    pending,
  });

  assert.equal(view.hasContent, true);
  assert.equal(view.confirmation.current?.confirmationId, "confirmation-1");
  assert.equal(view.confirmation.currentNodeId, "confirmation-node");
  assert.deepEqual(view.items.map((item) => item.nodeId), ["thinking-1"]);
});

test("agent work timeline view hides low-value answer nodes", () => {
  const view = projectAgentWorkTimelineView({
    nodes: [
      node({
        nodeId: "answer-1",
        kind: "answer",
        eventType: "final.result",
        phase: "completed",
        summary: "已回答：最终结果",
      }),
    ],
  });

  assert.equal(view.hasContent, false);
  assert.deepEqual(view.items, []);
});

test("agent work timeline view does not show historical confirmations as pending activity", () => {
  const view = projectAgentWorkTimelineView({
    nodes: [
      node({
        nodeId: "confirmation-node",
        kind: "confirmation",
        eventType: "confirmation.needed",
        phase: "waiting_approval",
        summary: "运行命令：python 3",
        confirmation: { confirmationId: "confirmation-call-command", runId: "run-1" },
        refs: [{ kind: "tool_call", id: "call-command" }],
      }),
      node({
        nodeId: "tool-failed",
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "python 3 · Sandbox policy rejected command.",
        toolName: "shell_command",
        refs: [{ kind: "tool_call", id: "call-command" }],
      }),
    ],
  });

  assert.equal(view.confirmation.current, undefined);
  assert.equal(view.items.some((item) => item.tone === "confirmation" || item.copy.label === "待处理"), false);
  assert.deepEqual(view.items.map((item) => item.nodeId), ["tool-failed"]);
});

function node(input: {
  readonly nodeId: string;
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly toolName?: string;
  readonly confirmation?: ProjectableTranscriptNode["confirmation"];
  readonly refs?: ProjectableTranscriptNode["refs"];
}): ProjectableTranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.nodeId === "answer-1" ? 3 : 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    toolName: input.toolName,
    confirmation: input.confirmation,
    timestamp: "2026-06-04T00:00:00.000Z",
    refs: input.refs ?? [],
  };
}
