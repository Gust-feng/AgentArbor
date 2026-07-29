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

test("Personal Knowledge tools search, read, create, update and collect through the feature", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-tools-"));
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

  assert.equal((await execute(tools.get("KnowledgeCollect")!, {
    refId: created.note.id,
    kind: "note",
  }) as { readonly status: string }).status, "collected");
  assert.equal((await feature.queries.snapshot()).pages[0]?.refId, created.note.id);
});

function execute(tool: ToolExecutor, input: unknown): Promise<unknown> {
  return tool.execute(input, {} as never);
}
