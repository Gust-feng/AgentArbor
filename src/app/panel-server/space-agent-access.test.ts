import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSpaceFeature, type SpaceRepository, type SpaceTreeSnapshot } from "../spaces/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { resolveConversationSpaceAccess } from "./space-agent-access.js";

test("conversation Space access freezes only the owning Space local references", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-access-"));
  t.after(() => removeTestDirectory(directory));
  const firstFilePath = path.join(directory, "space-one", "note.md");
  await fs.mkdir(path.dirname(firstFilePath), { recursive: true });
  await fs.writeFile(firstFilePath, "one", "utf8");
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] };
  const repository: SpaceRepository = {
    async read() { return structuredClone(snapshot); },
    async write(value) { snapshot = structuredClone(value); },
  };
  let id = 0;
  const spaces = createSpaceFeature({ repository, idFactory: () => `id-${++id}` });
  const first = await spaces.commands.createSpace({ title: "一" });
  const second = await spaces.commands.createSpace({ title: "二" });
  const firstFile = await spaces.commands.addReference({
    spaceId: first.id,
    title: "一号文件",
    reference: { kind: "local_file", path: firstFilePath },
  });
  await spaces.commands.linkConversationOwner({
    spaceId: first.id,
    title: "对话",
    conversationId: "conversation-1",
  });
  await spaces.commands.addReference({
    spaceId: second.id,
    title: "二号目录",
    reference: { kind: "managed_folder", path: "C:/space-two" },
  });

  const access = await resolveConversationSpaceAccess(spaces, undefined, "conversation-1", {
    contextRefs: [{ attachmentId: `space-reference:${firstFile.id}`, ref: "local-file:C:/forged.md", kind: "file" }],
    permissionBoundaryRefs: ["read:web"],
  });

  assert.equal(access.spaceId, first.id);
  assert.deepEqual(access.taskSoilInput?.contextRefs, [{
    attachmentId: `space-reference:${firstFile.id}`,
    ref: `local-file:${firstFilePath}`,
    pathGranted: true,
    kind: "file",
    title: "一号文件",
    summary: "当前对话所属空间授权的本地资源。",
  }]);
  assert.deepEqual(access.taskSoilInput?.permissionBoundaryRefs, [
    `scope:space:${first.id}`,
    `read:local-file:${firstFilePath}`,
    `write:space-reference:${firstFile.id}`,
    "read:web",
  ]);
});

test("Run access freezes stored paths without scanning or mutating missing references", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-access-missing-"));
  t.after(() => removeTestDirectory(directory));
  const missingPath = path.join(directory, "gone.md");
  const presentPath = path.join(directory, "here.md");
  await fs.writeFile(presentPath, "present", "utf8");
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] };
  let id = 0;
  const spaces = createSpaceFeature({
    repository: {
      async read() { return structuredClone(snapshot); },
      async write(value) { snapshot = structuredClone(value); },
    },
    idFactory: () => "id-" + ++id,
  });
  const space = await spaces.commands.createSpace({ title: "一" });
  const missing = await spaces.commands.addReference({
    spaceId: space.id,
    title: "已失联文件",
    reference: { kind: "local_file", path: missingPath },
  });
  const present = await spaces.commands.addReference({
    spaceId: space.id,
    title: "在位文件",
    reference: { kind: "local_file", path: presentPath },
  });
  await spaces.commands.linkConversationOwner({
    spaceId: space.id,
    title: "对话",
    conversationId: "conversation-1",
  });
  const access = await resolveConversationSpaceAccess(spaces, undefined, "conversation-1", undefined);

  assert.deepEqual(access.taskSoilInput?.contextRefs?.map((ref) => ref.attachmentId), [
    "space-reference:" + present.id,
    "space-reference:" + missing.id,
  ]);
  assert.equal(access.taskSoilInput?.contextRefs?.find((ref) => ref.attachmentId === "space-reference:" + missing.id)?.ref, "local-file:" + missingPath);
  assert.deepEqual(access.taskSoilInput?.permissionBoundaryRefs, [
    "scope:space:" + space.id,
    "read:local-file:" + presentPath,
    "write:space-reference:" + present.id,
    "read:local-file:" + missingPath,
    "write:space-reference:" + missing.id,
  ]);
  assert.notEqual(await spaces.queries.getReference(missing.id), undefined);
});
test("Space ownership remains frozen even when the Space has no local references", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] };
  const spaces = createSpaceFeature({
    repository: {
      async read() { return structuredClone(snapshot); },
      async write(value) { snapshot = structuredClone(value); },
    },
  });
  const space = await spaces.commands.createSpace({ title: "空空间" });

  const access = await resolveConversationSpaceAccess(spaces, undefined, undefined, undefined, space.id);

  assert.equal(access.spaceId, space.id);
  assert.deepEqual(access.taskSoilInput?.contextRefs, []);
  assert.deepEqual(access.taskSoilInput?.permissionBoundaryRefs, [`scope:space:${space.id}`]);
});

test("canonical conversation owner wins over the legacy Space tree link", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] };
  const spaces = createSpaceFeature({
    repository: {
      async read() { return structuredClone(snapshot); },
      async write(value) { snapshot = structuredClone(value); },
    },
  });
  const first = await spaces.commands.createSpace({ title: "一" });
  const second = await spaces.commands.createSpace({ title: "二" });
  await spaces.commands.linkConversationOwner({
    spaceId: first.id,
    title: "旧对话",
    conversationId: "conversation-1",
  });
  const access = await resolveConversationSpaceAccess(
    spaces,
    async () => ({ kind: "space" as const, id: second.id }),
    "conversation-1",
    undefined,
  );
  assert.equal(access.spaceId, second.id);
});

test("unassigned conversations keep their submitted Task Soil unchanged", async () => {
  const spaces = createSpaceFeature({
    repository: {
      async read() { return { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] }; },
      async write() { return undefined; },
    },
  });
  const submitted = { permissionBoundaryRefs: ["read:web"] } as const;
  assert.deepEqual(await resolveConversationSpaceAccess(spaces, undefined, "conversation-1", submitted), {
    taskSoilInput: submitted,
  });
});
