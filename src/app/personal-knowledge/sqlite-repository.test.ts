import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { PersonalKnowledgeError } from "./contracts.js";
import { createPersonalKnowledgeFeature } from "./personal-knowledge-feature.js";
import { createSqlitePersonalKnowledgeRepository } from "./sqlite-repository.js";
import { makeTestDirectory, removeTestDirectory } from "../testing/fs-test-directories.js";

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

test("personal knowledge publishes committed note changes without letting observers fail commands", async (t) => {
  const { feature } = await fixture(t);
  const events: string[] = [];
  feature.events.subscribe((event) => events.push(event.type));
  feature.events.subscribe(() => { throw new Error("observer failed"); });

  const note = await feature.commands.createNote({ spaceId: "space-one" });
  await feature.commands.updateNote({ id: note.id, expectedRevision: 1, title: "更新" });
  await assert.rejects(
    feature.commands.updateNote({ id: note.id, expectedRevision: 1, title: "过期" }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "personal_note_revision_conflict",
  );
  await feature.commands.deleteNote({ id: note.id, expectedRevision: 2 });

  assert.deepEqual(events, [
    "personal_knowledge.note_created",
    "personal_knowledge.note_updated",
    "personal_knowledge.note_deleted",
  ]);
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
  assert.ok(managedPage);
  assert.equal(managedPage.kind, "space_reference");
  assert.match(managedPage.refId, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(managedPage.asset, {
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
  await assert.rejects(
    feature.commands.execute({
      type: "knowledge.collect",
      page: { refId: managedPage.refId, kind: "material", collectedAt: 3 },
    }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "personal_knowledge_invalid_input",
  );
  assert.equal((await feature.queries.snapshot()).pages[0]?.kind, "space_reference");
});

test("managed asset text updates return the lease-captured result and publish only after the write commits", async (t) => {
  const writes: Array<{
    readonly refId: string;
    readonly relativePath: string;
    readonly expectedFingerprint: string;
    readonly text: string;
  }> = [];
  let writeError: Error | undefined;
  const { feature } = await fixture(t, {
    writeManagedAssetText: async ({ page, relativePath, expectedFingerprint, text }) => {
      if (writeError !== undefined) throw writeError;
      writes.push({ refId: page.refId, relativePath, expectedFingerprint, text });
      return { committedText: text, fingerprint: `after:${expectedFingerprint}` };
    },
  });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  const events: Array<{ readonly type: string; readonly refIds?: readonly string[] }> = [];
  feature.events.subscribe((event) => events.push(event));

  const updated = await feature.commands.updateManagedAssetText({
    refId: page.refId,
    relativePath: "chapter.md",
    expectedFingerprint: " 1:10 ",
    text: "updated",
    actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1", toolCallId: "call-1" },
  });

  assert.equal(updated.page.refId, page.refId);
  assert.deepEqual(updated.writeResult, { committedText: "updated", fingerprint: "after: 1:10 " });
  assert.deepEqual(writes, [{
    refId: page.refId,
    relativePath: "chapter.md",
    expectedFingerprint: " 1:10 ",
    text: "updated",
  }]);
  assert.deepEqual(events, [{ type: "personal_knowledge.changed", refIds: [page.refId] }]);
  const records = await feature.queries.recentChanges();
  assert.equal(records.records.length, 1);
  assert.equal(records.records[0]?.type, "knowledge.asset_updated");
  assert.equal(records.records[0]?.refId, page.refId);
  assert.equal(records.records[0]?.relativePath, "chapter.md");
  assert.equal(records.records[0]?.beforeFingerprint, " 1:10 ");
  assert.equal(records.records[0]?.afterFingerprint, "after: 1:10 ");
  assert.deepEqual(records.records[0]?.actor, { kind: "agent", actorId: "ordinary", traceId: "trace-1", toolCallId: "call-1" });

  writeError = new Error("write failed");
  await assert.rejects(feature.commands.updateManagedAssetText({
    refId: page.refId,
    relativePath: "chapter.md",
    expectedFingerprint: "1:10",
    text: "not committed",
    actor: { kind: "agent" },
  }), writeError);
  await assert.rejects(feature.commands.updateManagedAssetText({
    refId: "missing",
    relativePath: "",
    expectedFingerprint: "1:10",
    text: "not committed",
  }), (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "knowledge_asset_not_found");
  assert.deepEqual(events, [{ type: "personal_knowledge.changed", refIds: [page.refId] }]);
  // 失败的写操作不产生伪变更记录。
  assert.equal((await feature.queries.recentChanges()).records.length, 1);
});

test("concurrent managed asset writes keep each command's lease-captured result", async (t) => {
  let releaseFirstWrite!: () => void;
  let firstWriteEntered!: () => void;
  const firstWriteStarted = new Promise<void>((resolve) => { firstWriteEntered = resolve; });
  const firstWriteRelease = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const { feature } = await fixture(t, {
    writeManagedAssetText: async ({ text }) => {
      if (text === "first") {
        firstWriteEntered();
        await firstWriteRelease;
      }
      return { committedText: text, fingerprint: `fingerprint:${text}` };
    },
  });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });

  const first = feature.commands.updateManagedAssetText({
    refId: page.refId,
    relativePath: "",
    expectedFingerprint: "before-first",
    text: "first",
  });
  await firstWriteStarted;
  const second = feature.commands.updateManagedAssetText({
    refId: page.refId,
    relativePath: "",
    expectedFingerprint: "after-first",
    text: "second",
  });
  releaseFirstWrite();

  assert.deepEqual((await first).writeResult, { committedText: "first", fingerprint: "fingerprint:first" });
  assert.deepEqual((await second).writeResult, { committedText: "second", fingerprint: "fingerprint:second" });
});

test("Space cleanup deletes Space-owned notes and detaches copied assets without deleting the knowledge page", async (t) => {
  const removedAssetIds: string[] = [];
  const { feature } = await fixture(t, {
    removeManagedAsset: async (itemId) => { removedAssetIds.push(itemId); },
  });
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "空间笔记", bodyMarkdown: "内容" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: note.id, kind: "note", collectedAt: 1 } });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  const events: Array<{ readonly type: string; readonly refIds?: readonly string[] }> = [];
  feature.events.subscribe((event) => events.push(event));

  await feature.commands.cleanupSpace({ spaceId: "space-one", referenceIds: ["reference-one"] });
  assert.deepEqual(events, [{ type: "personal_knowledge.changed", refIds: [page.refId, note.id] }]);

  const snapshot = await feature.queries.snapshot();
  assert.deepEqual(snapshot.notes, []);
  assert.equal(snapshot.pages.some((candidate) => candidate.refId === note.id), false);
  assert.deepEqual(snapshot.pages.find((candidate) => candidate.refId === page.refId)?.asset, {
    status: "managed",
    title: "参考资料",
    sourceLabel: "C:/source",
    contentKind: "directory",
  });
  assert.deepEqual(await feature.queries.noteRevisions(note.id), []);
  assert.deepEqual(removedAssetIds, []);
});
test("migrates existing material knowledge pages before adding Space references", async (t) => {
  const { database } = await fixture(t);
  database.connection.exec(`
    DROP TABLE personal_note_revisions;
    DROP TABLE knowledge_pages;
    DROP TABLE knowledge_change_records;
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
    DROP TABLE knowledge_change_records;
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

test("migration restores the managed knowledge asset kind", async (t) => {
  const { database } = await fixture(t);
  database.connection.exec("DROP TABLE knowledge_change_records;");
  database.connection.prepare(
    "INSERT INTO knowledge_pages(ref_id, kind, collected_at, asset_json) VALUES (?, 'material', 1, ?)",
  ).run("managed-copy", JSON.stringify({
    status: "managed",
    title: "副本",
    sourceLabel: "C:/source",
    contentKind: "file",
    sourceReferenceId: "reference-one",
    sourceRelativePath: "",
  }));
  database.connection.prepare("UPDATE schema_migrations SET version = ? WHERE owner = ?").run(7, "personal-knowledge");

  const migrated = createSqlitePersonalKnowledgeRepository(database);

  assert.equal((await migrated.readSnapshot()).pages[0]?.kind, "space_reference");
});

test("Agent theme creation derives origin from the actor and deduplicates normalized names", async (t) => {
  const { feature } = await fixture(t);
  const created = await feature.commands.createTheme({ name: " Transformer ", actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1" } });
  assert.equal(created.created, true);
  assert.equal(created.theme.origin, "agent");
  assert.match(created.theme.color, /^#[0-9a-f]{6}$/iu);
  assert.equal((await feature.queries.snapshot()).themes.length, 1);

  const duplicate = await feature.commands.createTheme({ name: "transformer", actor: { kind: "agent" } });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.theme.id, created.theme.id);
  assert.equal((await feature.queries.snapshot()).themes.length, 1);

  const userCreated = await feature.commands.createTheme({ name: "用户主题", actor: { kind: "user" } });
  assert.equal(userCreated.created, true);
  assert.equal(userCreated.theme.origin, "user");
  assert.notEqual(userCreated.theme.color, created.theme.color);

  const records = await feature.queries.recentChanges();
  assert.deepEqual(records.records.map((record) => record.type), ["knowledge.theme_created", "knowledge.theme_created"]);
  assert.deepEqual(records.records.map((record) => record.actor.kind), ["user", "agent"]);
  assert.equal(records.records[0]?.type === "knowledge.theme_created" && records.records[0]?.name, "用户主题");
});

test("theme assignments are atomic and idempotent; locked assignments resist Agent unassignment", async (t) => {
  const { feature } = await fixture(t);
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "归入主题" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: note.id, kind: "note", collectedAt: 1 } });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "material-one", kind: "material", collectedAt: 2 } });
  const { theme } = await feature.commands.createTheme({ name: "研究", actor: { kind: "user" } });

  const assigned = await feature.commands.assignTheme({
    themeId: theme.id,
    refIds: [note.id, page.refId, "material-one"],
    actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1" },
  });
  assert.deepEqual(assigned, { themeId: theme.id, assigned: [note.id, page.refId, "material-one"], unchanged: [] });

  const repeated = await feature.commands.assignTheme({
    themeId: theme.id,
    refIds: [note.id, page.refId],
    actor: { kind: "agent" },
  });
  assert.deepEqual(repeated, { themeId: theme.id, assigned: [], unchanged: [note.id, page.refId] });

  await assert.rejects(
    feature.commands.assignTheme({ themeId: theme.id, refIds: ["missing"], actor: { kind: "agent" } }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "personal_knowledge_invalid_input",
  );
  await assert.rejects(
    feature.commands.assignTheme({ themeId: "missing-theme", refIds: [note.id], actor: { kind: "agent" } }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "knowledge_theme_not_found",
  );
  assert.deepEqual((await feature.queries.snapshot()).assignments.length, 3);

  await feature.commands.execute({ type: "theme.toggle_lock", refId: page.refId, themeId: theme.id });
  const lockedUnassign = await feature.commands.unassignTheme({
    themeId: theme.id,
    refIds: [page.refId, note.id],
    actor: { kind: "agent", actorId: "ordinary", traceId: "trace-1" },
  });
  assert.deepEqual(lockedUnassign, { themeId: theme.id, unassigned: [note.id], locked: [page.refId] });
  const afterAgent = await feature.queries.snapshot();
  assert.equal(afterAgent.assignments.some((assignment) => assignment.refId === page.refId), true);
  assert.equal(afterAgent.assignments.some((assignment) => assignment.refId === note.id), false);

  const userUnassign = await feature.commands.unassignTheme({
    themeId: theme.id,
    refIds: [page.refId],
    actor: { kind: "user" },
  });
  assert.deepEqual(userUnassign, { themeId: theme.id, unassigned: [page.refId], locked: [] });

  const records = await feature.queries.recentChanges({ themeId: theme.id });
  assert.deepEqual(records.records.map((record) => record.type).sort(), [
    "knowledge.theme_assigned",
    "knowledge.theme_created",
    "knowledge.theme_unassigned",
    "knowledge.theme_unassigned",
  ]);
  const assignedRecord = records.records.find((record) => record.type === "knowledge.theme_assigned");
  assert.equal(assignedRecord?.type === "knowledge.theme_assigned" && assignedRecord.refIds.length, 3);
});

test("knowledge list filters by kind, space, theme and title with replayable cursors", async (t) => {
  const { feature } = await fixture(t, { spaceExists: async () => true });
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "反向传播", bodyMarkdown: "链式法则" });
  const otherNote = await feature.commands.createNote({ spaceId: "space-one", title: "线性代数" });
  const otherSpaceNote = await feature.commands.createNote({ spaceId: "space-two", title: "反向传播回顾" });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "legacy-material", kind: "material", collectedAt: 1 } });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: note.id, kind: "note", collectedAt: 10_000 } });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: otherNote.id, kind: "note", collectedAt: 20_000 } });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: otherSpaceNote.id, kind: "note", collectedAt: 30_000 } });
  const { theme } = await feature.commands.createTheme({ name: "深度学习", actor: { kind: "user" } });
  await feature.commands.assignTheme({ themeId: theme.id, refIds: [note.id, page.refId], actor: { kind: "user" } });

  const all = await feature.queries.list();
  assert.deepEqual(all.pages.map((candidate) => candidate.refId), [page.refId, otherSpaceNote.id, otherNote.id, note.id, "legacy-material"]);
  assert.equal(all.pages.find((candidate) => candidate.refId === note.id)?.title, "反向传播");
  assert.equal(all.pages.find((candidate) => candidate.refId === "legacy-material")?.title, undefined);

  const notes = await feature.queries.list({ kind: "note", spaceId: "space-one" });
  assert.deepEqual(notes.pages.map((candidate) => candidate.refId), [otherNote.id, note.id]);

  const themed = await feature.queries.list({ themeId: theme.id });
  assert.deepEqual(themed.pages.map((candidate) => candidate.refId), [page.refId, note.id]);

  const searched = await feature.queries.list({ query: "反向传播" });
  assert.deepEqual(searched.pages.map((candidate) => candidate.refId), [otherSpaceNote.id, note.id]);

  const firstPage = await feature.queries.list({ kind: "note", limit: 2 });
  assert.equal(firstPage.pages.length, 2);
  const secondPage = await feature.queries.list({ kind: "note", limit: 2, cursor: firstPage.nextInput?.cursor });
  assert.equal(secondPage.pages.length, 1);
  assert.deepEqual([...firstPage.pages.map((candidate) => candidate.refId), ...secondPage.pages.map((candidate) => candidate.refId)],
    [otherSpaceNote.id, otherNote.id, note.id]);
});

test("knowledge list includes uncollected personal notes with space filter and cursors", async (t) => {
  const { feature } = await fixture(t, { spaceExists: async () => true });
  const first = await feature.commands.createNote({ spaceId: "space-one", title: "未收藏笔记A", bodyMarkdown: "正文A" });
  const second = await feature.commands.createNote({ spaceId: "space-two", title: "未收藏笔记B" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "legacy-material", kind: "material", collectedAt: 1 } });

  const all = await feature.queries.list({ kind: "note" });
  assert.equal(all.pages.length, 2);
  assert.ok(all.pages.some((page) => page.refId === first.id && page.title === "未收藏笔记A" && page.spaceId === "space-one"));
  assert.ok(all.pages.some((page) => page.refId === second.id && page.title === "未收藏笔记B" && page.spaceId === "space-two"));

  const scoped = await feature.queries.list({ kind: "note", spaceId: "space-one" });
  assert.deepEqual(scoped.pages.map((page) => page.refId), [first.id]);
  assert.deepEqual((await feature.queries.list({ kind: "note", spaceId: "space-missing" })).pages, []);

  const firstPage = await feature.queries.list({ kind: "note", limit: 1 });
  assert.equal(firstPage.pages.length, 1);
  const secondPage = await feature.queries.list({ kind: "note", limit: 1, cursor: firstPage.nextInput?.cursor });
  assert.equal(secondPage.pages.length, 1);
  const refIds = [...firstPage.pages.map((page) => page.refId), ...secondPage.pages.map((page) => page.refId)];
  assert.deepEqual(new Set(refIds), new Set([first.id, second.id]));
});

test("change records persist append-only and support filtering and cursor pagination", async (t) => {
  const { database, feature } = await fixture(t);
  const { theme } = await feature.commands.createTheme({ name: "主题A", actor: { kind: "agent" } });
  const note = await feature.commands.createNote({ spaceId: "space-one", title: "笔记" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: note.id, kind: "note", collectedAt: 100 } });
  await feature.commands.assignTheme({ themeId: theme.id, refIds: [note.id], actor: { kind: "agent" } });
  await feature.commands.unassignTheme({ themeId: theme.id, refIds: [note.id], actor: { kind: "user" } });
  await feature.commands.uncollect(note.id, { kind: "user" });

  const byTheme = await feature.queries.recentChanges({ themeId: theme.id });
  assert.deepEqual(byTheme.records.map((record) => record.type).sort(), ["knowledge.theme_assigned", "knowledge.theme_created", "knowledge.theme_unassigned"]);

  const byRef = await feature.queries.recentChanges({ refId: note.id });
  assert.deepEqual(byRef.records.map((record) => record.type).sort(), ["knowledge.theme_assigned", "knowledge.theme_unassigned", "knowledge.uncollected"]);

  const all = await feature.queries.recentChanges({ limit: 2 });
  assert.equal(all.records.length, 2);
  assert.notEqual(all.nextCursor, undefined);
  const rest = await feature.queries.recentChanges({ limit: 2, cursor: all.nextCursor });
  assert.equal(rest.records.length, 2);
  const ids = [...all.records, ...rest.records].map((record) => record.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM knowledge_change_records").get()?.count, 4);
});

test("uncollect reports whether a managed knowledge copy was actually removed", async (t) => {
  const { feature } = await fixture(t, {
    stageManagedAssetRemoval: async (itemId) => itemId === "legacy-material"
      ? undefined
      : { commit: async () => undefined, rollback: async () => undefined },
  });
  const page = await feature.commands.collectSpaceReference({ referenceId: "reference-one" });
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "legacy-material", kind: "material", collectedAt: 2 } });
  assert.deepEqual(await feature.commands.uncollect(page.refId, { kind: "user" }), { managedCopyRemoved: true });
  assert.deepEqual(await feature.commands.uncollect("legacy-material", { kind: "user" }), { managedCopyRemoved: false });
  await assert.rejects(
    feature.commands.uncollect("missing", { kind: "user" }),
    (error: unknown) => error instanceof PersonalKnowledgeError && error.code === "knowledge_asset_not_found",
  );
  const records = await feature.queries.recentChanges();
  assert.deepEqual(records.records.map((record) => record.type), ["knowledge.uncollected", "knowledge.uncollected"]);
});

async function fixture(
  t: import("node:test").TestContext,
  options: {
    readonly removeManagedAsset?: (itemId: string) => Promise<void>;
    readonly writeManagedAssetText?: (input: {
      readonly page: import("./contracts.js").KnowledgePage;
      readonly relativePath: string;
      readonly expectedFingerprint: string;
      readonly text: string;
    }) => Promise<{ readonly fingerprint?: string } & Record<string, unknown>>;
    readonly spaceExists?: (spaceId: string) => Promise<boolean>;
    readonly stageManagedAssetRemoval?: (itemId: string) => Promise<{
      readonly commit: () => Promise<void>;
      readonly rollback: () => Promise<void>;
    } | undefined>;
  } = {},
) {
  const directory = await makeTestDirectory("agentarbor-personal-knowledge-");
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: options.spaceExists ?? (async (spaceId) => spaceId === "space-one"),
    captureSpaceReference: async () => ({ status: "managed", title: "参考资料", sourceLabel: "C:/source", contentKind: "directory", sourceReferenceId: "reference-one", sourceRelativePath: "" }),
    removeManagedAsset: options.removeManagedAsset ?? (async () => undefined),
    stageManagedAssetRemoval: options.stageManagedAssetRemoval,
    writeManagedAssetText: options.writeManagedAssetText,
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await removeTestDirectory(directory);
  });
  return { database, feature };
}
