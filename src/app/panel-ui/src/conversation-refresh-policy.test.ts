import assert from "node:assert/strict";
import { test } from "vitest";
import {
  conversationSummariesNeedRefresh,
  conversationSummaryNeedsRefresh,
  type RefreshableConversationSummary,
} from "./conversation-refresh-policy.js";
import {
  INITIAL_VISIBLE_TRANSCRIPT_TURNS,
  LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD,
  initialVisibleTranscriptTurnCount,
  reconcileTranscriptVisibilityState,
  runIdsForTurnWindow,
} from "./transcript-window.js";

test("conversation summary refresh follows active and actionable task states", () => {
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "running" })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "approval_needed" })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "needs_input" })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "pending" })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "completed", activeRunId: "run-1" })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "completed", queuedRunCount: 1 })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "completed", queuedRunIds: ["run-2"] })), true);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "completed", requiresUserAction: true })), true);
});

test("conversation summary refresh stops for terminal quiet task states", () => {
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "completed" })), false);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "failed" })), false);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "cancelled" })), false);
  assert.equal(conversationSummaryNeedsRefresh(conversation({ status: "idle" })), false);
  assert.equal(conversationSummariesNeedRefresh([
    conversation({ conversationId: "done", status: "completed" }),
    conversation({ conversationId: "idle", status: "idle" }),
  ]), false);
  assert.equal(conversationSummariesNeedRefresh([
    conversation({ conversationId: "done", status: "completed" }),
    conversation({ conversationId: "running", status: "running" }),
  ]), true);
});

test("long transcripts use a stable recent-turn window", () => {
  assert.equal(
    initialVisibleTranscriptTurnCount(LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD),
    LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD,
  );
  assert.equal(
    initialVisibleTranscriptTurnCount(LONG_TRANSCRIPT_PROGRESSIVE_THRESHOLD + 1),
    INITIAL_VISIBLE_TRANSCRIPT_TURNS,
  );
  assert.equal(reconcileTranscriptVisibilityState({
    previous: { conversationId: "conversation-1", totalTurns: 96, visibleCount: 96 },
    conversationId: "conversation-1",
    totalTurns: 97,
  }).visibleCount, 97);
  assert.deepEqual(runIdsForTurnWindow([
    { role: "assistant" as const, runId: "hidden-run" },
    { role: "user" as const },
    { role: "assistant" as const, runId: "visible-run" },
    { role: "assistant" as const, runId: "visible-run" },
  ], 1), ["visible-run"]);
});

function conversation(
  overrides: RefreshableConversationSummary & { readonly conversationId?: string; readonly title?: string }
): RefreshableConversationSummary {
  return {
    status: overrides.status,
    activeRunId: overrides.activeRunId,
    queuedRunCount: overrides.queuedRunCount,
    queuedRunIds: overrides.queuedRunIds,
    requiresUserAction: overrides.requiresUserAction,
  };
}