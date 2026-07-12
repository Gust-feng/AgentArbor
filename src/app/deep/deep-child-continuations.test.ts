import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepChildConfirmationDecisionError,
  DeepChildPendingContinuationStore,
  type DeepChildPendingContinuation,
} from "./deep-child-continuations.js";

test("deep child continuations expire after the feature retention window", () => {
  let now = 1_000;
  const store = new DeepChildPendingContinuationStore({
    ttlMs: 100,
    now: () => now,
  });
  store.remember("run-1", continuation("child-1", "confirmation-1"));

  now = 1_099;
  assert.ok(store.get("run-1", "child-1", "confirmation-1"));

  now = 1_100;
  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
});

test("deep child continuations evict the oldest entry at per-run and global limits", () => {
  const perRun = new DeepChildPendingContinuationStore({
    maxEntries: 4,
    maxEntriesPerRun: 1,
  });
  perRun.remember("run-1", continuation("child-1", "confirmation-1"));
  perRun.remember("run-1", continuation("child-2", "confirmation-2"));

  assertContinuationLost(perRun, "run-1", "child-1", "confirmation-1");
  assert.ok(perRun.get("run-1", "child-2", "confirmation-2"));

  const global = new DeepChildPendingContinuationStore({
    maxEntries: 2,
    maxEntriesPerRun: 2,
  });
  global.remember("run-1", continuation("child-1", "confirmation-1"));
  global.remember("run-2", continuation("child-2", "confirmation-2"));
  global.remember("run-3", continuation("child-3", "confirmation-3"));

  assertContinuationLost(global, "run-1", "child-1", "confirmation-1");
  assert.ok(global.get("run-2", "child-2", "confirmation-2"));
  assert.ok(global.get("run-3", "child-3", "confirmation-3"));
});

test("deep child continuation reconciliation keeps only final pending approvals and honors deletion", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  store.remember("run-1", continuation("child-2", "confirmation-2"));

  store.retainPendingForRun("run-1", [{
    childRunId: "child-2",
    confirmationId: "confirmation-2",
  }]);

  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
  assert.ok(store.get("run-1", "child-2", "confirmation-2"));

  store.deleteForRun("run-1");
  assertContinuationLost(store, "run-1", "child-2", "confirmation-2");
});

function continuation(
  childRunId: string,
  confirmationId: string,
): Omit<DeepChildPendingContinuation, "runId"> {
  return {
    childRunId,
    confirmationId,
    childRun: { childRunId } as DeepChildPendingContinuation["childRun"],
    childSpec: { specId: `spec-${childRunId}` } as DeepChildPendingContinuation["childSpec"],
    pendingApproval: { confirmationId } as DeepChildPendingContinuation["pendingApproval"],
  };
}

function assertContinuationLost(
  store: DeepChildPendingContinuationStore,
  runId: string,
  childRunId: string,
  confirmationId: string,
): void {
  assert.throws(
    () => store.assertPending(runId, childRunId, confirmationId),
    (error: unknown) => (
      error instanceof DeepChildConfirmationDecisionError &&
      error.code === "confirmation_continuation_lost"
    ),
  );
}
