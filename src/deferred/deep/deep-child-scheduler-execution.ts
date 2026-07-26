/**
 * Executes one scheduled deep child and maps its runtime result to the task board.
 *
 * DeepChildScheduler retains concurrency slots, parent instruction storage, and
 * callback dispatch. This module owns the child execution closure: initial
 * exploration, FIFO parent follow-ups, terminal task transition, and isolated
 * failure projection.
 */
import type { ChildAgentRun, ChildAgentRunParentReview } from "../../domain/underground/agent-fabric.js";
import { nowIso } from "../../kernel/id.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepChildTask,
} from "./contracts.js";
import {
  buildFailedChildExploration,
  type ExploreDeepChildResult,
} from "./child-delegation.js";
import {
  cloneDeepChildParentReview,
} from "./deep-child-parent-instruction-history.js";
import { DeepChildExecutionAdmissionError } from "./deep-child-run-contracts.js";
import type {
  ContinueDeepChildFactory,
  DeepChildExecutedQueuedInstruction,
  DeepChildInstructionRecord,
  DeepChildTerminalMaterial,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import { errorMessage } from "../../kernel/values/index.js";

/** Raw parent instruction retained by the scheduler until it is consumed or cancelled. */
export type DeepChildScheduledInstruction = {
  readonly instructionId: string;
  readonly messageRef: string;
  readonly childRunId: string;
  readonly instruction: string;
  readonly source: "manager" | "control_api";
  readonly review?: ChildAgentRunParentReview;
  readonly queuedAt: string;
};

export function mapDeepChildExecutionResult(input: {
  readonly board: DeepTaskBoard;
  readonly taskId: string;
  readonly result: ExploreDeepChildResult;
}): DeepChildTask {
  if (input.result.completedRun.status === "blocked" || input.result.summary.status === "blocked") {
    return input.board.markBlocked(
      input.taskId,
      input.result.summary,
      input.result.completedRun.pendingApproval,
    );
  }
  if (input.result.completedRun.status === "failed" || input.result.summary.status === "failed") {
    return input.board.markFailed(
      input.taskId,
      input.result.completedRun.failureReason ?? input.result.summary.uncertainty ?? "child Agent run failed",
      input.result.summary,
    );
  }
  if (input.result.completedRun.status === "interrupted" || input.result.summary.status === "interrupted") {
    return input.board.markInterrupted(
      input.taskId,
      input.result.completedRun.failureReason ?? input.result.summary.uncertainty ?? "child Agent run interrupted",
      input.result.summary,
    );
  }
  return input.board.markCompleted(input.taskId, input.result.summary);
}

export async function executeDeepChildScheduledRun(input: {
  readonly board: DeepTaskBoard;
  readonly taskId: string;
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly childRunById: Map<string, ChildAgentRun>;
  readonly exploreFactory: ExploreDeepChildFactory;
  readonly continueFactory?: ContinueDeepChildFactory;
  readonly applyParentInstructionHistory: (childRun: ChildAgentRun) => ChildAgentRun;
  readonly takeNextInstruction: (childRunId: string) => DeepChildScheduledInstruction | undefined;
  readonly markParentInstructionExecuted: (
    childRunId: string,
    instructionId: string,
    executedAt: string,
  ) => void;
  readonly markParentInstructionAdmissionRejected: (
    childRunId: string,
    instructionId: string,
    cancelledAt: string,
  ) => void;
  readonly markParentInstructionCancelled: (
    childRunId: string,
    instructionId: string,
    cancelledAt: string,
  ) => void;
  readonly recordInstruction: (instruction: DeepChildInstructionRecord) => void;
}): Promise<DeepChildTerminalMaterial> {
  let summary: DeepChildSummary;
  let completedRun: ChildAgentRun;
  let terminalTask: DeepChildTask;
  let pendingContinuation: ExploreDeepChildResult["pendingContinuation"];
  const executedQueuedInstructions: DeepChildExecutedQueuedInstruction[] = [];
  let latestKnownResult: ExploreDeepChildResult | undefined;
  try {
    const result = await executeQueuedFollowUps({
      childRunId: input.childRun.childRunId,
      initial: await input.exploreFactory(input.childRun, input.childSpec),
      fallbackChildSpec: input.childSpec,
      continueFactory: input.continueFactory,
      applyParentInstructionHistory: input.applyParentInstructionHistory,
      takeNextInstruction: input.takeNextInstruction,
      markParentInstructionExecuted: input.markParentInstructionExecuted,
      markParentInstructionAdmissionRejected: input.markParentInstructionAdmissionRejected,
      markParentInstructionCancelled: input.markParentInstructionCancelled,
      recordInstruction: input.recordInstruction,
      executedQueuedInstructions,
      rememberKnownResult: (result) => {
        latestKnownResult = result;
        input.childRunById.set(input.childRun.childRunId, result.completedRun);
      },
    });
    pendingContinuation = result.pendingContinuation;
    input.childRunById.set(input.childRun.childRunId, result.completedRun);
    terminalTask = mapDeepChildExecutionResult({
      board: input.board,
      taskId: input.taskId,
      result,
    });
    summary = result.summary;
    completedRun = result.completedRun;
  } catch (error) {
    // A single child failure is an observable failed material, never a scheduler failure.
    const reason = errorMessage(error);
    const failedSeed = input.applyParentInstructionHistory(
      input.childRunById.get(input.childRun.childRunId) ?? input.childRun,
    );
    const failed = buildFailedChildExploration({
      childRun: failedSeed,
      childSpec: input.childSpec,
      reason,
      failedAt: nowIso(),
    });
    summary = latestKnownResult === undefined
      ? failed.summary
      : preserveKnownChildMaterialAfterFollowUpFailure(failed.summary, latestKnownResult.summary);
    completedRun = input.applyParentInstructionHistory(failed.completedRun);
    pendingContinuation = latestKnownResult?.pendingContinuation;
    terminalTask = input.board.markFailed(input.taskId, reason, summary);
    input.childRunById.set(input.childRun.childRunId, completedRun);
  }
  return {
    task: terminalTask,
    summary,
    completedRun,
    pendingContinuation,
    executedQueuedInstructions,
  };
}

async function executeQueuedFollowUps(input: {
  readonly childRunId: string;
  readonly initial: ExploreDeepChildResult;
  readonly fallbackChildSpec: DeepChildSpec;
  readonly continueFactory?: ContinueDeepChildFactory;
  readonly applyParentInstructionHistory: (childRun: ChildAgentRun) => ChildAgentRun;
  readonly takeNextInstruction: (childRunId: string) => DeepChildScheduledInstruction | undefined;
  readonly markParentInstructionExecuted: (
    childRunId: string,
    instructionId: string,
    executedAt: string,
  ) => void;
  readonly markParentInstructionAdmissionRejected: (
    childRunId: string,
    instructionId: string,
    cancelledAt: string,
  ) => void;
  readonly markParentInstructionCancelled: (
    childRunId: string,
    instructionId: string,
    cancelledAt: string,
  ) => void;
  readonly recordInstruction: (instruction: DeepChildInstructionRecord) => void;
  /** Shared accumulator so earlier executed facts survive a later FIFO failure. */
  readonly executedQueuedInstructions: DeepChildExecutedQueuedInstruction[];
  readonly rememberKnownResult: (result: ExploreDeepChildResult) => void;
}): Promise<ExploreDeepChildResult> {
  let current: ExploreDeepChildResult = {
    ...input.initial,
    completedRun: input.applyParentInstructionHistory(input.initial.completedRun),
  };
  input.rememberKnownResult(current);
  if (current.pendingContinuation !== undefined) {
    cancelRemainingQueuedInstructions(input, input.childRunId);
    const completedRunAfterCancellation = input.applyParentInstructionHistory(current.completedRun);
    current = {
      ...current,
      completedRun: completedRunAfterCancellation,
      pendingContinuation: {
        ...current.pendingContinuation,
        childRun: completedRunAfterCancellation,
      },
    };
    input.rememberKnownResult(current);
    return current;
  }
  for (;;) {
    const queued = input.takeNextInstruction(input.childRunId);
    if (queued === undefined || input.continueFactory === undefined) {
      return current;
    }
    let instructionRecord: DeepChildInstructionRecord = {
      instructionId: queued.instructionId,
      messageRef: queued.messageRef,
      childRunId: queued.childRunId,
      source: queued.source,
      status: "queued",
      instruction: queued.instruction,
      review: cloneDeepChildParentReview(queued.review),
      requestedAt: queued.queuedAt,
      queuedAt: queued.queuedAt,
    };
    let executedAt: string | undefined;
    try {
      current = await input.continueFactory(
        input.applyParentInstructionHistory(current.completedRun),
        current.summary.spec ?? input.fallbackChildSpec,
        queued.instruction,
        current.summary,
        {
          instructionId: queued.instructionId,
          messageRef: queued.messageRef,
          source: queued.source,
          review: cloneDeepChildParentReview(queued.review),
          requestedAt: queued.queuedAt,
        },
      );
      executedAt = nowIso();
      input.markParentInstructionExecuted(queued.childRunId, queued.instructionId, executedAt);
      instructionRecord = {
        instructionId: queued.instructionId,
        messageRef: queued.messageRef,
        childRunId: queued.childRunId,
        source: queued.source,
        status: "executed",
        instruction: queued.instruction,
        review: cloneDeepChildParentReview(queued.review),
        requestedAt: queued.queuedAt,
        queuedAt: queued.queuedAt,
        executedAt,
      };
    } catch (error) {
      if (error instanceof DeepChildExecutionAdmissionError) {
        const cancelledAt = nowIso();
        input.markParentInstructionAdmissionRejected(
          queued.childRunId,
          queued.instructionId,
          cancelledAt,
        );
        instructionRecord = {
          instructionId: queued.instructionId,
          messageRef: queued.messageRef,
          childRunId: queued.childRunId,
          source: queued.source,
          status: "cancelled",
          instruction: queued.instruction,
          review: cloneDeepChildParentReview(queued.review),
          requestedAt: queued.queuedAt,
          queuedAt: queued.queuedAt,
          cancelledAt,
        };
      }
      throw error;
    } finally {
      input.recordInstruction(instructionRecord);
    }
    const completedRun = input.applyParentInstructionHistory(current.completedRun);
    current = {
      ...current,
      completedRun,
      pendingContinuation: current.pendingContinuation === undefined
        ? undefined
        : {
            ...current.pendingContinuation,
            childRun: completedRun,
          },
    };
    if (executedAt === undefined) {
      throw new Error("Deep child queued instruction completed without an execution timestamp");
    }
    input.executedQueuedInstructions.push({
      instructionId: queued.instructionId,
      messageRef: queued.messageRef,
      childRunId: queued.childRunId,
      instruction: queued.instruction,
      source: queued.source,
      review: cloneDeepChildParentReview(queued.review),
      queuedAt: queued.queuedAt,
      executedAt,
    });
    if (current.pendingContinuation !== undefined) {
      cancelRemainingQueuedInstructions(input, queued.childRunId);
      const completedRunAfterCancellation = input.applyParentInstructionHistory(current.completedRun);
      current = {
        ...current,
        completedRun: completedRunAfterCancellation,
        pendingContinuation: {
          ...current.pendingContinuation,
          childRun: completedRunAfterCancellation,
        },
      };
    }
    input.rememberKnownResult(current);
    if (current.pendingContinuation !== undefined) {
      return current;
    }
  }
}

function cancelRemainingQueuedInstructions(
  input: {
    readonly takeNextInstruction: (childRunId: string) => DeepChildScheduledInstruction | undefined;
    readonly markParentInstructionCancelled: (
      childRunId: string,
      instructionId: string,
      cancelledAt: string,
    ) => void;
    readonly recordInstruction: (instruction: DeepChildInstructionRecord) => void;
  },
  childRunId: string,
): void {
  const cancelledAt = nowIso();
  for (;;) {
    const queued = input.takeNextInstruction(childRunId);
    if (queued === undefined) {
      return;
    }
    input.markParentInstructionCancelled(queued.childRunId, queued.instructionId, cancelledAt);
    input.recordInstruction({
      instructionId: queued.instructionId,
      messageRef: queued.messageRef,
      childRunId: queued.childRunId,
      source: queued.source,
      status: "cancelled",
      instruction: queued.instruction,
      review: cloneDeepChildParentReview(queued.review),
      requestedAt: queued.queuedAt,
      queuedAt: queued.queuedAt,
      cancelledAt,
    });
  }
}

function preserveKnownChildMaterialAfterFollowUpFailure(
  failed: DeepChildSummary,
  previous: DeepChildSummary,
): DeepChildSummary {
  if (previous.findings.length === 0 && previous.evidenceRefs.length === 0) {
    return failed;
  }
  return {
    ...failed,
    summary: `${failed.summary} Previously completed child material remains available: ${previous.summary}`,
    findings: [...previous.findings],
    evidenceRefs: [...previous.evidenceRefs],
    uncertainty: `${failed.uncertainty} Previously completed material was retained for parent review.`,
  };
}

