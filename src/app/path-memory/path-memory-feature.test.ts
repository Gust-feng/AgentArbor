import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PathMemoryFeatureError,
  pathMemoryIdForSource,
  type PathMemory,
  type PathMemoryCaptureInput,
  type PathMemoryCaptureResult,
  type PathMemoryEvent,
  type PathMemoryRepository,
} from "./contracts.js";
import { createFileSystemPathMemoryRepository } from "./file-system-repository.js";
import { createPathMemoryFeature } from "./path-memory-feature.js";

async function tempRepository(t: test.TestContext): Promise<PathMemoryRepository> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-memory-feature-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return createFileSystemPathMemoryRepository(root);
}

function captureInputFixture(runId: string): PathMemoryCaptureInput {
  return {
    source: {
      feature: "ordinary",
      runId,
      sourceRevision: 2,
      conversationId: `conversation-${runId}`,
      userTurnId: `${runId}-user`,
      assistantTurnId: `${runId}-assistant`,
      runCreatedAt: "2026-07-26T09:00:00.000Z",
      terminalAt: "2026-07-26T09:00:04.000Z",
    },
    scope: { workspaceRoot: "C:/workspace/demo", workspaceSelection: "default" },
    goal: { userRequest: "检查构建", taskContextRefs: [] },
    path: {
      executionStarted: true,
      toolSteps: [{
        ordinal: 1,
        toolFactId: `${runId}-tool-1`,
        toolName: "run_command",
        status: "completed",
        durationMs: 40,
        resultRef: `ordinary-run:${runId}#tool:${runId}-tool-1`,
      }],
    },
    outcome: { terminalStatus: "completed", answerRef: `ordinary-run:${runId}#answer` },
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${runId}`],
  };
}

function storedMemory(result: PathMemoryCaptureResult): PathMemory {
  assert.notEqual(result.status, "suppressed");
  if (result.status === "suppressed") throw new Error("unexpected suppressed capture");
  return result.memory;
}

test("capture assigns deterministic identity and publishes one event", async (t) => {
  const feature = createPathMemoryFeature({
    repository: await tempRepository(t),
    now: () => new Date("2026-07-26T09:00:05.000Z"),
  });
  const events: PathMemoryEvent[] = [];
  feature.events.subscribe((event) => events.push(event));

  const created = await feature.commands.capture(captureInputFixture("run-1"));
  assert.equal(created.status, "created");
  assert.equal(storedMemory(created).id, "path-memory:ordinary:run-1");
  assert.equal(storedMemory(created).capturedAt, "2026-07-26T09:00:05.000Z");

  const repeated = await feature.commands.capture(captureInputFixture("run-1"));
  assert.equal(repeated.status, "existing");
  assert.deepEqual(storedMemory(repeated), storedMemory(created));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "path_memory.captured");
  await feature.release();
});

test("capture surfaces source conflicts without overwriting", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  await feature.commands.capture(captureInputFixture("run-2"));

  const conflicting = captureInputFixture("run-2");
  await assert.rejects(
    feature.commands.capture({
      ...conflicting,
      goal: { ...conflicting.goal, userRequest: "different facts at the same revision" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PathMemoryFeatureError);
      assert.equal(error.code, "path_memory_source_conflict");
      return true;
    },
  );
  const stored = await feature.queries.findBySource({ feature: "ordinary", runId: "run-2" });
  assert.equal(stored?.goal.userRequest, captureInputFixture("run-2").goal.userRequest);
  await feature.release();
});

test("a revised source supersedes the record and publishes one replaced event", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  const events: PathMemoryEvent[] = [];
  feature.events.subscribe((event) => events.push(event));

  const initial = captureInputFixture("run-2b");
  await feature.commands.capture(initial);
  const result = await feature.commands.capture({
    ...initial,
    source: { ...initial.source, sourceRevision: initial.source.sourceRevision + 1 },
    goal: { ...initial.goal, userRequest: "restated by the source" },
  });

  assert.equal(result.status, "replaced");
  const stored = await feature.queries.findBySource({ feature: "ordinary", runId: "run-2b" });
  assert.equal(stored?.goal.userRequest, "restated by the source");
  assert.deepEqual(events.map((event) => event.type), ["path_memory.captured", "path_memory.replaced"]);
  assert.equal(
    events[1]?.type === "path_memory.replaced" ? events[1].supersededRevision : undefined,
    initial.source.sourceRevision,
  );
  await feature.release();
});

test("queries expose get, findBySource and filtered list", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  await feature.commands.capture(captureInputFixture("run-3a"));
  await feature.commands.capture(captureInputFixture("run-3b"));

  const memory = await feature.queries.get("path-memory:ordinary:run-3a");
  assert.equal(memory?.source.runId, "run-3a");
  assert.equal((await feature.queries.list()).length, 2);
  assert.deepEqual(
    (await feature.queries.list({ conversationId: "conversation-run-3b" })).map((entry) => entry.source.runId),
    ["run-3b"],
  );
  await feature.release();
});

test("search combines repository filtering with deterministic scoring", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  const base = captureInputFixture("run-s1");
  await feature.commands.capture({
    ...base,
    goal: { userRequest: "检查构建产物", taskContextRefs: [] },
  });
  const other = captureInputFixture("run-s2");
  await feature.commands.capture({
    ...other,
    scope: { workspaceRoot: "C:/workspace/other", workspaceSelection: "default" },
    goal: { userRequest: "检查构建日志", taskContextRefs: [] },
  });
  const failed = captureInputFixture("run-s3");
  await feature.commands.capture({
    ...failed,
    goal: { userRequest: "部署面板", taskContextRefs: [] },
    outcome: { terminalStatus: "failed", error: { code: "run_failed", message: "boom" } },
  });
  const unrelated = captureInputFixture("run-s4");
  await feature.commands.capture({
    ...unrelated,
    goal: { userRequest: "整理文档", taskContextRefs: [] },
  });

  const all = await feature.queries.search({ text: "构建" });
  assert.deepEqual(
    all.map((match) => match.memory.source.runId),
    ["run-s1", "run-s2"],
  );
  assert.equal(all[0]?.score, 3);
  assert.deepEqual(all[0]?.matchedFields, ["userRequest"]);

  const scoped = await feature.queries.search({ text: "构建", workspaceRoot: "C:/workspace/other" });
  assert.deepEqual(scoped.map((match) => match.memory.source.runId), ["run-s2"]);

  const byStatus = await feature.queries.search({ text: "部署", terminalStatus: "failed" });
  assert.deepEqual(byStatus.map((match) => match.memory.source.runId), ["run-s3"]);

  assert.deepEqual(await feature.queries.search({ text: "不存在的词" }), []);
  await feature.release();
});

test("search rejects after release", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  await feature.release();
  assert.throws(() => feature.queries.search({ text: "构建" }), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_feature_released");
    return true;
  });
});

test("delete removes the record, publishes once and reports missing ids", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  const created = await feature.commands.capture(captureInputFixture("run-4"));
  const memoryId = storedMemory(created).id;
  const events: PathMemoryEvent[] = [];
  feature.events.subscribe((event) => events.push(event));

  await feature.commands.delete(memoryId);
  assert.equal(await feature.queries.get(memoryId), undefined);
  assert.deepEqual(events, [{ type: "path_memory.deleted", memoryId }]);

  await assert.rejects(feature.commands.delete(memoryId), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_not_found");
    return true;
  });
  assert.equal(events.length, 1);
  await feature.release();
});

test("re-capture after delete is suppressed and publishes no event", async (t) => {
  const feature = createPathMemoryFeature({
    repository: await tempRepository(t),
    now: () => new Date("2026-07-26T09:30:00.000Z"),
  });
  const created = await feature.commands.capture(captureInputFixture("run-4b"));
  const memoryId = storedMemory(created).id;
  await feature.commands.delete(memoryId);

  const events: PathMemoryEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const recaptured = await feature.commands.capture(captureInputFixture("run-4b"));
  assert.deepEqual(recaptured, {
    status: "suppressed",
    memoryId,
    deletedAt: "2026-07-26T09:30:00.000Z",
  });
  assert.equal(await feature.queries.get(memoryId), undefined);
  assert.deepEqual(events, []);
  await feature.release();
});

test("listener failures never affect the committed capture", async (t) => {
  const feature = createPathMemoryFeature({ repository: await tempRepository(t) });
  feature.events.subscribe(() => {
    throw new Error("listener exploded");
  });
  const created = await feature.commands.capture(captureInputFixture("run-5"));
  assert.equal(created.status, "created");
  assert.notEqual(await feature.queries.get(storedMemory(created).id), undefined);
  await feature.release();
});

test("release drains accepted work and rejects new commands", async (t) => {
  const repository = await tempRepository(t);
  let releaseGate: () => void = () => undefined;
  const gated = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const slowRepository: PathMemoryRepository = {
    ...repository,
    async create(memory: PathMemory) {
      await gated;
      return repository.create(memory);
    },
  };
  const feature = createPathMemoryFeature({ repository: slowRepository });
  const inFlight = feature.commands.capture(captureInputFixture("run-6"));

  const released = feature.release();
  releaseGate();
  await released;

  assert.equal((await inFlight).status, "created");
  assert.notEqual(await repository.findBySource({ feature: "ordinary", runId: "run-6" }), undefined);

  assert.throws(() => feature.commands.capture(captureInputFixture("run-7")), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_feature_released");
    return true;
  });
  assert.throws(() => feature.queries.get("path-memory:ordinary:run-6"), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_feature_released");
    return true;
  });
});

test("repository failures surface as precise feature errors", async (t) => {
  const repository = await tempRepository(t);
  const failing: PathMemoryRepository = {
    ...repository,
    create() {
      return Promise.reject(new PathMemoryFeatureError("path_memory_repository_failure", "disk full"));
    },
  };
  const feature = createPathMemoryFeature({ repository: failing });
  await assert.rejects(feature.commands.capture(captureInputFixture("run-8")), (error: unknown) => {
    assert.ok(error instanceof PathMemoryFeatureError);
    assert.equal(error.code, "path_memory_repository_failure");
    return true;
  });
  assert.equal(await repository.findBySource({ feature: "ordinary", runId: "run-8" }), undefined);
  await feature.release();
});

test("deterministic ids are stable across capture and lookup", () => {
  assert.equal(
    pathMemoryIdForSource({ feature: "ordinary", runId: "run x/9" }),
    "path-memory:ordinary:run x/9",
  );
});
