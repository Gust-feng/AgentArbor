import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  checkSqliteDatabaseFile,
  type SqliteRuntimeDatabase,
} from "../../adapters/runtime-storage/index.js";

const DATABASE_FILE_NAME = "workbench.sqlite3";
const PENDING_RESTORE_FILE_NAME = "workbench.restore-pending.sqlite3";
const PENDING_RESTORE_ASSETS_NAME = "workbench.restore-pending.assets";
const RESTORE_JOURNAL_FILE_NAME = "workbench.restore-journal.json";
const RESTORE_COMMIT_FILE_NAME = "workbench.restore-commit.json";
const RESTORE_METADATA_VERSION = 1;
const DATABASE_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;
const OWNED_STORAGE_NAMES = ["knowledge-assets", "space-folders"] as const;

type DatabaseFileSuffix = typeof DATABASE_FILE_SUFFIXES[number];
type OwnedStorageName = typeof OWNED_STORAGE_NAMES[number];

type WorkbenchRestoreJournal = {
  readonly version: typeof RESTORE_METADATA_VERSION;
  readonly restoreId: string;
  readonly backupStem: string;
  readonly originalDatabaseSuffixes: readonly DatabaseFileSuffix[];
  readonly originalStorageNames: readonly OwnedStorageName[];
};

type WorkbenchRestoreCommit = {
  readonly version: typeof RESTORE_METADATA_VERSION;
  readonly restoreId: string;
};

export type WorkbenchDataMaintenance = {
  health(): {
    readonly ok: boolean;
    readonly checks: readonly string[];
    readonly migrations: readonly { readonly owner: string; readonly version: number; readonly appliedAt: string }[];
    readonly pendingRestore: boolean;
  };
  createBackup(): Promise<{ readonly filePath: string; readonly byteLength: number; readonly createdAt: string }>;
  selectAndStageRestore(): Promise<
    | { readonly status: "cancelled" }
    | { readonly status: "staged"; readonly sourcePath: string; readonly safetyBackupPath: string; readonly restartRequired: true }
  >;
};

export class WorkbenchDataMaintenanceError extends Error {
  readonly name = "WorkbenchDataMaintenanceError";

  constructor(
    readonly code: "restore_picker_unavailable" | "restore_source_invalid" | "data_maintenance_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type WorkbenchBackupDatabase = Pick<SqliteRuntimeDatabase, "filePath" | "health" | "backupTo">;

export function createWorkbenchDataMaintenance(input: {
  readonly database: WorkbenchBackupDatabase;
  readonly runtimeHome: string;
  readonly restorePicker?: () => Promise<string | undefined>;
  readonly beforeRestoreStage?: () => Promise<void>;
  readonly runOwnedStorageSnapshot?: <T>(operation: () => Promise<T>) => Promise<T>;
}): WorkbenchDataMaintenance {
  const pendingRestorePath = path.join(input.runtimeHome, PENDING_RESTORE_FILE_NAME);
  const pendingRestoreAssetsPath = path.join(input.runtimeHome, PENDING_RESTORE_ASSETS_NAME);
  let queue = Promise.resolve();
  let restoreState: "running" | "quiescing" | "staged" | "failed_requires_restart" = "running";
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return await result;
  };
  const createBackup = async () => {
    const createdAt = new Date().toISOString();
    const filePath = path.join(
      input.runtimeHome,
      "backups",
      `workbench-${fileTimestamp(createdAt)}-${randomUUID().slice(0, 8)}.sqlite3`,
    );
    const temporarySuffix = `.pending-${randomUUID()}`;
    const temporaryFilePath = `${filePath}${temporarySuffix}`;
    const assetsPath = backupAssetsPath(filePath);
    const temporaryAssetsPath = `${assetsPath}${temporarySuffix}`;
    const manifestPath = backupManifestPath(filePath);
    const temporaryManifestPath = `${manifestPath}${temporarySuffix}`;
    try {
      const databaseBackup = await input.database.backupTo(temporaryFilePath);
      await mkdir(temporaryAssetsPath, { recursive: true });
      for (const storageName of OWNED_STORAGE_NAMES) {
        const source = path.join(input.runtimeHome, storageName);
        const destination = path.join(temporaryAssetsPath, storageName);
        if (existsSync(source)) await cp(source, destination, { recursive: true });
        else await mkdir(destination, { recursive: true });
      }
      await writeFile(temporaryManifestPath, JSON.stringify({
        version: 2,
        database: path.basename(filePath),
        assets: path.basename(assetsPath),
        roots: OWNED_STORAGE_NAMES,
        createdAt,
      }), "utf8");
      await rename(temporaryFilePath, filePath);
      await rename(temporaryAssetsPath, assetsPath);
      await rename(temporaryManifestPath, manifestPath);
      return { filePath, byteLength: databaseBackup.byteLength, createdAt };
    } catch (error) {
      await Promise.allSettled([
        rm(temporaryFilePath, { force: true }),
        rm(temporaryAssetsPath, { recursive: true, force: true }),
        rm(temporaryManifestPath, { force: true }),
        rm(filePath, { force: true }),
        rm(assetsPath, { recursive: true, force: true }),
        rm(manifestPath, { force: true }),
      ]);
      throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 数据备份失败。", { cause: error });
    }
  };
  const createOwnedStorageSnapshot = async () => {
    try {
      return input.runOwnedStorageSnapshot === undefined
        ? await createBackup()
        : await input.runOwnedStorageSnapshot(createBackup);
    } catch (error) {
      if (error instanceof WorkbenchDataMaintenanceError) throw error;
      throw new WorkbenchDataMaintenanceError(
        "data_maintenance_failed",
        "Workbench 数据快照前无法收口当前持久化状态。",
        { cause: error },
      );
    }
  };
  return {
    health() {
      return { ...input.database.health(), pendingRestore: existsSync(pendingRestorePath) };
    },
    createBackup() {
      return run(async () => {
        assertRestoreAdmission(restoreState);
        return await createOwnedStorageSnapshot();
      });
    },
    selectAndStageRestore() {
      return run(async () => {
        assertRestoreAdmission(restoreState);
        if (input.restorePicker === undefined) {
          throw new WorkbenchDataMaintenanceError("restore_picker_unavailable", "当前运行方式不支持选择 Workbench 备份。");
        }
        const selectedPath = await input.restorePicker();
        if (selectedPath === undefined) return { status: "cancelled" };
        if (path.resolve(selectedPath) === path.resolve(input.database.filePath)) {
          throw new WorkbenchDataMaintenanceError("restore_source_invalid", "不能把当前正在使用的数据库作为恢复来源。");
        }
        const backupVersion = await validateBackupCompanions(selectedPath);
        let selectedHealth: ReturnType<typeof checkSqliteDatabaseFile>;
        try {
          selectedHealth = checkSqliteDatabaseFile(selectedPath);
        } catch (error) {
          throw new WorkbenchDataMaintenanceError("restore_source_invalid", "所选文件不是可读取的 SQLite 数据库。", { cause: error });
        }
        if (!selectedHealth.ok) {
          throw new WorkbenchDataMaintenanceError("restore_source_invalid", `所选数据库未通过完整性检查：${selectedHealth.checks.join("；")}`);
        }
        if (!isWorkbenchDatabase(selectedHealth.tables)) {
          throw new WorkbenchDataMaintenanceError("restore_source_invalid", "所选数据库不包含 Workbench 的 Space 与 Personal Knowledge 数据表。");
        }
        restoreState = "quiescing";
        try {
          await input.beforeRestoreStage?.();
        } catch (error) {
          restoreState = "failed_requires_restart";
          throw new WorkbenchDataMaintenanceError(
            "data_maintenance_failed",
            "Workbench 恢复暂存前无法收口当前运行数据；当前 Panel 已停止接受新工作，请重启后重试。",
            { cause: error },
          );
        }
        let safetyBackup: Awaited<ReturnType<typeof createOwnedStorageSnapshot>>;
        try {
          safetyBackup = await createOwnedStorageSnapshot();
        } catch (error) {
          restoreState = "failed_requires_restart";
          throw new WorkbenchDataMaintenanceError(
            "data_maintenance_failed",
            "Workbench 恢复暂存前的安全备份失败；当前 Panel 已停止接受新工作，请重启后重试。",
            { cause: error },
          );
        }
        const stagingPath = `${pendingRestorePath}.tmp`;
        const stagingAssetsPath = `${pendingRestoreAssetsPath}.tmp`;
        let pendingDatabasePublished = false;
        try {
          await rm(stagingPath, { force: true });
          await rm(stagingAssetsPath, { recursive: true, force: true });
          await copyFile(selectedPath, stagingPath);
          if (backupVersion === 1) {
            await mkdir(stagingAssetsPath, { recursive: true });
            await cp(
              backupAssetsPath(selectedPath),
              path.join(stagingAssetsPath, "knowledge-assets"),
              { recursive: true },
            );
            await mkdir(path.join(stagingAssetsPath, "space-folders"), { recursive: true });
          } else {
            await cp(backupAssetsPath(selectedPath), stagingAssetsPath, { recursive: true });
          }
          const stagedHealth = checkSqliteDatabaseFile(stagingPath);
          if (!stagedHealth.ok) throw new Error(stagedHealth.checks.join("; "));
          await rm(pendingRestorePath, { force: true });
          await rm(pendingRestoreAssetsPath, { recursive: true, force: true });
          // The pending database is the commit marker. Publish the complete
          // owned-storage tree first so observing the database always implies
          // that the whole restore bundle is available.
          await rename(stagingAssetsPath, pendingRestoreAssetsPath);
          fsyncDirectory(input.runtimeHome);
          await rename(stagingPath, pendingRestorePath);
          pendingDatabasePublished = true;
          fsyncDirectory(input.runtimeHome);
        } catch (error) {
          await rm(stagingPath, { force: true }).catch(() => undefined);
          await rm(stagingAssetsPath, { recursive: true, force: true }).catch(() => undefined);
          if (!pendingDatabasePublished) {
            await rm(pendingRestoreAssetsPath, { recursive: true, force: true }).catch(() => undefined);
          }
          restoreState = "failed_requires_restart";
          throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 恢复文件暂存失败。", { cause: error });
        }
        restoreState = "staged";
        return {
          status: "staged",
          sourcePath: selectedPath,
          safetyBackupPath: safetyBackup.filePath,
          restartRequired: true,
        };
      });
    },
  };
}

/** Applies a validated pending restore before any feature opens the shared database. */
export function applyPendingWorkbenchRestore(
  runtimeHome: string,
  input: { readonly assertSpaceDeletionIdle: () => void },
): void {
  if (hasWorkbenchRestoreState(runtimeHome)) {
    try {
      input.assertSpaceDeletionIdle();
    } catch (error) {
      throw new WorkbenchDataMaintenanceError(
        "data_maintenance_failed",
        "仍有 Space 文件删除等待恢复，Workbench 恢复未修改当前数据。",
        { cause: error },
      );
    }
  }
  try {
    recoverInterruptedWorkbenchRestore(runtimeHome);
  } catch (error) {
    if (error instanceof WorkbenchDataMaintenanceError) throw error;
    throw new WorkbenchDataMaintenanceError(
      "data_maintenance_failed",
      "Workbench 恢复中断状态无法收口，当前数据库尚未打开。",
      { cause: error },
    );
  }

  const pendingPath = path.join(runtimeHome, PENDING_RESTORE_FILE_NAME);
  if (!existsSync(pendingPath)) return;
  validatePendingWorkbenchRestore(runtimeHome);
  const journal = createRestoreJournal(runtimeHome);
  try {
    writeRestoreJournal(runtimeHome, journal);
  } catch (error) {
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 恢复日志写入失败，原数据库未变更。", { cause: error });
  }

  try {
    installPendingWorkbenchRestore(runtimeHome, journal);
    writeRestoreCommit(runtimeHome, journal.restoreId);
    finalizeCommittedWorkbenchRestore(runtimeHome);
  } catch (error) {
    if (restoreCommitMatches(runtimeHome, journal.restoreId)) {
      try {
        finalizeCommittedWorkbenchRestore(runtimeHome);
        return;
      } catch (finalizeError) {
        throw new WorkbenchDataMaintenanceError(
          "data_maintenance_failed",
          "Workbench 恢复数据已完整安装，但收尾失败；下次启动将继续收口。",
          { cause: new AggregateError([error, finalizeError]) },
        );
      }
    }
    try {
      rollbackPreparedWorkbenchRestore(runtimeHome, journal);
    } catch (rollbackError) {
      throw new WorkbenchDataMaintenanceError(
        "data_maintenance_failed",
        "Workbench 数据恢复失败且回滚未完成；恢复日志已保留供下次启动继续收口。",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 数据库恢复失败，原数据库已保留。", { cause: error });
  }
}

export function hasUnappliedPendingWorkbenchRestore(runtimeHome: string): boolean {
  return existsSync(pendingRestorePath(runtimeHome)) &&
    !existsSync(restoreJournalPath(runtimeHome)) &&
    !existsSync(restoreCommitPath(runtimeHome));
}

function hasWorkbenchRestoreState(runtimeHome: string): boolean {
  return [
    pendingRestorePath(runtimeHome),
    restoreJournalPath(runtimeHome),
    restoreCommitPath(runtimeHome),
  ].some((filePath) => existsSync(filePath));
}

function recoverInterruptedWorkbenchRestore(runtimeHome: string): void {
  const journalPath = restoreJournalPath(runtimeHome);
  const commitPath = restoreCommitPath(runtimeHome);
  rmSync(`${journalPath}.tmp`, { force: true });
  rmSync(`${commitPath}.tmp`, { force: true });
  if (!existsSync(journalPath)) {
    if (existsSync(commitPath)) {
      readRestoreCommit(runtimeHome);
      assertInstalledWorkbenchRestore(runtimeHome);
      rmSync(commitPath, { force: true });
      fsyncDirectory(runtimeHome);
    }
    return;
  }
  const journal = readRestoreJournal(runtimeHome);
  if (existsSync(commitPath)) {
    const commit = readRestoreCommit(runtimeHome);
    if (commit.restoreId !== journal.restoreId) throw new Error("Workbench restore commit does not match restore journal.");
    finalizeCommittedWorkbenchRestore(runtimeHome);
    return;
  }
  rollbackPreparedWorkbenchRestore(runtimeHome, journal);
  rmSync(journalPath, { force: true });
  rmSync(commitPath, { force: true });
  fsyncDirectory(runtimeHome);
}

function validatePendingWorkbenchRestore(runtimeHome: string): void {
  const pendingPath = pendingRestorePath(runtimeHome);
  const pendingAssetsPath = pendingRestoreAssetsPath(runtimeHome);
  if (!existsSync(pendingAssetsPath)) throw new WorkbenchDataMaintenanceError("restore_source_invalid", "待恢复备份缺少知识资产目录。");
  for (const storageName of OWNED_STORAGE_NAMES) {
    const storagePath = path.join(pendingAssetsPath, storageName);
    if (!existsSync(storagePath) || !statSync(storagePath).isDirectory()) {
      throw new WorkbenchDataMaintenanceError("restore_source_invalid", "待恢复备份缺少完整的软件自管文件目录。");
    }
  }
  const health = checkSqliteDatabaseFile(pendingPath);
  if (!health.ok) {
    throw new WorkbenchDataMaintenanceError("restore_source_invalid", `待恢复数据库未通过完整性检查：${health.checks.join("；")}`);
  }
  if (!isWorkbenchDatabase(health.tables)) {
    throw new WorkbenchDataMaintenanceError("restore_source_invalid", "待恢复数据库不包含 Workbench 数据表。");
  }
}

function createRestoreJournal(runtimeHome: string): WorkbenchRestoreJournal {
  const restoreId = randomUUID();
  if (!existsSync(databaseFilePath(runtimeHome, ""))) {
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "当前 Workbench 数据库不存在，无法安全建立恢复日志。");
  }
  const backupStem = path.join(runtimeHome, "backups", `replaced-${fileTimestamp(new Date().toISOString())}-${restoreId.slice(0, 8)}`);
  return {
    version: RESTORE_METADATA_VERSION,
    restoreId,
    backupStem,
    originalDatabaseSuffixes: DATABASE_FILE_SUFFIXES.filter((suffix) => existsSync(databaseFilePath(runtimeHome, suffix))),
    originalStorageNames: OWNED_STORAGE_NAMES.filter((storageName) => existsSync(storagePath(runtimeHome, storageName))),
  };
}

function installPendingWorkbenchRestore(runtimeHome: string, journal: WorkbenchRestoreJournal): void {
  const backupRoot = path.dirname(journal.backupStem);
  mkdirSync(backupRoot, { recursive: true });
  fsyncDirectory(runtimeHome);
  for (const suffix of journal.originalDatabaseSuffixes) {
    moveCurrentToBackup(databaseFilePath(runtimeHome, suffix), databaseBackupPath(journal, suffix));
  }
  for (const storageName of journal.originalStorageNames) {
    moveCurrentToBackup(storagePath(runtimeHome, storageName), storageBackupPath(journal, storageName));
  }
  fsyncDirectory(runtimeHome);
  fsyncDirectory(backupRoot);
  movePendingToCurrent(pendingRestorePath(runtimeHome), databaseFilePath(runtimeHome, ""));
  for (const storageName of OWNED_STORAGE_NAMES) {
    movePendingToCurrent(pendingStoragePath(runtimeHome, storageName), storagePath(runtimeHome, storageName));
  }
  fsyncDirectory(pendingRestoreAssetsPath(runtimeHome));
  fsyncDirectory(runtimeHome);
}

function moveCurrentToBackup(current: string, backup: string): void {
  if (existsSync(backup)) throw new Error(`Cannot prepare Workbench restore over an existing backup: ${backup}`);
  if (!existsSync(current)) throw new Error(`Cannot prepare Workbench restore backup; current path missing: ${current}`);
  renameSync(current, backup);
}

function movePendingToCurrent(pending: string, current: string): void {
  if (!existsSync(pending)) throw new Error(`Cannot install Workbench restore item; pending path missing: ${pending}`);
  if (existsSync(current)) throw new Error(`Cannot install Workbench restore item over existing path: ${current}`);
  renameSync(pending, current);
}

function rollbackPreparedWorkbenchRestore(runtimeHome: string, journal: WorkbenchRestoreJournal): void {
  mkdirSync(pendingRestoreAssetsPath(runtimeHome), { recursive: true });
  for (const storageName of [...OWNED_STORAGE_NAMES].reverse()) {
    const current = storagePath(runtimeHome, storageName);
    const pending = pendingStoragePath(runtimeHome, storageName);
    if (existsSync(current) && !existsSync(pending)) renameSync(current, pending);
  }
  if (existsSync(databaseFilePath(runtimeHome, "")) && !existsSync(pendingRestorePath(runtimeHome))) {
    renameSync(databaseFilePath(runtimeHome, ""), pendingRestorePath(runtimeHome));
  }
  for (const storageName of [...journal.originalStorageNames].reverse()) {
    restoreBackupToCurrent(storageBackupPath(journal, storageName), storagePath(runtimeHome, storageName));
  }
  for (const suffix of [...journal.originalDatabaseSuffixes].reverse()) {
    restoreBackupToCurrent(databaseBackupPath(journal, suffix), databaseFilePath(runtimeHome, suffix));
  }
  fsyncDirectory(pendingRestoreAssetsPath(runtimeHome));
  const backupRoot = path.dirname(journal.backupStem);
  if (existsSync(backupRoot)) fsyncDirectory(backupRoot);
  fsyncDirectory(runtimeHome);
  assertRolledBackWorkbenchRestore(runtimeHome, journal);
  validatePendingWorkbenchRestore(runtimeHome);
}

function restoreBackupToCurrent(backup: string, current: string): void {
  if (!existsSync(backup)) {
    if (existsSync(current)) return;
    throw new Error(`Cannot restore missing Workbench backup: ${backup}`);
  }
  if (existsSync(current)) throw new Error(`Cannot restore Workbench backup over existing path: ${current}`);
  renameSync(backup, current);
}

function finalizeCommittedWorkbenchRestore(runtimeHome: string): void {
  const journal = readRestoreJournal(runtimeHome);
  const commit = readRestoreCommit(runtimeHome);
  if (commit.restoreId !== journal.restoreId) throw new Error("Workbench restore commit does not match restore journal.");
  assertInstalledWorkbenchRestore(runtimeHome);
  rmSync(pendingRestorePath(runtimeHome), { force: true });
  rmSync(pendingRestoreAssetsPath(runtimeHome), { recursive: true, force: true });
  rmSync(restoreJournalPath(runtimeHome), { force: true });
  rmSync(restoreCommitPath(runtimeHome), { force: true });
  fsyncDirectory(runtimeHome);
}

function assertInstalledWorkbenchRestore(runtimeHome: string): void {
  if (existsSync(pendingRestorePath(runtimeHome))) {
    throw new Error("Installed Workbench restore still has a pending database.");
  }
  const health = checkSqliteDatabaseFile(databaseFilePath(runtimeHome, ""));
  if (!health.ok || !isWorkbenchDatabase(health.tables)) {
    throw new Error(`Installed Workbench restore database is invalid: ${health.checks.join("; ")}`);
  }
  for (const storageName of OWNED_STORAGE_NAMES) {
    const current = storagePath(runtimeHome, storageName);
    if (existsSync(pendingStoragePath(runtimeHome, storageName))) {
      throw new Error(`Installed Workbench restore still has pending storage: ${storageName}`);
    }
    if (!existsSync(current) || !statSync(current).isDirectory()) {
      throw new Error(`Installed Workbench restore storage is missing: ${storageName}`);
    }
  }
}

function assertRolledBackWorkbenchRestore(runtimeHome: string, journal: WorkbenchRestoreJournal): void {
  const health = checkSqliteDatabaseFile(databaseFilePath(runtimeHome, ""));
  if (!health.ok || !isWorkbenchDatabase(health.tables)) {
    throw new Error(`Rolled-back Workbench database is invalid: ${health.checks.join("; ")}`);
  }
  for (const storageName of OWNED_STORAGE_NAMES) {
    const current = storagePath(runtimeHome, storageName);
    const shouldExist = journal.originalStorageNames.includes(storageName);
    if (shouldExist !== existsSync(current)) {
      throw new Error(`Rolled-back Workbench storage does not match journal: ${storageName}`);
    }
    if (shouldExist && !statSync(current).isDirectory()) {
      throw new Error(`Rolled-back Workbench storage is not a directory: ${storageName}`);
    }
  }
}

function writeRestoreJournal(runtimeHome: string, journal: WorkbenchRestoreJournal): void {
  writeJsonAtomicallySync(restoreJournalPath(runtimeHome), journal);
}

function writeRestoreCommit(runtimeHome: string, restoreId: string): void {
  writeJsonAtomicallySync(restoreCommitPath(runtimeHome), { version: RESTORE_METADATA_VERSION, restoreId } satisfies WorkbenchRestoreCommit);
}

function restoreCommitMatches(runtimeHome: string, restoreId: string): boolean {
  if (!existsSync(restoreCommitPath(runtimeHome))) return false;
  const commit = readRestoreCommit(runtimeHome);
  if (commit.restoreId !== restoreId) throw new Error("Workbench restore commit does not match restore journal.");
  return true;
}

function readRestoreJournal(runtimeHome: string): WorkbenchRestoreJournal {
  const value = JSON.parse(readFileSync(restoreJournalPath(runtimeHome), "utf8")) as Partial<WorkbenchRestoreJournal>;
  if (value.version !== RESTORE_METADATA_VERSION
    || typeof value.restoreId !== "string"
    || value.restoreId.length === 0
    || typeof value.backupStem !== "string"
    || !Array.isArray(value.originalDatabaseSuffixes)
    || !Array.isArray(value.originalStorageNames)
    || !pathIsInside(path.join(runtimeHome, "backups"), value.backupStem)
    || !value.originalDatabaseSuffixes.includes("")
    || new Set(value.originalDatabaseSuffixes).size !== value.originalDatabaseSuffixes.length
    || new Set(value.originalStorageNames).size !== value.originalStorageNames.length
    || value.originalDatabaseSuffixes.some((suffix) => !isDatabaseFileSuffix(suffix))
    || value.originalStorageNames.some((storageName) => !isOwnedStorageName(storageName))) {
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 恢复日志无效，当前数据库尚未打开。");
  }
  return value as WorkbenchRestoreJournal;
}

function readRestoreCommit(runtimeHome: string): WorkbenchRestoreCommit {
  const value = JSON.parse(readFileSync(restoreCommitPath(runtimeHome), "utf8")) as Partial<WorkbenchRestoreCommit>;
  if (value.version !== RESTORE_METADATA_VERSION || typeof value.restoreId !== "string" || value.restoreId.length === 0) {
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 恢复提交标记无效，当前数据库尚未打开。");
  }
  return value as WorkbenchRestoreCommit;
}

function writeJsonAtomicallySync(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) throw new Error(`Workbench restore metadata already exists: ${filePath}`);
  const temporaryPath = `${filePath}.tmp`;
  rmSync(temporaryPath, { force: true });
  const fd = openSync(temporaryPath, "wx");
  let writeFailure: unknown;
  try {
    try {
      writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
      fsyncSync(fd);
    } catch (error) {
      writeFailure = error;
      throw error;
    } finally {
      try {
        closeSync(fd);
      } catch (error) {
        if (writeFailure === undefined) throw error;
      }
    }
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  try {
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  fsyncDirectory(path.dirname(filePath));
}

function fsyncDirectory(directoryPath: string): void {
  let fd: number | undefined;
  let primaryFailure: unknown;
  try {
    fd = openSync(directoryPath, "r");
    fsyncSync(fd);
  } catch (error) {
    if (!isUnsupportedWindowsDirectoryFsync(error)) {
      primaryFailure = error;
      throw error;
    }
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } catch (error) {
      if (primaryFailure === undefined) throw error;
    }
  }
}

function isUnsupportedWindowsDirectoryFsync(error: unknown): boolean {
  if (process.platform !== "win32") return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EINVAL" || code === "EPERM" || code === "ENOTSUP" || code === "EISDIR";
}

function assertRestoreAdmission(state: "running" | "quiescing" | "staged" | "failed_requires_restart"): void {
  if (state === "running") return;
  throw new WorkbenchDataMaintenanceError(
    "data_maintenance_failed",
    "Workbench 恢复已经停止当前 Panel 的数据写入；请重启后再执行数据维护。",
  );
}

function databaseFilePath(runtimeHome: string, suffix: DatabaseFileSuffix): string {
  return path.join(runtimeHome, `${DATABASE_FILE_NAME}${suffix}`);
}

function pendingRestorePath(runtimeHome: string): string {
  return path.join(runtimeHome, PENDING_RESTORE_FILE_NAME);
}

function pendingRestoreAssetsPath(runtimeHome: string): string {
  return path.join(runtimeHome, PENDING_RESTORE_ASSETS_NAME);
}

function restoreJournalPath(runtimeHome: string): string {
  return path.join(runtimeHome, RESTORE_JOURNAL_FILE_NAME);
}

function restoreCommitPath(runtimeHome: string): string {
  return path.join(runtimeHome, RESTORE_COMMIT_FILE_NAME);
}

function storagePath(runtimeHome: string, storageName: OwnedStorageName): string {
  return path.join(runtimeHome, storageName);
}

function pendingStoragePath(runtimeHome: string, storageName: OwnedStorageName): string {
  return path.join(pendingRestoreAssetsPath(runtimeHome), storageName);
}

function databaseBackupPath(journal: WorkbenchRestoreJournal, suffix: DatabaseFileSuffix): string {
  return `${journal.backupStem}.sqlite3${suffix}`;
}

function storageBackupPath(journal: WorkbenchRestoreJournal, storageName: OwnedStorageName): string {
  return `${journal.backupStem}.${storageName}`;
}

function isDatabaseFileSuffix(value: unknown): value is DatabaseFileSuffix {
  return typeof value === "string" && DATABASE_FILE_SUFFIXES.includes(value as DatabaseFileSuffix);
}

function isOwnedStorageName(value: unknown): value is OwnedStorageName {
  return typeof value === "string" && OWNED_STORAGE_NAMES.includes(value as OwnedStorageName);
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function validateBackupCompanions(databasePath: string): Promise<1 | 2> {
  try {
    const manifest = JSON.parse(await readFile(backupManifestPath(databasePath), "utf8")) as {
      version?: unknown;
      database?: unknown;
      assets?: unknown;
      roots?: unknown;
    };
    if (manifest.database !== path.basename(databasePath)
      || manifest.assets !== path.basename(backupAssetsPath(databasePath))) {
      throw new Error("manifest mismatch");
    }
    if (manifest.version === 1) {
      if (!existsSync(backupAssetsPath(databasePath))) throw new Error("assets missing");
      return 1;
    }
    if (manifest.version !== 2
      || !Array.isArray(manifest.roots)
      || manifest.roots.length !== OWNED_STORAGE_NAMES.length
      || manifest.roots.some((value, index) => value !== OWNED_STORAGE_NAMES[index])) {
      throw new Error("manifest mismatch");
    }
    for (const storageName of OWNED_STORAGE_NAMES) {
      if (!existsSync(path.join(backupAssetsPath(databasePath), storageName))) throw new Error("assets missing");
    }
    return 2;
  } catch (error) {
    throw new WorkbenchDataMaintenanceError("restore_source_invalid", "所选备份缺少匹配的软件自管文件或清单文件。", { cause: error });
  }
}

function backupAssetsPath(databasePath: string): string {
  return `${databasePath}.assets`;
}

function backupManifestPath(databasePath: string): string {
  return `${databasePath}.manifest.json`;
}

function fileTimestamp(value: string): string {
  return value.replaceAll(":", "-");
}

function isWorkbenchDatabase(tables: readonly string[]): boolean {
  const names = new Set(tables);
  return names.has("spaces") && names.has("personal_notes");
}
