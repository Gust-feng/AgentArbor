import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import {
  createPanelTranscriptModelCalls,
  modelReasoningOutputOrUndefined,
  modelVisibleOutputOrUndefined,
  rootletKindFromAdviceContractId,
  safeReasoningOutputForPanel,
} from "./panel-transcript-model-calls.js";

test("panel transcript model calls merge request lifecycle into one safe projection", () => {
  const calls = createPanelTranscriptModelCalls([
    modelEvent({
      sequence: 1,
      type: "model.requested",
      requestId: "request-option",
      contractId: "underground.rootlet_candidate_advice.option.v2",
      purpose: "rootlet_candidate",
    }),
    modelEvent({
      sequence: 2,
      type: "model.completed",
      requestId: "request-option",
      responseId: "response-option",
      contractId: "underground.rootlet_candidate_advice.option.v2",
      purpose: "rootlet_candidate",
      visibleOutput: visibleOutput("underground.rootlet_candidate_advice.option.v2", "Option candidate"),
      reasoningOutput: {
        source: "openai_chat_reasoning_content",
        content: "Visible reasoning summary",
        truncated: false,
      },
    }),
  ], undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.requestId, "request-option");
  assert.equal(calls[0]?.responseId, "response-option");
  assert.equal(calls[0]?.status, "completed");
  assert.equal(calls[0]?.rootletKind, "option");
  assert.equal(calls[0]?.visibleOutput?.items[0]?.fields[0]?.value, "Option candidate");
  assert.equal(calls[0]?.reasoningOutput?.content, "Visible reasoning summary");
  assert.deepEqual(calls[0]?.eventRefs, ["message-1", "message-2"]);
});

test("panel transcript model calls preserve failed model metadata without raw output", () => {
  const calls = createPanelTranscriptModelCalls([
    modelEvent({
      sequence: 1,
      type: "model.requested",
      requestId: "request-risk",
      contractId: "underground.rootlet_candidate_advice.risk.v2",
      purpose: "rootlet_candidate",
    }),
    modelEvent({
      sequence: 2,
      type: "model.failed",
      requestId: "request-risk",
      failureKind: "provider_response",
      retryable: true,
      sanitizedErrorRef: "model-error:request-risk",
    }),
  ], undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.status, "failed");
  assert.equal(calls[0]?.rootletKind, "risk");
  assert.equal(calls[0]?.failureKind, "provider_response");
  assert.equal(calls[0]?.retryable, true);
  assert.equal(calls[0]?.sanitizedErrorRef, "model-error:request-risk");
  assert.equal(JSON.stringify(calls).includes("RAW_PROVIDER_SENTINEL"), false);
});

test("panel model output guards accept only validated visible output and display-safe reasoning", () => {
  assert.equal(
    rootletKindFromAdviceContractId("underground.rootlet_candidate_advice.evidence.v2"),
    "evidence"
  );
  assert.equal(rootletKindFromAdviceContractId("desktop.agent_response.v1"), undefined);
  assert.equal(modelVisibleOutputOrUndefined(visibleOutput("desktop.agent_response.v1", "Safe text"))?.contractId, "desktop.agent_response.v1");
  assert.equal(modelVisibleOutputOrUndefined({
    ...visibleOutput("desktop.agent_response.v1", "Unsafe text"),
    validationStatus: "failed",
  }), undefined);
  assert.equal(modelReasoningOutputOrUndefined({
    source: "provider_reasoning_content",
    content: "Provider-only reasoning",
    truncated: false,
  })?.content, "Provider-only reasoning");
  assert.equal(safeReasoningOutputForPanel({
    source: "provider_reasoning_content",
    content: "Provider-only reasoning",
    truncated: false,
  }), undefined);
  assert.equal(safeReasoningOutputForPanel({
    source: "openai_responses_reasoning_summary",
    content: "OpenAI summary",
    truncated: false,
  })?.content, "OpenAI summary");
});

function modelEvent(input: {
  readonly sequence: number;
  readonly type: Extract<ArborMessageType, "model.requested" | "model.completed" | "model.failed">;
  readonly requestId: string;
  readonly responseId?: string;
  readonly contractId?: string;
  readonly purpose?: string;
  readonly visibleOutput?: ModelVisibleOutputProjection;
  readonly reasoningOutput?: unknown;
  readonly failureKind?: string;
  readonly retryable?: boolean;
  readonly sanitizedErrorRef?: string;
}): EventLogEntry {
  const outputContract = input.contractId === undefined ? undefined : { contractId: input.contractId };
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-panel-model-calls",
    from: { id: "intelligence-channel", role: "underground_center" },
    to: { group: "underground-center" },
    type: input.type,
    intent: input.type.replaceAll(".", "_"),
    payload: {
      requestId: input.requestId,
      responseId: input.responseId,
      purpose: input.purpose,
      outputContract,
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "fake-model",
      outputKind: input.visibleOutput?.outputKind,
      validationStatus: input.visibleOutput?.validationStatus,
      visibleOutput: input.visibleOutput,
      reasoningOutput: input.reasoningOutput,
      failureKind: input.failureKind,
      retryable: input.retryable,
      sanitizedErrorRef: input.sanitizedErrorRef,
      rawProviderOutput: "RAW_PROVIDER_SENTINEL",
    },
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type: input.type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}

function visibleOutput(contractId: string, value: string): ModelVisibleOutputProjection {
  return {
    source: "structured_output",
    contractId,
    outputKind: "candidate",
    validationStatus: "passed",
    items: [
      {
        itemId: "item-1",
        fields: [
          { name: "summary", value, truncated: false },
        ],
      },
    ],
    truncated: false,
  };
}
