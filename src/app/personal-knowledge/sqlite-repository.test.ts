import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { PersonalKnowledgeError } from "./contracts.js";
import { createPersonalKnowledgeFeature } from "./personal-knowledge-feature.js";
import { createSqlitePersonalKnowledgeRepository } from "./sqlite-repository.js";

test("personal knowledge persists Markdown notes and rejects stale revisions", async (t) => {
  const { database, feature } = await fixture(t);
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "标题", bodyMarkdown: "# 正文", actor: { kind: "user" } });
  await feature.commands.updateNote({
    id: note.id,
    expectedRevision: 1,
    bodyMarkdown: "# 新正文",
    actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1", goalId: "goal-1", toolCallId: "call-1" },
  });

  const saved = (await feature.queries.snapshot()).notes[0];
  assert.equal(saved?.bodyMarkdown, "# 新正文");
  assert.equal(saved?.revision, 2);
  assert.deepEqual((await feature.queries.noteRevisions(note.id)).map((revision) => ({
    revision: revision.revision,
    baseRevision: revision.baseRevision,
    operation: revision.operation,
    actor: revision.actor,
    bodyMarkdown: revision.bodyMarkdown,
  })), [{
    revision: 2,
    baseRevision: 1,
    operation: "update",
    actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1", goalId: "goal-1", toolCallId: "call-1" },
    bodyMarkdown: "# 新正文",
  }, {
    revision: 1,
    baseRevision: undefined,
    operation: "create",
    actor: { kind: "user" },
    bodyMarkdown: "# 正文",
  }]);
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
  const revisions = await feature.queries.noteRevisions(note.id);
  assert.equal(revisions[0]?.operation, "delete");
  assert.equal(revisions[0]?.revision, 2);
  assert.equal(revisions[0]?.bodyMarkdown, "");
});

test("persists only existing Space references as knowledge pages", async (t) => {
  const { feature } = await fixture(t);
  await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  const [managedPage] = (await feature.queries.snapshot()).pages;
  assert.equal(managedPage?.kind, "space_reference");
  assert.match(managedPage?.refId ?? "", /^[0-9a-f-]{36}$/u);
  assert.deepEqual(managedPage?.asset, {
    status: "managed",
    title: "参考资料",
    sourceLabel: "C:/source",
    contentKind: "directory",
    sourceReferenceId: "reference-one",
    sourceRelativePath: "",
  });
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
    DROP TABLE personal_note_revisions;
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

test("migration removes relationships whose knowledge pages no longer exist", async (t) => {
  const { database } = await fixture(t);
  database.connection.exec(`
    INSERT INTO knowledge_pages(ref_id, kind, collected_at, asset_json) VALUES ('alive', 'material', 1, NULL);
    INSERT INTO knowledge_links(from_ref_id, to_ref_id) VALUES ('alive', 'missing');
    INSERT INTO knowledge_themes(id, name, color, origin) VALUES ('theme-one', '主题', '#000000', 'user');
    INSERT INTO knowledge_theme_assignments(ref_id, theme_id, assigned_by, locked) VALUES ('missing', 'theme-one', 'user', 0);
    INSERT INTO knowledge_recently_opened(ref_id, opened_at) VALUES ('missing', 1);
  `);
  database.connection.prepare("UPDATE schema_migrations SET version = ? WHERE owner = ?").run(6, "personal-knowledge");

  createSqlitePersonalKnowledgeRepository(database);

  assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM knowledge_links").get()?.count, 0);
  assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM knowledge_theme_assignments").get()?.count, 0);
  assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM knowledge_recently_opened").get()?.count, 0);
});

async function fixture(t: import("node:test").TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-personal-knowledge-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
    spaceReferenceExists: async (itemId) => itemId === "reference-one",
    captureSpaceReference: async () => ({ status: "managed", title: "参考资料", sourceLabel: "C:/source", contentKind: "directory", sourceReferenceId: "reference-one", sourceRelativePath: "" }),
    removeManagedAsset: async () => undefined,
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { database, feature };
}
