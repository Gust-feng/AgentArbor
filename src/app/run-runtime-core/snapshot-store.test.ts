import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import {
  createInMemoryRunSnapshotStore,
  type RunEnvelope,
  RunSnapshotStoreError,
  type RunSnapshotCodec,
} from "./snapshot-store.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-storage/run-snapshot-store.js";

type TestSnapshot = {
  readonly run: {
    readonly runId: string;
    readonly status: string;
    readonly updatedAt: string;
  };
  readonly payload: string;
};

const testSnapshotSchema = z.object({
  run: z.object({
    runId: z.string().min(1),
    status: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  payload: z.string(),
}).strict();

const testSnapshotCodec: RunSnapshotCodec<TestSnapshot> = {
  schemaVersion: "test-run-snapshot/v1",
  decode: (value) => testSnapshotSchema.parse(value),
};

test("InMemoryRunSnapshotStore sorts snapshots by envelope.updatedAt desc", async () => {
  const store = createInMemoryRunSnapshotStore<TestSnapshot>({
    getEnvelope: snapshotEnvelope,
    codec: testSnapshotCodec,
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
      codec: testSnapshotCodec,
    });
    await store.upsert(snapshot("run:one", "running", "2026-06-01T00:00:01.000Z", "older"));
    await store.upsert(snapshot("run/two", "failed", "2026-06-01T00:00:05.000Z", "newer"));

    const listed = await store.list();
    assert.deepEqual(listed.map((item: TestSnapshot) => item.run.runId), ["run/two", "run:one"]);

    const encodedDirectory = path.join(root, encodeURIComponent("run/two"), "record.json");
    const content = JSON.parse(await fs.readFile(encodedDirectory, "utf8")) as {
      readonly schemaVersion: string;
      readonly snapshot: TestSnapshot;
    };
    assert.equal(content.schemaVersion, testSnapshotCodec.schemaVersion);
    assert.equal(content.snapshot.payload, "newer");
  } finally {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

test("FileSystemRunSnapshotStore rejects unversioned, malformed and mis-owned snapshot documents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-snapshot-validation-"));
  try {
    const store = createFileSystemRunSnapshotStore<TestSnapshot>({
      rootDir: root,
      getEnvelope: snapshotEnvelope,
      codec: testSnapshotCodec,
    });
    const committed = snapshot("run-owned", "running", "2026-06-01T00:00:01.000Z", "committed");
    await store.upsert(committed);
    const filePath = path.join(root, "run-owned", "record.json");

    await fs.writeFile(filePath, JSON.stringify(committed), "utf8");
    await assertStoreRejects(store.get("run-owned"), "snapshot_incompatible");

    await fs.writeFile(filePath, "{invalid-json", "utf8");
    await assertStoreRejects(store.get("run-owned"), "snapshot_incompatible");

    await fs.writeFile(filePath, JSON.stringify({
      schemaVersion: "test-run-snapshot/v0",
      snapshot: committed,
    }), "utf8");
    await assertStoreRejects(store.get("run-owned"), "snapshot_schema_version_mismatch");

    await fs.writeFile(filePath, JSON.stringify({
      schemaVersion: testSnapshotCodec.schemaVersion,
      snapshot: { ...committed, run: { ...committed.run, runId: "run-foreign" } },
    }), "utf8");
    await assertStoreRejects(store.get("run-owned"), "snapshot_identity_mismatch");

    await fs.writeFile(filePath, JSON.stringify({
      schemaVersion: testSnapshotCodec.schemaVersion,
      snapshot: { ...committed, payload: 42 },
    }), "utf8");
    await assertStoreRejects(store.get("run-owned"), "snapshot_incompatible");
  } finally {
    await removeDirectory(root);
  }
});

test("FileSystemRunSnapshotStore validates, serializes same-run mutations and drains atomic-write artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-snapshot-fifo-"));
  try {
    const store = createFileSystemRunSnapshotStore<TestSnapshot>({
      rootDir: root,
      getEnvelope: snapshotEnvelope,
      codec: testSnapshotCodec,
    });
    const first = snapshot("run-fifo", "running", "2026-06-01T00:00:01.000Z", "first");
    await store.upsert(first);
    await assertStoreRejects(
      store.upsert({ ...first, payload: 42 } as unknown as TestSnapshot),
      "snapshot_incompatible",
    );
    assert.equal((await store.get("run-fifo"))?.payload, "first", "invalid state must not replace the commit");

    const older = snapshot("run-fifo", "running", "2026-06-01T00:00:02.000Z", "x".repeat(250_000));
    const newest = snapshot("run-fifo", "completed", "2026-06-01T00:00:03.000Z", "newest");
    await Promise.all([
      store.upsert(older),
      store.delete("run-fifo"),
      store.upsert(newest),
    ]);
    assert.deepEqual(await store.get("run-fifo"), newest);
    assert.deepEqual(
      (await fs.readdir(root)).sort(),
      ["manifest.json", "run-fifo"],
      "completed operations must not leave a root temp directory",
    );
    assert.deepEqual(
      await fs.readdir(path.join(root, "run-fifo")),
      ["record.json"],
      "completed run mutations must not leave a run temp directory",
    );
  } finally {
    await removeDirectory(root);
  }
});

test("FileSystemRunSnapshotStore rebuilds a broken disposable manifest from committed snapshots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-snapshot-manifest-"));
  try {
    await fs.mkdir(path.join(root, "manifest.json"), { recursive: true });
    const store = createFileSystemRunSnapshotStore<TestSnapshot>({
      rootDir: root,
      getEnvelope: snapshotEnvelope,
      codec: testSnapshotCodec,
    });
    const committed = snapshot("run-manifest", "completed", "2026-06-01T00:00:01.000Z", "durable");

    await store.upsert(committed);

    assert.deepEqual(await store.get("run-manifest"), committed);
    assert.deepEqual(await store.list(), [committed]);
    await fs.rm(path.join(root, "manifest.json"), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.deepEqual(await store.list(), [committed]);
  } finally {
    await removeDirectory(root);
  }
});

test("FileSystemRunSnapshotStore encodes path-like run ids without escaping its root", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-snapshot-path-"));
  const root = path.join(parent, "store");
  const sibling = path.join(parent, "sibling.txt");
  try {
    await fs.writeFile(sibling, "keep", "utf8");
    const store = createFileSystemRunSnapshotStore<TestSnapshot>({
      rootDir: root,
      getEnvelope: snapshotEnvelope,
      codec: testSnapshotCodec,
    });
    const pathLike = snapshot("..", "completed", "2026-06-01T00:00:01.000Z", "safe");
    await store.upsert(pathLike);
    assert.deepEqual(await store.get(".."), pathLike);
    await store.delete("..");
    assert.equal(await fs.readFile(sibling, "utf8"), "keep");
    await assertStoreRejects(store.get(""), "invalid_run_id");
  } finally {
    await removeDirectory(parent);
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

async function assertStoreRejects(
  promise: Promise<unknown>,
  code: RunSnapshotStoreError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof RunSnapshotStoreError && error.code === code);
}

function removeDirectory(directory: string): Promise<void> {
  return fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
