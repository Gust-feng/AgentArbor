import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { spaceReferenceAttachmentId } from "./space-file-access.js";
import { createSpaceFeature } from "./space-feature.js";
import { createSpaceRevocationOverlay, createSpaceToolRegistryContribution, createSpaceTools } from "./space-tools.js";
import type { SpaceReference, SpaceRepository, SpaceTreeSnapshot } from "./contracts.js";

function toolsFixture() {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v4", spaces: [], referenceItems: [] };
  const repository: SpaceRepository = {
    async read() { return structuredClone(snapshot); },
    async write(next) { snapshot = structuredClone(next); },
  };
  let id = 0;
  const spaces = createSpaceFeature({ repository, idFactory: () => `id-${++id}`, now: () => "2026-07-28T00:00:00.000Z" });
  return {
    spaces,
    tools: new Map(createSpaceTools({ spaces, workspaceRoot: path.resolve(".") }).map((entry) => [entry.definition.name, entry])),
  };
}

const context = { callerAgentId: "agent", traceId: "trace", goalId: "goal" };
async function execute(tool: ToolExecutor, input: unknown): Promise<unknown> { return tool.execute(input, context); }

test("Space tools expose the complete factual operation set and object-root schemas", () => {
  const { tools } = toolsFixture();
  assert.deepEqual([...tools.keys()], ["SpaceList", "SpaceCreate", "SpaceDelete", "ConversationDelete", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename"]);
  for (const tool of tools.values()) {
    assert.equal(tool.definition.inputSchema.type, "object");
    assert.equal(tool.definition.metadata?.requiresConfirmation, ["SpaceDelete", "ConversationDelete", "SpaceRemoveReference"].includes(tool.definition.name));
  }
  assert.match(tools.get("SpaceRemoveReference")!.definition.description, /Delete a Space-owned material/u);
  assert.equal(tools.get("SpaceUnlinkReference")!.definition.metadata?.requiresConfirmation, false);
});

test("Space contribution contributes all executors without owning ToolCenter assembly", () => {
  const { spaces } = toolsFixture();
  const names: string[] = [];
  createSpaceToolRegistryContribution({ spaces, workspaceRoot: path.resolve(".") })((entry) => names.push(entry.executor.definition.name));
  assert.deepEqual(names, ["SpaceList", "SpaceCreate", "SpaceDelete", "ConversationDelete", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename"]);
});

test("Space and Conversation deletion tools require confirmation and use Host callbacks", async () => {
  const { spaces, tools } = toolsFixture();
  const calls: string[] = [];
  const withDeletion = new Map(createSpaceTools({
    spaces,
    workspaceRoot: path.resolve("."),
    deleteSpace: async (spaceId) => { calls.push(`space:${spaceId}`); },
    deleteConversation: async (conversationId) => { calls.push(`conversation:${conversationId}`); },
  }).map((entry) => [entry.definition.name, entry]));
  assert.equal(withDeletion.get("SpaceDelete")!.definition.metadata?.requiresConfirmation, true);
  assert.equal(withDeletion.get("ConversationDelete")!.definition.metadata?.requiresConfirmation, true);
  assert.deepEqual(await execute(withDeletion.get("SpaceDelete")!, { spaceId: "space-1" }), { status: "deleted", spaceId: "space-1" });
  assert.deepEqual(await execute(withDeletion.get("ConversationDelete")!, { conversationId: "conversation-1" }), { status: "deleted", conversationId: "conversation-1" });
  assert.deepEqual(calls, ["space:space-1", "conversation:conversation-1"]);
  await spaces.release();
});

test("an unlinked Space reference joins the live deny overlay", async () => {
  const { spaces } = toolsFixture();
  const space = await spaces.commands.createSpace({ title: "工作" });
  const reference = await spaces.commands.addReference({
    spaceId: space.id,
    title: "已失联文件",
    reference: { kind: "local_file", path: "C:/workspace/gone.md" },
  });
  const overlay = createSpaceRevocationOverlay(spaces.events);

  await spaces.commands.unlinkReference(reference.id);

  assert.equal(overlay.has(reference.id), true);
  assert.throws(
    () => overlay.assertReadAllowed(spaceReferenceAttachmentId(reference.id)),
    /no longer readable/,
  );
  overlay.dispose();
  await spaces.release();
});

test("Space tools cannot mutate a Conversation owner through generic reference operations", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const spaceId = created.space.id;
  const owner = await spaces.commands.linkConversationOwner({
    spaceId,
    title: "当前对话",
    conversationId: "ordinary-conversation-1",
    conversationTitle: "讨论",
  });
  assert.deepEqual(await execute(tools.get("SpaceRename")!, { targetKind: "reference", targetId: owner.id, title: "已整理的对话" }), {
    status: "space_conversation_owner_immutable",
    itemId: owner.id,
    message: "Conversation ownership cannot be renamed as a generic Space reference.",
  });
  assert.deepEqual(await execute(tools.get("SpaceUnlinkReference")!, { itemId: owner.id }), {
    status: "space_conversation_owner_immutable",
    itemId: owner.id,
    referenceKind: "conversation",
    message: "Conversation ownership can only be changed by creating or deleting the Conversation.",
  });
  assert.notEqual((await execute(tools.get("SpaceList")!, { spaceId }) as { tree: { entries: unknown[] } }).tree.entries.length, 0);
  await spaces.release();
});

test("Space remove tool rejects non-owned sources and directs them to unlink", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const added = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "外部目录",
    reference: { kind: "workspace_folder", path: "C:/workspace" },
  });

  assert.deepEqual(await execute(tools.get("SpaceRemoveReference")!, { itemId: added.id }), {
    status: "reference_delete_unavailable",
    itemId: added.id,
    referenceKind: "workspace_folder",
    message: "This external reference can only be unlinked; its source cannot be deleted by SpaceRemoveReference.",
  });
  assert.notEqual(await spaces.queries.getReference(added.id), undefined);
  await spaces.release();
});

test("SpaceMove only moves Space-owned materials, never external references", async () => {
  const { spaces, tools } = toolsFixture();
  const source = await execute(tools.get("SpaceCreate")!, { title: "源空间" }) as { space: { id: string } };
  const destination = await execute(tools.get("SpaceCreate")!, { title: "目标空间" }) as { space: { id: string } };
  const external = await spaces.commands.addReference({
    spaceId: source.space.id,
    title: "外部目录",
    reference: { kind: "workspace_folder", path: "C:/workspace" },
  });
  assert.deepEqual(await execute(tools.get("SpaceMove")!, {
    targetKind: "reference",
    targetId: external.id,
    destinationSpaceId: destination.space.id,
  }), {
    status: "space_reference_move_unavailable",
    itemId: external.id,
    referenceKind: "workspace_folder",
    message: "External file/folder references and Conversation owners cannot be moved.",
  });
  const material = await spaces.commands.addReference({
    spaceId: source.space.id,
    title: "内部目录",
    reference: { kind: "asset_folder" },
  });
  assert.deepEqual(await execute(tools.get("SpaceMove")!, {
    targetKind: "reference",
    targetId: material.id,
    destinationSpaceId: destination.space.id,
  }), { status: "moved", target: { kind: "reference", id: material.id }, destinationSpaceId: destination.space.id });
  await spaces.release();
});

test("Space tools return malformed and missing user inputs as factual outputs", async () => {
  const { spaces, tools } = toolsFixture();
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "x", title: "bad", reference: { kind: "conversation" } }), {
    status: "invalid_input", message: "spaceId, title and a valid reference are required.",
  });
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "missing", title: "conversation", reference: { kind: "conversation", conversationId: "conversation-1" } }), {
    status: "invalid_input", message: "spaceId, title and a valid reference are required.",
  });
  await spaces.release();
});

test("SpaceAddReference returns duplicate path conflicts as a structured result", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-conflict-"));
  t.after(() => removeTestDirectory(root));
  const file = path.join(root, "note.md");
  await fs.writeFile(file, "note", "utf8");
  const { spaces } = toolsFixture();
  const space = await spaces.commands.createSpace({ title: "工作" });
  await spaces.commands.addReference({ spaceId: space.id, title: "已有", reference: { kind: "local_file", path: file } });
  const taskSoil = createTaskSoil({
    rawGoal: "add duplicate",
    contextRefs: [{ attachmentId: "file", ref: `local-file:${file}`, kind: "file" }],
    permissionBoundaryRefs: [`read:local-file:${file}`],
  });
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: root, taskSoil }).map((entry) => [entry.definition.name, entry]));
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, {
    spaceId: space.id,
    title: "重复",
    reference: { kind: "local_attachment", attachmentId: "file" },
  }), {
    status: "space_workspace_mount_conflict",
    message: "This filesystem path is already linked to this Space",
  });
  await spaces.release();
});


test("SpaceAddReference persists only authorized current Task Soil attachments", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-add-reference-"));
  t.after(() => removeTestDirectory(root));
  const allowedFile = path.join(root, "allowed.md");
  const deniedFolder = path.join(root, "denied");
  const { spaces } = toolsFixture();
  const space = await spaces.commands.createSpace({ title: "工作" });
  const taskSoil = createTaskSoil({
    rawGoal: "organize the attached file",
    contextRefs: [
      { attachmentId: "ctx-file", ref: `local-file:${allowedFile}`, kind: "file" },
      { attachmentId: "ctx-folder", ref: `local-project:${deniedFolder}`, kind: "project" },
      { attachmentId: "ctx-relative", ref: "local-file:relative.md", kind: "file" },
    ],
    permissionBoundaryRefs: [`read:local-file:${allowedFile}`, "read:local-file:relative.md"],
  });
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: root, taskSoil }).map((entry) => [entry.definition.name, entry]));
  const addReference = tools.get("SpaceAddReference")!;

  assert.deepEqual(await execute(addReference, {
    spaceId: space.id,
    title: "伪造路径",
    reference: { kind: "local_file", path: path.join(root, "forged.md") },
  }), {
    status: "invalid_input",
    message: "spaceId, title and a valid reference are required.",
  });
  assert.deepEqual(await execute(addReference, {
    spaceId: space.id,
    title: "未知附件",
    reference: { kind: "local_attachment", attachmentId: "ctx-missing" },
  }), {
    status: "space_reference_attachment_not_found",
    attachmentId: "ctx-missing",
    message: "No current Task Soil attachment matched this attachmentId.",
  });
  assert.deepEqual(await execute(addReference, {
    spaceId: space.id,
    title: "未授权目录",
    reference: { kind: "local_attachment", attachmentId: "ctx-folder" },
  }), {
    status: "space_reference_attachment_not_authorized",
    attachmentId: "ctx-folder",
    message: "The selected attachment is not authorized for reading in this run.",
  });
  assert.deepEqual(await execute(addReference, {
    spaceId: space.id,
    title: "相对路径",
    reference: { kind: "local_attachment", attachmentId: "ctx-relative" },
  }), {
    status: "space_reference_attachment_unsupported",
    attachmentId: "ctx-relative",
    message: "This context attachment cannot be inspected by local attachment tools.",
  });

  const added = await execute(addReference, {
    spaceId: space.id,
    title: "已授权文件",
    reference: { kind: "local_attachment", attachmentId: "ctx-file" },
  }) as { readonly status: string; readonly item: { readonly reference: SpaceReference } };
  assert.equal(added.status, "added");
  assert.deepEqual(added.item.reference, { kind: "local_file", path: allowedFile });
  await spaces.release();
});
