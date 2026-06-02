import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { RuntimeConversationRecord } from "../domain/runtime-database/index.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";
import type {
  PanelConversation,
  PanelConversationReadModel,
  PanelConversationSummaryReadModel,
  PanelConversationTurnModel,
  PanelConversationTurnRole,
  TrimRuntimeConversationResult,
} from "./panel-conversation-contracts.js";

export function trimRuntimeConversationToClosedPairs(input: {
  readonly record: RuntimeConversationRecord;
  readonly completedRunIds?: ReadonlySet<string>;
}): TrimRuntimeConversationResult {
  const turns = closedTurnPrefix(input.record.turns, input.completedRunIds);
  const lastTurn = turns.at(-1);
  const lastAssistant = lastAssistantTurn(turns);
  const next: RuntimeConversationRecord = {
    ...input.record,
    turns,
    preview:
      lastTurn === undefined
        ? "开始后会显示在这里。"
        : compact(lastTurn.content || lastTurn.title, 180),
    status: turns.length === 0 ? "idle" : "completed",
    activeRunId: undefined,
    latestRunId: lastAssistant?.runId,
    requiresUserAction: false,
    queuedRunIds: [],
    queuedRunCount: 0,
    updatedAt: lastTurn?.updatedAt ?? input.record.updatedAt,
  };
  return {
    record: next,
    trimmed: JSON.stringify(next) !== JSON.stringify(input.record),
  };
}

export function toConversationReadModel(conversation: PanelConversation): PanelConversationReadModel {
  return {
    ...toConversationSummary(conversation),
    turns: conversation.turns.map((turn) => ({
      turnId: turn.turnId,
      role: turn.role,
      title: turn.title,
      content: turn.content,
      status: turn.status,
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
      runId: turn.runId,
      responseModel: normalizeTurnModel(turn.responseModel),
    })),
  };
}

export function toRuntimeConversationRecord(
  conversation: PanelConversationReadModel
): RuntimeConversationRecord {
  return {
    conversationId: conversation.conversationId,
    title: compact(conversation.title, 80),
    preview: compact(conversation.preview, 180),
    status: conversation.status,
    activeRunId: conversation.activeRunId,
    latestRunId: conversation.latestRunId,
    requiresUserAction: conversation.requiresUserAction === true,
    queuedRunIds: [...conversation.queuedRunIds],
    queuedRunCount: conversation.queuedRunCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    turns: conversation.turns.map((turn) => ({
      turnId: turn.turnId,
      role: turn.role,
      title: compact(turn.title, 120),
      content: compactMessageContent(
        turn.role === "assistant" ? sanitizeAssistantVisibleText(turn.content) : turn.content,
        8_000
      ),
      status: turn.status,
      runId: turn.runId,
      responseModel: normalizeTurnModel(turn.responseModel),
      createdAt: turn.createdAt,
      updatedAt: turn.updatedAt,
    })),
  };
}

export function turnModelFromConfig(config: SanitizedModelProviderConfig): PanelConversationTurnModel {
  return {
    profileId: config.profileId,
    label: config.label,
    providerKind: config.providerKind,
    protocolKind: config.protocolKind,
    baseUrl: config.baseUrl,
    model: config.model,
  };
}

export function toConversationSummary(conversation: PanelConversation): PanelConversationSummaryReadModel {
  const lastTurn = conversation.turns.at(-1);
  const preview =
    lastTurn === undefined
      ? "开始后会显示在这里。"
      : compact(lastTurn.content || lastTurn.title, 180);
  const requiresUserAction = conversationRequiresUserAction(conversation);
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    preview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    status: conversationStatus(conversation),
    activeRunId: conversation.currentRunId,
    latestRunId: conversation.latestRunId,
    requiresUserAction,
    queuedRunIds: [...conversation.queuedRunIds],
    queuedRunCount: conversation.queuedRunIds.length,
  };
}

export function normalizeTurnModel(
  value: PanelConversationTurnModel | undefined
): PanelConversationTurnModel | undefined {
  if (value === undefined || value.profileId.trim().length === 0) {
    return undefined;
  }
  return {
    profileId: value.profileId,
    label: emptyToUndefined(value.label),
    providerKind: emptyToUndefined(value.providerKind),
    protocolKind: emptyToUndefined(value.protocolKind),
    baseUrl: emptyToUndefined(value.baseUrl),
    model: emptyToUndefined(value.model),
  };
}

export function compact(value: string, maxLength: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function compactMessageContent(value: string, maxLength: number): string {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function closedTurnPrefix(
  turns: readonly RuntimeConversationRecord["turns"][number][],
  completedRunIds: ReadonlySet<string> | undefined
): readonly RuntimeConversationRecord["turns"][number][] {
  const selected: RuntimeConversationRecord["turns"][number][] = [];
  for (let index = 0; index + 1 < turns.length; index += 2) {
    const userTurn = turns[index];
    const assistantTurn = turns[index + 1];
    if (
      userTurn === undefined ||
      assistantTurn === undefined ||
      userTurn.role !== "user" ||
      assistantTurn.role !== "assistant" ||
      userTurn.status !== "completed" ||
      !isClosedAssistantTurn(assistantTurn)
    ) {
      break;
    }
    if (
      completedRunIds !== undefined &&
      assistantTurn.runId !== undefined &&
      assistantTurn.status === "completed" &&
      !completedRunIds.has(assistantTurn.runId)
    ) {
      break;
    }
    selected.push(userTurn, assistantTurn);
  }
  return selected;
}

function isClosedAssistantTurn(turn: RuntimeConversationRecord["turns"][number]): boolean {
  return turn.status === "completed" || turn.status === "failed";
}

function lastAssistantTurn<T extends { readonly role: PanelConversationTurnRole }>(turns: readonly T[]): T | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === "assistant") {
      return turn;
    }
  }
  return undefined;
}

function conversationRequiresUserAction(conversation: PanelConversation): boolean {
  const lastAssistant = lastAssistantTurn(conversation.turns);
  if (lastAssistant === undefined) {
    return false;
  }
  const text = `${lastAssistant.title}\n${lastAssistant.content}`;
  return /需要确认|请选择|补充授权|补充材料|待确认/.test(text);
}

function conversationStatus(conversation: PanelConversation): "idle" | "running" | "completed" | "failed" {
  if (conversation.currentRunId !== undefined || conversation.queuedRunIds.length > 0) {
    return "running";
  }
  const lastAssistant = lastAssistantTurn(conversation.turns);
  if (lastAssistant === undefined) {
    return "idle";
  }
  if (lastAssistant.status === "failed") {
    return "failed";
  }
  if (lastAssistant.status === "completed") {
    return "completed";
  }
  return "idle";
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
