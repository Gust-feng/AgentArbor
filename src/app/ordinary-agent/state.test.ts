import assert from "node:assert/strict";
import test from "node:test";
import { createInitialOrdinaryRunState, recordOrdinaryToolResult, transitionOrdinaryRun } from "./state.js";
import { ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("Ordinary run reducer keeps one status, strips ephemeral attachments, and appends monotonic events", () => {
  const initial = createInitialOrdinaryRunState({
    runId: "run-1",
    turn: ordinaryRunTurn("run-1"),
    runInput: {
      userMessage: "inspect the image",
      taskSoil: {
        contextRefs: [{
          attachmentId: "image-1",
          ref: "file:image.png",
          kind: "file",
          title: "image.png",
          summary: "Selected image",
          metadata: { mimeType: "image/png", byteLength: 42, available: true, truncated: false },
          readonlyPreview: { title: "Preview", text: "image preview" },
        }],
        permissionBoundaryRefs: ["read:file:image.png"],
      },
    },
    birth: ordinaryRunBirth(),
    priorCanonicalMessages: [{
      role: "user",
      content: "previous",
      attachments: [{
        attachmentId: "raw-image",
        kind: "image",
        source: { kind: "data", mimeType: "image/png", data: "BASE64_MUST_NOT_PERSIST" },
      }],
    }],
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });

  assert.deepEqual(Object.keys(initial).sort(), [
    "birth", "canonicalMessages", "input", "runId", "status", "timeline", "timestamps", "toolCalls",
    "toolResultRecordedAt", "turn", "usage",
  ]);
  assert.equal(JSON.stringify(initial).includes("BASE64_MUST_NOT_PERSIST"), false);
  assert.equal(initial.input.taskSoil?.contextRefs?.[0]?.attachmentId, "image-1");
  assert.equal(initial.input.taskSoil?.contextRefs?.[0]?.readonlyPreview?.text, "image preview");
  assert.deepEqual(initial.input.taskSoil?.permissionBoundaryRefs, ["read:file:image.png"]);

  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const completed = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "complete",
      answer: "done",
      canonicalMessages: [...running.canonicalMessages, { role: "assistant", content: "done" }],
      toolCalls: [],
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  assert.deepEqual(completed.timeline.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(completed.timeline.map((event) => event.type), ["run.created", "run.started", "run.completed"]);
  assert.deepEqual(completed.status, { kind: "completed", answer: "done" });
  assert.deepEqual(completed.usage, { inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  assert.equal(completed.timestamps.terminalAt, "2026-01-01T00:00:02.000Z");
  assert.throws(() => transitionOrdinaryRun({
    state: completed,
    transition: { type: "cancel", reason: "too late" },
    recordedAt: "2026-01-01T00:00:03.000Z",
    eventId: "event-4",
  }), /completed status/u);
});

test("Ordinary approval pauses require the exact approval tool facts", () => {
  const initial = createInitialOrdinaryRunState({
    runId: "approval-facts-run",
    turn: ordinaryRunTurn("approval-facts-run"),
    runInput: { userMessage: "change the file" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const request = {
    confirmationId: "approval-facts-confirmation",
    toolCallFactId: "approval-facts-tool",
    title: "Confirm command",
    actionSummary: "Run a command",
    affectedResources: ["workspace"],
    riskLevel: "medium" as const,
    resumeAvailability: "live" as const,
    requestedAt: "2026-01-01T00:00:02.000Z",
    sourceRefs: [],
  };
  const approvalFact = {
    callId: "provider-call",
    factId: request.toolCallFactId,
    toolName: "shell_command",
    input: { command: "write" },
    output: undefined,
    status: "approval_required" as const,
    durationMs: 0,
    confirmationRequest: request,
  };
  const sameRequestWithDifferentKeyOrder = {
    toolCallFactId: request.toolCallFactId,
    confirmationId: request.confirmationId,
    actionSummary: request.actionSummary,
    title: request.title,
    riskLevel: request.riskLevel,
    affectedResources: request.affectedResources,
    requestedAt: request.requestedAt,
    resumeAvailability: request.resumeAvailability,
    sourceRefs: request.sourceRefs,
  };
  assert.notEqual(JSON.stringify(sameRequestWithDifferentKeyOrder), JSON.stringify(request));
  const approvalStatus = {
    kind: "awaiting_approval" as const,
    confirmationRequests: [sameRequestWithDifferentKeyOrder],
    continuationAvailability: "live_only" as const,
  };

  assert.throws(() => transitionOrdinaryRun({
    state: running,
    transition: {
      type: "request_approval",
      status: approvalStatus,
      canonicalMessages: running.canonicalMessages,
      toolCalls: [],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  }), /must match its approval tool facts/u);

  const paused = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "request_approval",
      status: approvalStatus,
      canonicalMessages: running.canonicalMessages,
      toolCalls: [approvalFact],
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });
  assert.equal(paused.status.kind, "awaiting_approval");
  assert.deepEqual(paused.toolCalls, [approvalFact]);
});

test("Ordinary tool facts are idempotent, ordered, and reject conflicting resolved results", () => {
  const queued = createInitialOrdinaryRunState({
    runId: "tool-facts-run",
    turn: ordinaryRunTurn("tool-facts-run"),
    runInput: { userMessage: "read" },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  const running = transitionOrdinaryRun({
    state: queued,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const result = {
    callId: "call-1",
    toolName: "read_file",
    input: { path: "README.md" },
    status: "completed" as const,
    output: { content: "first" },
    durationMs: 1,
  };
  const recorded = recordOrdinaryToolResult({ state: running, result, recordedAt: "2026-01-01T00:00:02.000Z" });
  const repeated = recordOrdinaryToolResult({ state: recorded, result, recordedAt: "2026-01-01T00:00:03.000Z" });
  assert.deepEqual(repeated.toolCalls, [result]);
  assert.equal(repeated.toolResultRecordedAt["call-1:completed"], "2026-01-01T00:00:02.000Z");
  assert.throws(() => recordOrdinaryToolResult({
    state: repeated,
    result: { ...result, output: { content: "conflict" } },
    recordedAt: "2026-01-01T00:00:04.000Z",
  }), /different resolved result/u);
});
