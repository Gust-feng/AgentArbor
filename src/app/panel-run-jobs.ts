import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { AgentTaskStatus, BasicAgentRun, ConfirmationDecision, RunEvent } from "../domain/basic-agent/index.js";
import type { ObservationRef } from "../domain/observation/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import type { DesktopIntentDecision } from "./desktop-intent-router.js";
import type { PanelRunCanvasReadModel } from "./panel-canvas-read-model.js";
import type { PanelObservationReadModel, PanelRunStatus, PanelRunStreamEvent } from "./panel-run-read-model.js";
import type { MinimalRuntime } from "./runtime.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";
import type { AgentRunTree } from "../domain/underground/index.js";
import { BasicAgentRunStore, redactOrdinaryText, type BasicAgentRunReplay } from "./basic-agent-runtime/index.js";

export type PanelRunKind = "desktop" | "underground";
export type PanelDesktopRunMode = "agent" | "deep";
type PanelRunStreamEventInput = Omit<PanelRunStreamEvent, "sequence"> | PanelRunStreamEvent;

export type PanelRunCompletedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: PanelRunCanvasReadModel;
};

export type PanelRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: {
    readonly ai: UndergroundDemoSummary["ai"];
  };
};

export type PanelRunTerminalPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly reason: {
    readonly code: string;
    readonly message: string;
  };
};

export type PanelRunJob = {
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelDesktopRunMode;
  readonly goal: string;
  readonly aiMode: UndergroundAiMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  routeDecision?: DesktopIntentDecision;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly createdAt: string;
  status: PanelRunStatus;
  updatedAt: string;
  config: SanitizedModelProviderConfig;
  informationAccess: SanitizedInformationAccessConfig;
  runtime?: MinimalRuntime;
  traceId?: string;
  goalId?: string;
  streamEvents: PanelRunStreamEvent[];
  streamEventIds: Set<string>;
  nextStreamSequence: number;
  completed?: PanelRunCompletedPayload;
  failed?: PanelRunFailedPayload;
  cancelled?: PanelRunTerminalPayload;
  blocked?: PanelRunTerminalPayload;
  confirmationDecisions: PanelRunConfirmationDecisionRecord[];
};

export type PanelRunConfirmationDecisionRecord = ConfirmationDecision;

export class PanelRunJobStore {
  private readonly jobs = new Map<string, PanelRunJob>();
  private readonly basicRuns = new BasicAgentRunStore();

  create(input: {
    readonly runKind: PanelRunKind;
    readonly runMode?: PanelDesktopRunMode;
    readonly goal: string;
    readonly aiMode: UndergroundAiMode;
    readonly conversationId?: string;
    readonly assistantTurnId?: string;
    readonly runAfterRunId?: string;
    readonly routeDecision?: DesktopIntentDecision;
    readonly taskSoilInput?: DesktopTaskSoilInput;
    readonly config: SanitizedModelProviderConfig;
    readonly informationAccess: SanitizedInformationAccessConfig;
  }): PanelRunJob {
    const now = nowIso();
    const job: PanelRunJob = {
      runId: createId("panel-run"),
      runKind: input.runKind,
      runMode: input.runMode ?? "agent",
      goal: input.goal,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      runAfterRunId: input.runAfterRunId,
      routeDecision: input.routeDecision,
      taskSoilInput: input.taskSoilInput,
      config: input.config,
      informationAccess: input.informationAccess,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      streamEvents: [],
      streamEventIds: new Set<string>(),
      nextStreamSequence: 1,
      confirmationDecisions: [],
    };
    this.jobs.set(job.runId, job);
    this.syncBasicRun(job);
    return job;
  }

  get(runId: string): PanelRunJob | undefined {
    return this.jobs.get(runId);
  }

  markRunning(runId: string): void {
    const job = this.requireJob(runId);
    if (job.status === "pending") {
      job.status = "running";
    }
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  markResuming(runId: string): void {
    const job = this.requireJob(runId);
    if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "blocked") {
      job.status = "running";
    }
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  attachRuntime(input: {
    readonly runId: string;
    readonly runtime: MinimalRuntime;
    readonly traceId: string;
    readonly goalId: string;
  }): void {
    const job = this.requireJob(input.runId);
    job.runtime = input.runtime;
    job.traceId = input.traceId;
    job.goalId = input.goalId;
    if (job.status === "pending") {
      job.status = "running";
    }
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  setRouteDecision(runId: string, decision: DesktopIntentDecision): void {
    const job = this.requireJob(runId);
    job.routeDecision = decision;
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  complete(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    job.status = "completed";
    job.config = completed.config;
    job.informationAccess = completed.informationAccess;
    job.completed = completed;
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  fail(runId: string, failed: PanelRunFailedPayload): void {
    const job = this.requireJob(runId);
    job.status = "failed";
    job.config = failed.config;
    job.informationAccess = failed.informationAccess;
    job.failed = failed;
    job.updatedAt = nowIso();
    this.syncBasicRun(job);
  }

  cancel(runId: string, cancelled: PanelRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    job.status = "cancelled";
    job.config = cancelled.config;
    job.informationAccess = cancelled.informationAccess;
    job.cancelled = cancelled;
    job.updatedAt = nowIso();
    appendStreamEventToJob(job, {
      eventId: `${runId}:run.cancelled`,
      runId,
      type: "run.cancelled",
      createdAt: job.updatedAt,
      agentLabel: "AgentArbor",
      summary: cancelled.reason.message,
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    }, this.basicRuns);
    this.syncBasicRun(job);
  }

  block(runId: string, blocked: PanelRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (job.status === "failed" || job.status === "cancelled" || job.status === "blocked") {
      return;
    }
    job.status = "blocked";
    job.config = blocked.config;
    job.informationAccess = blocked.informationAccess;
    job.blocked = blocked;
    job.updatedAt = nowIso();
    appendStreamEventToJob(job, {
      eventId: `${runId}:run.blocked`,
      runId,
      type: "run.blocked",
      createdAt: job.updatedAt,
      agentLabel: "AgentArbor",
      summary: blocked.reason.message,
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    }, this.basicRuns);
    this.syncBasicRun(job);
  }

  recordConfirmationDecision(decision: PanelRunConfirmationDecisionRecord): void {
    const job = this.requireJob(decision.runId);
    job.confirmationDecisions = [
      ...job.confirmationDecisions.filter((item) => item.confirmationId !== decision.confirmationId),
      decision,
    ];
    job.updatedAt = decision.decidedAt;
    appendStreamEventToJob(job, {
      eventId: `${decision.runId}:confirmation:${decision.confirmationId}:${decision.decision}`,
      runId: decision.runId,
      type: decision.decision === "guidance" ? "user.guidance" : "user_approval.received",
      createdAt: decision.decidedAt,
      agentLabel: decision.decision === "guidance" ? "用户指导" : "用户确认",
      summary: confirmationDecisionSummary(decision),
      status: decision.decision === "approve_once" ? "running" : decision.decision === "deny" ? "blocked" : "pending",
      sourceRefs: [`confirmation:${decision.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
    }, this.basicRuns);
    this.syncBasicRun(job);
  }

  recordRunResumed(runId: string, input: {
    readonly confirmationId: string;
    readonly resumedAt: string;
  }): void {
    const job = this.requireJob(runId);
    appendStreamEventToJob(job, {
      eventId: `${runId}:confirmation:${input.confirmationId}:run.resumed`,
      runId,
      type: "run.resumed",
      createdAt: input.resumedAt,
      agentLabel: "AgentArbor",
      summary: "已批准本次操作，运行继续。",
      status: "running",
      sourceRefs: [`confirmation:${input.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
    }, this.basicRuns);
    this.syncBasicRun(job);
  }

  appendStreamEvent(runId: string, event: PanelRunStreamEventInput): PanelRunStreamEvent {
    const appended = appendStreamEventToJob(this.requireJob(runId), event, this.basicRuns);
    this.syncBasicRun(this.requireJob(runId));
    return appended;
  }

  syncStreamEvents(runId: string, events: readonly PanelRunStreamEventInput[]): readonly PanelRunStreamEvent[] {
    const job = this.requireJob(runId);
    for (const event of events) {
      appendStreamEventToJob(job, event, this.basicRuns);
    }
    this.syncBasicRun(job);
    return sortedStreamEvents(job);
  }

  replayBasicEvents(runId: string, afterSequence = 0): BasicAgentRunReplay | undefined {
    if (!this.jobs.has(runId)) {
      return undefined;
    }
    return this.basicRuns.replayEvents(runId, afterSequence);
  }

  getBasicRun(runId: string): BasicAgentRun | undefined {
    return this.basicRuns.get(runId);
  }

  restoreBasicProjection(input: {
    readonly run: BasicAgentRun;
    readonly events: readonly RunEvent[];
  }): BasicAgentRun {
    return this.basicRuns.restore(input);
  }

  private requireJob(runId: string): PanelRunJob {
    const job = this.jobs.get(runId);
    if (job === undefined) {
      throw new Error(`Panel run job not found: ${runId}`);
    }
    return job;
  }

  private syncBasicRun(job: PanelRunJob): BasicAgentRun {
    return this.basicRuns.upsert(toBasicRun(job));
  }
}

function appendStreamEventToJob(
  job: PanelRunJob,
  event: PanelRunStreamEventInput,
  basicRuns: BasicAgentRunStore
): PanelRunStreamEvent {
  const existing = job.streamEventIds.has(event.eventId)
    ? job.streamEvents.find((item) => item.eventId === event.eventId)
    : undefined;
  if (existing !== undefined) {
    if (event.type === "run.started") {
      updateStartedEvent(existing, event);
      basicRuns.replaceEvent(toBasicRunEvent(existing));
    }
    return existing;
  }
  if (event.type === "model.output.delta") {
    const liveDelta = liveModelDeltaForSameCall(job, event);
    if (liveDelta !== undefined) {
      return liveDelta;
    }
  }
  const next: PanelRunStreamEvent = {
    ...event,
    sequence: job.nextStreamSequence,
  };
  job.nextStreamSequence += 1;
  job.streamEvents.push(next);
  job.streamEventIds.add(next.eventId);
  basicRuns.publishEvent(toBasicRunEvent(next));
  job.updatedAt = nowIso();
  return next;
}

function toBasicRun(job: PanelRunJob): BasicAgentRun {
  return {
    runId: job.runId,
    conversationId: job.conversationId,
    title: basicRunTitle(job),
    goalSummary: redactOrdinaryText(job.goal, 400),
    status: basicStatusForJob(job),
    runMode: job.runMode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    currentStep: basicRunCurrentStep(job),
    nextStep: basicRunNextStep(job),
    requiresUserAction: basicStatusForJob(job) === "approval_needed" || job.status === "blocked",
    eventCursor: {
      lastSequence: 0,
      eventCount: 0,
    },
  };
}

function updateStartedEvent(existing: PanelRunStreamEvent, event: PanelRunStreamEventInput): void {
  Object.assign(existing as {
    summary?: string;
    agentLabel?: string;
    status?: PanelRunStreamEvent["status"];
    toolName?: string;
    detail?: PanelRunStreamEvent["detail"];
  }, {
    summary: event.summary,
    agentLabel: event.agentLabel,
    status: event.status,
    toolName: event.toolName ?? existing.toolName,
    detail: event.detail ?? existing.detail,
  });
}

function liveModelDeltaForSameCall(
  job: PanelRunJob,
  event: PanelRunStreamEventInput
): PanelRunStreamEvent | undefined {
  const requestIds = new Set(event.modelCallRefs);
  if (requestIds.size === 0) {
    return undefined;
  }
  return job.streamEvents.find(
    (item) =>
      item.type === "model.output.delta" &&
      item.eventId.startsWith(`${job.runId}:live:model.output.delta:`) &&
      item.modelCallRefs.some((requestId) => requestIds.has(requestId))
  );
}

function sortedStreamEvents(job: PanelRunJob): readonly PanelRunStreamEvent[] {
  return [...job.streamEvents].sort((left, right) => left.sequence - right.sequence);
}

function toBasicRunEvent(event: PanelRunStreamEvent): RunEvent {
  const summary = safeEventSummary(event.detail?.preview ?? event.delta ?? event.summary);
  return {
    id: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    title: basicEventTitle(event),
    summary,
    status: basicStatusFor(event),
    timestamp: event.createdAt,
    refs: basicRefsFor(event),
    visibility: event.type.startsWith("tool.") || event.type === "confirmation.needed" ? "expanded" : "compact",
  };
}

function basicEventTitle(event: PanelRunStreamEvent): string {
  if (event.type === "run.started") return "任务已开始";
  if (event.type === "run.cancelled") return "任务已取消";
  if (event.type === "run.blocked") return "任务已暂停";
  if (event.type === "run.resumed") return "任务继续";
  if (event.type === "tool.requested") return "正在使用工具";
  if (event.type === "tool.completed") return "工具已完成";
  if (event.type === "tool.failed") return "工具未完成";
  if (event.type === "confirmation.needed") return "需要确认";
  if (event.type === "user_approval.received") return "收到确认结果";
  if (event.type === "user.guidance") return "收到用户指导";
  if (event.type === "final.result") return "结果已生成";
  if (event.type === "run.failed") return "运行未完成";
  return event.agentLabel ?? "工作状态更新";
}

function basicStatusFor(event: PanelRunStreamEvent): AgentTaskStatus {
  if (event.type === "confirmation.needed") return "approval_needed";
  if (event.type === "user.guidance") return "needs_input";
  if (event.type === "user_approval.received") return "blocked";
  if (event.type === "run.cancelled" || event.status === "cancelled") return "cancelled";
  if (event.type === "run.blocked" || event.status === "blocked") return "blocked";
  if (event.type === "run.failed" || event.status === "failed") return "failed";
  if (event.type === "final.result" || event.status === "completed") return "completed";
  if (event.status === "pending") return "queued";
  return "running";
}

function basicStatusForJob(job: PanelRunJob): AgentTaskStatus {
  if (job.status === "pending") return "queued";
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
    job.completed.canvas.agent.pendingConfirmation !== undefined &&
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

function basicRunTitle(job: PanelRunJob): string {
  if (job.status === "cancelled") return "已取消";
  if (job.status === "blocked") return "需要处理";
  if (basicStatusForJob(job) === "needs_input") return "需要补充";
  if (basicStatusForJob(job) === "approval_needed") return "需要确认";
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "未完成";
  return "正在处理";
}

function basicRunCurrentStep(job: PanelRunJob): string | undefined {
  const latest = [...job.streamEvents].reverse().find((event) => event.summary !== undefined || event.delta !== undefined);
  return safeEventSummary(latest?.summary ?? latest?.delta);
}

function basicRunNextStep(job: PanelRunJob): string | undefined {
  const status = basicStatusForJob(job);
  if (status === "approval_needed") return "等待你确认或补充材料。";
  if (status === "needs_input") return "等待你补充指导后继续。";
  if (status === "queued") return "等待前一个任务完成。";
  if (status === "running") return "继续整理结果。";
  if (status === "blocked") return "需要重新发起或补充指导。";
  return undefined;
}

function confirmationDecisionSummary(decision: PanelRunConfirmationDecisionRecord): string {
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

function basicRefsFor(event: PanelRunStreamEvent): readonly ObservationRef[] {
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
