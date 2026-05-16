import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";
import type { BasicAgentCapabilitySnapshot } from "../domain/config/index.js";
import type { ConfirmationDecision } from "../domain/basic-agent/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import type { DesktopIntentDecision } from "./desktop-intent-router.js";
import type { PanelRunCanvasReadModel } from "./panel-canvas-read-model.js";
import type { PanelObservationReadModel, PanelRunStatus, PanelRunStreamEvent } from "./panel-run-read-model.js";
import type { MinimalRuntime } from "./runtime.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";
import type { AgentRunTree } from "../domain/underground/index.js";
import { basicConfirmationDecisionSummary } from "./basic-agent-runtime/index.js";

export type PanelRunKind = "desktop" | "underground";
/**
 * Desktop runs share the same panel/run infrastructure. "agent" is the
 * ordinary default path; "deep" is an explicit advanced path backed by the
 * Underground architecture.
 */
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
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: PanelRunCanvasReadModel;
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
  capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
    readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
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
      capabilitySnapshot: input.capabilitySnapshot,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      streamEvents: [],
      streamEventIds: new Set<string>(),
      nextStreamSequence: 1,
      confirmationDecisions: [],
    };
    this.jobs.set(job.runId, job);
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
  }

  markResuming(runId: string): void {
    const job = this.requireJob(runId);
    if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "blocked") {
      job.status = "running";
    }
    job.updatedAt = nowIso();
  }

  awaitApproval(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    job.status = "approval_needed";
    job.config = completed.config;
    job.informationAccess = completed.informationAccess;
    job.completed = completed;
    job.updatedAt = nowIso();
  }

  markNeedsInput(runId: string): void {
    const job = this.requireJob(runId);
    if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "blocked") {
      job.status = "needs_input";
    }
    job.updatedAt = nowIso();
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
  }

  setRouteDecision(runId: string, decision: DesktopIntentDecision): void {
    const job = this.requireJob(runId);
    job.routeDecision = decision;
    job.updatedAt = nowIso();
  }

  complete(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    if (job.status === "failed" || job.status === "cancelled" || job.status === "blocked") {
      return;
    }
    job.status = "completed";
    job.config = completed.config;
    job.informationAccess = completed.informationAccess;
    job.completed = completed;
    job.updatedAt = nowIso();
  }

  fail(runId: string, failed: PanelRunFailedPayload): void {
    const job = this.requireJob(runId);
    job.status = "failed";
    job.config = failed.config;
    job.informationAccess = failed.informationAccess;
    job.failed = failed;
    job.updatedAt = nowIso();
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
    });
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
    });
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
      summary: basicConfirmationDecisionSummary(decision),
      status: decision.decision === "approve_once" ? "running" : decision.decision === "deny" ? "blocked" : "needs_input",
      sourceRefs: [`confirmation:${decision.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
    });
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
    });
  }

  appendStreamEvent(runId: string, event: PanelRunStreamEventInput): PanelRunStreamEvent {
    return appendStreamEventToJob(this.requireJob(runId), event);
  }

  syncStreamEvents(runId: string, events: readonly PanelRunStreamEventInput[]): readonly PanelRunStreamEvent[] {
    const job = this.requireJob(runId);
    for (const event of events) {
      appendStreamEventToJob(job, event);
    }
    return sortedStreamEvents(job);
  }

  private requireJob(runId: string): PanelRunJob {
    const job = this.jobs.get(runId);
    if (job === undefined) {
      throw new Error(`Panel run job not found: ${runId}`);
    }
    return job;
  }
}

function appendStreamEventToJob(
  job: PanelRunJob,
  event: PanelRunStreamEventInput
): PanelRunStreamEvent {
  const existing = job.streamEventIds.has(event.eventId)
    ? job.streamEvents.find((item) => item.eventId === event.eventId)
    : undefined;
  if (existing !== undefined) {
    if (event.type === "run.started") {
      updateStartedEvent(existing, event);
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
  job.updatedAt = nowIso();
  return next;
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
