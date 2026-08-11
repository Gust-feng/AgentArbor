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
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v5", spaces: [], referenceItems: [] };
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
  assert.deepEqual([...tools.keys()], ["SpaceList", "SpaceCreate", "SpaceDelete", "ConversationDelete", "SpaceMove", "SpaceAddReference", "SpaceReadReference", "SpaceUpdateReferenceAnnotation", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename"]);
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
  assert.deepEqual(names, ["SpaceList", "SpaceCreate", "SpaceDelete", "ConversationDelete", "SpaceMove", "SpaceAddReference", "SpaceReadReference", "SpaceUpdateReferenceAnnotation", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename"]);
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

test("SpaceAddReference saves an Agent annotation on first write and reports annotationStatus", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const annotation = {
    markdown: "# 特征可视化\n\n通过优化输入观察神经元激活。",
    keyPoints: ["通过优化输入观察神经元激活", "深层网络表示更抽象的概念"],
    tags: ["深度学习", "可视化"],
  };
  const result = await execute(tools.get("SpaceAddReference")!, {
    spaceId: created.space.id,
    title: "Distill：特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation,
  }) as { readonly status: string; readonly annotationStatus: string; readonly item: { readonly annotation: unknown } };
  assert.equal(result.status, "added");
  assert.equal(result.annotationStatus, "written");
  assert.deepEqual(result.item.annotation, {
    ...annotation,
    revision: 1,
    updatedAt: "2026-07-28T00:00:00.000Z",
    updatedBy: "agent",
  });
  assert.equal("actor" in (result.item.annotation as object), false, "model projection must not expose audit actor fields");
  await spaces.release();
});

test("SpaceAddReference without annotation reports annotationStatus missing and stores no body", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "阅读" }) as { space: { id: string } };
  const result = await execute(tools.get("SpaceAddReference")!, {
    spaceId: created.space.id,
    title: "无法读取的网页",
    reference: { kind: "web_page", url: "https://example.com/private" },
  }) as { readonly status: string; readonly annotationStatus: string; readonly item: { readonly annotation?: unknown; readonly reference: SpaceReference } };
  assert.equal(result.status, "added");
  assert.equal(result.annotationStatus, "missing");
  assert.equal(result.item.annotation, undefined);
  assert.deepEqual(result.item.reference, { kind: "web_page", url: "https://example.com/private" });
  await spaces.release();
});

test("SpaceAddReference rejects structurally invalid annotation without writing", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const addReference = tools.get("SpaceAddReference")!;
  assert.deepEqual(await execute(addReference, {
    spaceId: created.space.id,
    title: "坏注释",
    reference: { kind: "web_page", url: "https://example.com" },
    annotation: { keyPoints: ["缺少 markdown"] },
  }), { status: "invalid_input", message: "annotation must be an object with a markdown string." });
  assert.deepEqual(await execute(addReference, {
    spaceId: created.space.id,
    title: "坏要点",
    reference: { kind: "web_page", url: "https://example.com" },
    annotation: { markdown: "ok", keyPoints: [42] },
  }), { status: "invalid_input", message: "annotation must be an object with a markdown string." });
  assert.equal((await spaces.queries.getTree(created.space.id))?.entries.length, 0);
  await spaces.release();
});

test("SpaceAddReference executor never performs an implicit web fetch", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const executor = tools.get("SpaceAddReference")!;
  assert.match(executor.definition.description, /never fetches web pages or files implicitly/iu);
  assert.doesNotMatch(JSON.stringify(executor.definition.inputSchema), /webfetch|browser/iu);
  await execute(executor, {
    spaceId: created.space.id,
    title: "网页",
    reference: { kind: "web_page", url: "https://example.com/unreachable" },
  });
  const tree = await spaces.queries.getTree(created.space.id);
  assert.equal(tree?.entries.length, 1);
  await spaces.release();
});

test("SpaceReadReference returns the source and current annotation without touching the web", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const added = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "通过优化输入观察神经元激活。", tags: ["深度学习"] },
    actor: { kind: "agent" },
  });
  const result = await execute(tools.get("SpaceReadReference")!, { itemId: added.id }) as {
    readonly status: string;
    readonly item: { readonly reference: SpaceReference; readonly annotation: { readonly revision: number; readonly markdown: string; readonly tags: readonly string[] } };
  };
  assert.equal(result.status, "found");
  assert.deepEqual(result.item.reference, { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" });
  assert.equal(result.item.annotation.revision, 1);
  assert.equal(result.item.annotation.markdown, "通过优化输入观察神经元激活。");
  assert.deepEqual(result.item.annotation.tags, ["深度学习"]);
  assert.deepEqual(await execute(tools.get("SpaceReadReference")!, { itemId: "missing-reference" }), {
    status: "space_reference_not_found",
    itemId: "missing-reference",
  });
  await spaces.release();
});

test("SpaceUpdateReferenceAnnotation updates content with expectedRevision and keeps absent fields", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const added = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "旧理解", keyPoints: ["旧要点"], tags: ["深度学习"] },
    actor: { kind: "agent" },
  });
  const result = await execute(tools.get("SpaceUpdateReferenceAnnotation")!, {
    itemId: added.id,
    expectedRevision: 1,
    markdown: "新理解：补充与 Transformer 的关系。",
    tags: ["深度学习", "Transformer"],
  }) as { readonly status: string; readonly item: { readonly annotation: { readonly revision: number; readonly markdown: string; readonly keyPoints: readonly string[]; readonly tags: readonly string[]; readonly updatedBy: string } } };
  assert.equal(result.status, "updated");
  assert.equal(result.item.annotation.revision, 2);
  assert.equal(result.item.annotation.markdown, "新理解：补充与 Transformer 的关系。");
  assert.deepEqual(result.item.annotation.keyPoints, ["旧要点"]);
  assert.deepEqual(result.item.annotation.tags, ["深度学习", "Transformer"]);
  assert.equal(result.item.annotation.updatedBy, "agent");
  await spaces.release();
});

test("SpaceUpdateReferenceAnnotation rejects stale revisions and empty patches as structured results", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const added = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "v1 内容" },
    actor: { kind: "agent" },
  });
  const update = tools.get("SpaceUpdateReferenceAnnotation")!;
  assert.deepEqual(await execute(update, { itemId: added.id, expectedRevision: 2, markdown: "基于过期版本" }), {
    status: "space_reference_annotation_revision_conflict",
    message: "Space reference " + added.id + " annotation revision is 1, expected 2",
  });
  assert.deepEqual(await execute(update, { itemId: added.id, expectedRevision: 1 }), {
    status: "invalid_input",
    message: "At least one content field (markdown, keyPoints or tags) is required.",
  });
  assert.deepEqual(await execute(update, { itemId: "missing", expectedRevision: 1, markdown: "x" }), {
    status: "space_reference_not_found",
    itemId: "missing",
  });
  const current = await spaces.queries.getReference(added.id);
  assert.equal(current?.annotation?.markdown, "v1 内容");
  assert.equal(current?.annotation?.revision, 1);
  await spaces.release();
});

test("SpaceUpdateReferenceAnnotation rejects invalid keyPoints and tags without writing", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const added = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "特征可视化",
    reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
    annotation: { markdown: "v1 内容" },
    actor: { kind: "agent" },
  });
  const update = tools.get("SpaceUpdateReferenceAnnotation")!;
  assert.deepEqual(await execute(update, { itemId: added.id, expectedRevision: 1, markdown: "x", keyPoints: [1] }), {
    status: "invalid_input",
    message: "At least one content field (markdown, keyPoints or tags) is required.",
  });
  assert.deepEqual(await execute(update, { itemId: added.id, expectedRevision: 1, keyPoints: "not-an-array" }), {
    status: "invalid_input",
    message: "At least one content field (markdown, keyPoints or tags) is required.",
  });
  const current = await spaces.queries.getReference(added.id);
  assert.equal(current?.annotation?.revision, 1);
  await spaces.release();
});

test("SpaceList tree and reference tools never expose source identities or audit fields", async () => {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v5", spaces: [], referenceItems: [] };
  let id = 0;
  const feature = createSpaceFeature({
    repository: { async read() { return snapshot; }, async write(value) { snapshot = value; } },
    idFactory: () => `id-${++id}`,
    externalSourceInspector: async () => ({ kind: "file" as const, identity: "device:file-id-42" }),
  });
  const spaces = feature;
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: path.resolve(".") }).map((entry) => [entry.definition.name, entry]));
  const created = await execute(tools.get("SpaceCreate")!, { title: "机器学习" }) as { space: { id: string } };
  const parent = await spaces.commands.addReference({
    spaceId: created.space.id,
    title: "资料文件夹",
    reference: { kind: "asset_folder" },
  });
  const child = await spaces.commands.addReference({
    spaceId: created.space.id,
    parentId: parent.id,
    title: "本地文件",
    reference: { kind: "local_file", path: "C:/workspace/note.md" },
    annotation: { markdown: "整理内容", tags: ["资料"] },
    actor: { kind: "agent", actorId: "agent", traceId: "trace", goalId: "goal", toolCallId: "call-1" },
  });

  const listed = await execute(tools.get("SpaceList")!, { spaceId: created.space.id }) as {
    readonly tree: { readonly entries: readonly { readonly item: Record<string, unknown> & { readonly annotation: Record<string, unknown> } }[] };
  };
  assert.equal(listed.tree.entries.length, 2);
  const listedParent = listed.tree.entries.find((entry) => entry.item.itemId === parent.id)!.item;
  const listedChild = listed.tree.entries.find((entry) => entry.item.itemId === child.id)!.item;
  assert.equal("parentId" in listedParent, false);
  assert.equal(listedChild.parentId, parent.id);
  assert.equal("sourceIdentity" in listedChild, false);
  assert.equal("actor" in listedChild.annotation, false);
  assert.equal(listedChild.annotation.revision, 1);

  const read = await execute(tools.get("SpaceReadReference")!, { itemId: child.id }) as {
    readonly item: Record<string, unknown> & { readonly annotation: Record<string, unknown> };
  };
  assert.equal(read.item.itemId, child.id);
  assert.equal(read.item.parentId, parent.id);
  assert.equal("sourceIdentity" in read.item, false);
  assert.equal("actor" in read.item.annotation, false);
  await spaces.release();
});
