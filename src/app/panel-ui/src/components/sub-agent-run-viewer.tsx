import React from "react";
import { Bot } from "lucide-react";
import type { SubAgentRunView } from "../contracts/run";

type SubAgentBatchStats = {
  readonly total?: number;
  readonly completed?: number;
  readonly failed?: number;
  readonly cancelled?: number;
  readonly approvalRequired?: number;
  readonly notStarted?: number;
};

export function SubAgentInlineCard(props: {
  readonly run?: SubAgentRunView;
  readonly batchRuns?: readonly SubAgentRunView[];
  readonly batchStats?: SubAgentBatchStats;
  readonly fallbackTitle: string;
  readonly fallbackSummary?: string;
}): React.ReactElement {
  const batchRuns = props.batchRuns ?? [];
  const run = props.run ?? batchRuns[0];
  const total = props.batchStats?.total ?? (batchRuns.length > 1 ? batchRuns.length : undefined);
  const isBatch = total !== undefined;
  const status = isBatch
    ? batchStatusLabel({
        completed: props.batchStats?.completed ?? batchRuns.filter((item) => item.status === "completed").length,
        failed: props.batchStats?.failed ?? batchRuns.filter((item) => item.status === "failed").length,
        cancelled: props.batchStats?.cancelled ?? batchRuns.filter((item) => item.status === "cancelled").length,
        approvalRequired: props.batchStats?.approvalRequired ?? batchRuns.filter((item) => item.status === "approval_required").length,
        notStarted: props.batchStats?.notStarted ?? 0,
      })
    : singleStatusLabel(run?.status);
  const title = isBatch ? `子 Agent 批次 · ${total}` : run?.subAgentName ?? props.fallbackTitle;
  const summary = isBatch ? "" : compactSummary(run?.summary ?? props.fallbackSummary);
  return (
    <div className="sub-agent-inline-card" data-status={isBatch ? "batch" : run?.status}>
      <span className="sub-agent-inline-icon" aria-hidden="true">
        <Bot size={13} strokeWidth={2.25} />
      </span>
      <span className="sub-agent-inline-main">
        <strong>{title}</strong>
        <small>
          {status}
          {summary.length > 0 ? ` · ${summary}` : ""}
        </small>
      </span>
    </div>
  );
}

function batchStatusLabel(input: {
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly approvalRequired: number;
  readonly notStarted: number;
}): string {
  const parts: string[] = [];
  if (input.completed > 0) parts.push(`${input.completed} 已处理`);
  if (input.failed > 0) parts.push(`${input.failed} 未完成`);
  if (input.approvalRequired > 0) parts.push(`${input.approvalRequired} 待确认`);
  if (input.cancelled > 0) parts.push(`${input.cancelled} 已取消`);
  if (input.notStarted > 0) parts.push(`${input.notStarted} 未开始`);
  return parts.length === 0 ? "处理中" : parts.join("，");
}

function singleStatusLabel(status: string | undefined): string {
  if (status === "completed") return "已处理";
  if (status === "failed") return "未完成";
  if (status === "approval_required") return "等待确认";
  if (status === "cancelled") return "已取消";
  return "处理中";
}

function compactSummary(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 95)}...`;
}
