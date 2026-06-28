import { getJson } from "./api";
import type {
  DeepRunStatus,
  DeepRunSummary,
  DeepRunView,
  GetDeepRunViewResponse,
  ListDeepRunSummariesResponse,
} from "./contracts/deep";

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
  };
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

export function latestActiveDeepRun(
  runs: readonly DeepRunSummary[],
): DeepRunSummary | undefined {
  return [...runs]
    .filter((run) => !isTerminalDeepRunStatus(run.status))
    .sort(compareDeepRunSummaryByUpdatedAt)[0];
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

function timestampValue(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}
