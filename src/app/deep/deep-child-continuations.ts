import type { AgentTurnPendingApproval } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import type { DeepChildSpec } from "./contracts.js";

export class DeepChildConfirmationDecisionError extends Error {
  constructor(
    readonly code:
      | "confirmation_not_pending"
      | "confirmation_continuation_lost",
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

type RetainedDeepChildContinuation = {
  readonly continuation: DeepChildPendingContinuation;
  readonly expiresAt: number;
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
    this.deleteForChildRun(runId, continuation.childRunId);
    const retained: RetainedDeepChildContinuation = {
      continuation: { ...continuation, runId },
      expiresAt: this.now() + this.ttlMs,
    };
    this.continuations.set(
      continuationKey(runId, continuation.childRunId, continuation.confirmationId),
      retained,
    );
    this.enforcePerRunLimit(runId);
    this.enforceGlobalLimit();
  }

  get(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    this.pruneExpired();
    return this.continuations.get(continuationKey(runId, childRunId, confirmationId))?.continuation;
  }

  findByChildRun(runId: string, childRunId: string): DeepChildPendingContinuation | undefined {
    this.pruneExpired();
    for (const retained of this.continuations.values()) {
      if (
        retained.continuation.runId === runId &&
        retained.continuation.childRunId === childRunId
      ) {
        return retained.continuation;
      }
    }
    return undefined;
  }

  consume(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    this.pruneExpired();
    const key = continuationKey(runId, childRunId, confirmationId);
    const continuation = this.continuations.get(key)?.continuation;
    this.continuations.delete(key);
    return continuation;
  }

  delete(runId: string, childRunId: string, confirmationId: string): void {
    this.continuations.delete(continuationKey(runId, childRunId, confirmationId));
  }

  deleteForChildRun(runId: string, childRunId: string): void {
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
      if (retained.continuation.runId === runId && !retainedKeys.has(key)) {
        this.continuations.delete(key);
      }
    }
  }

  clear(): void {
    this.continuations.clear();
  }

  assertPending(runId: string, childRunId: string, confirmationId: string): void {
    if (this.get(runId, childRunId, confirmationId) !== undefined) {
      return;
    }
    throw new DeepChildConfirmationDecisionError(
      "confirmation_continuation_lost",
      "该子 Agent 的确认上下文已不可恢复，请补充要求让父 Agent 重新审查。",
    );
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, retained] of this.continuations) {
      if (retained.expiresAt <= now) {
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
      this.continuations.delete(key);
      retainedForRun -= 1;
      if (retainedForRun <= this.maxEntriesPerRun) {
        return;
      }
    }
  }

  private enforceGlobalLimit(): void {
    while (this.continuations.size > this.maxEntries) {
      const oldestKey = this.continuations.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        return;
      }
      this.continuations.delete(oldestKey);
    }
  }
}

function continuationKey(runId: string, childRunId: string, confirmationId: string): string {
  return `${runId}:${childRunId}:${confirmationId}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
