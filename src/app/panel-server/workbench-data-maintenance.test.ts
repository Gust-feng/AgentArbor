import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createSqlitePersonalKnowledgeRepository } from "../personal-knowledge/index.js";
import { createSqliteSpaceRepository } from "../spaces/index.js";
import { makeTestDirectory, removeTestDirectory } from "../testing/fs-test-directories.js";
import { InMemoryLocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import {
  applyPendingWorkbenchRestore,
  createWorkbenchDataMaintenance,
} from "./workbench-data-maintenance.js";

test("Workbench data maintenance backs up, stages and atomically applies a validated restore", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-data-");
  t.after(() => removeTestDirectory(runtimeHome));
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
  await mkdir(path.join(`${restorePath}.assets`, "knowledge-assets"), { recursive: true });
  await mkdir(path.join(`${restorePath}.assets`, "space-folders"), { recursive: true });
  await writeFile(path.join(`${restorePath}.assets`, "knowledge-assets", "restored.txt"), "restored asset", "utf8");
  await writeFile(path.join(`${restorePath}.assets`, "space-folders", "restored-space.txt"), "restored space file", "utf8");
  await writeFile(`${restorePath}.manifest.json`, JSON.stringify({
    version: 2,
    database: path.basename(restorePath),
    assets: path.basename(`${restorePath}.assets`),
    roots: ["knowledge-assets", "space-folders"],
  }), "utf8");
  await mkdir(path.join(runtimeHome, "knowledge-assets"), { recursive: true });
  await writeFile(path.join(runtimeHome, "knowledge-assets", "current.txt"), "current asset", "utf8");
  await mkdir(path.join(runtimeHome, "space-folders"), { recursive: true });
  await writeFile(path.join(runtimeHome, "space-folders", "current-space.txt"), "current space file", "utf8");

  let ownedStorageSnapshots = 0;
  const maintenance = createWorkbenchDataMaintenance({
    database: current,
    runtimeHome,
    restorePicker: async () => restorePath,
    runOwnedStorageSnapshot: async (operation) => {
      ownedStorageSnapshots += 1;
      return await operation();
    },
  });
  assert.equal(maintenance.health().ok, true);
  const [backup, concurrentBackup] = await Promise.all([
    maintenance.createBackup(),
    maintenance.createBackup(),
  ]);
  assert.equal(existsSync(backup.filePath), true);
  assert.equal(existsSync(path.join(`${backup.filePath}.assets`, "knowledge-assets", "current.txt")), true);
  assert.equal(existsSync(path.join(`${backup.filePath}.assets`, "space-folders", "current-space.txt")), true);
  assert.equal(existsSync(`${backup.filePath}.manifest.json`), true);
  assert.equal(backup.byteLength > 0, true);
  assert.notEqual(concurrentBackup.filePath, backup.filePath);

  const staged = await maintenance.selectAndStageRestore();
  assert.equal(staged.status, "staged");
  assert.equal(ownedStorageSnapshots, 3);
  assert.equal(maintenance.health().pendingRestore, true);
  current.close();

  applyPendingWorkbenchRestore(runtimeHome);
  const restored = new SqliteRuntimeDatabase(currentPath);
  assert.equal(restored.connection.prepare("SELECT value FROM restore_probe").get()?.value, "restored");
  restored.close();
  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "restored.txt"), "utf8"), "restored asset");
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "restored-space.txt"), "utf8"), "restored space file");
});

test("Workbench backup leaves no selectable partial bundle after a failed database snapshot", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-backup-failure-");
  t.after(() => removeTestDirectory(runtimeHome));
  const database = {
    filePath: path.join(runtimeHome, "workbench.sqlite3"),
    health: () => ({ ok: true, checks: ["ok"], migrations: [] }),
    async backupTo(destinationPath: string) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, "partial", "utf8");
      throw new Error("backup failed");
    },
  };
  const maintenance = createWorkbenchDataMaintenance({ database, runtimeHome });

  await assert.rejects(maintenance.createBackup(), /Workbench 数据备份失败/u);

  assert.deepEqual(await readdir(path.join(runtimeHome, "backups")).catch(() => []), []);
});

test("Workbench backup holds the owned-storage root lease for the complete snapshot", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-backup-lease-");
  t.after(() => removeTestDirectory(runtimeHome));
  const coordinator = new InMemoryLocalWorkspaceMutationCoordinator();
  const mutationEvents: string[] = [];
  coordinator.events.subscribe((event) => mutationEvents.push(event.absolutePath));
  let releaseBackup!: () => void;
  const backupGate = new Promise<void>((resolve) => { releaseBackup = resolve; });
  let backupStarted!: () => void;
  const started = new Promise<void>((resolve) => { backupStarted = resolve; });
  const database = {
    filePath: path.join(runtimeHome, "workbench.sqlite3"),
    health: () => ({ ok: true, checks: ["ok"], migrations: [] }),
    async backupTo(destinationPath: string) {
      backupStarted();
      await backupGate;
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, "database", "utf8");
      return { filePath: destinationPath, byteLength: 8 };
    },
  };
  const maintenance = createWorkbenchDataMaintenance({
    database,
    runtimeHome,
    runOwnedStorageSnapshot: async (operation) => await coordinator.runExclusive(runtimeHome, operation),
  });

  const backup = maintenance.createBackup();
  await started;
  let mutationStarted = false;
  const mutation = coordinator.run(path.join(runtimeHome, "knowledge-assets"), async () => { mutationStarted = true; });
  await Promise.resolve();
  assert.equal(mutationStarted, false);
  releaseBackup();
  await backup;
  await mutation;
  assert.equal(mutationStarted, true);
  assert.equal(mutationEvents.length, 1);
});

test("Workbench restore normalizes legacy v1 knowledge-only backup bundles", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-v1-restore-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const legacyPath = path.join(runtimeHome, "legacy.sqlite3");
  const current = new SqliteRuntimeDatabase(currentPath);
  createSqliteSpaceRepository(current);
  createSqlitePersonalKnowledgeRepository(current);
  const legacy = new SqliteRuntimeDatabase(legacyPath);
  createSqliteSpaceRepository(legacy);
  createSqlitePersonalKnowledgeRepository(legacy);
  legacy.close();
  await mkdir(`${legacyPath}.assets`, { recursive: true });
  await writeFile(path.join(`${legacyPath}.assets`, "legacy.txt"), "legacy asset", "utf8");
  await writeFile(`${legacyPath}.manifest.json`, JSON.stringify({
    version: 1,
    database: path.basename(legacyPath),
    assets: path.basename(`${legacyPath}.assets`),
  }), "utf8");

  const maintenance = createWorkbenchDataMaintenance({
    database: current,
    runtimeHome,
    restorePicker: async () => legacyPath,
  });
  assert.equal((await maintenance.selectAndStageRestore()).status, "staged");
  current.close();
  applyPendingWorkbenchRestore(runtimeHome);

  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "legacy.txt"), "utf8"), "legacy asset");
  assert.deepEqual(await readdir(path.join(runtimeHome, "space-folders")), []);
});

test("Workbench restore rejects an incomplete pending bundle before replacing current data", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-restore-invalid-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const current = new SqliteRuntimeDatabase(currentPath);
  createSqliteSpaceRepository(current);
  createSqlitePersonalKnowledgeRepository(current);
  current.connection.exec("CREATE TABLE restore_probe(value TEXT NOT NULL) STRICT; INSERT INTO restore_probe(value) VALUES ('current')");
  current.close();

  const pendingPath = path.join(runtimeHome, "workbench.restore-pending.sqlite3");
  const pending = new SqliteRuntimeDatabase(pendingPath);
  createSqliteSpaceRepository(pending);
  createSqlitePersonalKnowledgeRepository(pending);
  pending.close();
  await mkdir(path.join(runtimeHome, "workbench.restore-pending.assets", "knowledge-assets"), { recursive: true });
  await mkdir(path.join(runtimeHome, "knowledge-assets"), { recursive: true });
  await mkdir(path.join(runtimeHome, "space-folders"), { recursive: true });
  await writeFile(path.join(runtimeHome, "knowledge-assets", "current.txt"), "current asset", "utf8");
  await writeFile(path.join(runtimeHome, "space-folders", "current.txt"), "current space", "utf8");

  assert.throws(
    () => applyPendingWorkbenchRestore(runtimeHome),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "restore_source_invalid",
  );

  const reopened = new SqliteRuntimeDatabase(currentPath);
  assert.equal(reopened.connection.prepare("SELECT value FROM restore_probe").get()?.value, "current");
  reopened.close();
  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "current.txt"), "utf8"), "current asset");
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "current.txt"), "utf8"), "current space");
});
