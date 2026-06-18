export type TimelineCollapseRunLike = {
  readonly runId: string;
  readonly status: string;
};

export type TimelineCollapseActivityLike = {
  readonly phase: string;
  readonly copy: {
    readonly label?: string;
    readonly detail: string;
  };
};

export type TimelineCollapseReason =
  | "structure"
  | "turn_settled"
  | "active_or_pending"
  | "empty"
  | "needs_attention"
  | "expanded";

export type TimelineSegmentLifecycle = "open" | "settled" | "attention";

export type TimelineCollapseDecision = {
  readonly collapsed: boolean;
  readonly reason: TimelineCollapseReason;
};

export function shouldCollapseTimelineAfterTurn(input: {
  readonly displayRunId?: string;
  readonly live: boolean;
  readonly pending?: unknown;
  readonly run?: TimelineCollapseRunLike;
  readonly turnStatus: string;
}): boolean {
  if (input.live || input.pending !== undefined) {
    return false;
  }
  const ownerStatus = collapseOwnerStatus(input);
  if (isAttentionTimelineStatus(ownerStatus)) {
    return false;
  }
  return isSettledTimelineStatus(ownerStatus);
}

export function shouldCollapseStandaloneTimeline(input: {
  readonly runStatus?: string;
  readonly hasPendingConfirmation: boolean;
}): boolean {
  if (input.runStatus === undefined || input.hasPendingConfirmation || isAttentionTimelineStatus(input.runStatus)) {
    return false;
  }
  return isSettledTimelineStatus(input.runStatus);
}

export function shouldAutoCollapseTimelineSegment(input: {
  readonly collapseTimeline: boolean;
  readonly defaultCollapsed: boolean;
  readonly lifecycle?: TimelineSegmentLifecycle;
  readonly items: readonly TimelineCollapseActivityLike[];
  readonly hasCurrentConfirmation: boolean;
  readonly hasBodySegments: boolean;
}): boolean {
  return timelineCollapseDecision(input).collapsed;
}

export function timelineCollapseDecision(input: {
  readonly collapseTimeline: boolean;
  readonly defaultCollapsed: boolean;
  readonly lifecycle?: TimelineSegmentLifecycle;
  readonly items: readonly TimelineCollapseActivityLike[];
  readonly hasCurrentConfirmation: boolean;
  readonly hasBodySegments: boolean;
}): TimelineCollapseDecision {
  if (input.hasCurrentConfirmation) {
    return { collapsed: false, reason: "active_or_pending" };
  }
  if (input.items.length === 0) {
    return { collapsed: false, reason: "empty" };
  }
  if (input.lifecycle === "open") {
    return { collapsed: false, reason: "active_or_pending" };
  }
  if (input.items.some((item) => isAttentionTimelinePhase(item.phase))) {
    return { collapsed: false, reason: "needs_attention" };
  }
  if (input.lifecycle === "attention") {
    return { collapsed: false, reason: "active_or_pending" };
  }
  if (input.items.some((item) => !isAutoCollapsibleTimelinePhase(item.phase))) {
    return { collapsed: false, reason: "active_or_pending" };
  }
  if (input.defaultCollapsed) {
    return { collapsed: true, reason: "structure" };
  }
  if (input.collapseTimeline === true) {
    return { collapsed: true, reason: "turn_settled" };
  }
  if (input.hasBodySegments) {
    return { collapsed: true, reason: "structure" };
  }
  return { collapsed: false, reason: "expanded" };
}

export function collapsedTimelineSummary(input: {
  readonly items: readonly TimelineCollapseActivityLike[];
  readonly hasCurrentConfirmation: boolean;
}): string {
  if (input.hasCurrentConfirmation) {
    return "等待处理";
  }
  const status = timelineStatusLabel(input);
  if (status !== undefined && status !== "已完成") {
    return status;
  }
  const action = dominantTimelineAction(input.items);
  if (action !== undefined) {
    return completedTimelineActionLabel(action);
  }
  return input.items.length === 1 ? "完成 1 步" : `完成 ${input.items.length} 步`;
}

export function isSettledTimelineStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function collapseOwnerStatus(input: {
  readonly displayRunId?: string;
  readonly run?: TimelineCollapseRunLike;
  readonly turnStatus: string;
}): string {
  if (input.displayRunId !== undefined && input.run?.runId === input.displayRunId) {
    return input.run.status;
  }
  return input.turnStatus;
}

function isAttentionTimelineStatus(status: string | undefined): boolean {
  return status === "approval_needed" ||
    status === "waiting_approval" ||
    status === "needs_input" ||
    status === "failed" ||
    status === "blocked";
}

function isAutoCollapsibleTimelinePhase(phase: string): boolean {
  return phase === "completed" ||
    phase === "approved" ||
    phase === "denied" ||
    phase === "guidance" ||
    phase === "cancelled";
}

function isAttentionTimelinePhase(phase: string): boolean {
  return phase === "failed" ||
    phase === "blocked" ||
    phase === "waiting_approval";
}

function timelineStatusLabel(input: {
  readonly items: readonly TimelineCollapseActivityLike[];
  readonly hasCurrentConfirmation: boolean;
}): string | undefined {
  if (input.hasCurrentConfirmation) {
    return "等待处理";
  }
  const phase = input.items.at(-1)?.phase;
  if (phase === "completed") return "已完成";
  if (phase === "approved") return "已批准";
  if (phase === "denied") return "已不执行";
  if (phase === "guidance") return "已补充要求";
  if (phase === "cancelled") return "已取消";
  if (phase === "failed") return "未完成";
  if (phase === "blocked") return "需要处理";
  if (phase === "waiting_approval") return "等待处理";
  if (phase === "noted" || phase === "preparing" || phase === "executing") return "进行中";
  return undefined;
}

type TimelineActionKind = "command" | "edit" | "read" | "search" | "web" | "other";

function dominantTimelineAction(items: readonly TimelineCollapseActivityLike[]): {
  readonly kind: TimelineActionKind;
  readonly count: number;
} | undefined {
  const counts = new Map<TimelineActionKind, number>();
  for (const item of items) {
    const kind = timelineActionKind(item);
    if (kind === undefined) {
      continue;
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return items.length > 0 ? { kind: "other", count: items.length } : undefined;
  }
  if (counts.size > 1) {
    return { kind: "other", count: items.length };
  }
  const [entry] = counts.entries();
  return entry === undefined ? undefined : { kind: entry[0], count: entry[1] };
}

function timelineActionKind(item: TimelineCollapseActivityLike): TimelineActionKind | undefined {
  const label = item.copy.label?.trim();
  if (label === "命令") return "command";
  if (label === "编辑" || label === "写入" || label === "创建" || label === "删除" || label === "生成") return "edit";
  if (label === "读取" || label === "查看") return "read";
  if (label === "搜索") return "search";
  if (label === "网页") return "web";
  return undefined;
}

function completedTimelineActionLabel(action: {
  readonly kind: TimelineActionKind;
  readonly count: number;
}): string {
  const count = action.count;
  if (action.kind === "command") return `已运行 ${count} 条命令`;
  if (action.kind === "edit") return `已编辑 ${count} 个文件`;
  if (action.kind === "read") return `已读取 ${count} 项`;
  if (action.kind === "search") return `已搜索 ${count} 次`;
  if (action.kind === "web") return `已查看 ${count} 个网页`;
  return count === 1 ? "完成 1 步" : `完成 ${count} 步`;
}
