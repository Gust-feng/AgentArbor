import type { RuntimeDatabase, RuntimeRunContinuationAvailability } from "../../domain/runtime-database/index.js";
import type { ToolCallEvidence } from "../../domain/basic-agent/index.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
} from "../desktop-agent/desktop-agent-session-contracts.js";
import type { PanelConversation, PanelConversationReadModel, PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import type { PanelRunJob, PanelRunJobStore } from "./run-jobs.js";
import { normalizeModelFacingText } from "../text-projection/visible-text-safety.js";
import { toolEvidenceFromRuntimeToolCalls, toolEvidenceFromStreamEvents } from "./basic-agent-read-models.js";

export type PanelConversationHistorySource = {
  readonly conversations: PanelConversationStore;
  readonly runJobs: PanelRunJobStore;
  readonly runtimeDatabase?: RuntimeDatabase;
};

export async function buildConversationHistoryMessages(input: {
  readonly source: PanelConversationHistorySource;
  readonly conversationId: string | undefined;
  readonly assistantTurnId: string | undefined;
}): Promise<readonly DesktopAgentConversationMessage[]> {
  if (input.conversationId === undefined) {
    return [];
  }
  const conversation = input.source.conversations.get(input.conversationId);
  if (conversation === undefined) {
    return [];
  }
  const assistantIndex =
    input.assistantTurnId === undefined
      ? conversation.turns.length
      : conversation.turns.findIndex((turn) => turn.turnId === input.assistantTurnId);
  if (input.assistantTurnId !== undefined && assistantIndex < 0) {
    return [];
  }
  const historyTurns = conversationHistoryTurnsBeforeCurrentUser(conversation, assistantIndex);
  const selectedTurns: Array<(typeof conversation.turns)[number]> = [];
  for (const turn of historyTurns) {
    if (turn.role === "user") {
      if (turn.status === "completed") {
        selectedTurns.push(turn);
      }
      continue;
    }
    if (await assistantTurnCanEnterModelHistory(input.source, turn)) {
      selectedTurns.push(turn);
    }
  }
  return selectedTurns
    .map((turn): DesktopAgentConversationMessage | undefined => {
      const content = conversationHistoryContentForModel(turn);
      if (content.length === 0) {
        return undefined;
      }
      return {
        role: turn.role,
        content,
        ref: `conversation:${conversation.conversationId}:turn:${turn.turnId}`,
      };
    })
    .filter((message): message is DesktopAgentConversationMessage => message !== undefined);
}

export async function buildConversationToolEvidence(input: {
  readonly source: PanelConversationHistorySource;
  readonly conversationId: string | undefined;
  readonly assistantTurnId: string | undefined;
}): Promise<readonly ToolCallEvidence[]> {
  if (input.conversationId === undefined) {
    return [];
  }
  const conversation = input.source.conversations.get(input.conversationId);
  if (conversation === undefined) {
    return [];
  }
  const assistantIndex =
    input.assistantTurnId === undefined
      ? conversation.turns.length
      : conversation.turns.findIndex((turn) => turn.turnId === input.assistantTurnId);
  if (input.assistantTurnId !== undefined && assistantIndex < 0) {
    return [];
  }
  const evidence: ToolCallEvidence[] = [];
  const seen = new Set<string>();
  for (const turn of conversationHistoryTurnsBeforeCurrentUser(conversation, assistantIndex)) {
    if (turn.role !== "assistant" || !(await assistantTurnCanProvideToolEvidence(input.source, turn))) {
      continue;
    }
    for (const item of await toolEvidenceForAssistantTurn(input.source, turn)) {
      const key = item.callId;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      evidence.push(item);
    }
  }
  return evidence.slice(-12);
}

export async function buildConversationInterruptedRunContexts(input: {
  readonly source: PanelConversationHistorySource;
  readonly conversationId: string | undefined;
  readonly assistantTurnId: string | undefined;
}): Promise<readonly DesktopAgentInterruptedRunContext[]> {
  if (input.conversationId === undefined) {
    return [];
  }
  const conversation = input.source.conversations.get(input.conversationId);
  if (conversation === undefined) {
    return [];
  }
  const assistantIndex =
    input.assistantTurnId === undefined
      ? conversation.turns.length
      : conversation.turns.findIndex((turn) => turn.turnId === input.assistantTurnId);
  if (input.assistantTurnId !== undefined && assistantIndex < 0) {
    return [];
  }
  const contexts: DesktopAgentInterruptedRunContext[] = [];
  for (const turn of conversationHistoryTurnsBeforeCurrentUser(conversation, assistantIndex)) {
    const context = await interruptedRunContextForAssistantTurn(input.source, conversation, turn);
    if (context !== undefined) {
      contexts.push(context);
    }
  }
  return contexts.slice(-6);
}

function conversationHistoryTurnsBeforeCurrentUser(
  conversation: PanelConversation,
  assistantIndex: number
): readonly PanelConversation["turns"][number][] {
  const currentUserIndex =
    assistantIndex > 0 && conversation.turns[assistantIndex - 1]?.role === "user"
      ? assistantIndex - 1
      : assistantIndex;
  return conversation.turns.slice(0, currentUserIndex);
}

async function assistantTurnCanEnterModelHistory(
  source: PanelConversationHistorySource,
  turn: PanelConversationReadModel["turns"][number]
): Promise<boolean> {
  if (turn.role !== "assistant" || turn.status !== "completed") {
    return false;
  }
  if (turn.runId === undefined) {
    return true;
  }
  const liveJob = source.runJobs.get(turn.runId);
  if (liveJob !== undefined) {
    return liveJob.status === "completed";
  }
  const snapshot = await source.runtimeDatabase?.getRun(turn.runId);
  if (snapshot !== undefined) {
    return snapshot.run.status === "completed";
  }
  return true;
}

async function assistantTurnCanProvideToolEvidence(
  source: PanelConversationHistorySource,
  turn: PanelConversationReadModel["turns"][number]
): Promise<boolean> {
  if (turn.role !== "assistant" || turn.runId === undefined) {
    return false;
  }
  const liveJob = source.runJobs.get(turn.runId);
  if (liveJob !== undefined) {
    return liveRunCanProvideHistoricalToolEvidence(liveJob.status);
  }
  const snapshot = await source.runtimeDatabase?.getRun(turn.runId);
  if (snapshot !== undefined) {
    return persistedRunCanProvideHistoricalToolEvidence(snapshot.run.status);
  }
  return assistantTurnStatusCanProvideToolEvidence(turn.status);
}

async function toolEvidenceForAssistantTurn(
  source: PanelConversationHistorySource,
  turn: PanelConversationReadModel["turns"][number]
): Promise<readonly ToolCallEvidence[]> {
  if (turn.runId === undefined) {
    return [];
  }
  const liveJob = source.runJobs.get(turn.runId);
  if (liveJob !== undefined && liveRunCanProvideHistoricalToolEvidence(liveJob.status)) {
    const liveEvidence = toolEvidenceFromStreamEvents(liveJob.streamEvents);
    if (liveEvidence.length > 0) {
      return liveEvidence;
    }
  }
  const snapshot = await source.runtimeDatabase?.getRun(turn.runId);
  return snapshot === undefined ? [] : toolEvidenceFromRuntimeToolCalls(snapshot.toolCalls);
}

async function interruptedRunContextForAssistantTurn(
  source: PanelConversationHistorySource,
  conversation: PanelConversation,
  turn: PanelConversationReadModel["turns"][number]
): Promise<DesktopAgentInterruptedRunContext | undefined> {
  if (turn.role !== "assistant" || turn.runId === undefined || !assistantTurnStatusCanProvideInterruptedContext(turn.status)) {
    return undefined;
  }
  const liveJob = source.runJobs.get(turn.runId);
  const snapshot = liveJob === undefined ? await source.runtimeDatabase?.getRun(turn.runId) : undefined;
  const turnContent = conversationHistoryContentForModel(turn);
  const stopReason = liveJob === undefined
    ? snapshot?.run.stopReason ?? snapshot?.run.error?.code ?? interruptedFallbackStopReason(turn.status)
    : liveRunStopReason(liveJob);
  const continuationAvailability = liveJob === undefined
    ? snapshot?.run.continuationAvailability ?? continuationAvailabilityForStopReason(stopReason, turn.status)
    : liveRunContinuationAvailability(liveJob);
  const message = liveJob === undefined
    ? snapshot?.run.error?.message ?? interruptedRunMessage(turnContent, stopReason)
    : liveRunMessage(liveJob) ?? interruptedRunMessage(turnContent, stopReason);
  return {
    runId: turn.runId,
    turnStatus: turn.status,
    stopReason,
    continuationAvailability,
    message,
    partialOutput: turnContent.length === 0 ? undefined : turnContent,
    refs: [
      `conversation:${conversation.conversationId}:turn:${turn.turnId}`,
      `run:${turn.runId}`,
    ],
  };
}

function assistantTurnStatusCanProvideInterruptedContext(
  status: PanelConversationReadModel["turns"][number]["status"]
): status is DesktopAgentInterruptedRunContext["turnStatus"] {
  return status === "blocked" || status === "needs_input";
}

function liveRunStopReason(job: PanelRunJob): string {
  if (job.status === "blocked") {
    return job.blocked?.reason.code ?? "blocked";
  }
  if (job.status === "failed") {
    return job.failed?.error.code ?? "failed";
  }
  if (job.status === "cancelled") {
    return job.cancelled?.reason.code ?? "cancelled";
  }
  if (job.status === "needs_input") {
    return "needs_input";
  }
  if (job.status === "approval_needed") {
    return "approval_required";
  }
  return job.status;
}

function liveRunMessage(job: PanelRunJob): string | undefined {
  if (job.status === "blocked") {
    return job.blocked?.reason.message;
  }
  if (job.status === "failed") {
    return job.failed?.error.message;
  }
  if (job.status === "cancelled") {
    return job.cancelled?.reason.message;
  }
  if (job.status === "needs_input") {
    return "Previous run requested additional user input.";
  }
  if (job.status === "approval_needed") {
    return "Previous run is waiting for a tool confirmation.";
  }
  return undefined;
}

function liveRunContinuationAvailability(job: PanelRunJob): RuntimeRunContinuationAvailability {
  if (job.status === "approval_needed") {
    return "live";
  }
  if (job.status === "needs_input") {
    return "new_turn";
  }
  if (job.status === "running" || job.status === "pending") {
    return "live";
  }
  return continuationAvailabilityForStopReason(liveRunStopReason(job), job.status);
}

function continuationAvailabilityForStopReason(
  stopReason: string | undefined,
  status: string
): RuntimeRunContinuationAvailability {
  if (status === "needs_input" || stopReason === "needs_input") {
    return "new_turn";
  }
  if (stopReason === "out_of_fuel" || stopReason === "context_overflow") {
    return "new_turn";
  }
  if (stopReason === "confirmation_continuation_lost") {
    return "lost_after_restart";
  }
  return "none";
}

function interruptedFallbackStopReason(status: DesktopAgentInterruptedRunContext["turnStatus"]): string {
  if (status === "needs_input") {
    return "needs_input";
  }
  return status;
}

function interruptedRunMessage(turnContent: string, stopReason: string | undefined): string | undefined {
  if (turnContent.length > 0) {
    return turnContent;
  }
  if (stopReason === undefined) {
    return undefined;
  }
  return `Previous run stopped with reason: ${stopReason}`;
}

function conversationHistoryContentForModel(
  turn: PanelConversationReadModel["turns"][number]
): string {
  return normalizeModelFacingText(turn.content).trim();
}

function liveRunCanProvideHistoricalToolEvidence(status: string): boolean {
  return (
    status === "approval_needed" ||
    status === "needs_input" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  );
}

function persistedRunCanProvideHistoricalToolEvidence(status: string): boolean {
  return liveRunCanProvideHistoricalToolEvidence(status) || status === "stopped";
}

function assistantTurnStatusCanProvideToolEvidence(status: string): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "needs_input";
}
