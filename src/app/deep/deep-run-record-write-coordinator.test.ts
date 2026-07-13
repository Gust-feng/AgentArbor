import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoordinatedDeepRunRecordStore,
  createDeepRunRecordWriteCoordinator,
  deepRunRecordWriteReceiptFromError,
  DeepRunRecordWriteError,
  DeepRunRecordWriteDrainError,
} from "./deep-run-record-write-coordinator.js";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

test("DeepRunRecordWriteCoordinator snapshots on enqueue and orders save/delete/save for one run", async () => {
  const firstSaveGate = deferred();
  const operations: string[] = [];
  const stored = new Map<string, DeepRunRecord>();
  let saveCount = 0;
  const store = createStore({
    async upsert(record) {
      saveCount += 1;
      operations.push(`save:${record.run.goal}:start`);
      if (saveCount === 1) {
        await firstSaveGate.promise;
      }
      stored.set(record.run.runId, structuredClone(record));
      operations.push(`save:${record.run.goal}:finish`);
      return structuredClone(record);
    },
    async delete(runId) {
      operations.push("delete:start");
      stored.delete(runId);
      operations.push("delete:finish");
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);
  const mutableRun: Mutable<DeepRunRecord["run"]> = { ...createRun("run-1", "first").run };
  const firstRecord = createRecord(mutableRun);

  const firstSave = coordinator.save(firstRecord);
  mutableRun.goal = "mutated-after-enqueue";
  const deletion = coordinator.delete("run-1");
  const secondSave = coordinator.save(createRun("run-1", "second"));

  await waitFor(() => operations.length === 1);
  assert.deepEqual(operations, ["save:first:start"]);

  firstSaveGate.resolve();
  await Promise.all([firstSave, deletion, secondSave]);

  assert.deepEqual(operations, [
    "save:first:start",
    "save:first:finish",
    "delete:start",
    "delete:finish",
    "save:second:start",
    "save:second:finish",
  ]);
  assert.equal(stored.get("run-1")?.run.goal, "second");
  await coordinator.drainRun("run-1");
});

test("coordinated Deep run record reads wait for queued writes", async () => {
  const writeGate = deferred();
  const base = createStore();
  const rawStore: DeepRunRecordStore = {
    ...base,
    async upsert(record) {
      await writeGate.promise;
      return base.upsert(record);
    },
  };
  const coordinated = createCoordinatedDeepRunRecordStore(rawStore);
  const write = coordinated.store.upsert(createRun("run-read", "latest"));
  let readSettled = false;
  const read = coordinated.store.get("run-read").finally(() => {
    readSettled = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(readSettled, false);
  writeGate.resolve();
  await write;
  assert.equal((await read)?.run.goal, "latest");
  await coordinated.writes.drain();
});

test("coordinated Deep run record read barriers retain failures for shutdown drain", async () => {
  const base = createStore();
  const rawStore: DeepRunRecordStore = {
    ...base,
    async upsert() {
      throw new Error("disk unavailable");
    },
  };
  const coordinated = createCoordinatedDeepRunRecordStore(rawStore);
  void coordinated.store.upsert(createRun("run-read-failure", "latest"));

  await assert.rejects(
    coordinated.store.get("run-read-failure"),
    (error: unknown) => error instanceof DeepRunRecordWriteDrainError
      && error.failures[0]?.runId === "run-read-failure",
  );
  await assert.rejects(
    coordinated.writes.drain(),
    (error: unknown) => error instanceof DeepRunRecordWriteDrainError
      && error.failures[0]?.runId === "run-read-failure",
  );
});

test("DeepRunRecordWriteCoordinator runs different run queues concurrently", async () => {
  const gates = new Map([
    ["run-a", deferred()],
    ["run-b", deferred()],
  ]);
  const started: string[] = [];
  const store = createStore({
    async upsert(record) {
      const runId = record.run.runId;
      started.push(runId);
      await gates.get(runId)?.promise;
      return structuredClone(record);
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);

  const saveA = coordinator.save(createRun("run-a", "a"));
  const saveB = coordinator.save(createRun("run-b", "b"));
  await waitFor(() => started.length === 2);

  assert.deepEqual(new Set(started), new Set(["run-a", "run-b"]));
  gates.get("run-a")?.resolve();
  gates.get("run-b")?.resolve();
  await Promise.all([saveA, saveB]);
  await coordinator.drain();
});

test("DeepRunRecordWriteCoordinator retains an unrecovered failure until a later save succeeds", async () => {
  const persistedGoals: string[] = [];
  let attempt = 0;
  const base = createStore();
  const store: DeepRunRecordStore = {
    ...base,
    async upsert(record) {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("disk unavailable");
      }
      persistedGoals.push(record.run.goal);
      return base.upsert(record);
    },
  };
  const coordinated = createCoordinatedDeepRunRecordStore(store);
  const coordinator = coordinated.writes;

  await assert.rejects(
    coordinator.save(createRun("run-1", "failed-live-snapshot")),
    DeepRunRecordWriteError,
  );

  await assert.rejects(
    coordinator.flushRun("run-1"),
    (error: unknown) => {
      assert.ok(error instanceof DeepRunRecordWriteDrainError);
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0]?.runId, "run-1");
      assert.equal(error.failures[0]?.operation, "save");
      assert.equal(error.failures[0]?.sequence, 1);
      assert.match(String(error.failures[0]?.error), /disk unavailable/);
      return true;
    },
  );

  const recoveredSave = coordinator.save(createRun("run-1", "final-snapshot"));
  await recoveredSave;
  assert.deepEqual(persistedGoals, ["final-snapshot"]);
  assert.equal((await coordinated.store.get("run-1"))?.run.goal, "final-snapshot");
  await coordinator.drainRun("run-1");
});

test("DeepRunRecordWriteCoordinator clears an earlier failure after a successful delete", async () => {
  const store = createStore({
    async upsert() {
      throw new Error("disk unavailable");
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);

  await assert.rejects(
    coordinator.save(createRun("run-delete-recovery", "failed-live-snapshot")),
    DeepRunRecordWriteError,
  );
  await coordinator.delete("run-delete-recovery");

  await coordinator.flushRun("run-delete-recovery");
  await coordinator.drainRun("run-delete-recovery");
});

test("DeepRunRecordWriteCoordinator recovers failures only for the run with a later success", async () => {
  const store = createStore({
    async upsert(record) {
      if (record.run.goal === "fail") {
        throw new Error(`${record.run.runId} write failed`);
      }
      return structuredClone(record);
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);

  await Promise.all([
    assert.rejects(coordinator.save(createRun("run-a", "fail")), DeepRunRecordWriteError),
    assert.rejects(coordinator.save(createRun("run-b", "fail")), DeepRunRecordWriteError),
  ]);
  await coordinator.save(createRun("run-a", "recovered"));

  await coordinator.flushRun("run-a");
  await assert.rejects(
    coordinator.flushRun("run-b"),
    (error: unknown) => error instanceof DeepRunRecordWriteDrainError
      && error.failures.length === 1
      && error.failures[0]?.runId === "run-b",
  );
  await assert.rejects(
    coordinator.drain(),
    (error: unknown) => error instanceof DeepRunRecordWriteDrainError
      && error.failures.length === 1
      && error.failures[0]?.runId === "run-b",
  );
  await coordinator.drain();
});

test("DeepRunRecordWriteCoordinator acknowledges an awaited operation receipt without consuming a shared-error background failure", async () => {
  const sharedFailure = new Error("shared storage failure");
  let attempt = 0;
  const store = createStore({
    async upsert(record) {
      attempt += 1;
      if (attempt <= 2) {
        throw sharedFailure;
      }
      return structuredClone(record);
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);

  void coordinator.save(createRun("run-1", "background-first"));
  let awaitedError: unknown;
  await assert.rejects(
    coordinator.save(createRun("run-1", "awaited-second")),
    (error: unknown) => {
      assert.ok(error instanceof DeepRunRecordWriteError);
      assert.equal(error.cause, sharedFailure);
      assert.equal(error.receipt.runId, "run-1");
      assert.equal(error.receipt.operation, "save");
      assert.equal(error.receipt.sequence, 2);
      awaitedError = error;
      return true;
    },
  );
  const awaitedReceipt = deepRunRecordWriteReceiptFromError(awaitedError);
  assert.ok(awaitedReceipt);
  assert.equal(await coordinator.acknowledgeFailure({
    ...awaitedReceipt,
    operationId: "not-the-issued-operation-id",
  }), false);
  assert.equal(await coordinator.acknowledgeFailure({
    ...awaitedReceipt,
    sequence: 999,
  }), false);
  assert.equal(await coordinator.acknowledgeFailure(awaitedReceipt), true);

  await assert.rejects(
    coordinator.drainRun("run-1"),
    (error: unknown) => {
      assert.ok(error instanceof DeepRunRecordWriteDrainError);
      assert.equal(error.failures.length, 1);
      assert.equal(error.failures[0]?.sequence, 1);
      assert.equal(error.failures[0]?.error, sharedFailure);
      return true;
    },
  );

  await coordinator.save(createRun("run-1", "recovered"));
  await coordinator.drainRun("run-1");
});

test("DeepRunRecordWriteCoordinator global drain waits all runs and aggregates failures", async () => {
  const runBGate = deferred();
  const store = createStore({
    async upsert(record) {
      if (record.run.runId === "run-a") {
        throw new Error("run-a write failed");
      }
      await runBGate.promise;
      return structuredClone(record);
    },
    async delete(runId) {
      if (runId === "run-c") {
        throw new Error("run-c delete failed");
      }
    },
  });
  const coordinator = createDeepRunRecordWriteCoordinator(store);

  void coordinator.save(createRun("run-a", "a"));
  const saveB = coordinator.save(createRun("run-b", "b"));
  void coordinator.delete("run-c");
  const draining = coordinator.drain();

  let drainSettled = false;
  void draining.then(
    () => {
      drainSettled = true;
    },
    () => {
      drainSettled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(drainSettled, false);
  runBGate.resolve();

  await assert.rejects(
    draining,
    (error: unknown) => {
      assert.ok(error instanceof DeepRunRecordWriteDrainError);
      assert.deepEqual(
        error.failures.map((failure) => `${failure.runId}:${failure.operation}`),
        ["run-a:save", "run-c:delete"],
      );
      return true;
    },
  );
  await saveB;
});

function createStore(overrides: {
  readonly upsert?: (record: DeepRunRecord) => Promise<DeepRunRecord>;
  readonly delete?: (runId: string) => Promise<void>;
} = {}): DeepRunRecordStore {
  const records = new Map<string, DeepRunRecord>();
  return {
    async upsert(record) {
      if (overrides.upsert !== undefined) {
        return overrides.upsert(record);
      }
      const stored = structuredClone(record);
      records.set(record.run.runId, stored);
      return structuredClone(stored);
    },
    async get(runId) {
      const record = records.get(runId);
      return record === undefined ? undefined : structuredClone(record);
    },
    async list(limit = 50) {
      return [...records.values()].slice(0, limit).map((record) => structuredClone(record));
    },
    async listByConversation(conversationId, limit) {
      const matching = [...records.values()].filter(
        (record) => record.run.conversationId === conversationId,
      ).sort(compareByUpdatedAt);
      return (limit === undefined
        ? matching
        : matching.slice(0, Math.max(0, Math.floor(limit))))
        .map((record) => structuredClone(record));
    },
    async listByRootRun(rootRunId, limit) {
      const matching = [...records.values()].filter(
        (record) => (record.run.rootRunId ?? record.run.runId) === rootRunId,
      ).sort(compareByUpdatedAt);
      return (limit === undefined
        ? matching
        : matching.slice(0, Math.max(0, Math.floor(limit))))
        .map((record) => structuredClone(record));
    },
    async delete(runId) {
      if (overrides.delete !== undefined) {
        await overrides.delete(runId);
        return;
      }
      records.delete(runId);
    },
  };
}

function createRun(runId: string, goal: string): DeepRunRecord {
  return createRecord({
    runId,
    conversationId: "conversation-1",
    rootRunId: runId,
    turnOrdinal: 1,
    goal,
    status: "running",
    isolation: {
      kind: "deep_conversation",
      runKind: "underground",
      runMode: "deep",
    },
    startedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  });
}

function createRecord(run: DeepRunRecord["run"]): DeepRunRecord {
  const rootAgentId = `manager:${run.runId}`;
  return {
    run,
    agentRunTree: {
      treeId: `tree:${run.runId}`,
      rootRunId: run.runId,
      rootAgentId,
      rootSpec: {
        specId: `spec:${run.runId}`,
        agentId: rootAgentId,
        displayName: "Manager",
        agentKind: "manager",
        role: "Coordinate the Deep run.",
        protocol: {
          inputs: [],
          outputs: [],
        },
        promptRef: "prompt:manager",
        outputContractRef: "contract:manager",
        permissions: {
          allowModel: true,
          allowedTools: [],
          fallback: "disabled",
        },
        budget: {},
        inputRefs: [],
        createdAt: run.startedAt,
      },
      childRuns: [],
      delegationDecisions: [],
      parentSyntheses: [],
      status: "running",
      createdAt: run.startedAt,
      updatedAt: run.updatedAt,
    },
    controlEvents: [],
    eventSequence: [],
    updatedAt: run.updatedAt,
  };
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(): void {
      resolvePromise?.();
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for coordinator test condition.");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

function compareByUpdatedAt(left: DeepRunRecord, right: DeepRunRecord): number {
  return right.run.updatedAt.localeCompare(left.run.updatedAt);
}
