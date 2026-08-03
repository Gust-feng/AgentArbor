import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { createSqlitePersonalKnowledgeRepository } from "../personal-knowledge/index.js";
import {
  createSqliteSpaceRepository,
  inspectFileSystemSpaceReferenceDeletionJournal,
} from "../spaces/index.js";
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
  t.after(() => current.close());
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

  applyPendingRestore(runtimeHome);
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

test("Workbench restore staging rejects a second request after the first request quiesces writers", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-restore-admission-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const firstRestorePath = path.join(runtimeHome, "first.sqlite3");
  const secondRestorePath = path.join(runtimeHome, "second.sqlite3");
  const current = new SqliteRuntimeDatabase(currentPath);
  t.after(() => current.close());
  createSqliteSpaceRepository(current);
  createSqlitePersonalKnowledgeRepository(current);
  await writeStorageFixture(runtimeHome, "current");
  await writeSelectedWorkbenchBackup(firstRestorePath, "first");
  await writeSelectedWorkbenchBackup(secondRestorePath, "second");
  const selected = [firstRestorePath, secondRestorePath];
  let pickerCalls = 0;
  const maintenance = createWorkbenchDataMaintenance({
    database: current,
    runtimeHome,
    restorePicker: async () => selected[pickerCalls++],
    beforeRestoreStage: async () => undefined,
  });

  const first = maintenance.selectAndStageRestore();
  const second = maintenance.selectAndStageRestore();
  assert.equal((await first).status, "staged");
  await assert.rejects(
    second,
    (error: unknown) => error instanceof Error && "code" in error && error.code === "data_maintenance_failed",
  );

  assert.equal(pickerCalls, 1);
  assert.equal(
    readWorkbenchProbe(path.join(runtimeHome, "workbench.restore-pending.sqlite3")),
    "first",
  );
  current.close();
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
  applyPendingRestore(runtimeHome);

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
    () => applyPendingRestore(runtimeHome),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "restore_source_invalid",
  );

  const reopened = new SqliteRuntimeDatabase(currentPath);
  assert.equal(reopened.connection.prepare("SELECT value FROM restore_probe").get()?.value, "current");
  reopened.close();
  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "current.txt"), "utf8"), "current asset");
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "current.txt"), "utf8"), "current space");
});

test("Workbench restore refuses to combine a pending bundle with a Space deletion journal", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-restore-space-deletion-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const pendingPath = path.join(runtimeHome, "workbench.restore-pending.sqlite3");
  createWorkbenchProbeDatabase(currentPath, "current");
  createWorkbenchProbeDatabase(pendingPath, "restored");
  await writeStorageFixture(runtimeHome, "current");
  await writeStorageFixture(path.join(runtimeHome, "workbench.restore-pending.assets"), "restored");
  const deletionJournalRoot = path.join(runtimeHome, "space-reference-deletions");
  await mkdir(deletionJournalRoot, { recursive: true });
  const deletionJournalPath = path.join(deletionJournalRoot, "pending-delete.json");
  await writeFile(deletionJournalPath, "{}", "utf8");

  assert.throws(
    () => applyPendingRestore(runtimeHome),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "data_maintenance_failed",
  );

  assert.equal(readWorkbenchProbe(currentPath), "current");
  assert.equal(existsSync(pendingPath), true);
  assert.equal(existsSync(deletionJournalPath), true);
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "current.txt"), "utf8"), "current");
});

test("Workbench restore recovers a journal-only crash after installing the pending database", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-restore-crash-prepared-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const pendingPath = path.join(runtimeHome, "workbench.restore-pending.sqlite3");
  createWorkbenchProbeDatabase(currentPath, "current");
  createWorkbenchProbeDatabase(pendingPath, "restored");
  await writeStorageFixture(runtimeHome, "current");
  await writeStorageFixture(path.join(runtimeHome, "workbench.restore-pending.assets"), "restored");

  const restoreId = "prepared-crash";
  const backupStem = path.join(runtimeHome, "backups", "replaced-prepared-crash");
  const originalDatabaseSuffixes = await moveCurrentDataToRestoreBackup(runtimeHome, backupStem);
  await writeFile(path.join(runtimeHome, "workbench.restore-journal.json"), JSON.stringify({
    version: 1,
    restoreId,
    backupStem,
    originalDatabaseSuffixes,
    originalStorageNames: ["knowledge-assets", "space-folders"],
  }), "utf8");
  await rename(pendingPath, currentPath);

  applyPendingRestore(runtimeHome);

  assert.equal(readWorkbenchProbe(currentPath), "restored");
  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "restored.txt"), "utf8"), "restored");
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "restored.txt"), "utf8"), "restored");
  assert.equal(existsSync(path.join(runtimeHome, "workbench.restore-journal.json")), false);
  assert.equal(existsSync(path.join(runtimeHome, "workbench.restore-commit.json")), false);
  assert.equal(existsSync(pendingPath), false);
});

test("Workbench restore finalizes a committed install after cleanup was interrupted", async (t) => {
  const runtimeHome = await makeTestDirectory("agentarbor-workbench-restore-crash-committed-");
  t.after(() => removeTestDirectory(runtimeHome));
  const currentPath = path.join(runtimeHome, "workbench.sqlite3");
  const pendingPath = path.join(runtimeHome, "workbench.restore-pending.sqlite3");
  const pendingAssetsPath = path.join(runtimeHome, "workbench.restore-pending.assets");
  createWorkbenchProbeDatabase(currentPath, "current");
  createWorkbenchProbeDatabase(pendingPath, "restored");
  await writeStorageFixture(runtimeHome, "current");
  await writeStorageFixture(pendingAssetsPath, "restored");

  const restoreId = "committed-crash";
  const backupStem = path.join(runtimeHome, "backups", "replaced-committed-crash");
  const originalDatabaseSuffixes = await moveCurrentDataToRestoreBackup(runtimeHome, backupStem);
  await writeFile(path.join(runtimeHome, "workbench.restore-journal.json"), JSON.stringify({
    version: 1,
    restoreId,
    backupStem,
    originalDatabaseSuffixes,
    originalStorageNames: ["knowledge-assets", "space-folders"],
  }), "utf8");
  await rename(pendingPath, currentPath);
  await rename(path.join(pendingAssetsPath, "knowledge-assets"), path.join(runtimeHome, "knowledge-assets"));
  await rename(path.join(pendingAssetsPath, "space-folders"), path.join(runtimeHome, "space-folders"));
  await writeFile(path.join(runtimeHome, "workbench.restore-commit.json"), JSON.stringify({
    version: 1,
    restoreId,
  }), "utf8");

  applyPendingRestore(runtimeHome);

  assert.equal(readWorkbenchProbe(currentPath), "restored");
  assert.equal(await readFile(path.join(runtimeHome, "knowledge-assets", "restored.txt"), "utf8"), "restored");
  assert.equal(await readFile(path.join(runtimeHome, "space-folders", "restored.txt"), "utf8"), "restored");
  assert.equal(existsSync(pendingAssetsPath), false);
  assert.equal(existsSync(path.join(runtimeHome, "workbench.restore-journal.json")), false);
  assert.equal(existsSync(path.join(runtimeHome, "workbench.restore-commit.json")), false);
});

function applyPendingRestore(runtimeHome: string): void {
  applyPendingWorkbenchRestore(runtimeHome, {
    assertSpaceDeletionIdle: () => {
      const status = inspectFileSystemSpaceReferenceDeletionJournal(
        path.join(runtimeHome, "space-reference-deletions"),
      );
      if (status !== "idle") throw new Error("Space deletion recovery is pending.");
    },
  });
}

function createWorkbenchProbeDatabase(filePath: string, value: string): void {
  const database = new SqliteRuntimeDatabase(filePath);
  createSqliteSpaceRepository(database);
  createSqlitePersonalKnowledgeRepository(database);
  database.connection.exec(`CREATE TABLE restore_probe(value TEXT NOT NULL) STRICT; INSERT INTO restore_probe(value) VALUES ('${value}')`);
  database.close();
}

function readWorkbenchProbe(filePath: string): string | undefined {
  const database = new SqliteRuntimeDatabase(filePath);
  try {
    return database.connection.prepare("SELECT value FROM restore_probe").get()?.value as string | undefined;
  } finally {
    database.close();
  }
}

async function writeStorageFixture(root: string, value: string): Promise<void> {
  for (const storageName of ["knowledge-assets", "space-folders"] as const) {
    const storageRoot = path.join(root, storageName);
    await mkdir(storageRoot, { recursive: true });
    await writeFile(path.join(storageRoot, `${value}.txt`), value, "utf8");
  }
}

async function writeSelectedWorkbenchBackup(filePath: string, value: string): Promise<void> {
  createWorkbenchProbeDatabase(filePath, value);
  await writeStorageFixture(`${filePath}.assets`, value);
  await writeFile(`${filePath}.manifest.json`, JSON.stringify({
    version: 2,
    database: path.basename(filePath),
    assets: path.basename(`${filePath}.assets`),
    roots: ["knowledge-assets", "space-folders"],
  }), "utf8");
}

async function moveCurrentDataToRestoreBackup(runtimeHome: string, backupStem: string): Promise<readonly string[]> {
  await mkdir(path.dirname(backupStem), { recursive: true });
  const suffixes = ["", "-wal", "-shm"].filter((suffix) => existsSync(path.join(runtimeHome, `workbench.sqlite3${suffix}`)));
  for (const suffix of suffixes) {
    await rename(path.join(runtimeHome, `workbench.sqlite3${suffix}`), `${backupStem}.sqlite3${suffix}`);
  }
  for (const storageName of ["knowledge-assets", "space-folders"] as const) {
    await rename(path.join(runtimeHome, storageName), `${backupStem}.${storageName}`);
  }
  return suffixes;
}
