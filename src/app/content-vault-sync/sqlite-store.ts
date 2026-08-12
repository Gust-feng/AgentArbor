import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  contentVaultResourceSchema,
  parseContentVaultMutation,
  type ContentVaultMutation,
  type ContentVaultResource,
  type ContentVaultResourceKind,
} from "../content-vault/index.js";
import type {
  ContentVaultSyncConflict,
  ContentVaultSyncConflictReason,
  ContentVaultSyncOutboxEntry,
  ContentVaultSyncResourceClock,
} from "./contracts.js";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE content_vault_sync_accounts (
      account_id TEXT PRIMARY KEY,
      cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0),
      snapshot_initialized INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_initialized IN (0, 1))
    ) STRICT;

    CREATE TABLE content_vault_sync_clocks (
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      remote_content_hash TEXT NOT NULL,
      local_fingerprint TEXT NOT NULL,
      deleted INTEGER NOT NULL CHECK(deleted IN (0, 1)),
      PRIMARY KEY(account_id, kind, resource_id)
    ) STRICT;

    CREATE TABLE content_vault_sync_outbox (
      account_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      mutation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(account_id, mutation_id),
      UNIQUE(account_id, kind, resource_id)
    ) STRICT;

    CREATE TABLE content_vault_sync_conflicts (
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      mutation_json TEXT,
      reason TEXT NOT NULL,
      current_json TEXT,
      message TEXT,
      detected_at TEXT NOT NULL,
      PRIMARY KEY(account_id, kind, resource_id)
    ) STRICT;
  `,
}] as const;

export function createSqliteContentVaultSyncStore(database: SqliteRuntimeDatabase) {
  database.migrate("content-vault-sync", MIGRATIONS);

  function accountState(accountId: string): { readonly cursor: number; readonly snapshotInitialized: boolean } {
    const row = database.connection.prepare(`
      SELECT cursor, snapshot_initialized AS snapshotInitialized
      FROM content_vault_sync_accounts WHERE account_id = ?
    `).get(accountId) as { cursor: number; snapshotInitialized: number } | undefined;
    return row === undefined
      ? { cursor: 0, snapshotInitialized: false }
      : { cursor: Number(row.cursor), snapshotInitialized: Number(row.snapshotInitialized) === 1 };
  }

  function advanceCursor(accountId: string, cursor: number): void {
    database.connection.prepare(`
      INSERT INTO content_vault_sync_accounts(account_id, cursor, snapshot_initialized)
      VALUES (?, ?, 1)
      ON CONFLICT(account_id) DO UPDATE SET cursor = MAX(cursor, excluded.cursor)
    `).run(accountId, cursor);
  }

  function completeSnapshot(accountId: string, cursor: number): void {
    database.connection.prepare(`
      INSERT INTO content_vault_sync_accounts(account_id, cursor, snapshot_initialized)
      VALUES (?, ?, 1)
      ON CONFLICT(account_id) DO UPDATE SET
        cursor = MAX(cursor, excluded.cursor),
        snapshot_initialized = 1
    `).run(accountId, cursor);
  }

  function getClock(accountId: string, kind: ContentVaultResourceKind, resourceId: string): ContentVaultSyncResourceClock | undefined {
    const row = database.connection.prepare(`
      SELECT account_id AS accountId, kind, resource_id AS resourceId, revision,
             remote_content_hash AS remoteContentHash, local_fingerprint AS localFingerprint, deleted
      FROM content_vault_sync_clocks
      WHERE account_id = ? AND kind = ? AND resource_id = ?
    `).get(accountId, kind, resourceId) as ClockRow | undefined;
    return row === undefined ? undefined : clockFromRow(row);
  }

  function listClocks(accountId: string, kind: ContentVaultResourceKind): readonly ContentVaultSyncResourceClock[] {
    const rows = database.connection.prepare(`
      SELECT account_id AS accountId, kind, resource_id AS resourceId, revision,
             remote_content_hash AS remoteContentHash, local_fingerprint AS localFingerprint, deleted
      FROM content_vault_sync_clocks WHERE account_id = ? AND kind = ?
      ORDER BY resource_id
    `).all(accountId, kind) as unknown as readonly ClockRow[];
    return rows.map(clockFromRow);
  }

  function saveClock(accountId: string, resource: ContentVaultResource, localFingerprint: string): void {
    upsertClock(database, accountId, resource, localFingerprint);
  }

  function recordAppliedChange(accountId: string, cursor: number, resource: ContentVaultResource, localFingerprint: string): void {
    database.transaction(() => {
      upsertClock(database, accountId, resource, localFingerprint);
      advanceCursor(accountId, cursor);
    });
  }

  function enqueue(accountId: string, mutation: ContentVaultMutation, createdAt: string): void {
    const parsed = parseContentVaultMutation(mutation);
    database.connection.prepare(`
      INSERT INTO content_vault_sync_outbox(
        account_id, mutation_id, kind, resource_id, mutation_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, kind, resource_id) DO UPDATE SET
        mutation_id = excluded.mutation_id,
        mutation_json = excluded.mutation_json,
        created_at = excluded.created_at
    `).run(accountId, parsed.mutationId, parsed.kind, parsed.resourceId, JSON.stringify(parsed), createdAt);
  }

  function pending(accountId: string, limit = 100): readonly ContentVaultSyncOutboxEntry[] {
    const rows = database.connection.prepare(`
      SELECT account_id AS accountId, mutation_json AS mutationJson, created_at AS createdAt
      FROM content_vault_sync_outbox WHERE account_id = ?
      ORDER BY created_at, mutation_id LIMIT ?
    `).all(accountId, Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as readonly OutboxRow[];
    return rows.map((row) => ({
      accountId: row.accountId,
      mutation: parseContentVaultMutation(JSON.parse(row.mutationJson) as unknown),
      createdAt: row.createdAt,
    }));
  }

  function outboxForResource(accountId: string, kind: ContentVaultResourceKind, resourceId: string): ContentVaultSyncOutboxEntry | undefined {
    const row = database.connection.prepare(`
      SELECT account_id AS accountId, mutation_json AS mutationJson, created_at AS createdAt
      FROM content_vault_sync_outbox
      WHERE account_id = ? AND kind = ? AND resource_id = ?
    `).get(accountId, kind, resourceId) as OutboxRow | undefined;
    return row === undefined ? undefined : {
      accountId: row.accountId,
      mutation: parseContentVaultMutation(JSON.parse(row.mutationJson) as unknown),
      createdAt: row.createdAt,
    };
  }

  function acceptOutbox(accountId: string, mutationId: string, resource: ContentVaultResource, localFingerprint: string): void {
    database.transaction(() => {
      database.connection.prepare(`
        DELETE FROM content_vault_sync_outbox WHERE account_id = ? AND mutation_id = ?
      `).run(accountId, mutationId);
      upsertClock(database, accountId, resource, localFingerprint);
    });
  }

  function recordConflict(input: ContentVaultSyncConflict, cursor?: number): void {
    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO content_vault_sync_conflicts(
          account_id, kind, resource_id, mutation_json, reason, current_json, message, detected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, kind, resource_id) DO UPDATE SET
          mutation_json = excluded.mutation_json,
          reason = excluded.reason,
          current_json = excluded.current_json,
          message = excluded.message,
          detected_at = excluded.detected_at
      `).run(
        input.accountId,
        input.kind,
        input.resourceId,
        input.mutation === undefined ? null : JSON.stringify(input.mutation),
        input.reason,
        input.current === undefined ? null : JSON.stringify(input.current),
        input.message ?? null,
        input.detectedAt,
      );
      if (input.mutation !== undefined) {
        database.connection.prepare(`
          DELETE FROM content_vault_sync_outbox
          WHERE account_id = ? AND mutation_id = ?
        `).run(input.accountId, input.mutation.mutationId);
      }
      if (cursor !== undefined) advanceCursor(input.accountId, cursor);
    });
  }

  function resolveConflict(
    accountId: string,
    resource: ContentVaultResource,
    localFingerprint: string,
  ): void {
    database.transaction(() => {
      upsertClock(database, accountId, resource, localFingerprint);
      database.connection.prepare(`
        DELETE FROM content_vault_sync_conflicts
        WHERE account_id = ? AND kind = ? AND resource_id = ?
      `).run(accountId, resource.kind, resource.resourceId);
    });
  }

  function getConflict(accountId: string, kind: ContentVaultResourceKind, resourceId: string): ContentVaultSyncConflict | undefined {
    const row = database.connection.prepare(`
      SELECT account_id AS accountId, kind, resource_id AS resourceId,
             mutation_json AS mutationJson, reason, current_json AS currentJson,
             message, detected_at AS detectedAt
      FROM content_vault_sync_conflicts
      WHERE account_id = ? AND kind = ? AND resource_id = ?
    `).get(accountId, kind, resourceId) as ConflictRow | undefined;
    return row === undefined ? undefined : conflictFromRow(row);
  }

  function listConflicts(accountId: string): readonly ContentVaultSyncConflict[] {
    const rows = database.connection.prepare(`
      SELECT account_id AS accountId, kind, resource_id AS resourceId,
             mutation_json AS mutationJson, reason, current_json AS currentJson,
             message, detected_at AS detectedAt
      FROM content_vault_sync_conflicts WHERE account_id = ?
      ORDER BY detected_at, kind, resource_id
    `).all(accountId) as unknown as readonly ConflictRow[];
    return rows.map(conflictFromRow);
  }

  function clearAccount(accountId: string): void {
    database.transaction(() => {
      database.connection.prepare("DELETE FROM content_vault_sync_conflicts WHERE account_id = ?").run(accountId);
      database.connection.prepare("DELETE FROM content_vault_sync_outbox WHERE account_id = ?").run(accountId);
      database.connection.prepare("DELETE FROM content_vault_sync_clocks WHERE account_id = ?").run(accountId);
      database.connection.prepare("DELETE FROM content_vault_sync_accounts WHERE account_id = ?").run(accountId);
    });
  }

  return {
    accountState,
    advanceCursor,
    completeSnapshot,
    getClock,
    listClocks,
    saveClock,
    recordAppliedChange,
    enqueue,
    pending,
    outboxForResource,
    acceptOutbox,
    recordConflict,
    resolveConflict,
    getConflict,
    listConflicts,
    clearAccount,
  };
}

export type ContentVaultSyncStore = ReturnType<typeof createSqliteContentVaultSyncStore>;

function upsertClock(
  database: SqliteRuntimeDatabase,
  accountId: string,
  resource: ContentVaultResource,
  localFingerprint: string,
): void {
  database.connection.prepare(`
    INSERT INTO content_vault_sync_clocks(
      account_id, kind, resource_id, revision, remote_content_hash, local_fingerprint, deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, kind, resource_id) DO UPDATE SET
      revision = excluded.revision,
      remote_content_hash = excluded.remote_content_hash,
      local_fingerprint = excluded.local_fingerprint,
      deleted = excluded.deleted
  `).run(
    accountId,
    resource.kind,
    resource.resourceId,
    resource.revision,
    resource.contentHash,
    localFingerprint,
    resource.deleted ? 1 : 0,
  );
}

type ClockRow = {
  readonly accountId: string;
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly revision: number;
  readonly remoteContentHash: string;
  readonly localFingerprint: string;
  readonly deleted: number;
};

type OutboxRow = { readonly accountId: string; readonly mutationJson: string; readonly createdAt: string };

type ConflictRow = {
  readonly accountId: string;
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly mutationJson: string | null;
  readonly reason: ContentVaultSyncConflictReason;
  readonly currentJson: string | null;
  readonly message: string | null;
  readonly detectedAt: string;
};

function clockFromRow(row: ClockRow): ContentVaultSyncResourceClock {
  return { ...row, revision: Number(row.revision), deleted: Number(row.deleted) === 1 };
}

function conflictFromRow(row: ConflictRow): ContentVaultSyncConflict {
  return {
    accountId: row.accountId,
    kind: row.kind,
    resourceId: row.resourceId,
    ...(row.mutationJson === null ? {} : { mutation: parseContentVaultMutation(JSON.parse(row.mutationJson) as unknown) }),
    reason: row.reason,
    ...(row.currentJson === null ? {} : { current: contentVaultResourceSchema.parse(JSON.parse(row.currentJson) as unknown) }),
    ...(row.message === null ? {} : { message: row.message }),
    detectedAt: row.detectedAt,
  };
}
