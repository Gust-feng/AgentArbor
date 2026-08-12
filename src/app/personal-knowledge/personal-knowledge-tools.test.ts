import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { createPersonalKnowledgeFeature } from "./personal-knowledge-feature.js";
import { createPersonalKnowledgeTools } from "./personal-knowledge-tools.js";
import { createSqlitePersonalKnowledgeRepository } from "./sqlite-repository.js";

test("Knowledge list, page read, asset text update, uncollect and theme tools operate through the feature", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-tools-loop-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
    captureSpaceReference: async ({ relativePath }) => ({
      status: "managed",
      title: "参考资料",
      sourceLabel: "C:/source",
      contentKind: "directory",
      sourceReferenceId: "reference-one",
      sourceRelativePath: relativePath,
    }),
    writeManagedAssetText: async ({ expectedFingerprint }) => ({ fingerprint: `after:${expectedFingerprint}` }),
    readManagedKnowledgeAsset: async ({ page, relativePath, maxLength }) => {
      if (page.refId === "missing-asset") return { status: "missing", relativePath, message: "托管内容已不存在。" };
      return {
        status: "text",
        relativePath,
        text: "托管正文内容",
        truncated: false,
        fingerprint: "1:100",
        byteLength: 100,
      };
    },
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tools = new Map(createPersonalKnowledgeTools({ knowledge: feature }).map((tool) => [tool.definition.name, tool]));

  const note = await execute(tools.get("KnowledgeCreateNote")!, {
    spaceId: "space-one",
    title: "反向传播",
    bodyMarkdown: "核心是链式法则",
  }) as { readonly note: { readonly id: string; readonly revision: number } };
  await execute(tools.get("KnowledgeCollect")!, { refId: note.note.id, kind: "note" });
  const collected = await execute(tools.get("KnowledgeCollect")!, { refId: "reference-one", kind: "space_reference" }) as { readonly page: { readonly refId: string } };
  await feature.commands.execute({ type: "knowledge.collect", page: { refId: "legacy-material", kind: "material", collectedAt: 1 } });

  const listed = await execute(tools.get("KnowledgeList")!, { kind: "note", limit: 10 }) as {
    readonly status: string;
    readonly pages: readonly { readonly refId: string; readonly kind: string }[];
    readonly themes: readonly unknown[];
    readonly assignments: readonly unknown[];
  };
  assert.equal(listed.status, "found");
  assert.deepEqual(listed.pages.map((page) => page.refId), [note.note.id]);
  assert.deepEqual(listed.themes, []);
  assert.deepEqual(listed.assignments, []);

  const listedReference = await execute(tools.get("KnowledgeList")!, { kind: "space_reference" }) as {
    readonly status: string;
    readonly pages: readonly { readonly refId: string; readonly title?: string }[];
  };
  assert.equal(listedReference.pages[0]?.refId, collected.page.refId);
  assert.equal(listedReference.pages[0]?.title, "参考资料");

  const readNote = await execute(tools.get("KnowledgeReadPage")!, { refId: note.note.id, maxLength: 4 }) as {
    readonly status: string;
    readonly bodyMarkdown: string;
    readonly truncated: boolean;
    readonly continuation?: string;
  };
  assert.equal(readNote.status, "note");
  assert.equal(readNote.bodyMarkdown, "核心是链式法则".slice(0, 4));
  assert.equal(readNote.truncated, true);
  const continuedNote = await execute(tools.get("KnowledgeReadPage")!, { refId: note.note.id, maxLength: 100, continuation: readNote.continuation }) as {
    readonly bodyMarkdown: string;
    readonly truncated: boolean;
  };
  assert.equal(continuedNote.bodyMarkdown, "核心是链式法则".slice(4));
  assert.equal(continuedNote.truncated, false);

  const readAsset = await execute(tools.get("KnowledgeReadPage")!, { refId: collected.page.refId }) as {
    readonly status: string;
    readonly content: { readonly status: string; readonly text: string };
  };
  assert.equal(readAsset.status, "space_reference");
  assert.equal(readAsset.content.status, "text");
  assert.equal(readAsset.content.text, "托管正文内容");

  const readMissing = await execute(tools.get("KnowledgeReadPage")!, { refId: "missing" }) as { readonly status: string };
  assert.equal(readMissing.status, "missing");

  const updatedAsset = await execute(tools.get("KnowledgeUpdateAssetText")!, {
    refId: collected.page.refId,
    expectedFingerprint: "1:100",
    text: "新正文",
  }) as { readonly status: string; readonly fingerprint: string | null };
  assert.equal(updatedAsset.status, "updated");
  assert.equal(updatedAsset.fingerprint, "after:1:100");

  const uncollect = tools.get("KnowledgeUncollect")!;
  assert.equal(uncollect.definition.metadata?.requiresConfirmation, true);
  assert.equal(uncollect.definition.metadata?.fileOperation, "delete");
  assert.equal(tools.get("KnowledgeUpdateAssetText")!.definition.metadata?.requiresConfirmation, false);
  assert.deepEqual(await execute(uncollect, { refId: "missing" }), {
    status: "knowledge_asset_not_found",
    message: "知识条目已不存在。",
  });
  assert.deepEqual(await execute(uncollect, { refId: collected.page.refId }), {
    status: "uncollected",
    refId: collected.page.refId,
    managedCopyRemoved: false,
  });
  assert.equal((await feature.queries.snapshot()).pages.some((page) => page.refId === collected.page.refId), false);

  const createdTheme = await execute(tools.get("KnowledgeCreateTheme")!, { name: "Transformer" }) as {
    readonly status: string;
    readonly theme: { readonly id: string; readonly origin: string };
  };
  assert.equal(createdTheme.status, "created");
  assert.equal(createdTheme.theme.origin, "agent");
  const duplicateTheme = await execute(tools.get("KnowledgeCreateTheme")!, { name: " transformer " }) as {
    readonly status: string;
    readonly theme: { readonly id: string };
  };
  assert.equal(duplicateTheme.status, "exists");
  assert.equal(duplicateTheme.theme.id, createdTheme.theme.id);

  const assigned = await execute(tools.get("KnowledgeAssignTheme")!, {
    themeId: createdTheme.theme.id,
    refIds: [note.note.id, "legacy-material"],
  }) as { readonly status: string; readonly assigned: readonly string[]; readonly unchanged: readonly string[] };
  assert.deepEqual(assigned, { status: "assigned", themeId: createdTheme.theme.id, assigned: [note.note.id, "legacy-material"], unchanged: [] });
  const repeated = await execute(tools.get("KnowledgeAssignTheme")!, {
    themeId: createdTheme.theme.id,
    refIds: [note.note.id],
  }) as { readonly status: string; readonly assigned: readonly string[]; readonly unchanged: readonly string[] };
  assert.deepEqual(repeated.assigned, []);
  assert.deepEqual(repeated.unchanged, [note.note.id]);
  const invalidAssign = await execute(tools.get("KnowledgeAssignTheme")!, {
    themeId: createdTheme.theme.id,
    refIds: ["missing"],
  }) as { readonly status: string };
  assert.equal(invalidAssign.status, "personal_knowledge_invalid_input");

  const unassigned = await execute(tools.get("KnowledgeUnassignTheme")!, {
    themeId: createdTheme.theme.id,
    refIds: [note.note.id, "legacy-material"],
  }) as { readonly status: string; readonly unassigned: readonly string[]; readonly locked: readonly string[] };
  assert.deepEqual(unassigned, { status: "unassigned", themeId: createdTheme.theme.id, unassigned: [note.note.id, "legacy-material"], locked: [] });

  const { records } = await feature.queries.recentChanges();
  assert.deepEqual(records.map((record) => record.type).sort(), [
    "knowledge.asset_updated",
    "knowledge.theme_assigned",
    "knowledge.theme_created",
    "knowledge.theme_unassigned",
    "knowledge.uncollected",
  ]);
  assert.deepEqual(records.map((record) => record.actor.kind), Array(5).fill("agent"));
  assert.deepEqual(records.map((record) => record.actor.actorId), Array(5).fill("ordinary-agent"));
});

test("KnowledgeList without kind enumerates uncollected notes and KnowledgeReadPage reads them", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-list-uncollected-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tools = new Map(createPersonalKnowledgeTools({ knowledge: feature }).map((tool) => [tool.definition.name, tool]));

  const created = await execute(tools.get("KnowledgeCreateNote")!, {
    spaceId: "space-one",
    title: "未收藏的笔记",
    bodyMarkdown: "正文内容",
  }) as { readonly status: string; readonly note: { readonly id: string } };
  assert.equal(created.status, "created");

  const listed = await execute(tools.get("KnowledgeList")!, { limit: 10 }) as {
    readonly status: string;
    readonly pages: readonly { readonly refId: string; readonly kind: string; readonly title?: string; readonly spaceId?: string }[];
  };
  assert.equal(listed.status, "found");
  assert.ok(listed.pages.some((page) =>
    page.refId === created.note.id && page.kind === "note" && page.title === "未收藏的笔记" && page.spaceId === "space-one"));

  const invalidKind = await execute(tools.get("KnowledgeList")!, { kind: "bogus" }) as { readonly status: string };
  assert.equal(invalidKind.status, "invalid_input");

  const readPage = await execute(tools.get("KnowledgeReadPage")!, { refId: created.note.id }) as {
    readonly status: string;
    readonly bodyMarkdown: string;
    readonly spaceId: string;
  };
  assert.equal(readPage.status, "note");
  assert.equal(readPage.bodyMarkdown, "正文内容");
  assert.equal(readPage.spaceId, "space-one");

  const missing = await execute(tools.get("KnowledgeReadPage")!, { refId: "missing" }) as { readonly status: string };
  assert.equal(missing.status, "missing");
});

test("KnowledgeNoteHistory lists revisions and KnowledgeRestoreNote restores an earlier revision", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-restore-tools-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tools = new Map(createPersonalKnowledgeTools({ knowledge: feature }).map((tool) => [tool.definition.name, tool]));

  const created = await execute(tools.get("KnowledgeCreateNote")!, {
    spaceId: "space-one",
    title: "回溯测试",
    bodyMarkdown: "第一版正文",
  }) as { readonly status: string; readonly note: { readonly id: string; readonly revision: number } };
  assert.equal(created.status, "created");
  await execute(tools.get("KnowledgeUpdateNote")!, {
    noteId: created.note.id,
    expectedRevision: 1,
    bodyMarkdown: "第二版正文",
  });

  const history = await execute(tools.get("KnowledgeNoteHistory")!, { noteId: created.note.id }) as {
    readonly status: string;
    readonly revisions: readonly { readonly revision: number; readonly operation: string; readonly title: string; readonly bodyMarkdown: string }[];
  };
  assert.equal(history.status, "found");
  assert.deepEqual(history.revisions.map((revision) => revision.revision), [2, 1]);
  assert.equal(history.revisions[1]?.bodyMarkdown, "第一版正文");

  const restored = await execute(tools.get("KnowledgeRestoreNote")!, {
    noteId: created.note.id,
    expectedRevision: 2,
    targetRevision: 1,
  }) as { readonly status: string; readonly noteId: string; readonly revision: number; readonly targetRevision: number };
  assert.deepEqual(restored, { status: "restored", noteId: created.note.id, revision: 3, targetRevision: 1 });

  const read = await execute(tools.get("KnowledgeRead")!, { noteId: created.note.id }) as {
    readonly status: string;
    readonly note: { readonly bodyMarkdown: string; readonly revision: number };
  };
  assert.equal(read.note.bodyMarkdown, "第一版正文");
  assert.equal(read.note.revision, 3);

  const stale = await execute(tools.get("KnowledgeRestoreNote")!, {
    noteId: created.note.id,
    expectedRevision: 2,
    targetRevision: 1,
  }) as { readonly status: string };
  assert.equal(stale.status, "personal_note_revision_conflict");

  const missingTarget = await execute(tools.get("KnowledgeRestoreNote")!, {
    noteId: created.note.id,
    expectedRevision: 3,
    targetRevision: 99,
  }) as { readonly status: string };
  assert.equal(missingTarget.status, "personal_note_not_found");

  const invalid = await execute(tools.get("KnowledgeRestoreNote")!, {
    noteId: created.note.id,
    expectedRevision: 3,
    targetRevision: 3,
  }) as { readonly status: string };
  assert.equal(invalid.status, "personal_knowledge_invalid_input");
});

test("Personal Knowledge agent tool schemas reject actor and visual facts", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-schema-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async () => true,
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (const tool of createPersonalKnowledgeTools({ knowledge: feature })) {
    const definition = tool.definition;
    assert.equal(definition.inputSchema.type, "object");
    assert.equal(definition.inputSchema.additionalProperties, false);
    assert.equal(definition.inputSchema.properties.actor, undefined);
    assert.equal(definition.inputSchema.properties.origin, undefined);
    assert.equal(definition.inputSchema.properties.by, undefined);
    assert.equal(definition.inputSchema.properties.locked, undefined);
    assert.equal(definition.inputSchema.properties.occurredAt, undefined);
    assert.equal(definition.inputSchema.properties.toolCallId, undefined);
  }
});

test("Personal Knowledge tools search, read, create, update, delete and collect through the feature", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-tools-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  let captureCount = 0;
  const feature = createPersonalKnowledgeFeature({
    repository: createSqlitePersonalKnowledgeRepository(database),
    spaceExists: async (spaceId) => spaceId === "space-one",
    captureSpaceReference: async ({ relativePath }) => {
      captureCount += 1;
      return { status: "managed", title: "参考资料", sourceLabel: "C:/source", contentKind: "file", sourceReferenceId: "reference-one", sourceRelativePath: relativePath };
    },
    removeManagedAsset: async () => undefined,
  });
  t.after(async () => {
    await feature.release();
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tools = new Map(createPersonalKnowledgeTools({ knowledge: feature }).map((tool) => [tool.definition.name, tool]));
  assert.equal(tools.get("KnowledgeDeleteNote")!.definition.metadata?.requiresConfirmation, true);

  const created = await execute(tools.get("KnowledgeCreateNote")!, {
    spaceId: "space-one",
    title: "反向传播",
    bodyMarkdown: "核心是链式法则",
  }) as { readonly status: string; readonly note: { readonly id: string } };
  assert.equal(created.status, "created");

  const searched = await execute(tools.get("KnowledgeSearch")!, { query: "链式法则" }) as {
    readonly status: string;
    readonly results: readonly { readonly note: { readonly id: string; readonly revision: number } }[];
  };
  assert.equal(searched.status, "found");
  assert.equal(searched.results[0]?.note.id, created.note.id);

  const read = await execute(tools.get("KnowledgeRead")!, { noteId: created.note.id }) as {
    readonly status: string;
    readonly note: { readonly bodyMarkdown: string; readonly revision: number };
  };
  assert.equal(read.note.bodyMarkdown, "核心是链式法则");
  assert.equal(read.note.revision, 1);

  assert.deepEqual(await execute(tools.get("KnowledgeUpdateNote")!, {
    noteId: created.note.id,
    expectedRevision: 1,
    bodyMarkdown: "更新后的正文",
  }), { status: "updated", noteId: created.note.id, revision: 2 });
  assert.equal((await execute(tools.get("KnowledgeUpdateNote")!, {
    noteId: created.note.id,
    expectedRevision: 1,
    title: "过期更新",
  }) as { readonly status: string }).status, "personal_note_revision_conflict");
  assert.equal((await execute(tools.get("KnowledgeDeleteNote")!, {
    noteId: created.note.id,
    expectedRevision: 1,
  }) as { readonly status: string }).status, "personal_note_revision_conflict");

  assert.equal((await execute(tools.get("KnowledgeCollect")!, {
    refId: created.note.id,
    kind: "note",
  }) as { readonly status: string }).status, "collected");
  assert.equal((await feature.queries.snapshot()).pages[0]?.refId, created.note.id);
  const collectedReference = await execute(tools.get("KnowledgeCollect")!, { refId: "reference-one", kind: "space_reference" }) as { page: { asset?: { status: string } } };
  assert.equal(collectedReference.page.asset?.status, "managed");
  const collectedChild = await execute(tools.get("KnowledgeCollect")!, {
    refId: "reference-one",
    kind: "space_reference",
    relativePath: "docs\\guide.md",
  }) as { page: { refId: string; asset?: { sourceRelativePath?: string } } };
  const duplicateChild = await execute(tools.get("KnowledgeCollect")!, {
    refId: "reference-one",
    kind: "space_reference",
    relativePath: "docs/guide.md",
  }) as { page: { refId: string } };
  assert.equal(collectedChild.page.refId, duplicateChild.page.refId);
  assert.equal(collectedChild.page.asset?.sourceRelativePath, "docs/guide.md");
  assert.equal(captureCount, 2);
  const revisions = await feature.queries.noteRevisions(created.note.id);
  assert.equal(revisions[0]?.actor.kind, "agent");
  assert.equal(revisions[0]?.actor.actorId, "ordinary-agent");
  assert.equal(revisions[0]?.actor.traceId, "trace-one");
  assert.equal(revisions[0]?.actor.toolCallId, "tool-call-one");
  assert.deepEqual(await execute(tools.get("KnowledgeDeleteNote")!, {
    noteId: created.note.id,
    expectedRevision: 2,
  }), { status: "deleted", noteId: created.note.id });
  assert.deepEqual(await execute(tools.get("KnowledgeRead")!, { noteId: created.note.id }), {
    status: "personal_note_not_found",
    noteId: created.note.id,
  });
});

function execute(tool: ToolExecutor, input: unknown): Promise<unknown> {
  return tool.execute(input, {
    callerAgentId: "ordinary-agent",
    traceId: "trace-one",
    goalId: "goal-one",
    toolCallId: "tool-call-one",
  });
}