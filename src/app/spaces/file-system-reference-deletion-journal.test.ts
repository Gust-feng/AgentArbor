import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { makeTestDirectory, removeTestDirectory } from "../testing/fs-test-directories.js";
import { SpaceFeatureError } from "./contracts.js";
import {
  createFileSystemSpaceReferenceDeletionJournal,
  inspectFileSystemSpaceReferenceDeletionJournal,
  type SpaceReferenceDeletionJournalRecord,
  type SpaceReferenceDeletionPhase,
} from "./file-system-reference-deletion-journal.js";

test("filesystem Space deletion journal round-trips, overwrites phases, and deletes records", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-deletion-journal-");
  t.after(() => removeTestDirectory(root));
  const store = createFileSystemSpaceReferenceDeletionJournal(root);
  const second = record("delete-b", "prepared");
  const first = record("delete-a", "prepared");

  assert.equal(store.mutationKey, path.resolve(root));
  assert.equal(inspectFileSystemSpaceReferenceDeletionJournal(root), "idle");
  await store.save(second);
  assert.equal(inspectFileSystemSpaceReferenceDeletionJournal(root), "pending");
  await store.save(first);
  assert.deepEqual(await store.list(), [first, second]);

  const committed = record("delete-a", "metadata_committed");
  await store.save({ ...first, phase: "files_staged" });
  await store.save(committed);
  assert.deepEqual(await store.list(), [committed, second]);

  await store.delete(first.deletionId);
  assert.deepEqual(await store.list(), [second]);
  await store.delete(first.deletionId);
  assert.deepEqual(await store.list(), [second]);
  await store.delete(second.deletionId);
  assert.equal(inspectFileSystemSpaceReferenceDeletionJournal(root), "idle");
});

test("filesystem Space deletion journal rejects corrupt JSON and unknown schema versions", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-deletion-corrupt-");
  t.after(() => removeTestDirectory(root));
  const store = createFileSystemSpaceReferenceDeletionJournal(root);
  await store.list();

  await fs.writeFile(path.join(root, "broken.json"), "{not-json", "utf8");
  await assert.rejects(
    store.list(),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_journal_failure",
  );

  await fs.rm(path.join(root, "broken.json"));
  await fs.writeFile(
    path.join(root, "future.json"),
    `${JSON.stringify({ ...record("future", "prepared"), schemaVersion: "space-reference-deletion/v2" })}\n`,
    "utf8",
  );
  await assert.rejects(
    store.list(),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_journal_failure",
  );

  await assert.rejects(
    store.delete("../outside"),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_journal_failure",
  );
});

test("listing removes only orphaned files inside the journal temp directory", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-deletion-temp-");
  t.after(() => removeTestDirectory(root));
  const store = createFileSystemSpaceReferenceDeletionJournal(root);
  const tempRoot = path.join(root, ".tmp");
  const rootTemp = path.join(root, "leave-me.tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.writeFile(path.join(tempRoot, "orphan.tmp"), "partial", "utf8");
  await fs.writeFile(rootTemp, "not journal temp storage", "utf8");

  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await fs.readdir(tempRoot), []);
  assert.equal(await fs.readFile(rootTemp, "utf8"), "not journal temp storage");
});

test("listing rejects a linked journal temp directory without deleting the link target", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-deletion-linked-temp-");
  const outside = await makeTestDirectory("agentarbor-space-deletion-linked-target-");
  t.after(async () => { await Promise.all([removeTestDirectory(root), removeTestDirectory(outside)]); });
  const victim = path.join(outside, "keep.txt");
  await fs.writeFile(victim, "keep", "utf8");
  await fs.symlink(outside, path.join(root, ".tmp"), process.platform === "win32" ? "junction" : "dir");
  const store = createFileSystemSpaceReferenceDeletionJournal(root);

  await assert.rejects(
    store.list(),
    (error: unknown) => error instanceof SpaceFeatureError && error.code === "space_deletion_journal_failure",
  );
  assert.equal(await fs.readFile(victim, "utf8"), "keep");
});

function record(
  deletionId: string,
  phase: SpaceReferenceDeletionPhase,
): SpaceReferenceDeletionJournalRecord {
  const sourcePath = path.resolve("owned", `${deletionId}.md`);
  return {
    schemaVersion: "space-reference-deletion/v1",
    deletionId,
    phase,
    rootReferenceId: `reference-${deletionId}`,
    removedReferences: [{
      id: `reference-${deletionId}`,
      spaceId: "space-one",
      title: "Owned file",
      reference: { kind: "local_file", path: sourcePath },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    }],
    targets: [{
      referenceId: `reference-${deletionId}`,
      kind: "local_file",
      sourcePath,
      stagedPath: path.join(
        path.dirname(sourcePath),
        `.${path.basename(sourcePath)}.agentarbor-delete-${deletionId}-0`,
      ),
    }],
    ownedAssetIds: [],
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}