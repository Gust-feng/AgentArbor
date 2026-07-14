import { createId, nowIso } from "../../kernel/id.js";
import type { RuntimeConversationRecord } from "../../domain/runtime-database/index.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type {
  PanelConversation,
  PanelConversationCurrentRunReadModel,
  PanelConversationPendingAction,
  PanelConversationReadModel,
  PanelConversationSummaryReadModel,
  PanelConversationTurn,
  PanelConversationTurnAttachment,
  PanelConversationTurnModel,
  PanelConversationTurnRole,
  PanelConversationTurnStatus,
} from "./panel-conversation-contracts.js";
import {
  compact,
  normalizeConversationTurnContent,
  normalizeTurnAttachments,
  normalizeTurnModel,
  toConversationReadModel,
  toConversationSummary,
} from "./panel-conversation-projection.js";

export {
  trimRuntimeConversationToClosedPairs,
  toRuntimeConversationRecord,
  turnModelFromConfig,
} from "./panel-conversation-projection.js";
export type {
  PanelConversation,
  PanelConversationPendingAction,
  PanelConversationReadModel,
  PanelConversationSummaryReadModel,
  PanelConversationTurn,
  PanelConversationTurnAttachment,
  PanelConversationTurnModel,
  PanelConversationTurnReadModel,
  PanelConversationTurnRole,
  PanelConversationTurnStatus,
  TrimRuntimeConversationResult,
} from "./panel-conversation-contracts.js";

export class PanelConversationStore {
  private readonly conversations = new Map<string, PanelConversation>();

  list(): readonly PanelConversationSummaryReadModel[] {
    return [...this.conversations.values()]
      .sort(compareConversations)
      .map((conversation) => toConversationSummary(conversation));
  }

  get(conversationId: string): PanelConversation | undefined {
    return this.conversations.get(conversationId);
  }

  getReadModel(conversationId: string): PanelConversationReadModel | undefined {
    const conversation = this.get(conversationId);
    return conversation === undefined ? undefined : toConversationReadModel(conversation);
  }

  getReadModelWithCurrentRun(
    conversationId: string,
    currentRun: PanelConversationCurrentRunReadModel | undefined
  ): PanelConversationReadModel | undefined {
    const conversation = this.get(conversationId);
    return conversation === undefined ? undefined : toConversationReadModel(conversation, currentRun);
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

  rename(input: {
    readonly conversationId: string;
    readonly title: string;
  }): PanelConversationReadModel {
    const conversation = this.requireConversation(input.conversationId);
    const title = compact(input.title, 80);
    if (title.length === 0) {
      throw new Error("Panel conversation title cannot be empty.");
    }
    conversation.title = title;
    conversation.titleEditedAt = nowIso();
    return toConversationReadModel(conversation);
  }

  setPinned(input: {
    readonly conversationId: string;
    readonly pinned: boolean;
  }): PanelConversationReadModel {
    const conversation = this.requireConversation(input.conversationId);
    conversation.pinnedAt = input.pinned ? conversation.pinnedAt ?? nowIso() : undefined;
    return toConversationReadModel(conversation);
  }

  delete(conversationId: string): boolean {
    return this.conversations.delete(conversationId);
  }

  restore(record: RuntimeConversationRecord): PanelConversationReadModel {
    const existing = this.conversations.get(record.conversationId);
    if (existing !== undefined && conversationVersion(existing).localeCompare(runtimeConversationVersion(record)) >= 0) {
      return toConversationReadModel(existing);
    }
    const conversation: PanelConversation = {
      conversationId: record.conversationId,
      createdAt: record.createdAt,
      title: compact(record.title, 80),
      titleEditedAt: record.titleEditedAt,
      updatedAt: record.updatedAt,
      pinnedAt: record.pinnedAt,
      currentRunId: record.activeRunId,
      latestRunId: record.latestRunId,
      queuedRunIds: [...record.queuedRunIds],
      pendingAction: restoredPendingAction(record),
      turns: record.turns.map((turn) => ({
        turnId: turn.turnId,
        role: turn.role,
        title: compact(turn.title, 120),
        content: normalizeConversationTurnContent(turn.content),
        status: turn.status,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        runId: turn.runId,
        responseModel: normalizeTurnModel(turn.responseModel),
        attachments: normalizeTurnAttachments(turn.attachments),
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
      titleEditedAt: undefined,
      updatedAt: createdAt,
      pinnedAt: undefined,
      queuedRunIds: [],
      turns: [],
    };
    this.conversations.set(conversation.conversationId, conversation);
    return conversation;
  }

  startDesktopMessage(input: {
    readonly goal: string;
    readonly taskSoilInput?: DesktopTaskSoilInput;
    readonly attachments?: readonly NonNullable<PanelConversationTurn["attachments"]>[number][];
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
      content: normalizeConversationTurnContent(input.goal),
      status: queued ? "pending" : "completed",
      taskSoilInput: input.taskSoilInput,
      attachments: input.attachments,
    });
    const assistantTurn = createTurn({
      role: "assistant",
      title: "",
      content: "",
      status: queued ? "pending" : "running",
    });
    conversation.turns.push(userTurn, assistantTurn);
    if (conversation.titleEditedAt === undefined) {
      conversation.title = deriveConversationTitle(conversation, input.goal);
    }
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
    assistantTurn.title = "";
    assistantTurn.updatedAt = nowIso();
    conversation.pendingAction = clearPendingActionForTurn(conversation.pendingAction, assistantTurn.turnId);
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
    assistantTurn.title = "";
    assistantTurn.updatedAt = nowIso();
    conversation.pendingAction = clearPendingActionForTurn(conversation.pendingAction, assistantTurn.turnId);
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
    assistantTurn.title = "";
    assistantTurn.updatedAt = nowIso();
    conversation.pendingAction = clearPendingActionForTurn(conversation.pendingAction, assistantTurn.turnId);
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
    readonly status: "completed" | "failed" | "cancelled" | "blocked" | "needs_input";
    readonly responseModel?: PanelConversationTurnModel;
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.runId = input.runId;
    assistantTurn.responseModel = normalizeTurnModel(input.responseModel) ?? assistantTurn.responseModel;
    assistantTurn.title = compact(input.title, 120);
    assistantTurn.content = normalizeConversationTurnContent(input.content);
    assistantTurn.status = input.status;
    assistantTurn.updatedAt = nowIso();
    conversation.pendingAction = clearPendingActionForTurn(conversation.pendingAction, assistantTurn.turnId);
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
      conversation.pendingAction = clearPendingActionForRun(conversation.pendingAction, runId);
      conversation.updatedAt = nowIso();
    }
  }

  updateAssistantPreview(input: {
    readonly conversationId: string;
    readonly assistantTurnId: string;
    readonly title: string;
    readonly content: string;
    readonly status: PanelConversationTurnStatus;
    readonly pendingActionKind?: PanelConversationPendingAction["kind"];
  }): void {
    const conversation = this.requireConversation(input.conversationId);
    const assistantTurn = requireTurn(conversation, input.assistantTurnId);
    assistantTurn.title = compact(input.title, 120);
    assistantTurn.content = normalizeConversationTurnContent(input.content);
    assistantTurn.status = input.status;
    assistantTurn.updatedAt = nowIso();
    conversation.pendingAction = input.pendingActionKind === undefined || assistantTurn.runId === undefined
      ? clearPendingActionForTurn(conversation.pendingAction, assistantTurn.turnId)
      : {
          kind: input.pendingActionKind,
          runId: assistantTurn.runId,
          assistantTurnId: assistantTurn.turnId,
        };
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
  readonly attachments?: readonly NonNullable<PanelConversationTurn["attachments"]>[number][];
}): PanelConversationTurn {
  const createdAt = nowIso();
  return {
    turnId: createId("turn"),
    role: input.role,
    title: compact(input.title, 120),
    content: normalizeConversationTurnContent(input.content),
    status: input.status,
    createdAt,
    updatedAt: createdAt,
    taskSoilInput: input.taskSoilInput,
    attachments: normalizeTurnAttachments(input.attachments),
  };
}

function requireTurn(conversation: PanelConversation, turnId: string): PanelConversationTurn {
  const turn = conversation.turns.find((item) => item.turnId === turnId);
  if (turn === undefined) {
    throw new Error(`Panel conversation turn not found: ${turnId}`);
  }
  return turn;
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

function clearPendingActionForTurn(
  pendingAction: PanelConversationPendingAction | undefined,
  assistantTurnId: string
): PanelConversationPendingAction | undefined {
  return pendingAction?.assistantTurnId === assistantTurnId ? undefined : pendingAction;
}

function clearPendingActionForRun(
  pendingAction: PanelConversationPendingAction | undefined,
  runId: string
): PanelConversationPendingAction | undefined {
  return pendingAction?.runId === runId ? undefined : pendingAction;
}

function restoredPendingAction(record: RuntimeConversationRecord): PanelConversationPendingAction | undefined {
  if (record.status !== "approval_needed" || record.activeRunId === undefined) {
    return undefined;
  }
  const assistantTurn = record.turns.find((turn) =>
    turn.role === "assistant" &&
    turn.runId === record.activeRunId &&
    turn.status === "running"
  );
  return assistantTurn === undefined
    ? undefined
    : {
        kind: "approval",
        runId: record.activeRunId,
        assistantTurnId: assistantTurn.turnId,
      };
}

function compareConversations(left: PanelConversation, right: PanelConversation): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? right.updatedAt.localeCompare(left.updatedAt) : pinned;
}

function conversationVersion(conversation: PanelConversation): string {
  return maxIso([conversation.updatedAt, conversation.titleEditedAt, conversation.pinnedAt]);
}

function runtimeConversationVersion(conversation: RuntimeConversationRecord): string {
  return maxIso([conversation.updatedAt, conversation.titleEditedAt, conversation.pinnedAt]);
}

function maxIso(values: readonly (string | undefined)[]): string {
  let latest = "";
  for (const value of values) {
    if (value !== undefined && value.localeCompare(latest) > 0) {
      latest = value;
    }
  }
  return latest;
}
