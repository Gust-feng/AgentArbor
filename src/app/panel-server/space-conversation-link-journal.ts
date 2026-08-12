import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";

/**
 * Durable Host records for the two workflows that cross the Space and Ordinary
 * feature stores: creating a new Space-owned Conversation and deleting one.
 */
export const SPACE_CONVERSATION_LINK_SCHEMA_VERSION = "space-conversation-link/v1" as const;

export type SpaceConversationBirthPhase =
  | "prepared"
  | "owner_linked"
  | "conversation_created";

export type SpaceConversationDeletePhase =
  | "prepared"
  | "processes_stopped"
  | "conversation_deleted"
  | "reference_unlinked";

export type SpaceConversationBirthRecord = {
  readonly schemaVersion: typeof SPACE_CONVERSATION_LINK_SCHEMA_VERSION;
  readonly operation: "birth";
  readonly operationId: string;
  readonly conversationId: string;
  /** Canonical owner（ADR-0035）。space owner 时与 spaceId 一致。 */
  readonly ownerKind: "space" | "workspace";
  readonly ownerId: string;
  /** space owner 的 Space 树引用；workspace owner 不存在该身份。 */
  readonly spaceId?: string;
  readonly referenceItemId?: string;
  readonly phase: SpaceConversationBirthPhase;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceConversationDeleteRecord = {
  readonly schemaVersion: typeof SPACE_CONVERSATION_LINK_SCHEMA_VERSION;
  readonly operation: "delete";
  readonly operationId: string;
  readonly conversationId: string;
  /** Undefined only for a legacy Conversation that had no Space owner at deletion start. */
  readonly spaceId?: string;
  /** The immutable link identity prevents a recovery pass from removing a replacement link. */
  readonly referenceItemId?: string;
  readonly phase: SpaceConversationDeletePhase;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SpaceConversationLinkRecord =
  | SpaceConversationBirthRecord
  | SpaceConversationDeleteRecord;

export interface SpaceConversationLinkJournal {
  list(): Promise<readonly SpaceConversationLinkRecord[]>;
  getByConversation(conversationId: string): Promise<SpaceConversationLinkRecord | undefined>;
  save(record: SpaceConversationLinkRecord): Promise<void>;
  delete(operationId: string): Promise<void>;
}

const phaseSchema = z.enum([
  "prepared",
  "owner_linked",
  "conversation_created",
  "processes_stopped",
  "conversation_deleted",
  "reference_unlinked",
]);

const persistedRecordSchema = z.object({
  schemaVersion: z.literal(SPACE_CONVERSATION_LINK_SCHEMA_VERSION),
  operation: z.enum(["birth", "delete"]),
  operationId: z.string().uuid(),
  conversationId: z.string().min(1),
  ownerKind: z.enum(["space", "workspace"]).optional(),
  ownerId: z.string().min(1).optional(),
  spaceId: z.string().min(1).optional(),
  referenceItemId: z.string().min(1).optional(),
  phase: phaseSchema,
  lastErrorMessage: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict().superRefine((record, context) => {
  if (record.operation === "birth") {
    if (record.ownerKind === undefined || record.ownerId === undefined) {
      context.addIssue({ code: "custom", message: "birth records require canonical owner identity" });
    }
    if (record.ownerKind === "space" && (record.spaceId === undefined || record.referenceItemId === undefined)) {
      context.addIssue({ code: "custom", message: "space birth records require Space and reference identities" });
    }
    if (record.phase !== "prepared" && record.phase !== "owner_linked" && record.phase !== "conversation_created") {
      context.addIssue({ code: "custom", path: ["phase"], message: "birth record has an invalid phase" });
    }
    return;
  }
  if ((record.spaceId === undefined) !== (record.referenceItemId === undefined)) {
    context.addIssue({ code: "custom", message: "delete records carry both Space and reference identities or neither" });
  }
  if (
    record.phase !== "prepared" &&
    record.phase !== "processes_stopped" &&
    record.phase !== "conversation_deleted" &&
    record.phase !== "reference_unlinked"
  ) {
    context.addIssue({ code: "custom", path: ["phase"], message: "delete record has an invalid phase" });
  }
});

type JournalRow = {
  readonly schemaVersion: string;
  readonly operation: string;
  readonly operationId: string;
  readonly conversationId: string;
  readonly ownerKind: string | null;
  readonly ownerId: string | null;
  readonly spaceId: string | null;
  readonly referenceItemId: string | null;
  readonly phase: string;
  readonly lastErrorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export function createSqliteSpaceConversationLinkJournal(
  database: SqliteRuntimeDatabase,
): SpaceConversationLinkJournal {
  database.migrate("space-conversation-link", [{
    version: 1,
    sql: `
      CREATE TABLE space_conversation_links (
        operation_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        operation TEXT NOT NULL,
        conversation_id TEXT NOT NULL UNIQUE,
        space_id TEXT,
        reference_item_id TEXT,
        phase TEXT NOT NULL,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  }, {
    version: 2,
    sql: `
      ALTER TABLE space_conversation_links ADD COLUMN owner_kind TEXT;
      ALTER TABLE space_conversation_links ADD COLUMN owner_id TEXT;
    `,
  }]);

  const selectColumns = `
    schema_version AS schemaVersion,
    operation,
    operation_id AS operationId,
    conversation_id AS conversationId,
    owner_kind AS ownerKind,
    owner_id AS ownerId,
    space_id AS spaceId,
    reference_item_id AS referenceItemId,
    phase,
    last_error_message AS lastErrorMessage,
    created_at AS createdAt,
    updated_at AS updatedAt
  `;

  return {
    async list() {
      const rows = database.connection.prepare(`
        SELECT ${selectColumns}
        FROM space_conversation_links
        ORDER BY created_at, operation_id
      `).all() as unknown as readonly JournalRow[];
      return rows.map(recordFromRow);
    },

    async getByConversation(conversationId) {
      const row = database.connection.prepare(`
        SELECT ${selectColumns}
        FROM space_conversation_links
        WHERE conversation_id = ?
      `).get(conversationId) as JournalRow | undefined;
      return row === undefined ? undefined : recordFromRow(row);
    },

    async save(value) {
      const record = validateRecord(value);
      database.connection.prepare(`
        INSERT INTO space_conversation_links(
          operation_id, schema_version, operation, conversation_id, owner_kind,
          owner_id, space_id, reference_item_id, phase, last_error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          operation = excluded.operation,
          conversation_id = excluded.conversation_id,
          owner_kind = excluded.owner_kind,
          owner_id = excluded.owner_id,
          space_id = excluded.space_id,
          reference_item_id = excluded.reference_item_id,
          phase = excluded.phase,
          last_error_message = excluded.last_error_message,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        record.operationId,
        record.schemaVersion,
        record.operation,
        record.conversationId,
        record.operation === "birth" ? record.ownerKind : null,
        record.operation === "birth" ? record.ownerId : null,
        record.spaceId ?? null,
        record.referenceItemId ?? null,
        record.phase,
        record.lastErrorMessage ?? null,
        record.createdAt,
        record.updatedAt,
      );
    },

    async delete(operationId) {
      database.connection.prepare(
        "DELETE FROM space_conversation_links WHERE operation_id = ?",
      ).run(operationId);
    },
  };
}

export function newSpaceConversationBirthRecord(input: {
  readonly conversationId: string;
  readonly owner: { readonly kind: "space" | "workspace"; readonly id: string };
  readonly spaceId?: string;
  readonly referenceItemId?: string;
  readonly now: string;
  readonly operationId?: string;
}): SpaceConversationBirthRecord {
  return validateRecord({
    schemaVersion: SPACE_CONVERSATION_LINK_SCHEMA_VERSION,
    operation: "birth",
    operationId: input.operationId ?? randomUUID(),
    conversationId: input.conversationId,
    ownerKind: input.owner.kind,
    ownerId: input.owner.id,
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    ...(input.referenceItemId === undefined ? {} : { referenceItemId: input.referenceItemId }),
    phase: "prepared",
    createdAt: input.now,
    updatedAt: input.now,
  }) as SpaceConversationBirthRecord;
}

export function newSpaceConversationDeleteRecord(input: {
  readonly conversationId: string;
  readonly owner?: { readonly spaceId: string; readonly referenceItemId: string };
  readonly now: string;
  readonly operationId?: string;
}): SpaceConversationDeleteRecord {
  return validateRecord({
    schemaVersion: SPACE_CONVERSATION_LINK_SCHEMA_VERSION,
    operation: "delete",
    operationId: input.operationId ?? randomUUID(),
    conversationId: input.conversationId,
    ...(input.owner === undefined ? {} : {
      spaceId: input.owner.spaceId,
      referenceItemId: input.owner.referenceItemId,
    }),
    phase: "prepared",
    createdAt: input.now,
    updatedAt: input.now,
  }) as SpaceConversationDeleteRecord;
}

function recordFromRow(row: JournalRow): SpaceConversationLinkRecord {
  return validateRecord({
    schemaVersion: row.schemaVersion,
    operation: row.operation,
    operationId: row.operationId,
    conversationId: row.conversationId,
    ...(row.ownerKind === null ? {} : { ownerKind: row.ownerKind }),
    ...(row.ownerId === null ? {} : { ownerId: row.ownerId }),
    ...(row.spaceId === null ? {} : { spaceId: row.spaceId }),
    ...(row.referenceItemId === null ? {} : { referenceItemId: row.referenceItemId }),
    phase: row.phase,
    ...(row.lastErrorMessage === null ? {} : { lastErrorMessage: row.lastErrorMessage }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function validateRecord(value: unknown): SpaceConversationLinkRecord {
  const result = persistedRecordSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Space Conversation link journal is incompatible: ${z.prettifyError(result.error)}`);
  }
  const record = result.data;
  if (record.operation === "birth") {
    return {
      schemaVersion: SPACE_CONVERSATION_LINK_SCHEMA_VERSION,
      operation: "birth",
      operationId: record.operationId,
      conversationId: record.conversationId,
      ownerKind: record.ownerKind!,
      ownerId: record.ownerId!,
      ...(record.spaceId === undefined ? {} : { spaceId: record.spaceId }),
      ...(record.referenceItemId === undefined ? {} : { referenceItemId: record.referenceItemId }),
      phase: record.phase as SpaceConversationBirthPhase,
      ...(record.lastErrorMessage === undefined ? {} : { lastErrorMessage: record.lastErrorMessage }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  return {
    schemaVersion: SPACE_CONVERSATION_LINK_SCHEMA_VERSION,
    operation: "delete",
    operationId: record.operationId,
    conversationId: record.conversationId,
    ...(record.spaceId === undefined ? {} : { spaceId: record.spaceId }),
    ...(record.referenceItemId === undefined ? {} : { referenceItemId: record.referenceItemId }),
    phase: record.phase as SpaceConversationDeletePhase,
    ...(record.lastErrorMessage === undefined ? {} : { lastErrorMessage: record.lastErrorMessage }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}