import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SPACE_TREE_SCHEMA_VERSION, SpaceFeatureError, type SpaceTreeSnapshot } from "./contracts.js";
import { createFileSystemSpaceRepository } from "./file-system-repository.js";

async function root(t: test.TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-repository-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return directory;
}

function snapshot(): SpaceTreeSnapshot {
  return {
    schemaVersion: SPACE_TREE_SCHEMA_VERSION,
    spaces: [{ id: "space-1", title: "Space", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" }],
    folders: [{ id: "folder-1", spaceId: "space-1", title: "Folder", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" }],
    referenceItems: [{ id: "ref-1", spaceId: "space-1", parentFolderId: "folder-1", title: "Conversation", reference: { kind: "conversation", conversationId: "ordinary-9" }, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" }],
  };
}

test("filesystem Space repository starts empty and round-trips one versioned snapshot", async (t) => {
  const directory = await root(t);
  const repository = createFileSystemSpaceRepository(directory);
  assert.deepEqual(await repository.read(), { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], folders: [], referenceItems: [] });
  await repository.write(snapshot());
  assert.deepEqual(await createFileSystemSpaceRepository(directory).read(), snapshot());
});

test("filesystem Space repository fails clearly for malformed hierarchy and stored JSON", async (t) => {
  const directory = await root(t);
  const repository = createFileSystemSpaceRepository(directory);
  const invalid = snapshot();
  const invalidFolder = { ...invalid.folders[0]!, parentFolderId: "missing" };
  await assert.rejects(repository.write({ ...invalid, folders: [invalidFolder] }), (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_snapshot_incompatible");

  await fs.writeFile(path.join(directory, "space-tree.json"), "{ invalid json", "utf8");
  await assert.rejects(repository.read(), (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_snapshot_incompatible");
});
