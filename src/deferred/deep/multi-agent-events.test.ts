import assert from "node:assert/strict";
import test from "node:test";
import type { DeepRunStreamEvent } from "./deep-events.js";
import {
  createMultiAgentRunEventStream,
  observeDeepRunRecordStore,
} from "./multi-agent-events.js";
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

test("Multi-Agent events preserve the subscribe-before-replay window without losing events", async () => {
  let current = runRecord("running", [runEvent(1)]);
  let releaseRead: (() => void) | undefined;
  let readStarted: (() => void) | undefined;
  const readStartedPromise = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const stream = createMultiAgentRunEventStream({
    getRun: async () => {
      readStarted?.();
      await readGate;
      return current;
    },
  });
  const updates: DeepRunStreamEvent[] = [];
  const unsubscribe = stream.subscribe("deep-run-events", (update) => {
    if (update.kind === "updated") {
      updates.push(...update.events);
    }
  });

  const replayPromise = stream.replay("deep-run-events", 0);
  await readStartedPromise;
  current = runRecord("running", [runEvent(1), runEvent(2)]);
  stream.recordSaved(current);
  releaseRead?.();

  const replay = await replayPromise;
  assert.ok(replay);
  const observed = [...replay.events, ...updates]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event, index, events) => index === 0 || events[index - 1]?.sequence !== event.sequence);
  assert.deepEqual(observed.map((event) => event.sequence), [1, 2]);

  unsubscribe();
  stream.close();
});

test("Multi-Agent event admission distinguishes durable, live-pending, and missing runs", async () => {
  let current: DeepRunRecord | undefined;
  const stream = createMultiAgentRunEventStream({
    getRun: async (runId) => runId === "durable-run" ? current : undefined,
    isRunLive: (runId) => runId === "pending-run",
  });

  assert.deepEqual(await stream.admit("missing-run"), { kind: "missing" });
  assert.deepEqual(await stream.admit("pending-run"), { kind: "live_pending" });

  current = runRecord("running", [runEvent(1)]);
  const durable = await stream.admit("durable-run", 0);
  assert.equal(durable.kind, "replay");
  if (durable.kind === "replay") {
    assert.deepEqual(durable.replay.events.map((event) => event.sequence), [1]);
    assert.equal(durable.replay.terminal, false);
  }
  stream.close();
});

test("Multi-Agent events emit ordered durable deltas and an explicit terminal notification", async () => {
  let current = runRecord("running", [runEvent(1)]);
  const stream = createMultiAgentRunEventStream({
    getRun: async () => current,
  });
  const updates: Array<{ readonly sequences: readonly number[]; readonly terminal: boolean }> = [];
  stream.subscribe("deep-run-events", (update) => {
    if (update.kind === "updated") {
      updates.push({
        sequences: update.events.map((event) => event.sequence),
        terminal: update.terminal,
      });
    }
  });

  stream.recordSaved(current);
  current = runRecord("completed", [runEvent(1), runEvent(2), runEvent(3)]);
  stream.recordSaved(current);

  assert.deepEqual(updates, [
    { sequences: [1], terminal: false },
    { sequences: [2, 3], terminal: true },
  ]);
  assert.deepEqual((await stream.replay("deep-run-events", 1))?.events.map((event) => event.sequence), [2, 3]);
  assert.equal((await stream.replay("deep-run-events", 3))?.terminal, true);
  stream.close();
});

test("Multi-Agent events publish only after the durable store accepts a write", async () => {
  let failWrite = true;
  const records = new Map<string, DeepRunRecord>();
  const store: DeepRunRecordStore = {
    async upsert(record) {
      if (failWrite) {
        throw new Error("fixture durable write failed");
      }
      records.set(record.run.runId, record);
      return record;
    },
    async get(runId) {
      return records.get(runId);
    },
    async list() {
      return [...records.values()];
    },
    async listByConversation(conversationId) {
      return [...records.values()].filter((record) => record.run.conversationId === conversationId);
    },
    async listByRootRun(rootRunId) {
      return [...records.values()].filter(
        (record) => (record.run.rootRunId ?? record.run.runId) === rootRunId,
      );
    },
    async delete(runId) {
      records.delete(runId);
    },
  };
  const stream = createMultiAgentRunEventStream({ getRun: (runId) => store.get(runId) });
  const observedStore = observeDeepRunRecordStore(store, stream);
  const updates: number[][] = [];
  stream.subscribe("deep-run-events", (update) => {
    if (update.kind === "updated") {
      updates.push(update.events.map((event) => event.sequence));
    }
  });
  const record = runRecord("running", [runEvent(1)]);

  await assert.rejects(observedStore.upsert(record), /fixture durable write failed/);
  assert.deepEqual(updates, []);
  failWrite = false;
  await observedStore.upsert(record);
  assert.deepEqual(updates, [[1]]);
  stream.close();
});

function runEvent(sequence: number): DeepRunStreamEvent {
  return {
    id: `deep-event-${sequence}`,
    runId: "deep-run-events",
    sequence,
    type: sequence === 3 ? "deep.conclusion.produced" : "deep.manager.decided",
    title: `Event ${sequence}`,
    summary: `Event ${sequence}`,
    status: sequence === 3 ? "completed" : "running",
    timestamp: `2026-07-17T00:00:0${sequence}.000Z`,
    refs: [],
    visibility: "public",
  };
}

function runRecord(
  status: DeepRunRecord["run"]["status"],
  eventSequence: readonly DeepRunStreamEvent[],
): DeepRunRecord {
  const updatedAt = eventSequence.at(-1)?.timestamp ?? "2026-07-17T00:00:00.000Z";
  return {
    run: {
      runId: "deep-run-events",
      conversationId: "deep-conversation-events",
      goal: "Verify Multi-Agent event delivery.",
      status,
      isolation: {
        kind: "deep_conversation",
        runKind: "underground",
        runMode: "deep",
      },
      startedAt: "2026-07-17T00:00:00.000Z",
      updatedAt,
      completedAt: status === "completed" ? updatedAt : undefined,
    },
    agentRunTree: {
      treeId: "deep-tree-events",
      rootRunId: "deep-run-events",
      rootAgentId: "deep-manager",
      rootSpec: {} as DeepRunRecord["agentRunTree"]["rootSpec"],
      childRuns: [],
      delegationDecisions: [],
      parentSyntheses: [],
      status: status === "completed" ? "completed" : "running",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt,
    },
    controlEvents: [],
    eventSequence,
    updatedAt,
  };
}
