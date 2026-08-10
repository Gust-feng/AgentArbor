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
    schemaVersion: "space-tree/v5" as const,
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
    }, {
      id: "reference-workspace",
      spaceId: "space-one",
      title: "外部工作区",
      reference: { kind: "workspace_folder", path: "C:/work" },
      sourceIdentity: "device:file-id",
      createdAt: "2026-01-03",
      updatedAt: "2026-01-03",
    }],
  };
  assert.deepEqual((await repository.read()).spaces, []);
  await repository.write(snapshot);
  assert.deepEqual((await repository.read()).spaces[0], snapshot.spaces[0]);
  assert.deepEqual((await repository.read()).referenceItems.map((item) => item.id), ["reference-top", "reference-bottom", "reference-workspace"]);
  assert.deepEqual((await repository.read()).referenceItems[0], snapshot.referenceItems[0]);
  assert.deepEqual((await repository.read()).referenceItems[2], snapshot.referenceItems[2]);

  await repository.write({ ...snapshot, spaces: [{ ...snapshot.spaces[0], title: "新标题" }] });
  assert.deepEqual((await repository.read()).spaces[0], {
    ...snapshot.spaces[0],
    title: "新标题",
  });
});

test("SpaceTree migration removes legacy unavailable references", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-sqlite-status-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  database.connection.exec(`
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      demo_dataset TEXT CHECK(demo_dataset IN ('learning-workspace'))
    ) STRICT;
    CREATE TABLE space_references (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reference_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      parent_id TEXT REFERENCES space_references(id) ON DELETE CASCADE,
      status TEXT CHECK(status IN ('available', 'unavailable')),
      unavailable_at TEXT
    ) STRICT;
    CREATE INDEX space_references_space_idx ON space_references(space_id);
    INSERT INTO spaces(id, title, demo_dataset, created_at, updated_at)
      VALUES ('space-one', '项目', NULL, '2026-08-06', '2026-08-06');
    INSERT INTO space_references(
      id, space_id, title, parent_id, reference_json, status, unavailable_at, created_at, updated_at
    ) VALUES (
      'reference-missing', 'space-one', '已失联工作区', NULL,
      '{"kind":"workspace_folder","path":"C:/gone"}', 'unavailable', '2026-08-06T01:00:00.000Z',
      '2026-08-06', '2026-08-06'
    );
    INSERT INTO schema_migrations(owner, version, applied_at)
      VALUES ('spaces', 4, '2026-08-06');
  `);

  const migrated = createSqliteSpaceRepository(database);

  assert.deepEqual((await migrated.read()).referenceItems, []);
});

test("SpaceTree SQLite repository round-trips annotations after migration v7", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-spaces-sqlite-annotation-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const repository = createSqliteSpaceRepository(database);
  const annotation = {
    markdown: "# Agent 整理",
    keyPoints: ["要点"],
    tags: ["深度学习"],
    revision: 2,
    updatedAt: "2026-08-11T00:00:00.000Z",
    updatedBy: "agent" as const,
  };
  const snapshot: SpaceTreeSnapshot = {
    schemaVersion: "space-tree/v5" as const,
    spaces: [{ id: "space-one", title: "学习空间", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    referenceItems: [{
      id: "reference-annotated",
      spaceId: "space-one",
      title: "特征可视化",
      reference: { kind: "web_page", url: "https://distill.pub/2017/feature-visualization" },
      annotation,
      createdAt: "2026-01-02",
      updatedAt: "2026-01-02",
    }, {
      id: "reference-bare",
      spaceId: "space-one",
      title: "无注释引用",
      reference: { kind: "web_page", url: "https://example.com" },
      createdAt: "2026-01-03",
      updatedAt: "2026-01-03",
    }],
  };
  await repository.write(snapshot);
  const read = await repository.read();
  assert.deepEqual(read.referenceItems[0].annotation, annotation);
  assert.equal(read.referenceItems[1].annotation, undefined);
});
