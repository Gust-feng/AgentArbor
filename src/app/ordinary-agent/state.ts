import { persistedModelProtocolExtensions, type ModelMessage, type ModelUsage } from "../../domain/intelligence/index.js";
import type { RunCapabilityResolution } from "../../domain/config/index.js";
import { toolCallFactId, type ToolCallRequest, type ToolCallResult } from "../../domain/tools/index.js";
import { canonicalToolResultMessage } from "../model-runtime/tool-result-message.js";
import type {
  OrdinaryRunBirth,
  OrdinaryRunEvent,
  OrdinaryRunInput,
  OrdinaryRunState,
  OrdinaryRunStatus,
  OrdinaryRunTurn,
} from "./contracts.js";
import { OrdinaryFeatureError } from "./contracts.js";

export type OrdinaryRunTransition =
  | { readonly type: "start"; readonly priorCanonicalMessages?: readonly ModelMessage[] }
  | { readonly type: "record_reasoning"; readonly modelRequestId: string; readonly content: string }
  | {
      readonly type: "request_approval";
      readonly status: Extract<OrdinaryRunStatus, { readonly kind: "awaiting_approval" }>;
      readonly canonicalMessages: readonly ModelMessage[];
      readonly toolCalls: readonly ToolCallResult[];
      readonly usage: ModelUsage;
      readonly capabilityResolution?: RunCapabilityResolution;
    }
  | { readonly type: "approval_decided"; readonly decision: import("../../domain/confirmation/index.js").ConfirmationDecision }
  | {
      readonly type: "complete";
      readonly answer: string;
      readonly canonicalMessages: readonly ModelMessage[];
      readonly toolCalls: readonly ToolCallResult[];
      readonly usage: ModelUsage;
      readonly capabilityResolution?: RunCapabilityResolution;
    }
  | {
      readonly type: "fail";
      readonly error: { readonly code: string; readonly message: string };
      readonly canonicalMessages?: readonly ModelMessage[];
      readonly toolCalls?: readonly ToolCallResult[];
      readonly usage?: ModelUsage;
      readonly capabilityResolution?: RunCapabilityResolution;
    }
  | {
      readonly type: "cancel";
      readonly reason: string;
      readonly canonicalMessages?: readonly ModelMessage[];
      readonly toolCalls?: readonly ToolCallResult[];
      readonly usage?: ModelUsage;
      readonly capabilityResolution?: RunCapabilityResolution;
    }
  | {
      readonly type: "block";
      readonly reason: { readonly code: string; readonly message: string };
      readonly continueBy: "new_turn";
      readonly canonicalMessages?: readonly ModelMessage[];
      readonly toolCalls?: readonly ToolCallResult[];
    };

export function createInitialOrdinaryRunState(input: {
  readonly runId: string;
  readonly turn: OrdinaryRunTurn;
  readonly runInput: OrdinaryRunInput;
  readonly birth: OrdinaryRunBirth;
  readonly priorCanonicalMessages?: readonly ModelMessage[];
  readonly recordedAt: string;
  readonly eventId: string;
}): OrdinaryRunState {
  if (input.runId.length === 0 || input.turn.conversationId.length === 0 ||
      input.turn.userTurnId.length === 0 || input.turn.assistantTurnId.length === 0) {
    throw new Error("Ordinary run and turn identities must not be empty");
  }
  const canonicalMessages = persistableMessages([
    ...(input.priorCanonicalMessages ?? []),
    { role: "user", content: input.runInput.userMessage },
  ]);
  return {
    runId: input.runId,
    turn: cloneJson(input.turn),
    input: cloneJson(input.runInput),
    birth: cloneJson(input.birth),
    status: { kind: "queued" },
    canonicalMessages,
    toolCalls: [],
    toolResultRecordedAt: {},
    usage: {},
    timeline: [{
      eventId: input.eventId,
      runId: input.runId,
      sequence: 1,
      type: "run.created",
      recordedAt: input.recordedAt,
    }],
    timestamps: { createdAt: input.recordedAt, updatedAt: input.recordedAt },
  };
}

export function transitionOrdinaryRun(input: {
  readonly state: OrdinaryRunState;
  readonly transition: OrdinaryRunTransition;
  readonly recordedAt: string;
  readonly eventId: string;
}): OrdinaryRunState {
  const nextStatus = statusAfter(input.state.status, input.transition);
  const terminalAt = isTerminal(nextStatus) ? input.recordedAt : undefined;
  const event = eventForTransition({
    eventId: input.eventId,
    runId: input.state.runId,
    sequence: nextSequence(input.state.timeline),
    recordedAt: input.recordedAt,
  }, input.transition);
  const nextState: OrdinaryRunState = {
    ...input.state,
    status: nextStatus,
    canonicalMessages: messagesAfter(input.state, input.transition),
    pendingToolRound: pendingToolRoundAfter(input.state, input.transition),
    toolCalls: toolCallsAfter(input.state, input.transition),
    toolResultRecordedAt: toolResultRecordedAtAfter(input.state, input.transition, input.recordedAt),
    usage: usageAfter(input.state, input.transition),
    capabilityResolution: capabilityResolutionAfter(input.state, input.transition),
    timeline: [...input.state.timeline, event],
    timestamps: {
      ...input.state.timestamps,
      updatedAt: input.recordedAt,
      terminalAt,
    },
  };
  assertAwaitingApprovalFacts(nextState);
  return nextState;
}

/**
 * An approval pause is only meaningful when it names the exact tool facts that
 * are waiting. Keep this transition invariant aligned with the durable v3
 * snapshot contract so malformed execution ports fail before persistence.
 */
function assertAwaitingApprovalFacts(state: OrdinaryRunState): void {
  if (state.status.kind !== "awaiting_approval") return;
  const approvalFacts = state.toolCalls.filter((result) => result.status === "approval_required");
  const requestsById = new Map(state.status.confirmationRequests.map((request) =>
    [request.confirmationId, request] as const));
  const factsByConfirmationId = new Map(approvalFacts.flatMap((result) => {
    const request = result.confirmationRequest;
    if (request === undefined || request.toolCallFactId !== toolCallFactId(result)) return [];
    return [[request.confirmationId, request] as const];
  }));
  if (requestsById.size !== state.status.confirmationRequests.length ||
      factsByConfirmationId.size !== approvalFacts.length ||
      requestsById.size !== factsByConfirmationId.size ||
      [...requestsById].some(([confirmationId, request]) =>
        JSON.stringify(request) !== JSON.stringify(factsByConfirmationId.get(confirmationId)))) {
    throw new OrdinaryFeatureError(
      "ordinary_run_state_conflict",
      "An Ordinary approval pause must match its approval tool facts one-to-one",
    );
  }
}

function statusAfter(status: OrdinaryRunStatus, transition: OrdinaryRunTransition): OrdinaryRunStatus {
  switch (transition.type) {
    case "start":
      assertStatus(status, ["queued"], transition.type);
      return { kind: "running" };
    case "record_reasoning":
      assertStatus(status, ["running"], transition.type);
      if (transition.content.length === 0) throw new Error("Recorded model reasoning must not be empty");
      return status;
    case "request_approval":
      assertStatus(status, ["running"], transition.type);
      if (transition.status.confirmationRequests.length === 0) {
        throw new Error("An approval pause must contain at least one confirmation request");
      }
      return cloneJson(transition.status);
    case "approval_decided":
      assertStatus(status, ["awaiting_approval"], transition.type);
      return { kind: "running" };
    case "complete":
      assertStatus(status, ["running"], transition.type);
      return { kind: "completed", answer: transition.answer };
    case "fail":
      assertStatus(status, ["queued", "running"], transition.type);
      return { kind: "failed", error: cloneJson(transition.error) };
    case "cancel":
      assertStatus(status, ["queued", "running", "awaiting_approval"], transition.type);
      return { kind: "cancelled", reason: transition.reason };
    case "block":
      assertStatus(status, ["queued", "running", "awaiting_approval"], transition.type);
      return {
        kind: "blocked",
        reason: cloneJson(transition.reason),
        continueBy: transition.continueBy,
      };
  }
}

function messagesAfter(state: OrdinaryRunState, transition: OrdinaryRunTransition): readonly ModelMessage[] {
  if (transition.type === "start" && transition.priorCanonicalMessages !== undefined) {
    return persistableMessages([
      ...transition.priorCanonicalMessages,
      { role: "user", content: state.input.userMessage },
    ]);
  }
  if ("canonicalMessages" in transition && transition.canonicalMessages !== undefined) {
    // Never replace the write-ahead prefix with a partial assistant/tool group.
    if (state.pendingToolRound !== undefined && !canonicalMessagesResolveToolRound(
      transition.canonicalMessages,
      state.pendingToolRound.assistantMessage,
    )) {
      return state.canonicalMessages;
    }
    return persistableMessages(transition.canonicalMessages);
  }
  return state.canonicalMessages;
}

function pendingToolRoundAfter(
  state: OrdinaryRunState,
  transition: OrdinaryRunTransition,
): OrdinaryRunState["pendingToolRound"] {
  if (state.pendingToolRound === undefined) return undefined;
  if ("canonicalMessages" in transition && transition.canonicalMessages !== undefined &&
      canonicalMessagesResolveToolRound(transition.canonicalMessages, state.pendingToolRound.assistantMessage)) {
    return undefined;
  }
  return state.pendingToolRound;
}

function canonicalMessagesResolveToolRound(
  messages: readonly ModelMessage[],
  assistantMessage: ModelMessage,
): boolean {
  const expectedCalls = assistantMessage.toolCalls ?? [];
  const assistantIndex = [...messages].reverse().findIndex((message) =>
    message.role === "assistant" && JSON.stringify(message.toolCalls ?? []) === JSON.stringify(expectedCalls));
  if (assistantIndex < 0) return false;
  const absoluteIndex = messages.length - assistantIndex - 1;
  return expectedCalls.every((call, index) => {
    const result = messages[absoluteIndex + index + 1];
    return result?.role === "tool" && result.toolCallId === call.callId && result.toolName === call.toolName;
  });
}

function toolCallsAfter(state: OrdinaryRunState, transition: OrdinaryRunTransition): readonly ToolCallResult[] {
  if ("toolCalls" in transition && transition.toolCalls !== undefined) {
    return mergeOrdinaryToolResults(state.toolCalls, transition.toolCalls);
  }
  return state.toolCalls;
}

function toolResultRecordedAtAfter(
  state: OrdinaryRunState,
  transition: OrdinaryRunTransition,
  recordedAt: string,
): Readonly<Record<string, string>> {
  if (!("toolCalls" in transition) || transition.toolCalls === undefined) {
    return state.toolResultRecordedAt;
  }
  const next = { ...state.toolResultRecordedAt };
  for (const result of transition.toolCalls) {
    next[ordinaryToolResultKey(result)] ??= recordedAt;
  }
  return next;
}

/** Durably accepts one validated root assistant turn before any tool enters preflight. */
export function acceptOrdinaryToolRound(input: {
  readonly state: OrdinaryRunState;
  readonly canonicalMessagesBeforeRound: readonly ModelMessage[];
  readonly assistantMessage: ModelMessage;
  readonly acceptedAt: string;
}): OrdinaryRunState {
  if (input.state.status.kind !== "running") {
    throw new OrdinaryFeatureError(
      "ordinary_run_state_conflict",
      `Ordinary run ${input.state.runId} cannot accept a tool round while ${input.state.status.kind}`,
    );
  }
  const rawCalls = input.assistantMessage.toolCalls ?? [];
  if (rawCalls.some((call) => call.factId !== undefined && call.factId !== call.callId)) {
    throw new OrdinaryFeatureError(
      "ordinary_run_state_conflict",
      "An Ordinary root tool round cannot contain a nested tool fact identity",
    );
  }
  const canonicalMessages = persistableMessages(input.canonicalMessagesBeforeRound);
  const assistantMessage = persistableMessages([input.assistantMessage])[0]!;
  if (assistantMessage.role !== "assistant" || (assistantMessage.toolCalls?.length ?? 0) === 0) {
    throw new Error("An Ordinary pending tool round requires an assistant message with tool calls");
  }
  const callIds = assistantMessage.toolCalls!.map((call) => call.callId);
  if (new Set(callIds).size !== callIds.length) {
    throw new Error("An Ordinary pending tool round cannot contain duplicate tool call identities");
  }
  if (input.state.pendingToolRound !== undefined) {
    if (JSON.stringify(input.state.pendingToolRound.assistantMessage) === JSON.stringify(assistantMessage) &&
        JSON.stringify(input.state.canonicalMessages) === JSON.stringify(canonicalMessages)) {
      return input.state;
    }
    throw new OrdinaryFeatureError(
      "ordinary_run_state_conflict",
      `Ordinary run ${input.state.runId} already has an unresolved tool round`,
    );
  }
  const committedCallIds = new Set(canonicalMessages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []).map((call) => call.callId) : []));
  if (callIds.some((callId) => committedCallIds.has(callId) || rootToolResultByCallId(input.state.toolCalls, callId) !== undefined)) {
    throw new OrdinaryFeatureError(
      "ordinary_tool_result_conflict",
      `Ordinary run ${input.state.runId} cannot reuse a committed root tool call identity`,
    );
  }
  return {
    ...input.state,
    canonicalMessages,
    pendingToolRound: { assistantMessage, acceptedAt: input.acceptedAt },
    timestamps: { ...input.state.timestamps, updatedAt: input.acceptedAt },
  };
}

/** Records one tool fact and atomically commits a fully resolved root tool round. */
export function recordOrdinaryToolResult(input: {
  readonly state: OrdinaryRunState;
  readonly result: ToolCallResult;
  readonly recordedAt: string;
}): OrdinaryRunState {
  assertPendingRootResultIdentity(input.state, input.result);
  const key = ordinaryToolResultKey(input.result);
  const existing = input.state.toolCalls.find((result) =>
    toolCallFactId(result) === toolCallFactId(input.result));
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(input.result)) {
    return finalizeResolvedOrdinaryToolRound(input.state, input.recordedAt);
  }
  const recorded = {
    ...input.state,
    toolCalls: mergeOrdinaryToolResults(input.state.toolCalls, [input.result]),
    toolResultRecordedAt: {
      ...input.state.toolResultRecordedAt,
      [key]: input.state.toolResultRecordedAt[key] ?? input.recordedAt,
    },
    timestamps: {
      ...input.state.timestamps,
      updatedAt: input.recordedAt,
    },
  };
  return finalizeResolvedOrdinaryToolRound(recorded, input.recordedAt);
}

function assertPendingRootResultIdentity(state: OrdinaryRunState, result: ToolCallResult): void {
  if (result.factId !== undefined && result.factId !== result.callId) return;
  const pendingCalls = state.pendingToolRound?.assistantMessage.toolCalls ?? [];
  const pendingCall = pendingCalls.find((call) => call.callId === result.callId);
  if (pendingCall === undefined) return;
  if (pendingCall.toolName !== result.toolName || JSON.stringify(pendingCall.input) !== JSON.stringify(result.input)) {
    throw new OrdinaryFeatureError(
      "ordinary_tool_result_conflict",
      `Ordinary root tool result ${result.callId} does not match its accepted assistant call`,
    );
  }
}

/**
 * Closes a durable write-ahead round after its live execution owner is gone.
 * Missing results are explicitly unknown and therefore must never be replayed.
 */
export function reconcileInterruptedOrdinaryToolRound(input: {
  readonly state: OrdinaryRunState;
  readonly recordedAt: string;
}): OrdinaryRunState {
  const pending = input.state.pendingToolRound;
  if (pending === undefined) return input.state;
  let state = input.state;
  for (const call of pending.assistantMessage.toolCalls ?? []) {
    const existing = rootToolResultByCallId(state.toolCalls, call.callId);
    if (existing !== undefined && !toolResultMatchesAcceptedCall(existing, call)) {
      throw new OrdinaryFeatureError(
        "ordinary_tool_result_conflict",
        `Ordinary root tool result ${existing.callId} does not match its accepted assistant call`,
      );
    }
    if (existing !== undefined && existing.status !== "approval_required") continue;
    const result: ToolCallResult = existing?.status === "approval_required"
      ? interruptedOrdinaryApprovalResult(input.state, existing)
      : {
          callId: existing?.callId ?? call.callId,
          ...(existing?.factId === undefined ? {} : { factId: existing.factId }),
          toolName: existing?.toolName ?? call.toolName,
          input: cloneJson(existing?.input ?? call.input),
          output: undefined,
          status: "failed",
          error: "The process stopped before the tool outcome could be determined. Do not automatically retry this call.",
          errorDomain: "runtime_error",
          errorFacts: { code: "tool_execution_outcome_unknown", doNotBlindlyRetry: true },
          durationMs: existing?.durationMs ?? 0,
        };
    state = recordOrdinaryToolResult({ state, result, recordedAt: input.recordedAt });
  }
  return finalizeResolvedOrdinaryToolRound(state, input.recordedAt);
}

/** Closes one approval fact according to the exact durable decision, without replay. */
export function interruptedOrdinaryApprovalResult(
  state: OrdinaryRunState,
  result: ToolCallResult,
): ToolCallResult {
  if (result.status !== "approval_required") {
    throw new Error("Only an approval-required tool fact can be closed as a lost approval");
  }
  if (approvalFactWasNotExecuted(state, result)) {
    return {
      ...withoutConfirmationRequest(result),
      status: "cancelled",
      error: "The tool was not executed because its live confirmation continuation was lost.",
      errorDomain: "runtime_error",
      errorFacts: { code: "confirmation_continuation_lost" },
    };
  }
  return {
    ...withoutConfirmationRequest(result),
    status: "failed",
    error: "The process stopped before the approved tool outcome could be determined. Do not automatically retry this call.",
    errorDomain: "runtime_error",
    errorFacts: {
      ...(result.errorFacts ?? {}),
      code: "tool_execution_outcome_unknown",
      doNotBlindlyRetry: true,
    },
  };
}

function approvalFactWasNotExecuted(
  state: OrdinaryRunState,
  result: ToolCallResult,
): boolean {
  const confirmationId = result.confirmationRequest?.confirmationId;
  if (confirmationId === undefined) return false;
  const decision = [...state.timeline].reverse().find((event) =>
    event.type === "run.approval_decided" && event.decision.confirmationId === confirmationId);
  return decision === undefined || decision.type === "run.approval_decided" &&
    decision.decision.decision !== "approve_once";
}

function finalizeResolvedOrdinaryToolRound(
  state: OrdinaryRunState,
  recordedAt: string,
): OrdinaryRunState {
  const pending = state.pendingToolRound;
  if (pending === undefined) return state;
  const results = (pending.assistantMessage.toolCalls ?? []).map((call) => {
    const result = rootToolResultByCallId(state.toolCalls, call.callId);
    if (result !== undefined && !toolResultMatchesAcceptedCall(result, call)) {
      throw new OrdinaryFeatureError(
        "ordinary_tool_result_conflict",
        `Ordinary root tool result ${result.callId} does not match its accepted assistant call`,
      );
    }
    return result;
  });
  if (results.some((result) => result === undefined || result.status === "approval_required")) {
    return state;
  }
  return {
    ...state,
    canonicalMessages: persistableMessages([
      ...state.canonicalMessages,
      pending.assistantMessage,
      ...results.map((result) => canonicalToolResultMessage(result!)),
    ]),
    pendingToolRound: undefined,
    timestamps: { ...state.timestamps, updatedAt: recordedAt },
  };
}

function rootToolResultByCallId(
  results: readonly ToolCallResult[],
  callId: string,
): ToolCallResult | undefined {
  return [...results].reverse().find((result) =>
    result.callId === callId && (result.factId === undefined || result.factId === result.callId));
}

function toolResultMatchesAcceptedCall(result: ToolCallResult, call: ToolCallRequest): boolean {
  return result.toolName === call.toolName && JSON.stringify(result.input) === JSON.stringify(call.input);
}

function withoutConfirmationRequest(
  result: ToolCallResult,
): Omit<ToolCallResult, "confirmationRequest" | "status"> {
  const { confirmationRequest: _confirmationRequest, status: _status, ...base } = result;
  return base;
}

export function ordinaryToolResultKey(result: ToolCallResult): string {
  return `${toolCallFactId(result)}:${result.status}`;
}

function mergeOrdinaryToolResults(
  existing: readonly ToolCallResult[],
  incoming: readonly ToolCallResult[],
): readonly ToolCallResult[] {
  const merged = existing.map(cloneJson);
  const indexes = new Map(merged.map((result, index) => [toolCallFactId(result), index] as const));
  const normalizedIncoming: ToolCallResult[] = [];
  const incomingIndexes = new Map<string, number>();
  for (const result of incoming) {
    const stored = cloneJson(result);
    const factId = toolCallFactId(stored);
    const duplicateIndex = incomingIndexes.get(factId);
    if (duplicateIndex === undefined) {
      incomingIndexes.set(factId, normalizedIncoming.length);
      normalizedIncoming.push(stored);
    } else {
      normalizedIncoming[duplicateIndex] = stored;
    }
  }
  for (const stored of normalizedIncoming) {
    const factId = toolCallFactId(stored);
    const index = indexes.get(factId);
    if (index === undefined) {
      indexes.set(factId, merged.length);
      merged.push(stored);
      continue;
    }
    const current = merged[index]!;
    if (JSON.stringify(current) === JSON.stringify(stored)) continue;
    if (current.status === "approval_required" && stored.status !== "approval_required") {
      merged[index] = stored;
      continue;
    }
    throw new OrdinaryFeatureError(
      "ordinary_tool_result_conflict",
      `Ordinary tool call ${stored.callId} already has a different resolved result`,
    );
  }
  return merged;
}

function eventForTransition(
  base: Omit<OrdinaryRunEvent, "type">,
  transition: OrdinaryRunTransition,
): OrdinaryRunEvent {
  switch (transition.type) {
    case "start": return { ...base, type: "run.started" };
    case "record_reasoning": return {
      ...base,
      type: "model.reasoning.completed",
      modelRequestId: transition.modelRequestId,
      content: transition.content,
    };
    case "request_approval": return {
      ...base,
      type: "run.approval_requested",
      confirmationRequests: cloneJson(transition.status.confirmationRequests),
      toolCallIds: transition.toolCalls.map(toolCallFactId),
    };
    case "approval_decided": return {
      ...base,
      type: "run.approval_decided",
      decision: cloneJson(transition.decision),
    };
    case "complete": return { ...base, type: "run.completed", toolCallIds: transition.toolCalls.map(toolCallFactId) };
    case "fail": return {
      ...base,
      type: "run.failed",
      code: transition.error.code,
      toolCallIds: (transition.toolCalls ?? []).map(toolCallFactId),
    };
    case "cancel": return {
      ...base,
      type: "run.cancelled",
      reason: transition.reason,
      toolCallIds: (transition.toolCalls ?? []).map(toolCallFactId),
    };
    case "block": return { ...base, type: "run.blocked", code: transition.reason.code };
  }
}

function usageAfter(state: OrdinaryRunState, transition: OrdinaryRunTransition): ModelUsage {
  return "usage" in transition && transition.usage !== undefined
    ? cloneJson(transition.usage)
    : state.usage;
}

function capabilityResolutionAfter(
  state: OrdinaryRunState,
  transition: OrdinaryRunTransition,
): RunCapabilityResolution | undefined {
  return "capabilityResolution" in transition && transition.capabilityResolution !== undefined
    ? cloneJson(transition.capabilityResolution)
    : state.capabilityResolution;
}

function assertStatus(status: OrdinaryRunStatus, allowed: readonly OrdinaryRunStatus["kind"][], action: string): void {
  if (!allowed.includes(status.kind)) {
    throw new Error(`Cannot ${action} an Ordinary run in ${status.kind} status`);
  }
}

function isTerminal(status: OrdinaryRunStatus): boolean {
  return status.kind === "completed" || status.kind === "failed" ||
    status.kind === "cancelled" || status.kind === "blocked";
}

function nextSequence(events: readonly OrdinaryRunEvent[]): number {
  return (events.at(-1)?.sequence ?? 0) + 1;
}

export function persistableMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ref: message.ref,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    toolCalls: message.toolCalls?.map((call) => ({
      callId: call.callId,
      toolName: call.toolName,
      input: cloneJson(call.input),
    })),
    protocolExtensions: persistedModelProtocolExtensions(message.protocolExtensions),
  }));
}

function cloneJson<T>(value: T): T {
  return globalThis.structuredClone(value);
}
