import type { BasicAgentCapabilitySnapshot, SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import { nowIso } from "../../kernel/id.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { DesktopIntentDecision } from "../desktop-intent-router.js";
import type { DesktopAgentConversationMessage } from "../desktop-agent-session.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import type { UndergroundDemoSummary } from "../underground-demo-summary.js";
import type { AgentRunTree } from "../../domain/underground/index.js";
import type { BasicAgentRunReplay } from "./event-hub.js";
import type { BasicAgentExecutionAdapter } from "./execution-adapter.js";
import { BasicAgentRunStore } from "./run-store.js";
import { projectRunJobToBasicRun, projectRunStreamEventToRunEvent } from "./run-projection.js";
import type {
  BasicAgentCanvasProjection,
  BasicAgentRunJob,
  BasicAgentRunJobStore,
  BasicAgentRunKind,
  BasicAgentRunMode,
  BasicAgentRunStreamEvent,
} from "./run-job.js";

export type BasicAgentRunExecutorConfig = {
  readonly getModelProviderConfig: () => Promise<SanitizedModelProviderConfig>;
  readonly getInformationAccessConfig: () => Promise<SanitizedInformationAccessConfig>;
  readonly getCapabilitySnapshot?: () => Promise<BasicAgentCapabilitySnapshot>;
  readonly runJobs: BasicAgentRunJobStore;
  readonly activeRunJobs: Set<Promise<void>>;
  readonly abortControllers: Map<string, AbortController>;
  readonly persistRun: (job: BasicAgentRunJob) => Promise<void>;
  readonly executionAdapter: BasicAgentExecutionAdapter;
  readonly failRun: (job: BasicAgentRunJob, error: unknown) => Promise<void>;
  readonly onRuntimeReady: (runId: string, context: BasicAgentRuntimeReadyContext) => void;
  readonly onModelOutputDelta: (runId: string, delta: ModelOutputDelta) => void;
  readonly onRunFinished: (job: BasicAgentRunJob) => Promise<void> | void;
  readonly onGuidanceSubmitted?: (input: {
    readonly job: BasicAgentRunJob;
    readonly guidance: string;
  }) => Promise<void> | void;
};

export type BasicAgentRunStartInput = {
  readonly runKind: BasicAgentRunKind;
  readonly runMode?: BasicAgentRunMode;
  readonly goal: string;
  readonly aiMode: ModelRuntimeMode;
  readonly conversationId?: string;
  readonly assistantTurnId?: string;
  readonly runAfterRunId?: string;
  readonly routeDecision?: DesktopIntentDecision;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly startImmediately?: boolean;
};

export type BasicAgentRunExecutionInput = {
  readonly job: BasicAgentRunJob;
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
  readonly observation?: unknown;
  readonly agentRunTree?: AgentRunTree;
  readonly canvas?: BasicAgentCanvasProjection;
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
  };
  readonly pendingApproval?: BasicAgentPendingToolContinuation;
};

export type BasicAgentPendingToolContinuation = {
  readonly confirmationId: string;
  resume(input: {
    readonly approvedConfirmationIds: readonly string[];
    readonly abortSignal: AbortSignal;
  }): Promise<BasicAgentRunExecutionResult>;
};

export class BasicAgentConfirmationDecisionError extends Error {
  constructor(
    readonly code: "invalid_confirmation_state" | "confirmation_not_pending",
    message: string
  ) {
    super(message);
    this.name = "BasicAgentConfirmationDecisionError";
  }
}

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
    this.syncRun(job);
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

  syncRun(job: BasicAgentRunJob): BasicAgentRun {
    return this.basicRuns.upsert(projectRunJobToBasicRun(job));
  }

  syncRunEvents(job: BasicAgentRunJob, events: readonly BasicAgentRunStreamEvent[] = job.streamEvents): readonly RunEvent[] {
    this.syncRun(job);
    const projected = events.map(projectRunStreamEventToRunEvent);
    for (const event of projected) {
      this.basicRuns.replaceEvent(event);
    }
    this.syncRun(job);
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
    this.syncRunEvents(cancelled);
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
    this.assertPendingConfirmation(job, input.confirmationId);
    const decidedAt = nowIso();
    this.config.runJobs.recordConfirmationDecision({
      confirmationId: input.confirmationId,
      runId: input.runId,
      decision: input.decision,
      decidedAt,
      guidance: input.guidance,
    });
    this.syncRunEvents(this.requireJob(input.runId));
    if (input.decision === "approve_once") {
      return this.resumeApprovedContinuation({
        runId: input.runId,
        confirmationId: input.confirmationId,
        job,
      });
    }
    this.deletePendingContinuation(input.runId, input.confirmationId);
    if (input.decision === "guidance") {
      this.config.runJobs.markNeedsInput(input.runId);
      this.syncRunEvents(this.requireJob(input.runId));
    }
    if (input.decision === "deny") {
      this.config.runJobs.block(input.runId, {
        config: job.config,
        informationAccess: job.informationAccess,
        reason: {
          code: "confirmation_denied",
          message: "用户已拒绝本次操作，运行已暂停。",
        },
      });
      this.syncRunEvents(this.requireJob(input.runId));
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
      this.syncRun(running);
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
      if (result.blocked !== undefined) {
        await this.blockFromExecutionResult(runId, job, result);
        return;
      }
      if (result.pendingApproval !== undefined) {
        this.config.runJobs.awaitApproval(runId, {
          config: job.config,
          informationAccess: job.informationAccess,
          summary: result.summary,
          observation: result.observation,
          agentRunTree: result.agentRunTree,
          canvas: result.canvas,
        });
        const waiting = this.requireJob(runId);
        this.syncRunEvents(waiting);
        await this.config.persistRun(waiting);
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
      this.syncRunEvents(completed);
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
        this.syncRunEvents(failed);
        await this.config.onRunFinished(failed);
        await this.config.persistRun(failed);
      }
    } finally {
      this.config.abortControllers.delete(runId);
    }
  }

  private requireJob(runId: string): BasicAgentRunJob {
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
    readonly job: BasicAgentRunJob;
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
      this.syncRunEvents(blocked);
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
    this.syncRunEvents(this.requireJob(input.runId));
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
      if (result.blocked !== undefined) {
        await this.blockFromExecutionResult(input.runId, input.job, result);
        return this.requireBasicRun(input.runId);
      }
      if (result.pendingApproval !== undefined) {
        this.config.runJobs.awaitApproval(input.runId, {
          config: input.job.config,
          informationAccess: input.job.informationAccess,
          summary: result.summary,
          observation: result.observation,
          agentRunTree: result.agentRunTree,
          canvas: result.canvas,
        });
        const waiting = this.requireJob(input.runId);
        this.syncRunEvents(waiting);
        await this.config.persistRun(waiting);
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
      this.syncRunEvents(completed);
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
        this.syncRunEvents(failed);
        await this.config.onRunFinished(failed);
        await this.config.persistRun(failed);
      }
      return this.requireBasicRun(input.runId);
    } finally {
      this.config.abortControllers.delete(input.runId);
    }
  }

  private async blockFromExecutionResult(
    runId: string,
    job: BasicAgentRunJob,
    result: BasicAgentRunExecutionResult
  ): Promise<void> {
    if (result.blocked === undefined) {
      return;
    }
    this.config.runJobs.block(runId, {
      config: job.config,
      informationAccess: job.informationAccess,
      reason: result.blocked,
      summary: result.summary,
      observation: result.observation,
      agentRunTree: result.agentRunTree,
      canvas: result.canvas,
    });
    const blocked = this.requireJob(runId);
    this.syncRunEvents(blocked);
    await this.config.onRunFinished(blocked);
    await this.config.persistRun(blocked);
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

  private assertPendingConfirmation(job: BasicAgentRunJob, confirmationId: string): void {
    if (job.status !== "approval_needed") {
      throw new BasicAgentConfirmationDecisionError(
        "invalid_confirmation_state",
        "这次运行当前没有等待确认的操作。"
      );
    }
    if (job.confirmationDecisions.some((decision) => decision.confirmationId === confirmationId)) {
      throw new BasicAgentConfirmationDecisionError(
        "confirmation_not_pending",
        "这个确认请求已经处理过。"
      );
    }
    if (pendingConfirmationIdFromCanvas(job.completed?.canvas) === confirmationId) {
      return;
    }
    if (this.pendingToolContinuations.has(continuationKey(job.runId, confirmationId))) {
      return;
    }
    throw new BasicAgentConfirmationDecisionError(
      "confirmation_not_pending",
      "没有找到仍可处理的确认请求。"
    );
  }
}

function continuationKey(runId: string, confirmationId: string): string {
  return `${runId}:${confirmationId}`;
}

function pendingConfirmationIdFromCanvas(canvas: BasicAgentCanvasProjection | undefined): string | undefined {
  const agent = asRecord(canvas?.agent);
  const pending = asRecord(agent.pendingConfirmation);
  const confirmationId = pending.confirmationId;
  return typeof confirmationId === "string" && confirmationId.trim().length > 0
    ? confirmationId
    : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}
