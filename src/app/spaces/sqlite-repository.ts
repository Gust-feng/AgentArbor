import type { SQLInputValue } from "node:sqlite";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceTreeSnapshot,
} from "./contracts.js";
import { validateSpaceTreeSnapshot } from "./file-system-repository.js";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE space_references (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reference_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX space_references_space_idx ON space_references(space_id);
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE spaces ADD COLUMN demo_dataset TEXT CHECK(demo_dataset IN ('learning-workspace'));
  `,
}, {
  version: 3,
  sql: `ALTER TABLE space_references ADD COLUMN parent_id TEXT REFERENCES space_references(id) ON DELETE CASCADE;`,
}, {
  version: 4,
  sql: `
    ALTER TABLE space_references ADD COLUMN status TEXT CHECK(status IN ('available', 'unavailable'));
    ALTER TABLE space_references ADD COLUMN unavailable_at TEXT;
  `,
}] as const;

export function createSqliteSpaceRepository(database: SqliteRuntimeDatabase): SpaceRepository {
  database.migrate("spaces", MIGRATIONS);
  return {
    async read(): Promise<SpaceTreeSnapshot> {
      try {
        const spaces = database.connection.prepare(
          "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM spaces ORDER BY created_at, id",
        ).all();
        const referenceItems = database.connection.prepare(`
          SELECT id, space_id AS spaceId, title, parent_id AS parentId, reference_json AS referenceJson,
                 status, unavailable_at AS unavailableAt,
                 created_at AS createdAt, updated_at AS updatedAt
           FROM space_references ORDER BY rowid
        `).all().map((row) => {
          const item = row as Record<string, SQLInputValue>;
          return {
            id: item.id,
            spaceId: item.spaceId,
            title: item.title,
            ...(item.parentId === null ? {} : { parentId: item.parentId }),
            reference: JSON.parse(String(item.referenceJson)) as unknown,
            ...(item.status === null ? {} : { status: item.status }),
            ...(item.unavailableAt === null ? {} : { unavailableAt: item.unavailableAt }),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          };
        }) as unknown as SpaceReferenceItem[];
        return validateSpaceTreeSnapshot({ schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces, referenceItems });
      } catch (error) {
        if (error instanceof SpaceFeatureError) throw error;
        throw new SpaceFeatureError("space_repository_failure", "Could not read SpaceTree from SQLite.", { cause: error });
      }
    },
    async write(snapshot: SpaceTreeSnapshot): Promise<void> {
      const value = validateSpaceTreeSnapshot(snapshot);
      try {
        writeSnapshot(database, value);
      } catch (error) {
        throw new SpaceFeatureError("space_repository_failure", "Could not persist SpaceTree to SQLite.", { cause: error });
      }
    },
  };
}

function writeSnapshot(database: SqliteRuntimeDatabase, value: SpaceTreeSnapshot): void {
  database.transaction(() => {
    database.connection.exec("PRAGMA defer_foreign_keys = ON; DELETE FROM space_references; DELETE FROM spaces");
    const insertSpace = database.connection.prepare(
      "INSERT INTO spaces(id, title, demo_dataset, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
    );
    for (const space of value.spaces) insertSpace.run(space.id, space.title, space.createdAt, space.updatedAt);
    const insertReference = database.connection.prepare(`
      INSERT INTO space_references(id, space_id, title, parent_id, reference_json, status, unavailable_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of value.referenceItems) {
      insertReference.run(
        item.id,
        item.spaceId,
        item.title,
        item.parentId ?? null,
        JSON.stringify(item.reference),
        item.status ?? null,
        item.unavailableAt ?? null,
        item.createdAt,
        item.updatedAt,
      );
    }
  });
}
