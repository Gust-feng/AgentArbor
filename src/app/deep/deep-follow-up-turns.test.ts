import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDeepRunFollowUpTurn,
  createDeepRunFollowUpTurn,
  deepRunFollowUpUserMessage,
} from "./deep-follow-up-turns.js";
import type { DeepConversation } from "./contracts.js";
import { DEEP_RUN_KIND, DEEP_RUN_MODE } from "./contracts.js";

function conversationFixture(): DeepConversation {
  return {
    conversationId: "deep-conversation-1",
    title: "多 Agent 追问恢复",
    goal: "修复运行中追问恢复",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    permissionBoundaryRefs: [],
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
  };
}

test("deep run follow-up turn keeps the raw user supplement on the target run", () => {
  const followUp = createDeepRunFollowUpTurn({
    runId: "deep-run-1",
    correctionContext: ["优先修复切会话丢消息", "不要等回答结束才可见"],
    createdAt: "2026-06-29T10:05:00.000Z",
  });

  assert.equal(followUp.runId, "deep-run-1");
  assert.equal(followUp.userMessage, "优先修复切会话丢消息\n不要等回答结束才可见");
  assert.equal(followUp.createdAt, "2026-06-29T10:05:00.000Z");
  assert.equal(followUp.turnId.startsWith("deep-follow-up-"), true);
});

test("appendDeepRunFollowUpTurn appends history and advances conversation updatedAt", () => {
  const first = createDeepRunFollowUpTurn({
    runId: "deep-run-1",
    correctionContext: ["第一条补充"],
    createdAt: "2026-06-29T10:05:00.000Z",
  });
  const second = createDeepRunFollowUpTurn({
    runId: "deep-run-2",
    correctionContext: ["第二条补充"],
    createdAt: "2026-06-29T10:06:00.000Z",
  });

  const afterFirst = appendDeepRunFollowUpTurn(conversationFixture(), first);
  const afterSecond = appendDeepRunFollowUpTurn(afterFirst, second);

  assert.deepEqual(
    afterSecond.followUpTurns?.map((turn) => ({ runId: turn.runId, userMessage: turn.userMessage })),
    [
      { runId: "deep-run-1", userMessage: "第一条补充" },
      { runId: "deep-run-2", userMessage: "第二条补充" },
    ],
  );
  assert.equal(afterSecond.updatedAt, "2026-06-29T10:06:00.000Z");
});

test("deepRunFollowUpUserMessage trims empty fragments before projection", () => {
  assert.equal(
    deepRunFollowUpUserMessage(["  保留追问  ", "", "   ", "恢复时仍可见"]),
    "保留追问\n恢复时仍可见",
  );
});
