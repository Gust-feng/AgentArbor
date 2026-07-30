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

test("Space moves one top-level reference between spaces without moving its source", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({ repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } }, idFactory: () => `id-${++id}` });
  const source = await feature.commands.createSpace({ title: "来源" });
  const destination = await feature.commands.createSpace({ title: "目标" });
  const item = await feature.commands.addReference({ spaceId: source.id, title: "文档", reference: { kind: "local_file", path: "C:/doc.md" } });
  await feature.commands.move({ target: { kind: "reference", id: item.id }, destinationSpaceId: destination.id });
  assert.equal((await feature.queries.getTree(source.id))?.entries.length, 0);
  assert.equal((await feature.queries.getTree(destination.id))?.entries[0]?.item.reference.kind, "local_file");
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
