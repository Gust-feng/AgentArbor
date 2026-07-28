import assert from "node:assert/strict";
import test from "node:test";

import type { ToolExecutor } from "../../domain/tools/index.js";
import { createSpaceFeature } from "./space-feature.js";
import { createSpaceToolRegistryContribution, createSpaceTools } from "./space-tools.js";
import type { SpaceRepository, SpaceTreeSnapshot } from "./contracts.js";

function toolsFixture() {
  let snapshot: SpaceTreeSnapshot = { schemaVersion: "space-tree/v1", spaces: [], folders: [], referenceItems: [] };
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
  assert.deepEqual([...tools.keys()], ["SpaceList", "SpaceCreate", "SpaceCreateFolder", "SpaceMove", "SpaceAddReference", "SpaceRemoveReference", "SpaceRename"]);
  for (const tool of tools.values()) {
    assert.equal(tool.definition.inputSchema.type, "object");
    assert.equal(tool.definition.metadata?.requiresConfirmation, false);
  }
  assert.match(tools.get("SpaceRemoveReference")!.definition.description, /does not delete/u);
});

test("Space contribution contributes all executors without owning ToolCenter assembly", () => {
  const { spaces } = toolsFixture();
  const names: string[] = [];
  createSpaceToolRegistryContribution({ spaces })((entry) => names.push(entry.executor.definition.name));
  assert.deepEqual(names, ["SpaceList", "SpaceCreate", "SpaceCreateFolder", "SpaceMove", "SpaceAddReference", "SpaceRemoveReference", "SpaceRename"]);
});

test("Space tools organize references and preserve Ordinary conversation ownership", async () => {
  const { spaces, tools } = toolsFixture();
  const created = await execute(tools.get("SpaceCreate")!, { title: "工作" }) as { space: { id: string } };
  const spaceId = created.space.id;
  const folder = await execute(tools.get("SpaceCreateFolder")!, { spaceId, title: "会话" }) as { folder: { id: string } };
  const added = await execute(tools.get("SpaceAddReference")!, {
    spaceId, parentFolderId: folder.folder.id, title: "当前对话", reference: { kind: "conversation", conversationId: "ordinary-conversation-1", conversationTitle: "讨论" },
  }) as { item: { id: string } };
  assert.deepEqual(await execute(tools.get("SpaceRename")!, { targetKind: "reference", targetId: added.item.id, title: "已整理的对话" }), { status: "renamed", target: { kind: "reference", id: added.item.id }, title: "已整理的对话" });
  assert.deepEqual(await execute(tools.get("SpaceRemoveReference")!, { itemId: added.item.id }), { status: "removed", itemId: added.item.id });
  assert.deepEqual(await execute(tools.get("SpaceList")!, { spaceId }), {
    status: "found",
    tree: {
      space: { id: spaceId, title: "工作", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" },
      entries: [{ kind: "folder", folder: { id: folder.folder.id, spaceId, title: "会话", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" }, children: [] }],
    },
  });
  await spaces.release();
});

test("Space tools return malformed and missing user inputs as factual outputs", async () => {
  const { spaces, tools } = toolsFixture();
  assert.deepEqual(await execute(tools.get("SpaceAddReference")!, { spaceId: "x", title: "bad", reference: { kind: "conversation" } }), {
    status: "invalid_input", message: "spaceId, title and a valid reference are required; parentFolderId must be omitted or a string.",
  });
  assert.deepEqual(await execute(tools.get("SpaceCreateFolder")!, { spaceId: "missing", title: "folder" }), {
    status: "space_not_found", message: "Space missing was not found",
  });
  await spaces.release();
});
