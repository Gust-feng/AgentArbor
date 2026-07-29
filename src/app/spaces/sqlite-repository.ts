import type { SQLInputValue } from "node:sqlite";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type SpaceFolder,
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
    CREATE TABLE space_folders (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      parent_folder_id TEXT REFERENCES space_folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE space_references (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      parent_folder_id TEXT REFERENCES space_folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reference_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX space_folders_space_idx ON space_folders(space_id);
    CREATE INDEX space_references_space_idx ON space_references(space_id);
  `,
}, {
  version: 2,
  sql: `
    ALTER TABLE spaces ADD COLUMN demo_dataset TEXT CHECK(demo_dataset IN ('learning-workspace'));
  `,
}] as const;

export function createSqliteSpaceRepository(database: SqliteRuntimeDatabase): SpaceRepository {
  database.migrate("spaces", MIGRATIONS);
  return {
    async read(): Promise<SpaceTreeSnapshot> {
      try {
        const spaces = database.connection.prepare(
          "SELECT id, title, demo_dataset AS demoDataset, created_at AS createdAt, updated_at AS updatedAt FROM spaces ORDER BY created_at, id",
        ).all().map(optionalDemoDataset);
        const folders = database.connection.prepare(`
          SELECT id, space_id AS spaceId, parent_folder_id AS parentFolderId,
                 title, created_at AS createdAt, updated_at AS updatedAt
          FROM space_folders ORDER BY created_at, id
        `).all().map(optionalParent) as unknown as SpaceFolder[];
        const referenceItems = database.connection.prepare(`
          SELECT id, space_id AS spaceId, parent_folder_id AS parentFolderId,
                 title, reference_json AS referenceJson,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM space_references ORDER BY created_at, id
        `).all().map((row) => {
          const item = row as Record<string, SQLInputValue>;
          return optionalParent({
            id: item.id,
            spaceId: item.spaceId,
            parentFolderId: item.parentFolderId,
            title: item.title,
            reference: JSON.parse(String(item.referenceJson)) as unknown,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          });
        }) as unknown as SpaceReferenceItem[];
        return validateSpaceTreeSnapshot({ schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces, folders, referenceItems });
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
    database.connection.exec("DELETE FROM space_references; DELETE FROM space_folders; DELETE FROM spaces");
    const insertSpace = database.connection.prepare(
      "INSERT INTO spaces(id, title, demo_dataset, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const space of value.spaces) insertSpace.run(space.id, space.title, space.demoDataset ?? null, space.createdAt, space.updatedAt);
    const insertFolder = database.connection.prepare(`
      INSERT INTO space_folders(id, space_id, parent_folder_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const folder of orderFolders(value.folders)) {
      insertFolder.run(folder.id, folder.spaceId, folder.parentFolderId ?? null, folder.title, folder.createdAt, folder.updatedAt);
    }
    const insertReference = database.connection.prepare(`
      INSERT INTO space_references(id, space_id, parent_folder_id, title, reference_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of value.referenceItems) {
      insertReference.run(item.id, item.spaceId, item.parentFolderId ?? null, item.title, JSON.stringify(item.reference), item.createdAt, item.updatedAt);
    }
  });
}

function optionalParent<T extends { readonly parentFolderId?: unknown }>(row: T): Omit<T, "parentFolderId"> & { readonly parentFolderId?: string } {
  const { parentFolderId, ...rest } = row;
  return parentFolderId === null || parentFolderId === undefined
    ? rest
    : { ...rest, parentFolderId: String(parentFolderId) };
}

function optionalDemoDataset<T extends { readonly demoDataset?: unknown }>(row: T): Omit<T, "demoDataset"> & { readonly demoDataset?: "learning-workspace" } {
  const { demoDataset, ...rest } = row;
  return demoDataset === "learning-workspace" ? { ...rest, demoDataset } : rest;
}

function orderFolders(folders: readonly SpaceFolder[]): readonly SpaceFolder[] {
  const remaining = new Map(folders.map((folder) => [folder.id, folder]));
  const ordered: SpaceFolder[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((folder) => folder.parentFolderId === undefined || !remaining.has(folder.parentFolderId));
    if (ready.length === 0) return folders;
    for (const folder of ready) {
      ordered.push(folder);
      remaining.delete(folder.id);
    }
  }
  return ordered;
}
