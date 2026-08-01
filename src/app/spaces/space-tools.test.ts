import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { createSpaceFeature } from "./space-feature.js";
import { createSpaceToolRegistryContribution, createSpaceTools } from "./space-tools.js";
import type { SpaceRepository, SpaceTreeSnapshot } from "./contracts.js";

function toolsFixture() {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v3", spaces: [], referenceItems: [] };
  const repository: SpaceRepository = {
    async read() { return structuredClone(snapshot); },
    async write(next) { snapshot = structuredClone(next); },
  };
  let id = 0;
  const spaces = createSpaceFeature({ repository, idFactory: () => `id-${++id}`, now: () => "2026-07-28T00:00:00.000Z" });
  return { spaces, tools: new Map(createSpaceTools({ spaces }).map((entry) => [entry.definition.name, entry])) };
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
  createSpaceToolRegistryContribution({ spaces })((entry) => names.push(entry.executor.definition.name));
  assert.deepEqual(names, ["SpaceList", "SpaceCreate", "SpaceMove", "SpaceAddReference", "SpaceUnlinkReference", "SpaceRemoveReference", "SpaceRename", "SpaceWrite", "SpaceEdit"]);
});

test("Space file tools stay out of an execution catalog without a frozen grant", () => {
  const { spaces } = toolsFixture();
  const tools = createSpaceTools({ spaces, taskSoil: createTaskSoil({ rawGoal: "ordinary chat" }) });
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
  const added = await execute(tools.get("SpaceAddReference")!, {
    spaceId: created.space.id,
    title: "外部目录",
    reference: { kind: "workspace_folder", path: "C:/workspace" },
  }) as { item: { id: string } };

  assert.deepEqual(await execute(tools.get("SpaceRemoveReference")!, { itemId: added.item.id }), {
    status: "reference_delete_unavailable",
    itemId: added.item.id,
    referenceKind: "workspace_folder",
    message: "This reference can only be unlinked; its source cannot be deleted by SpaceRemoveReference.",
  });
  assert.notEqual(await spaces.queries.getReference(added.item.id), undefined);
  await spaces.release();
});

test("Space tools return malformed and missing user inputs as factual outputs", async () => {
  const { spaces, tools } = toolsFixture();
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "x", title: "bad", reference: { kind: "conversation" } }), {
    status: "invalid_input", message: "spaceId, title and a valid reference are required.",
  });
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "missing", title: "file", reference: { kind: "local_file", path: "C:/missing.txt" } }), {
    status: "space_not_found", message: "Space missing was not found",
  });
  await spaces.release();
});

test("Space file tools write only references frozen into the current Task Soil", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-tools-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
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
  const tools = new Map(createSpaceTools({ spaces, taskSoil }).map((entry) => [entry.definition.name, entry]));

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
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const note = path.join(root, "note.md");
  await fs.writeFile(note, "before", "utf8");
  const { spaces } = toolsFixture();
  const taskSoil = createTaskSoil({
    rawGoal: "edit the Space folder",
    contextRefs: [{ attachmentId: "space-reference:folder", ref: `local-project:${root}`, kind: "project" }],
    permissionBoundaryRefs: ["write:space-reference:folder"],
  });
  const tools = new Map(createSpaceTools({ spaces, taskSoil }).map((entry) => [entry.definition.name, entry]));

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
