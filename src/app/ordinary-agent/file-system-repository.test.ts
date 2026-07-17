import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrdinaryFeatureError } from "./contracts.js";
import { createFileSystemOrdinaryRunRepository, OrdinaryRunSnapshotIncompatibleError } from "./file-system-repository.js";
import { createInitialOrdinaryRunState, transitionOrdinaryRun } from "./state.js";
import { ordinaryCapabilityResolution, ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("file repository atomically replaces the canonical snapshot and advances revisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-repository-"));
  t.after(() => removeTestDirectory(root));
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
  await assert.rejects(repository.save(running, 1), (error: unknown) =>
    error instanceof OrdinaryFeatureError &&
    error.code === "ordinary_revision_conflict" &&
    error.cause instanceof Error &&
    /revision conflict/u.test(error.cause.message));
});

test("file repository never writes ephemeral attachment bytes into an Ordinary snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-no-attachments-"));
  t.after(() => removeTestDirectory(root));
  const stateWithAttachment = createInitialOrdinaryRunState({
    runId: "attachment-run",
    turn: ordinaryRunTurn("attachment-run"),
    runInput: {
      userMessage: "inspect attachment",
      taskSoil: {
        contextRefs: [{ attachmentId: "image", ref: "file:image.png", kind: "file", title: "image.png" }],
        permissionBoundaryRefs: ["read:file:image.png"],
      },
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
  assert.equal(rawSnapshot.includes('"attachmentId": "image"'), true);
  assert.equal(rawSnapshot.includes("read:file:image.png"), true);
});

test("file repository rejects old or malformed snapshots instead of compatibility reading", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-incompatible-"));
  t.after(() => removeTestDirectory(root));
  const runDirectory = path.join(root, "runs", "old-run");
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "snapshot.json"), JSON.stringify({ schemaVersion: "legacy/v0", revision: 1 }));
  const repository = createFileSystemOrdinaryRunRepository(root);

  await assert.rejects(repository.get("old-run"), (error: unknown) =>
    error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible");
});

test("file repository rejects the retired ordinary-run/v2 confirmation identity schema", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v2-incompatible-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const saved = await repository.save(state("v2-run", "2026-01-01T00:00:00.000Z"), 0);
  await fs.writeFile(
    path.join(root, "runs", "v2-run", "snapshot.json"),
    JSON.stringify({ ...saved, schemaVersion: "ordinary-run/v2" }),
    "utf8",
  );

  await assert.rejects(
    repository.get("v2-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError &&
      error.message.includes("ordinary-run/v3"),
  );
});

test("file repository rejects the retired in-place retry continuation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-retry-incompatible-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("retry-run", "2026-01-01T00:00:00.000Z");
  const created = await repository.save(initial, 0);
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const started = await repository.save(running, created.revision);
  const blocked = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "block",
      reason: { code: "provider_disconnected", message: "provider disconnected" },
      continueBy: "new_turn",
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });
  await repository.save(blocked, started.revision);
  const snapshotPath = path.join(root, "runs", "retry-run", "snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
    state: { status: unknown };
  };
  snapshot.state.status = {
    kind: "blocked",
    reason: { code: "provider_disconnected", message: "provider disconnected" },
    continueBy: "retry",
  };
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

  await assert.rejects(
    repository.get("retry-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );
});

test("file repository list isolates an incompatible snapshot from healthy run summaries", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-isolated-invalid-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  await repository.save(state("healthy-run", "2026-01-01T00:00:00.000Z"), 0);
  await repository.save(state("broken-run", "2026-01-01T00:00:01.000Z"), 0);

  await fs.writeFile(
    path.join(root, "runs", "broken-run", "snapshot.json"),
    JSON.stringify({ schemaVersion: "legacy/v0", revision: 1 }),
    "utf8",
  );

  assert.deepEqual(
    (await repository.list()).map((summary) => summary.runId),
    ["healthy-run"],
  );
  await assert.rejects(
    repository.get("broken-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );
});

test("file repository rejects snapshots from retired model providers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-retired-provider-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  await repository.save(state("retired-provider-run", "2026-01-01T00:00:00.000Z"), 0);
  const snapshotPath = path.join(root, "runs", "retired-provider-run", "snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
    state: { birth: { capabilitySnapshot: { activeModel: Record<string, unknown> } } };
  };
  snapshot.state.birth.capabilitySnapshot.activeModel.providerKind = "anthropic";
  snapshot.state.birth.capabilitySnapshot.activeModel.protocolKind = "anthropic_messages";
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

  await assert.rejects(repository.get("retired-provider-run"), (error: unknown) =>
    error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible");
});

test("file repository validates cumulative usage before committing an Ordinary snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-usage-validation-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const invalid = { ...state("invalid-usage-run", "2026-01-01T00:00:00.000Z"), usage: { inputTokens: -1 } };

  await assert.rejects(repository.save(invalid, 0), (error: unknown) =>
    error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible");
  assert.equal(await repository.get("invalid-usage-run"), undefined);
});

test("file repository persists the effective capability resolution and rejects malformed facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-capability-resolution-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("capability-run", "2026-01-01T00:00:00.000Z");
  const created = await repository.save(initial, 0);
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const started = await repository.save(running, created.revision);
  const resolution = ordinaryCapabilityResolution();
  const completed = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "complete",
      answer: "done",
      canonicalMessages: [...running.canonicalMessages, { role: "assistant", content: "done" }],
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
      capabilityResolution: resolution,
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  await repository.save(completed, started.revision);
  assert.deepEqual((await repository.get("capability-run"))?.state.capabilityResolution, resolution);

  const malformed = { ...state("bad-capability-run", "2026-01-01T00:00:00.000Z"), capabilityResolution: { resolutionId: "partial" } };
  await assert.rejects(repository.save(malformed as never, 0), (error: unknown) =>
    error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible");
});

test("file repository round-trips nested tool facts that share one provider call id", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-scoped-tool-facts-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("scoped-tool-run", "2026-01-01T00:00:00.000Z");
  const created = await repository.save(initial, 0);
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const started = await repository.save(running, created.revision);
  const toolCalls = ["parent-a", "parent-b"].map((parent) => ({
    callId: "shared-provider-call",
    factId: `agent-tool:${parent.length}:${parent}/tool:shared-provider-call`,
    toolName: "read_fact",
    input: { parent },
    output: { value: parent },
    status: "completed" as const,
    durationMs: 1,
  }));
  const completed = transitionOrdinaryRun({
    state: running,
    transition: {
      type: "complete",
      answer: "done",
      canonicalMessages: [...running.canonicalMessages, { role: "assistant", content: "done" }],
      toolCalls,
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  const saved = await repository.save(completed, started.revision);
  assert.deepEqual((await repository.get("scoped-tool-run"))?.state.toolCalls, toolCalls);
  assert.equal(Object.keys(saved.state.toolResultRecordedAt).length, 2);
});

test("a broken disposable manifest cannot invalidate a committed snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-manifest-failure-"));
  t.after(() => removeTestDirectory(root));
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

function removeTestDirectory(root: string): Promise<void> {
  return fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
