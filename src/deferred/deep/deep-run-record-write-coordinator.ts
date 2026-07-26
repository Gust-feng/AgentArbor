import { randomUUID } from "node:crypto";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";
import { errorMessage } from "../../kernel/values/index.js";

export type DeepRunRecordWriteOperation = "save" | "delete";

export type DeepRunRecordWriteReceipt = {
  readonly operationId: string;
  readonly runId: string;
  readonly operation: DeepRunRecordWriteOperation;
  readonly sequence: number;
};

export type DeepRunRecordWriteFailure = DeepRunRecordWriteReceipt & {
  readonly error: unknown;
};

/** One failed write as observed by its direct caller, with an exact operation identity. */
export class DeepRunRecordWriteError extends Error {
  constructor(
    readonly receipt: DeepRunRecordWriteReceipt,
    cause: unknown,
  ) {
    super(errorMessage(cause), { cause });
    this.name = "DeepRunRecordWriteError";
  }
}

export function deepRunRecordWriteReceiptFromError(
  error: unknown,
): DeepRunRecordWriteReceipt | undefined {
  return error instanceof DeepRunRecordWriteError ? error.receipt : undefined;
}

export class DeepRunRecordWriteDrainError extends Error {
  readonly failures: readonly DeepRunRecordWriteFailure[];

  constructor(failures: readonly DeepRunRecordWriteFailure[]) {
    const runCount = new Set(failures.map((failure) => failure.runId)).size;
    super(`Failed to persist ${failures.length} Deep run record operation(s) across ${runCount} run(s).`);
    this.name = "DeepRunRecordWriteDrainError";
    this.failures = failures;
  }
}

export interface DeepRunRecordWriteCoordinator {
  save(record: DeepRunRecord): Promise<DeepRunRecord>;
  delete(runId: string): Promise<void>;
  /** Wait for writes queued for one run without acknowledging failures. */
  flushRun(runId: string): Promise<void>;
  /** Wait for writes queued for all runs without acknowledging failures. */
  flush(): Promise<void>;
  /** Acknowledge one exact operation failure already returned to an awaited caller. */
  acknowledgeFailure(receipt: DeepRunRecordWriteReceipt): Promise<boolean>;
  drainRun(runId: string): Promise<void>;
  drain(): Promise<void>;
}

export type CoordinatedDeepRunRecordStore = {
  readonly store: DeepRunRecordStore;
  readonly writes: DeepRunRecordWriteCoordinator;
};

type RunWriteState = {
  readonly runId: string;
  tail: Promise<void>;
  nextSequence: number;
  pendingCount: number;
  failures: DeepRunRecordWriteFailure[];
};

type DrainCapture = {
  readonly state: RunWriteState;
  readonly throughSequence: number;
  readonly barrier: Promise<void>;
};

/**
 * Serializes durable mutations for each Deep run without coupling unrelated runs.
 * Save and delete share one FIFO: save->delete removes a record, while
 * delete->save intentionally recreates it. A failed operation never poisons the
 * queue. Its failure remains observable until it is acknowledged, drained, or
 * superseded by a later successful mutation for the same run.
 */
export function createDeepRunRecordWriteCoordinator(
  store: DeepRunRecordStore,
): DeepRunRecordWriteCoordinator {
  const states = new Map<string, RunWriteState>();

  function stateFor(runId: string): RunWriteState {
    const existing = states.get(runId);
    if (existing !== undefined) {
      return existing;
    }
    const created: RunWriteState = {
      runId,
      tail: Promise.resolve(),
      nextSequence: 0,
      pendingCount: 0,
      failures: [],
    };
    states.set(runId, created);
    return created;
  }

  function removeIdleState(state: RunWriteState): void {
    if (
      state.pendingCount === 0
      && state.failures.length === 0
      && states.get(state.runId) === state
    ) {
      states.delete(state.runId);
    }
  }

  function enqueue<TResult>(
    runId: string,
    operation: DeepRunRecordWriteOperation,
    execute: () => Promise<TResult>,
  ): Promise<TResult> {
    const state = stateFor(runId);
    const sequence = state.nextSequence + 1;
    const receipt: DeepRunRecordWriteReceipt = {
      operationId: randomUUID(),
      runId,
      operation,
      sequence,
    };
    state.nextSequence = sequence;
    state.pendingCount += 1;

    const result = state.tail.then(execute).catch((error: unknown) => {
      throw new DeepRunRecordWriteError(receipt, error);
    });
    state.tail = result.then(
      () => {
        state.pendingCount -= 1;
        // Every mutation writes the run's complete current state (or deletes it),
        // so this success durably supersedes only earlier failures in this FIFO.
        state.failures = state.failures.filter((failure) => failure.sequence >= sequence);
        removeIdleState(state);
      },
      (error: unknown) => {
        state.pendingCount -= 1;
        state.failures.push({
          ...receipt,
          error: error instanceof DeepRunRecordWriteError ? error.cause : error,
        });
      },
    );

    // Callers may intentionally fire-and-forget live snapshots. This handler
    // prevents an unhandled rejection; the original promise still rejects for
    // awaited writes, and drain retains the same failure for lifecycle owners.
    void result.catch(() => undefined);
    return result;
  }

  function capture(state: RunWriteState): DrainCapture {
    return {
      state,
      throughSequence: state.nextSequence,
      barrier: state.tail,
    };
  }

  async function collectFailures(input: DrainCapture): Promise<readonly DeepRunRecordWriteFailure[]> {
    await input.barrier;
    const observed: DeepRunRecordWriteFailure[] = [];
    const remaining: DeepRunRecordWriteFailure[] = [];
    for (const failure of input.state.failures) {
      if (failure.sequence <= input.throughSequence) {
        observed.push(failure);
      } else {
        remaining.push(failure);
      }
    }
    input.state.failures = remaining;
    removeIdleState(input.state);
    return observed;
  }

  function throwIfFailed(failures: readonly DeepRunRecordWriteFailure[]): void {
    if (failures.length > 0) {
      throw new DeepRunRecordWriteDrainError(failures);
    }
  }

  async function flushCapture(input: DrainCapture): Promise<void> {
    await input.barrier;
    throwIfFailed(input.state.failures.filter(
      (failure) => failure.sequence <= input.throughSequence,
    ));
  }

  return {
    save(record: DeepRunRecord): Promise<DeepRunRecord> {
      // Capture the exact live projection at enqueue time. Deep callbacks often
      // keep mutating their source objects while an earlier disk write is active.
      const snapshot = structuredClone(record);
      return enqueue(snapshot.run.runId, "save", () => store.upsert(snapshot));
    },

    delete(runId: string): Promise<void> {
      return enqueue(runId, "delete", () => store.delete(runId));
    },

    async flushRun(runId: string): Promise<void> {
      const state = states.get(runId);
      if (state === undefined) {
        return;
      }
      await flushCapture(capture(state));
    },

    async flush(): Promise<void> {
      const captures = [...states.values()].map(capture);
      await Promise.all(captures.map(flushCapture));
    },

    async acknowledgeFailure(receipt: DeepRunRecordWriteReceipt): Promise<boolean> {
      const state = states.get(receipt.runId);
      if (state === undefined) {
        return false;
      }
      await state.tail;
      const failureIndex = state.failures.findIndex((failure) => (
        failure.operationId === receipt.operationId
        && failure.sequence === receipt.sequence
        && failure.operation === receipt.operation
      ));
      if (failureIndex < 0) {
        return false;
      }
      state.failures.splice(failureIndex, 1);
      removeIdleState(state);
      return true;
    },

    async drainRun(runId: string): Promise<void> {
      const state = states.get(runId);
      if (state === undefined) {
        return;
      }
      throwIfFailed(await collectFailures(capture(state)));
    },

    async drain(): Promise<void> {
      const captures = [...states.values()].map(capture);
      const failures = (await Promise.all(captures.map(collectFailures))).flat();
      throwIfFailed(failures);
    },
  };
}


/**
 * Keeps query ownership on the repository while routing every durable mutation
 * through the per-run FIFO. Consumers cannot accidentally bypass write order.
 */
export function createCoordinatedDeepRunRecordStore(
  store: DeepRunRecordStore,
): CoordinatedDeepRunRecordStore {
  const writes = createDeepRunRecordWriteCoordinator(store);
  return {
    writes,
    store: {
      upsert: (record) => writes.save(record),
      delete: (runId) => writes.delete(runId),
      // A query must not overtake a live projection write. Feature commands
      // add a per-conversation gate, so the barrier remains stable while the
      // underlying query runs.
      get: async (runId) => {
        await writes.flushRun(runId);
        return store.get(runId);
      },
      list: async (limit) => {
        await writes.flush();
        return store.list(limit);
      },
      listByConversation: async (conversationId, limit) => {
        await writes.flush();
        return store.listByConversation(conversationId, limit);
      },
      listByRootRun: async (rootRunId, limit) => {
        await writes.flush();
        return store.listByRootRun(rootRunId, limit);
      },
    },
  };
}
