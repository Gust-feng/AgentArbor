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
    await rm(directory, { recursive: true, force: true });
  });
  const tools = new Map(createPersonalKnowledgeTools({ knowledge: feature }).map((tool) => [tool.definition.name, tool]));

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