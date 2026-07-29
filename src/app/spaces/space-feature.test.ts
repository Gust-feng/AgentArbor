import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SpaceFeatureError, type SpaceEvent } from "./contracts.js";
import { createFileSystemSpaceRepository } from "./file-system-repository.js";
import { createSpaceFeature } from "./space-feature.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-feature-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  let id = 0;
  let tick = 0;
  const feature = createSpaceFeature({
    repository: createFileSystemSpaceRepository(root),
    idFactory: () => `space-node-${++id}`,
    now: () => `2026-07-28T00:00:0${++tick}.000Z`,
  });
  return { root, feature };
}

test("SpaceTree persists folders and opaque external references without copying their contents", async (t) => {
  const spaces = await fixture(t);
  const externalFile = path.join(spaces.root, "outside.txt");
  await fs.writeFile(externalFile, "keep this external content", "utf8");
  const events: SpaceEvent[] = [];
  spaces.feature.events.subscribe((event) => events.push(event));

  const space = await spaces.feature.commands.createSpace({ title: "产品研究" });
  const folder = await spaces.feature.commands.createFolder({ spaceId: space.id, title: "参考" });
  const item = await spaces.feature.commands.addReference({
    spaceId: space.id,
    parentFolderId: folder.id,
    title: "原型截图",
    reference: { kind: "local_file", path: externalFile },
  });
  const conversation = await spaces.feature.commands.addReference({
    spaceId: space.id,
    title: "重做讨论",
    reference: { kind: "conversation", conversationId: "ordinary-conversation-7", conversationTitle: "面板重做" },
  });

  assert.deepEqual(await spaces.feature.queries.list(), [{
    id: space.id, title: "产品研究", createdAt: "2026-07-28T00:00:01.000Z", updatedAt: "2026-07-28T00:00:04.000Z", folderCount: 1, referenceItemCount: 2,
  }]);
  const tree = await spaces.feature.queries.getTree(space.id);
  assert.equal(tree?.entries[0]?.kind, "folder");
  assert.equal(tree?.entries[0]?.kind === "folder" ? tree.entries[0].children[0]?.kind : undefined, "reference");
  assert.equal(tree?.entries[1]?.kind === "reference" ? tree.entries[1].item.reference.kind : undefined, "conversation");

  await spaces.feature.commands.removeReference(item.id);
  assert.equal(await fs.readFile(externalFile, "utf8"), "keep this external content");
  assert.equal((await spaces.feature.queries.getTree(space.id))?.entries.length, 2, "the empty folder and conversation reference remain");
  assert.deepEqual(events.map((event) => event.type), ["space.created", "space.folder_created", "space.reference_added", "space.reference_added", "space.reference_removed"]);
  assert.equal(conversation.reference.kind, "conversation");
  await spaces.feature.release();
});

test("moving a folder moves its complete metadata subtree atomically between Spaces", async (t) => {
  const spaces = await fixture(t);
  const source = await spaces.feature.commands.createSpace({ title: "来源" });
  const destination = await spaces.feature.commands.createSpace({ title: "目标" });
  const parent = await spaces.feature.commands.createFolder({ spaceId: source.id, title: "父文件夹" });
  const child = await spaces.feature.commands.createFolder({ spaceId: source.id, parentFolderId: parent.id, title: "子文件夹" });
  const item = await spaces.feature.commands.addReference({
    spaceId: source.id,
    parentFolderId: child.id,
    title: "链接",
    reference: { kind: "web_page", url: "https://example.com/reference" },
  });
  const destinationFolder = await spaces.feature.commands.createFolder({ spaceId: destination.id, title: "归档" });

  await spaces.feature.commands.move({ target: { kind: "folder", id: parent.id }, destinationSpaceId: destination.id, destinationFolderId: destinationFolder.id });

  const sourceTree = await spaces.feature.queries.getTree(source.id);
  assert.equal(sourceTree?.entries.length, 0);
  const moved = await spaces.feature.queries.getTree(destination.id);
  const movedParent = moved?.entries.find((entry) => entry.kind === "folder" && entry.folder.id === destinationFolder.id);
  assert.equal(movedParent?.kind, "folder");
  const subtree = movedParent?.kind === "folder" ? movedParent.children[0] : undefined;
  assert.equal(subtree?.kind, "folder");
  const nested = subtree?.kind === "folder" ? subtree.children[0] : undefined;
  assert.equal(nested?.kind, "folder");
  assert.equal(nested?.kind === "folder" ? nested.children[0]?.kind : undefined, "reference");
  assert.equal(nested?.kind === "folder" && nested.children[0]?.kind === "reference" ? nested.children[0].item.id : undefined, item.id);

  await spaces.feature.release();
});

test("removing an internal folder deletes only its Space metadata subtree", async (t) => {
  const spaces = await fixture(t);
  const space = await spaces.feature.commands.createSpace({ title: "整理" });
  const parent = await spaces.feature.commands.createFolder({ spaceId: space.id, title: "父文件夹" });
  const child = await spaces.feature.commands.createFolder({ spaceId: space.id, parentFolderId: parent.id, title: "子文件夹" });
  const externalFile = path.join(spaces.root, "external.txt");
  await fs.writeFile(externalFile, "keep", "utf8");
  await spaces.feature.commands.addReference({
    spaceId: space.id,
    parentFolderId: child.id,
    title: "外部文件",
    reference: { kind: "local_file", path: externalFile },
  });

  await spaces.feature.commands.removeFolder(parent.id);

  assert.deepEqual((await spaces.feature.queries.getTree(space.id))?.entries, []);
  assert.equal(await fs.readFile(externalFile, "utf8"), "keep");
  await spaces.feature.release();
});

test("SpaceTree rejects invalid hierarchy moves and later commands after release", async (t) => {
  const spaces = await fixture(t);
  const space = await spaces.feature.commands.createSpace({ title: "整理" });
  const parent = await spaces.feature.commands.createFolder({ spaceId: space.id, title: "父" });
  const child = await spaces.feature.commands.createFolder({ spaceId: space.id, parentFolderId: parent.id, title: "子" });
  await assert.rejects(
    spaces.feature.commands.move({ target: { kind: "folder", id: parent.id }, destinationSpaceId: space.id, destinationFolderId: child.id }),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_invalid_move",
  );
  await spaces.feature.release();
  assert.throws(() => spaces.feature.queries.list(), (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_feature_released");
});

test("SpaceTree rejects duplicate writable workspace mounts across Spaces", async (t) => {
  const spaces = await fixture(t);
  const first = await spaces.feature.commands.createSpace({ title: "一" });
  const second = await spaces.feature.commands.createSpace({ title: "二" });
  await spaces.feature.commands.addReference({
    spaceId: first.id,
    title: "工作区",
    reference: { kind: "workspace_folder", path: "E:\\Project" },
  });
  await assert.rejects(
    spaces.feature.commands.addReference({
      spaceId: second.id,
      title: "同一工作区",
      reference: { kind: "workspace_folder", path: "e:/project/" },
    }),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_workspace_mount_conflict",
  );
  await spaces.feature.release();
});
