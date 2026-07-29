import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createSqliteSpaceRepository, importLegacySpaceSnapshot } from "./sqlite-repository.js";

test("SpaceTree imports the legacy JSON snapshot once and then uses SQLite", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-sqlite-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const repository = createSqliteSpaceRepository(database);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const snapshot = {
    schemaVersion: "space-tree/v1" as const,
    spaces: [{ id: "space-one", title: "学习空间", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    folders: [],
    referenceItems: [],
  };
  assert.equal(importLegacySpaceSnapshot(database, snapshot), true);
  assert.equal(importLegacySpaceSnapshot(database, { ...snapshot, spaces: [] }), false);
  assert.deepEqual((await repository.read()).spaces[0], {
    ...snapshot.spaces[0],
    demoDataset: "learning-workspace",
  });

  await repository.write({ ...snapshot, spaces: [{ ...snapshot.spaces[0], title: "新标题", demoDataset: "learning-workspace" }] });
  assert.deepEqual((await repository.read()).spaces[0], {
    ...snapshot.spaces[0],
    title: "新标题",
    demoDataset: "learning-workspace",
  });
});
