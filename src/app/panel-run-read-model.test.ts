import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createPanelRunTranscript } from "./panel-run-read-model.js";

test("panel reasoning trace is matched by exact model output contract", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-trace",
    status: "running",
    eventEntries: [
      modelCompletedEntry({
        sequence: 1,
        requestId: "request-intent",
        contractId: "underground.intent_profile.v1",
        decisionSummary: "Intent Core shaped the goal.",
      }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-convergence",
        contractId: "underground.convergence_judgment.v1",
        decisionSummary: "Convergence Judge selected the handoff candidate.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
  });

  const intentNote = transcript.workNotes.find((note) => note.noteId.endsWith(":intent-core"));
  const convergenceNote = transcript.workNotes.find((note) => note.noteId.endsWith(":convergence-judge"));
  const handoffNote = transcript.workNotes.find((note) => note.noteId.endsWith(":handoff-steward"));

  assert.equal(intentNote?.reasoningTrace?.decisionSummary, "Intent Core shaped the goal.");
  assert.equal(convergenceNote?.reasoningTrace?.decisionSummary, "Convergence Judge selected the handoff candidate.");
  assert.equal(handoffNote?.reasoningTrace, undefined);
});

function modelCompletedEntry(input: {
  readonly sequence: number;
  readonly requestId: string;
  readonly contractId: string;
  readonly decisionSummary: string;
}): EventLogEntry {
  const type: ArborMessageType = "model.completed";
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-panel-trace",
    from: { id: "intelligence-channel", role: "underground_center" },
    to: { group: "underground-center" },
    type,
    intent: "complete_model_request",
    payload: {
      requestId: input.requestId,
      responseId: `response-${input.requestId}`,
      purpose: "test-purpose",
      outputContract: { contractId: input.contractId },
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "fake-model",
      outputKind: "explanation",
      validationStatus: "passed",
      visibleOutput: visibleOutput(input.contractId, input.decisionSummary),
    },
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}

function visibleOutput(contractId: string, decisionSummary: string): ModelVisibleOutputProjection {
  return {
    source: "structured_output",
    contractId,
    outputKind: "explanation",
    validationStatus: "passed",
    items: [
      {
        itemId: "item-1",
        fields: [
          { name: "decisionSummary", value: decisionSummary, truncated: false },
          { name: "uncertainty", value: "fixture uncertainty", truncated: false },
          { name: "confidence", value: "0.8", truncated: false },
        ],
      },
    ],
    truncated: false,
  };
}
