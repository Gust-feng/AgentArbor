import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ORDINARY_CONVERSATION_SCHEMA_VERSION, OrdinaryFeatureError } from "./contracts.js";
import type { OrdinaryConversationControlState } from "./contracts.js";
import {
  createFileSystemOrdinaryConversationControlRepository,
  OrdinaryConversationSnapshotIncompatibleError,
} from "./conversation-control-repository.js";

test("conversation control repository atomically advances v2 metadata around one required Session ref", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-control-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repository = createFileSystemOrdinaryConversationControlRepository(root);
  const initial = control();
  const first = await repository.save(initial, 0, initial.createdAt);
  const secondState: OrdinaryConversationControlState = {
    ...initial,
    titleOverride: "Renamed",
    titleEditedAt: "2026-01-01T00:00:01.000Z",
    pinnedAt: "2026-01-01T00:00:02.000Z",
  };
  const second = await repository.save(secondState, first.revision, "2026-01-01T00:00:03.000Z");
  assert.equal(second.revision, 2);
  assert.equal(second.schemaVersion, ORDINARY_CONVERSATION_SCHEMA_VERSION);
  assert.deepEqual(await repository.get(initial.conversationId), second);
  assert.deepEqual(await repository.list(), [{
    conversationId: initial.conversationId,
    updatedAt: "2026-01-01T00:00:03.000Z",
    deleted: false,
  }]);
  await assert.rejects(repository.save(secondState, 1, "2026-01-01T00:00:04.000Z"), (error: unknown) =>
    error instanceof OrdinaryFeatureError &&
    error.code === "ordinary_revision_conflict" &&
    error.cause instanceof Error &&
    /revision conflict/u.test(error.cause.message));
});

test("conversation control repository rejects missing Session refs and v1 snapshots without migration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repository = createFileSystemOrdinaryConversationControlRepository(root);
  const { sessionRef: _sessionRef, ...withoutSession } = control();
  await assert.rejects(repository.save(
    withoutSession as OrdinaryConversationControlState,
    0,
    "2026-01-01T00:00:00.000Z",
  ), (error: unknown) => error instanceof OrdinaryConversationSnapshotIncompatibleError);

  const directory = path.join(root, "conversations", "old-conversation");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "snapshot.json"), JSON.stringify({
    schemaVersion: "ordinary-conversation/v1",
    revision: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    state: {
      conversationId: "old-conversation",
      createdAt: "2026-01-01T00:00:00.000Z",
      activeLineageId: "lineage-1",
      lineages: [{ lineageId: "lineage-1", createdAt: "2026-01-01T00:00:00.000Z" }],
    },
  }));
  await assert.rejects(repository.get("old-conversation"), (error: unknown) =>
    error instanceof OrdinaryConversationSnapshotIncompatibleError && error.code === "ordinary_conversation_snapshot_incompatible");
});

test("conversation control repository list isolates incompatible and damaged snapshots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-list-isolation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repository = createFileSystemOrdinaryConversationControlRepository(root);
  const valid = control();
  await repository.save(valid, 0, "2026-01-01T00:00:02.000Z");

  const oldDirectory = path.join(root, "conversations", "old-conversation");
  await fs.mkdir(oldDirectory, { recursive: true });
  await fs.writeFile(path.join(oldDirectory, "snapshot.json"), JSON.stringify({
    schemaVersion: "ordinary-conversation/v1",
    revision: 1,
    savedAt: "2026-01-01T00:00:01.000Z",
    state: { conversationId: "old-conversation", createdAt: "2026-01-01T00:00:00.000Z" },
  }));
  const damagedDirectory = path.join(root, "conversations", "damaged-conversation");
  await fs.mkdir(damagedDirectory, { recursive: true });
  await fs.writeFile(path.join(damagedDirectory, "snapshot.json"), "{not-json");

  assert.deepEqual(await repository.list(), [{
    conversationId: valid.conversationId,
    updatedAt: "2026-01-01T00:00:02.000Z",
    deleted: false,
  }]);
  await assert.rejects(repository.get("old-conversation"), OrdinaryConversationSnapshotIncompatibleError);
  await assert.rejects(repository.get("damaged-conversation"), OrdinaryConversationSnapshotIncompatibleError);
});

function control(): OrdinaryConversationControlState {
  return {
    conversationId: "conversation-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    sessionRef: {
      sessionId: "session-1",
      storageKey: "session-1.jsonl",
      sessionCwd: "Z:/workspace",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}
