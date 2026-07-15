import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createInMemoryRunSnapshotStore,
  type RunEnvelope,
} from "./snapshot-store.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-database/run-snapshot-store.js";

type TestSnapshot = {
  readonly run: {
    readonly runId: string;
    readonly status: string;
    readonly updatedAt: string;
  };
  readonly payload: string;
};

test("InMemoryRunSnapshotStore sorts snapshots by envelope.updatedAt desc", async () => {
  const store = createInMemoryRunSnapshotStore<TestSnapshot>({
    getEnvelope: snapshotEnvelope,
  });
  await store.upsert(snapshot("run-1", "running", "2026-06-01T00:00:01.000Z", "older"));
  await store.upsert(snapshot("run-2", "completed", "2026-06-01T00:00:03.000Z", "newer"));

  const listed = await store.list();

  assert.deepEqual(listed.map((item: TestSnapshot) => item.run.runId), ["run-2", "run-1"]);
  const restored = await store.get("run-2");
  assert.equal(restored?.payload, "newer");
});

test("FileSystemRunSnapshotStore persists under encoded run directory and lists by recency", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-snapshot-store-"));
  try {
    const store = createFileSystemRunSnapshotStore<TestSnapshot>({
      rootDir: root,
      getEnvelope: snapshotEnvelope,
    });
    await store.upsert(snapshot("run:one", "running", "2026-06-01T00:00:01.000Z", "older"));
    await store.upsert(snapshot("run/two", "failed", "2026-06-01T00:00:05.000Z", "newer"));

    const listed = await store.list();
    assert.deepEqual(listed.map((item: TestSnapshot) => item.run.runId), ["run/two", "run:one"]);

    const encodedDirectory = path.join(root, encodeURIComponent("run/two"), "record.json");
    const content = await fs.readFile(encodedDirectory, "utf8");
    assert.equal(content.includes("newer"), true);
  } finally {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

function snapshotEnvelope(snapshot: TestSnapshot): RunEnvelope {
  return {
    runId: snapshot.run.runId,
    updatedAt: snapshot.run.updatedAt,
    status: snapshot.run.status,
  };
}

function snapshot(runId: string, status: string, updatedAt: string, payload: string): TestSnapshot {
  return {
    run: { runId, status, updatedAt },
    payload,
  };
}
