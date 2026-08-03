import assert from "node:assert/strict";
import test from "node:test";

import { createSpaceFeature } from "./space-feature.js";
import { SPACE_TREE_SCHEMA_VERSION, SpaceFeatureError, type SpaceTreeSnapshot } from "./contracts.js";
import type {
  SpaceReferenceDeletionJournalRecord,
  SpaceReferenceDeletionJournalStore,
} from "./file-system-reference-deletion-journal.js";
import type { SpaceReferenceDeletionFilePort } from "./space-reference-deletion.js";

test("Space stores only top-level roots and counts filesystem folder roots", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    now: () => "2026-07-30T00:00:00.000Z",
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const managed = await feature.commands.addReference({ spaceId: space.id, title: "内部资料", reference: { kind: "managed_folder", path: "C:/managed" } });
  await feature.commands.addReference({ spaceId: space.id, title: "外部工作区", reference: { kind: "workspace_folder", path: "C:/workspace" } });
  assert.deepEqual((await feature.queries.getTree(space.id))?.entries.map((entry) => entry.item.id), ["id-3", managed.id]);
  assert.equal((await feature.queries.list())[0]?.folderCount, 2);
  assert.equal("folders" in snapshot, false);
});

test("Space moves an asset folder with its complete subtree between spaces", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({ repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } }, idFactory: () => `id-${++id}` });
  const source = await feature.commands.createSpace({ title: "来源" });
  const destination = await feature.commands.createSpace({ title: "目标" });
  const folder = await feature.commands.addReference({ spaceId: source.id, title: "资料", reference: { kind: "asset_folder" } });
  const child = await feature.commands.addReference({ spaceId: source.id, parentId: folder.id, title: "子目录", reference: { kind: "asset_folder" } });
  const grandchild = await feature.commands.addReference({ spaceId: source.id, parentId: child.id, title: "文档", reference: { kind: "workbench_asset", assetId: "asset-1" } });

  await feature.commands.move({ target: { kind: "reference", id: folder.id }, destinationSpaceId: destination.id });

  assert.equal((await feature.queries.getTree(source.id))?.entries.length, 0);
  const moved = (await feature.queries.getTree(destination.id))?.entries.map((entry) => entry.item) ?? [];
  assert.deepEqual(moved.map((item) => item.id), [grandchild.id, child.id, folder.id]);
  assert.deepEqual(moved.find((item) => item.id === folder.id), {
    ...folder,
    spaceId: destination.id,
    parentId: undefined,
    updatedAt: moved.find((item) => item.id === folder.id)?.updatedAt,
  });
  assert.equal(moved.find((item) => item.id === child.id)?.parentId, folder.id);
  assert.equal(moved.find((item) => item.id === grandchild.id)?.parentId, child.id);
});

test("Space removes an asset folder with its complete subtree", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({ repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } }, idFactory: () => `id-${++id}` });
  const space = await feature.commands.createSpace({ title: "项目" });
  const folder = await feature.commands.addReference({ spaceId: space.id, title: "资料", reference: { kind: "asset_folder" } });
  const child = await feature.commands.addReference({ spaceId: space.id, parentId: folder.id, title: "子目录", reference: { kind: "asset_folder" } });
  await feature.commands.addReference({ spaceId: space.id, parentId: child.id, title: "文档", reference: { kind: "workbench_asset", assetId: "asset-1" } });
  const retained = await feature.commands.addReference({ spaceId: space.id, title: "保留", reference: { kind: "local_file", path: "C:/keep.md" } });

  await feature.commands.removeReference(folder.id);

  assert.deepEqual((await feature.queries.getTree(space.id))?.entries.map((entry) => entry.item.id), [retained.id]);
});

test("Space runs the configured ownership lifecycle around reference metadata removal", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const lifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(lifecycle),
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const folder = await feature.commands.addReference({ spaceId: space.id, title: "资料", reference: { kind: "asset_folder" } });
  const file = await feature.commands.addReference({ spaceId: space.id, parentId: folder.id, title: "文档", reference: { kind: "local_file", path: "C:/note.md" } });

  await feature.commands.removeReference(folder.id);

  assert.deepEqual(lifecycle, [
    "journal:prepared",
    "stage:id-3",
    "journal:files_staged",
    "journal:metadata_committed",
    "remove-staged:id-3",
    "journal:deleted",
  ]);
  assert.equal(await feature.queries.getReference(file.id), undefined);
});

test("Space unlinks a local file without running its ownership deletion lifecycle", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const lifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(lifecycle),
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const file = await feature.commands.addReference({
    spaceId: space.id,
    title: "文档",
    reference: { kind: "local_file", path: "C:/note.md" },
  });

  await feature.commands.unlinkReference(file.id);

  assert.deepEqual(lifecycle, []);
  assert.equal(await feature.queries.getReference(file.id), undefined);
});

test("Space startup recovery failure keeps commands and queries fail closed", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const recoveryError = new SpaceFeatureError("space_deletion_recovery_failed", "journal is inconsistent");
  const deletion = referenceDeletionFixture([]);
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    referenceDeletion: {
      ...deletion,
      journal: {
        ...deletion.journal,
        async list() { throw recoveryError; },
      },
    },
  });

  await assert.rejects(feature.ready(), (error: unknown) => error === recoveryError);
  await assert.rejects(feature.queries.list(), (error: unknown) => error === recoveryError);
  await assert.rejects(feature.commands.createSpace({ title: "不可创建" }), (error: unknown) => error === recoveryError);
  await feature.release();
});

test("Space latches an unrecoverable in-process deletion rollback and rejects later work", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let failWrites = false;
  let failRestore = true;
  let id = 0;
  const lifecycle: string[] = [];
  const deletion = referenceDeletionFixture(lifecycle);
  const feature = createSpaceFeature({
    repository: {
      async read() { return snapshot; },
      async write(value) {
        if (failWrites) throw new Error("metadata write failed");
        snapshot = value;
      },
    },
    idFactory: () => `id-${++id}`,
    referenceDeletion: {
      ...deletion,
      files: {
        ...deletion.files,
        async restore(target) {
          if (failRestore) throw new Error("restore failed");
          await deletion.files.restore(target);
        },
      },
    },
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const file = await feature.commands.addReference({
    spaceId: space.id,
    title: "文档",
    reference: { kind: "local_file", path: "C:/note.md" },
  });
  failWrites = true;

  let fatalFailure: unknown;
  try {
    await feature.commands.removeReference(file.id);
    assert.fail("deletion should fail when metadata and rollback both fail");
  } catch (error) {
    fatalFailure = error;
  }

  assert.equal(fatalFailure instanceof SpaceFeatureError && fatalFailure.code === "space_deletion_recovery_failed", true);
  assert.equal((await deletion.journal.list()).length, 1);
  await assert.rejects(feature.ready(), (error: unknown) => error === fatalFailure);
  await assert.rejects(feature.queries.list(), (error: unknown) => error === fatalFailure);
  await assert.rejects(feature.commands.createSpace({ title: "不可继续" }), (error: unknown) => error === fatalFailure);
  failRestore = false;
  await feature.release();
  assert.deepEqual(await deletion.journal.list(), []);
});

test("Space content changes do not reorder Spaces", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    now: (() => { let tick = 0; return () => `2026-07-30T00:00:0${++tick}.000Z`; })(),
  });
  const first = await feature.commands.createSpace({ title: "第一个" });
  const second = await feature.commands.createSpace({ title: "第二个" });

  await feature.commands.addReference({
    spaceId: first.id,
    title: "新资料",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  });

  assert.deepEqual((await feature.queries.list()).map((space) => space.id), [first.id, second.id]);
});

test("Space rejects duplicate workspace mounts by canonical identity", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    workspaceMountIdentity: async (value) => value.toLowerCase().replaceAll("\\", "/"),
  });
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  await feature.commands.addReference({ spaceId: first.id, title: "工作区", reference: { kind: "workspace_folder", path: "C:\\Work" } });
  await assert.rejects(feature.commands.addReference({ spaceId: second.id, title: "重复", reference: { kind: "workspace_folder", path: "c:/work" } }), { code: "space_workspace_mount_conflict" });
});

test("Space conversation references form one unique ownership link", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
  });
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  const link = await feature.commands.addReference({
    spaceId: first.id,
    title: "讨论",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  });

  assert.deepEqual(await feature.queries.findConversationOwner("conversation-1"), {
    spaceId: first.id,
    referenceItemId: link.id,
  });
  await assert.rejects(feature.commands.addReference({
    spaceId: second.id,
    title: "重复讨论",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  }), { code: "space_conversation_ownership_conflict" });
  assert.equal(await feature.queries.findConversationOwner("missing"), undefined);
});

test("Space accepts only internal asset folders as metadata parents", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
  });
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  const asset = await feature.commands.addReference({
    spaceId: first.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
  });
  const conversation = await feature.commands.addReference({
    spaceId: first.id,
    title: "讨论",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  });
  const otherFolder = await feature.commands.addReference({
    spaceId: second.id,
    title: "其他空间目录",
    reference: { kind: "asset_folder" },
  });

  for (const parentId of [asset.id, conversation.id]) {
    await assert.rejects(feature.commands.addReference({
      spaceId: first.id,
      parentId,
      title: "不可见子项",
      reference: { kind: "workbench_asset", assetId: `child-${parentId}` },
    }), { code: "space_invalid_input" });
  }
  await assert.rejects(feature.commands.addReference({
    spaceId: first.id,
    parentId: otherFolder.id,
    title: "跨空间子项",
    reference: { kind: "workbench_asset", assetId: "cross-space" },
  }), { code: "space_invalid_input" });
});

function referenceDeletionFixture(lifecycle: string[]) {
  const records = new Map<string, SpaceReferenceDeletionJournalRecord>();
  const journal: SpaceReferenceDeletionJournalStore = {
    mutationKey: "C:/runtime/space-reference-deletions",
    async list() { return [...records.values()]; },
    async save(record) {
      lifecycle.push(`journal:${record.phase}`);
      records.set(record.deletionId, record);
    },
    async delete(deletionId) {
      lifecycle.push("journal:deleted");
      records.delete(deletionId);
    },
  };
  const states = new Map<string, { sourceExists: boolean; stagedExists: boolean }>();
  const files: SpaceReferenceDeletionFilePort = {
    async prepare({ item, deletionId, targetIndex }) {
      if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") return undefined;
      states.set(item.id, { sourceExists: true, stagedExists: false });
      return {
        referenceId: item.id,
        kind: item.reference.kind,
        sourcePath: item.reference.path,
        stagedPath: `${item.reference.path}.staged-${deletionId}-${targetIndex}`,
      };
    },
    async inspect(target) {
      return states.get(target.referenceId) ?? { sourceExists: false, stagedExists: false };
    },
    async stage(target) {
      lifecycle.push(`stage:${target.referenceId}`);
      states.set(target.referenceId, { sourceExists: false, stagedExists: true });
    },
    async restore(target) {
      lifecycle.push(`restore:${target.referenceId}`);
      states.set(target.referenceId, { sourceExists: true, stagedExists: false });
    },
    async removeStaged(target) {
      lifecycle.push(`remove-staged:${target.referenceId}`);
      const current = states.get(target.referenceId) ?? { sourceExists: false, stagedExists: false };
      states.set(target.referenceId, { ...current, stagedExists: false });
    },
  };
  return {
    journal,
    files,
    leases: {
      async run<T>(_path: string, operation: () => Promise<T>) { return operation(); },
      async runExclusive<T>(_path: string, operation: () => Promise<T>) { return operation(); },
    },
    createDeletionId: () => "delete-test",
  };
}
