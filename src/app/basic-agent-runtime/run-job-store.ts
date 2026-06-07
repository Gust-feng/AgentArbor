import { createId, nowIso } from "../../kernel/id.js";
import { assertRunBirthFactsForKind } from "../run-mode-policy.js";
import { resolveCompatibleRunFacts } from "../run-facts-policy.js";
import { basicConfirmationDecisionSummary } from "./run-projection.js";
import { resolveBasicAgentRunMode } from "./run-job.js";
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
    const runMode = resolveBasicAgentRunMode(input.runKind, input.runMode);
    assertRunBirthFactsForKind({
      runKind: input.runKind,
      runMode,
      capabilitySnapshot: input.capabilitySnapshot,
      agentDefinitionRef: input.agentDefinitionRef,
    });
    const job: StoredBasicAgentRunJob = {
      runId: createId("basic-run"),
      runKind: input.runKind,
      runMode,
      goal: input.goal,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      runAfterRunId: input.runAfterRunId,
      routeDecision: input.routeDecision,
      taskSoilInput: input.taskSoilInput,
      reasoningEffort: input.reasoningEffort,
      agentDefinitionRef: input.agentDefinitionRef,
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
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    job.status = "running";
    job.updatedAt = nowIso();
  }

  awaitApproval(runId: string, completed: BasicAgentRunCompletedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeCompletedPayloadForJob(job, completed);
    job.status = "approval_needed";
    applyResolvedRunFacts(job, normalized);
    job.completed = normalized;
    job.updatedAt = nowIso();
  }

  markNeedsInput(runId: string): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    job.status = "needs_input";
    job.updatedAt = nowIso();
  }

  complete(runId: string, completed: BasicAgentRunCompletedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeCompletedPayloadForJob(job, completed);
    job.status = "completed";
    applyResolvedRunFacts(job, normalized);
    job.completed = normalized;
    job.updatedAt = nowIso();
  }

  fail(runId: string, failed: BasicAgentRunFailedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeFailedPayloadForJob(job, failed);
    job.status = "failed";
    applyResolvedRunFacts(job, normalized);
    job.failed = normalized;
    job.updatedAt = nowIso();
  }

  cancel(runId: string, cancelled: BasicAgentRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeTerminalPayloadForJob(job, cancelled);
    job.status = "cancelled";
    applyResolvedRunFacts(job, normalized);
    job.cancelled = normalized;
    job.updatedAt = nowIso();
    this.appendStreamEvent(runId, {
      eventId: `${runId}:run.cancelled`,
      runId,
      type: "run.cancelled",
      createdAt: job.updatedAt,
      agentLabel: basicAgentJobLabel(job),
      summary: normalized.reason.message,
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  block(runId: string, blocked: BasicAgentRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeTerminalPayloadForJob(job, blocked);
    job.status = "blocked";
    applyResolvedRunFacts(job, normalized);
    job.blocked = normalized;
    job.updatedAt = nowIso();
    this.appendStreamEvent(runId, {
      eventId: `${runId}:run.blocked`,
      runId,
      type: "run.blocked",
      createdAt: job.updatedAt,
      agentLabel: basicAgentJobLabel(job),
      summary: normalized.reason.message,
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  recordConfirmationDecision(decision: BasicAgentRunConfirmationDecisionRecord): void {
    const job = this.requireJob(decision.runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
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
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentJobStatus(job.status)) {
      return;
    }
    appendStreamEventToJob(job, {
      eventId: `${runId}:confirmation:${input.confirmationId}:run.resumed`,
      runId,
      type: "run.resumed",
      createdAt: input.resumedAt,
      agentLabel: basicAgentJobLabel(job),
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

function basicAgentJobLabel(job: Pick<StoredBasicAgentRunJob, "agentDefinitionRef">): string {
  const label = job.agentDefinitionRef?.agentDisplayName.trim();
  return label === undefined || label.length === 0 ? "AgentArbor" : label;
}

function isTerminalBasicAgentJobStatus(status: BasicAgentRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function applyResolvedRunFacts(
  job: StoredBasicAgentRunJob,
  facts: Pick<
    BasicAgentRunCompletedPayload | BasicAgentRunFailedPayload | BasicAgentRunTerminalPayload,
    "config" | "informationAccess" | "capabilitySnapshot" | "capabilityResolution"
  >
): void {
  job.config = facts.config;
  job.informationAccess = facts.informationAccess;
  job.capabilitySnapshot = facts.capabilitySnapshot;
  job.capabilityResolution = facts.capabilityResolution;
}

function normalizeCompletedPayloadForJob(
  job: StoredBasicAgentRunJob,
  payload: BasicAgentRunCompletedPayload
): BasicAgentRunCompletedPayload {
  const facts = resolveCompatibleRunFacts(job, payload);
  return {
    ...payload,
    config: facts.config,
    informationAccess: facts.informationAccess,
    capabilitySnapshot: facts.capabilitySnapshot,
    capabilityResolution: facts.capabilityResolution,
  };
}

function normalizeFailedPayloadForJob(
  job: StoredBasicAgentRunJob,
  payload: BasicAgentRunFailedPayload
): BasicAgentRunFailedPayload {
  const facts = resolveCompatibleRunFacts(job, payload);
  return {
    ...payload,
    config: facts.config,
    informationAccess: facts.informationAccess,
    capabilitySnapshot: facts.capabilitySnapshot,
    capabilityResolution: facts.capabilityResolution,
  };
}

function normalizeTerminalPayloadForJob(
  job: StoredBasicAgentRunJob,
  payload: BasicAgentRunTerminalPayload
): BasicAgentRunTerminalPayload {
  const facts = resolveCompatibleRunFacts(job, payload);
  return {
    ...payload,
    config: facts.config,
    informationAccess: facts.informationAccess,
    capabilitySnapshot: facts.capabilitySnapshot,
    capabilityResolution: facts.capabilityResolution,
  };
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
