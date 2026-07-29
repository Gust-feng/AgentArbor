import type { SQLInputValue } from "node:sqlite";

import type { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import {
  PersonalKnowledgeError,
  type LegacyPersonalKnowledgeImport,
  type PersonalKnowledgeCommand,
  type PersonalKnowledgeRepository,
  type PersonalKnowledgeSearchResult,
  type PersonalKnowledgeSnapshot,
  type PersonalNote,
} from "./contracts.js";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE personal_notes (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      material_refs_json TEXT NOT NULL,
      position INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX personal_notes_space_position_idx ON personal_notes(space_id, position, id);
    CREATE TABLE knowledge_pages (
      ref_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('note', 'material')),
      collected_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE knowledge_links (
      from_ref_id TEXT NOT NULL,
      to_ref_id TEXT NOT NULL,
      PRIMARY KEY(from_ref_id, to_ref_id),
      CHECK(from_ref_id <> to_ref_id)
    ) STRICT;
    CREATE TABLE knowledge_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('agent', 'user'))
    ) STRICT;
    CREATE TABLE knowledge_theme_assignments (
      ref_id TEXT NOT NULL,
      theme_id TEXT NOT NULL REFERENCES knowledge_themes(id) ON DELETE CASCADE,
      assigned_by TEXT NOT NULL CHECK(assigned_by IN ('agent', 'user')),
      locked INTEGER NOT NULL CHECK(locked IN (0, 1)),
      PRIMARY KEY(ref_id, theme_id)
    ) STRICT;
    CREATE TABLE knowledge_recently_opened (
      ref_id TEXT PRIMARY KEY,
      opened_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE knowledge_pages_v2 (
      ref_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('note', 'material', 'space_reference')),
      collected_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO knowledge_pages_v2(ref_id, kind, collected_at)
      SELECT ref_id, kind, collected_at FROM knowledge_pages;
    DROP TABLE knowledge_pages;
    ALTER TABLE knowledge_pages_v2 RENAME TO knowledge_pages;
  `,
}, {
  version: 3,
  sql: `
    CREATE VIRTUAL TABLE IF NOT EXISTS personal_notes_fts USING fts5(
      title,
      body_markdown,
      content='personal_notes',
      content_rowid='rowid',
      tokenize='unicode61'
    );
    INSERT INTO personal_notes_fts(personal_notes_fts) VALUES ('rebuild');
    CREATE TRIGGER IF NOT EXISTS personal_notes_fts_insert AFTER INSERT ON personal_notes BEGIN
      INSERT INTO personal_notes_fts(rowid, title, body_markdown)
      VALUES (new.rowid, new.title, new.body_markdown);
    END;
    CREATE TRIGGER IF NOT EXISTS personal_notes_fts_delete AFTER DELETE ON personal_notes BEGIN
      INSERT INTO personal_notes_fts(personal_notes_fts, rowid, title, body_markdown)
      VALUES ('delete', old.rowid, old.title, old.body_markdown);
    END;
    CREATE TRIGGER IF NOT EXISTS personal_notes_fts_update AFTER UPDATE OF title, body_markdown ON personal_notes BEGIN
      INSERT INTO personal_notes_fts(personal_notes_fts, rowid, title, body_markdown)
      VALUES ('delete', old.rowid, old.title, old.body_markdown);
      INSERT INTO personal_notes_fts(rowid, title, body_markdown)
      VALUES (new.rowid, new.title, new.body_markdown);
    END;
  `,
}] as const;

export function createSqlitePersonalKnowledgeRepository(database: SqliteRuntimeDatabase): PersonalKnowledgeRepository {
  database.migrate("personal-knowledge", MIGRATIONS);
  return {
    async readSnapshot(): Promise<PersonalKnowledgeSnapshot> {
      try {
        const notes = database.connection.prepare(`
          SELECT id, space_id AS spaceId, title, body_markdown AS bodyMarkdown,
                 material_refs_json AS materialRefsJson, revision,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM personal_notes ORDER BY position, id
        `).all().map((row) => {
          const value = row as Record<string, SQLInputValue>;
          return {
            id: String(value.id),
            spaceId: String(value.spaceId),
            title: String(value.title),
            bodyMarkdown: String(value.bodyMarkdown),
            materialRefs: parseStringArray(value.materialRefsJson),
            revision: Number(value.revision),
            createdAt: Number(value.createdAt),
            updatedAt: Number(value.updatedAt),
          };
        });
        const pages = database.connection.prepare(
          "SELECT ref_id AS refId, kind, collected_at AS collectedAt FROM knowledge_pages ORDER BY collected_at DESC, ref_id",
        ).all() as unknown as PersonalKnowledgeSnapshot["pages"];
        const links = database.connection.prepare(
          "SELECT from_ref_id AS 'from', to_ref_id AS 'to' FROM knowledge_links ORDER BY from_ref_id, to_ref_id",
        ).all() as unknown as PersonalKnowledgeSnapshot["links"];
        const themes = database.connection.prepare(
          "SELECT id, name, color, origin FROM knowledge_themes ORDER BY id",
        ).all() as unknown as PersonalKnowledgeSnapshot["themes"];
        const assignments = database.connection.prepare(`
          SELECT ref_id AS refId, theme_id AS themeId, assigned_by AS 'by', locked
          FROM knowledge_theme_assignments ORDER BY theme_id, ref_id
        `).all().map((row) => ({ ...row, locked: Boolean((row as Record<string, SQLInputValue>).locked) })) as unknown as PersonalKnowledgeSnapshot["assignments"];
        const recentlyOpened = Object.fromEntries(database.connection.prepare(
          "SELECT ref_id AS refId, opened_at AS openedAt FROM knowledge_recently_opened",
        ).all().map((row) => {
          const value = row as Record<string, SQLInputValue>;
          return [String(value.refId), Number(value.openedAt)];
        }));
        return { notes, pages, links, themes, assignments, recentlyOpened };
      } catch (error) {
        throw repositoryError("Could not read personal knowledge from SQLite.", error);
      }
    },
    async getNote(id: string): Promise<PersonalNote | undefined> {
      try {
        const row = database.connection.prepare(`
          SELECT id, space_id AS spaceId, title, body_markdown AS bodyMarkdown,
                 material_refs_json AS materialRefsJson, revision,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM personal_notes WHERE id = ?
        `).get(id);
        return row === undefined ? undefined : personalNoteFromRow(row as Record<string, SQLInputValue>);
      } catch (error) {
        throw repositoryError("Could not read the personal note from SQLite.", error);
      }
    },
    async searchNotes(input): Promise<readonly PersonalKnowledgeSearchResult[]> {
      try {
        const ftsRows = database.connection.prepare(`
          SELECT n.id, n.space_id AS spaceId, n.title,
                 n.material_refs_json AS materialRefsJson, n.revision,
                 n.created_at AS createdAt, n.updated_at AS updatedAt,
                 snippet(personal_notes_fts, 1, '', '', '...', 24) AS snippet
          FROM personal_notes_fts
          JOIN personal_notes n ON n.rowid = personal_notes_fts.rowid
          WHERE personal_notes_fts MATCH ?
            AND (? IS NULL OR n.space_id = ?)
          ORDER BY bm25(personal_notes_fts, 4.0, 1.0), n.updated_at DESC, n.id
          LIMIT ?
        `).all(ftsQuery(input.query), input.spaceId ?? null, input.spaceId ?? null, input.limit);
        const likeRows = database.connection.prepare(`
          SELECT id, space_id AS spaceId, title,
                 material_refs_json AS materialRefsJson, revision,
                 created_at AS createdAt, updated_at AS updatedAt,
                 substr(body_markdown, 1, 240) AS snippet
          FROM personal_notes
          WHERE (title LIKE ? ESCAPE '\\' OR body_markdown LIKE ? ESCAPE '\\')
            AND (? IS NULL OR space_id = ?)
          ORDER BY updated_at DESC, id
          LIMIT ?
        `).all(likePattern(input.query), likePattern(input.query), input.spaceId ?? null, input.spaceId ?? null, input.limit);
        const results = new Map<string, PersonalKnowledgeSearchResult>();
        for (const row of [...ftsRows, ...likeRows]) {
          const result = searchResultFromRow(row as Record<string, SQLInputValue>);
          if (!results.has(result.note.id)) results.set(result.note.id, result);
          if (results.size >= input.limit) break;
        }
        return [...results.values()];
      } catch (error) {
        throw repositoryError("Could not search personal knowledge in SQLite.", error);
      }
    },
    async execute(command: PersonalKnowledgeCommand): Promise<void> {
      try {
        executeCommand(database, command);
      } catch (error) {
        if (error instanceof PersonalKnowledgeError) throw error;
        throw repositoryError(`Could not execute ${command.type}.`, error);
      }
    },
    async importLegacy(input: LegacyPersonalKnowledgeImport): Promise<boolean> {
      try {
        return database.transaction(() => {
          if (database.hasCompatibilityImport(input.importKey)) return false;
          importLegacy(database, input);
          database.recordCompatibilityImport(input.importKey);
          return true;
        });
      } catch (error) {
        if (error instanceof PersonalKnowledgeError) throw error;
        throw repositoryError("Could not import legacy personal knowledge.", error);
      }
    },
  };
}

function executeCommand(database: SqliteRuntimeDatabase, command: PersonalKnowledgeCommand): void {
  switch (command.type) {
    case "note.create": {
      const position = Number((database.connection.prepare("SELECT COALESCE(MIN(position), 0) - 1 AS value FROM personal_notes").get() as { value: number }).value);
      database.connection.prepare(`
        INSERT INTO personal_notes(id, space_id, title, body_markdown, material_refs_json, position, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(command.note.id, command.note.spaceId, command.note.title, command.note.bodyMarkdown, JSON.stringify(command.note.materialRefs), position, command.note.revision, command.note.createdAt, command.note.updatedAt);
      return;
    }
    case "note.update": {
      const columns: string[] = [];
      const values: SQLInputValue[] = [];
      if (command.title !== undefined) { columns.push("title = ?"); values.push(command.title); }
      if (command.bodyMarkdown !== undefined) { columns.push("body_markdown = ?"); values.push(command.bodyMarkdown); }
      if (columns.length === 0) return;
      columns.push("updated_at = ?", "revision = revision + 1");
      values.push(command.updatedAt, command.id, command.expectedRevision);
      const result = database.connection.prepare(
        `UPDATE personal_notes SET ${columns.join(", ")} WHERE id = ? AND revision = ?`,
      ).run(...values);
      if (Number(result.changes) === 0) throw noteWriteError(database, command.id);
      return;
    }
    case "note.delete": {
      database.transaction(() => {
        const result = database.connection.prepare("DELETE FROM personal_notes WHERE id = ? AND revision = ?").run(command.id, command.expectedRevision);
        if (Number(result.changes) === 0) throw noteWriteError(database, command.id);
        removeKnowledgeReference(database, command.id);
      });
      return;
    }
    case "note.reorder": {
      database.transaction(() => {
        const update = database.connection.prepare("UPDATE personal_notes SET position = ? WHERE id = ?");
        const existing = database.connection.prepare("SELECT id FROM personal_notes ORDER BY position, id").all()
          .map((row) => String((row as Record<string, SQLInputValue>).id));
        const existingSet = new Set(existing);
        const seen = new Set<string>();
        const ordered = command.orderedIds.filter((id) => existingSet.has(id) && !seen.has(id) && seen.add(id));
        ordered.push(...existing.filter((id) => !seen.has(id)));
        ordered.forEach((id, index) => update.run(index, id));
      });
      return;
    }
    case "knowledge.collect":
      if (command.page.kind === "note" && database.connection.prepare("SELECT 1 FROM personal_notes WHERE id = ?").get(command.page.refId) === undefined) {
        throw new PersonalKnowledgeError("personal_note_not_found", `Note ${command.page.refId} was not found.`);
      }
      database.connection.prepare("INSERT OR IGNORE INTO knowledge_pages(ref_id, kind, collected_at) VALUES (?, ?, ?)")
        .run(command.page.refId, command.page.kind, command.page.collectedAt);
      return;
    case "knowledge.uncollect":
      database.transaction(() => removeKnowledgeReference(database, command.refId));
      return;
    case "knowledge.link_add":
      requireKnowledgePages(database, command.link.from, command.link.to);
      database.connection.prepare("INSERT OR IGNORE INTO knowledge_links(from_ref_id, to_ref_id) VALUES (?, ?)")
        .run(command.link.from, command.link.to);
      return;
    case "knowledge.link_remove":
      database.connection.prepare("DELETE FROM knowledge_links WHERE from_ref_id = ? AND to_ref_id = ?")
        .run(command.link.from, command.link.to);
      return;
    case "knowledge.opened":
      requireKnowledgePages(database, command.refId);
      database.connection.prepare(`
        INSERT INTO knowledge_recently_opened(ref_id, opened_at) VALUES (?, ?)
        ON CONFLICT(ref_id) DO UPDATE SET opened_at = excluded.opened_at
      `).run(command.refId, command.openedAt);
      return;
    case "theme.create":
      database.connection.prepare("INSERT INTO knowledge_themes(id, name, color, origin) VALUES (?, ?, ?, ?)")
        .run(command.theme.id, command.theme.name, command.theme.color, command.theme.origin);
      return;
    case "theme.rename": {
      const result = database.connection.prepare("UPDATE knowledge_themes SET name = ? WHERE id = ?").run(command.name, command.themeId);
      if (Number(result.changes) === 0) throw new PersonalKnowledgeError("knowledge_theme_not_found", `Theme ${command.themeId} was not found.`);
      return;
    }
    case "theme.delete":
      database.connection.prepare("DELETE FROM knowledge_themes WHERE id = ?").run(command.themeId);
      return;
    case "theme.merge":
      database.transaction(() => {
        const found = database.connection.prepare("SELECT 1 FROM knowledge_themes WHERE id = ?").get(command.toId);
        if (found === undefined) throw new PersonalKnowledgeError("knowledge_theme_not_found", `Theme ${command.toId} was not found.`);
        database.connection.prepare(`
          INSERT INTO knowledge_theme_assignments(ref_id, theme_id, assigned_by, locked)
          SELECT ref_id, ?, assigned_by, locked FROM knowledge_theme_assignments WHERE theme_id = ?
          ON CONFLICT(ref_id, theme_id) DO UPDATE SET
            locked = MAX(knowledge_theme_assignments.locked, excluded.locked),
            assigned_by = CASE WHEN excluded.assigned_by = 'user' THEN 'user' ELSE knowledge_theme_assignments.assigned_by END
        `).run(command.toId, command.fromId);
        database.connection.prepare("DELETE FROM knowledge_themes WHERE id = ?").run(command.fromId);
      });
      return;
    case "theme.assign":
      requireKnowledgePages(database, command.assignment.refId);
      database.connection.prepare(`
        INSERT OR IGNORE INTO knowledge_theme_assignments(ref_id, theme_id, assigned_by, locked)
        VALUES (?, ?, ?, ?)
      `).run(command.assignment.refId, command.assignment.themeId, command.assignment.by, command.assignment.locked ? 1 : 0);
      return;
    case "theme.unassign":
      database.connection.prepare("DELETE FROM knowledge_theme_assignments WHERE ref_id = ? AND theme_id = ?")
        .run(command.refId, command.themeId);
      return;
    case "theme.toggle_lock":
      database.connection.prepare("UPDATE knowledge_theme_assignments SET locked = CASE locked WHEN 1 THEN 0 ELSE 1 END WHERE ref_id = ? AND theme_id = ?")
        .run(command.refId, command.themeId);
      return;
  }
}

function importLegacy(database: SqliteRuntimeDatabase, input: LegacyPersonalKnowledgeImport): void {
  const insertNote = database.connection.prepare(`
    INSERT OR IGNORE INTO personal_notes(id, space_id, title, body_markdown, material_refs_json, position, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  input.notes.forEach((note, position) => insertNote.run(note.id, input.fallbackSpaceId, note.title, note.body, JSON.stringify(note.materialRefs ?? []), position, note.createdAt, note.updatedAt));
  const insertPage = database.connection.prepare("INSERT OR IGNORE INTO knowledge_pages(ref_id, kind, collected_at) VALUES (?, ?, ?)");
  for (const page of input.pages) insertPage.run(page.refId, page.kind, page.collectedAt);
  const insertLink = database.connection.prepare("INSERT OR IGNORE INTO knowledge_links(from_ref_id, to_ref_id) VALUES (?, ?)");
  for (const link of input.links) if (link.from !== link.to) insertLink.run(link.from, link.to);
  const insertTheme = database.connection.prepare("INSERT OR IGNORE INTO knowledge_themes(id, name, color, origin) VALUES (?, ?, ?, ?)");
  for (const theme of input.themes) insertTheme.run(theme.id, theme.name, theme.color, theme.origin);
  const insertAssignment = database.connection.prepare(`
    INSERT OR IGNORE INTO knowledge_theme_assignments(ref_id, theme_id, assigned_by, locked) VALUES (?, ?, ?, ?)
  `);
  for (const assignment of input.assignments) insertAssignment.run(assignment.refId, assignment.themeId, assignment.by, assignment.locked ? 1 : 0);
  const insertOpened = database.connection.prepare("INSERT OR REPLACE INTO knowledge_recently_opened(ref_id, opened_at) VALUES (?, ?)");
  for (const [refId, openedAt] of Object.entries(input.recentlyOpened)) insertOpened.run(refId, openedAt);
}

function removeKnowledgeReference(database: SqliteRuntimeDatabase, refId: string): void {
  database.connection.prepare("DELETE FROM knowledge_pages WHERE ref_id = ?").run(refId);
  database.connection.prepare("DELETE FROM knowledge_links WHERE from_ref_id = ? OR to_ref_id = ?").run(refId, refId);
  database.connection.prepare("DELETE FROM knowledge_theme_assignments WHERE ref_id = ?").run(refId);
  database.connection.prepare("DELETE FROM knowledge_recently_opened WHERE ref_id = ?").run(refId);
}

function requireKnowledgePages(database: SqliteRuntimeDatabase, ...refIds: readonly string[]): void {
  const lookup = database.connection.prepare("SELECT 1 FROM knowledge_pages WHERE ref_id = ?");
  for (const refId of refIds) {
    if (lookup.get(refId) === undefined) {
      throw new PersonalKnowledgeError("personal_knowledge_invalid_input", `Knowledge page ${refId} was not found.`);
    }
  }
}

function noteWriteError(database: SqliteRuntimeDatabase, id: string): PersonalKnowledgeError {
  const exists = database.connection.prepare("SELECT 1 FROM personal_notes WHERE id = ?").get(id) !== undefined;
  return exists
    ? new PersonalKnowledgeError("personal_note_revision_conflict", `Note ${id} has changed since it was read.`)
    : new PersonalKnowledgeError("personal_note_not_found", `Note ${id} was not found.`);
}

function parseStringArray(value: SQLInputValue): readonly string[] {
  const parsed = JSON.parse(String(value)) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("material_refs_json is invalid");
  }
  return parsed;
}

function personalNoteFromRow(value: Record<string, SQLInputValue>): PersonalNote {
  return {
    id: String(value.id),
    spaceId: String(value.spaceId),
    title: String(value.title),
    bodyMarkdown: String(value.bodyMarkdown),
    materialRefs: parseStringArray(value.materialRefsJson),
    revision: Number(value.revision),
    createdAt: Number(value.createdAt),
    updatedAt: Number(value.updatedAt),
  };
}

function searchResultFromRow(value: Record<string, SQLInputValue>): PersonalKnowledgeSearchResult {
  return {
    note: {
      id: String(value.id),
      spaceId: String(value.spaceId),
      title: String(value.title),
      materialRefs: parseStringArray(value.materialRefsJson),
      revision: Number(value.revision),
      createdAt: Number(value.createdAt),
      updatedAt: Number(value.updatedAt),
    },
    snippet: String(value.snippet),
  };
}

function ftsQuery(query: string): string {
  return query.trim().split(/\s+/u)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

function likePattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function repositoryError(message: string, cause: unknown): PersonalKnowledgeError {
  return new PersonalKnowledgeError("personal_knowledge_repository_failure", message, { cause });
}
