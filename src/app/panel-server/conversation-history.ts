import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type {
  DesktopAgentConversationMessage,
} from "../desktop-agent/desktop-agent-session-contracts.js";
import { readRuntimeSnapshotWithOrdinaryContract } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { modelContextMessagesForNextTurn } from "../basic-agent-runtime/model-context.js";
import type { PanelConversation, PanelConversationReadModel, PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import type { PanelRunJob, PanelRunJobStore } from "./run-jobs.js";
import { normalizeModelFacingText } from "../text-projection/visible-text-safety.js";

export type PanelConversationHistorySource = {
  readonly conversations: PanelConversationStore;
  readonly runJobs: PanelRunJobStore;
  readonly runtimeDatabase?: Pick<RuntimeDatabase, "getRun">;
};

export async function buildConversationSkillRoutingHistory(input: {
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

export async function buildConversationPriorModelContext(input: {
  readonly source: PanelConversationHistorySource;
  readonly conversationId: string | undefined;
  readonly assistantTurnId: string | undefined;
}): Promise<readonly ModelMessage[]> {
  if (input.conversationId === undefined) {
    return [];
  }
  const conversation = input.source.conversations.get(input.conversationId);
  if (conversation === undefined) {
    return [];
  }
  const assistantIndex = input.assistantTurnId === undefined
    ? conversation.turns.length
    : conversation.turns.findIndex((turn) => turn.turnId === input.assistantTurnId);
  if (input.assistantTurnId !== undefined && assistantIndex < 0) {
    return [];
  }
  const previousAssistants = [...conversationHistoryTurnsBeforeCurrentUser(conversation, assistantIndex)]
    .reverse()
    .filter((turn) => turn.role === "assistant");
  for (const turn of previousAssistants) {
    const runId = turn.runId;
    if (runId === undefined) {
      continue;
    }
    const liveJob = input.source.runJobs.get(runId);
    if (liveJob !== undefined) {
      const messages = modelContextMessagesForNextTurn(liveOrdinaryModelContext(liveJob));
      if (messages.length > 0) {
        return messages;
      }
      continue;
    }
    const snapshot = await readRuntimeSnapshotWithOrdinaryContract(input.source.runtimeDatabase, runId);
    const messages = modelContextMessagesForNextTurn(snapshot?.ordinaryModelContext);
    if (messages.length > 0) {
      return messages;
    }
  }
  return [];
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
  const snapshot = await readRuntimeSnapshotWithOrdinaryContract(source.runtimeDatabase, turn.runId);
  if (snapshot !== undefined) {
    return snapshot.run.status === "completed";
  }
  return true;
}

function liveOrdinaryModelContext(job: PanelRunJob) {
  return job.completed?.ordinaryModelContext ??
    job.failed?.ordinaryModelContext ??
    job.blocked?.ordinaryModelContext ??
    job.cancelled?.ordinaryModelContext;
}

function conversationHistoryContentForModel(
  turn: PanelConversationReadModel["turns"][number]
): string {
  return normalizeModelFacingText(turn.content).trim();
}
