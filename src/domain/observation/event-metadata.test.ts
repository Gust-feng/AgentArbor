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

function minimalEventEntry(type: (typeof ARBOR_MESSAGE_TYPES)[number], sequence: number): RunObservationEventEntry {
  const message: ArborMessage = {
    id: `msg-${sequence}`,
    traceId: "trace-metadata-test",
    from: { id: "test", role: "underground_center" },
    type,
    intent: "metadata_test",
    payload: {},
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  return {
    sequence,
    type,
    message,
    recordedAt: "2026-05-01T00:00:00.000Z",
  };
}
