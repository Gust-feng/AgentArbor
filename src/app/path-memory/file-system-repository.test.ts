import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PATH_MEMORY_SCHEMA_VERSION,
  PathMemoryFeatureError,
  pathMemoryIdForSource,
  type PathMemory,
} from "./contracts.js";
import { createFileSystemPathMemoryRepository } from "./file-system-repository.js";

async function tempRoot(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return root;
}

export function pathMemoryFixture(runId: string, overrides?: Partial<PathMemory>): PathMemory {
  const source = {
    feature: "ordinary" as const,
    runId,
    sourceRevision: 3,
    conversationId: `conversation-${runId}`,
    userTurnId: `${runId}-user`,
    assistantTurnId: `${runId}-assistant`,
    runCreatedAt: "2026-07-26T10:00:00.000Z",
    terminalAt: "2026-07-26T10:00:05.000Z",
  };
  return {
    id: pathMemoryIdForSource(source),
    source,
    scope: { workspaceRoot: "C:/workspace/demo", workspaceSelection: "default" },
    goal: { userRequest: "总结这个仓库", taskContextRefs: [`ordinary-run:${runId}`] },
    path: {
      executionStarted: true,
      toolSteps: [
        {
          ordinal: 1,
          toolFactId: `${runId}-tool-1`,
          toolName: "read_file",
          status: "completed",
          durationMs: 12,
          resultRef: `ordinary-run:${runId}#tool:${runId}-tool-1`,
        },
        {
          ordinal: 2,
          toolFactId: `${runId}-tool-2`,
          parentToolFactId: `${runId}-tool-1`,
          toolName: "run_command",
          status: "failed",
          durationMs: 30,
          resultRef: `ordinary-run:${runId}#tool:${runId}-tool-2`,
          error: { code: "exec_failed", message: "command exited 1" },
        },
      ],
    },
    outcome: { terminalStatus: "completed", answerRef: `ordinary-run:${runId}#answer` },
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${runId}`],
    capturedAt: "2026-07-26T10:00:06.000Z",
    ...overrides,
  };
}

test("first create commits atomically and is readable by source", async (t) => {
  const repository = createFileSystemPathMemoryRepository(await tempRoot(t));
  const memory = pathMemoryFixture("run-a");
  const created = await repository.create(memory);
  assert.equal(created.status, "created");
  assert.deepEqual(created.memory, memory);
  assert.deepEqual(await repository.get(memory.id), memory);
  assert.deepEqual(await repository.findBySource({ feature: "ordinary", runId: "run-a" }), memory);
});

test("repeated create with identical facts returns existing", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-b");
  await repository.create(memory);
  const second = await repository.create({ ...memory, capturedAt: "2026-07-26T11:00:00.000Z" });
  assert.equal(second.status, "existing");
  assert.equal(second.memory.capturedAt, memory.capturedAt);
  const files = await fs.readdir(path.join(root, "records"));
  assert.equal(files.filter((name) => name.endsWith(".json")).length, 1);
});

test("same source and revision with different facts is a conflict and never overwrites", async (t) => {
  const repository = createFileSystemPathMemoryRepository(await tempRoot(t));
  const memory = pathMemoryFixture("run-c");
  await repository.create(memory);
  const conflicting: PathMemory = {
    ...memory,
    goal: { ...memory.goal, userRequest: "a different request at the same revision" },
  };
  await assert.rejects(repository.create(conflicting), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_source_conflict");
    return true;
  });
  assert.deepEqual(await repository.get(memory.id), memory);
});

test("an older source revision never overwrites a newer record", async (t) => {
  const repository = createFileSystemPathMemoryRepository(await tempRoot(t));
  const memory = pathMemoryFixture("run-c-stale");
  await repository.create(memory);
  const stale: PathMemory = {
    ...memory,
    source: { ...memory.source, sourceRevision: memory.source.sourceRevision - 1 },
  };
  await assert.rejects(repository.create(stale), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_source_conflict");
    return true;
  });
  assert.deepEqual(await repository.get(memory.id), memory);
});

test("a higher source revision supersedes the stored record", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-c-revised");
  await repository.create(memory);
  const revised: PathMemory = {
    ...memory,
    source: { ...memory.source, sourceRevision: memory.source.sourceRevision + 1 },
    goal: { ...memory.goal, userRequest: "restated by the source" },
  };

  const result = await repository.create(revised);
  assert.equal(result.status, "replaced");
  assert.equal(
    result.status === "replaced" ? result.supersededRevision : undefined,
    memory.source.sourceRevision,
  );
  // Reconciliation must converge instead of failing on every restart.
  assert.deepEqual(await repository.create(revised), { status: "existing", memory: revised });
  assert.deepEqual(await repository.get(memory.id), revised);
  const files = await fs.readdir(path.join(root, "records"));
  assert.equal(files.filter((name) => name.endsWith(".json")).length, 1);
});

test("concurrent creates of one source converge to one record", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-d");
  const results = await Promise.all([
    repository.create(memory),
    repository.create({ ...memory, capturedAt: "2026-07-26T12:00:00.000Z" }),
    repository.create(memory),
  ]);
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  const files = await fs.readdir(path.join(root, "records"));
  assert.equal(files.filter((name) => name.endsWith(".json")).length, 1);
});

test("corrupted or unknown schema records report incompatible", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-e");
  await repository.create(memory);
  const recordFile = path.join(root, "records", `${encodeURIComponent(memory.id)}.json`);

  await fs.writeFile(recordFile, "{ not json", "utf8");
  await assert.rejects(repository.get(memory.id), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });

  await fs.writeFile(recordFile, JSON.stringify({ schemaVersion: "path-memory/v999", memory }), "utf8");
  await assert.rejects(repository.findBySource({ feature: "ordinary", runId: "run-e" }), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });
});

test("invalid memories are rejected before touching disk", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const base = pathMemoryFixture("run-f");

  const wrongId: PathMemory = { ...base, id: "path-memory:ordinary:other-run" };
  await assert.rejects(repository.create(wrongId), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });

  const orphanParent: PathMemory = {
    ...base,
    path: {
      executionStarted: true,
      toolSteps: [{
        ordinal: 1,
        toolFactId: "child",
        parentToolFactId: "missing-parent",
        toolName: "read_file",
        status: "completed",
        durationMs: 1,
        resultRef: "ordinary-run:run-f#tool:child",
      }],
    },
  };
  await assert.rejects(repository.create(orphanParent), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });

  const stepsWithoutExecution: PathMemory = {
    ...base,
    path: { ...base.path, executionStarted: false },
  };
  await assert.rejects(repository.create(stepsWithoutExecution));

  // A formal verification conclusion requires evidence refs.
  const verifiedWithoutEvidence = {
    ...base,
    verification: { status: "verified", evidenceRefs: [] },
  } as PathMemory;
  await assert.rejects(repository.create(verifiedWithoutEvidence), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });

  assert.equal(await repository.get(base.id), undefined);
});

test("list filters by conversation, workspace and terminal status with limit", async (t) => {
  const repository = createFileSystemPathMemoryRepository(await tempRoot(t));
  const first = pathMemoryFixture("run-g1");
  const second = pathMemoryFixture("run-g2", {
    source: { ...pathMemoryFixture("run-g2").source, terminalAt: "2026-07-26T10:10:00.000Z" },
    outcome: { terminalStatus: "cancelled", reason: "user cancelled" },
  });
  const third = pathMemoryFixture("run-g3", {
    scope: { workspaceRoot: "C:/workspace/other", workspaceSelection: "explicit" },
  });
  await repository.create(first);
  await repository.create(second);
  await repository.create(third);

  const all = await repository.list();
  assert.equal(all.length, 3);
  assert.equal(all[0]?.source.runId, "run-g2");

  assert.deepEqual((await repository.list({ conversationId: "conversation-run-g1" })).map((memory) => memory.source.runId), ["run-g1"]);
  assert.deepEqual((await repository.list({ workspaceRoot: "C:/workspace/other" })).map((memory) => memory.source.runId), ["run-g3"]);
  assert.deepEqual((await repository.list({ terminalStatus: "cancelled" })).map((memory) => memory.source.runId), ["run-g2"]);
  assert.equal((await repository.list({ limit: 2 })).length, 2);
});

test("a rebuilt instance reads the same records", async (t) => {
  const root = await tempRoot(t);
  const memory = pathMemoryFixture("run-h");
  await createFileSystemPathMemoryRepository(root).create(memory);

  const rebuilt = createFileSystemPathMemoryRepository(root);
  assert.deepEqual(await rebuilt.get(memory.id), memory);
  assert.deepEqual(await rebuilt.findBySource({ feature: "ordinary", runId: "run-h" }), memory);
  assert.equal((await rebuilt.list()).length, 1);
});

test("delete removes the record and reports absence honestly", async (t) => {
  const repository = createFileSystemPathMemoryRepository(await tempRoot(t));
  const memory = pathMemoryFixture("run-i");
  await repository.create(memory);
  assert.equal(await repository.delete(memory.id, "2026-07-26T12:00:00.000Z"), true);
  assert.equal(await repository.get(memory.id), undefined);
  assert.equal(await repository.delete(memory.id, "2026-07-26T12:01:00.000Z"), false);
});

test("a deleted memory stays deleted for a rebuilt repository and re-capture", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-k");
  await repository.create(memory);
  assert.equal(await repository.delete(memory.id, "2026-07-26T12:00:00.000Z"), true);

  // Same-process re-capture is suppressed, not resurrected.
  const suppressed = await repository.create(memory);
  assert.deepEqual(suppressed, {
    status: "suppressed",
    memoryId: memory.id,
    deletedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(await repository.get(memory.id), undefined);

  // A rebuilt instance (restart) must honor the tombstone during reconciliation.
  const rebuilt = createFileSystemPathMemoryRepository(root);
  const afterRestart = await rebuilt.create(memory);
  assert.equal(afterRestart.status, "suppressed");
  assert.equal(await rebuilt.get(memory.id), undefined);
  assert.equal(await rebuilt.findBySource({ feature: "ordinary", runId: "run-k" }), undefined);
  assert.equal((await rebuilt.list()).length, 0);

  // A higher source revision does not bypass the tombstone either.
  const revised: PathMemory = {
    ...memory,
    source: { ...memory.source, sourceRevision: memory.source.sourceRevision + 1 },
  };
  assert.equal((await rebuilt.create(revised)).status, "suppressed");
});

test("a corrupted or unknown-version tombstone fails loudly instead of resurrecting", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-l");
  await repository.create(memory);
  await repository.delete(memory.id, "2026-07-26T12:00:00.000Z");
  const tombstoneFile = path.join(root, "deletions", `${encodeURIComponent(memory.id)}.json`);

  await fs.writeFile(tombstoneFile, "{ not json", "utf8");
  await assert.rejects(repository.create(memory), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });
  await assert.rejects(repository.get(memory.id), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });

  await fs.writeFile(
    tombstoneFile,
    JSON.stringify({ schemaVersion: "path-memory-deletion/v999", deletion: { memoryId: memory.id, deletedAt: "2026-07-26T12:00:00.000Z" } }),
    "utf8",
  );
  await assert.rejects(repository.create(memory), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_snapshot_incompatible");
    return true;
  });
});

test("a surviving record file behind a tombstone reads as absent", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-m");
  await repository.create(memory);
  await repository.delete(memory.id, "2026-07-26T12:00:00.000Z");
  // Simulate a crash between tombstone write and record removal.
  await createFileSystemPathMemoryRepository(await tempRoot(t)).create(memory);
  const recordFile = path.join(root, "records", `${encodeURIComponent(memory.id)}.json`);
  await fs.mkdir(path.dirname(recordFile), { recursive: true });
  await fs.writeFile(recordFile, JSON.stringify({ schemaVersion: PATH_MEMORY_SCHEMA_VERSION, memory }, null, 2), "utf8");

  assert.equal(await repository.get(memory.id), undefined);
  assert.equal((await repository.list()).length, 0);
});

test("stored document uses the v1 schema envelope without tool bodies", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemPathMemoryRepository(root);
  const memory = pathMemoryFixture("run-j");
  await repository.create(memory);
  const raw = JSON.parse(
    await fs.readFile(path.join(root, "records", `${encodeURIComponent(memory.id)}.json`), "utf8"),
  ) as { schemaVersion: string; memory: { path: { toolSteps: Record<string, unknown>[] } } };
  assert.equal(raw.schemaVersion, PATH_MEMORY_SCHEMA_VERSION);
  for (const step of raw.memory.path.toolSteps) {
    assert.equal("input" in step, false);
    assert.equal("output" in step, false);
  }
});
