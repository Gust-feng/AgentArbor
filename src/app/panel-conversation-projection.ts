import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { RuntimeConversationRecord } from "../domain/runtime-database/index.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";
import type {
  PanelConversation,
  PanelConversationCurrentRunReadModel,
  PanelConversationReadModel,
  PanelConversationSummaryReadModel,
  PanelConversationStatus,
  PanelConversationTurnModel,
  PanelConversationTurnRole,
  PanelConversationTurnStatus,
  TrimRuntimeConversationResult,
} from "./panel-conversation-contracts.js";

type ConversationProjectionTurn = {
  readonly role: PanelConversationTurnRole;
  readonly title: string;
  readonly content: string;
  readonly status: PanelConversationTurnStatus;
  readonly runId?: string;
};

type ConversationProjectionSource = {
  readonly currentRunId?: string;
  readonly queuedRunIds: readonly string[];
  readonly turns: readonly ConversationProjectionTurn[];
};

export function trimRuntimeConversationToClosedPairs(input: {
  readonly record: RuntimeConversationRecord;
  readonly completedRunIds?: ReadonlySet<string>;
}): TrimRuntimeConversationResult {
  const turns = closedTurnPrefix(input.record.turns, input.completedRunIds);
  const lastTurn = turns.at(-1);
  const lastAssistant = lastAssistantTurn(turns);
  const status = turns.length === 0 ? "idle" : "completed";
  const next: RuntimeConversationRecord = {
    ...input.record,
    turns,
    preview: conversationPreview(turns),
    currentAction: conversationCurrentAction({
      ...input.record,
      turns,
      currentRunId: undefined,
      queuedRunIds: [],
    }, status),
    nextStep: conversationNextStep({
      ...input.record,
      turns,
      currentRunId: undefined,
      queuedRunIds: [],
    }, status),
    status,
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

export function toConversationReadModel(
  conversation: PanelConversation,
  currentRun?: PanelConversationCurrentRunReadModel
): PanelConversationReadModel {
  return {
    ...toConversationSummary(conversation, currentRun),
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
    currentAction: compact(conversation.currentAction, 180),
    nextStep: compact(conversation.nextStep, 180),
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

export function toConversationSummary(
  conversation: PanelConversation,
  currentRun?: PanelConversationCurrentRunReadModel
): PanelConversationSummaryReadModel {
  const requiresUserAction = conversationRequiresUserAction(conversation);
  const status = conversationStatus(conversation);
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    preview: conversationPreview(conversation.turns),
    currentAction: conversationCurrentAction(conversation, status),
    nextStep: conversationNextStep(conversation, status),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    status,
    activeRunId: conversation.currentRunId,
    latestRunId: conversation.latestRunId,
    requiresUserAction,
    queuedRunIds: [...conversation.queuedRunIds],
    queuedRunCount: conversation.queuedRunIds.length,
    currentRun,
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
  return turn.status === "completed" || turn.status === "failed" || turn.status === "blocked" || turn.status === "needs_input";
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
  const status = conversationStatus(conversation);
  if (status === "approval_needed" || status === "needs_input" || status === "blocked") {
    return true;
  }
  const lastAssistant = lastAssistantTurn(conversation.turns);
  if (lastAssistant === undefined) {
    return false;
  }
  const text = `${lastAssistant.title}\n${lastAssistant.content}`;
  return /需要确认|需要你判断|请选择|补充授权|补充材料|待确认|待处理/.test(text);
}

function conversationStatus(conversation: PanelConversation): PanelConversationStatus {
  const activeAssistant = conversation.currentRunId === undefined
    ? undefined
    : assistantTurnByRunId(conversation, conversation.currentRunId);
  if (activeAssistant?.status === "running" && isApprovalAssistantTitle(activeAssistant.title)) {
    return "approval_needed";
  }
  if (activeAssistant?.status === "needs_input" || (activeAssistant?.status === "running" && activeAssistant.title === "需要补充")) {
    return "needs_input";
  }
  const lastAssistant = lastAssistantTurn(conversation.turns);
  if (lastAssistant?.status === "running" && isApprovalAssistantTitle(lastAssistant.title)) {
    return "approval_needed";
  }
  if (lastAssistant?.status === "needs_input" || (lastAssistant?.status === "running" && lastAssistant.title === "需要补充")) {
    return "needs_input";
  }
  if (conversation.currentRunId !== undefined) {
    return "running";
  }
  if (conversation.queuedRunIds.length > 0) {
    return "pending";
  }
  if (lastAssistant === undefined) {
    return "idle";
  }
  if (lastAssistant.status === "failed") {
    return "failed";
  }
  if (lastAssistant.status === "blocked") {
    return "blocked";
  }
  if (lastAssistant.status === "completed" && lastAssistant.title === "需要补充") {
    return "needs_input";
  }
  if (lastAssistant.status === "completed") {
    return "completed";
  }
  return "idle";
}

function conversationCurrentAction(conversation: ConversationProjectionSource, status: PanelConversationStatus): string {
  const assistant = status === "pending"
    ? pendingAssistantTurn(conversation)
    : conversation.currentRunId === undefined
      ? lastAssistantTurn(conversation.turns)
      : assistantTurnByRunId(conversation, conversation.currentRunId) ?? lastAssistantTurn(conversation.turns);
  const assistantText = assistantVisibleSummary(assistant);
  if (status === "approval_needed") return compact(assistantText ?? "", 160);
  if (status === "needs_input") return compact(assistantText ?? "", 160);
  if (status === "pending") return compact(assistantText ?? "", 160);
  if (status === "running") return compact(assistantText ?? "", 160);
  if (status === "completed") return compact(assistantText ?? "", 160);
  if (status === "failed") return compact(assistantText ?? "", 160);
  if (status === "blocked") return compact(assistantText ?? "", 160);
  if (status === "cancelled") return "";
  return "";
}

function conversationNextStep(conversation: ConversationProjectionSource, status: PanelConversationStatus): string {
  void conversation;
  void status;
  return "";
}

function conversationPreview(turns: readonly ConversationProjectionTurn[]): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = turnVisibleSummary(turns[index]);
    if (text !== undefined) {
      return compact(text, 180);
    }
  }
  return "";
}

function turnVisibleSummary(turn: ConversationProjectionTurn | undefined): string | undefined {
  if (turn === undefined) {
    return undefined;
  }
  const content = firstNonEmpty([turn.content]);
  if (content !== undefined) {
    return content;
  }
  if (turn.role === "assistant") {
    return meaningfulAssistantTitle(turn.title);
  }
  return meaningfulUserTitle(turn.title);
}

function assistantVisibleSummary(turn: ConversationProjectionTurn | undefined): string | undefined {
  if (turn === undefined) {
    return undefined;
  }
  return firstNonEmpty([turn.content]) ?? meaningfulAssistantTitle(turn.title);
}

function meaningfulUserTitle(value: string): string | undefined {
  const title = firstNonEmpty([value]);
  if (title === undefined || title === "你的消息") {
    return undefined;
  }
  return title;
}

function meaningfulAssistantTitle(value: string): string | undefined {
  const title = firstNonEmpty([value]);
  if (title === undefined || ORDINARY_ASSISTANT_STATUS_TITLES.has(title)) {
    return undefined;
  }
  return title;
}

function pendingAssistantTurn(conversation: ConversationProjectionSource): ConversationProjectionTurn | undefined {
  return conversation.turns.find((turn) => turn.role === "assistant" && turn.status === "pending");
}

function assistantTurnByRunId(
  conversation: ConversationProjectionSource,
  runId: string
): ConversationProjectionTurn | undefined {
  const turn = conversation.turns.find((candidate) => candidate.role === "assistant" && candidate.runId === runId);
  return turn;
}

function isApprovalAssistantTitle(value: string): boolean {
  return value === "需要确认" || value === "待确认" || value === "需要你判断" || value === "待处理";
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

const ORDINARY_ASSISTANT_STATUS_TITLES = new Set([
  "助手",
  "等待回复",
  "正在回复",
  "继续处理",
  "正在使用工具",
  "工具已完成",
  "已完成",
  "未完成",
  "需要确认",
  "待确认",
  "需要你判断",
  "待处理",
  "需要补充",
  "需要处理",
]);
