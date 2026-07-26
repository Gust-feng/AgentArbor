import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepChildConfirmationDecisionError,
  DeepChildPendingContinuationStore,
  type DeepChildPendingContinuation,
} from "./deep-child-continuations.js";
import type { DeepChildAgentRunResult } from "./deep-child-run-contracts.js";

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

test("deep child continuation reservations release safely and keep execution results for persistence retry", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));

  const reservation = store.reserve("run-1", "child-1", "confirmation-1");
  assert.throws(
    () => store.reserve("run-1", "child-1", "confirmation-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_in_progress",
  );

  const result = fakeResult();
  store.retainResult(reservation, result);
  store.release(reservation);

  const retry = store.reserve("run-1", "child-1", "confirmation-1");
  assert.equal(retry.pendingResult, result);
  store.commit(retry);
  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
});

test("known child result receives a full bounded retry TTL after its reservation releases", () => {
  let now = 0;
  const store = new DeepChildPendingContinuationStore({
    ttlMs: 10,
    now: () => now,
  });
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");
  const result = fakeResult();

  now = 9;
  store.retainResult(reservation, result);
  now = 25;
  store.release(reservation);

  now = 34;
  const retry = store.reserve("run-1", "child-1", "confirmation-1");
  assert.equal(retry.pendingResult, result);
  store.release(retry);

  now = 43;
  assert.ok(store.get("run-1", "child-1", "confirmation-1"));
  now = 44;
  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
});

test("deep child continuation marks uncertain execution without allowing a blind replay", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");

  store.markOutcomeUnknown(reservation);

  assert.throws(
    () => store.reserve("run-1", "child-1", "confirmation-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_outcome_unknown",
  );
});

test("unknown child confirmation outcome expires after a bounded retention window", () => {
  let now = 0;
  const store = new DeepChildPendingContinuationStore({
    ttlMs: 10,
    now: () => now,
  });
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");

  now = 20;
  store.markOutcomeUnknown(reservation);
  now = 29;
  assert.throws(
    () => store.reserve("run-1", "child-1", "confirmation-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_outcome_unknown",
  );

  now = 30;
  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
});

test("reserved continuation is not evicted or expired until its owner releases it", () => {
  let now = 0;
  const store = new DeepChildPendingContinuationStore({
    ttlMs: 10,
    maxEntries: 1,
    maxEntriesPerRun: 1,
    now: () => now,
  });
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");

  now = 100;
  store.remember("run-2", continuation("child-2", "confirmation-2"));
  assert.ok(store.get("run-1", "child-1", "confirmation-1"));

  store.release(reservation);
  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
});

test("reserved and known-result child continuations cannot be replaced by a parent instruction", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");

  store.remember("run-1", continuation("child-1", "confirmation-2"));
  assert.throws(
    () => store.assertChildInstructionAllowed("run-1", "child-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_in_progress",
  );
  assert.throws(
    () => store.deleteForChildRun("run-1", "child-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_in_progress",
  );
  assert.equal(store.get("run-1", "child-1", "confirmation-1")?.confirmationId, "confirmation-1");
  assert.equal(store.get("run-1", "child-1", "confirmation-2"), undefined);

  const result = fakeResult();
  store.retainResult(reservation, result);
  store.release(reservation);
  store.remember("run-1", continuation("child-1", "confirmation-2"));
  assert.throws(
    () => store.deleteForChildRun("run-1", "child-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_in_progress",
  );
  const retry = store.reserve("run-1", "child-1", "confirmation-1");
  assert.equal(retry.pendingResult, result);
  store.release(retry);
});

test("unknown confirmation outcome remains stable when a parent instruction tries to replace it", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));
  const reservation = store.reserve("run-1", "child-1", "confirmation-1");
  store.markOutcomeUnknown(reservation);

  store.remember("run-1", continuation("child-1", "confirmation-2"));
  assert.throws(
    () => store.assertChildInstructionAllowed("run-1", "child-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_outcome_unknown",
  );
  assert.throws(
    () => store.deleteForChildRun("run-1", "child-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_outcome_unknown",
  );
  assert.throws(
    () => store.reserve("run-1", "child-1", "confirmation-1"),
    (error: unknown) => error instanceof DeepChildConfirmationDecisionError
      && error.code === "confirmation_outcome_unknown",
  );
});

test("an available approval continuation can be explicitly replaced", () => {
  const store = new DeepChildPendingContinuationStore();
  store.remember("run-1", continuation("child-1", "confirmation-1"));

  store.assertChildInstructionAllowed("run-1", "child-1");
  store.deleteForChildRun("run-1", "child-1");
  store.remember("run-1", continuation("child-1", "confirmation-2"));

  assertContinuationLost(store, "run-1", "child-1", "confirmation-1");
  assert.equal(store.get("run-1", "child-1", "confirmation-2")?.confirmationId, "confirmation-2");
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

function fakeResult(): DeepChildAgentRunResult {
  return {
    summary: {} as DeepChildAgentRunResult["summary"],
    completedRun: {} as DeepChildAgentRunResult["completedRun"],
    prompt: {} as DeepChildAgentRunResult["prompt"],
    execution: {} as DeepChildAgentRunResult["execution"],
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
