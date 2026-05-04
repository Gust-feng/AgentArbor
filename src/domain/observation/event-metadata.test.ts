import assert from "node:assert/strict";
import test from "node:test";
import { ARBOR_MESSAGE_TYPES, type ArborMessage } from "../common.js";
import {
  EVENT_OBSERVATION_METADATA,
  createRunObservationEventView,
  phaseForEvent,
  stageForEvent,
} from "./index.js";
import type { RunObservationEventEntry } from "./contracts.js";

test("observation event metadata covers every ArborMessageType", () => {
  assert.deepEqual(Object.keys(EVENT_OBSERVATION_METADATA).sort(), [...ARBOR_MESSAGE_TYPES].sort());

  for (const type of ARBOR_MESSAGE_TYPES) {
    const metadata = EVENT_OBSERVATION_METADATA[type];
    assert.equal(metadata.summary.length > 0, true, `${type} must have a summary`);
    assert.equal(metadata.progress.label.length > 0, true, `${type} must have a progress label`);
  }
});

test("event view and phase-stage resolution use the same event metadata source", () => {
  const total = ARBOR_MESSAGE_TYPES.length;

  ARBOR_MESSAGE_TYPES.forEach((type, index) => {
    const metadata = EVENT_OBSERVATION_METADATA[type];
    const entry = minimalEventEntry(type, index + 1);
    const view = createRunObservationEventView(entry, total);

    assert.equal(view.summary, metadata.summary);
    assert.equal(view.scope, metadata.scope);
    assert.equal(view.severity, metadata.severity);
    assert.equal(view.progress.status, metadata.progress.status);
    assert.equal(view.progress.label, metadata.progress.label);
    assert.equal(phaseForEvent(type), metadata.phase);
    assert.equal(stageForEvent(type), metadata.stage);
  });
});

test("model event refs do not collide with user clarification request ids", () => {
  const view = createRunObservationEventView(
    minimalEventEntry("model.completed", 1, {
      requestId: "model-request-test",
      responseId: "model-response-test",
    })
  );

  assert.equal(view.refs.some((ref) => ref.kind === "model_call" && ref.id === "model-request-test"), true);
  assert.equal(view.refs.some((ref) => ref.kind === "model_call" && ref.id === "model-response-test"), true);
  assert.equal(view.refs.some((ref) => ref.kind === "user_clarification"), false);
});

test("clarification request refs do not collide with model call ids", () => {
  const view = createRunObservationEventView(
    minimalEventEntry("user_approval.received", 1, {
      requestId: "clarification-request-test",
      clarificationResponse: { requestId: "clarification-request-test" },
    })
  );

  assert.equal(
    view.refs.some((ref) => ref.kind === "user_clarification" && ref.id === "clarification-request-test"),
    true
  );
  assert.equal(view.refs.some((ref) => ref.kind === "model_call"), false);
});

test("tool event refs do not collide with model or clarification refs", () => {
  const view = createRunObservationEventView(
    minimalEventEntry("tool.completed", 1, {
      callId: "tool-call-test",
      requestId: "same-name-field-is-ignored",
    })
  );

  assert.equal(view.refs.some((ref) => ref.kind === "tool_call" && ref.id === "tool-call-test"), true);
  assert.equal(view.refs.some((ref) => ref.kind === "model_call"), false);
  assert.equal(view.refs.some((ref) => ref.kind === "user_clarification"), false);
});

function minimalEventEntry(
  type: (typeof ARBOR_MESSAGE_TYPES)[number],
  sequence: number,
  payload: ArborMessage["payload"] = {}
): RunObservationEventEntry {
  const message: ArborMessage = {
    id: `msg-${sequence}`,
    traceId: "trace-metadata-test",
    from: { id: "test", role: "underground_center" },
    type,
    intent: "metadata_test",
    payload,
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  return {
    sequence,
    type,
    message,
    recordedAt: "2026-05-01T00:00:00.000Z",
  };
}
