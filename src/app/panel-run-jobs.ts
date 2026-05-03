import type { SanitizedModelProviderConfig } from "../domain/config/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { UndergroundAiMode } from "./intelligence-channel-factory.js";
import type { PanelObservationReadModel, PanelRunStatus } from "./panel-run-read-model.js";
import type { MinimalRuntime } from "./runtime.js";
import type { UndergroundDemoSummary } from "./underground-demo-summary.js";

export type PanelRunCompletedPayload = {
  readonly config: SanitizedModelProviderConfig;
  readonly summary: UndergroundDemoSummary;
  readonly observation: PanelObservationReadModel;
};

export type PanelRunFailedPayload = {
  readonly config: SanitizedModelProviderConfig;
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
  readonly goal: string;
  readonly aiMode: UndergroundAiMode;
  readonly createdAt: string;
  status: PanelRunStatus;
  updatedAt: string;
  config: SanitizedModelProviderConfig;
  runtime?: MinimalRuntime;
  traceId?: string;
  goalId?: string;
  completed?: PanelRunCompletedPayload;
  failed?: PanelRunFailedPayload;
};

export class PanelRunJobStore {
  private readonly jobs = new Map<string, PanelRunJob>();

  create(input: {
    readonly goal: string;
    readonly aiMode: UndergroundAiMode;
    readonly config: SanitizedModelProviderConfig;
  }): PanelRunJob {
    const now = nowIso();
    const job: PanelRunJob = {
      runId: createId("panel-run"),
      goal: input.goal,
      aiMode: input.aiMode,
      config: input.config,
      status: "pending",
      createdAt: now,
      updatedAt: now,
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

  complete(runId: string, completed: PanelRunCompletedPayload): void {
    const job = this.requireJob(runId);
    job.status = "completed";
    job.config = completed.config;
    job.completed = completed;
    job.updatedAt = nowIso();
  }

  fail(runId: string, failed: PanelRunFailedPayload): void {
    const job = this.requireJob(runId);
    job.status = "failed";
    job.config = failed.config;
    job.failed = failed;
    job.updatedAt = nowIso();
  }

  private requireJob(runId: string): PanelRunJob {
    const job = this.jobs.get(runId);
    if (job === undefined) {
      throw new Error(`Panel run job not found: ${runId}`);
    }
    return job;
  }
}
