import type { BasicAgentCanvasProjection, BasicAgentRunJob } from "./run-job.js";
import type { BasicAgentPendingToolContinuation } from "./contracts.js";

export class BasicAgentConfirmationDecisionError extends Error {
  constructor(
    readonly code: "invalid_confirmation_state" | "confirmation_not_pending",
    message: string
  ) {
    super(message);
    this.name = "BasicAgentConfirmationDecisionError";
  }
}

export class BasicAgentPendingContinuationStore {
  private readonly continuations = new Map<string, BasicAgentPendingToolContinuation>();

  remember(runId: string, continuation: BasicAgentPendingToolContinuation | undefined): void {
    if (continuation === undefined) {
      return;
    }
    this.continuations.set(continuationKey(runId, continuation.confirmationId), continuation);
  }

  consume(runId: string, confirmationId: string): BasicAgentPendingToolContinuation | undefined {
    const key = continuationKey(runId, confirmationId);
    const continuation = this.continuations.get(key);
    this.continuations.delete(key);
    return continuation;
  }

  delete(runId: string, confirmationId: string): void {
    this.continuations.delete(continuationKey(runId, confirmationId));
  }

  deleteForRun(runId: string): Promise<void> {
    const releases: Promise<void>[] = [];
    for (const [key, continuation] of this.continuations) {
      if (key.startsWith(`${runId}:`)) {
        this.continuations.delete(key);
        // Deletion is intentionally synchronous. A concurrent confirmation
        // decision must not acquire a continuation once cancellation begins.
        releases.push(Promise.resolve().then(() => continuation.release()));
      }
    }
    return Promise.allSettled(releases).then(() => undefined);
  }

  clearAll(): Promise<void> {
    const continuations = [...this.continuations.values()];
    // Clear synchronously so concurrent cancellation or shutdown cannot
    // acquire and release the same continuation a second time.
    this.continuations.clear();
    return Promise.allSettled(
      continuations.map((continuation) => Promise.resolve().then(() => continuation.release()))
    ).then(() => undefined);
  }

  assertPendingConfirmation(job: BasicAgentRunJob, confirmationId: string): void {
    if (job.status !== "approval_needed") {
      throw new BasicAgentConfirmationDecisionError(
        "invalid_confirmation_state",
        "这次运行当前没有等待你判断的操作。"
      );
    }
    if (job.confirmationDecisions.some((decision) => decision.confirmationId === confirmationId)) {
      throw new BasicAgentConfirmationDecisionError(
        "confirmation_not_pending",
        "这项操作已经处理过。"
      );
    }
    if (pendingConfirmationIdFromCanvas(job.completed?.canvas) === confirmationId) {
      return;
    }
    if (this.continuations.has(continuationKey(job.runId, confirmationId))) {
      return;
    }
    throw new BasicAgentConfirmationDecisionError(
      "confirmation_not_pending",
      "没有找到仍可处理的操作。"
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
