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

test("Space deletion removes the container and its links without deleting source content", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const deletionLifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(deletionLifecycle),
  });
  const events: unknown[] = [];
  feature.events.subscribe((event) => events.push(event));
  const space = await feature.commands.createSpace({ title: "项目" });
  const localFile = await feature.commands.addReference({
    spaceId: space.id,
    title: "本地文件",
    reference: { kind: "local_file", path: "C:/keep.md" },
  });
  const conversation = await feature.commands.linkConversationOwner({
    spaceId: space.id,
    title: "讨论",
    conversationId: "conversation-1",
  });

  await feature.commands.deleteSpace(space.id);

  assert.deepEqual(await feature.queries.list(), []);
  assert.equal(await feature.queries.getTree(space.id), undefined);
  assert.equal(await feature.queries.getReference(localFile.id), undefined);
  assert.equal(await feature.queries.getReference(conversation.id), undefined);
  assert.deepEqual(deletionLifecycle, []);
  assert.deepEqual(events.at(-1), {
    type: "space.deleted",
    spaceId: space.id,
    removedReferenceIds: [conversation.id, localFile.id],
  });
  await assert.rejects(feature.commands.deleteSpace(space.id), { code: "space_not_found" });
});

test("Space deletion runs physical deletion only for Space-owned managed folders", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const lifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(lifecycle),
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  await feature.commands.addReference({
    spaceId: space.id,
    title: "内部资料",
    reference: { kind: "managed_folder", path: "C:/managed" },
  });
  await feature.commands.addReference({
    spaceId: space.id,
    title: "外部资料",
    reference: { kind: "workspace_folder", path: "C:/external" },
  });

  await feature.commands.deleteSpace(space.id);

  assert.deepEqual(lifecycle, [
    "journal:prepared",
    "stage:id-2",
    "journal:files_staged",
    "journal:metadata_committed",
    "remove-staged:id-2",
    "journal:deleted",
  ]);
});

test("Space deletion requires and invokes the Workbench asset deletion port", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const missingPort = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
  });
  const blocked = await missingPort.commands.createSpace({ title: "未配置" });
  await missingPort.commands.addReference({
    spaceId: blocked.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-blocked" },
  });
  await assert.rejects(missingPort.commands.deleteSpace(blocked.id), { code: "space_deletion_journal_failure" });
  assert.notEqual(await missingPort.queries.getTree(blocked.id), undefined);

  const deletedAssetIds: string[] = [];
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    ownedAssetDeletion: {
      async deleteWorkbenchAssets(assetIds) { deletedAssetIds.push(...assetIds); },
    },
  });
  const space = await feature.commands.createSpace({ title: "已配置" });
  await feature.commands.addReference({
    spaceId: space.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
  });
  await assert.rejects(feature.commands.addReference({
    spaceId: space.id,
    title: "重复引用",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
  }), { code: "space_asset_ownership_conflict" });

  await feature.commands.deleteSpace(space.id);

  assert.deepEqual(deletedAssetIds, ["asset-1"]);
  assert.equal(await feature.queries.getTree(space.id), undefined);
});

test("Removing an internal material subtree deletes its owned Workbench assets", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const deletedAssetIds: string[] = [];
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    ownedAssetDeletion: {
      async deleteWorkbenchAssets(assetIds) { deletedAssetIds.push(...assetIds); },
    },
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const folder = await feature.commands.addReference({
    spaceId: space.id,
    title: "资料",
    reference: { kind: "asset_folder" },
  });
  await feature.commands.addReference({
    spaceId: space.id,
    parentId: folder.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-remove" },
  });

  await feature.commands.removeReference(folder.id);

  assert.deepEqual(deletedAssetIds, ["asset-remove"]);
  assert.deepEqual((await feature.queries.getTree(space.id))?.entries, []);
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
  const deletedAssetIds: string[] = [];
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    ownedAssetDeletion: {
      async deleteWorkbenchAssets(assetIds) { deletedAssetIds.push(...assetIds); },
    },
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const folder = await feature.commands.addReference({ spaceId: space.id, title: "资料", reference: { kind: "asset_folder" } });
  const child = await feature.commands.addReference({ spaceId: space.id, parentId: folder.id, title: "子目录", reference: { kind: "asset_folder" } });
  await feature.commands.addReference({ spaceId: space.id, parentId: child.id, title: "文档", reference: { kind: "workbench_asset", assetId: "asset-1" } });
  const retained = await feature.commands.addReference({ spaceId: space.id, title: "保留", reference: { kind: "local_file", path: "C:/keep.md" } });

  await feature.commands.removeReference(folder.id);

  assert.deepEqual((await feature.queries.getTree(space.id))?.entries.map((entry) => entry.item.id), [retained.id]);
  assert.deepEqual(deletedAssetIds, ["asset-1"]);
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
  const file = await feature.commands.addReference({ spaceId: space.id, parentId: folder.id, title: "托管文档", reference: { kind: "managed_folder", path: "C:/note" } });

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

test("Space refuses to unlink an internal managed folder outside its deletion lifecycle", async () => {
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
    reference: { kind: "managed_folder", path: "C:/note" },
  });

  await assert.rejects(feature.commands.unlinkReference(file.id), { code: "space_invalid_input" });
  assert.deepEqual(lifecycle, []);
  assert.equal((await feature.queries.getReference(file.id))?.id, file.id);
});

test("Space never physically deletes an external file through the removal command", async () => {
  const feature = createMountTestFeature();
  const space = await feature.commands.createSpace({ title: "项目" });
  const file = await feature.commands.addReference({
    spaceId: space.id,
    title: "外部文件",
    reference: { kind: "local_file", path: "C:/external.md" },
  });
  await assert.rejects(feature.commands.removeReference(file.id), { code: "space_invalid_input" });
  assert.equal((await feature.queries.getReference(file.id))?.id, file.id);
});

test("Space unlinks an exact conversation link without changing its files, folders, or managed content", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const lifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(lifecycle),
  });
  const space = await feature.commands.createSpace({ title: "项目" });
  const conversation = await feature.commands.linkConversationOwner({
    spaceId: space.id,
    title: "讨论",
    conversationId: "conversation-1",
  });
  const file = await feature.commands.addReference({
    spaceId: space.id,
    title: "本地文件",
    reference: { kind: "local_file", path: "C:/keep.md" },
  });
  const managed = await feature.commands.addReference({
    spaceId: space.id,
    title: "托管文件夹",
    reference: { kind: "managed_folder", path: "C:/managed" },
  });
  const assetFolder = await feature.commands.addReference({
    spaceId: space.id,
    title: "托管文档",
    reference: { kind: "asset_folder" },
  });
  const asset = await feature.commands.addReference({
    spaceId: space.id,
    parentId: assetFolder.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
  });

  await feature.commands.unlinkConversationReferenceItem(conversation.id);
  await feature.commands.unlinkConversationReferenceItem(conversation.id);

  assert.deepEqual(lifecycle, []);
  assert.equal(await feature.queries.getReference(conversation.id), undefined);
  assert.deepEqual(
    (await feature.queries.getTree(space.id))?.entries.map((entry) => entry.item.id),
    [asset.id, assetFolder.id, managed.id, file.id],
  );
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
    reference: { kind: "managed_folder", path: "C:/note" },
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

  await feature.commands.linkConversationOwner({
    spaceId: first.id,
    title: "新资料",
    conversationId: "conversation-1",
  });

  assert.deepEqual((await feature.queries.list()).map((space) => space.id), [first.id, second.id]);
});

function createMountTestFeature() {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  return createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    workspaceMountIdentity: async (value) => value.toLowerCase().replaceAll("\\", "/").replace(/(?<=[^/])\/+$/u, ""),
  });
}

test("Space rejects a duplicate workspace mount by canonical identity within one Space", async () => {
  const feature = createMountTestFeature();
  const space = await feature.commands.createSpace({ title: "一" });
  await feature.commands.addReference({ spaceId: space.id, title: "工作区", reference: { kind: "workspace_folder", path: "C:\\Work" } });
  await assert.rejects(
    feature.commands.addReference({ spaceId: space.id, title: "重复", reference: { kind: "workspace_folder", path: "c:/work" } }),
    { code: "space_workspace_mount_conflict" },
  );
});

test("Space rejects overlapping parent and child workspace mounts within one Space", async () => {
  const feature = createMountTestFeature();
  const space = await feature.commands.createSpace({ title: "一" });
  await feature.commands.addReference({ spaceId: space.id, title: "父", reference: { kind: "workspace_folder", path: "C:\\Work" } });
  await assert.rejects(
    feature.commands.addReference({ spaceId: space.id, title: "子", reference: { kind: "workspace_folder", path: "C:\\Work\\api" } }),
    { code: "space_workspace_mount_conflict" },
  );

  const sibling = await feature.commands.createSpace({ title: "二" });
  await feature.commands.addReference({ spaceId: sibling.id, title: "子", reference: { kind: "workspace_folder", path: "C:\\Work\\api" } });
  await assert.rejects(
    feature.commands.addReference({ spaceId: sibling.id, title: "父", reference: { kind: "workspace_folder", path: "C:\\Work" } }),
    { code: "space_workspace_mount_conflict" },
  );
});

test("Space allows one workspace mount to be referenced by several Spaces", async () => {
  const feature = createMountTestFeature();
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  const shared = await feature.commands.addReference({ spaceId: first.id, title: "工作区", reference: { kind: "workspace_folder", path: "C:\\Work" } });
  const mirrored = await feature.commands.addReference({ spaceId: second.id, title: "同一工作区", reference: { kind: "workspace_folder", path: "c:/work" } });

  assert.notEqual(shared.id, mirrored.id);
  await feature.commands.unlinkReference(shared.id);
  assert.equal((await feature.queries.getReference(mirrored.id))?.spaceId, second.id);
});

test("Space rejects sharing a Workbench asset across Spaces", async () => {
  const feature = createMountTestFeature();
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  await feature.commands.addReference({
    spaceId: first.id,
    title: "文档",
    reference: { kind: "workbench_asset", assetId: "asset-shared" },
  });
  await assert.rejects(feature.commands.addReference({
    spaceId: second.id,
    title: "重复文档",
    reference: { kind: "workbench_asset", assetId: "asset-shared" },
  }), { code: "space_asset_ownership_conflict" });
});

test("Space treats sibling workspace mounts that share a name prefix as distinct", async () => {
  const feature = createMountTestFeature();
  const space = await feature.commands.createSpace({ title: "一" });
  await feature.commands.addReference({ spaceId: space.id, title: "工作区", reference: { kind: "workspace_folder", path: "C:\\Work" } });
  const sibling = await feature.commands.addReference({ spaceId: space.id, title: "邻居", reference: { kind: "workspace_folder", path: "C:\\Workshop" } });

  assert.equal((await feature.queries.getReference(sibling.id))?.spaceId, space.id);
});

test("Space rejects an external file nested under a referenced workspace", async () => {
  const feature = createMountTestFeature();
  const space = await feature.commands.createSpace({ title: "一" });
  await feature.commands.addReference({
    spaceId: space.id,
    title: "工作区",
    reference: { kind: "workspace_folder", path: "C:\\Work" },
  });
  await assert.rejects(
    feature.commands.addReference({
      spaceId: space.id,
      title: "文件",
      reference: { kind: "local_file", path: "C:\\Work\\README.md" },
    }),
    { code: "space_workspace_mount_conflict" },
  );
});

test("Space rejects duplicate external files and allows the same source in another Space", async () => {
  const feature = createMountTestFeature();
  const first = await feature.commands.createSpace({ title: "一" });
  const second = await feature.commands.createSpace({ title: "二" });
  await feature.commands.addReference({
    spaceId: first.id,
    title: "文件",
    reference: { kind: "local_file", path: "C:\\Work\\README.md" },
  });
  await assert.rejects(
    feature.commands.addReference({
      spaceId: first.id,
      title: "重复文件",
      reference: { kind: "local_file", path: "c:/work/readme.md" },
    }),
    { code: "space_workspace_mount_conflict" },
  );
  const mirrored = await feature.commands.addReference({
    spaceId: second.id,
    title: "同一文件",
    reference: { kind: "local_file", path: "c:/work/readme.md" },
  });
  assert.equal(mirrored.spaceId, second.id);
});

test("Space rejects moving an external workspace mount", async () => {
  const feature = createMountTestFeature();
  const source = await feature.commands.createSpace({ title: "来源" });
  const destination = await feature.commands.createSpace({ title: "目标" });
  const child = await feature.commands.addReference({
    spaceId: source.id,
    title: "子工作区",
    reference: { kind: "workspace_folder", path: "C:\\Work\\api" },
  });
  await assert.rejects(
    feature.commands.move({ target: { kind: "reference", id: child.id }, destinationSpaceId: destination.id }),
    { code: "space_invalid_move" },
  );
  assert.equal((await feature.queries.getReference(child.id))?.spaceId, source.id);
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
  const link = await feature.commands.linkConversationOwner({
    spaceId: first.id,
    title: "讨论",
    conversationId: "conversation-1",
  });

  assert.deepEqual(await feature.queries.findConversationOwner("conversation-1"), {
    spaceId: first.id,
    referenceItemId: link.id,
  });
  await assert.rejects(feature.commands.linkConversationOwner({
    spaceId: second.id,
    title: "重复讨论",
    conversationId: "conversation-1",
  }), { code: "space_conversation_ownership_conflict" });
  await assert.rejects(feature.commands.addReference({
    spaceId: second.id,
    title: "普通引用",
    reference: { kind: "conversation", conversationId: "conversation-2" } as never,
  }), { code: "space_invalid_input" });
  await assert.rejects(feature.commands.unlinkReference(link.id), { code: "space_invalid_input" });
  await assert.rejects(feature.commands.removeReference(link.id), { code: "space_invalid_input" });
  await assert.rejects(
    feature.commands.move({ target: { kind: "reference", id: link.id }, destinationSpaceId: second.id }),
    { code: "space_invalid_move" },
  );
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
  const conversation = await feature.commands.linkConversationOwner({
    spaceId: first.id,
    title: "讨论",
    conversationId: "conversation-1",
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

test("Space reference annotation persists on add, reads back, and advances revision on update", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    now: () => "2026-08-11T00:00:00.000Z",
  });
  const events: unknown[] = [];
  feature.events.subscribe((event) => events.push(event));
  const space = await feature.commands.createSpace({ title: "机器学习" });
  const withAnnotation = await feature.commands.addReference({
    spaceId: space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "通过优化输入观察神经元激活。", keyPoints: ["优化输入"], tags: ["深度学习"] },
    actor: "agent",
  });
  assert.deepEqual(withAnnotation.annotation, {
    markdown: "通过优化输入观察神经元激活。",
    keyPoints: ["优化输入"],
    tags: ["深度学习"],
    revision: 1,
    updatedAt: "2026-08-11T00:00:00.000Z",
    updatedBy: "agent",
  });
  assert.deepEqual((await feature.queries.getReference(withAnnotation.id))?.annotation, withAnnotation.annotation);

  const updated = await feature.commands.updateReferenceAnnotation({
    itemId: withAnnotation.id,
    expectedRevision: 1,
    patch: { markdown: "更新后的理解", tags: ["深度学习", "Transformer"] },
    actor: "user",
  });
  assert.equal(updated.annotation?.revision, 2);
  assert.equal(updated.annotation?.updatedBy, "user");
  assert.equal(updated.annotation?.markdown, "更新后的理解");
  assert.deepEqual(updated.annotation?.keyPoints, ["优化输入"]);
  assert.deepEqual(updated.annotation?.tags, ["深度学习", "Transformer"]);
  assert.deepEqual(events.at(-1), { type: "space.reference_annotation_updated", item: updated });
  assert.equal((await feature.queries.list()).find((entry) => entry.id === space.id)?.updatedAt, "2026-08-11T00:00:00.000Z");
  await feature.release();
});

test("Space reference without annotation stays annotation-free and update creates revision one", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    now: () => "2026-08-11T00:00:00.000Z",
  });
  const space = await feature.commands.createSpace({ title: "阅读" });
  const bare = await feature.commands.addReference({
    spaceId: space.id,
    title: "无法读取的网页",
    reference: { kind: "web_page", url: "https://example.com/private" },
  });
  assert.equal(bare.annotation, undefined);
  assert.equal((await feature.queries.getReference(bare.id))?.annotation, undefined);

  const first = await feature.commands.updateReferenceAnnotation({
    itemId: bare.id,
    expectedRevision: 0,
    patch: { markdown: "后续补上的理解" },
    actor: "agent",
  });
  assert.equal(first.annotation?.revision, 1);
  assert.equal(first.annotation?.markdown, "后续补上的理解");
  assert.equal(first.annotation?.updatedBy, "agent");
  await feature.release();
});

test("Space reference annotation update rejects stale revisions, missing items, empty patches and oversized content", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
  });
  const space = await feature.commands.createSpace({ title: "机器学习" });
  const item = await feature.commands.addReference({
    spaceId: space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "v1" },
    actor: "agent",
  });
  await assert.rejects(
    feature.commands.updateReferenceAnnotation({ itemId: item.id, expectedRevision: 2, patch: { markdown: "stale" } }),
    { code: "space_reference_annotation_revision_conflict" },
  );
  await assert.rejects(
    feature.commands.updateReferenceAnnotation({ itemId: "missing", expectedRevision: 0, patch: { markdown: "x" } }),
    { code: "space_reference_not_found" },
  );
  await assert.rejects(
    feature.commands.updateReferenceAnnotation({ itemId: item.id, expectedRevision: 1, patch: {} }),
    { code: "space_reference_annotation_invalid" },
  );
  await assert.rejects(
    feature.commands.addReference({
      spaceId: space.id,
      title: "超长",
      reference: { kind: "web_page", url: "https://example.com" },
      annotation: { markdown: "x".repeat(512 * 1024 + 1) },
    }),
    { code: "space_reference_annotation_too_large" },
  );
  await assert.rejects(
    feature.commands.addReference({
      spaceId: space.id,
      title: "超多标签",
      reference: { kind: "web_page", url: "https://example.com" },
      annotation: { markdown: "ok", tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`) },
    }),
    { code: "space_reference_annotation_too_large" },
  );
  assert.equal((await feature.queries.getReference(item.id))?.annotation?.revision, 1);
  await feature.release();
});

test("Space deletion removes reference annotations with their references", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
  });
  const space = await feature.commands.createSpace({ title: "机器学习" });
  const item = await feature.commands.addReference({
    spaceId: space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "v1" },
    actor: "agent",
  });
  assert.notEqual(item.annotation, undefined);
  await feature.commands.deleteSpace(space.id);
  assert.equal(await feature.queries.getReference(item.id), undefined);
  assert.equal(snapshot.referenceItems.some((entry) => entry.annotation !== undefined), false);
  await feature.release();
});

test("owned reference deletion journals an annotated removed reference", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  const lifecycle: string[] = [];
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    referenceDeletion: referenceDeletionFixture(lifecycle),
  });
  const space = await feature.commands.createSpace({ title: "机器学习" });
  const material = await feature.commands.addReference({
    spaceId: space.id,
    title: "内部资料",
    reference: { kind: "managed_folder", path: "C:/managed" },
    annotation: { markdown: "整理内容", tags: ["资料"] },
    actor: "agent",
  });
  await feature.commands.removeReference(material.id);
  assert.deepEqual(lifecycle, [
    "journal:prepared",
    "stage:" + material.id,
    "journal:files_staged",
    "journal:metadata_committed",
    "remove-staged:" + material.id,
    "journal:deleted",
  ]);
  assert.equal(await feature.queries.getReference(material.id), undefined);
  await feature.release();
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
