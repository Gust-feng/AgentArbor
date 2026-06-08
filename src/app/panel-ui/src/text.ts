import type { TaskStatus } from "./contracts/common";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "排队中",
  planning: "准备中",
  running: "处理中",
  needs_input: "需要补充",
  approval_needed: "待确认",
  paused: "已中断",
  blocked: "需要处理",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};

export function statusTone(status: TaskStatus | string | undefined): string {
  if (status === "completed") return "success";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "approval_needed" || status === "needs_input") return "warning";
  if (status === "cancelled" || status === "paused") return "muted";
  if (status === "running" || status === "planning") return "active";
  return "neutral";
}

export function compact(value: string | undefined, maxLength: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function relativeTime(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
