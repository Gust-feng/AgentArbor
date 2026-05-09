import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import type { DesktopIntentDecision } from "./desktop-intent-router.js";
import type { PanelRunCanvasReadModel } from "./panel-canvas-read-model.js";
import type { PanelObservationReadModel, PanelRunStatus, PanelRunStreamEvent } from "./panel-run-read-model.js";
import type { MinimalRuntime } from "./runtime.js";
import type { DesktopTaskSoilInput } from "./task-soil-workspace.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";
import type { AgentRunTree } from "../domain/underground/index.js";

export type PanelRunKind = "desktop" | "underground";
export type PanelDesktopRunMode = "agent" | "deep";

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
};

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

  appendStreamEvent(runId: string, event: Omit<PanelRunStreamEvent, "sequence">): PanelRunStreamEvent {
    const job = this.requireJob(runId);
    const existing = job.streamEventIds.has(event.eventId)
      ? job.streamEvents.find((item) => item.eventId === event.eventId)
      : undefined;
    if (existing !== undefined) {
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

  private requireJob(runId: string): PanelRunJob {
    const job = this.jobs.get(runId);
    if (job === undefined) {
      throw new Error(`Panel run job not found: ${runId}`);
    }
    return job;
  }
}
