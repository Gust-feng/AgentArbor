import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptNode } from "../domain/basic-agent/index.js";
import { createPanelTranscriptNodes } from "./panel-transcript-nodes.js";
import {
  activityVisibleNodes,
  timelineVisibleNodes,
  visibleTranscriptNodes,
} from "./panel-transcript-node-projection.js";
import { displayActivityItemsForNodes } from "./panel-transcript-activity-copy.js";

test("activity projection preserves visible thinking even when the text looks like a progress placeholder", () => {
  const projected = activityVisibleNodes([
    node({ nodeId: "thinking", kind: "thinking", sequence: 1, summary: "正在判断下一步。" }),
    node({ nodeId: "system", kind: "system", sequence: 2, summary: "正在判断下一步。" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking"]);
});

test("panel transcript nodes drop generic ordinary processing notes", () => {
  const nodes = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:agent.note.completed",
      sequence: 1,
      type: "agent.note.completed",
      summary: "任务处理中。",
    }),
    panelEvent({
      eventId: "run-1:event:2:agent.note.completed",
      sequence: 2,
      type: "agent.note.completed",
      summary: "正在整理结果。",
    }),
  ]);

  assert.deepEqual(nodes, []);
});

test("panel transcript nodes expose sub-agent runs as dedicated activity nodes", () => {
  const nodes = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:sub_agent.completed",
      sequence: 1,
      type: "sub_agent.completed",
      summary: "Creative Advisor 运行结束：三条建议。",
      detail: {
        kind: "sub_agent",
        subAgentRunId: "sub-run-1",
        subAgentName: "Creative Advisor",
        subAgentStatus: "completed",
        subAgentModelRounds: 1,
        subAgentToolCalls: 0,
      },
    }),
  ]);

  assert.equal(nodes[0]?.kind, "sub_agent");
  assert.equal(nodes[0]?.subAgentRunId, "sub-run-1");
  assert.equal(nodes[0]?.subAgentName, "Creative Advisor");

  const activity = displayActivityItemsForNodes(nodes);
  assert.equal(activity[0]?.variant, "sub_agent");
  assert.equal(activity[0]?.subAgentRunId, "sub-run-1");
  assert.equal(activity[0]?.copy.label, "Creative Advisor");
});

test("panel transcript nodes attach model usage to completed answer bodies", () => {
  const nodes = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:10:model.output.delta:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "最终回答。",
      modelCallRefs: ["model-request-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.output.completed",
      sequence: 2,
      type: "model.output.completed",
      summary: "内容已整理。",
      modelCallRefs: ["model-request-1"],
      detail: {
        kind: "work",
        modelUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
          latencyMs: 1_500,
          firstTokenLatencyMs: 300,
          outputDurationMs: 1_200,
          outputTokensPerSecond: 20.83,
        },
      },
    }),
  ]);

  const body = nodes.find((item) => item.kind === "body");
  assert.equal(body?.text, "最终回答。");
  assert.deepEqual(body?.modelUsage, {
    inputTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    latencyMs: 1_500,
    firstTokenLatencyMs: 300,
    outputDurationMs: 1_200,
    outputTokensPerSecond: 20.83,
  });
});

test("timeline projection keeps thinking and excludes answer nodes from the activity rail", () => {
  const projected = timelineVisibleNodes([
    node({ nodeId: "answer", kind: "answer", eventType: "final.result", sequence: 4, summary: "最终回答" }),
    node({ nodeId: "body", kind: "body", eventType: "model.output.completed", sequence: 2, text: "正文" }),
    node({ nodeId: "thinking", kind: "thinking", eventType: "model.reasoning.completed", sequence: 1, text: "先确认目标" }),
    node({ nodeId: "tool", kind: "tool", eventType: "tool.completed", phase: "completed", sequence: 3, toolName: "read_file", summary: "README.md" }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["thinking", "tool"]);
});

test("activity projection deduplicates semantically repeated thinking while keeping the earlier position", () => {
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

test("activity projection deduplicates exact repeated model activity even when model refs differ", () => {
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

test("activity projection deduplicates repeated model activity across thinking and narration", () => {
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

test("panel transcript nodes capture model output as body nodes", () => {
  const projected = createPanelTranscriptNodes([
    {
      eventId: "run-1:event:1:model.output.delta",
      runId: "run-1",
      sequence: 1,
      type: "model.output.delta",
      createdAt: "2026-06-04T00:00:00.000Z",
      delta: "先说明一下：",
      sourceRefs: [],
      modelCallRefs: ["model-1"],
      toolCallRefs: [],
    },
    {
      eventId: "run-1:event:2:model.output.delta",
      runId: "run-1",
      sequence: 2,
      type: "model.output.delta",
      createdAt: "2026-06-04T00:00:00.000Z",
      delta: "我会读取文件。",
      sourceRefs: [],
      modelCallRefs: ["model-1"],
      toolCallRefs: [],
    },
    {
      eventId: "run-1:event:3:tool.requested",
      runId: "run-1",
      sequence: 3,
      type: "tool.requested",
      createdAt: "2026-06-04T00:00:00.000Z",
      toolName: "read_file",
      sourceRefs: [],
      modelCallRefs: ["model-1"],
      toolCallRefs: ["tool-1"],
    },
  ]);

  assert.deepEqual(projected.map((item) => item.kind), ["body", "tool"]);
  assert.equal(projected[0]?.text, "先说明一下：我会读取文件。");
  assert.deepEqual(timelineVisibleNodes(projected).map((item) => item.kind), ["tool"]);
  assert.deepEqual(activityVisibleNodes(projected).map((item) => item.kind), ["body", "tool"]);
  assert.deepEqual(visibleTranscriptNodes(projected).map((item) => item.kind), ["tool"]);
});

test("panel transcript nodes keep one reasoning node when replay catches up after body streaming starts", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:live:model.reasoning.delta:model-1:1",
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "Now",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:live:model.reasoning.delta:model-1:2",
      sequence: 2,
      type: "model.reasoning.delta",
      delta: " let",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:live:model.output.delta:model-1:3",
      sequence: 3,
      type: "model.output.delta",
      delta: "先",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:live:model.output.delta:model-1:4",
      sequence: 4,
      type: "model.output.delta",
      delta: "说明",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.reasoning.delta:1",
      sequence: 10,
      type: "model.reasoning.delta",
      delta: "Now let me read files.",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.reasoning.completed",
      sequence: 11,
      type: "model.reasoning.completed",
      summary: "Now let me read files.",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.output.completed",
      sequence: 12,
      type: "model.output.completed",
      summary: "内容已整理。",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:11:tool.requested",
      sequence: 13,
      type: "tool.requested",
      modelCallRefs: ["model-1"],
      toolCallRefs: ["tool-1"],
    }),
  ]);

  const thinking = projected.filter((item) => item.kind === "thinking");

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking[0]?.text, "Now let me read files.");
});

test("panel transcript nodes do not duplicate replay catch-up body text", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:live:model.output.delta:model-1:1",
      sequence: 1,
      type: "model.output.delta",
      delta: "先",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:live:model.output.delta:model-1:2",
      sequence: 2,
      type: "model.output.delta",
      delta: "说明",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.output.delta:1",
      sequence: 10,
      type: "model.output.delta",
      delta: "先说明",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:10:model.output.completed",
      sequence: 11,
      type: "model.output.completed",
      summary: "内容已整理。",
      modelCallRefs: ["model-1"],
    }),
    panelEvent({
      eventId: "run-1:event:11:tool.requested",
      sequence: 12,
      type: "tool.requested",
      modelCallRefs: ["model-1"],
      toolCallRefs: ["tool-1"],
    }),
  ]);

  const body = projected.find((item) => item.kind === "body");

  assert.equal(body?.text, "先说明");
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

test("panel transcript nodes omit approval resume events from ordinary visible nodes", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:user_approval.received",
      sequence: 1,
      type: "user_approval.received",
      summary: "已继续。",
    }),
    panelEvent({
      eventId: "run-1:event:2:run.resumed",
      sequence: 2,
      type: "run.resumed",
      summary: "继续处理。",
    }),
    panelEvent({
      eventId: "run-1:event:3:user_approval.received",
      sequence: 3,
      type: "user_approval.received",
      summary: "已不执行。",
    }),
  ]);

  assert.deepEqual(projected.map((item) => `${item.eventType}:${item.phase}:${item.summary}`), [
    "user_approval.received:denied:已不执行。",
  ]);
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
  assert.deepEqual(activityVisibleNodes(projected).map((item) => item.kind), ["confirmation"]);
});

test("panel transcript nodes can restrict confirmation nodes to the current pending request", () => {
  const events = [
    {
      eventId: "run-1:event:1:confirmation.needed",
      runId: "run-1",
      sequence: 1,
      type: "confirmation.needed",
      createdAt: "2026-06-04T00:00:00.000Z",
      summary: "运行命令：python 3",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: ["call-command"],
    },
    {
      eventId: "run-1:event:2:tool.failed",
      runId: "run-1",
      sequence: 2,
      type: "tool.failed",
      createdAt: "2026-06-04T00:00:01.000Z",
      summary: "python 3 · Sandbox policy rejected command.",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: ["call-command"],
    },
  ];

  const stale = createPanelTranscriptNodes(events, { confirmationMode: "current" });
  const current = createPanelTranscriptNodes(events, {
    confirmationMode: "current",
    pendingConfirmation: {
      confirmationId: "confirmation-call-command",
      runId: "run-1",
      title: "运行命令",
      actionSummary: "运行命令：python 3",
      affectedResources: [],
      riskLevel: "medium",
      requestedAt: "2026-06-04T00:00:00.000Z",
      sourceRefs: ["tool:call-command"],
    },
  });

  assert.equal(stale.some((item) => item.kind === "confirmation"), false);
  assert.equal(stale.some((item) => item.eventType === "tool.failed"), true);
  assert.equal(current.find((item) => item.kind === "confirmation")?.confirmation?.confirmationId, "confirmation-call-command");
});

test("panel transcript nodes suppress ordinary startup and placeholder events", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:goal.received",
      sequence: 1,
      type: "goal.received",
      summary: "收到任务：请把目标展示出来",
    }),
    panelEvent({
      eventId: "run-1:event:2:run.started",
      sequence: 2,
      type: "run.started",
      summary: "任务已开始。",
    }),
    panelEvent({
      eventId: "run-1:event:3:agent.note.completed",
      sequence: 3,
      type: "agent.note.completed",
      summary: "等待模型输出。",
    }),
    panelEvent({
      eventId: "run-1:event:4:model.output.completed",
      sequence: 4,
      type: "model.output.completed",
      summary: "内容已整理。",
    }),
    panelEvent({
      eventId: "run-1:event:5:agent.note.completed",
      sequence: 5,
      type: "agent.note.completed",
      summary: "先检查 README.md，再回答。",
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.eventType), ["agent.note.completed"]);
  assert.equal(projected[0]?.summary, "先检查 README.md，再回答。");
  assert.equal(JSON.stringify(projected).includes("目标展示"), false);
  assert.equal(JSON.stringify(projected).includes("任务已开始"), false);
  assert.equal(JSON.stringify(projected).includes("等待模型输出"), false);
  assert.equal(JSON.stringify(projected).includes("内容已整理"), false);
});

test("panel transcript nodes render model failures as system failures", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:model.failed",
      sequence: 1,
      type: "model.failed",
      summary: "工具已执行，但后续模型续跑失败。模型服务连接失败。",
    }),
  ]);

  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.eventType, "model.failed");
  assert.equal(projected[0]?.kind, "system");
  assert.equal(projected[0]?.phase, "failed");
  assert.equal(projected[0]?.title, "模型回复失败");
});

test("panel transcript nodes render failed agent diagnostics as system failures", () => {
  const projected = createPanelTranscriptNodes([
    panelEvent({
      eventId: "run-1:event:1:agent.note.completed",
      sequence: 1,
      type: "agent.note.completed",
      status: "failed",
      agentLabel: "运行诊断",
      summary: "后台持久化失败：磁盘不可写。",
      detail: {
        kind: "work",
        error: "EACCES",
      },
    }),
  ]);

  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.eventType, "agent.note.completed");
  assert.equal(projected[0]?.kind, "system");
  assert.equal(projected[0]?.phase, "failed");
  assert.equal(projected[0]?.title, "运行诊断");
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

test("panel transcript nodes expose command execution facts in visible summaries", () => {
  const projected = createPanelTranscriptNodes([
    {
      eventId: "run-1:event:1:tool.completed",
      runId: "run-1",
      sequence: 1,
      type: "tool.completed",
      createdAt: "2026-06-04T00:00:00.000Z",
      toolName: "shell_command",
      detail: {
        display: {
          kind: "command_summary",
          commandLine: "pnpm dev",
          exitCode: 0,
          durationMs: 1530,
          background: true,
          pid: 1234,
          logPath: "C:/Temp/agentarbor-command-logs/pnpm-dev.log",
          stopCommand: "taskkill /pid 1234 /T /F",
          waitForPort: 5173,
          portReady: true,
          stdoutTruncated: true,
          stderrTruncated: false,
          stdoutChars: 1200,
          stderrChars: 0,
          stdoutOmittedChars: 340,
        },
      },
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: ["call-command"],
    },
  ]);

  const command = projected[0];
  assert.equal(command?.summary?.includes("pnpm dev"), true);
  assert.equal(command?.summary?.includes("exit 0"), true);
  assert.equal(command?.summary?.includes("1.5s"), true);
  assert.equal(command?.summary?.includes("后台 pid 1234"), true);
  assert.equal(command?.summary?.includes("log C:/Temp/agentarbor-command-logs/pnpm-dev.log"), true);
  assert.equal(command?.summary?.includes("stop taskkill /pid 1234 /T /F"), true);
  assert.equal(command?.summary?.includes("port 5173 ready"), true);
  assert.equal(command?.summary?.includes("stdout truncated 1200 chars 340 omitted"), true);
  assert.equal(command?.summary?.includes("stderr not truncated 0 chars"), true);

  const items = displayActivityItemsForNodes(timelineVisibleNodes(projected));
  assert.equal(items[0]?.copy.label, "命令");
  assert.equal(items[0]?.copy.expandedDetail?.includes("stdout truncated 1200 chars 340 omitted"), true);
});

test("visible transcript projection keeps successful command results with observable facts", () => {
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
        durationMs: 1530,
      },
      refs: [{ kind: "tool_call", id: "tool-1" }],
    }),
  ]);

  assert.deepEqual(projected.map((item) => item.nodeId), ["completed"]);
});

function panelEvent(input: {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly status?: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly detail?: Parameters<typeof createPanelTranscriptNodes>[0][number]["detail"];
  readonly modelCallRefs?: readonly string[];
  readonly toolCallRefs?: readonly string[];
}) {
  return {
    eventId: input.eventId,
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    createdAt: "2026-06-04T00:00:00.000Z",
    agentLabel: input.agentLabel,
    summary: input.summary,
    status: input.status,
    delta: input.delta,
    detail: input.detail,
    sourceRefs: [],
    modelCallRefs: input.modelCallRefs ?? [],
    toolCallRefs: input.toolCallRefs ?? [],
  };
}

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
