import { getJson } from "./api";
import type {
  DeepConversationSummary,
  DeepConversationView,
  DeepRunStatus,
  DeepRunSummary,
  DeepRunView,
  GetDeepConversationResponse,
  GetDeepRunViewResponse,
  ListDeepConversationSummariesResponse,
  ListDeepRunSummariesResponse,
} from "./contracts/deep";

export async function listDeepConversations(limit = 50): Promise<readonly DeepConversationSummary[]> {
  const response = await getJson<ListDeepConversationSummariesResponse>(
    `/api/deep/conversations?limit=${encodeURIComponent(String(limit))}`,
  );
  return response.conversations ?? [];
}

export async function getDeepConversation(conversationId: string): Promise<GetDeepConversationResponse> {
  return getJson<GetDeepConversationResponse>(
    `/api/deep/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export async function listDeepRuns(limit = 50): Promise<readonly DeepRunSummary[]> {
  const response = await getJson<ListDeepRunSummariesResponse>(
    `/api/deep/runs?limit=${encodeURIComponent(String(limit))}`,
  );
  return response.runs ?? [];
}

export async function openDeepRun(runId: string): Promise<DeepRunView> {
  const response = await getJson<GetDeepRunViewResponse>(
    `/api/deep/runs/${encodeURIComponent(runId)}/view`,
  );
  return response.view;
}

export function deepRunSummaryFromView(view: DeepRunView): DeepRunSummary {
  return {
    runId: view.run.runId,
    conversationId: view.run.conversationId,
    parentRunId: view.run.parentRunId,
    rootRunId: view.run.rootRunId,
    turnOrdinal: view.run.turnOrdinal,
    goal: view.run.goal,
    status: view.run.status,
    runKind: view.run.runKind,
    runMode: view.run.runMode,
    startedAt: view.run.startedAt,
    updatedAt: view.run.updatedAt,
    hasConclusion: view.report?.conclusion !== undefined,
    childCount: view.liveProjection.children.length || view.agentRunTree.childRunCount,
    eventCount: view.eventSequence.length,
    workspaceFolder: view.run.workspaceFolder,
    brief: view.brief,
    runtimeHealth: view.run.runtimeHealth,
  };
}

export function deepConversationSummaryFromView(
  conversation: DeepConversationView,
  latestRun?: DeepRunSummary,
): DeepConversationSummary {
  const intakeStatus = latestIntakeStatus(conversation);
  const latestRunIsCurrent = latestRun !== undefined &&
    !conversationHasFreshIntake(conversation.updatedAt, intakeStatus, latestRun.updatedAt);
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    titleEditedAt: conversation.titleEditedAt,
    goal: conversation.goal,
    currentObjective: conversation.currentObjective,
    createdAt: conversation.createdAt,
    updatedAt: latestRun === undefined
      ? conversation.updatedAt
      : latestTimestamp(conversation.updatedAt, latestRun.updatedAt),
    pinnedAt: conversation.pinnedAt,
    workspaceFolder: latestRun?.workspaceFolder ?? conversationWorkspaceFolder(conversation),
    intakeStatus: latestRunIsCurrent ? undefined : intakeStatus,
    latestRun: latestRunIsCurrent ? latestRun : undefined,
  };
}

export function upsertDeepConversationSummary(
  conversations: readonly DeepConversationSummary[],
  summary: DeepConversationSummary,
): readonly DeepConversationSummary[] {
  const next = [
    summary,
    ...conversations.filter((conversation) => conversation.conversationId !== summary.conversationId),
  ];
  return next.sort(compareDeepConversationSummaryByUpdatedAt).slice(0, 50);
}

export function upsertDeepRunSummary(
  runs: readonly DeepRunSummary[],
  summary: DeepRunSummary,
): readonly DeepRunSummary[] {
  const summaryRoot = summary.rootRunId ?? summary.runId;
  const next = [
    summary,
    ...runs.filter((run) => run.runId !== summary.runId && (run.rootRunId ?? run.runId) !== summaryRoot),
  ];
  return next.sort(compareDeepRunSummaryByUpdatedAt).slice(0, 50);
}

export function latestRestorableDeepRun(
  runs: readonly DeepRunSummary[],
): DeepRunSummary | undefined {
  return [...runs].sort(compareDeepRunSummaryByUpdatedAt)[0];
}

export function latestRestorableDeepConversation(
  conversations: readonly DeepConversationSummary[],
): DeepConversationSummary | undefined {
  return [...conversations].sort(compareDeepConversationSummaryByUpdatedAt)[0];
}

export function latestActiveDeepRun(
  runs: readonly DeepRunSummary[],
): DeepRunSummary | undefined {
  return [...runs]
    .filter(shouldKeepDeepRunBusy)
    .sort(compareDeepRunSummaryByUpdatedAt)[0];
}

export function shouldKeepDeepRunBusy(run: Pick<DeepRunSummary, "status" | "runtimeHealth"> | Pick<DeepRunView["run"], "status" | "runtimeHealth"> | undefined): boolean {
  if (run === undefined || isTerminalDeepRunStatus(run.status)) {
    return false;
  }
  const health = run.runtimeHealth?.state;
  return health === undefined || health === "active" || health === "stalled";
}

export function shouldPollDeepRun(run: Pick<DeepRunSummary, "status" | "runtimeHealth"> | Pick<DeepRunView["run"], "status" | "runtimeHealth"> | undefined): boolean {
  return shouldKeepDeepRunBusy(run);
}

export function isTerminalDeepRunStatus(status: DeepRunStatus): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "stopped" ||
    status === "corrected";
}

function compareDeepRunSummaryByUpdatedAt(left: DeepRunSummary, right: DeepRunSummary): number {
  return timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
}

function compareDeepConversationSummaryByUpdatedAt(
  left: DeepConversationSummary,
  right: DeepConversationSummary,
): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? deepConversationSummaryTime(right) - deepConversationSummaryTime(left) : pinned;
}

function timestampValue(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function latestTimestamp(left: string, right: string): string {
  return timestampValue(right) > timestampValue(left) ? right : left;
}

function deepConversationSummaryTime(conversation: DeepConversationSummary): number {
  return Math.max(
    timestampValue(conversation.updatedAt),
    timestampValue(conversation.titleEditedAt ?? ""),
    timestampValue(conversation.pinnedAt ?? ""),
  );
}

function latestIntakeStatus(
  conversation: DeepConversationView,
): DeepConversationSummary["intakeStatus"] {
  const lastTurn = conversation.intakeTurns.at(-1);
  if (lastTurn === undefined) {
    return undefined;
  }
  switch (lastTurn.action) {
    case "ask_user":
      return "needs_input";
    case "direct_answer":
      return "answered";
    case "start_collaboration":
      return "plan_ready";
    default:
      return undefined;
  }
}

function conversationHasFreshIntake(
  conversationUpdatedAt: string,
  intakeStatus: DeepConversationSummary["intakeStatus"],
  latestRunUpdatedAt: string,
): boolean {
  return intakeStatus !== undefined && timestampValue(conversationUpdatedAt) > timestampValue(latestRunUpdatedAt);
}

function conversationWorkspaceFolder(
  conversation: DeepConversationView,
): DeepConversationSummary["workspaceFolder"] {
  const path = conversation.birthWorkspaceDirectory;
  if (path === undefined || path.trim().length === 0) {
    return undefined;
  }
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return {
    label: (conversation.workspaceSelection ?? "default") === "default" ? "默认工作区" : segments.at(-1) ?? path,
    path,
    selection: conversation.workspaceSelection ?? "default",
  };
}
