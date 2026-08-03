import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { createSpaceFeature } from "./space-feature.js";
import { createSpaceToolRegistryContribution, createSpaceTools } from "./space-tools.js";
import type { SpaceReference, SpaceRepository, SpaceTreeSnapshot } from "./contracts.js";

function toolsFixture() {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] };
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
  assert.deepEqual([...tools.keys()], ["SpaceList", "SpaceCreate", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename", "SpaceWrite", "SpaceEdit"]);
  for (const tool of tools.values()) {
    assert.equal(tool.definition.inputSchema.type, "object");
    assert.equal(tool.definition.metadata?.requiresConfirmation, tool.definition.name === "SpaceRemoveReference");
  }
  assert.match(tools.get("SpaceRemoveReference")!.definition.description, /Physically delete/u);
  assert.equal(tools.get("SpaceUnlinkReference")!.definition.metadata?.requiresConfirmation, false);
});

test("Space contribution contributes all executors without owning ToolCenter assembly", () => {
  const { spaces } = toolsFixture();
  const names: string[] = [];
  createSpaceToolRegistryContribution({ spaces, workspaceRoot: path.resolve(".") })((entry) => names.push(entry.executor.definition.name));
  assert.deepEqual(names, ["SpaceList", "SpaceCreate", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename", "SpaceWrite", "SpaceEdit"]);
});

test("Space file tools stay out of an execution catalog without a frozen grant", () => {
  const { spaces } = toolsFixture();
  const tools = createSpaceTools({ spaces, workspaceRoot: path.resolve("."), taskSoil: createTaskSoil({ rawGoal: "ordinary chat" }) });
  assert.deepEqual(tools.map((tool) => tool.definition.name), [
    "SpaceList",
    "SpaceCreate",
    "SpaceMove",
    "SpaceAddReference",
    "SpaceUnlinkReference",
    "SpaceRemoveReference",
    "SpaceRename",
  ]);
});

test("Space tools organize references and preserve Ordinary conversation ownership", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const spaceId = created.space.id;
  const added = await execute(tools.get("SpaceAddReference")!, {
    spaceId, title: "当前对话", reference: { kind: "conversation", conversationId: "ordinary-conversation-1", conversationTitle: "讨论" },
  }) as { item: { id: string } };
  assert.deepEqual(await execute(tools.get("SpaceRename")!, { targetKind: "reference", targetId: added.item.id, title: "已整理的对话" }), { status: "renamed", target: { kind: "reference", id: added.item.id }, title: "已整理的对话" });
  assert.deepEqual(await execute(tools.get("SpaceUnlinkReference")!, { itemId: added.item.id }), { status: "unlinked", itemId: added.item.id });
  assert.deepEqual(await execute(tools.get("SpaceList")!, { spaceId }), {
    status: "found",
    tree: {
      space: { id: spaceId, title: "工作", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" },
      entries: [],
    },
  });
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
    message: "This reference can only be unlinked; its source cannot be deleted by SpaceRemoveReference.",
  });
  assert.notEqual(await spaces.queries.getReference(added.id), undefined);
  await spaces.release();
});

test("Space tools return malformed and missing user inputs as factual outputs", async () => {
  const { spaces, tools } = toolsFixture();
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "x", title: "bad", reference: { kind: "conversation" } }), {
    status: "invalid_input", message: "spaceId, title and a valid reference are required.",
  });
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "missing", title: "conversation", reference: { kind: "conversation", conversationId: "conversation-1" } }), {
    status: "space_not_found", message: "Space missing was not found",
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

test("Space file tools write only references frozen into the current Task Soil", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-tools-"));
  t.after(() => removeTestDirectory(root));
  const allowedFile = path.join(root, "allowed.md");
  const deniedFile = path.join(root, "denied.md");
  await fs.writeFile(allowedFile, "old", "utf8");
  await fs.writeFile(deniedFile, "private", "utf8");
  const { spaces } = toolsFixture();
  const taskSoil = createTaskSoil({
    rawGoal: "edit the Space file",
    contextRefs: [{
      attachmentId: "space-reference:allowed",
      ref: `local-file:${allowedFile}`,
      kind: "file",
    }],
    permissionBoundaryRefs: ["write:space-reference:allowed"],
  });
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: root, taskSoil }).map((entry) => [entry.definition.name, entry]));

  const written = await execute(tools.get("SpaceWrite")!, { referenceId: "space-reference:allowed", content: "new" }) as { changed: boolean };
  assert.equal(written.changed, true);
  assert.equal(await fs.readFile(allowedFile, "utf8"), "new");
  await assert.rejects(
    execute(tools.get("SpaceWrite")!, { referenceId: "denied", content: "changed" }),
    /not writable in this run/u,
  );
  assert.equal(await fs.readFile(deniedFile, "utf8"), "private");
});

test("Space folder grants keep edits relative to their frozen root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-folder-tools-"));
  t.after(() => removeTestDirectory(root));
  const note = path.join(root, "note.md");
  await fs.writeFile(note, "before", "utf8");
  const { spaces } = toolsFixture();
  const taskSoil = createTaskSoil({
    rawGoal: "edit the Space folder",
      contextRefs: [{ attachmentId: "space-reference:folder", ref: `local-project:${root}`, kind: "project" }],
      permissionBoundaryRefs: ["write:space-reference:folder"],
  });
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: root, taskSoil }).map((entry) => [entry.definition.name, entry]));

  await execute(tools.get("SpaceEdit")!, {
    referenceId: "folder",
    path: "note.md",
    edits: [{ oldText: "before", newText: "after" }],
  });
  assert.equal(await fs.readFile(note, "utf8"), "after");
  await assert.rejects(
    execute(tools.get("SpaceWrite")!, { referenceId: "folder", path: "../outside.md", content: "no" }),
    /outside the workspace boundary/u,
  );
});

test("Space file tools reject relative frozen local references instead of resolving them from CWD", async () => {
  const { spaces } = toolsFixture();
  const taskSoil = createTaskSoil({
    rawGoal: "reject an ambiguous Space path",
    contextRefs: [{ attachmentId: "space-reference:relative", ref: "local-file:relative.md", kind: "file" }],
    permissionBoundaryRefs: ["write:space-reference:relative"],
  });
  const tools = new Map(createSpaceTools({ spaces, workspaceRoot: path.resolve("."), taskSoil }).map((entry) => [entry.definition.name, entry]));

  await assert.rejects(
    execute(tools.get("SpaceEdit")!, { referenceId: "relative", edits: [{ oldText: "old", newText: "new" }] }),
    /absolute path/u,
  );
});
