import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createSqlitePersonalKnowledgeRepository } from "../personal-knowledge/index.js";
import { createSqliteSpaceRepository } from "../spaces/index.js";
import {
  applyPendingWorkbenchRestore,
  createWorkbenchDataMaintenance,
} from "./workbench-data-maintenance.js";

test("Workbench data maintenance backs up, stages and atomically applies a validated restore", async (t) => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-data-"));
  t.after(() => rm(runtimeHome, { recursive: true, force: true }));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const restorePath = path.join(runtimeHome, "selected.sqlite3");
  const current = new SqliteRuntimeDatabase(currentPath);
  createSqliteSpaceRepository(current);
  createSqlitePersonalKnowledgeRepository(current);
  current.connection.exec("CREATE TABLE restore_probe(value TEXT NOT NULL) STRICT; INSERT INTO restore_probe(value) VALUES ('current')");
  const selected = new SqliteRuntimeDatabase(restorePath);
  createSqliteSpaceRepository(selected);
  createSqlitePersonalKnowledgeRepository(selected);
  selected.connection.exec("CREATE TABLE restore_probe(value TEXT NOT NULL) STRICT; INSERT INTO restore_probe(value) VALUES ('restored')");
  selected.close();

  const maintenance = createWorkbenchDataMaintenance({
    database: current,
    runtimeHome,
    restorePicker: async () => restorePath,
  });
  assert.equal(maintenance.health().ok, true);
  const [backup, concurrentBackup] = await Promise.all([
    maintenance.createBackup(),
    maintenance.createBackup(),
  ]);
  assert.equal(existsSync(backup.filePath), true);
  assert.equal(backup.byteLength > 0, true);
  assert.notEqual(concurrentBackup.filePath, backup.filePath);

  const staged = await maintenance.selectAndStageRestore();
  assert.equal(staged.status, "staged");
  assert.equal(maintenance.health().pendingRestore, true);
  current.close();

  applyPendingWorkbenchRestore(runtimeHome);
  const restored = new SqliteRuntimeDatabase(currentPath);
  assert.equal(restored.connection.prepare("SELECT value FROM restore_probe").get()?.value, "restored");
  restored.close();
});
