import type { AgentTaskStatus, BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import {
  basicConfirmationDecisionSummary,
  cleanConfirmationSummary,
  isGenericApprovalDecisionText,
} from "../confirmation-copy.js";
import { redactOrdinaryMarkdownFragment, redactOrdinaryText } from "../safe-projection.js";

export { basicConfirmationDecisionSummary };

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
  readonly agentDefinitionRef?: BasicAgentRun["agentDefinitionRef"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly streamEvents: readonly BasicAgentRunStreamEventProjectionInput[];
  readonly confirmationDecisions: readonly Pick<ConfirmationDecision, "confirmationId" | "decision" | "guidance">[];
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
  readonly toolName?: string;
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
    agentDefinitionRef: job.agentDefinitionRef,
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
    toolName: event.toolName,
    refs: basicRefsFor(event),
    visibility: event.type.startsWith("tool.") || event.type === "confirmation.needed" ? "expanded" : "compact",
    detail: safeEventDetail(event.detail),
  };
}

function basicEventTitle(event: BasicAgentRunStreamEventProjectionInput): string {
  const label = event.agentLabel?.trim();
  if (label !== undefined && label.length > 0) return label;
  if (event.type === "run.started") return "任务";
  if (event.type === "run.cancelled") return "已取消";
  if (event.type === "run.blocked") return "需要处理";
  if (event.type === "run.resumed") return "运行恢复";
  if (event.type === "tool.requested" || event.type === "tool.completed") return "动作";
  if (event.type === "tool.failed") return "未完成";
  if (event.type === "context.compaction.completed" || event.type === "context.compaction.failed") return "上下文";
  if (event.type === "confirmation.needed") return "需要你判断";
  if (event.type === "user_approval.received") return "用户决定";
  if (event.type === "user.guidance") return "补充要求";
  if (event.type === "final.result") return "结果";
  if (event.type === "run.failed") return "未完成";
  return "更新";
}

function basicStatusForRunEvent(event: BasicAgentRunStreamEventProjectionInput): AgentTaskStatus {
  if (event.type === "confirmation.needed") return "approval_needed";
  if (event.type === "user.guidance") return "needs_input";
  if (event.status === "approval_needed") return "approval_needed";
  if (event.status === "needs_input") return "needs_input";
  if (event.status === "running") return "running";
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
  if (
    job.completed?.canvas?.kind === "desktop_agent_canvas" &&
    job.completed.canvas.agent?.pendingConfirmation !== undefined &&
    !hasDecisionForCurrentPendingConfirmation(job)
  ) {
    return "approval_needed";
  }
  if (
    job.streamEvents.some((event) => event.type === "confirmation.needed") &&
    job.status !== "completed" &&
    !hasLatestConfirmationDecision(job)
  ) {
    return "approval_needed";
  }
  if (job.status === "completed") return "completed";
  return "running";
}

function hasDecisionForCurrentPendingConfirmation(job: BasicAgentRunProjectionInput): boolean {
  const pending = pendingConfirmationIdFromCanvas(job.completed?.canvas);
  return pending !== undefined && job.confirmationDecisions.some((decision) => decision.confirmationId === pending);
}

function hasLatestConfirmationDecision(job: BasicAgentRunProjectionInput): boolean {
  const latestConfirmation = [...job.streamEvents]
    .reverse()
    .find((event) => event.type === "confirmation.needed");
  if (latestConfirmation === undefined) {
    return false;
  }
  const latestDecision = [...job.streamEvents]
    .reverse()
    .find((event) => event.type === "user_approval.received" || event.type === "user.guidance");
  if (latestDecision !== undefined && latestDecision.sequence > latestConfirmation.sequence) {
    return true;
  }
  const confirmationId = latestConfirmation.sourceRefs
    .map((ref) => ref.startsWith("confirmation:") ? ref.slice("confirmation:".length) : undefined)
    .find((ref): ref is string => ref !== undefined && ref.length > 0);
  return confirmationId !== undefined && job.confirmationDecisions.some((decision) => decision.confirmationId === confirmationId);
}

function pendingConfirmationIdFromCanvas(canvas: NonNullable<BasicAgentRunProjectionInput["completed"]>["canvas"]): string | undefined {
  const agent = asRecord(canvas?.agent);
  const pending = asRecord(agent.pendingConfirmation);
  const confirmationId = pending.confirmationId;
  return typeof confirmationId === "string" && confirmationId.trim().length > 0
    ? confirmationId.trim()
    : undefined;
}

function basicRunTitle(job: BasicAgentRunProjectionInput, status: AgentTaskStatus): string {
  if (job.status === "cancelled") return "已取消";
  if (job.status === "blocked") return "需要处理";
  if (job.status === "approval_needed") return "待处理";
  if (job.status === "needs_input") return "需要补充";
  if (status === "needs_input") return "需要补充";
  if (status === "approval_needed") return "待处理";
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "未完成";
  return "进行中";
}

function basicRunCurrentStep(job: BasicAgentRunProjectionInput): string | undefined {
  const latest = [...job.streamEvents].reverse().find((event) =>
    event.type !== "model.reasoning.delta" &&
    event.type !== "model.reasoning.completed" &&
    !isLowValueCurrentStepEvent(event) &&
    (event.summary !== undefined || event.delta !== undefined)
  );
  const summary = latest?.summary ?? latest?.delta;
  if (latest?.type === "confirmation.needed") {
    const cleanSummary = cleanConfirmationSummary(summary ?? "");
    return cleanSummary.length === 0 ? undefined : safeEventSummary(cleanSummary);
  }
  return safeEventSummary(summary);
}

function isLowValueCurrentStepEvent(event: BasicAgentRunStreamEventProjectionInput): boolean {
  if (event.type === "run.started" || event.type === "goal.received" || event.type === "run.resumed") {
    return true;
  }
  if (event.type === "user_approval.received") {
    return isGenericApprovalDecisionText(event.summary ?? event.detail?.preview ?? event.agentLabel);
  }
  return false;
}

function basicRunNextStep(status: AgentTaskStatus): string | undefined {
  void status;
  return undefined;
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
  const delta = redactOrdinaryMarkdownFragment(value, 8_000);
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
