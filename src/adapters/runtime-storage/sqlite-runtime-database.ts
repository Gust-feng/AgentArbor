import { mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

export type SqliteMigration = {
  readonly version: number;
  readonly sql: string;
};

/** Host-owned SQLite connection shared by feature-specific repositories. */
export class SqliteRuntimeDatabase {
  readonly connection: DatabaseSync;
  #closed = false;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.connection = new DatabaseSync(filePath);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA synchronous = NORMAL");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        owner TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS compatibility_imports (
        import_key TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL
      ) STRICT
    `);
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS runtime_initializations (
        initialization_key TEXT PRIMARY KEY,
        initialized_at TEXT NOT NULL
      ) STRICT
    `);
  }

  migrate(owner: string, migrations: readonly SqliteMigration[]): void {
    const current = this.connection.prepare(
      "SELECT version FROM schema_migrations WHERE owner = ?",
    ).get(owner) as { readonly version: number } | undefined;
    let version = current?.version ?? 0;
    for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
      if (migration.version <= version) continue;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.prepare(`
          INSERT INTO schema_migrations(owner, version, applied_at)
          VALUES (?, ?, ?)
          ON CONFLICT(owner) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at
        `).run(owner, migration.version, new Date().toISOString());
      });
      version = migration.version;
    }
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  hasCompatibilityImport(importKey: string): boolean {
    return this.connection.prepare(
      "SELECT 1 AS found FROM compatibility_imports WHERE import_key = ?",
    ).get(importKey) !== undefined;
  }

  recordCompatibilityImport(importKey: string): void {
    this.connection.prepare(
      "INSERT OR IGNORE INTO compatibility_imports(import_key, imported_at) VALUES (?, ?)",
    ).run(importKey, new Date().toISOString());
  }

  hasInitialization(initializationKey: string): boolean {
    return this.connection.prepare(
      "SELECT 1 AS found FROM runtime_initializations WHERE initialization_key = ?",
    ).get(initializationKey) !== undefined;
  }

  recordInitialization(initializationKey: string): void {
    this.connection.prepare(
      "INSERT OR IGNORE INTO runtime_initializations(initialization_key, initialized_at) VALUES (?, ?)",
    ).run(initializationKey, new Date().toISOString());
  }

  health(): {
    readonly ok: boolean;
    readonly checks: readonly string[];
    readonly migrations: readonly { readonly owner: string; readonly version: number; readonly appliedAt: string }[];
  } {
    const checks = this.connection.prepare("PRAGMA quick_check").all()
      .map((row) => String((row as Record<string, unknown>).quick_check));
    const migrations = this.connection.prepare(`
      SELECT owner, version, applied_at AS appliedAt
      FROM schema_migrations ORDER BY owner
    `).all() as unknown as readonly { readonly owner: string; readonly version: number; readonly appliedAt: string }[];
    return { ok: checks.length === 1 && checks[0] === "ok", checks, migrations };
  }

  async backupTo(destinationPath: string): Promise<{ readonly filePath: string; readonly byteLength: number }> {
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    await backup(this.connection, destinationPath);
    const health = checkSqliteDatabaseFile(destinationPath);
    if (!health.ok) throw new Error(`SQLite backup integrity check failed: ${health.checks.join("; ")}`);
    return { filePath: destinationPath, byteLength: (await stat(destinationPath)).size };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.connection.close();
  }
}

export function checkSqliteDatabaseFile(filePath: string): {
  readonly ok: boolean;
  readonly checks: readonly string[];
  readonly tables: readonly string[];
} {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const checks = database.prepare("PRAGMA quick_check").all()
      .map((row) => String((row as Record<string, unknown>).quick_check));
    const tables = database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => String((row as Record<string, unknown>).name));
    return { ok: checks.length === 1 && checks[0] === "ok", checks, tables };
  } finally {
    database.close();
  }
}
