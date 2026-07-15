import assert from "node:assert/strict";
import test from "node:test";
import {
  queuedMessageDispatchDecision,
  type QueuedChatMessage,
  type QueuedMessageDispatchRun,
} from "../src/app-queued-message-state.js";

test("queued message dispatch follows a completed run without a live response edge", () => {
  const message = queuedMessage("message-1", "continue testing");

  assert.deepEqual(queuedMessageDispatchDecision({
    busy: false,
    currentRun: run("run-1", "completed"),
    queuedMessages: [message],
    dispatchedAfterRunId: undefined,
  }), {
    kind: "dispatch",
    message,
    sourceRunId: "run-1",
  });
});

test("queued message dispatch waits while the current run is still active", () => {
  assert.deepEqual(queuedMessageDispatchDecision({
    busy: false,
    currentRun: run("run-1", "running"),
    queuedMessages: [queuedMessage("message-1", "continue")],
    dispatchedAfterRunId: undefined,
  }), { kind: "none" });
});

test("queued message dispatch is one-shot for the same completed run", () => {
  assert.deepEqual(queuedMessageDispatchDecision({
    busy: false,
    currentRun: run("run-1", "completed"),
    queuedMessages: [queuedMessage("message-2", "second message")],
    dispatchedAfterRunId: "run-1",
  }), { kind: "none" });
});

test("queued message dispatch does not bypass user-action states", () => {
  assert.deepEqual(queuedMessageDispatchDecision({
    busy: false,
    currentRun: run("run-1", "approval_needed", true),
    queuedMessages: [queuedMessage("message-1", "continue")],
    dispatchedAfterRunId: undefined,
  }), { kind: "none" });
  assert.deepEqual(queuedMessageDispatchDecision({
    busy: false,
    currentRun: run("run-2", "completed", true),
    queuedMessages: [queuedMessage("message-1", "continue")],
    dispatchedAfterRunId: undefined,
  }), { kind: "none" });
});

function queuedMessage(id: string, content: string): QueuedChatMessage {
  return { id, content };
}

function run(
  runId: string,
  status: QueuedMessageDispatchRun["status"],
  requiresUserAction = false,
): QueuedMessageDispatchRun {
  return {
    runId,
    status,
    requiresUserAction,
  };
}
