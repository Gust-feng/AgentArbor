import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createPanelWorkNotes } from "./panel-work-notes.js";

test("panel work notes keep ordinary desktop chat separate from underground workflow notes", () => {
  const notes = createPanelWorkNotes({
    runId: "run-work-notes-chat",
    status: "completed",
    eventEntries: [
      modelCompletedEntry({
        sequence: 1,
        requestId: "request-chat",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "Answered without starting internal workflow.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
    modelCalls: [
      {
        requestId: "request-chat",
        responseId: "response-request-chat",
        status: "completed",
        purpose: "desktop_agent",
        outputContractId: "desktop.agent_response.v1",
        visibleOutput: visibleOutput("desktop.agent_response.v1", "Answered without starting internal workflow."),
        candidateRefs: [],
        eventRefs: ["message-1"],
      },
    ],
    desktopChatOnly: true,
  });

  assert.deepEqual(notes.map((note) => note.agentId), ["desktop-agent-session", "intelligence-channel"]);
  assert.equal(notes.some((note) => note.agentId.includes("underground")), false);
});

test("panel work notes attach reasoning traces only to matching underground contracts", () => {
  const notes = createPanelWorkNotes({
    runId: "run-work-notes-underground",
    status: "running",
    eventEntries: [
      modelCompletedEntry({
        sequence: 1,
        requestId: "request-intent",
        contractId: "underground.intent_profile.v1",
        decisionSummary: "Intent Core shaped a safe goal profile.",
      }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-convergence",
        contractId: "underground.convergence_judgment.v1",
        decisionSummary: "Convergence Judge selected retained material.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
    modelCalls: [
      {
        requestId: "request-intent",
        responseId: "response-request-intent",
        status: "completed",
        outputContractId: "underground.intent_profile.v1",
        visibleOutput: visibleOutput("underground.intent_profile.v1", "Intent Core shaped a safe goal profile."),
        candidateRefs: [],
        eventRefs: ["message-1"],
      },
      {
        requestId: "request-convergence",
        responseId: "response-request-convergence",
        status: "completed",
        outputContractId: "underground.convergence_judgment.v1",
        visibleOutput: visibleOutput("underground.convergence_judgment.v1", "Convergence Judge selected retained material."),
        candidateRefs: [],
        eventRefs: ["message-2"],
      },
    ],
    desktopChatOnly: false,
  });

  const intent = notes.find((note) => note.noteId.endsWith(":intent-core"));
  const convergence = notes.find((note) => note.noteId.endsWith(":convergence-judge"));
  const handoff = notes.find((note) => note.noteId.endsWith(":handoff-steward"));

  assert.equal(intent?.reasoningTrace?.decisionSummary, "Intent Core shaped a safe goal profile.");
  assert.equal(convergence?.reasoningTrace?.decisionSummary, "Convergence Judge selected retained material.");
  assert.equal(handoff?.reasoningTrace, undefined);
  assert.equal(JSON.stringify(notes).includes("raw provider response"), false);
  assert.equal(JSON.stringify(notes).includes("raw prompt"), false);
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
    traceId: "trace-panel-work-notes",
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
      finishReason: "stop",
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
