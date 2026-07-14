import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrdinaryFeatureError } from "./contracts.js";
import type { OrdinaryConversationControlState } from "./contracts.js";
import {
  createFileSystemOrdinaryConversationControlRepository,
  OrdinaryConversationSnapshotIncompatibleError,
} from "./conversation-control-repository.js";

test("conversation control repository atomically advances CAS revisions and preserves the lineage graph", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-control-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createFileSystemOrdinaryConversationControlRepository(root);
  const initial = control();
  const first = await repository.save(initial, 0, initial.createdAt);
  const secondState: OrdinaryConversationControlState = {
    ...initial,
    titleOverride: "Renamed",
    titleEditedAt: "2026-01-01T00:00:01.000Z",
    pinnedAt: "2026-01-01T00:00:02.000Z",
    activeLineageId: "lineage-2",
    lineages: [...initial.lineages, {
      lineageId: "lineage-2",
      parentLineageId: "lineage-1",
      forkFromRunId: "run-1",
      createdAt: "2026-01-01T00:00:03.000Z",
    }],
  };
  const second = await repository.save(secondState, first.revision, "2026-01-01T00:00:03.000Z");
  assert.equal(second.revision, 2);
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

test("conversation control repository rejects malformed lineage graphs and old snapshots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createFileSystemOrdinaryConversationControlRepository(root);
  await assert.rejects(repository.save({
    ...control(),
    activeLineageId: "missing",
    lineages: [{ lineageId: "lineage-1", parentLineageId: "missing-parent", createdAt: "2026-01-01T00:00:00.000Z" }],
  }, 0, "2026-01-01T00:00:00.000Z"), (error: unknown) => error instanceof OrdinaryConversationSnapshotIncompatibleError);

  const directory = path.join(root, "conversations", "old-conversation");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ schemaVersion: "legacy/v0", revision: 1 }));
  await assert.rejects(repository.get("old-conversation"), (error: unknown) =>
    error instanceof OrdinaryConversationSnapshotIncompatibleError && error.code === "ordinary_conversation_snapshot_incompatible");
});

function control(): OrdinaryConversationControlState {
  return {
    conversationId: "conversation-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    activeLineageId: "lineage-1",
    lineages: [{ lineageId: "lineage-1", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
}
