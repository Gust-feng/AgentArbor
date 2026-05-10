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

test("panel transcript exposes delegation and parent synthesis as semantic stream events", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-fabric",
    status: "running",
    eventEntries: [
      eventEntry({
        sequence: 1,
        type: "agent.delegation.planned",
        payload: {
          decisionId: "delegation-1",
          delegationDecision: {
            decisionId: "delegation-1",
            action: "spawn_children",
          },
          childSpecIds: ["spec-rootlet-option"],
        },
      }),
      eventEntry({
        sequence: 2,
        type: "agent.child.started",
        payload: {
          childRunId: "child-run-option",
          agentSpec: {
            specId: "spec-rootlet-option",
            agentId: "rootlet-explorer-option",
            displayName: "Rootlet option",
          },
          childRun: {
            childRunId: "child-run-option",
            status: "running",
          },
        },
      }),
      eventEntry({
        sequence: 3,
        type: "agent.parent_synthesis.completed",
        payload: {
          synthesisId: "parent-synthesis-1",
          parentSynthesis: {
            synthesisId: "parent-synthesis-1",
            decisionSummary: "Parent synthesized child material without raw provider output.",
            nextAction: "request_convergence",
          },
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.deepEqual(
    transcript.events.map((event) => event.type).filter((type) => type.startsWith("agent.")),
    ["agent.delegation.planned", "agent.child.started", "agent.parent_synthesis.completed"],
  );
  assert.equal(
    transcript.events.some((event) => event.sourceRefs.includes("agent_delegation:delegation-1")),
    true,
  );
  assert.equal(JSON.stringify(transcript).includes("raw provider response"), false);
});

test("panel transcript projects confirmation and user guidance as safe ordinary-agent events", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-confirmation",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({
        sequence: 1,
        type: "goal.received",
        payload: { goalId: "goal-confirmation" },
      }),
      eventEntry({
        sequence: 2,
        type: "user_approval.requested",
        payload: {
          confirmationId: "confirmation-1",
          question: "请选择要读取的文件。",
          consequence: "未授权前不会读取本地文件。",
        },
      }),
      eventEntry({
        sequence: 3,
        type: "user_approval.received",
        payload: {
          confirmationId: "confirmation-1",
          decision: "拒绝",
          note: "先不要读取，直接说明需要哪些材料。",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ["run.started", "confirmation.needed", "user.guidance", "final.result"],
  );
  assert.equal(transcript.events[1]?.summary?.includes("请选择要读取的文件"), true);
  assert.equal(transcript.events[2]?.summary?.includes("先不要读取"), true);
  assert.equal(JSON.stringify(transcript).includes("raw prompt"), false);
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

function eventEntry(input: {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly payload: Record<string, unknown>;
}): EventLogEntry {
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-panel-fabric",
    from: { id: "underground-center-manager", role: "underground_center" },
    to: { group: "underground-center" },
    type: input.type,
    intent: input.type.replaceAll(".", "_"),
    payload: input.payload,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type: input.type,
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
