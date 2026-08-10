import test from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryPathDependencyRepository,
  createPathDependencyFeature,
  PathDependencyFeatureError,
  type PathDependencyEvent,
  type PathDependencyRepository,
} from "./index.js";

const globalOwner = { kind: "global" } as const;
const spaceOwner = { kind: "space", id: "space-1" } as const;
const workspaceOwner = { kind: "workspace", id: "workspace-1" } as const;

function createFeature() {
  return createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    now: (() => {
      let index = 0;
      return () => `2026-08-10T00:00:0${index++}.000Z`;
    })(),
    idFactory: (() => {
      let index = 0;
      return () => `path-dependency:test-${index++}`;
    })(),
  });
}

function saveInput(owner: typeof globalOwner | typeof spaceOwner | typeof workspaceOwner, overrides: Record<string, unknown> = {}) {
  return {
    owner,
    title: "下载短视频的稳定方法",
    methodology: "先确认来源，再选择可验证的下载入口；完成后检查文件可播放。",
    tags: ["download", "video"],
    ...overrides,
  };
}

test("path dependency saves methodology, revisions with CAS, and emits facts", async () => {
  const feature = createFeature();
  const events: PathDependencyEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const created = await feature.commands.save(saveInput(spaceOwner));
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  assert.equal(created.dependency.revision, 1);
  assert.equal(created.dependency.owner.kind, "space");
  assert.equal(events[0]?.type, "path_dependency.created");

  const conflict = await feature.commands.save(saveInput(spaceOwner, {
    memoryId: created.dependency.id,
    title: "陈旧更新",
    expectedRevision: 2,
  }));
  assert.equal(conflict.status, "conflict");

  const updated = await feature.commands.save(saveInput(spaceOwner, {
    memoryId: created.dependency.id,
    methodology: "更新后的方法论：保留验证条件和失败边界。",
    expectedRevision: 1,
  }));
  assert.equal(updated.status, "updated");
  if (updated.status === "updated") assert.equal(updated.dependency.revision, 2);
  await feature.release();
});

test("directory, search, and owner filters never cross scopes", async () => {
  const feature = createFeature();
  await feature.commands.save(saveInput(globalOwner, { title: "全局下载偏好" }));
  await feature.commands.save(saveInput(spaceOwner, { title: "Space 下载流程" }));
  await feature.commands.save(saveInput(workspaceOwner, { title: "仓库下载流程" }));

  const directory = await feature.queries.directory({ owners: [globalOwner, spaceOwner] });
  assert.deepEqual(directory.map((entry) => entry.title).sort(), ["Space 下载流程", "全局下载偏好"]);
  const matches = await feature.queries.search({ text: "下载", owners: [spaceOwner] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.dependency.owner.kind, "space");
  await feature.release();
});

test("delete requires the current revision and removes the only body", async () => {
  const feature = createFeature();
  const created = await feature.commands.save(saveInput(globalOwner));
  if (created.status !== "created") throw new Error("fixture did not create");
  await assert.rejects(
    feature.commands.delete({ memoryId: created.dependency.id, expectedRevision: 2 }),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_revision_conflict",
  );
  await feature.commands.delete({ memoryId: created.dependency.id, expectedRevision: 1 });
  assert.equal(await feature.queries.get(created.dependency.id), undefined);
  await feature.release();
});

test("owner deletion removes only that owner's path dependencies", async () => {
  const feature = createFeature();
  await feature.commands.save(saveInput(globalOwner, { title: "全局" }));
  await feature.commands.save(saveInput(spaceOwner, { title: "空间一" }));
  await feature.commands.save(saveInput(spaceOwner, { title: "空间二" }));
  await feature.commands.save(saveInput(workspaceOwner, { title: "工作区" }));
  assert.equal(await feature.commands.deleteByOwner(spaceOwner), 2);
  assert.equal((await feature.queries.list({ owners: [spaceOwner] })).length, 0);
  assert.equal((await feature.queries.list({ owners: [globalOwner] })).length, 1);
  assert.equal((await feature.queries.list({ owners: [workspaceOwner] })).length, 1);
  await feature.release();
});

test("public commands reject a malformed owner rather than creating an unscoped record", async () => {
  const feature = createFeature();
  await assert.rejects(
    feature.commands.save(saveInput({ kind: "space", id: "space-1" }, {
      owner: { kind: "workspace", id: "" },
    }) as never),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_invalid_input",
  );
  await assert.rejects(
    feature.commands.deleteByOwner({ kind: "global" } as never),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_invalid_input",
  );
  await feature.release();
});

test("owner deletion waits for an admitted save and rejects late owner saves", async () => {
  const inner = createInMemoryPathDependencyRepository();
  let releaseOwnerSave!: () => void;
  let markOwnerSaveStarted!: () => void;
  const ownerSaveStarted = new Promise<void>((resolve) => { markOwnerSaveStarted = resolve; });
  const ownerSaveGate = new Promise<void>((resolve) => { releaseOwnerSave = resolve; });
  let holdNextOwnerSave = true;
  const repository: PathDependencyRepository = {
    async save(input) {
      if (holdNextOwnerSave && input.dependency.owner.kind === "space") {
        holdNextOwnerSave = false;
        markOwnerSaveStarted();
        await ownerSaveGate;
      }
      return inner.save(input);
    },
    get: (memoryId) => inner.get(memoryId),
    list: (query) => inner.list(query),
    delete: (input) => inner.delete(input),
  };
  let nextId = 0;
  const feature = createPathDependencyFeature({
    repository,
    idFactory: () => `path-dependency:owner-race-${nextId++}`,
    now: () => "2026-08-10T00:00:00.000Z",
  });

  const admitted = feature.commands.save(saveInput(spaceOwner));
  await ownerSaveStarted;
  const deleting = feature.commands.deleteByOwner(spaceOwner);
  await assert.rejects(
    () => feature.commands.save(saveInput(spaceOwner, { title: "晚到的 owner 方法" })),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_owner_deleted",
  );

  let deletionFinished = false;
  void deleting.finally(() => { deletionFinished = true; });
  await Promise.resolve();
  assert.equal(deletionFinished, false, "owner deletion must wait for a save admitted before its tombstone");

  const global = await feature.commands.save(saveInput(globalOwner, { title: "删除期间的全局方法" }));
  assert.equal(global.status, "created");

  releaseOwnerSave();
  const admittedResult = await admitted;
  assert.equal(admittedResult.status, "created");
  assert.equal(await deleting, 1);
  assert.equal((await feature.queries.list({ owners: [spaceOwner] })).length, 0);
  assert.equal((await feature.queries.list({ owners: [globalOwner] })).length, 1);
  await feature.release();
});

test("memoryId updates require expectedRevision and opaque ids cannot escape the record key", async () => {
  const feature = createFeature();
  const created = await feature.commands.save(saveInput(spaceOwner));
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  await assert.rejects(
    () => feature.commands.save(saveInput(spaceOwner, { memoryId: created.dependency.id })),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_revision_conflict",
  );
  for (const memoryId of ["../bad", "a/b", "a\\b", ".", "..", "bad\u0000id"]) {
    await assert.rejects(
      () => feature.commands.save(saveInput(spaceOwner, { memoryId, expectedRevision: 1 })),
      (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_invalid_input",
      `malformed memory id should be rejected: ${JSON.stringify(memoryId)}`,
    );
  }
  await feature.release();
});

test("source provenance rejects malformed collections at the feature boundary", async () => {
  const feature = createFeature();
  await assert.rejects(
    () => feature.commands.save(saveInput(globalOwner, { sourceRunRefs: "not-an-array" })),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_invalid_input",
  );
  await feature.release();
});

test("a deleted owner memory id cannot be recreated while global memory remains available", async () => {
  let nextId = 0;
  const feature = createPathDependencyFeature({
    repository: createInMemoryPathDependencyRepository(),
    idFactory: () => `path-dependency:deleted-owner-${nextId++}`,
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const created = await feature.commands.save(saveInput(workspaceOwner));
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  await feature.commands.deleteByOwner(workspaceOwner);

  await assert.rejects(
    () => feature.commands.save(saveInput(workspaceOwner, {
      memoryId: created.dependency.id,
      expectedRevision: created.dependency.revision,
      title: "不应重建",
    })),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_owner_deleted",
  );
  const global = await feature.commands.save(saveInput(globalOwner, { title: "全局仍可用" }));
  assert.equal(global.status, "created");
  assert.equal(await feature.queries.get(created.dependency.id), undefined);
  await feature.release();
});

test("a failed owner-memory deletion remains denied and can be completed by retry", async () => {
  const inner = createInMemoryPathDependencyRepository();
  let failDelete = true;
  const repository: PathDependencyRepository = {
    save: (input) => inner.save(input),
    get: (memoryId) => inner.get(memoryId),
    list: (query) => inner.list(query),
    async delete(input) {
      if (failDelete) {
        throw new PathDependencyFeatureError("path_dependency_repository_failure", "simulated owner-memory deletion failure");
      }
      return inner.delete(input);
    },
  };
  const feature = createPathDependencyFeature({
    repository,
    idFactory: () => "path-dependency:delete-retry",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const created = await feature.commands.save(saveInput(spaceOwner));
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  await assert.rejects(
    () => feature.commands.deleteByOwner(spaceOwner),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_repository_failure",
  );
  assert.notEqual(await feature.queries.get(created.dependency.id), undefined);
  await assert.rejects(
    () => feature.commands.save(saveInput(spaceOwner, {
      memoryId: created.dependency.id,
      expectedRevision: created.dependency.revision,
      title: "不应在失败后重建",
    })),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_owner_deleted",
  );

  failDelete = false;
  assert.equal(await feature.commands.deleteByOwner(spaceOwner), 1);
  assert.equal(await feature.queries.get(created.dependency.id), undefined);
  await feature.release();
});
