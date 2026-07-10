import type {
  ModelRunReasoningEffort,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { ConfirmationDecision } from "../../domain/basic-agent/index.js";
import type { ToolConfirmationPolicy } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { PanelRunConfigurationFailureSummary, PanelRunSummary } from "../panel-run-summary.js";
import type { PanelRunCanvasReadModel } from "../panel-read-model/canvas/panel-canvas-read-model.js";
import type { PanelObservationReadModel, PanelRunStatus, PanelRunStreamEvent } from "../panel-read-model/run/index.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopTaskSoilInput } from "../task-soil/task-soil-workspace.js";
import type { AgentRunTreeAttachment } from "../agent-run-tree-attachment.js";
import { assertRunBirthFactsForKind, resolveRunModeForKind } from "../run-runtime-core/run-mode-policy.js";
import type { AgentArborRunKind, AgentArborRunMode } from "../run-runtime-core/run-mode-policy.js";
import { resolveCompatibleRunFacts } from "../run-facts-policy.js";
import { basicConfirmationDecisionSummary } from "../confirmation-copy.js";

export type PanelRunKind = AgentArborRunKind;
/**
 * "agent" is the ordinary default path; "deep" is an explicit advanced
 * compatibility path. Routes decide which modes they accept.
 */
export type PanelRunMode = AgentArborRunMode;
type PanelRunStreamEventInput = Omit<PanelRunStreamEvent, "sequence"> | PanelRunStreamEvent;

export type PanelRunCompletedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export type PanelRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution?: RunCapabilityResolution;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: PanelRunConfigurationFailureSummary;
};

export type PanelRunTerminalPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly reason: {
    readonly code: string;
    readonly message: string;
  };
  readonly summary?: PanelRunSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTreeAttachment;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly capabilityResolution?: RunCapabilityResolution;
};

export type PanelRunStatusPayload =
  | PanelRunCompletedPayload
  | PanelRunFailedPayload
  | PanelRunTerminalPayload;

export type PanelRunJob = {
  readonly runId: string;
  readonly runKind: PanelRunKind;
  readonly runMode: PanelRunMode;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly reasoningEffort?: ModelRunReasoningEffort;
  readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
  readonly agentDefinitionRef?: RunAgentDefinitionRef;
  readonly createdAt: string;
  status: PanelRunStatus;
  updatedAt: string;
  config: SanitizedModelProviderConfig;
  informationAccess: SanitizedInformationAccessConfig;
  capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  capabilityResolution?: RunCapabilityResolution;
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
    readonly runMode?: PanelRunMode;
    readonly goal: string;
    readonly aiMode: ModelRuntimeMode;
    readonly conversationId?: string;
    readonly assistantTurnId?: string;
    readonly runAfterRunId?: string;
    readonly taskSoilInput?: DesktopTaskSoilInput;
    readonly reasoningEffort?: ModelRunReasoningEffort;
    readonly toolConfirmationPolicy?: ToolConfirmationPolicy;
    readonly agentDefinitionRef?: RunAgentDefinitionRef;
    readonly config: SanitizedModelProviderConfig;
    readonly informationAccess: SanitizedInformationAccessConfig;
    readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  }): PanelRunJob {
    const now = nowIso();
    const runMode = resolvePanelRunMode(input.runKind, input.runMode);
    assertRunBirthFactsForKind({
      runKind: input.runKind,
      runMode,
      capabilitySnapshot: input.capabilitySnapshot,
      agentDefinitionRef: input.agentDefinitionRef,
    });
    const job: PanelRunJob = {
      runId: createId("panel-run"),
      runKind: input.runKind,
      runMode,
      goal: input.goal,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      runAfterRunId: input.runAfterRunId,
      taskSoilInput: input.taskSoilInput,
      reasoningEffort: input.reasoningEffort,
      toolConfirmationPolicy: input.toolConfirmationPolicy,
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

  get(runId: string): PanelRunJob | undefined {
    return this.jobs.get(runId);
  }

  list(): readonly PanelRunJob[] {
    return [...this.jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    job.status = "running";
    job.updatedAt = nowIso();
  }

  awaitApproval(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalPanelJobStatus(job.status)) {
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
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    job.status = "needs_input";
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

  complete(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeCompletedPayloadForJob(job, completed);
    job.status = "completed";
    applyResolvedRunFacts(job, normalized);
    job.completed = normalized;
    job.updatedAt = nowIso();
  }

  fail(runId: string, failed: PanelRunFailedPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeFailedPayloadForJob(job, failed);
    job.status = "failed";
    applyResolvedRunFacts(job, normalized);
    job.failed = normalized;
    job.updatedAt = nowIso();
  }

  cancel(runId: string, cancelled: PanelRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeTerminalPayloadForJob(job, cancelled);
    job.status = "cancelled";
    applyResolvedRunFacts(job, normalized);
    job.cancelled = normalized;
    job.updatedAt = nowIso();
    appendStreamEventToJob(job, {
      eventId: `${runId}:run.cancelled`,
      runId,
      type: "run.cancelled",
      createdAt: job.updatedAt,
      agentLabel: panelJobAgentLabel(job),
      summary: normalized.reason.message,
      status: "cancelled",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  block(runId: string, blocked: PanelRunTerminalPayload): void {
    const job = this.requireJob(runId);
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    const normalized = normalizeTerminalPayloadForJob(job, blocked);
    job.status = "blocked";
    applyResolvedRunFacts(job, normalized);
    job.blocked = normalized;
    job.updatedAt = nowIso();
    appendStreamEventToJob(job, {
      eventId: `${runId}:run.blocked`,
      runId,
      type: "run.blocked",
      createdAt: job.updatedAt,
      agentLabel: panelJobAgentLabel(job),
      summary: normalized.reason.message,
      status: "blocked",
      sourceRefs: [],
      modelCallRefs: [],
      toolCallRefs: [],
    });
  }

  recordConfirmationDecision(decision: PanelRunConfirmationDecisionRecord): void {
    const job = this.requireJob(decision.runId);
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    job.confirmationDecisions = [
      ...job.confirmationDecisions.filter((item) => item.confirmationId !== decision.confirmationId),
      decision,
    ];
    job.updatedAt = decision.decidedAt;
    if (job.runMode === "agent" && decision.decision === "approve_once") {
      return;
    }
    appendStreamEventToJob(job, {
      eventId: `${decision.runId}:confirmation:${decision.confirmationId}:${decision.decision}`,
      runId: decision.runId,
      type: decision.decision === "guidance" ? "user.guidance" : "user_approval.received",
      createdAt: decision.decidedAt,
      agentLabel: decision.decision === "guidance" ? "补充要求" : "用户",
      summary: basicConfirmationDecisionSummary(decision),
      status: decision.decision === "deny" ? "blocked" : "running",
      sourceRefs: [`confirmation:${decision.confirmationId}`],
      modelCallRefs: [],
      toolCallRefs: [],
      detail: {
        kind: "confirmation",
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
    if (isTerminalPanelJobStatus(job.status)) {
      return;
    }
    if (job.runMode === "agent") {
      return;
    }
    appendStreamEventToJob(job, {
      eventId: `${runId}:confirmation:${input.confirmationId}:run.resumed`,
      runId,
      type: "run.resumed",
      createdAt: input.resumedAt,
      agentLabel: panelJobAgentLabel(job),
      summary: "运行已恢复。",
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

function panelJobAgentLabel(job: Pick<PanelRunJob, "agentDefinitionRef">): string {
  const label = job.agentDefinitionRef?.agentDisplayName.trim();
  return label === undefined || label.length === 0 ? "AgentArbor" : label;
}

function isTerminalPanelJobStatus(status: PanelRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function applyResolvedRunFacts(
  job: PanelRunJob,
  facts: Pick<
    PanelRunCompletedPayload | PanelRunFailedPayload | PanelRunTerminalPayload,
    "config" | "informationAccess" | "capabilitySnapshot" | "capabilityResolution"
  >
): void {
  job.config = facts.config;
  job.informationAccess = facts.informationAccess;
  job.capabilitySnapshot = facts.capabilitySnapshot;
  job.capabilityResolution = facts.capabilityResolution;
}

function normalizeCompletedPayloadForJob(
  job: PanelRunJob,
  payload: PanelRunCompletedPayload
): PanelRunCompletedPayload {
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
  job: PanelRunJob,
  payload: PanelRunFailedPayload
): PanelRunFailedPayload {
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
  job: PanelRunJob,
  payload: PanelRunTerminalPayload
): PanelRunTerminalPayload {
  const facts = resolveCompatibleRunFacts(job, payload);
  return {
    ...payload,
    config: facts.config,
    informationAccess: facts.informationAccess,
    capabilitySnapshot: facts.capabilitySnapshot,
    capabilityResolution: facts.capabilityResolution,
  };
}

export function resolvePanelRunMode(
  runKind: PanelRunKind,
  runMode: PanelRunMode | undefined
): PanelRunMode {
  return resolveRunModeForKind(runKind, runMode);
}

export function panelRunPayloadForStatus(job: PanelRunJob): PanelRunStatusPayload | undefined {
  switch (job.status) {
    case "approval_needed":
    case "completed":
      return job.completed;
    case "failed":
      return job.failed;
    case "cancelled":
      return job.cancelled;
    case "blocked":
      return job.blocked;
    case "pending":
    case "running":
    case "needs_input":
      return undefined;
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

function sortedStreamEvents(job: PanelRunJob): readonly PanelRunStreamEvent[] {
  return [...job.streamEvents].sort((left, right) => left.sequence - right.sequence);
}
