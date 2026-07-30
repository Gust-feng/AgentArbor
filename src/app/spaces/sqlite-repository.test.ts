import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createSqliteSpaceRepository } from "./sqlite-repository.js";
import type { SpaceTreeSnapshot } from "./contracts.js";

test("SpaceTree persists its current SQLite snapshot without inferring demo data", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-sqlite-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const repository = createSqliteSpaceRepository(database);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const snapshot: SpaceTreeSnapshot = {
    schemaVersion: "space-tree/v3" as const,
    spaces: [{ id: "space-one", title: "学习空间", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    referenceItems: [{
      id: "reference-top",
      spaceId: "space-one",
      title: "顶部项目",
      parentId: "reference-bottom",
      reference: { kind: "workbench_asset", assetId: "asset-top" },
      createdAt: "2026-01-02",
      updatedAt: "2026-01-02",
    }, {
      id: "reference-bottom",
      spaceId: "space-one",
      title: "底部项目",
      reference: { kind: "asset_folder" },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }],
  };
  assert.deepEqual((await repository.read()).spaces, []);
  await repository.write(snapshot);
  assert.deepEqual((await repository.read()).spaces[0], snapshot.spaces[0]);
  assert.deepEqual((await repository.read()).referenceItems.map((item) => item.id), ["reference-top", "reference-bottom"]);
  assert.deepEqual((await repository.read()).referenceItems[0], snapshot.referenceItems[0]);

  await repository.write({ ...snapshot, spaces: [{ ...snapshot.spaces[0], title: "新标题" }] });
  assert.deepEqual((await repository.read()).spaces[0], {
    ...snapshot.spaces[0],
    title: "新标题",
  });
});
