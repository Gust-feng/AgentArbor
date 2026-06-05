import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../domain/basic-agent/index.js";
import { createPanelTranscriptNodes } from "./panel-transcript-nodes.js";
import {
  timelineVisibleNodes,
  visibleTranscriptNodes,
  workflowVisibleNodes,
} from "./panel-transcript-node-projection.js";
import {
  isRefreshingTranscriptRun,
  withStartupWorkflowNode,
} from "./panel-transcript-startup-node.js";

test("workflow projection preserves visible thinking even when the text looks like a progress placeholder", () => {
  const projected = workflowVisibleNodes([
    node({ nodeId: "thinking", kind: "thinking", sequence: 1, summary: "正在判断下一步。" }),
    node({ nodeId: "system", kind: "system", sequence: 2, summary: "正在判断下一步。" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking"]);
});

test("timeline projection keeps thinking and excludes answer nodes from the workflow rail", () => {
  const projected = timelineVisibleNodes([
    node({ nodeId: "answer", kind: "answer", eventType: "final.result", sequence: 4, summary: "最终回答" }),
    node({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.completed", sequence: 1, text: "先确认目标" }),
    node({ nodeId: "tool", kind: "tool", eventType: "tool.completed", phase: "completed", sequence: 3, toolName: "read_file", summary: "README.md" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking", "tool"]);
});

test("workflow projection keeps requested and completed tool phases as a full action record", () => {
  const projected = workflowVisibleNodes([
    node({
      nodeId: "request",
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      sequence: 1,
      toolName: "read_file",
      summary: "README.md",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      nodeId: "completed",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 2,
      toolName: "read_file",
      summary: "README.md",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["request", "completed"]);
});

test("timeline projection keeps requested and completed tool phases", () => {
  const projected = timelineVisibleNodes([
    node({
      nodeId: "request",
      kind: "tool",
      eventType: "tool.requested",
      phase: "executing",
      sequence: 1,
      toolName: "search",
      summary: "AgentArbor",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      nodeId: "completed",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 2,
      toolName: "search",
      summary: "AgentArbor",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["request", "completed"]);
});

test("visible transcript projection aggregates adjacent completed file reads without dropping other actions", () => {
  const projected = visibleTranscriptNodes([
    node({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.completed", sequence: 1, text: "先读关键文件" }),
    node({
      nodeId: "read-1",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 2,
      toolName: "read_file",
      display: { kind: "generic_tool_summary", action: "读取文件", items: ["file README.md"] },
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      nodeId: "read-2",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 3,
      toolName: "read_file",
      display: { kind: "generic_tool_summary", action: "读取文件", items: ["file package.json"] },
      refs: [{ kind: "tool_call", id: "tool-2" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking", "read-1"]);
  assert.equal(projected[1]?.summary, "2 个文件");
  assert.deepEqual(projected[1]?.display?.kind === "generic_tool_summary" ? projected[1].display.items : [], ["README.md", "package.json"]);
});

test("workflow projection hides preparing tool requests that are represented by confirmation cards", () => {
  const projected = workflowVisibleNodes([
    node({
      nodeId: "request",
      kind: "tool",
      eventType: "tool.requested",
      phase: "preparing",
      sequence: 1,
      toolName: "delete_file",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      nodeId: "confirmation",
      kind: "confirmation",
      eventType: "confirmation.needed",
      phase: "waiting_approval",
      sequence: 2,
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["confirmation"]);
});

test("visible transcript projection keeps preparing tool requests that explain a pending confirmation in details", () => {
  const projected = visibleTranscriptNodes([
    node({
      nodeId: "request",
      kind: "tool",
      eventType: "tool.requested",
      phase: "preparing",
      sequence: 1,
      toolName: "delete_file",
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
    node({
      nodeId: "confirmation",
      kind: "confirmation",
      eventType: "confirmation.needed",
      phase: "waiting_approval",
      sequence: 2,
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["request", "confirmation"]);
});

test("panel transcript confirmation ids fall back to the owning tool call id", () => {
  const projected = createPanelTranscriptNodes([
    {
      eventId: "run-1:event:1:tool.requested",
      runId: "run-1",
      sequence: 1,
      type: "tool.requested",
      createdAt: "2026-06-04T00:00:00.000Z",
      toolName: "shell_command",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: ["call-shell"],
    },
    {
      eventId: "run-1:event:2:confirmation.needed",
      runId: "run-1",
      sequence: 2,
      type: "confirmation.needed",
      createdAt: "2026-06-04T00:00:01.000Z",
      summary: "执行 Shell：pnpm test",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: ["call-shell"],
    },
  ]);

  const confirmation = projected.find((item) => item.kind === "confirmation");

  assert.equal(confirmation?.confirmation?.confirmationId, "confirmation-call-shell");
  assert.equal(confirmation?.confirmation?.actionSummary, "执行 Shell：pnpm test");
  assert.deepEqual(workflowVisibleNodes(projected).map((item) => item.kind), ["confirmation"]);
});

test("startup workflow projection stays silent before real transcript activity", () => {
  const projected = withStartupWorkflowNode([], {
    runId: "run-1",
    refreshing: true,
  });

  assert.equal(projected.length, 0);
  assert.equal(isRefreshingTranscriptRun({ runId: "run-1", status: "running" }), true);
  assert.equal(isRefreshingTranscriptRun({ runId: "run-1", status: "completed" }), false);
});

test("startup workflow projection keeps existing transcript activity", () => {
  const existing = node({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.delta", sequence: 1, text: "先看上下文" });
  const projected = withStartupWorkflowNode([existing], {
    runId: "run-1",
    refreshing: true,
  });

  assert.deepEqual(projected, [existing]);
});

function node(input: {
  readonly nodeId: string;
  readonly kind: TranscriptNode["kind"];
  readonly eventType?: string;
  readonly phase?: TranscriptNode["phase"];
  readonly sequence: number;
  readonly title?: string;
  readonly summary?: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly display?: TranscriptNode["display"];
  readonly refs?: TranscriptNode["refs"];
}): TranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence,
    eventType: input.eventType ?? "agent.note.completed",
    kind: input.kind,
    phase: input.phase ?? "completed",
    title: input.title ?? input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-06-04T00:00:00.000Z",
    toolName: input.toolName,
    display: input.display,
    refs: input.refs ?? [],
  };
}
