import type { AgentTurnPendingApproval } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import type { DeepChildSpec } from "./contracts.js";
import type {
  DeepChildAgentRunResult,
} from "./deep-child-run-contracts.js";

export class DeepChildConfirmationDecisionError extends Error {
  constructor(
    readonly code:
      | "confirmation_not_pending"
      | "confirmation_continuation_lost"
      | "confirmation_in_progress"
      | "confirmation_outcome_unknown",
    message: string,
  ) {
    super(message);
    this.name = "DeepChildConfirmationDecisionError";
  }
}

export type DeepChildPendingContinuation = {
  readonly runId: string;
  readonly childRunId: string;
  readonly confirmationId: string;
  readonly childRun: ChildAgentRun;
  readonly childSpec: DeepChildSpec;
  readonly pendingApproval: AgentTurnPendingApproval;
};

export type DeepChildPendingContinuationRetentionOptions = {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly maxEntriesPerRun?: number;
  readonly now?: () => number;
};

export type DeepChildContinuationReservation = {
  readonly reservationId: string;
  readonly continuation: DeepChildPendingContinuation;
  /** A known execution result whose durable projection still needs to commit. */
  readonly pendingResult?: DeepChildAgentRunResult;
};

type RetainedDeepChildContinuation = {
  readonly continuation: DeepChildPendingContinuation;
  expiresAt: number;
  status: "available" | "reserved" | "outcome_unknown";
  reservationId?: string;
  pendingResult?: DeepChildAgentRunResult;
};

const DEFAULT_CONTINUATION_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CONTINUATIONS = 256;
const DEFAULT_MAX_CONTINUATIONS_PER_RUN = 16;

export class DeepChildPendingContinuationStore {
  private readonly continuations = new Map<string, RetainedDeepChildContinuation>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerRun: number;
  private readonly now: () => number;
  private nextReservationId = 0;

  constructor(options: DeepChildPendingContinuationRetentionOptions = {}) {
    this.ttlMs = positiveInteger(options.ttlMs, DEFAULT_CONTINUATION_TTL_MS);
    this.maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_CONTINUATIONS);
    this.maxEntriesPerRun = positiveInteger(
      options.maxEntriesPerRun,
      DEFAULT_MAX_CONTINUATIONS_PER_RUN,
    );
    this.now = options.now ?? Date.now;
  }

  remember(runId: string, continuation: Omit<DeepChildPendingContinuation, "runId"> | undefined): void {
    this.pruneExpired();
    if (continuation === undefined) {
      return;
    }
    const key = continuationKey(runId, continuation.childRunId, continuation.confirmationId);
    if (this.childInstructionBlock(runId, continuation.childRunId) !== undefined) {
      // A confirmation operation, its known uncommitted result, or an unknown
      // outcome owns the child until that exact confirmation is reconciled.
      return;
    }
    this.deleteForChildRun(runId, continuation.childRunId);
    const retained: RetainedDeepChildContinuation = {
      continuation: { ...continuation, runId },
      expiresAt: this.now() + this.ttlMs,
      status: "available",
    };
    this.continuations.set(key, retained);
    this.enforcePerRunLimit(runId);
    this.enforceGlobalLimit();
  }

  get(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    this.pruneExpired();
    const retained = this.continuations.get(continuationKey(runId, childRunId, confirmationId));
    return retained?.status === "outcome_unknown" ? undefined : retained?.continuation;
  }

  findByChildRun(runId: string, childRunId: string): DeepChildPendingContinuation | undefined {
    this.pruneExpired();
    for (const retained of this.continuations.values()) {
      if (
        retained.continuation.runId === runId &&
        retained.continuation.childRunId === childRunId &&
        retained.status !== "outcome_unknown"
      ) {
        return retained.continuation;
      }
    }
    return undefined;
  }

  consume(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    try {
      const reservation = this.reserve(runId, childRunId, confirmationId);
      this.commit(reservation);
      return reservation.continuation;
    } catch (error) {
      if (error instanceof DeepChildConfirmationDecisionError && error.code === "confirmation_continuation_lost") {
        return undefined;
      }
      throw error;
    }
  }

  reserve(
    runId: string,
    childRunId: string,
    confirmationId: string,
  ): DeepChildContinuationReservation {
    this.pruneExpired();
    const key = continuationKey(runId, childRunId, confirmationId);
    const retained = this.continuations.get(key);
    if (retained === undefined) {
      throw continuationDecisionError(
        "confirmation_continuation_lost",
        "该子 Agent 的确认上下文已不可恢复，请补充要求让父 Agent 重新审查。",
      );
    }
    if (retained.status === "reserved") {
      throw continuationDecisionError(
        "confirmation_in_progress",
        "该子 Agent 的确认正在处理中，请等待当前操作完成。",
      );
    }
    if (retained.status === "outcome_unknown") {
      throw continuationDecisionError(
        "confirmation_outcome_unknown",
        "该确认操作的执行结果无法确定，系统不会自动重复可能已经产生副作用的操作。",
      );
    }
    const reservationId = `deep-continuation-reservation-${++this.nextReservationId}`;
    retained.status = "reserved";
    retained.reservationId = reservationId;
    return {
      reservationId,
      continuation: retained.continuation,
      pendingResult: retained.pendingResult,
    };
  }

  retainResult(
    reservation: DeepChildContinuationReservation,
    result: DeepChildAgentRunResult,
  ): void {
    const retained = this.retainedForReservation(reservation);
    retained.pendingResult = result;
    retained.expiresAt = this.now() + this.ttlMs;
  }

  /** Release an unfinished reservation; a known result receives a fresh retry window. */
  release(reservation: DeepChildContinuationReservation): void {
    const retained = this.retainedForReservation(reservation);
    retained.status = "available";
    retained.reservationId = undefined;
    if (retained.pendingResult !== undefined) {
      retained.expiresAt = this.now() + this.ttlMs;
    }
  }

  /** Mark execution as unknown; future calls must not blindly replay it. */
  markOutcomeUnknown(reservation: DeepChildContinuationReservation): void {
    const retained = this.retainedForReservation(reservation);
    retained.status = "outcome_unknown";
    retained.reservationId = undefined;
    retained.pendingResult = undefined;
    retained.expiresAt = this.now() + this.ttlMs;
  }

  commit(reservation: DeepChildContinuationReservation): void {
    const retained = this.retainedForReservation(reservation);
    this.continuations.delete(continuationKey(
      reservation.continuation.runId,
      reservation.continuation.childRunId,
      reservation.continuation.confirmationId,
    ));
  }

  delete(runId: string, childRunId: string, confirmationId: string): void {
    this.continuations.delete(continuationKey(runId, childRunId, confirmationId));
  }

  assertChildInstructionAllowed(runId: string, childRunId: string): void {
    this.pruneExpired();
    const block = this.childInstructionBlock(runId, childRunId);
    if (block === "outcome_unknown") {
      throw continuationDecisionError(
        "confirmation_outcome_unknown",
        "该确认操作的执行结果无法确定，系统不会用新的父层指令绕过或重复可能已经产生副作用的操作。",
      );
    }
    if (block === "occupied") {
      throw continuationDecisionError(
        "confirmation_in_progress",
        "该子 Agent 的确认操作或已知结果仍在处理中，请先完成原确认结果的持久化。",
      );
    }
  }

  deleteForChildRun(runId: string, childRunId: string): void {
    this.assertChildInstructionAllowed(runId, childRunId);
    for (const [key, retained] of this.continuations) {
      if (
        retained.continuation.runId === runId &&
        retained.continuation.childRunId === childRunId
      ) {
        this.continuations.delete(key);
      }
    }
  }

  deleteForRun(runId: string): void {
    for (const [key, retained] of this.continuations) {
      if (retained.continuation.runId === runId) {
        this.continuations.delete(key);
      }
    }
  }

  retainPendingForRun(
    runId: string,
    pending: readonly Pick<DeepChildPendingContinuation, "childRunId" | "confirmationId">[],
  ): void {
    this.pruneExpired();
    const retainedKeys = new Set(
      pending.map((item) => continuationKey(runId, item.childRunId, item.confirmationId)),
    );
    for (const [key, retained] of this.continuations) {
      if (
        retained.continuation.runId === runId &&
        retained.status !== "reserved" &&
        retained.status !== "outcome_unknown" &&
        retained.pendingResult === undefined &&
        !retainedKeys.has(key)
      ) {
        this.continuations.delete(key);
      }
    }
  }

  clear(): void {
    this.continuations.clear();
  }

  assertPending(runId: string, childRunId: string, confirmationId: string): void {
    this.pruneExpired();
    const retained = this.continuations.get(continuationKey(runId, childRunId, confirmationId));
    if (retained === undefined) {
      throw continuationDecisionError(
        "confirmation_continuation_lost",
        "该子 Agent 的确认上下文已不可恢复，请补充要求让父 Agent 重新审查。",
      );
    }
    if (retained.status === "reserved") {
      throw continuationDecisionError(
        "confirmation_in_progress",
        "该子 Agent 的确认正在处理中，请等待当前操作完成。",
      );
    }
    if (retained.status === "outcome_unknown") {
      throw continuationDecisionError(
        "confirmation_outcome_unknown",
        "该确认操作的执行结果无法确定，系统不会自动重复可能已经产生副作用的操作。",
      );
    }
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, retained] of this.continuations) {
      if (retained.status !== "reserved" && retained.expiresAt <= now) {
        this.continuations.delete(key);
      }
    }
  }

  private enforcePerRunLimit(runId: string): void {
    let retainedForRun = [...this.continuations.values()]
      .filter((retained) => retained.continuation.runId === runId)
      .length;
    if (retainedForRun <= this.maxEntriesPerRun) {
      return;
    }
    for (const [key, retained] of this.continuations) {
      if (retained.continuation.runId !== runId) {
        continue;
      }
      if (retained.status === "reserved") {
        continue;
      }
      if (retained.status === "outcome_unknown" || retained.pendingResult !== undefined) {
        continue;
      }
      this.continuations.delete(key);
      retainedForRun -= 1;
      if (retainedForRun <= this.maxEntriesPerRun) {
        return;
      }
    }
  }

  private enforceGlobalLimit(): void {
    while (this.continuations.size > this.maxEntries) {
      const oldestKey = [...this.continuations.entries()]
        .find(([, retained]) => (
          retained.status !== "reserved" &&
          retained.status !== "outcome_unknown" &&
          retained.pendingResult === undefined
        ))?.[0];
      if (oldestKey === undefined) {
        return;
      }
      this.continuations.delete(oldestKey);
    }
  }

  private retainedForReservation(
    reservation: DeepChildContinuationReservation,
  ): RetainedDeepChildContinuation {
    const key = continuationKey(
      reservation.continuation.runId,
      reservation.continuation.childRunId,
      reservation.continuation.confirmationId,
    );
    const retained = this.continuations.get(key);
    if (retained === undefined || retained.reservationId !== reservation.reservationId || retained.status !== "reserved") {
      throw continuationDecisionError(
        "confirmation_continuation_lost",
        "该子 Agent 的确认上下文已不可恢复，请补充要求让父 Agent 重新审查。",
      );
    }
    return retained;
  }

  private childInstructionBlock(
    runId: string,
    childRunId: string,
  ): "occupied" | "outcome_unknown" | undefined {
    let occupied = false;
    for (const retained of this.continuations.values()) {
      if (
        retained.continuation.runId !== runId ||
        retained.continuation.childRunId !== childRunId
      ) {
        continue;
      }
      if (retained.status === "outcome_unknown") {
        return "outcome_unknown";
      }
      if (retained.status === "reserved" || retained.pendingResult !== undefined) {
        occupied = true;
      }
    }
    return occupied ? "occupied" : undefined;
  }
}

function continuationDecisionError(
  code: DeepChildConfirmationDecisionError["code"],
  message: string,
): DeepChildConfirmationDecisionError {
  return new DeepChildConfirmationDecisionError(code, message);
}

function continuationKey(runId: string, childRunId: string, confirmationId: string): string {
  return `${runId}:${childRunId}:${confirmationId}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
