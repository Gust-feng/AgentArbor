import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { PersonalKnowledgeError, type LegacyPersonalKnowledgeImport } from "./contracts.js";
import { createPersonalKnowledgeFeature } from "./personal-knowledge-feature.js";
import { createSqlitePersonalKnowledgeRepository } from "./sqlite-repository.js";

test("personal knowledge persists Markdown notes and rejects stale revisions", async (t) => {
  const { database, feature } = await fixture(t);
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "标题", bodyMarkdown: "# 正文" });
  await feature.commands.updateNote({ id: note.id, expectedRevision: 1, bodyMarkdown: "# 新正文" });

  const saved = (await feature.queries.snapshot()).notes[0];
  assert.equal(saved?.bodyMarkdown, "# 新正文");
  assert.equal(saved?.revision, 2);
  await assert.rejects(
    feature.commands.updateNote({ id: note.id, expectedRevision: 1, title: "过期写入" }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "personal_note_revision_conflict",
  );
  assert.equal(database.connection.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
});

test("personal knowledge search follows note create, update and delete", async (t) => {
  const { feature } = await fixture(t);
  const note = await feature.commands.createNote({
    spaceId: "space-one",
    title: "反向传播笔记",
    bodyMarkdown: "梯度沿计算图传播",
  });

  assert.deepEqual((await feature.queries.search({ query: "反向传播" })).map((result) => result.note.id), [note.id]);
  await feature.commands.updateNote({ id: note.id, expectedRevision: 1, bodyMarkdown: "核心是链式法则" });
  assert.deepEqual((await feature.queries.search({ query: "链式法则" })).map((result) => result.note.id), [note.id]);
  assert.equal((await feature.queries.note(note.id))?.revision, 2);

  await feature.commands.deleteNote({ id: note.id, expectedRevision: 2 });
  assert.deepEqual(await feature.queries.search({ query: "链式法则" }), []);
  assert.deepEqual(await feature.queries.search({ query: "\"" }), []);
  assert.deepEqual(await feature.queries.search({ query: "%" }), []);
  assert.equal(await feature.queries.note(note.id), undefined);
});

test("deleting a note removes its knowledge relations in one transaction", async (t) => {
  const { feature } = await fixture(t);
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "待删除" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: note.id, kind: "note", collectedAt: 1 } });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "material-one", kind: "material", collectedAt: 1 } });
  await feature.commands.execute({ type: "knowledge.link_add", link: { from: note.id, to: "material-one" } });
  await feature.commands.execute({ type: "theme.create", theme: { id: "theme-one", name: "主题", color: "#000", origin: "user" } });
  await feature.commands.execute({ type: "theme.assign", assignment: { refId: note.id, themeId: "theme-one", by: "user", locked: true } });
  await feature.commands.deleteNote({ id: note.id, expectedRevision: 1 });

  const snapshot = await feature.queries.snapshot();
  assert.equal(snapshot.notes.length, 0);
  assert.deepEqual(snapshot.pages.map((page) => page.refId), ["material-one"]);
  assert.equal(snapshot.links.length, 0);
  assert.equal(snapshot.assignments.length, 0);
  assert.equal(snapshot.themes.length, 1);
});

test("legacy import is idempotent and records the compatibility boundary", async (t) => {
  const { feature } = await fixture(t);
  const input: LegacyPersonalKnowledgeImport = {
    importKey: "redesign-local-storage-v1",
    fallbackSpaceId: "space-one",
    notes: [{ id: "legacy-note", title: "旧笔记", body: "正文", createdAt: 1, updatedAt: 2 }],
    pages: [{ refId: "legacy-note", kind: "note", collectedAt: 3 }],
    links: [],
    themes: [],
    assignments: [],
    recentlyOpened: { "legacy-note": 4 },
  };
  assert.equal(await feature.commands.importLegacy(input), true);
  assert.equal(await feature.commands.importLegacy({ ...input, notes: [] }), false);
  assert.equal((await feature.queries.snapshot()).notes.length, 1);
});

test("persists only existing Space references as knowledge pages", async (t) => {
  const { feature } = await fixture(t);
  await feature.commands.execute({
    type: "knowledge.collect",
    page: { refId: "reference-one", kind: "space_reference", collectedAt: 1 },
  });
  assert.deepEqual((await feature.queries.snapshot()).pages.map((page) => ({ ...page })), [{
    refId: "reference-one",
    kind: "space_reference",
    collectedAt: 1,
  }]);
  await assert.rejects(
    feature.commands.execute({
      type: "knowledge.collect",
      page: { refId: "missing-reference", kind: "space_reference", collectedAt: 2 },
    }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "personal_knowledge_invalid_input",
  );
});

test("migrates existing material knowledge pages before adding Space references", async (t) => {
  const { database } = await fixture(t);
  database.connection.exec(`
    DROP TABLE knowledge_pages;
    CREATE TABLE knowledge_pages (
      ref_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('note', 'material')),
      collected_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO knowledge_pages(ref_id, kind, collected_at) VALUES ('legacy-material', 'material', 1);
  `);
  database.connection.prepare("UPDATE schema_migrations SET version = ? WHERE owner = ?")
    .run(1, "personal-knowledge");

  const migrated = createSqlitePersonalKnowledgeRepository(database);
  assert.deepEqual((await migrated.readSnapshot()).pages.map((page) => ({ ...page })), [{
    refId: "legacy-material",
    kind: "material",
    collectedAt: 1,
  }]);
  await migrated.execute({
    type: "knowledge.collect",
    page: { refId: "new-reference", kind: "space_reference", collectedAt: 2 },
  });
  assert.deepEqual((await migrated.readSnapshot()).pages.map((page) => page.kind), ["space_reference", "material"]);
});

async function fixture(t: import("node:test").TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-personal-knowledge-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
    spaceReferenceExists: async (itemId) => itemId === "reference-one",
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { database, feature };
}
