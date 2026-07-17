import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../../../domain/basic-agent/index.js";
import {
  activityVisibleNodes,
  timelineVisibleNodes,
  visibleTranscriptNodes,
} from "./panel-transcript-node-projection.js";

test("activity projection keeps raw model activity available to the lower-level projection", () => {
  const projected = activityVisibleNodes([
    node({ nodeId: "thinking", kind: "thinking", sequence: 1, summary: "正在判断下一步。" }),
    node({ nodeId: "system", kind: "system", sequence: 2, summary: "正在判断下一步。" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking"]);
});

test("timeline projection keeps settled model activity and tools while excluding answer bodies", () => {
  const projected = timelineVisibleNodes([
    node({ nodeId: "answer", kind: "answer", eventType: "final.result", sequence: 5, summary: "最终回答" }),
    node({ nodeId: "body", kind: "body", eventType: "model.output.completed", sequence: 4, text: "正文" }),
    node({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.completed", sequence: 1, text: "先确认目标" }),
    node({ nodeId: "side-output", kind: "system", eventType: "model.output.side", sequence: 2, text: "准备读取项目说明" }),
    node({ nodeId: "tool", kind: "tool", eventType: "tool.completed", phase: "completed", sequence: 3, toolName: "read_file", summary: "README.md" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking", "side-output", "tool"]);
});

test("timeline projection keeps runtime model activity through the live-to-settled handoff", () => {
  const live = timelineVisibleNodes([
    node({ nodeId: "thinking-live", kind: "thinking", eventType: "model.reasoning.delta", phase: "noted", sequence: 1, text: "先分析目标" }),
    node({ nodeId: "side-live", kind: "system", eventType: "model.output.side", sequence: 2, text: "准备检查约束" }),
  ]);
  const settled = timelineVisibleNodes([
    node({ nodeId: "thinking-settled", kind: "thinking", eventType: "model.reasoning.completed", phase: "completed", sequence: 1, text: "先分析目标" }),
    node({ nodeId: "side-settled", kind: "system", eventType: "model.side.completed", phase: "completed", sequence: 2, text: "准备检查约束" }),
  ]);

  assert.deepEqual(live.map((item) => item.nodeId), ["thinking-live", "side-live"]);
  assert.deepEqual(settled.map((item) => item.nodeId), ["thinking-settled", "side-settled"]);
});

test("activity projection deduplicates raw model activity while keeping the earlier position", () => {
  const projected = activityVisibleNodes([
    node({
      nodeId: "thinking-live",
      kind: "thinking",
      eventType: "model.reasoning.delta",
      phase: "noted",
      sequence: 1,
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "body-1",
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      sequence: 2,
      text: "Let me showcase my capabilities by exploring the workspace.",
    }),
    node({
      nodeId: "thinking-settled",
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      sequence: 3,
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "tool-1",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 4,
      summary: "README.md",
    }),
  ]);

  const thinking = projected.filter((item) => item.kind === "thinking");

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.nodeId, "thinking-live");
  assert.equal(thinking[0]?.phase, "completed");
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking-live", "body-1", "tool-1"]);
});

test("activity projection deduplicates exact raw model activity even when model refs differ", () => {
  const projected = activityVisibleNodes([
    node({
      nodeId: "thinking-live",
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      sequence: 1,
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-live" }],
    }),
    node({
      nodeId: "body-1",
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      sequence: 2,
      text: "Let me showcase my capabilities by exploring the workspace.",
    }),
    node({
      nodeId: "thinking-settled",
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      sequence: 3,
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-settled" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking-live", "body-1"]);
});

test("activity projection deduplicates repeated raw model activity across thinking and narration", () => {
  const projected = activityVisibleNodes([
    node({
      nodeId: "thinking-1",
      kind: "thinking",
      eventType: "model.reasoning.completed",
      phase: "completed",
      sequence: 1,
      text: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "body-1",
      kind: "body",
      eventType: "model.output.completed",
      phase: "completed",
      sequence: 2,
      text: "Let me showcase my capabilities by exploring the workspace.",
    }),
    node({
      nodeId: "side-1",
      kind: "system",
      eventType: "model.side.completed",
      phase: "completed",
      sequence: 3,
      text: "The user is asking me to demonstrate my capabilities.",
      summary: "The user is asking me to demonstrate my capabilities.",
      refs: [{ kind: "model_call", id: "model-1" }],
    }),
    node({
      nodeId: "tool-1",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 4,
      summary: "README.md",
    }),
  ]);

  const modelActivity = projected.filter((item) => item.kind === "thinking" || item.kind === "system");

  assert.equal(modelActivity.length, 1);
  assert.equal(modelActivity[0]?.nodeId, "thinking-1");
  assert.equal(modelActivity[0]?.kind, "thinking");
  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking-1", "body-1", "tool-1"]);
});

test("activity projection keeps requested and completed tool phases as a full action record", () => {
  const projected = activityVisibleNodes([
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

test("activity projection hides preparing tool requests that are represented by confirmation cards", () => {
  const projected = activityVisibleNodes([
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

test("activity projection hides generic approved decisions but keeps real user decisions", () => {
  const projected = activityVisibleNodes([
    node({
      nodeId: "approved",
      kind: "user_decision",
      eventType: "run.resumed",
      phase: "approved",
      sequence: 1,
      summary: "继续处理。",
    }),
    node({
      nodeId: "denied",
      kind: "user_decision",
      eventType: "user_approval.received",
      phase: "denied",
      sequence: 2,
      summary: "已不执行。",
    }),
    node({
      nodeId: "guidance",
      kind: "user_decision",
      eventType: "user.guidance",
      phase: "guidance",
      sequence: 3,
      summary: "只列出路径，不删除。",
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["denied", "guidance"]);
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

test("visible transcript keeps context compaction events when they carry real status", () => {
  const requested = visibleTranscriptNodes([
    node({
      nodeId: "compaction-requested",
      kind: "system",
      eventType: "context.compaction.requested",
      phase: "executing",
      sequence: 1,
      title: "正在压缩上下文",
      summary: "正在压缩较早上下文…",
    }),
  ]);
  const completed = visibleTranscriptNodes([
    node({
      nodeId: "compaction-completed",
      kind: "system",
      eventType: "context.compaction.completed",
      phase: "completed",
      sequence: 1,
      title: "整理上下文",
      summary: "已整理 18 条较早上下文，后续继续当前任务。",
    }),
  ]);
  const failed = visibleTranscriptNodes([
    node({
      nodeId: "compaction-failed",
      kind: "system",
      eventType: "context.compaction.failed",
      phase: "failed",
      sequence: 1,
      title: "上下文整理失败",
      summary: "上下文整理失败，任务已暂停。Context compaction returned an empty continuation prompt.",
    }),
  ]);

  assert.deepEqual(requested.map((item) => item.nodeId), ["compaction-requested"]);
  assert.deepEqual(completed.map((item) => item.nodeId), ["compaction-completed"]);
  assert.deepEqual(failed.map((item) => item.nodeId), ["compaction-failed"]);
});

test("visible transcript projection keeps successful command results with output evidence", () => {
  const projected = visibleTranscriptNodes([
    node({
      nodeId: "completed",
      kind: "tool",
      eventType: "tool.completed",
      phase: "completed",
      sequence: 1,
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        commandLine: "pnpm dev",
        exitCode: 0,
        stdoutPreview: "ready",
      },
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["completed"]);
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
  readonly modelUsage?: TranscriptNode["modelUsage"];
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
    modelUsage: input.modelUsage,
    refs: input.refs ?? [],
  };
}
