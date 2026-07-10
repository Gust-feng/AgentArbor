import type { PanelRunStreamEvent, PanelRunStreamEventType } from "./panel-read-model/run/panel-run-stream-contracts.js";
import type { PanelRunStreamEventDetail } from "./panel-stream-tool-projection.js";
import { numberOrUndefined, stringOrUndefined } from "./run-read-model/value-utils.js";

export type SubAgentStreamEventType = Extract<
  PanelRunStreamEventType,
  "sub_agent.started" | "sub_agent.completed" | "sub_agent_batch.started" | "sub_agent_batch.completed"
>;

export type SubAgentTraceForStream = {
  readonly subRunId: string;
  readonly batchId?: string;
  readonly batchIndex?: number;
  readonly subAgentName: string;
  readonly task: string;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
  readonly durationMs: number;
  readonly modelRounds: number;
  readonly toolCalls: number;
  readonly summary: string;
};

export function isSubAgentStreamEventType(type: string): type is SubAgentStreamEventType {
  return type === "sub_agent.started" ||
    type === "sub_agent.completed" ||
    type === "sub_agent_batch.started" ||
    type === "sub_agent_batch.completed";
}

export function subAgentStreamLabel(type: SubAgentStreamEventType): string {
  if (type === "sub_agent_batch.started" || type === "sub_agent_batch.completed") {
    return "子 Agent 批次";
  }
  return "子 Agent";
}

export function subAgentStreamSummaryFromPayload(
  type: SubAgentStreamEventType,
  payload: Readonly<Record<string, unknown>>
): string {
  if (type === "sub_agent.started") {
    const name = stringOrUndefined(payload.subAgentName) ?? "子 Agent";
    const task = stringOrUndefined(payload.task);
    return task === undefined ? `${name} 开始运行。` : `${name} 开始运行：${task}`;
  }
  if (type === "sub_agent.completed") {
    const name = stringOrUndefined(payload.subAgentName) ?? "子 Agent";
    const summary = stringOrUndefined(payload.summary);
    return summary === undefined ? `${name} 运行结束。` : `${name} 运行结束：${summary}`;
  }
  if (type === "sub_agent_batch.started") {
    const total = numberOrUndefined(payload.totalCount) ?? 0;
    return `开始运行 ${total} 个子 Agent。`;
  }
  const success = numberOrUndefined(payload.successCount) ?? 0;
  const failed = numberOrUndefined(payload.failedCount) ?? 0;
  const approval = numberOrUndefined(payload.approvalRequiredCount) ?? 0;
  const notStarted = numberOrUndefined(payload.notStartedCount) ?? 0;
  const extra = approval > 0 || notStarted > 0 ? `，${approval} 待确认，${notStarted} 未启动` : "";
  return `子 Agent 批次结束：${success} 成功，${failed} 失败${extra}。`;
}

export function subAgentStreamStatusFromPayload(
  type: SubAgentStreamEventType,
  payload: Readonly<Record<string, unknown>>
): NonNullable<PanelRunStreamEvent["status"]> {
  if (type === "sub_agent.started" || type === "sub_agent_batch.started") {
    return "running";
  }
  const status = stringOrUndefined(payload.status);
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "approval_required") return "approval_needed";
  if (type === "sub_agent_batch.completed") {
    return panelStatusForSubAgentStatus(subAgentBatchStatusFromCounts({
      failedCount: numberOrUndefined(payload.failedCount),
      cancelledCount: numberOrUndefined(payload.cancelledCount),
      approvalRequiredCount: numberOrUndefined(payload.approvalRequiredCount),
      notStartedCount: numberOrUndefined(payload.notStartedCount),
    }));
  }
  return "completed";
}

export function subAgentStreamDetailFromPayload(
  type: SubAgentStreamEventType,
  payload: Readonly<Record<string, unknown>>
): PanelRunStreamEventDetail {
  return {
    kind: "sub_agent",
    subAgentRunId: stringOrUndefined(payload.subRunId),
    subAgentBatchId: stringOrUndefined(payload.batchId),
    subAgentName: stringOrUndefined(payload.subAgentName),
    subAgentTask: stringOrUndefined(payload.task),
    subAgentStatus: type === "sub_agent.started" || type === "sub_agent_batch.started"
      ? "running"
      : subAgentStatusOrUndefined(payload.status),
    subAgentModelRounds: numberOrUndefined(payload.modelRounds),
    subAgentToolCalls: numberOrUndefined(payload.toolCalls),
    subAgentDurationMs: numberOrUndefined(payload.durationMs) ?? numberOrUndefined(payload.totalDurationMs),
    subAgentTotalCount: numberOrUndefined(payload.totalCount),
    subAgentSuccessCount: numberOrUndefined(payload.successCount),
    subAgentFailedCount: numberOrUndefined(payload.failedCount),
    subAgentCancelledCount: numberOrUndefined(payload.cancelledCount),
    subAgentApprovalRequiredCount: numberOrUndefined(payload.approvalRequiredCount),
    subAgentNotStartedCount: numberOrUndefined(payload.notStartedCount),
    preview: stringOrUndefined(payload.summary),
  };
}

export function subAgentStreamDetailFromTraces(input: {
  readonly type: SubAgentStreamEventType;
  readonly refs: readonly { readonly kind: string; readonly id: string }[];
  readonly fallbackSummary: string;
  readonly runs: readonly SubAgentTraceForStream[];
}): PanelRunStreamEventDetail {
  if (input.type === "sub_agent_batch.started" || input.type === "sub_agent_batch.completed") {
    const batchId = subAgentBatchIdFromRefs(input.refs) ?? singleBatchId(input.runs);
    const batchRuns = batchId === undefined
      ? input.runs.filter((run) => run.batchId !== undefined)
      : input.runs.filter((run) => run.batchId === batchId);
    return {
      kind: "sub_agent",
      subAgentBatchId: batchId,
      subAgentStatus: input.type === "sub_agent_batch.started"
        ? "running"
        : subAgentBatchStatusFromCounts({
          failedCount: countSubAgentRuns(batchRuns, "failed"),
          cancelledCount: countSubAgentRuns(batchRuns, "cancelled"),
          approvalRequiredCount: countSubAgentRuns(batchRuns, "approval_required"),
          notStartedCount: undefined,
        }),
      subAgentTotalCount: batchRuns.length === 0 ? undefined : batchRuns.length,
      subAgentSuccessCount: countSubAgentRuns(batchRuns, "completed"),
      subAgentFailedCount: countSubAgentRuns(batchRuns, "failed"),
      subAgentCancelledCount: countSubAgentRuns(batchRuns, "cancelled"),
      subAgentApprovalRequiredCount: countSubAgentRuns(batchRuns, "approval_required"),
      subAgentDurationMs: sumSubAgentDuration(batchRuns),
      preview: input.fallbackSummary,
    };
  }
  const run = subAgentRunFromRefs(input.refs, input.runs);
  return {
    kind: "sub_agent",
    subAgentRunId: run?.subRunId ?? subAgentRunIdFromRefs(input.refs),
    subAgentBatchId: run?.batchId,
    subAgentBatchIndex: run?.batchIndex,
    subAgentName: run?.subAgentName,
    subAgentTask: run?.task,
    subAgentStatus: input.type === "sub_agent.started" ? "running" : run?.status,
    subAgentModelRounds: run?.modelRounds,
    subAgentToolCalls: run?.toolCalls,
    subAgentDurationMs: run?.durationMs,
    preview: input.type === "sub_agent.completed" ? run?.summary ?? input.fallbackSummary : run?.task ?? input.fallbackSummary,
  };
}

export function subAgentStreamSummaryFromDetail(
  type: SubAgentStreamEventType,
  detail: PanelRunStreamEventDetail | undefined,
  fallbackSummary: string
): string {
  if (type === "sub_agent.started") {
    const name = detail?.subAgentName ?? "子 Agent";
    const task = detail?.subAgentTask;
    return task === undefined ? `${name} 开始运行。` : `${name} 开始运行：${task}`;
  }
  if (type === "sub_agent.completed") {
    const name = detail?.subAgentName ?? "子 Agent";
    const summary = cleanSubAgentFallbackSummary(detail?.preview ?? fallbackSummary);
    return summary === undefined ? `${name} 运行结束。` : `${name} 运行结束：${summary}`;
  }
  if (type === "sub_agent_batch.started") {
    const total = detail?.subAgentTotalCount;
    return total === undefined ? "开始运行子 Agent 批次。" : `开始运行 ${total} 个子 Agent。`;
  }
  const success = detail?.subAgentSuccessCount;
  const failed = detail?.subAgentFailedCount;
  if (success === undefined && failed === undefined) {
    return "子 Agent 批次结束。";
  }
  const approval = detail?.subAgentApprovalRequiredCount ?? 0;
  const notStarted = detail?.subAgentNotStartedCount ?? 0;
  const extra = approval > 0 || notStarted > 0 ? `，${approval} 待确认，${notStarted} 未启动` : "";
  return `子 Agent 批次结束：${success ?? 0} 成功，${failed ?? 0} 失败${extra}。`;
}

export function subAgentStreamStatusFromDetail(
  type: SubAgentStreamEventType,
  detail: PanelRunStreamEventDetail | undefined
): NonNullable<PanelRunStreamEvent["status"]> {
  if (type === "sub_agent.started" || type === "sub_agent_batch.started") {
    return "running";
  }
  if (type === "sub_agent.completed") {
    return panelStatusForSubAgentStatus(detail?.subAgentStatus);
  }
  if (type === "sub_agent_batch.completed") {
    return panelStatusForSubAgentStatus(detail?.subAgentStatus ?? subAgentBatchStatusFromCounts({
      failedCount: detail?.subAgentFailedCount,
      cancelledCount: detail?.subAgentCancelledCount,
      approvalRequiredCount: detail?.subAgentApprovalRequiredCount,
      notStartedCount: detail?.subAgentNotStartedCount,
    }));
  }
  return "completed";
}

function panelStatusForSubAgentStatus(
  status: NonNullable<PanelRunStreamEventDetail["subAgentStatus"]> | undefined
): NonNullable<PanelRunStreamEvent["status"]> {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "approval_required") return "approval_needed";
  return "completed";
}

function subAgentBatchStatusFromCounts(input: {
  readonly failedCount?: number;
  readonly cancelledCount?: number;
  readonly approvalRequiredCount?: number;
  readonly notStartedCount?: number;
}): NonNullable<PanelRunStreamEventDetail["subAgentStatus"]> {
  if ((input.approvalRequiredCount ?? 0) > 0 || (input.notStartedCount ?? 0) > 0) {
    return "approval_required";
  }
  if ((input.failedCount ?? 0) > 0) {
    return "failed";
  }
  if ((input.cancelledCount ?? 0) > 0) {
    return "cancelled";
  }
  return "completed";
}

function subAgentStatusOrUndefined(value: unknown): NonNullable<PanelRunStreamEventDetail["subAgentStatus"]> | undefined {
  const status = stringOrUndefined(value);
  if (status === "completed" || status === "failed" || status === "approval_required" || status === "cancelled") {
    return status;
  }
  return undefined;
}

function subAgentRunFromRefs(
  refs: readonly { readonly kind: string; readonly id: string }[],
  runs: readonly SubAgentTraceForStream[]
): SubAgentTraceForStream | undefined {
  const subRunId = subAgentRunIdFromRefs(refs);
  if (subRunId !== undefined) {
    return runs.find((run) => run.subRunId === subRunId);
  }
  return runs.length === 1 ? runs[0] : undefined;
}

function subAgentRunIdFromRefs(refs: readonly { readonly kind: string; readonly id: string }[]): string | undefined {
  return refs.find((ref) => ref.kind === "sub_agent_run")?.id;
}

function subAgentBatchIdFromRefs(refs: readonly { readonly kind: string; readonly id: string }[]): string | undefined {
  return refs.find((ref) => ref.kind === "sub_agent_batch")?.id;
}

function singleBatchId(runs: readonly SubAgentTraceForStream[]): string | undefined {
  const batchIds = [...new Set(runs.map((run) => run.batchId).filter((id): id is string => id !== undefined))];
  return batchIds.length === 1 ? batchIds[0] : undefined;
}

function countSubAgentRuns(
  runs: readonly SubAgentTraceForStream[],
  status: SubAgentTraceForStream["status"]
): number | undefined {
  if (runs.length === 0) {
    return undefined;
  }
  return runs.filter((run) => run.status === status).length;
}

function sumSubAgentDuration(runs: readonly SubAgentTraceForStream[]): number | undefined {
  if (runs.length === 0) {
    return undefined;
  }
  return runs.reduce((total, run) => total + run.durationMs, 0);
}

function cleanSubAgentFallbackSummary(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (
    text === undefined ||
    text.length === 0 ||
    text === "Sub-agent started execution." ||
    text === "Sub-agent completed execution." ||
    text === "Sub-agent batch execution started." ||
    text === "Sub-agent batch execution completed."
  ) {
    return undefined;
  }
  return text;
}
