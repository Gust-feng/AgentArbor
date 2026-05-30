import type { RunEvent, TaskStatus } from "./types";

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

export function eventTitle(event: RunEvent): string {
  if (event.type === "run.started") return "开始处理";
  if (event.type === "run.resumed") return "继续处理";
  if (event.type === "tool.requested") return "正在执行动作";
  if (event.type === "tool.completed") return "动作完成";
  if (event.type === "tool.failed") return "动作未完成";
  if (event.type === "context.compaction.completed") return "上下文已压缩";
  if (event.type === "context.compaction.failed") return "上下文压缩失败";
  if (event.type === "confirmation.needed") return "需要确认";
  if (event.type === "user_approval.received") return "收到确认";
  if (event.type === "user.guidance") return "收到补充指导";
  if (event.type === "agent.note.delta") return "正在判断";
  if (event.type === "agent.note.completed") return "判断完成";
  if (event.type === "model.reasoning.delta") return "正在思考";
  if (event.type === "model.reasoning.completed") return "思考完成";
  if (event.type === "agent.delegation.planned") return "已拆分检查";
  if (event.type === "agent.child.started") return "局部检查开始";
  if (event.type === "agent.child.completed") return "局部检查完成";
  if (event.type === "agent.child.waiting") return "等待局部材料";
  if (event.type === "agent.parent_synthesis.completed") return "综合完成";
  if (event.type === "final.result") return "结果已生成";
  if (event.type === "run.failed") return "运行未完成";
  if (event.type === "run.cancelled") return "运行已取消";
  if (event.type === "run.blocked") return "运行中断";
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
