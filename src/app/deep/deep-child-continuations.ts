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

export class DeepChildPendingContinuationStore {
  private readonly continuations = new Map<string, DeepChildPendingContinuation>();

  remember(runId: string, continuation: Omit<DeepChildPendingContinuation, "runId"> | undefined): void {
    if (continuation === undefined) {
      return;
    }
    this.continuations.set(
      continuationKey(runId, continuation.childRunId, continuation.confirmationId),
      { ...continuation, runId },
    );
  }

  get(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    return this.continuations.get(continuationKey(runId, childRunId, confirmationId));
  }

  findByChildRun(runId: string, childRunId: string): DeepChildPendingContinuation | undefined {
    const prefix = `${runId}:${childRunId}:`;
    for (const [key, continuation] of this.continuations) {
      if (key.startsWith(prefix)) {
        return continuation;
      }
    }
    return undefined;
  }

  consume(runId: string, childRunId: string, confirmationId: string): DeepChildPendingContinuation | undefined {
    const key = continuationKey(runId, childRunId, confirmationId);
    const continuation = this.continuations.get(key);
    this.continuations.delete(key);
    return continuation;
  }

  delete(runId: string, childRunId: string, confirmationId: string): void {
    this.continuations.delete(continuationKey(runId, childRunId, confirmationId));
  }

  deleteForChildRun(runId: string, childRunId: string): void {
    const prefix = `${runId}:${childRunId}:`;
    for (const key of this.continuations.keys()) {
      if (key.startsWith(prefix)) {
        this.continuations.delete(key);
      }
    }
  }

  deleteForRun(runId: string): void {
    const prefix = `${runId}:`;
    for (const key of this.continuations.keys()) {
      if (key.startsWith(prefix)) {
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
}

function continuationKey(runId: string, childRunId: string, confirmationId: string): string {
  return `${runId}:${childRunId}:${confirmationId}`;
}
