import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import {
  createSqliteSpaceConversationLinkJournal,
  newSpaceConversationBirthRecord,
  newSpaceConversationDeleteRecord,
} from "./space-conversation-link-journal.js";

test("SQLite Conversation link journal persists birth and deletion checkpoints across reopen", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-conversation-link-"));
  const filePath = path.join(root, "workbench.sqlite3");
  const database = new SqliteRuntimeDatabase(filePath);
  const journal = createSqliteSpaceConversationLinkJournal(database);
  const birth = newSpaceConversationBirthRecord({
    operationId: "12345678-1234-4123-8123-123456789abc",
    conversationId: "conversation-1",
    owner: { kind: "space", id: "space-1" },
    spaceId: "space-1",
    referenceItemId: "space-conversation:submission-1",
    now: "2026-08-06T00:00:00.000Z",
  });
  const deletion = newSpaceConversationDeleteRecord({
    operationId: "12345678-1234-4123-8123-123456789abd",
    conversationId: "conversation-2",
    owner: { spaceId: "space-2", referenceItemId: "space-conversation:submission-2" },
    now: "2026-08-06T00:00:01.000Z",
  });
  await journal.save({ ...birth, phase: "owner_linked", updatedAt: "2026-08-06T00:00:02.000Z" });
  await journal.save({
    ...deletion,
    phase: "conversation_deleted",
    lastErrorMessage: "Space repository unavailable",
    updatedAt: "2026-08-06T00:00:03.000Z",
  });
  database.close();

  const reopened = new SqliteRuntimeDatabase(filePath);
  t.after(async () => {
    reopened.close();
    await removeTestDirectory(root);
  });
  const restored = createSqliteSpaceConversationLinkJournal(reopened);

  assert.deepEqual(await restored.getByConversation("conversation-1"), {
    ...birth,
    phase: "owner_linked",
    updatedAt: "2026-08-06T00:00:02.000Z",
  });
  assert.deepEqual(await restored.getByConversation("conversation-2"), {
    ...deletion,
    phase: "conversation_deleted",
    lastErrorMessage: "Space repository unavailable",
    updatedAt: "2026-08-06T00:00:03.000Z",
  });
  await restored.delete(birth.operationId);
  await restored.delete(deletion.operationId);
  assert.deepEqual(await restored.list(), []);
});
