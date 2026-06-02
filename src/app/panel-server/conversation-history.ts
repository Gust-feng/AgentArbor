import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session-contracts.js";
import type { PanelConversationReadModel, PanelConversationStore } from "../panel-conversations.js";
import type { PanelRunJobStore } from "../panel-run-jobs.js";
import { sanitizeConversationHistoryText } from "../visible-text-safety.js";

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
  const currentUserIndex =
    assistantIndex > 0 && conversation.turns[assistantIndex - 1]?.role === "user"
      ? assistantIndex - 1
      : assistantIndex;
  const historyTurns: Array<(typeof conversation.turns)[number]> = [];
  for (const turn of conversation.turns.slice(0, currentUserIndex)) {
    if (turn.role === "user") {
      if (turn.status === "completed") {
        historyTurns.push(turn);
      }
      continue;
    }
    if (await assistantTurnCanEnterModelHistory(input.source, turn)) {
      historyTurns.push(turn);
    }
  }
  return historyTurns
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

function conversationHistoryContentForModel(
  turn: PanelConversationReadModel["turns"][number]
): string {
  const safeContent = compactConversationHistoryText(sanitizeConversationHistoryText(turn.content), 1_000);
  return compactConversationHistoryText(safeContent, 1_200);
}

function compactConversationHistoryText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
