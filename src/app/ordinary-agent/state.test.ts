import assert from "node:assert/strict";
import test from "node:test";
import { createInitialOrdinaryRunState, transitionOrdinaryRun } from "./state.js";
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
    "birth", "canonicalMessages", "input", "runId", "status", "timeline", "timestamps", "toolCalls", "turn",
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
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  assert.deepEqual(completed.timeline.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(completed.timeline.map((event) => event.type), ["run.created", "run.started", "run.completed"]);
  assert.deepEqual(completed.status, { kind: "completed", answer: "done" });
  assert.equal(completed.timestamps.terminalAt, "2026-01-01T00:00:02.000Z");
  assert.throws(() => transitionOrdinaryRun({
    state: completed,
    transition: { type: "cancel", reason: "too late" },
    recordedAt: "2026-01-01T00:00:03.000Z",
    eventId: "event-4",
  }), /completed status/u);
});
