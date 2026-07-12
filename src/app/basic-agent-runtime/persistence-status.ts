import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type { RuntimeRunRecord, RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import { redactOrdinaryText } from "../safe-projection.js";

export function agentTaskStatusFromRuntimeStatus(status: RuntimeRunRecord["status"]): BasicAgentRun["status"] {
  if (status === "pending") return "queued";
  if (status === "approval_needed") return "approval_needed";
  if (status === "needs_input") return "needs_input";
  if (status === "running" || status === "stopped") return "blocked";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "blocked") return "blocked";
  return "failed";
}

export function agentTaskStatusFromSnapshot(snapshot: RuntimeRunSnapshot): BasicAgentRun["status"] {
  return agentTaskStatusFromRuntimeStatus(snapshot.run.status);
}

export function basicRunTitleFromStatus(status: BasicAgentRun["status"], resultTitle: string | undefined): string {
  if (resultTitle !== undefined && resultTitle.trim().length > 0) {
    return redactOrdinaryText(resultTitle, 120);
  }
  if (status === "queued") return "等待开始";
  if (status === "approval_needed") return "待处理";
  if (status === "needs_input") return "需要补充";
  if (status === "blocked") return "需要处理";
  if (status === "cancelled") return "已取消";
  if (status === "failed") return "未完成";
  if (status === "completed") return "已完成";
  return "进行中";
}

export function basicRunNextStepFromStatus(status: BasicAgentRun["status"]): string | undefined {
  void status;
  return undefined;
}
