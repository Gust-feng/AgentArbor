import assert from "node:assert/strict";
import test from "node:test";

import { createSpaceFeature, type SpaceRepository, type SpaceTreeSnapshot } from "../spaces/index.js";
import { resolveConversationSpaceAccess } from "./space-agent-access.js";

test("conversation Space access freezes only the owning Space local references", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] };
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
    reference: { kind: "local_file", path: "C:/space-one/note.md" },
  });
  await spaces.commands.addReference({
    spaceId: first.id,
    title: "对话",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  });
  await spaces.commands.addReference({
    spaceId: second.id,
    title: "二号目录",
    reference: { kind: "managed_folder", path: "C:/space-two" },
  });

  const access = await resolveConversationSpaceAccess(spaces, "conversation-1", {
    contextRefs: [{ attachmentId: `space-reference:${firstFile.id}`, ref: "local-file:C:/forged.md", kind: "file" }],
    permissionBoundaryRefs: ["read:web"],
  });

  assert.equal(access.spaceId, first.id);
  assert.deepEqual(access.taskSoilInput?.contextRefs, [{
    attachmentId: `space-reference:${firstFile.id}`,
    ref: "local-file:C:/space-one/note.md",
    kind: "file",
    title: "一号文件",
    summary: "当前对话所属空间授权的本地资源。",
  }]);
  assert.deepEqual(access.taskSoilInput?.permissionBoundaryRefs, [
    "read:local-file:C:/space-one/note.md",
    `write:space-reference:${firstFile.id}`,
    "read:web",
  ]);
});

test("unavailable references are excluded from frozen Space access", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] };
  let id = 0;
  const spaces = createSpaceFeature({
    repository: {
      async read() { return structuredClone(snapshot); },
      async write(value) { snapshot = structuredClone(value); },
    },
    idFactory: () => `id-${++id}`,
  });
  const space = await spaces.commands.createSpace({ title: "一" });
  const missing = await spaces.commands.addReference({
    spaceId: space.id,
    title: "已失联文件",
    reference: { kind: "local_file", path: "C:/space-one/gone.md" },
  });
  const present = await spaces.commands.addReference({
    spaceId: space.id,
    title: "在位文件",
    reference: { kind: "local_file", path: "C:/space-one/here.md" },
  });
  await spaces.commands.addReference({
    spaceId: space.id,
    title: "对话",
    reference: { kind: "conversation", conversationId: "conversation-1" },
  });
  await spaces.commands.markReferenceStatus({ itemId: missing.id, status: "unavailable" });

  const access = await resolveConversationSpaceAccess(spaces, "conversation-1", undefined);

  // An unavailable source cannot be read or written, so granting it would hand the
  // model an authorization that only fails at execution time.
  assert.deepEqual(access.taskSoilInput?.contextRefs?.map((ref) => ref.attachmentId), [
    `space-reference:${present.id}`,
  ]);
  assert.deepEqual(access.taskSoilInput?.permissionBoundaryRefs, [
    "read:local-file:C:/space-one/here.md",
    `write:space-reference:${present.id}`,
  ]);
});

test("unassigned conversations keep their submitted Task Soil unchanged", async () => {
  const spaces = createSpaceFeature({
    repository: {
      async read() { return { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] }; },
      async write() { return undefined; },
    },
  });
  const submitted = { permissionBoundaryRefs: ["read:web"] } as const;
  assert.deepEqual(await resolveConversationSpaceAccess(spaces, "conversation-1", submitted), {
    taskSoilInput: submitted,
  });
});
