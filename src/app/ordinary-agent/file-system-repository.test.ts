import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileSystemOrdinaryRunRepository, OrdinaryRunSnapshotIncompatibleError } from "./file-system-repository.js";
import { createInitialOrdinaryRunState, transitionOrdinaryRun } from "./state.js";
import { ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("file repository atomically replaces the canonical snapshot and advances revisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-repository-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("run-one", "2026-01-01T00:00:00.000Z");

  const revisionOne = await repository.save(initial, 0);
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const revisionTwo = await repository.save(running, revisionOne.revision);

  assert.equal(revisionOne.revision, 1);
  assert.equal(revisionTwo.revision, 2);
  assert.deepEqual(await repository.get("run-one"), revisionTwo);
  assert.deepEqual((await repository.list()).map((item) => ({ runId: item.runId, status: item.status })), [
    { runId: "run-one", status: "running" },
  ]);
  const snapshot = JSON.parse(await fs.readFile(path.join(root, "runs", "run-one", "snapshot.json"), "utf8")) as { revision: number };
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
  assert.equal(snapshot.revision, 2);
  assert.equal("state" in manifest, false, "the manifest must remain a list index rather than a recovery fact");
  assert.equal((await fs.readdir(path.join(root, "runs", "run-one", ".tmp"))).length, 0);
  await assert.rejects(repository.save(running, 1), /revision conflict/u);
});

test("file repository never writes ephemeral attachment bytes into an Ordinary snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-no-attachments-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateWithAttachment = createInitialOrdinaryRunState({
    runId: "attachment-run",
    turn: ordinaryRunTurn("attachment-run"),
    runInput: {
      userMessage: "inspect attachment",
      taskSoil: { attachmentRefs: [{ ref: "attachment:image", kind: "file", title: "image.png" }] },
    },
    birth: ordinaryRunBirth(),
    priorCanonicalMessages: [{
      role: "user",
      content: "image",
      attachments: [{
        attachmentId: "image-1",
        kind: "image",
        source: { kind: "data", mimeType: "image/png", data: "BASE64_MUST_NOT_REACH_DISK" },
      }],
    }],
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  await createFileSystemOrdinaryRunRepository(root).save(stateWithAttachment, 0);
  const rawSnapshot = await fs.readFile(path.join(root, "runs", "attachment-run", "snapshot.json"), "utf8");
  assert.equal(rawSnapshot.includes("BASE64_MUST_NOT_REACH_DISK"), false);
  assert.equal(rawSnapshot.includes("attachment:image"), true);
});

test("file repository rejects old or malformed snapshots instead of compatibility reading", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-incompatible-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runDirectory = path.join(root, "runs", "old-run");
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "snapshot.json"), JSON.stringify({ schemaVersion: "legacy/v0", revision: 1 }));
  const repository = createFileSystemOrdinaryRunRepository(root);

  await assert.rejects(repository.get("old-run"), (error: unknown) =>
    error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible");
});

test("a broken disposable manifest cannot invalidate a committed snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-manifest-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "manifest.json"), { recursive: true });
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("manifest-run", "2026-01-01T00:00:00.000Z");

  const revisionOne = await repository.save(initial, 0);
  assert.equal((await repository.get("manifest-run"))?.revision, 1);
  assert.equal((await repository.list())[0]?.runId, "manifest-run", "directory scan repairs a missing manifest index");
  await fs.rm(path.join(root, "manifest.json"), { recursive: true, force: true });
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const revisionTwo = await repository.save(running, revisionOne.revision);
  assert.equal(revisionTwo.revision, 2);
});

function state(runId: string, recordedAt: string) {
  return createInitialOrdinaryRunState({
    runId,
    turn: ordinaryRunTurn(runId),
    runInput: { userMessage: "hello" },
    birth: ordinaryRunBirth(),
    recordedAt,
    eventId: "event-1",
  });
}
