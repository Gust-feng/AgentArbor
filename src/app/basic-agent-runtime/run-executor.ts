import type { BasicAgentRun, ConfirmationDecision, RunEvent } from "../../domain/basic-agent/index.js";
import { nowIso } from "../../kernel/id.js";
import type { BasicAgentRunReplay } from "./event-hub.js";
import { BasicAgentRunStore } from "./run-store.js";
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
  BasicAgentRuntimeReadyContext,
} from "./contracts.js";
import {
  BasicAgentConfirmationDecisionError,
  BasicAgentPendingContinuationStore,
} from "./run-executor-continuations.js";
import { resolveCompatibleRunFacts } from "../run-facts-policy.js";

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

export class BasicAgentRunExecutor {
  private readonly pendingContinuations = new BasicAgentPendingContinuationStore();
  private readonly basicRuns = new BasicAgentRunStore();

  constructor(private readonly config: BasicAgentRunExecutorConfig) {}

  async start(input: BasicAgentRunStartInput): Promise<BasicAgentRun> {
    const runMode = resolveBasicAgentRunMode(input.runKind, input.runMode);
    const startInput: BasicAgentRunStartInput = { ...input, runMode };
    const startImmediately = input.startImmediately !== false;
    const startFacts = await this.config.prepareRunStart(startInput);
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
      agentDefinitionRef: startFacts.agentDefinitionRef,
      config: startFacts.config,
      informationAccess: startFacts.informationAccess,
      capabilitySnapshot: startFacts.capabilitySnapshot,
    });
    this.syncRun(job);
    if (this.config.persistRunInBackground !== undefined) {
      this.config.persistRunInBackground(job);
    } else {
      await this.config.persistRun(job);
    }
    if (startImmediately && input.deferSchedule !== true) {
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
    this.pendingContinuations.deleteForRun(runId);
    this.config.abortControllers.get(runId)?.abort();
    this.config.runJobs.cancel(runId, {
      config: job.config,
      informationAccess: job.informationAccess,
      capabilitySnapshot: job.capabilitySnapshot,
      capabilityResolution: job.capabilityResolution,
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
    this.syncRunEvents(this.requireJob(input.runId));
    await this.config.persistRun(this.requireJob(input.runId));
    if (input.decision === "approve_once") {
      const run = this.requireBasicRun(input.runId);
      setImmediate(() => {
        this.resumeConfirmationContinuation({
          runId: input.runId,
          confirmationId: input.confirmationId,
          decision: input.decision,
          job,
        }).catch((error: unknown) => {
          console.error(`[run-executor] async resume failed for ${input.runId}:`, error);
        });
      });
      return run;
    }
    const run = this.requireBasicRun(input.runId);
    setImmediate(() => {
      this.resumeConfirmationContinuation({
        runId: input.runId,
        confirmationId: input.confirmationId,
        decision: input.decision,
        guidance: input.guidance,
        job,
      }).catch((error: unknown) => {
        console.error(`[run-executor] async confirmation decision resume failed for ${input.runId}:`, error);
      });
    });
    return run;
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
        });
        const waiting = this.requireJob(runId);
        this.syncRunEvents(waiting);
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

  private async resumeConfirmationContinuation(input: {
    readonly runId: string;
    readonly confirmationId: string;
    readonly decision: ConfirmationDecision["decision"];
    readonly guidance?: string;
    readonly job: BasicAgentRunJob;
  }): Promise<BasicAgentRun> {
    const continuation = this.pendingContinuations.consume(input.runId, input.confirmationId);
    if (continuation === undefined) {
      const blockedByMissingApproval = input.decision === "approve_once";
      this.config.runJobs.block(input.runId, {
        config: input.job.config,
        informationAccess: input.job.informationAccess,
        capabilitySnapshot: input.job.capabilitySnapshot,
        capabilityResolution: input.job.capabilityResolution,
        reason: {
          code: blockedByMissingApproval ? "confirmation_continuation_lost" : "confirmation_decision_continuation_lost",
          message: blockedByMissingApproval
            ? "无法继续原操作。请重新发起或继续处理。"
            : "你的选择已记录。你可以继续发送消息让我按该决定处理。",
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
        });
        const waiting = this.requireJob(input.runId);
        this.syncRunEvents(waiting);
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
    });
    const blocked = this.requireJob(runId);
    this.syncRunEvents(blocked);
    await this.config.onRunFinished(blocked);
    await this.config.persistRun(blocked);
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
    });
    const failed = this.requireJob(runId);
    this.syncRunEvents(failed);
    await this.config.onRunFinished(failed);
    await this.config.persistRun(failed);
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
