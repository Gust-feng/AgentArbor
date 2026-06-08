import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createId, resetIdsForTests } from "../kernel/id.js";
import { PanelConversationStore, toRuntimeConversationRecord } from "./panel-conversations.js";

test("panel conversations keep store state separate from projection", async () => {
  const [storeSource, contractsSource, projectionSource] = await Promise.all([
    readAppSource("panel-conversations.ts"),
    readAppSource("panel-conversation-contracts.ts"),
    readAppSource("panel-conversation-projection.ts"),
  ]);

  assert.equal(storeSource.includes('from "./panel-conversation-contracts.js"'), true);
  assert.equal(storeSource.includes('from "./panel-conversation-projection.js"'), true);
  assert.equal(storeSource.includes("export class PanelConversationStore"), true);
  assert.equal(storeSource.includes("export type PanelConversationTurnRole"), false);
  assert.equal(storeSource.includes("export function toRuntimeConversationRecord"), false);
  assert.equal(storeSource.includes("export function trimRuntimeConversationToClosedPairs"), false);
  assert.equal(storeSource.includes("function toConversationReadModel"), false);
  assert.equal(storeSource.includes("function toConversationSummary"), false);
  assert.equal(storeSource.includes("function closedTurnPrefix"), false);
  assert.equal(storeSource.includes("function conversationStatus"), false);
  assert.equal(contractsSource.includes("export type PanelConversationReadModel"), true);
  assert.equal(contractsSource.includes("export type PanelConversationTurnModel"), true);
  assert.equal(projectionSource.includes("export function toRuntimeConversationRecord"), true);
  assert.equal(projectionSource.includes("export function trimRuntimeConversationToClosedPairs"), true);
  assert.equal(projectionSource.includes("export function toConversationReadModel"), true);
  assert.equal(projectionSource.includes("function closedTurnPrefix"), true);
  assert.equal(projectionSource.includes("function conversationStatus"), true);
});

test("panel conversations preserve assistant markdown line breaks", () => {
  const store = new PanelConversationStore();
  const started = store.startDesktopMessage({ goal: "给我一个 Markdown 回答" });
  const markdown = [
    "可以。",
    "",
    "1. **第一项**",
    "2. **第二项**",
    "",
    "- **证据**：已保留列表结构",
  ].join("\n");

  store.attachRun({
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runId: "run-markdown",
  });
  store.completeAssistantTurn({
    conversationId: started.conversation.conversationId,
    assistantTurnId: started.assistantTurn.turnId,
    runId: "run-markdown",
    title: "已完成",
    content: markdown,
    status: "completed",
  });

  const conversation = store.getReadModel(started.conversation.conversationId)!;
  const assistantTurn = conversation.turns[1]!;
  const persisted = toRuntimeConversationRecord(conversation);

  assert.equal(assistantTurn.content.includes("\n1. **第一项**\n2. **第二项**"), true);
  assert.equal(assistantTurn.content.includes("\n- **证据**"), true);
  assert.equal(persisted.turns[1]?.content.includes("\n- **证据**"), true);
});

test("panel conversation summaries do not invent completed results for empty assistant turns", () => {
  const store = new PanelConversationStore();
  const conversation = store.restore({
    conversationId: "conversation-empty-completed",
    title: "空完成记录",
    preview: "",
    currentAction: "",
    nextStep: "",
    status: "completed",
    activeRunId: undefined,
    latestRunId: "run-empty-completed",
    requiresUserAction: false,
    queuedRunIds: [],
    queuedRunCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    turns: [
      {
        turnId: "turn-empty-user",
        role: "user",
        title: "你的消息",
        content: "给出答案",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        turnId: "turn-empty-assistant",
        role: "assistant",
        title: "",
        content: "",
        status: "completed",
        runId: "run-empty-completed",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
    ],
  });

  assert.equal(conversation.status, "completed");
  assert.equal(conversation.currentAction, "");
  assert.equal(conversation.currentAction.includes("结果已生成"), false);
});

test("panel conversations keep the active follow-up run when an older guidance turn completes", () => {
  const store = new PanelConversationStore();
  const first = store.startDesktopMessage({ goal: "删除文件前需要确认" });
  store.attachRun({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "run-original",
  });

  const followUp = store.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "先不要删除，说明需要我确认什么。",
  });
  store.attachRun({
    conversationId: followUp.conversation.conversationId,
    assistantTurnId: followUp.assistantTurn.turnId,
    runId: "run-follow-up",
  });
  store.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "run-original",
    title: "需要补充",
    content: "已补充要求，将作为后续消息继续处理。",
    status: "completed",
  });

  const conversation = store.getReadModel(first.conversation.conversationId)!;
  assert.equal(conversation.activeRunId, "run-follow-up");
  assert.equal(conversation.latestRunId, "run-follow-up");
  assert.equal(conversation.status, "running");
});

test("panel conversation summaries expose actionable and queued task states", () => {
  const store = new PanelConversationStore();
  const pending = store.startDesktopMessage({ goal: "删除前需要确认" });
  store.attachRun({
    conversationId: pending.conversation.conversationId,
    assistantTurnId: pending.assistantTurn.turnId,
    runId: "run-confirm",
  });
  store.updateAssistantPreview({
    conversationId: pending.conversation.conversationId,
    assistantTurnId: pending.assistantTurn.turnId,
    title: "待处理",
    content: "删除文件前需要你判断。",
    status: "running",
  });

  const queued = store.startDesktopMessage({
    conversationId: pending.conversation.conversationId,
    goal: "确认后继续总结",
    queueBehindRunId: "run-confirm",
  });
  store.queueRun({
    conversationId: queued.conversation.conversationId,
    assistantTurnId: queued.assistantTurn.turnId,
    runId: "run-queued",
  });

  const conversation = store.getReadModel(pending.conversation.conversationId)!;
  const summary = store.list().find((item) => item.conversationId === pending.conversation.conversationId)!;
  const persisted = toRuntimeConversationRecord(conversation);

  assert.equal(summary.status, "approval_needed");
  assert.equal(summary.requiresUserAction, true);
  assert.equal(summary.currentAction, "删除文件前需要你判断。");
  assert.equal(summary.nextStep, "继续、不执行或补充要求。");
  assert.deepEqual(summary.queuedRunIds, ["run-queued"]);
  assert.equal(summary.queuedRunCount, 1);
  assert.equal(persisted.status, "approval_needed");
  assert.equal(persisted.requiresUserAction, true);
  assert.equal(persisted.currentAction, "删除文件前需要你判断。");
  assert.equal(persisted.nextStep, "继续、不执行或补充要求。");
});

test("panel conversation summaries keep running next steps concise", () => {
  const store = new PanelConversationStore();
  const active = store.startDesktopMessage({ goal: "整理当前文件" });
  store.attachRun({
    conversationId: active.conversation.conversationId,
    assistantTurnId: active.assistantTurn.turnId,
    runId: "run-active",
  });

  let summary = store.list().find((item) => item.conversationId === active.conversation.conversationId)!;
  assert.equal(summary.status, "running");
  assert.equal(summary.nextStep, "任务进行中。");
  assert.equal(summary.nextStep.includes("继续观察进度"), false);
  assert.equal(summary.nextStep.includes("必要时"), false);

  const queued = store.startDesktopMessage({
    conversationId: active.conversation.conversationId,
    goal: "再做一个总结",
    queueBehindRunId: "run-active",
  });
  store.queueRun({
    conversationId: queued.conversation.conversationId,
    assistantTurnId: queued.assistantTurn.turnId,
    runId: "run-queued",
  });

  summary = store.list().find((item) => item.conversationId === active.conversation.conversationId)!;
  assert.equal(summary.status, "running");
  assert.equal(summary.nextStep, "还有 1 个任务排队。");
  assert.equal(summary.nextStep.includes("继续观察进度"), false);
});

test("panel conversation restore reserves existing ids before follow-up creation", () => {
  resetIdsForTests();
  const store = new PanelConversationStore();
  store.restore({
    conversationId: "conversation-0001",
    title: "历史对话",
    preview: "历史回答",
    currentAction: "历史回答",
    nextStep: "继续",
    status: "completed",
    activeRunId: undefined,
    latestRunId: "panel-run-0001",
    requiresUserAction: false,
    queuedRunIds: [],
    queuedRunCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    turns: [
      {
        turnId: "turn-0001",
        role: "user",
        title: "你的消息",
        content: "第一轮",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        turnId: "turn-0002",
        role: "assistant",
        title: "已完成",
        content: "历史回答",
        status: "completed",
        runId: "panel-run-0001",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
    ],
  });

  const followUp = store.startDesktopMessage({
    conversationId: "conversation-0001",
    goal: "第二轮",
  });

  assert.equal(followUp.userTurn.turnId, "turn-0003");
  assert.equal(followUp.assistantTurn.turnId, "turn-0004");
  assert.equal(createId("panel-run"), "panel-run-0002");
  resetIdsForTests();
});

async function readAppSource(fileName: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src", "app", fileName), "utf8");
}
