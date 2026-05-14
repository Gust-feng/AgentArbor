import type { RunEvent, TaskStatus } from "./types";

export const TASK_SUGGESTIONS = [
  "阅读我添加的文件，整理成一份可执行的待办清单",
  "检查当前工作区，告诉我下一步最应该处理什么",
  "根据这个网页和项目上下文，写一份简短决策报告",
  "帮我核对这项任务的风险，必要时先向我确认",
] as const;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "排队中",
  planning: "准备中",
  running: "处理中",
  needs_input: "需要补充",
  approval_needed: "待确认",
  paused: "已暂停",
  blocked: "需要处理",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};

export function eventTitle(event: RunEvent): string {
  if (event.type === "run.started") return "开始处理";
  if (event.type === "run.resumed") return "继续处理";
  if (event.type === "tool.requested") return "正在使用工具";
  if (event.type === "tool.completed") return "工具完成";
  if (event.type === "tool.failed") return "工具未完成";
  if (event.type === "confirmation.needed") return "需要确认";
  if (event.type === "user_approval.received") return "收到确认";
  if (event.type === "user.guidance") return "收到补充指导";
  if (event.type === "final.result") return "结果已生成";
  if (event.type === "run.failed") return "运行未完成";
  if (event.type === "run.cancelled") return "运行已取消";
  if (event.type === "run.blocked") return "运行已暂停";
  return event.title || "状态更新";
}

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
