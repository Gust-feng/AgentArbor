import { createId, nowIso } from "../kernel/id.js";
import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { RuntimeConversationRecord } from "../domain/runtime-database/index.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";
import { sanitizeAssistantVisibleText } from "./visible-text-safety.js";

export type PanelConversationTurnRole = "user" | "assistant";
export type PanelConversationTurnStatus = "pending" | "running" | "completed" | "failed";

export type PanelConversationTurn = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly createdAt: string;
  title: string;
  content: string;
  status: PanelConversationTurnStatus;
  updatedAt: string;
  runId?: string;
  responseModel?: PanelConversationTurnModel;
  taskSoilInput?: DesktopTaskSoilInput;
};

export type PanelConversationTurnModel = {
  readonly profileId: string;
  readonly label?: string;
  readonly providerKind?: string;
  readonly protocolKind?: string;
  readonly baseUrl?: string;
  readonly model?: string;
};

export type PanelConversation = {
  readonly conversationId: string;
  readonly createdAt: string;
  title: string;
  updatedAt: string;
  currentRunId?: string;
  latestRunId?: string;
  queuedRunIds: string[];
  turns: PanelConversationTurn[];
};

export type PanelConversationTurnReadModel = {
  readonly turnId: string;
  readonly role: PanelConversationTurnRole;
  readonly title: string;
  readonly content: string;
  readonly status: PanelConversationTurnStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runId?: string;
  readonly responseModel?: PanelConversationTurnModel;
};

export type PanelConversationReadModel = {
  readonly conversationId: string;
  readonly title: string;
  readonly preview: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly activeRunId?: string;
  readonly latestRunId?: string;
  readonly requiresUserAction: boolean;
  readonly queuedRunIds: readonly string[];
  readonly queuedRunCount: number;
  readonly turns: readonly PanelConversationTurnReadModel[];
};

export type PanelConversationSummaryReadModel = Omit<PanelConversationReadModel, "turns">;

export type TrimRuntimeConversationResult = {
  readonly record: RuntimeConversationRecord;
  readonly trimmed: boolean;
};

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

export class PanelConversationStore {
  private readonly conversations = new Map<string, PanelConversation>();

  list(): readonly PanelConversationSummaryReadModel[] {
    return [...this.conversations.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((conversation) => toConversationSummary(conversation));
  }

  get(conversationId: string): PanelConversation | undefined {
    return this.conversations.get(conversationId);
  }

  getReadModel(conversationId: string): PanelConversationReadModel | undefined {
    const conversation = this.get(conversationId);
    return conversation === undefined ? undefined : toConversationReadModel(conversation);
  }

  rollback(input: {
    readonly conversationId: string;
    readonly targetTurnId?: string;
    readonly stepsBack?: number;
    readonly keepCompletedPairs?: number;
  }): PanelConversationReadModel {
    const conversation = this.requireConversation(input.conversationId);
    const completedPairs = completedConversationPairs(conversation.turns);
    const keepPairCount = rollbackKeepPairCount({
      turns: conversation.turns,
      completedPairCount: completedPairs.length,
      targetTurnId: input.targetTurnId,
      stepsBack: input.stepsBack,
      keepCompletedPairs: input.keepCompletedPairs,
    });
    const keptTurns = completedPairs.slice(0, keepPairCount).flatMap((pair) => [pair.userTurn, pair.assistantTurn]);
    conversation.turns = keptTurns.map((turn) => ({ ...turn }));
    conversation.currentRunId = undefined;
    conversation.queuedRunIds = [];
    conversation.latestRunId = keptTurns.at(-1)?.role === "assistant" ? keptTurns.at(-1)?.runId : undefined;
    conversation.updatedAt = nowIso();
    return toConversationReadModel(conversation);
  }

  restore(record: RuntimeConversationRecord): PanelConversationReadModel {
    const existing = this.conversations.get(record.conversationId);
    if (existing !== undefined && existing.updatedAt.localeCompare(record.updatedAt) >= 0) {
      return toConversationReadModel(existing);
    }
    const conversation: PanelConversation = {
      conversationId: record.conversationId,
      createdAt: record.createdAt,
      title: compact(record.title, 80),
      updatedAt: record.updatedAt,
      currentRunId: record.activeRunId,
      latestRunId: record.latestRunId,
      queuedRunIds: [...record.queuedRunIds],
      turns: record.turns.map((turn) => ({
        turnId: turn.turnId,
        role: turn.role,
        title: compact(turn.title, 120),
        content: compactMessageContent(
          turn.role === "assistant" ? sanitizeAssistantVisibleText(turn.content) : turn.content,
          8_000
        ),
        status: turn.status,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        runId: turn.runId,
        responseModel: normalizeTurnModel(turn.responseModel),
      })),
    };
    this.conversations.set(conversation.conversationId, conversation);
    return toConversationReadModel(conversation);
  }

  createConversation(input?: {
    readonly title?: string;
  }): PanelConversation {
    const createdAt = nowIso();
    const conversation: PanelConversation = {
      conversationId: createId("conversation"),
      createdAt,
      title: compact(input?.title ?? "新对话", 80),
      updatedAt: createdAt,
      queuedRunIds: [],
      turns: [],
    };
    this.conversations.set(conversation.conversationId, conversation);
    return conversation;
  }

  startDesktopMessage(input: {
    readonly goal: string;
    readonly taskSoilInput?: DesktopTaskSoilInput;
    readonly conversationId?: string;
    readonly queueBehindRunId?: string;
  }): {
    readonly conversation: PanelConversation;
    readonly userTurn: PanelConversationTurn;
    readonly assistantTurn: PanelConversationTurn;
    readonly queueBehindRunId?: string;
  } {
    const conversation =
      input.conversationId === undefined
        ? this.createConversation({ title: input.goal })
        : this.requireConversation(input.conversationId);
    const queued = input.queueBehindRunId !== undefined;

    const userTurn = createTurn({
      role: "user",
      title: "你的消息",
      content: compactMessageContent(input.goal, 4_000),
      status: queued ? "pending" : "completed",
      taskSoilInput: input.taskSoilInput,
    });
    const assistantTurn = createTurn({
      role: "assistant",
      title: queued ? "等待回复" : "助手",
      content: "",
      status: queued ? "pending" : "running",
    });
    conversation.turns.push(userTurn, assistantTurn);
    conversation.title = deriveConversationTitle(conversation, input.goal);
    conversation.updatedAt = assistantTurn.updatedAt;
    return { conversation, userTurn, assistantTurn, queueBehindRunId: input.queueBehindRunId };
  }

  nextQueuePredecessor(conversationId: string | undefined): string | undefined {
    if (conversationId === undefined) {
      return undefined;
    }
    const conversation = this.get(conversationId);
    if (conversation === undefined) {
      return undefined;
    }
    return conversation.queuedRunIds.at(-1) ?? conversation.currentRunId;
  }

  queueRun(input: {
    readonly conversationId: string;
    readonly assistantTurnId: string;
    readonly runId: string;
    readonly responseModel?: PanelConversationTurnModel;
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.runId = input.runId;
    assistantTurn.responseModel = normalizeTurnModel(input.responseModel);
    assistantTurn.status = "pending";
    assistantTurn.title = "等待回复";
    assistantTurn.updatedAt = nowIso();
    if (!conversation.queuedRunIds.includes(input.runId)) {
      conversation.queuedRunIds.push(input.runId);
    }
    conversation.latestRunId = latestAssistantRunId(conversation) ?? input.runId;
    conversation.updatedAt = assistantTurn.updatedAt;
  }

  attachRun(input: {
    readonly conversationId: string;
    readonly assistantTurnId: string;
    readonly runId: string;
    readonly responseModel?: PanelConversationTurnModel;
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.runId = input.runId;
    assistantTurn.responseModel = normalizeTurnModel(input.responseModel);
    assistantTurn.status = "running";
    assistantTurn.title = "助手";
    assistantTurn.updatedAt = nowIso();
    conversation.currentRunId = input.runId;
    conversation.latestRunId = latestAssistantRunId(conversation) ?? input.runId;
    conversation.updatedAt = assistantTurn.updatedAt;
  }

  activateQueuedRun(conversationId: string, runId: string): void {
    const conversation = this.requireConversation(conversationId);
    conversation.queuedRunIds = conversation.queuedRunIds.filter((item) => item !== runId);
    const assistantTurn = conversation.turns.find((turn) => turn.role === "assistant" && turn.runId === runId);
    if (assistantTurn === undefined) {
      throw new Error(`Queued assistant turn not found for run: ${runId}`);
    }
    assistantTurn.status = "running";
    assistantTurn.title = "助手";
    assistantTurn.updatedAt = nowIso();
    const userTurn = previousUserTurn(conversation, assistantTurn.turnId);
    if (userTurn !== undefined && userTurn.status === "pending") {
      userTurn.status = "completed";
      userTurn.updatedAt = assistantTurn.updatedAt;
    }
    conversation.currentRunId = runId;
    conversation.latestRunId = runId;
    conversation.updatedAt = assistantTurn.updatedAt;
  }

  peekNextQueuedRunId(conversationId: string): string | undefined {
    return this.requireConversation(conversationId).queuedRunIds[0];
  }

  completeAssistantTurn(input: {
    readonly conversationId: string;
    readonly assistantTurnId: string;
    readonly runId: string;
    readonly title: string;
    readonly content: string;
    readonly status: "completed" | "failed";
    readonly responseModel?: PanelConversationTurnModel;
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.runId = input.runId;
    assistantTurn.responseModel = normalizeTurnModel(input.responseModel) ?? assistantTurn.responseModel;
    assistantTurn.title = compact(input.title, 120);
    assistantTurn.content = compactMessageContent(sanitizeAssistantVisibleText(input.content), 8_000);
    assistantTurn.status = input.status;
    assistantTurn.updatedAt = nowIso();
    conversation.latestRunId = latestAssistantRunId(conversation) ?? input.runId;
    conversation.currentRunId = conversation.currentRunId === input.runId ? undefined : conversation.currentRunId;
    conversation.queuedRunIds = conversation.queuedRunIds.filter((runId) => runId !== input.runId);
    conversation.updatedAt = assistantTurn.updatedAt;
  }

  markRunFinished(conversationId: string, runId: string): void {
    const conversation = this.requireConversation(conversationId);
    if (conversation.currentRunId === runId) {
      conversation.currentRunId = undefined;
      conversation.queuedRunIds = conversation.queuedRunIds.filter((item) => item !== runId);
      conversation.updatedAt = nowIso();
    }
  }

  updateAssistantPreview(input: {
    readonly conversationId: string;
    readonly assistantTurnId: string;
    readonly title: string;
    readonly content: string;
    readonly status: PanelConversationTurnStatus;
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.title = compact(input.title, 120);
    assistantTurn.content = compactMessageContent(sanitizeAssistantVisibleText(input.content), 8_000);
    assistantTurn.status = input.status;
    assistantTurn.updatedAt = nowIso();
    conversation.updatedAt = assistantTurn.updatedAt;
  }

  private requireConversation(conversationId: string): PanelConversation {
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      throw new Error(`Panel conversation not found: ${conversationId}`);
    }
    return conversation;
  }
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

function completedConversationPairs(turns: readonly PanelConversationTurn[]): readonly {
  readonly userTurn: PanelConversationTurn;
  readonly assistantTurn: PanelConversationTurn;
}[] {
  const pairs: Array<{ readonly userTurn: PanelConversationTurn; readonly assistantTurn: PanelConversationTurn }> = [];
  for (let index = 0; index + 1 < turns.length; index += 2) {
    const userTurn = turns[index];
    const assistantTurn = turns[index + 1];
    if (
      userTurn === undefined ||
      assistantTurn === undefined ||
      userTurn.role !== "user" ||
      assistantTurn.role !== "assistant" ||
      userTurn.status !== "completed" ||
      assistantTurn.status !== "completed"
    ) {
      break;
    }
    pairs.push({ userTurn, assistantTurn });
  }
  return pairs;
}

function rollbackKeepPairCount(input: {
  readonly turns: readonly PanelConversationTurn[];
  readonly completedPairCount: number;
  readonly targetTurnId?: string;
  readonly stepsBack?: number;
  readonly keepCompletedPairs?: number;
}): number {
  if (input.keepCompletedPairs !== undefined) {
    return clampInteger(input.keepCompletedPairs, 0, input.completedPairCount);
  }
  if (input.stepsBack !== undefined) {
    return clampInteger(input.completedPairCount - input.stepsBack, 0, input.completedPairCount);
  }
  if (input.targetTurnId !== undefined) {
    const turnIndex = input.turns.findIndex((turn) => turn.turnId === input.targetTurnId);
    if (turnIndex < 0) {
      throw new Error(`Panel conversation turn not found: ${input.targetTurnId}`);
    }
    return clampInteger(Math.floor((turnIndex + 1) / 2), 0, input.completedPairCount);
  }
  return Math.max(0, input.completedPairCount - 1);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createTurn(input: {
  readonly role: PanelConversationTurnRole;
  readonly title: string;
  readonly content: string;
  readonly status: PanelConversationTurnStatus;
  readonly taskSoilInput?: DesktopTaskSoilInput;
}): PanelConversationTurn {
  const createdAt = nowIso();
  return {
    turnId: createId("turn"),
    role: input.role,
    title: compact(input.title, 120),
    content: compactMessageContent(
      input.role === "assistant" ? sanitizeAssistantVisibleText(input.content) : input.content,
      8_000
    ),
    status: input.status,
    createdAt,
    updatedAt: createdAt,
    taskSoilInput: input.taskSoilInput,
  };
}

function requireTurn(conversation: PanelConversation, turnId: string): PanelConversationTurn {
  const turn = conversation.turns.find((item) => item.turnId === turnId);
  if (turn === undefined) {
    throw new Error(`Panel conversation turn not found: ${turnId}`);
  }
  return turn;
}

function toConversationReadModel(conversation: PanelConversation): PanelConversationReadModel {
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

function toConversationSummary(conversation: PanelConversation): PanelConversationSummaryReadModel {
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

function deriveConversationTitle(conversation: PanelConversation, fallbackGoal: string): string {
  const firstUser = conversation.turns.find((turn) => turn.role === "user");
  return compact(firstUser?.content || fallbackGoal, 80);
}

function previousUserTurn(
  conversation: PanelConversation,
  assistantTurnId: string
): PanelConversationTurn | undefined {
  const assistantIndex = conversation.turns.findIndex((turn) => turn.turnId === assistantTurnId);
  if (assistantIndex <= 0) {
    return undefined;
  }
  const candidate = conversation.turns[assistantIndex - 1];
  return candidate?.role === "user" ? candidate : undefined;
}

function latestAssistantRunId(conversation: PanelConversation): string | undefined {
  for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
    const turn = conversation.turns[index];
    if (turn?.role === "assistant" && turn.runId !== undefined) {
      return turn.runId;
    }
  }
  return undefined;
}

function normalizeTurnModel(
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

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function compact(value: string, maxLength: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function compactMessageContent(value: string, maxLength: number): string {
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
