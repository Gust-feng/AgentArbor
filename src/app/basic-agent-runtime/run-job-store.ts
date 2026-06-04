import { createId, nowIso } from "../../kernel/id.js";
import { basicConfirmationDecisionSummary } from "./run-projection.js";
import type {
  BasicAgentRunConfirmationDecisionRecord,
  BasicAgentRunCompletedPayload,
  BasicAgentRunFailedPayload,
  BasicAgentRunJob,
  BasicAgentRunJobCreateInput,
  BasicAgentRunJobStore,
  BasicAgentRunStatus,
  BasicAgentRunStreamEvent,
  BasicAgentRunTerminalPayload,
} from "./run-job.js";

type BasicAgentRunStreamEventInput = Omit<BasicAgentRunStreamEvent, "sequence"> | BasicAgentRunStreamEvent;

type StoredBasicAgentRunJob = Omit<
  BasicAgentRunJob,
  "status" | "updatedAt" | "streamEvents" | "confirmationDecisions" | "completed" | "failed" | "cancelled" | "blocked"
> & {
  status: BasicAgentRunStatus;
  updatedAt: string;
  streamEvents: BasicAgentRunStreamEvent[];
  confirmationDecisions: BasicAgentRunConfirmationDecisionRecord[];
  completed?: BasicAgentRunCompletedPayload;
  failed?: BasicAgentRunFailedPayload;
  cancelled?: BasicAgentRunTerminalPayload;
  blocked?: BasicAgentRunTerminalPayload;
  streamEventIds: Set<string>;
  nextStreamSequence: number;
};

export class InMemoryBasicAgentRunJobStore implements BasicAgentRunJobStore {
  private readonly jobs = new Map<string, StoredBasicAgentRunJob>();

  create(input: BasicAgentRunJobCreateInput): BasicAgentRunJob {
    const now = nowIso();
    const job: StoredBasicAgentRunJob = {
      runId: createId("basic-run"),
      runKind: input.runKind,
      runMode: input.runMode ?? "agent",
      goal: input.goal,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      runAfterRunId: input.runAfterRunId,
      routeDecision: input.routeDecision,
      taskSoilInput: input.taskSoilInput,
      reasoningEffort: input.reasoningEffort,
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

  get(runId: string): BasicAgentRunJob | undefined {
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

  awaitApproval(runId: string, completed: BasicAgentRunCompletedPayload): void {
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

  complete(runId: string, completed: BasicAgentRunCompletedPayload): void {
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

  fail(runId: string, failed: BasicAgentRunFailedPayload): void {
    const job = this.requireJob(runId);
    job.status = "failed";
    job.config = failed.config;
    job.informationAccess = failed.informationAccess;
    job.failed = failed;
    job.updatedAt = nowIso();
  }

  cancel(runId: string, cancelled: BasicAgentRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    job.status = "cancelled";
    job.config = cancelled.config;
    job.informationAccess = cancelled.informationAccess;
    job.cancelled = cancelled;
    job.updatedAt = nowIso();
    this.appendStreamEvent(runId, {
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

  block(runId: string, blocked: BasicAgentRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (job.status === "failed" || job.status === "cancelled" || job.status === "blocked") {
      return;
    }
    job.status = "blocked";
    job.config = blocked.config;
    job.informationAccess = blocked.informationAccess;
    job.blocked = blocked;
    job.updatedAt = nowIso();
    this.appendStreamEvent(runId, {
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

  recordConfirmationDecision(decision: BasicAgentRunConfirmationDecisionRecord): void {
    const job = this.requireJob(decision.runId);
    job.confirmationDecisions = [
      ...job.confirmationDecisions.filter((item) => item.confirmationId !== decision.confirmationId),
      decision,
    ];
    job.updatedAt = decision.decidedAt;
    this.appendStreamEvent(decision.runId, {
      eventId: `${decision.runId}:confirmation:${decision.confirmationId}:${decision.decision}`,
      runId: decision.runId,
      type: decision.decision === "guidance" ? "user.guidance" : "user_approval.received",
      createdAt: decision.decidedAt,
      agentLabel: decision.decision === "guidance" ? "用户指导" : "用户确认",
      summary: basicConfirmationDecisionSummary(decision),
      status: "running",
      sourceRefs: [`confirmation:${decision.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
      detail: {
        action: decision.decision,
        preview: decision.guidance,
      },
    });
  }

  recordRunResumed(runId: string, input: {
    readonly confirmationId: string;
    readonly resumedAt: string;
  }): void {
    this.appendStreamEvent(runId, {
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

  appendStreamEvent(runId: string, event: BasicAgentRunStreamEventInput): BasicAgentRunStreamEvent {
    return appendStreamEventToJob(this.requireJob(runId), event);
  }

  syncStreamEvents(runId: string, events: readonly BasicAgentRunStreamEventInput[]): readonly BasicAgentRunStreamEvent[] {
    const job = this.requireJob(runId);
    for (const event of events) {
      appendStreamEventToJob(job, event);
    }
    return sortedStreamEvents(job);
  }

  private requireJob(runId: string): StoredBasicAgentRunJob {
    const job = this.jobs.get(runId);
    if (job === undefined) {
      throw new Error(`Basic Agent run job not found: ${runId}`);
    }
    return job;
  }
}

function appendStreamEventToJob(
  job: StoredBasicAgentRunJob,
  event: BasicAgentRunStreamEventInput
): BasicAgentRunStreamEvent {
  const existing = job.streamEventIds.has(event.eventId)
    ? job.streamEvents.find((item) => item.eventId === event.eventId)
    : undefined;
  if (existing !== undefined) {
    return existing;
  }
  const next: BasicAgentRunStreamEvent = {
    ...event,
    sequence: "sequence" in event ? event.sequence : job.nextStreamSequence,
  };
  job.nextStreamSequence = Math.max(job.nextStreamSequence, next.sequence + 1);
  job.streamEvents = [...job.streamEvents, next];
  job.streamEventIds.add(next.eventId);
  job.updatedAt = nowIso();
  return next;
}

function sortedStreamEvents(job: StoredBasicAgentRunJob): readonly BasicAgentRunStreamEvent[] {
  return [...job.streamEvents].sort((left, right) => left.sequence - right.sequence);
}
