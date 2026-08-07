import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import {
  createSqliteSpaceConversationDeletionJournal,
  newSpaceConversationDeletionRecord,
} from "./space-conversation-deletion-journal.js";

test("SQLite Space Conversation deletion journal persists checkpoints across reopen", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-conversation-deletion-"));
  const filePath = path.join(root, "workbench.sqlite3");
  const database = new SqliteRuntimeDatabase(filePath);
  const journal = createSqliteSpaceConversationDeletionJournal(database);
  const prepared = newSpaceConversationDeletionRecord({
    deletionId: "12345678-1234-4123-8123-123456789abc",
    spaceId: "space-1",
    conversationIds: ["conversation-1", "conversation-1", "conversation-2"],
    referenceIds: ["reference-1", "reference-1", "reference-2"],
    now: "2026-08-06T00:00:00.000Z",
  });
  await journal.save(prepared);
  database.close();

  const reopened = new SqliteRuntimeDatabase(filePath);
  t.after(async () => {
    reopened.close();
    await removeTestDirectory(root);
  });
  const restored = createSqliteSpaceConversationDeletionJournal(reopened);

  assert.deepEqual(await restored.getBySpace("space-1"), {
    ...prepared,
    conversationIds: ["conversation-1", "conversation-2"],
    referenceIds: ["reference-1", "reference-2"],
  });
  await restored.delete(prepared.deletionId);
  assert.deepEqual(await restored.list(), []);
});
