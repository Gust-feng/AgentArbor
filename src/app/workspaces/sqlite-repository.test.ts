import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceSnapshot } from "./contracts.js";
import { createSqliteWorkspaceRepository } from "./sqlite-repository.js";

test("Workspace snapshot 在 SQLite 中完整 round-trip", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-workspaces-sqlite-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const repository = createSqliteWorkspaceRepository(database);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const snapshot: WorkspaceSnapshot = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaces: [
      { id: "ws-1", title: "AgentArbor", status: "available", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "ws-2", title: "Docs", status: "disconnected", createdAt: "2026-01-02", updatedAt: "2026-01-02" },
    ],
    mounts: [
      {
        workspaceId: "ws-1",
        mountVersion: "m-1",
        rootPath: "Z:\\AgentArbor",
        sourceIdentity: "dev:ino",
        status: "active",
        connectedAt: "2026-01-01",
      },
      {
        workspaceId: "ws-2",
        mountVersion: "m-1",
        rootPath: "Z:\\Docs",
        sourceIdentity: "dev:ino-2",
        status: "invalidated",
        connectedAt: "2026-01-02",
        invalidatedAt: "2026-01-03",
      },
    ],
    links: [
      {
        linkId: "link-1",
        spaceId: "space-1",
        workspaceId: "ws-1",
        mountVersion: "m-1",
        status: "active",
        createdAt: "2026-01-01",
      },
      {
        linkId: "link-2",
        spaceId: "space-1",
        workspaceId: "ws-2",
        mountVersion: "m-1",
        status: "revoked",
        createdAt: "2026-01-02",
        revokedAt: "2026-01-03",
      },
    ],
  };
  assert.deepEqual((await repository.read()).workspaces, []);
  await repository.write(snapshot);
  assert.deepEqual(await repository.read(), snapshot);
});
