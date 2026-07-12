import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessageType } from "../../domain/common.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import { reduceToolCallEventFacts, reduceToolCallEventTimeline } from "./tool-call-event-reducer.js";

test("tool call event reducer preserves the first terminal fact", () => {
  const facts = reduceToolCallEventFacts([
    entry(1, "tool.requested", { callId: "call-1", toolName: "read", input: { ref: "a" } }),
    entry(2, "tool.completed", { callId: "call-1", toolName: "read", output: { status: "completed" }, durationMs: 2 }),
    entry(3, "tool.failed", { callId: "call-1", toolName: "read", error: "late failure", durationMs: 3 }),
    entry(3, "tool.failed", { callId: "call-1", toolName: "read", error: "duplicate", durationMs: 3 }),
  ]);

  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.status, "completed");
  assert.deepEqual(facts[0]?.output, { status: "completed" });
  assert.equal(facts[0]?.error, undefined);
  assert.deepEqual(facts[0]?.eventSequences, [1, 2, 3]);
});

test("tool call event reducer distinguishes approval, cancellation, and missing requested", () => {
  const facts = reduceToolCallEventFacts([
    entry(1, "user_approval.requested", {
      callId: "call-approval",
      toolName: "shell_command",
      confirmationId: "confirm-1",
    }),
    entry(2, "tool.cancelled", {
      callId: "call-approval",
      toolName: "shell_command",
      reason: "User denied the command.",
      durationMs: 0,
    }),
    entry(3, "tool.failed", {
      callId: "call-failed",
      toolName: "read",
      error: "missing",
      errorDomain: "tool_error",
      errorFacts: { code: "ENOENT" },
      durationMs: 1,
    }),
  ]);

  assert.equal(facts[0]?.status, "cancelled");
  assert.equal(facts[0]?.confirmationId, "confirm-1");
  assert.equal(facts[0]?.error, "User denied the command.");
  assert.equal(facts[1]?.status, "failed");
  assert.equal(facts[1]?.errorFacts?.code, "ENOENT");
});

test("tool call event timeline exposes each sequence without leaking later terminal facts", () => {
  const timeline = reduceToolCallEventTimeline([
    entry(1, "tool.requested", { callId: "call-timeline", toolName: "read_file", input: { path: "a.md" } }),
    entry(2, "user_approval.requested", { callId: "call-timeline", toolName: "read_file", confirmationId: "confirm-1" }),
    entry(3, "tool.completed", { callId: "call-timeline", toolName: "read_file", output: { path: "a.md" } }),
    entry(4, "tool.failed", { callId: "call-timeline", error: "late failure" }),
  ]);

  assert.equal(timeline.factBySequence.get(1)?.status, "requested");
  assert.equal(timeline.factBySequence.get(1)?.output, undefined);
  assert.equal(timeline.factBySequence.get(2)?.status, "approval_required");
  assert.equal(timeline.factBySequence.get(3)?.status, "completed");
  assert.deepEqual(timeline.factBySequence.get(3)?.output, { path: "a.md" });
  assert.equal(timeline.factBySequence.get(4)?.status, "completed");
  assert.deepEqual(timeline.facts[0]?.eventSequences, [1, 2, 3, 4]);
});

function entry(
  sequence: number,
  type: ArborMessageType,
  payload: Readonly<Record<string, unknown>>,
): EventLogEntry {
  const message = createMessage({
    traceId: "trace-tool-reducer",
    from: { id: "runtime", role: "runtime" },
    to: { role: "runtime" },
    type,
    intent: type,
    payload,
  });
  return {
    sequence,
    type,
    message,
    recordedAt: `2026-07-11T00:00:0${sequence}.000Z`,
  };
}
