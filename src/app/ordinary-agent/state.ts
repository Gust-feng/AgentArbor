import { persistedModelProtocolExtensions, type ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type {
  OrdinaryRunBirth,
  OrdinaryRunEvent,
  OrdinaryRunInput,
  OrdinaryRunState,
  OrdinaryRunStatus,
  OrdinaryRunTurn,
} from "./contracts.js";

export type OrdinaryRunTransition =
  | { readonly type: "start" }
  | {
      readonly type: "request_approval";
      readonly status: Extract<OrdinaryRunStatus, { readonly kind: "awaiting_approval" }>;
      readonly canonicalMessages: readonly ModelMessage[];
      readonly toolCalls: readonly ToolCallResult[];
    }
  | { readonly type: "approval_decided"; readonly decision: import("../../domain/confirmation/index.js").ConfirmationDecision }
  | {
      readonly type: "complete";
      readonly answer: string;
      readonly canonicalMessages: readonly ModelMessage[];
      readonly toolCalls: readonly ToolCallResult[];
    }
  | {
      readonly type: "fail";
      readonly error: { readonly code: string; readonly message: string };
      readonly canonicalMessages?: readonly ModelMessage[];
      readonly toolCalls?: readonly ToolCallResult[];
    }
  | {
      readonly type: "cancel";
      readonly reason: string;
      readonly canonicalMessages?: readonly ModelMessage[];
      readonly toolCalls?: readonly ToolCallResult[];
    }
  | {
      readonly type: "block";
      readonly reason: { readonly code: string; readonly message: string };
      readonly continueBy: "new_turn" | "retry";
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
  return {
    ...input.state,
    status: nextStatus,
    canonicalMessages: messagesAfter(input.state, input.transition),
    toolCalls: toolCallsAfter(input.state, input.transition),
    timeline: [...input.state.timeline, event],
    timestamps: {
      ...input.state.timestamps,
      updatedAt: input.recordedAt,
      terminalAt,
    },
  };
}

function statusAfter(status: OrdinaryRunStatus, transition: OrdinaryRunTransition): OrdinaryRunStatus {
  switch (transition.type) {
    case "start":
      assertStatus(status, ["queued"], transition.type);
      return { kind: "running" };
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
      assertStatus(status, ["awaiting_approval"], transition.type);
      return {
        kind: "blocked",
        reason: cloneJson(transition.reason),
        continueBy: transition.continueBy,
      };
  }
}

function messagesAfter(state: OrdinaryRunState, transition: OrdinaryRunTransition): readonly ModelMessage[] {
  if ("canonicalMessages" in transition && transition.canonicalMessages !== undefined) {
    return persistableMessages(transition.canonicalMessages);
  }
  return state.canonicalMessages;
}

function toolCallsAfter(state: OrdinaryRunState, transition: OrdinaryRunTransition): readonly ToolCallResult[] {
  if ("toolCalls" in transition && transition.toolCalls !== undefined) {
    return cloneJson(transition.toolCalls);
  }
  return state.toolCalls;
}

function eventForTransition(
  base: Omit<OrdinaryRunEvent, "type">,
  transition: OrdinaryRunTransition,
): OrdinaryRunEvent {
  switch (transition.type) {
    case "start": return { ...base, type: "run.started" };
    case "request_approval": return {
      ...base,
      type: "run.approval_requested",
      confirmationIds: transition.status.confirmationRequests.map((request) => request.confirmationId),
      toolCallIds: transition.toolCalls.map((call) => call.callId),
    };
    case "approval_decided": return {
      ...base,
      type: "run.approval_decided",
      confirmationId: transition.decision.confirmationId,
      decision: transition.decision.decision,
    };
    case "complete": return { ...base, type: "run.completed", toolCallIds: transition.toolCalls.map((call) => call.callId) };
    case "fail": return {
      ...base,
      type: "run.failed",
      code: transition.error.code,
      toolCallIds: (transition.toolCalls ?? []).map((call) => call.callId),
    };
    case "cancel": return {
      ...base,
      type: "run.cancelled",
      reason: transition.reason,
      toolCallIds: (transition.toolCalls ?? []).map((call) => call.callId),
    };
    case "block": return { ...base, type: "run.blocked", code: transition.reason.code };
  }
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
