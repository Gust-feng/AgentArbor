import type { BasicAgentCapabilitySnapshot, SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import { nowIso } from "../../kernel/id.js";
import type { UndergroundAiMode } from "../intelligence-channel-factory.js";
import type { DesktopIntentDecision } from "../desktop-intent-router.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { PanelObservationReadModel } from "../panel-run-read-model.js";
import type { PanelDesktopRunMode, PanelRunJob, PanelRunJobStore, PanelRunKind } from "../panel-run-jobs.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { UndergroundDemoSummary } from "../underground-demo-summary.js";
import type { AgentRunTree } from "../../domain/underground/index.js";
import type { BasicAgentRunReplay } from "./event-hub.js";
import type { BasicAgentExecutionAdapter } from "./execution-adapter.js";
import { BasicAgentRunStore } from "./run-store.js";
import { projectPanelJobToBasicRun, projectPanelStreamEventToRunEvent } from "./panel-projection.js";
import type { PanelRunStreamEvent } from "../panel-run-read-model.js";

export type BasicAgentRunExecutorConfig = {
  readonly getModelProviderConfig: () => Promise<SanitizedModelProviderConfig>;
  readonly getInformationAccessConfig: () => Promise<SanitizedInformationAccessConfig>;
  readonly getCapabilitySnapshot?: () => Promise<BasicAgentCapabilitySnapshot>;
  readonly runJobs: PanelRunJobStore;
  readonly activeRunJobs: Set<Promise<void>>;
  readonly abortControllers: Map<string, AbortController>;
  readonly persistRun: (job: PanelRunJob) => Promise<void>;
  readonly executionAdapter: BasicAgentExecutionAdapter;
  readonly failRun: (job: PanelRunJob, error: unknown) => Promise<void>;
  readonly onRuntimeReady: (runId: string, context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (runId: string, delta: ModelOutputDelta) => void;
  readonly onRunFinished: (job: PanelRunJob) => Promise<void> | void;
  readonly onGuidanceSubmitted?: (input: {
    readonly job: PanelRunJob;
    readonly guidance: string;
  }) => Promise<void> | void;
};

export type BasicAgentRunStartInput = {
  readonly runKind: PanelRunKind;
  readonly runMode?: PanelDesktopRunMode;
  readonly goal: string;
  readonly aiMode: UndergroundAiMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly routeDecision?: DesktopIntentDecision;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly startImmediately?: boolean;
};

export type BasicAgentRunExecutionInput = {
  readonly job: PanelRunJob;
  readonly conversationHistory?: readonly DesktopAgentConversationMessage[];
  readonly abortSignal: AbortSignal;
  readonly onRuntimeReady: (context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (delta: ModelOutputDelta) => void;
};

export type BasicAgentRuntimeReadyContext = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
};

export type BasicAgentRunExecutionResult = {
  readonly summary?: UndergroundDemoSummary;
  readonly observation?: PanelObservationReadModel;
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type BasicAgentPendingToolContinuation = {
  readonly confirmationId: string;
  resume(input: {
    readonly approvedConfirmationIds: readonly string[];
    readonly abortSignal: AbortSignal;
  }): Promise<BasicAgentRunExecutionResult>;
};

export class BasicAgentRunExecutor {
  private readonly pendingToolContinuations = new Map<string, BasicAgentPendingToolContinuation>();
  private readonly basicRuns = new BasicAgentRunStore();

  constructor(private readonly config: BasicAgentRunExecutorConfig) {}

  async start(input: BasicAgentRunStartInput): Promise<BasicAgentRun> {
    const modelConfig = await this.config.getModelProviderConfig();
    const informationAccess = await this.config.getInformationAccessConfig();
    const capabilitySnapshot = await this.config.getCapabilitySnapshot?.();
    const job = this.config.runJobs.create({
      runKind: input.runKind,
      runMode: input.runMode,
      goal: input.goal,
      aiMode: input.aiMode,
      conversationId: input.conversationId,
      assistantTurnId: input.assistantTurnId,
      runAfterRunId: input.runAfterRunId,
      routeDecision: input.routeDecision,
      taskSoilInput: input.taskSoilInput,
      config: modelConfig,
      informationAccess,
      capabilitySnapshot,
    });
    this.syncPanelRun(job);
    await this.config.persistRun(job);
    if (input.startImmediately !== false) {
      this.schedule(job.runId);
    }
    return this.requireBasicRun(job.runId);
  }

  get(runId: string): BasicAgentRun | undefined {
    return this.basicRuns.get(runId);
  }

  replayEvents(runId: string, afterSequence = 0): BasicAgentRunReplay | undefined {
    return this.basicRuns.get(runId) === undefined ? undefined : this.basicRuns.replayEvents(runId, afterSequence);
  }

  restore(input: {
    readonly run: BasicAgentRun;
    readonly events: readonly RunEvent[];
  }): BasicAgentRun {
    return this.basicRuns.restore(input);
  }

  syncPanelRun(job: PanelRunJob): BasicAgentRun {
    return this.basicRuns.upsert(projectPanelJobToBasicRun(job));
  }

  syncPanelStreamEvents(job: PanelRunJob, events: readonly PanelRunStreamEvent[] = job.streamEvents): readonly RunEvent[] {
    this.syncPanelRun(job);
    const projected = events.map(projectPanelStreamEventToRunEvent);
    for (const event of projected) {
      this.basicRuns.replaceEvent(event);
    }
    this.syncPanelRun(job);
    return projected;
  }

  schedule(runId: string): void {
    const activeRunJob = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.execute(runId)
          .catch(() => undefined)
          .finally(resolve);
      });
    });
    this.config.activeRunJobs.add(activeRunJob);
    void activeRunJob.then(() => {
      this.config.activeRunJobs.delete(activeRunJob);
    });
  }

  async cancel(runId: string): Promise<BasicAgentRun> {
    const job = this.requireJob(runId);
    this.deletePendingContinuationsForRun(runId);
    this.config.abortControllers.get(runId)?.abort();
    this.config.runJobs.cancel(runId, {
      config: job.config,
      informationAccess: job.informationAccess,
      reason: {
        code: "run_cancelled",
        message: "运行已取消。",
      },
    });
    const cancelled = this.requireJob(runId);
    this.syncPanelStreamEvents(cancelled);
    await this.config.onRunFinished(cancelled);
    await this.config.persistRun(cancelled);
    return this.requireBasicRun(runId);
  }

  async submitConfirmationDecision(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly decision: ConfirmationDecision["decision"];
    readonly guidance?: string;
  }): Promise<BasicAgentRun> {
    const job = this.requireJob(input.runId);
    const decidedAt = nowIso();
    this.config.runJobs.recordConfirmationDecision({
      confirmationId: input.confirmationId,
      runId: input.runId,
      decision: input.decision,
      decidedAt,
      guidance: input.guidance,
    });
    this.syncPanelStreamEvents(this.requireJob(input.runId));
    if (input.decision === "approve_once") {
      return this.resumeApprovedContinuation({
        runId: input.runId,
        confirmationId: input.confirmationId,
        job,
      });
    }
    this.deletePendingContinuation(input.runId, input.confirmationId);
    if (input.decision === "deny") {
      this.config.runJobs.block(input.runId, {
        config: job.config,
        informationAccess: job.informationAccess,
        reason: {
          code: "confirmation_denied",
          message: "用户已拒绝本次操作，运行已暂停。",
        },
      });
      this.syncPanelStreamEvents(this.requireJob(input.runId));
    }
    const updated = this.requireJob(input.runId);
    await this.config.onRunFinished(updated);
    await this.config.persistRun(updated);
    if (input.decision === "guidance" && input.guidance !== undefined) {
      await this.config.onGuidanceSubmitted?.({ job: updated, guidance: input.guidance });
    }
    return this.requireBasicRun(input.runId);
  }

  private async execute(runId: string): Promise<void> {
    const job = this.config.runJobs.get(runId);
    if (job === undefined) {
      return;
    }
    if (job.status !== "pending") {
      return;
    }
    const abort = new AbortController();
    this.config.abortControllers.set(runId, abort);
    this.config.runJobs.markRunning(runId);
    const running = this.config.runJobs.get(runId);
    if (running !== undefined) {
      this.syncPanelRun(running);
      await this.config.persistRun(running);
    }
    try {
      const result = await this.config.executionAdapter.execute({
        job,
        abortSignal: abort.signal,
        onRuntimeReady: (context: BasicAgentRuntimeReadyContext) => this.config.onRuntimeReady(runId, context),
        onModelOutputDelta: (delta: ModelOutputDelta) => this.config.onModelOutputDelta(runId, delta),
      });
      this.rememberPendingContinuation(runId, result.pendingApproval);
      if (abort.signal.aborted) {
        await this.cancel(runId);
        return;
      }
      this.config.runJobs.complete(runId, {
        config: job.config,
        informationAccess: job.informationAccess,
        summary: result.summary,
        observation: result.observation,
        agentRunTree: result.agentRunTree,
        canvas: result.canvas,
      });
      const completed = this.requireJob(runId);
      this.syncPanelStreamEvents(completed);
      await this.config.onRunFinished(completed);
      await this.config.persistRun(completed);
    } catch (error) {
      if (abort.signal.aborted) {
        await this.cancel(runId);
        return;
      }
      const latestJob = this.config.runJobs.get(runId) ?? job;
      await this.config.failRun(latestJob, error);
      const failed = this.config.runJobs.get(runId);
      if (failed !== undefined) {
        this.syncPanelStreamEvents(failed);
        await this.config.onRunFinished(failed);
        await this.config.persistRun(failed);
      }
    } finally {
      this.config.abortControllers.delete(runId);
    }
  }

  private requireJob(runId: string): PanelRunJob {
    const job = this.config.runJobs.get(runId);
    if (job === undefined) {
      throw new Error(`Basic Agent run not found: ${runId}`);
    }
    return job;
  }

  private requireBasicRun(runId: string): BasicAgentRun {
    const run = this.get(runId);
    if (run === undefined) {
      throw new Error(`Basic Agent run projection not found: ${runId}`);
    }
    return run;
  }

  private async resumeApprovedContinuation(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly job: PanelRunJob;
  }): Promise<BasicAgentRun> {
    const continuation = this.consumePendingContinuation(input.runId, input.confirmationId);
    if (continuation === undefined) {
      this.config.runJobs.block(input.runId, {
        config: input.job.config,
        informationAccess: input.job.informationAccess,
        reason: {
          code: "confirmation_continuation_lost",
          message: "运行已中断，需要重新发起或继续处理。",
        },
      });
      const blocked = this.requireJob(input.runId);
      this.syncPanelStreamEvents(blocked);
      await this.config.onRunFinished(blocked);
      await this.config.persistRun(blocked);
      return this.requireBasicRun(input.runId);
    }

    const abort = new AbortController();
    this.config.abortControllers.set(input.runId, abort);
    this.config.runJobs.markResuming(input.runId);
    this.config.runJobs.recordRunResumed(input.runId, {
      confirmationId: input.confirmationId,
      resumedAt: nowIso(),
    });
    this.syncPanelStreamEvents(this.requireJob(input.runId));
    try {
      const result = await continuation.resume({
        approvedConfirmationIds: [input.confirmationId],
        abortSignal: abort.signal,
      });
      this.rememberPendingContinuation(input.runId, result.pendingApproval);
      if (abort.signal.aborted) {
        await this.cancel(input.runId);
        return this.requireBasicRun(input.runId);
      }
      this.config.runJobs.complete(input.runId, {
        config: input.job.config,
        informationAccess: input.job.informationAccess,
        summary: result.summary,
        observation: result.observation,
        agentRunTree: result.agentRunTree,
        canvas: result.canvas,
      });
      const completed = this.requireJob(input.runId);
      this.syncPanelStreamEvents(completed);
      await this.config.onRunFinished(completed);
      await this.config.persistRun(completed);
      return this.requireBasicRun(input.runId);
    } catch (error) {
      if (abort.signal.aborted) {
        await this.cancel(input.runId);
        return this.requireBasicRun(input.runId);
      }
      const latestJob = this.config.runJobs.get(input.runId) ?? input.job;
      await this.config.failRun(latestJob, error);
      const failed = this.config.runJobs.get(input.runId);
      if (failed !== undefined) {
        this.syncPanelStreamEvents(failed);
        await this.config.onRunFinished(failed);
        await this.config.persistRun(failed);
      }
      return this.requireBasicRun(input.runId);
    } finally {
      this.config.abortControllers.delete(input.runId);
    }
  }

  private rememberPendingContinuation(
    runId: string,
    continuation: BasicAgentPendingToolContinuation | undefined
  ): void {
    if (continuation === undefined) {
      return;
    }
    this.pendingToolContinuations.set(continuationKey(runId, continuation.confirmationId), continuation);
  }

  private consumePendingContinuation(
    runId: string,
    confirmationId: string
  ): BasicAgentPendingToolContinuation | undefined {
    const key = continuationKey(runId, confirmationId);
    const continuation = this.pendingToolContinuations.get(key);
    this.pendingToolContinuations.delete(key);
    return continuation;
  }

  private deletePendingContinuation(runId: string, confirmationId: string): void {
    this.pendingToolContinuations.delete(continuationKey(runId, confirmationId));
  }

  private deletePendingContinuationsForRun(runId: string): void {
    for (const key of this.pendingToolContinuations.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.pendingToolContinuations.delete(key);
      }
    }
  }
}

function continuationKey(runId: string, confirmationId: string): string {
  return `${runId}:${confirmationId}`;
}
