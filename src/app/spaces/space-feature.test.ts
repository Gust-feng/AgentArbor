import assert from "node:assert/strict";
import test from "node:test";

import { createSpaceFeature } from "./space-feature.js";
import { SPACE_TREE_SCHEMA_VERSION, type SpaceTreeSnapshot } from "./contracts.js";

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
