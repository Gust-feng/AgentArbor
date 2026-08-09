import { expect, test } from "vitest";
import type { ConversationSummary } from "./contracts/conversation";
import { conversationStatusMarker } from "./conversation-status-marker";

function conversation(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    conversationId: "conversation-1",
    title: "示例对话",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("shows a spinning marker while a run is running or queued", () => {
  expect(conversationStatusMarker(conversation({ status: "running" }))).toEqual({ kind: "working", label: "处理中" });
  expect(conversationStatusMarker(conversation({ status: "pending" }))).toEqual({ kind: "working", label: "处理中" });
  expect(conversationStatusMarker(conversation({ queuedRunCount: 2 }))).toEqual({ kind: "working", label: "排队中" });
});

test("prefers an attention marker over the running state when the user must act", () => {
  expect(conversationStatusMarker(conversation({ status: "approval_needed" }))).toEqual({
    kind: "attention",
    label: "需要确认",
  });
  expect(conversationStatusMarker(conversation({ status: "running", requiresUserAction: true }))).toEqual({
    kind: "attention",
    label: "需要处理",
  });
  expect(conversationStatusMarker(conversation({ status: "blocked" }))).toEqual({
    kind: "attention",
    label: "需要处理",
  });
});

test("shows an error triangle only for genuine failures", () => {
  expect(conversationStatusMarker(conversation({ status: "failed" }))).toEqual({
    kind: "failed",
    label: "运行失败",
  });
});

test("shows a quiet dot for completed conversations", () => {
  expect(conversationStatusMarker(conversation({ status: "completed" }))).toEqual({ kind: "done", label: "已完成" });
});

test("keeps idle and user-cancelled conversations quiet without any marker", () => {
  expect(conversationStatusMarker(conversation({}))).toBeUndefined();
  expect(conversationStatusMarker(conversation({ status: "idle" }))).toBeUndefined();
  expect(conversationStatusMarker(conversation({ status: "cancelled" }))).toBeUndefined();
});
