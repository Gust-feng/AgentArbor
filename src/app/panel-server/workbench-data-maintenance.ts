import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
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
const OWNED_STORAGE_NAMES = ["knowledge-assets", "space-folders"] as const;

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
  readonly runOwnedStorageSnapshot?: <T>(operation: () => Promise<T>) => Promise<T>;
}): WorkbenchDataMaintenance {
  const pendingRestorePath = path.join(input.runtimeHome, PENDING_RESTORE_FILE_NAME);
  const pendingRestoreAssetsPath = path.join(input.runtimeHome, PENDING_RESTORE_ASSETS_NAME);
  let queue = Promise.resolve();
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
  const createOwnedStorageSnapshot = async () => input.runOwnedStorageSnapshot === undefined
    ? await createBackup()
    : await input.runOwnedStorageSnapshot(createBackup);
  return {
    health() {
      return { ...input.database.health(), pendingRestore: existsSync(pendingRestorePath) };
    },
    createBackup() {
      return run(createOwnedStorageSnapshot);
    },
    selectAndStageRestore() {
      return run(async () => {
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
        const safetyBackup = await createOwnedStorageSnapshot();
        const stagingPath = `${pendingRestorePath}.tmp`;
        const stagingAssetsPath = `${pendingRestoreAssetsPath}.tmp`;
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
          await rename(stagingPath, pendingRestorePath);
          await rename(stagingAssetsPath, pendingRestoreAssetsPath);
        } catch (error) {
          await rm(stagingPath, { force: true }).catch(() => undefined);
          await rm(stagingAssetsPath, { recursive: true, force: true }).catch(() => undefined);
          throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 恢复文件暂存失败。", { cause: error });
        }
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
export function applyPendingWorkbenchRestore(runtimeHome: string): void {
  const databasePath = path.join(runtimeHome, DATABASE_FILE_NAME);
  const pendingPath = path.join(runtimeHome, PENDING_RESTORE_FILE_NAME);
  const pendingAssetsPath = path.join(runtimeHome, PENDING_RESTORE_ASSETS_NAME);
  if (!existsSync(pendingPath)) return;
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

  const replacedRoot = path.join(runtimeHome, "backups", `replaced-${fileTimestamp(new Date().toISOString())}`);
  mkdirSync(path.dirname(replacedRoot), { recursive: true });
  const moved: Array<{ readonly from: string; readonly to: string }> = [];
  let installedDatabase = false;
  const installedStorageNames: string[] = [];
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      const current = `${databasePath}${suffix}`;
      if (!existsSync(current)) continue;
      const backup = `${replacedRoot}.sqlite3${suffix}`;
      renameSync(current, backup);
      moved.push({ from: current, to: backup });
    }
    for (const storageName of OWNED_STORAGE_NAMES) {
      const currentStorage = path.join(runtimeHome, storageName);
      if (!existsSync(currentStorage)) continue;
      const backupStorage = `${replacedRoot}.${storageName}`;
      renameSync(currentStorage, backupStorage);
      moved.push({ from: currentStorage, to: backupStorage });
    }
    renameSync(pendingPath, databasePath);
    installedDatabase = true;
    for (const storageName of OWNED_STORAGE_NAMES) {
      renameSync(path.join(pendingAssetsPath, storageName), path.join(runtimeHome, storageName));
      installedStorageNames.push(storageName);
    }
    rmSync(pendingAssetsPath, { recursive: true, force: false });
  } catch (error) {
    mkdirSync(pendingAssetsPath, { recursive: true });
    for (const storageName of installedStorageNames.reverse()) {
      const currentStorage = path.join(runtimeHome, storageName);
      const pendingStorage = path.join(pendingAssetsPath, storageName);
      if (existsSync(currentStorage) && !existsSync(pendingStorage)) renameSync(currentStorage, pendingStorage);
    }
    if (installedDatabase && existsSync(databasePath) && !existsSync(pendingPath)) renameSync(databasePath, pendingPath);
    for (const entry of moved.reverse()) {
      if (existsSync(entry.to) && !existsSync(entry.from)) renameSync(entry.to, entry.from);
    }
    throw new WorkbenchDataMaintenanceError("data_maintenance_failed", "Workbench 数据库恢复失败，原数据库已保留。", { cause: error });
  }
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
