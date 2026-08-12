import { createHash } from "node:crypto";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/sqlite-runtime-database.js";
import {
  canonicalContentVaultJson,
  CONTENT_VAULT_MAX_INLINE_BYTES,
  type ContentVaultChange,
  type ContentVaultMutation,
  type ContentVaultMutationResult,
  type ContentVaultResource,
  type ContentVaultResourceKind,
  type ContentVaultSnapshotCursor,
  type ContentVaultUsage,
  parseContentVaultMutation,
  parseContentVaultPayload,
} from "./contracts.js";

const DEFAULT_ACCOUNT_BYTES = 150 * 1_024 * 1_024;
const DEFAULT_MAX_RESOURCES = 50_000;
const VAULT_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const TOMBSTONE_HASH = hashText("null");

const CONTENT_VAULT_MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE vault_resources (
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      deleted INTEGER NOT NULL CHECK(deleted IN (0, 1)),
      payload_schema_version INTEGER NOT NULL,
      payload_json TEXT,
      content_hash TEXT NOT NULL,
      content_bytes INTEGER NOT NULL CHECK(content_bytes >= 0),
      updated_at TEXT NOT NULL,
      updated_by_device_id TEXT NOT NULL,
      PRIMARY KEY(account_id, kind, resource_id),
      CHECK((deleted = 1 AND payload_json IS NULL AND content_bytes = 0) OR (deleted = 0 AND payload_json IS NOT NULL))
    ) STRICT;

    CREATE TABLE vault_changes (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      changed_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX vault_changes_account_cursor ON vault_changes(account_id, cursor);

    CREATE TABLE vault_mutations (
      account_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(account_id, mutation_id)
    ) STRICT;
  `,
}, {
  version: 2,
  sql: `
    CREATE INDEX vault_changes_account_resource_cursor
      ON vault_changes(account_id, kind, resource_id, cursor);
  `,
}, {
  version: 3,
  sql: `
    CREATE INDEX vault_changes_account_changed_at
      ON vault_changes(account_id, changed_at);
    CREATE INDEX vault_mutations_account_created_at
      ON vault_mutations(account_id, created_at);
  `,
}] as const;

export class ContentVaultError extends Error {
  readonly name = "ContentVaultError";

  constructor(
    readonly code:
      | "content_hash_mismatch"
      | "mutation_id_reused"
      | "resource_too_large"
      | "vault_quota_exceeded"
      | "vault_resource_limit_exceeded"
      | "vault_repository_failure",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ContentVaultRepository = ReturnType<typeof createSqliteContentVaultRepository>;

export function createSqliteContentVaultRepository(input: {
  readonly database: SqliteRuntimeDatabase;
  readonly accountBytes?: number;
  readonly maxResources?: number;
}) {
  const database = input.database;
  const accountBytes = input.accountBytes ?? DEFAULT_ACCOUNT_BYTES;
  const maxResources = input.maxResources ?? DEFAULT_MAX_RESOURCES;
  if (!Number.isSafeInteger(accountBytes) || accountBytes < 1) throw new Error("Content Vault account byte limit must be a positive safe integer");
  if (!Number.isSafeInteger(maxResources) || maxResources < 1) throw new Error("Content Vault resource limit must be a positive safe integer");
  database.migrate("content-vault", CONTENT_VAULT_MIGRATIONS);

  function applyMutation(inputMutation: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly mutation: ContentVaultMutation;
    readonly at: string;
  }): ContentVaultMutationResult {
    const mutation = parseContentVaultMutation(inputMutation.mutation);
    const requestHash = hashText(canonicalJson(mutation));
    try {
      return database.transaction(() => {
        maintainAccountHistory(inputMutation.accountId, inputMutation.at);
        const previous = database.connection.prepare(`
          SELECT request_hash AS requestHash, result_json AS resultJson
          FROM vault_mutations WHERE account_id = ? AND mutation_id = ?
        `).get(inputMutation.accountId, mutation.mutationId) as MutationRow | undefined;
        if (previous !== undefined) {
          if (previous.requestHash !== requestHash) {
            throw new ContentVaultError("mutation_id_reused", `Mutation ${mutation.mutationId} was reused with different content`);
          }
          return JSON.parse(previous.resultJson) as ContentVaultMutationResult;
        }

        const current = readResource(inputMutation.accountId, mutation.kind, mutation.resourceId);
        const conflict = mutationConflict(mutation, current);
        if (conflict !== undefined) {
          saveMutationResult(inputMutation.accountId, mutation.mutationId, requestHash, conflict, inputMutation.at);
          return conflict;
        }

        const revision = (current?.revision ?? 0) + 1;
        const materialized = materializeResource({
          accountId: inputMutation.accountId,
          deviceId: inputMutation.deviceId,
          mutation,
          revision,
          at: inputMutation.at,
        });
        enforceQuota(inputMutation.accountId, current, materialized);
        database.connection.prepare(`
          INSERT INTO vault_resources(
            account_id, kind, resource_id, revision, deleted, payload_schema_version,
            payload_json, content_hash, content_bytes, updated_at, updated_by_device_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, kind, resource_id) DO UPDATE SET
            revision = excluded.revision,
            deleted = excluded.deleted,
            payload_schema_version = excluded.payload_schema_version,
            payload_json = excluded.payload_json,
            content_hash = excluded.content_hash,
            content_bytes = excluded.content_bytes,
            updated_at = excluded.updated_at,
            updated_by_device_id = excluded.updated_by_device_id
        `).run(
          inputMutation.accountId,
          materialized.kind,
          materialized.resourceId,
          materialized.revision,
          materialized.deleted ? 1 : 0,
          materialized.payloadSchemaVersion,
          materialized.payload === undefined ? null : canonicalJson(materialized.payload),
          materialized.contentHash,
          materialized.contentBytes,
          materialized.updatedAt,
          materialized.updatedByDeviceId,
        );
        const change = database.connection.prepare(`
          INSERT INTO vault_changes(account_id, kind, resource_id, revision, changed_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(inputMutation.accountId, materialized.kind, materialized.resourceId, materialized.revision, inputMutation.at);
        const result: ContentVaultMutationResult = {
          status: "applied",
          mutationId: mutation.mutationId,
          cursor: Number(change.lastInsertRowid),
          resource: materialized,
        };
        saveMutationResult(inputMutation.accountId, mutation.mutationId, requestHash, result, inputMutation.at);
        return result;
      });
    } catch (error) {
      if (error instanceof ContentVaultError) throw error;
      throw new ContentVaultError("vault_repository_failure", "Content Vault mutation could not be persisted", { cause: error });
    }
  }

  function readResource(
    accountId: string,
    kind: ContentVaultResourceKind,
    resourceId: string,
  ): ContentVaultResource | undefined {
    const row = database.connection.prepare(`
      SELECT kind, resource_id AS resourceId, revision, deleted,
             payload_schema_version AS payloadSchemaVersion, payload_json AS payloadJson,
             content_hash AS contentHash, content_bytes AS contentBytes,
             updated_at AS updatedAt, updated_by_device_id AS updatedByDeviceId
      FROM vault_resources WHERE account_id = ? AND kind = ? AND resource_id = ?
    `).get(accountId, kind, resourceId) as ResourceRow | undefined;
    return row === undefined ? undefined : resourceFromRow(row);
  }

  function listChanges(
    accountId: string,
    afterCursor: number,
    limit: number,
    maxJsonBytes = Number.POSITIVE_INFINITY,
  ): readonly ContentVaultChange[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const candidates = database.connection.prepare(`
      WITH latest AS (
        SELECT kind, resource_id, MAX(cursor) AS cursor
        FROM vault_changes
        WHERE account_id = ? AND cursor > ?
        GROUP BY kind, resource_id
      )
      SELECT cursor, kind, resource_id AS resourceId
      FROM latest
      ORDER BY cursor ASC
      LIMIT ?
    `).all(
      accountId,
      Math.max(0, Math.floor(afterCursor)),
      boundedLimit,
    ) as unknown as readonly { readonly cursor: number; readonly kind: ContentVaultResourceKind; readonly resourceId: string }[];

    const changes: ContentVaultChange[] = [];
    let jsonBytes = 0;
    for (const candidate of candidates) {
      const resource = readResource(accountId, candidate.kind, candidate.resourceId);
      if (resource === undefined) {
        throw new ContentVaultError("vault_repository_failure", `Content Vault change ${candidate.cursor} has no resource`);
      }
      const change = { cursor: Number(candidate.cursor), resource };
      const changeBytes = Buffer.byteLength(JSON.stringify(change), "utf8") + 1;
      if (changes.length > 0 && jsonBytes + changeBytes > maxJsonBytes) break;
      changes.push(change);
      jsonBytes += changeBytes;
    }
    return changes;
  }

  function snapshot(
    accountId: string,
    cursor: ContentVaultSnapshotCursor | undefined,
    limit: number,
    maxJsonBytes = Number.POSITIVE_INFINITY,
  ): {
    readonly resources: readonly ContentVaultResource[];
    readonly nextCursor?: ContentVaultSnapshotCursor;
    readonly changeCursor: number;
  } {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const changeCursor = cursor?.changeCursor ?? currentCursor(accountId);
    const afterKind = cursor !== undefined && "afterKind" in cursor ? cursor.afterKind : undefined;
    const afterResourceId = cursor !== undefined && "afterResourceId" in cursor ? cursor.afterResourceId : undefined;
    const afterRank = afterKind === undefined ? -1 : resourceKindRank(afterKind);
    const rows = database.connection.prepare(`
      WITH eligible AS (
        SELECT kind, resource_id
        FROM vault_changes
        WHERE account_id = ? AND cursor <= ?
        GROUP BY kind, resource_id
      )
      SELECT r.kind, r.resource_id AS resourceId
      FROM eligible e
      JOIN vault_resources r
        ON r.account_id = ? AND r.kind = e.kind AND r.resource_id = e.resource_id
      WHERE ? IS NULL OR
        CASE r.kind
          WHEN 'space' THEN 0
          WHEN 'managed_root' THEN 1
          WHEN 'workbench_asset' THEN 2
          WHEN 'managed_file' THEN 3
          WHEN 'space_reference' THEN 4
          WHEN 'personal_note' THEN 5
          WHEN 'knowledge_page' THEN 6
          WHEN 'knowledge_theme' THEN 7
          WHEN 'knowledge_link' THEN 8
          WHEN 'knowledge_assignment' THEN 9
          WHEN 'agent_notebook' THEN 10
          ELSE 11
        END > ? OR (r.kind = ? AND r.resource_id > ?)
      ORDER BY
        CASE r.kind
          WHEN 'space' THEN 0
          WHEN 'managed_root' THEN 1
          WHEN 'workbench_asset' THEN 2
          WHEN 'managed_file' THEN 3
          WHEN 'space_reference' THEN 4
          WHEN 'personal_note' THEN 5
          WHEN 'knowledge_page' THEN 6
          WHEN 'knowledge_theme' THEN 7
          WHEN 'knowledge_link' THEN 8
          WHEN 'knowledge_assignment' THEN 9
          WHEN 'agent_notebook' THEN 10
          ELSE 11
        END,
        r.kind,
        r.resource_id
      LIMIT ?
    `).all(
      accountId,
      changeCursor,
      accountId,
      afterKind ?? null,
      afterRank,
      afterKind ?? "",
      afterResourceId ?? "",
      boundedLimit + 1,
    ) as unknown as readonly { readonly kind: ContentVaultResourceKind; readonly resourceId: string }[];
    let hasMore = rows.length > boundedLimit;
    const resources: ContentVaultResource[] = [];
    let jsonBytes = 0;
    for (const row of rows.slice(0, boundedLimit)) {
      const resource = readResource(accountId, row.kind, row.resourceId);
      if (resource === undefined) {
        throw new ContentVaultError("vault_repository_failure", `Content Vault snapshot resource ${row.kind}/${row.resourceId} is missing`);
      }
      const resourceBytes = Buffer.byteLength(JSON.stringify(resource), "utf8") + 1;
      if (resources.length > 0 && jsonBytes + resourceBytes > maxJsonBytes) {
        hasMore = true;
        break;
      }
      resources.push(resource);
      jsonBytes += resourceBytes;
    }
    const last = resources.at(-1);
    return {
      resources,
      ...(hasMore && last !== undefined ? {
        nextCursor: {
          changeCursor,
          afterKind: last.kind,
          afterResourceId: last.resourceId,
        },
      } : {}),
      changeCursor,
    };
  }

  function usage(accountId: string): ContentVaultUsage {
    const row = database.connection.prepare(`
      SELECT COALESCE(SUM(content_bytes), 0) AS contentBytes, COUNT(*) AS activeResources
      FROM vault_resources WHERE account_id = ? AND deleted = 0
    `).get(accountId) as { contentBytes: number; activeResources: number };
    return {
      contentBytes: Number(row.contentBytes),
      contentLimitBytes: accountBytes,
      activeResources: Number(row.activeResources),
      resourceLimit: maxResources,
    };
  }

  function currentCursor(accountId: string): number {
    const row = database.connection.prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM vault_changes WHERE account_id = ?")
      .get(accountId) as { cursor: number };
    return Number(row.cursor);
  }

  function enforceQuota(
    accountId: string,
    current: ContentVaultResource | undefined,
    next: ContentVaultResource,
  ): void {
    if (next.contentBytes > CONTENT_VAULT_MAX_INLINE_BYTES) {
      throw new ContentVaultError("resource_too_large", "The Content Vault resource exceeds the 5 MiB inline limit");
    }
    if (current === undefined && totalResourceIdentities(accountId) >= maxResources) {
      throw new ContentVaultError("vault_resource_limit_exceeded", "The account Content Vault resource identity limit would be exceeded");
    }
    const currentUsage = usage(accountId);
    const currentActive = current !== undefined && !current.deleted;
    const nextActive = !next.deleted;
    const nextBytes = currentUsage.contentBytes - (currentActive ? current.contentBytes : 0) + (nextActive ? next.contentBytes : 0);
    const nextResources = currentUsage.activeResources - (currentActive ? 1 : 0) + (nextActive ? 1 : 0);
    if (nextBytes > accountBytes) throw new ContentVaultError("vault_quota_exceeded", "The account Content Vault quota would be exceeded");
    if (nextResources > maxResources) {
      throw new ContentVaultError("vault_resource_limit_exceeded", "The account Content Vault resource limit would be exceeded");
    }
  }

  function saveMutationResult(
    accountId: string,
    mutationId: string,
    requestHash: string,
    result: ContentVaultMutationResult,
    createdAt: string,
  ): void {
    database.connection.prepare(`
      INSERT INTO vault_mutations(account_id, mutation_id, request_hash, result_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(accountId, mutationId, requestHash, JSON.stringify(result), createdAt);
  }

  function totalResourceIdentities(accountId: string): number {
    const row = database.connection.prepare("SELECT COUNT(*) AS count FROM vault_resources WHERE account_id = ?")
      .get(accountId) as { readonly count: number };
    return Number(row.count);
  }

  function maintainAccountHistory(accountId: string, at: string): void {
    const timestamp = Date.parse(at);
    if (!Number.isFinite(timestamp)) {
      throw new ContentVaultError("vault_repository_failure", "Content Vault mutation time is invalid");
    }
    const cutoff = new Date(timestamp - VAULT_HISTORY_RETENTION_MS).toISOString();
    database.connection.prepare(`
      DELETE FROM vault_changes
      WHERE account_id = ? AND changed_at < ? AND cursor NOT IN (
        SELECT MAX(cursor) FROM vault_changes
        WHERE account_id = ?
        GROUP BY kind, resource_id
      )
    `).run(accountId, cutoff, accountId);
    database.connection.prepare(`
      DELETE FROM vault_mutations
      WHERE account_id = ? AND created_at < ?
    `).run(accountId, cutoff);
  }

  return { applyMutation, readResource, listChanges, snapshot, usage, currentCursor };
}

function resourceKindRank(kind: ContentVaultResourceKind): number {
  return [
    "space",
    "managed_root",
    "workbench_asset",
    "managed_file",
    "space_reference",
    "personal_note",
    "knowledge_page",
    "knowledge_theme",
    "knowledge_link",
    "knowledge_assignment",
    "agent_notebook",
  ].indexOf(kind);
}

function mutationConflict(
  mutation: ContentVaultMutation,
  current: ContentVaultResource | undefined,
): ContentVaultMutationResult | undefined {
  if (current === undefined) {
    return mutation.operation === "upsert" && mutation.baseRevision === 0
      ? undefined
      : { status: "conflict", mutationId: mutation.mutationId, reason: "resource_not_found" };
  }
  if (mutation.baseRevision !== current.revision) {
    return { status: "conflict", mutationId: mutation.mutationId, reason: "revision_mismatch", current };
  }
  if (mutation.operation === "delete" && current.deleted) {
    return { status: "conflict", mutationId: mutation.mutationId, reason: "resource_deleted", current };
  }
  return undefined;
}

function materializeResource(input: {
  readonly accountId: string;
  readonly deviceId: string;
  readonly mutation: ContentVaultMutation;
  readonly revision: number;
  readonly at: string;
}): ContentVaultResource {
  if (input.mutation.operation === "delete") {
    return {
      kind: input.mutation.kind,
      resourceId: input.mutation.resourceId,
      revision: input.revision,
      deleted: true,
      payloadSchemaVersion: 1,
      contentHash: TOMBSTONE_HASH,
      contentBytes: 0,
      updatedAt: input.at,
      updatedByDeviceId: input.deviceId,
    };
  }
  const payload = parseContentVaultPayload(input.mutation.kind, input.mutation.payload);
  const payloadJson = canonicalContentVaultJson(payload);
  const calculatedHash = hashText(payloadJson);
  if (calculatedHash !== input.mutation.contentHash) {
    throw new ContentVaultError("content_hash_mismatch", "The mutation content hash does not match its canonical payload");
  }
  return {
    kind: input.mutation.kind,
    resourceId: input.mutation.resourceId,
    revision: input.revision,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: calculatedHash,
    contentBytes: Buffer.byteLength(payloadJson, "utf8"),
    updatedAt: input.at,
    updatedByDeviceId: input.deviceId,
  };
}

function resourceFromRow(row: ResourceRow): ContentVaultResource {
  const kind = row.kind as ContentVaultResourceKind;
  const deleted = Number(row.deleted) === 1;
  return {
    kind,
    resourceId: row.resourceId,
    revision: Number(row.revision),
    deleted,
    payloadSchemaVersion: 1,
    ...(deleted || row.payloadJson === null ? {} : { payload: parseContentVaultPayload(kind, JSON.parse(row.payloadJson) as unknown) }),
    contentHash: row.contentHash,
    contentBytes: Number(row.contentBytes),
    updatedAt: row.updatedAt,
    updatedByDeviceId: row.updatedByDeviceId,
  };
}

export function canonicalJson(value: unknown): string {
  return canonicalContentVaultJson(value);
}

export function contentVaultHash(value: unknown): string {
  return hashText(canonicalJson(value));
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

type MutationRow = { readonly requestHash: string; readonly resultJson: string };
type ResourceRow = {
  readonly kind: string;
  readonly resourceId: string;
  readonly revision: number;
  readonly deleted: number;
  readonly payloadSchemaVersion: number;
  readonly payloadJson: string | null;
  readonly contentHash: string;
  readonly contentBytes: number;
  readonly updatedAt: string;
  readonly updatedByDeviceId: string;
};
type ChangeRow = ResourceRow & { readonly cursor: number };
