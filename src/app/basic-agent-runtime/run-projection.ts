import type { AgentTaskStatus, BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import { redactOrdinaryMarkdownFragment, redactOrdinaryText } from "./safe-projection.js";

export type BasicAgentCompatRunStatus =
  | "pending"
  | "running"
  | "approval_needed"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type BasicAgentRunProjectionInput = {
  readonly runId: string;
  readonly conversationId?: string;
  readonly goal: string;
  readonly status: BasicAgentCompatRunStatus;
  readonly runMode: BasicAgentRun["runMode"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly streamEvents: readonly BasicAgentRunStreamEventProjectionInput[];
  readonly confirmationDecisions: readonly Pick<ConfirmationDecision, "decision" | "guidance">[];
  readonly completed?: {
    readonly canvas?: {
      readonly kind?: string;
      readonly agent?: {
        readonly pendingConfirmation?: unknown;
      };
    };
  };
};

export type BasicAgentRunStreamEventProjectionInput = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly createdAt: string;
  readonly agentLabel?: string;
  readonly summary?: string;
  readonly delta?: string;
  readonly status?: BasicAgentCompatRunStatus;
  readonly detail?: {
    readonly action?: string;
    readonly path?: string;
    readonly query?: string;
    readonly command?: string;
    readonly exitCode?: number;
    readonly preview?: string;
    readonly display?: ToolDisplayProjection;
    readonly truncated?: boolean;
    readonly error?: string;
  };
  readonly sourceRefs: readonly string[];
  readonly modelCallRefs: readonly string[];
  readonly toolCallRefs: readonly string[];
};

export function projectRunJobToBasicRun(job: BasicAgentRunProjectionInput): BasicAgentRun {
  const status = basicStatusForRunJob(job);
  return {
    runId: job.runId,
    conversationId: job.conversationId,
    title: basicRunTitle(job, status),
    goalSummary: redactOrdinaryText(job.goal, 400),
    status,
    runMode: job.runMode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    currentStep: basicRunCurrentStep(job),
    nextStep: basicRunNextStep(status),
    requiresUserAction: status === "approval_needed" || status === "needs_input" || status === "blocked",
    eventCursor: {
      lastSequence: 0,
      eventCount: 0,
    },
  };
}

export function projectRunStreamEventToRunEvent(event: BasicAgentRunStreamEventProjectionInput): RunEvent {
  const summary = safeEventSummary(event.detail?.preview ?? event.delta ?? event.summary);
  const delta = event.delta === undefined ? undefined : safeEventDelta(event.delta);
  return {
    id: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    title: basicEventTitle(event),
    summary,
    delta,
    status: basicStatusForRunEvent(event),
    timestamp: event.createdAt,
    refs: basicRefsFor(event),
    visibility: event.type.startsWith("tool.") || event.type === "confirmation.needed" ? "expanded" : "compact",
    detail: safeEventDetail(event.detail),
  };
}

export function basicConfirmationDecisionSummary(
  decision: Pick<ConfirmationDecision, "decision" | "guidance">
): string {
  if (decision.decision === "approve_once") {
    return "已批准本次操作。";
  }
  if (decision.decision === "deny") {
    return "已拒绝本次操作，运行不会继续执行该动作。";
  }
  const guidance = decision.guidance === undefined ? undefined : compactSafeText(decision.guidance, 240);
  return guidance === undefined || guidance.length === 0
    ? "已收到补充指导。"
    : `已收到补充指导：${guidance}`;
}

function basicEventTitle(event: BasicAgentRunStreamEventProjectionInput): string {
  if (event.type === "run.started") return "任务已开始";
  if (event.type === "run.cancelled") return "任务已取消";
  if (event.type === "run.blocked") return "任务已暂停";
  if (event.type === "run.resumed") return "任务继续";
  if (event.type === "model.reasoning.delta") return "正在思考";
  if (event.type === "model.reasoning.completed") return "思考完成";
  if (event.type === "tool.requested") return "正在执行动作";
  if (event.type === "tool.completed") return "动作已完成";
  if (event.type === "tool.failed") return "动作未完成";
  if (event.type === "context.compaction.completed") return "上下文已压缩";
  if (event.type === "context.compaction.failed") return "上下文压缩失败";
  if (event.type === "confirmation.needed") return "需要确认";
  if (event.type === "user_approval.received") return "收到确认结果";
  if (event.type === "user.guidance") return "收到用户指导";
  if (event.type === "final.result") return "结果已生成";
  if (event.type === "run.failed") return "运行未完成";
  return event.agentLabel ?? "工作状态更新";
}

function basicStatusForRunEvent(event: BasicAgentRunStreamEventProjectionInput): AgentTaskStatus {
  if (event.type === "confirmation.needed") return "approval_needed";
  if (event.type === "user.guidance") return "needs_input";
  if (event.status === "approval_needed") return "approval_needed";
  if (event.status === "needs_input") return "needs_input";
  if (event.status === "running") return "running";
  if (event.type === "user_approval.received") return "blocked";
  if (event.type === "run.cancelled" || event.status === "cancelled") return "cancelled";
  if (event.type === "run.blocked" || event.status === "blocked") return "blocked";
  if (event.type === "run.failed" || event.status === "failed") return "failed";
  if (event.type === "final.result" || event.status === "completed") return "completed";
  if (event.status === "pending") return "queued";
  return "running";
}

function basicStatusForRunJob(job: BasicAgentRunProjectionInput): AgentTaskStatus {
  if (job.status === "pending") return "queued";
  if (job.status === "approval_needed") return "approval_needed";
  if (job.status === "needs_input") return "needs_input";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "blocked") return "blocked";
  if (job.status === "failed") return "failed";
  if (job.confirmationDecisions.some((decision) => decision.decision === "deny")) {
    return "blocked";
  }
  if (job.confirmationDecisions.some((decision) => decision.decision === "guidance")) {
    return "needs_input";
  }
  if (
    job.completed?.canvas?.kind === "desktop_agent_canvas" &&
    job.completed.canvas.agent?.pendingConfirmation !== undefined &&
    !job.confirmationDecisions.some((decision) => decision.decision === "approve_once")
  ) {
    return "approval_needed";
  }
  if (
    job.streamEvents.some((event) => event.type === "confirmation.needed") &&
    job.status !== "completed" &&
    !job.confirmationDecisions.some((decision) => decision.decision === "approve_once")
  ) {
    return "approval_needed";
  }
  if (job.status === "completed") return "completed";
  return "running";
}

function basicRunTitle(job: BasicAgentRunProjectionInput, status: AgentTaskStatus): string {
  if (job.status === "cancelled") return "已取消";
  if (job.status === "blocked") return "需要处理";
  if (job.status === "approval_needed") return "需要确认";
  if (job.status === "needs_input") return "需要补充";
  if (status === "needs_input") return "需要补充";
  if (status === "approval_needed") return "需要确认";
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "未完成";
  return "正在处理";
}

function basicRunCurrentStep(job: BasicAgentRunProjectionInput): string | undefined {
  const latest = [...job.streamEvents].reverse().find((event) =>
    event.type !== "model.reasoning.delta" &&
    event.type !== "model.reasoning.completed" &&
    (event.summary !== undefined || event.delta !== undefined)
  );
  return safeEventSummary(latest?.summary ?? latest?.delta);
}

function basicRunNextStep(status: AgentTaskStatus): string | undefined {
  if (status === "approval_needed") return "等待你确认或补充材料。";
  if (status === "needs_input") return "等待你补充指导后继续。";
  if (status === "queued") return "等待前一个任务完成。";
  if (status === "running") return "继续整理结果。";
  if (status === "blocked") return "需要重新发起或补充指导。";
  return undefined;
}

function compactSafeText(value: string, maxLength: number): string {
  const normalized = redactOrdinaryText(value, maxLength).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safeEventSummary(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const summary = redactOrdinaryText(value, 1_200);
  return summary.length === 0 ? undefined : summary;
}

function safeEventDetail(detail: BasicAgentRunStreamEventProjectionInput["detail"]): RunEvent["detail"] | undefined {
  if (detail === undefined) {
    return undefined;
  }
  const projected: NonNullable<RunEvent["detail"]> = {
    action: safeEventSummary(detail.action),
    path: safeEventSummary(detail.path),
    query: safeEventSummary(detail.query),
    command: safeEventSummary(detail.command),
    exitCode: detail.exitCode,
    preview: safeEventSummary(detail.preview),
    display: detail.display,
    truncated: detail.truncated,
    error: safeEventSummary(detail.error),
  };
  return Object.values(projected).some((value) => value !== undefined) ? projected : undefined;
}

function safeEventDelta(value: string): string | undefined {
  const delta = redactOrdinaryMarkdownFragment(value, 1_200);
  return delta.length === 0 ? undefined : delta;
}

function basicRefsFor(event: BasicAgentRunStreamEventProjectionInput): readonly ObservationRef[] {
  const refs: ObservationRef[] = [
    { kind: "event", id: event.eventId },
    ...event.modelCallRefs.map((id): ObservationRef => ({ kind: "model_call", id })),
    ...event.toolCallRefs.map((id): ObservationRef => ({ kind: "tool_call", id })),
    ...event.sourceRefs.map(sourceRefToObservationRef),
  ];
  return refs.filter((ref, index, values) => values.findIndex((candidate) => candidate.kind === ref.kind && candidate.id === ref.id) === index);
}

function sourceRefToObservationRef(ref: string): ObservationRef {
  const separator = ref.indexOf(":");
  if (separator > 0) {
    const kind = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    if (kind === "trace") return { kind: "trace", id };
    if (kind === "goal") return { kind: "goal", id };
    if (kind === "tool" || kind === "tool_call") return { kind: "tool_call", id };
    if (kind === "model" || kind === "model_call") return { kind: "model_call", id };
    if (kind === "artifact") return { kind: "artifact", id };
  }
  return { kind: "event", id: ref };
}
