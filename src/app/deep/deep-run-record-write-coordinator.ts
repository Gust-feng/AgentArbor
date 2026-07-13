import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

export type DeepRunRecordWriteOperation = "save" | "delete";

export type DeepRunRecordWriteFailure = {
  readonly runId: string;
  readonly operation: DeepRunRecordWriteOperation;
  readonly sequence: number;
  readonly error: unknown;
};

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
 * queue; the returned promise and the next drain both retain the failure.
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
    state.nextSequence = sequence;
    state.pendingCount += 1;

    const result = state.tail.then(execute);
    state.tail = result.then(
      () => {
        state.pendingCount -= 1;
        removeIdleState(state);
      },
      (error: unknown) => {
        state.pendingCount -= 1;
        state.failures.push({
          runId,
          operation,
          sequence,
          error,
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
