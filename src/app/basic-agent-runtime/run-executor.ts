import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import { nowIso } from "../../kernel/id.js";
import { appRunEventsAfterSequence, type AppRunEventReplay } from "../run-runtime-core/event-stream.js";
import { projectRunJobToBasicRun, projectRunStreamEventToRunEvent } from "./run-projection.js";
import type {
  BasicAgentRunJob,
  BasicAgentRunStreamEvent,
} from "./run-job.js";
import { resolveBasicAgentRunMode } from "./run-job.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import type {
  BasicAgentPendingToolContinuation,
  BasicAgentRunExecutionResult,
  BasicAgentRunExecutorConfig,
  BasicAgentRunStartInput,
  BasicAgentRunResourceInspectionContext,
  BasicAgentRuntimeReadyContext,
} from "./contracts.js";
import {
  BasicAgentConfirmationDecisionError,
  BasicAgentPendingContinuationStore,
} from "./run-executor-continuations.js";
import { resolveCompatibleRunFacts } from "../run-runtime-core/run-facts-policy.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../run-read-model/restored-run-projection.js";

export type {
  BasicAgentExecutionAdapter,
  BasicAgentPendingToolContinuation,
  BasicAgentRunExecutionInput,
  BasicAgentRunExecutionResult,
  BasicAgentRunExecutorConfig,
  BasicAgentRunStartInput,
  BasicAgentRuntimeReadyContext,
} from "./contracts.js";

export { BasicAgentConfirmationDecisionError } from "./run-executor-continuations.js";

export type BasicAgentRunReplay = AppRunEventReplay<RunEvent>;

export class BasicAgentRunAdmissionClosedError extends Error {
  readonly code = "basic_agent_runtime_quiescing";

  constructor() {
    super("Basic Agent runtime is shutting down and cannot accept new work.");
    this.name = "BasicAgentRunAdmissionClosedError";
  }
}

export class BasicAgentRunExecutor {
  private readonly pendingContinuations = new BasicAgentPendingContinuationStore();
  private readonly terminalCommitsByRunId = new Map<string, Promise<void>>();
  private readonly scheduledRunIds = new Set<string>();
  private readonly scheduledConfirmationResumeRunIds = new Set<string>();
  private disposePromise: Promise<void> | undefined;
  private acceptingNewWork = true;

  constructor(private readonly config: BasicAgentRunExecutorConfig) {}

  async start(input: BasicAgentRunStartInput): Promise<BasicAgentRun> {
    this.assertAcceptingNewWork();
    const runMode = resolveBasicAgentRunMode(input.runKind, input.runMode);
    const startInput: BasicAgentRunStartInput = { ...input, runMode };
    const startImmediately = input.startImmediately !== false;
    if (input.deferInitialPersistence === true && startImmediately && input.deferSchedule !== true) {
      throw new Error("BasicAgentRunExecutor deferInitialPersistence requires deferred scheduling.");
    }
    const startFacts = await this.config.prepareRunStart(startInput);
    this.assertAcceptingNewWork();
    const toolConfirmationPolicy = startInput.toolConfirmationPolicy ?? startFacts.toolConfirmationPolicy;
    const job = this.config.runJobs.create({
      runKind: startInput.runKind,
      runMode,
      goal: startInput.goal,
      aiMode: startFacts.aiMode,
      conversationId: startInput.conversationId,
      assistantTurnId: startInput.assistantTurnId,
      runAfterRunId: startInput.runAfterRunId,
      taskSoilInput: startInput.taskSoilInput,
      reasoningEffort: startInput.reasoningEffort,
      toolConfirmationPolicy,
      agentDefinitionRef: startFacts.agentDefinitionRef,
      config: startFacts.config,
      informationAccess: startFacts.informationAccess,
      capabilitySnapshot: startFacts.capabilitySnapshot,
    });
    this.projectRunEvents(job);
    if (input.deferInitialPersistence !== true) {
      if (this.config.persistRunInBackground !== undefined) {
        this.config.persistRunInBackground(job);
      } else {
        await this.config.persistRun(job);
      }
    }
    if (startImmediately && input.deferSchedule !== true) {
      this.schedule(job.runId);
    }
    return this.requireBasicRun(job.runId);
  }

  get(runId: string): BasicAgentRun | undefined {
    const job = this.config.runJobs.get(runId);
    return job === undefined
      ? undefined
      : projectRunJobToBasicRun(job, this.runEventsForReplay(job));
  }

  replayEvents(runId: string, afterSequence = 0): BasicAgentRunReplay | undefined {
    const job = this.config.runJobs.get(runId);
    if (job === undefined) {
      return undefined;
    }
    const events = this.runEventsForReplay(job).map(projectRunStreamEventToRunEvent);
    return {
      cursor: {
        runId,
        lastSequence: events.at(-1)?.sequence ?? 0,
        eventCount: events.length,
      },
      events: appRunEventsAfterSequence(events, afterSequence),
    };
  }

  async waitForTerminalCommit(runId: string): Promise<void> {
    await this.terminalCommitsByRunId.get(runId);
  }

  dispose(): Promise<void> {
    this.quiesce();
    this.disposePromise ??= this.pendingContinuations.clearAll();
    return this.disposePromise;
  }

  quiesce(): void {
    if (!this.acceptingNewWork) {
      return;
    }
    this.acceptingNewWork = false;
    for (const controller of this.config.abortControllers.values()) {
      controller.abort();
    }
  }

  projectRunEvents(job: BasicAgentRunJob): void {
    this.config.projectRunEvents?.(job);
  }

  private runEventsForReplay(job: BasicAgentRunJob): readonly BasicAgentRunStreamEvent[] {
    return this.config.runEventsForReplay?.(job) ?? job.streamEvents;
  }

  schedule(runId: string): void {
    const job = this.config.runJobs.get(runId);
    if (job === undefined || job.status !== "pending") {
      return;
    }
    if (!this.acceptingNewWork) {
      const cancellation = this.cancel(runId).then(() => undefined).catch(() => undefined);
      this.trackActiveJob(cancellation);
      return;
    }
    if (this.scheduledRunIds.has(runId)) {
      return;
    }
    this.scheduledRunIds.add(runId);
    const abort = new AbortController();
    this.config.abortControllers.set(runId, abort);
    const activeRunJob = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.execute(runId, abort)
          .catch(() => undefined)
          .finally(() => {
            this.scheduledRunIds.delete(runId);
            this.deleteAbortController(runId, abort);
            resolve();
          });
      });
    });
    this.trackActiveJob(activeRunJob);
  }

  async cancel(runId: string): Promise<BasicAgentRun> {
    const job = this.requireJob(runId);
    if (isTerminalBasicAgentRunJob(job)) {
      // 并发竞态防御：job 已被其他路径收口为终态，
      // 不再 cancel/finalize，避免 double-finalize。
      return this.requireBasicRun(runId);
    }
    const pendingContinuationRelease = this.pendingContinuations.deleteForRun(runId);
    this.config.abortControllers.get(runId)?.abort();
    this.config.runJobs.cancel(runId, {
      config: job.config,
      informationAccess: job.informationAccess,
      capabilitySnapshot: job.capabilitySnapshot,
      capabilityResolution: job.capabilityResolution,
      ordinary: job.completed?.ordinary,
      reason: {
        code: "run_cancelled",
        message: "运行已取消。",
      },
    });
    const cancelled = this.requireJob(runId);
    this.projectRunEvents(cancelled);
    await pendingContinuationRelease;
    await this.finalizeTerminalJob(cancelled);
    return this.requireBasicRun(runId);
  }

  async submitConfirmationDecision(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly decision: ConfirmationDecision["decision"];
    readonly guidance?: string;
  }): Promise<BasicAgentRun> {
    this.assertAcceptingNewWork();
    const job = this.requireJob(input.runId);
    this.pendingContinuations.assertPendingConfirmation(job, input.confirmationId);
    const decidedAt = nowIso();
    this.config.runJobs.recordConfirmationDecision({
      confirmationId: input.confirmationId,
      runId: input.runId,
      decision: input.decision,
      decidedAt,
      guidance: input.guidance,
    });
    this.config.runJobs.markResuming(input.runId);
    try {
      this.projectRunEvents(this.requireJob(input.runId));
      await this.config.persistRun(this.requireJob(input.runId));
    } catch (error) {
      // Convergence guard: markResuming 已把 status 改成 running；
      // 若事件投影 / persistRun 抛错而 scheduleConfirmationResume 尚未注册，
      // run 会永远卡在 running。这里直接收口到终态，复用与异步恢复相同的失败路径。
      await this.finalizeConfirmationResumeFailure(input.runId, job, error);
      return this.requireBasicRun(input.runId);
    }
    if (input.decision === "approve_once") {
      const run = this.requireBasicRun(input.runId);
      this.scheduleConfirmationResume({
        runId: input.runId,
        confirmationId: input.confirmationId,
        decision: input.decision,
        job,
      });
      return run;
    }
    const run = this.requireBasicRun(input.runId);
    this.scheduleConfirmationResume({
      runId: input.runId,
      confirmationId: input.confirmationId,
      decision: input.decision,
      guidance: input.guidance,
      job,
    });
    return run;
  }

  private async execute(runId: string, abort: AbortController): Promise<void> {
    const job = this.config.runJobs.get(runId);
    if (job === undefined) {
      return;
    }
    if (job.status !== "pending") {
      return;
    }
    if (abort.signal.aborted) {
      await this.cancel(runId);
      return;
    }
    this.config.runJobs.markRunning(runId);
    const running = this.config.runJobs.get(runId);
    if (running !== undefined) {
      await this.config.persistRun(running);
    }
    try {
      const result = await this.config.executionAdapter.execute({
        job,
        abortSignal: abort.signal,
        onRuntimeReady: (context: BasicAgentRuntimeReadyContext) => this.config.onRuntimeReady(runId, context),
        onModelOutputDelta: (delta: ModelOutputDelta) => this.config.onModelOutputDelta(runId, delta),
      });
      this.pendingContinuations.remember(runId, result.pendingApproval);
      if (abort.signal.aborted) {
        await this.cancel(runId);
        return;
      }
      if (result.failed !== undefined) {
        await this.failFromExecutionResult(runId, job, result);
        return;
      }
      if (result.blocked !== undefined) {
        await this.blockFromExecutionResult(runId, job, result);
        return;
      }
      if (result.paused !== undefined) {
        // paused（out_of_fuel / context_overflow）统一转 blocked 终态，
        // reason.code 保留停止原因，使契约层显式识别"可继续"语义。
        await this.blockFromExecutionResult(runId, job, { ...result, blocked: result.paused });
        return;
      }
      if (result.pendingApproval !== undefined) {
        const facts = executionResultRunFacts(job, result);
        this.config.runJobs.awaitApproval(runId, {
          config: facts.config,
          informationAccess: facts.informationAccess,
          capabilitySnapshot: facts.capabilitySnapshot,
          summary: result.summary,
          observation: result.observation,
          agentRunTree: result.agentRunTree,
          canvas: result.canvas,
          capabilityResolution: facts.capabilityResolution,
          ordinary: result.ordinary,
        });
        const waiting = this.requireJob(runId);
        this.projectRunEvents(waiting);
        await this.config.persistRun(waiting);
        return;
      }
      if (result.completed !== true) {
        await this.failFromExecutionResult(runId, job, missingTerminalExecutionResult(result));
        return;
      }
      const facts = executionResultRunFacts(job, result);
      this.config.runJobs.complete(runId, {
        config: facts.config,
        informationAccess: facts.informationAccess,
        capabilitySnapshot: facts.capabilitySnapshot,
        summary: result.summary,
        observation: result.observation,
        agentRunTree: result.agentRunTree,
        canvas: result.canvas,
        capabilityResolution: facts.capabilityResolution,
        ordinary: result.ordinary,
      });
      const completed = this.requireJob(runId);
      this.projectRunEvents(completed);
      await this.finalizeTerminalJob(completed);
    } catch (error) {
      if (abort.signal.aborted) {
        await this.cancel(runId);
        return;
      }
      const latestJob = this.config.runJobs.get(runId) ?? job;
      await this.config.failRun(latestJob, error);
      const failed = this.config.runJobs.get(runId);
      if (failed !== undefined) {
        this.projectRunEvents(failed);
        await this.finalizeTerminalJob(failed);
      }
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

  private async cleanupRunResources(runId: string): Promise<void> {
    try {
      await this.config.cleanupRunResources?.(runId, {
        reason: "cancel",
        terminalStatus: "cancelled",
      });
    } catch {
      // Cleanup failures must not rewrite the already-cancelled run outcome.
    }
  }

  private async inspectRunResources(
    runId: string,
    terminalStatus: BasicAgentRunResourceInspectionContext["terminalStatus"]
  ): Promise<void> {
    try {
      await this.config.inspectRunResources?.(runId, { terminalStatus });
    } catch {
      // Runtime guard inspection is diagnostic and must not rewrite terminal outcomes.
    }
  }

  private async finalizeTerminalJob(job: BasicAgentRunJob): Promise<void> {
    const existing = this.terminalCommitsByRunId.get(job.runId);
    if (existing !== undefined) {
      await existing;
      return;
    }
    const commit = this.commitTerminalJob(job);
    this.terminalCommitsByRunId.set(job.runId, commit);
    try {
      await commit;
    } finally {
      if (this.terminalCommitsByRunId.get(job.runId) === commit) {
        this.terminalCommitsByRunId.delete(job.runId);
      }
    }
  }

  private async commitTerminalJob(job: BasicAgentRunJob): Promise<void> {
    // Covers terminal paths that never resume a remembered continuation, such
    // as persistence failure after markResuming. Cleanup failures are isolated
    // by the continuation store and cannot rewrite the terminal outcome.
    await this.pendingContinuations.deleteForRun(job.runId);
    if (job.status === "cancelled") {
      await this.cleanupRunResources(job.runId);
    }
    const terminalStatus = inspectableTerminalStatus(job.status);
    if (terminalStatus !== undefined) {
      await this.inspectRunResources(job.runId, terminalStatus);
    }
    await this.config.onRunFinished(job);
    await this.config.persistRun(job);
  }

  private scheduleConfirmationResume(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly decision: ConfirmationDecision["decision"];
    readonly guidance?: string;
    readonly job: BasicAgentRunJob;
  }): void {
    if (!this.acceptingNewWork) {
      const cancellation = this.cancel(input.runId).then(() => undefined).catch(() => undefined);
      this.trackActiveJob(cancellation);
      return;
    }
    if (this.scheduledConfirmationResumeRunIds.has(input.runId)) {
      return;
    }
    this.scheduledConfirmationResumeRunIds.add(input.runId);
    const abort = new AbortController();
    this.config.abortControllers.set(input.runId, abort);
    const activeRunJob = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.resumeConfirmationContinuation(input, abort)
          .catch(async (error: unknown) => {
            console.error(`[run-executor] async confirmation resume failed for ${input.runId}:`, error);
            // Convergence guard: resumeConfirmationContinuation self-finalizes inside its
            // own try/catch, but a throw in the pre-resume setup (consume / markResuming /
            // recordRunResumed / event projection) or a re-throw from the inner catch would
            // otherwise escape with only a log line, leaving the run stuck in a
            // non-terminal status (running / resuming / approval_needed). Fail any job
            // that is still non-terminal so every scheduled resume reaches a terminal state.
            await this.finalizeConfirmationResumeFailure(input.runId, input.job, error);
          })
          .finally(() => {
            this.scheduledConfirmationResumeRunIds.delete(input.runId);
            this.deleteAbortController(input.runId, abort);
            resolve();
          });
      });
    });
    this.trackActiveJob(activeRunJob);
  }

  private trackActiveJob(job: Promise<void>): void {
    this.config.activeRunJobs.add(job);
    void job.finally(() => {
      this.config.activeRunJobs.delete(job);
    });
  }

  private deleteAbortController(runId: string, abort: AbortController): void {
    if (this.config.abortControllers.get(runId) === abort) {
      this.config.abortControllers.delete(runId);
    }
  }

  private assertAcceptingNewWork(): void {
    if (!this.acceptingNewWork) {
      throw new BasicAgentRunAdmissionClosedError();
    }
  }

  private async finalizeConfirmationResumeFailure(
    runId: string,
    fallbackJob: BasicAgentRunJob,
    error: unknown
  ): Promise<void> {
    const latestJob = this.config.runJobs.get(runId) ?? fallbackJob;
    if (inspectableTerminalStatus(latestJob.status) !== undefined) {
      // Already terminal (e.g. the inner catch finalized before re-throwing, or the
      // continuation-lost branch already moved the job to blocked). Do not rewrite the
      // outcome; only ensure the terminal side effects are persisted.
      return;
    }
    await this.config.failRun(latestJob, error);
    const failed = this.config.runJobs.get(runId);
    if (failed !== undefined) {
      this.projectRunEvents(failed);
      await this.finalizeTerminalJob(failed);
    }
  }

  private async resumeConfirmationContinuation(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly decision: ConfirmationDecision["decision"];
    readonly guidance?: string;
    readonly job: BasicAgentRunJob;
  }, abort: AbortController): Promise<BasicAgentRun> {
    if (abort.signal.aborted) {
      await this.cancel(input.runId);
      return this.requireBasicRun(input.runId);
    }
    const continuation = this.pendingContinuations.consume(input.runId, input.confirmationId);
    if (continuation === undefined) {
      // 并发竞态防御：若 job 已被 cancel 等路径收口为终态，
      // continuation 已被清掉但不应再 block/finalize，避免 double-finalize。
      const currentJob = this.config.runJobs.get(input.runId);
      if (currentJob !== undefined && isTerminalBasicAgentRunJob(currentJob)) {
        return this.requireBasicRun(input.runId);
      }
      const blockedByMissingApproval = input.decision === "approve_once";
      this.config.runJobs.block(input.runId, {
        config: input.job.config,
        informationAccess: input.job.informationAccess,
        capabilitySnapshot: input.job.capabilitySnapshot,
        capabilityResolution: input.job.capabilityResolution,
        ordinary: input.job.completed?.ordinary,
        reason: {
          code: blockedByMissingApproval ? "confirmation_continuation_lost" : "confirmation_decision_continuation_lost",
          message: blockedByMissingApproval
            ? ORDINARY_RUN_BLOCKED_FALLBACK
            : "你的选择已记录。你可以继续发送消息让我按该决定处理。",
        },
      });
      const blocked = this.requireJob(input.runId);
      // block() 对终态 job 短路，blocked.status 可能仍是其他终态（如被 cancel 抢占成 cancelled）。
      // 只有真的变成 blocked 才 finalize，避免对已被其他路径收口的 job 二次 finalize。
      if (blocked.status === "blocked") {
        this.projectRunEvents(blocked);
        await this.finalizeTerminalJob(blocked);
      }
      return this.requireBasicRun(input.runId);
    }

    this.config.runJobs.markResuming(input.runId);
    this.config.runJobs.recordRunResumed(input.runId, {
      confirmationId: input.confirmationId,
      resumedAt: nowIso(),
    });
    this.projectRunEvents(this.requireJob(input.runId));
    try {
      const result = input.decision === "approve_once"
        ? await continuation.resume({
            approvedConfirmationIds: [input.confirmationId],
            abortSignal: abort.signal,
          })
        : await continuation.resumeWithDecision({
            decision: input.decision,
            guidance: input.guidance,
            abortSignal: abort.signal,
          });
      this.pendingContinuations.remember(input.runId, result.pendingApproval);
      if (abort.signal.aborted) {
        await this.cancel(input.runId);
        return this.requireBasicRun(input.runId);
      }
      if (result.failed !== undefined) {
        await this.failFromExecutionResult(input.runId, input.job, result);
        return this.requireBasicRun(input.runId);
      }
      if (result.blocked !== undefined) {
        await this.blockFromExecutionResult(input.runId, input.job, result);
        return this.requireBasicRun(input.runId);
      }
      if (result.paused !== undefined) {
        // paused（out_of_fuel / context_overflow）统一转 blocked 终态，
        // reason.code 保留停止原因，使契约层显式识别"可继续"语义。
        await this.blockFromExecutionResult(input.runId, input.job, { ...result, blocked: result.paused });
        return this.requireBasicRun(input.runId);
      }
      if (result.pendingApproval !== undefined) {
        const facts = executionResultRunFacts(input.job, result);
        this.config.runJobs.awaitApproval(input.runId, {
          config: facts.config,
          informationAccess: facts.informationAccess,
          capabilitySnapshot: facts.capabilitySnapshot,
          summary: result.summary,
          observation: result.observation,
          agentRunTree: result.agentRunTree,
          canvas: result.canvas,
          capabilityResolution: facts.capabilityResolution,
          ordinary: result.ordinary,
        });
        const waiting = this.requireJob(input.runId);
        this.projectRunEvents(waiting);
        await this.config.persistRun(waiting);
        return this.requireBasicRun(input.runId);
      }
      if (result.completed !== true) {
        await this.failFromExecutionResult(input.runId, input.job, missingTerminalExecutionResult(result));
        return this.requireBasicRun(input.runId);
      }
      const facts = executionResultRunFacts(input.job, result);
      this.config.runJobs.complete(input.runId, {
        config: facts.config,
        informationAccess: facts.informationAccess,
        capabilitySnapshot: facts.capabilitySnapshot,
        summary: result.summary,
        observation: result.observation,
        agentRunTree: result.agentRunTree,
        canvas: result.canvas,
        capabilityResolution: facts.capabilityResolution,
        ordinary: result.ordinary,
      });
      const completed = this.requireJob(input.runId);
      this.projectRunEvents(completed);
      await this.finalizeTerminalJob(completed);
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
        this.projectRunEvents(failed);
        await this.finalizeTerminalJob(failed);
      }
      return this.requireBasicRun(input.runId);
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
    const facts = executionResultRunFacts(job, result);
    this.config.runJobs.block(runId, {
      config: facts.config,
      informationAccess: facts.informationAccess,
      capabilitySnapshot: facts.capabilitySnapshot,
      reason: result.blocked,
      summary: result.summary,
      observation: result.observation,
      agentRunTree: result.agentRunTree,
      canvas: result.canvas,
      capabilityResolution: facts.capabilityResolution,
      ordinary: result.ordinary,
    });
    const blocked = this.requireJob(runId);
    this.projectRunEvents(blocked);
    await this.finalizeTerminalJob(blocked);
  }

  private async failFromExecutionResult(
    runId: string,
    job: BasicAgentRunJob,
    result: BasicAgentRunExecutionResult
  ): Promise<void> {
    if (result.failed === undefined) {
      return;
    }
    const facts = executionResultRunFacts(job, result);
    this.config.runJobs.fail(runId, {
      config: facts.config,
      informationAccess: facts.informationAccess,
      capabilitySnapshot: facts.capabilitySnapshot,
      capabilityResolution: facts.capabilityResolution,
      canvas: result.canvas,
      error: result.failed,
      summary: result.summary,
      ordinary: result.ordinary,
    });
    const failed = this.requireJob(runId);
    this.projectRunEvents(failed);
    await this.finalizeTerminalJob(failed);
  }

}

type BasicAgentExecutionRunFacts = {
  readonly config: BasicAgentRunJob["config"];
  readonly informationAccess: BasicAgentRunJob["informationAccess"];
  readonly capabilitySnapshot: BasicAgentRunJob["capabilitySnapshot"];
  readonly capabilityResolution: BasicAgentRunJob["capabilityResolution"];
};

function executionResultRunFacts(
  job: BasicAgentRunJob,
  result: BasicAgentRunExecutionResult
): BasicAgentExecutionRunFacts {
  const facts = resolveCompatibleRunFacts(job, result);
  return {
    config: facts.config,
    informationAccess: facts.informationAccess,
    capabilitySnapshot: facts.capabilitySnapshot,
    capabilityResolution: facts.capabilityResolution,
  };
}

function missingTerminalExecutionResult(result: BasicAgentRunExecutionResult): BasicAgentRunExecutionResult {
  return {
    ...result,
    failed: {
      code: "execution_result_missing_terminal_state",
      message: "执行适配器没有返回明确的完成、失败、阻塞或等待用户判断状态，运行不能按完成处理。",
    },
  };
}

function isTerminalBasicAgentRunJob(job: BasicAgentRunJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "blocked";
}

function inspectableTerminalStatus(
  status: BasicAgentRunJob["status"]
): BasicAgentRunResourceInspectionContext["terminalStatus"] | undefined {
  if (status === "completed" || status === "failed" || status === "blocked" || status === "cancelled") {
    return status;
  }
  return undefined;
}
