import type { ArborMessageType } from "../domain/common.js";
import type { ObservationRef } from "../domain/observation/contracts.js";
import type { ToolCallResult } from "../domain/tools/contracts.js";
import { createId, nowIso } from "../kernel/id.js";
import type { AgentTurnRuntimeResult } from "../kernel/intelligence/agent-turn-runtime.js";
import type {
  CognitiveWorkSessionStep,
  WorkSessionDecision,
} from "./cognitive-work-session-contracts.js";
import { asRecord, optionalString, safeText, unique } from "./cognitive-work-session-safe.js";

export type RuntimeEventEntry = {
  readonly type: ArborMessageType;
  readonly message: {
    readonly payload: unknown;
  };
};

export function baseInputRefs(traceId: string, goalId: string, rootRunId: string): readonly ObservationRef[] {
  return [
    { kind: "trace", id: traceId },
    { kind: "goal", id: goalId },
    { kind: "agent_run", id: rootRunId },
  ];
}

export function refsFromTurn(turn: AgentTurnRuntimeResult): readonly string[] {
  return unique([turn.modelRequestId, turn.modelResponseId].filter((value): value is string => value !== undefined));
}

export function toolCallIdsFromTurn(turn: AgentTurnRuntimeResult): readonly string[] {
  return unique(turn.toolCalls.map((call) => call.callId));
}

export function createStepRecord(input: {
  readonly stepIndex: number;
  readonly decision: WorkSessionDecision;
  readonly status: CognitiveWorkSessionStep["status"];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly childRunIds: readonly string[];
  readonly synthesisId?: string;
  readonly summary?: string;
}): CognitiveWorkSessionStep {
  return {
    stepId: createId("work-session-step"),
    stepIndex: input.stepIndex,
    action: input.decision.action,
    status: input.status,
    summary: safeText(input.summary ?? input.decision.decisionSummary, 420),
    modelCallRefs: unique(input.modelCallRefs),
    toolCallRefs: unique(input.toolCallRefs),
    evidenceRefs: unique(input.evidenceRefs),
    childRunIds: unique(input.childRunIds),
    synthesisId: input.synthesisId,
    createdAt: nowIso(),
  };
}

export function evidenceRefsFromToolCalls(toolCalls: readonly ToolCallResult[]): readonly string[] {
  return unique(toolCalls.flatMap((call) => {
    const refs = [`tool-call:${call.callId}`];
    const output = asRecord(call.output);
    const searchResults = Array.isArray(output.results) ? output.results.map(asRecord) : [];
    for (const result of searchResults) {
      const refId = optionalString(result.refId);
      if (refId !== undefined) {
        refs.push(refId);
      }
    }
    const readResult = asRecord(output.result);
    const readRefId = optionalString(readResult.refId);
    if (readRefId !== undefined) {
      refs.push(readRefId);
    }
    const trace = asRecord(output.trace);
    const traceId = optionalString(trace.traceId);
    if (traceId !== undefined) {
      refs.push(`research-trace:${traceId}`);
    }
    return refs;
  }));
}

export function modelCallRefsFromEvents(eventEntries: readonly RuntimeEventEntry[]): readonly string[] {
  return unique(eventEntries.flatMap((entry) => {
    if (entry.type !== "model.requested" && entry.type !== "model.completed" && entry.type !== "model.failed") {
      return [];
    }
    const payload = asRecord(entry.message.payload);
    return [optionalString(payload.requestId), optionalString(payload.responseId)].filter((value): value is string => value !== undefined);
  }));
}

export function toolCallRefsFromEvents(eventEntries: readonly RuntimeEventEntry[]): readonly string[] {
  return unique(eventEntries.flatMap((entry) => {
    if (entry.type !== "tool.requested" && entry.type !== "tool.completed" && entry.type !== "tool.failed") {
      return [];
    }
    const payload = asRecord(entry.message.payload);
    return optionalString(payload.callId) === undefined ? [] : [optionalString(payload.callId) as string];
  }));
}
