import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OrdinaryFeatureError } from "./contracts.js";
import { createFileSystemOrdinaryRunRepository, OrdinaryRunSnapshotIncompatibleError } from "./file-system-repository.js";
import {
  createInitialOrdinaryRunState,
  recordOrdinaryToolResult,
  recordOrdinaryNestedToolRequests,
  transitionOrdinaryRun,
} from "./state.js";
import { ordinaryAgentSessionRef, ordinaryCapabilityResolution, ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";
import { OrdinaryToolMetricsCollector } from "./tool-runtime-metrics.js";

test("file repository atomically replaces the v6 snapshot and advances revisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-repository-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("run-one", "2026-01-01T00:00:00.000Z");

  const revisionOne = await repository.save(initial, 0);
  const running = {
    ...transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
    }),
    visibleAssistantText: "durable visible draft",
  };
  const revisionTwo = await repository.save(running, revisionOne.revision);

  assert.equal(revisionOne.revision, 1);
  assert.equal(revisionTwo.revision, 2);
  assert.deepEqual(await repository.get("run-one"), revisionTwo);
  assert.equal((await repository.get("run-one"))?.state.visibleAssistantText, "durable visible draft");
  assert.deepEqual((await repository.list()).map((item) => ({ runId: item.runId, status: item.status })), [
    { runId: "run-one", status: "running" },
  ]);
  const snapshotText = await fs.readFile(path.join(root, "runs", "run-one", "snapshot.json"), "utf8");
  const snapshot = JSON.parse(snapshotText) as { revision: number };
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshotText.includes("canonicalMessages"), false);
  assert.equal(snapshotText.includes("lineageId"), false);
  assert.equal("state" in manifest, false, "the manifest must remain a list index rather than a recovery fact");
  assert.equal((await fs.readdir(path.join(root, "runs", "run-one", ".tmp"))).length, 0);
  await assert.rejects(repository.save(running, 1), (error: unknown) =>
    error instanceof OrdinaryFeatureError &&
    error.code === "ordinary_revision_conflict" &&
    error.cause instanceof Error &&
    /revision conflict/u.test(error.cause.message));
});

test("file repository round-trips optional nested tool write-ahead facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-nested-write-ahead-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("nested-write-ahead", "2026-01-01T00:00:00.000Z");
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "started",
  });
  const withInput = withInputEntry(running);
  const withRootPending = transitionOrdinaryRun({
    state: withInput,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: {
        kind: "assistant_tool_call_entry_committed",
        sessionId: "agent-session-1",
        assistantEntryRef: entryRef("assistant-tools"),
        toolCallIds: ["parent-call"],
      },
    },
    recordedAt: "2026-01-01T00:00:01.300Z",
    eventId: "checkpoint-tools",
  });
  const request = {
    callId: "nested-call",
    factId: "agent-tool:11:parent-call/tool:nested-call",
    parentToolCallFactId: "parent-call",
    toolName: "write",
    input: { path: "result.txt" },
  };
  const pending = recordOrdinaryNestedToolRequests({
    state: withRootPending,
    requests: [request],
    recordedAt: "2026-01-01T00:00:02.000Z",
  });

  await repository.save(pending, 0);

  assert.deepEqual(
    (await repository.get("nested-write-ahead"))?.state.pendingNestedToolCalls,
    [request],
  );
});

test("recovery inventory reports incompatible snapshots without hiding healthy runs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-recovery-inventory-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  await repository.save(state("healthy-inventory-run", "2026-01-01T00:00:00.000Z"), 0);
  const damagedRunDirectory = path.join(root, "runs", "damaged-inventory-run");
  await fs.mkdir(damagedRunDirectory, { recursive: true });
  await fs.writeFile(path.join(damagedRunDirectory, "snapshot.json"), "{ invalid", "utf8");

  const inventory = await repository.inspectRecoveryInventory();

  assert.deepEqual(inventory.summaries.map((summary) => summary.runId), ["healthy-inventory-run"]);
  assert.equal(inventory.issues.length, 1);
  assert.equal(inventory.issues[0]?.runId, "damaged-inventory-run");
  assert.equal(inventory.issues[0]?.error instanceof OrdinaryRunSnapshotIncompatibleError, true);
});

test("file repository round-trips frozen owner-scoped Agent Note versions and rejects ownerless v7 runs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-note-versions-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("note-version-run", "2026-01-01T00:00:00.000Z");
  const owner = { kind: "workspace", id: "workspace-note-version" } as const;
  const withVersions = {
    ...initial,
    birth: {
      ...initial.birth,
      agentNoteVersions: {
        global: `sha256:${"a".repeat(64)}` as const,
        owner: {
          scope: owner,
          version: `sha256:${"b".repeat(64)}` as const,
        },
      },
      memoryOwner: owner,
    },
  };

  await repository.save(withVersions, 0);
  assert.deepEqual((await repository.get("note-version-run"))?.state.birth.agentNoteVersions, {
    global: `sha256:${"a".repeat(64)}`,
    owner: {
      scope: owner,
      version: `sha256:${"b".repeat(64)}`,
    },
  });
  assert.deepEqual((await repository.get("note-version-run"))?.state.birth.memoryOwner, owner);

  const snapshotPath = path.join(root, "runs", "note-version-run", "snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
    state: { birth: { agentNoteVersions?: unknown; memoryOwner?: unknown } };
  };
  delete snapshot.state.birth.agentNoteVersions;
  delete snapshot.state.birth.memoryOwner;
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  await assert.rejects(
    () => createFileSystemOrdinaryRunRepository(root).get("note-version-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );

  // Path-keyed v6 versions cannot be mapped to a stable owner without guessing.
  snapshot.state.birth.agentNoteVersions = {
    global: `sha256:${"a".repeat(64)}`,
    workspace: `sha256:${"b".repeat(64)}`,
  };
  snapshot.state.birth.memoryOwner = owner;
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  await assert.rejects(
    () => createFileSystemOrdinaryRunRepository(root).get("note-version-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );

  snapshot.state.birth.agentNoteVersions = {
    global: `sha256:${"a".repeat(64)}`,
    owner: {
      scope: owner,
      version: `sha256:${"b".repeat(64)}`,
    },
  };
  snapshot.state.birth.memoryOwner = { kind: "space", id: "different-owner" };
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  await assert.rejects(
    () => createFileSystemOrdinaryRunRepository(root).get("note-version-run"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );
});

test("file repository reads v0.3.2 Sub-Agent catalog extras without requiring them in the current contract", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-sub-agent-compat-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  await repository.save(state("legacy-sub-agent-catalog", "2026-01-01T00:00:00.000Z"), 0);
  const snapshotPath = path.join(root, "runs", "legacy-sub-agent-catalog", "snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
    state: {
      birth: {
        capabilitySnapshot: {
          subAgentCatalog: Array<Record<string, unknown>>;
        };
      };
    };
  };
  snapshot.state.birth.capabilitySnapshot.subAgentCatalog.push({
    id: "legacy-helper",
    name: "legacy-helper",
    description: "A catalog entry written by v0.3.2.",
    enabled: true,
    model: "gpt-5",
    maxSteps: 12,
  });
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

  const restored = await createFileSystemOrdinaryRunRepository(root).get("legacy-sub-agent-catalog");

  assert.equal(restored?.state.birth.capabilitySnapshot.subAgentCatalog[0]?.name, "legacy-helper");
});

test("file repository never writes ephemeral attachment bytes into an Ordinary snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-no-attachments-"));
  t.after(() => removeTestDirectory(root));
  const stateWithAttachment = createInitialOrdinaryRunState({
    runId: "attachment-run",
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn("attachment-run"),
    runInput: {
      userMessage: "inspect attachment",
      taskSoil: {
        contextRefs: [{ attachmentId: "image", ref: "file:image.png", kind: "file", title: "image.png" }],
        permissionBoundaryRefs: ["read:file:image.png"],
      },
    },
    birth: ordinaryRunBirth(),
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-1",
  });
  await createFileSystemOrdinaryRunRepository(root).save(stateWithAttachment, 0);
  const rawSnapshot = await fs.readFile(path.join(root, "runs", "attachment-run", "snapshot.json"), "utf8");
  assert.equal(rawSnapshot.includes("BASE64_MUST_NOT_REACH_DISK"), false);
  assert.equal(rawSnapshot.includes('"attachmentId": "image"'), true);
  assert.equal(rawSnapshot.includes("read:file:image.png"), true);
});

test("file repository round-trips JSON-safe model attachment references in tool facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-tool-attachment-refs-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("tool-attachment-refs", "2026-01-01T00:00:00.000Z");
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const result = {
    callId: "capture-call",
    toolName: "capture",
    input: {},
    output: { captured: true },
    modelAttachmentRefs: [{
      kind: "image" as const,
      attachmentId: "capture-image",
      mimeType: "image/png",
      byteLength: 5,
      sha256: "a".repeat(64),
    }],
    status: "completed" as const,
    durationMs: 5,
  };
  const withResult = recordOrdinaryToolResult({
    state: running,
    result,
    recordedAt: "2026-01-01T00:00:02.000Z",
  });

  await repository.save(withResult, 0);

  assert.deepEqual((await repository.get(withResult.runId))?.state.toolCalls[0]?.modelAttachmentRefs, result.modelAttachmentRefs);
});

test("v6 output events persist only Session entry refs instead of assistant text", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-output-ref-"));
  t.after(() => removeTestDirectory(root));
  const sessionRef = ordinaryAgentSessionRef();
  let run = state("output-ref-run", "2026-01-01T00:00:00.000Z");
  run = transitionOrdinaryRun({ state: run, transition: { type: "start" }, recordedAt: "2026-01-01T00:00:01.000Z", eventId: "event-start" });
  run = transitionOrdinaryRun({ state: run, transition: {
    type: "record_session_checkpoint",
    checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null },
  }, recordedAt: "2026-01-01T00:00:02.000Z", eventId: "checkpoint-start" });
  run = transitionOrdinaryRun({ state: run, transition: {
    type: "record_session_checkpoint",
    checkpoint: {
      kind: "input_entry_committed",
      sessionId: sessionRef.sessionId,
      inputEntryRef: { sessionId: sessionRef.sessionId, entryId: "input-entry" },
    },
  }, recordedAt: "2026-01-01T00:00:03.000Z", eventId: "checkpoint-input" });
  run = transitionOrdinaryRun({ state: run, transition: {
    type: "record_session_checkpoint",
    modelRequestId: "model-request-1",
    checkpoint: {
      kind: "assistant_response_entry_committed",
      sessionId: sessionRef.sessionId,
      assistantEntryRef: { sessionId: sessionRef.sessionId, entryId: "assistant-entry" },
    },
  }, recordedAt: "2026-01-01T00:00:04.000Z", eventId: "checkpoint-output" });

  await createFileSystemOrdinaryRunRepository(root).save(run, 0);
  const snapshot = await fs.readFile(path.join(root, "runs", "output-ref-run", "snapshot.json"), "utf8");

  assert.equal(snapshot.includes('"assistantEntryRef"'), true);
  assert.equal(snapshot.includes('"answer"'), false);
  assert.equal(snapshot.includes("回答正文不得进入 Ordinary snapshot"), false);
  assert.equal(snapshot.includes('"content"'), false);
});

test("file repository automatically migrates v5 snapshots and retains the original bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v5-migration-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("migrated-run", "2026-01-01T00:00:00.000Z");
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-start",
  });
  const completed = transitionOrdinaryRun({
    state: withResponseCandidate(running),
    transition: {
      type: "complete",
      session: executionRefs("answer-entry"),
      toolCalls: [],
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-completed",
  });
  const saved = await repository.save(completed, 0);
  const runDirectory = path.join(root, "runs", "migrated-run");
  const snapshotPath = path.join(runDirectory, "snapshot.json");
  const v5 = {
    ...saved,
    schemaVersion: "ordinary-run/v5",
    state: { ...saved.state, status: { kind: "completed", answer: "legacy answer" } },
  };
  const original = `${JSON.stringify(v5, null, 2)}\n`;
  await fs.writeFile(snapshotPath, original, "utf8");

  const restarted = createFileSystemOrdinaryRunRepository(root);
  assert.deepEqual((await restarted.list()).map((summary) => summary.runId), ["migrated-run"]);
  const migrated = await restarted.get("migrated-run");
  assert.equal(migrated?.schemaVersion, "ordinary-run/v7");
  assert.equal(migrated?.revision, saved.revision, "schema migration is not a business revision");
  assert.deepEqual(migrated?.state.status, { kind: "completed" });
  const outputEvent = migrated?.state.timeline.find((event) => event.type === "model.output.completed");
  assert.deepEqual(outputEvent?.type === "model.output.completed" ? outputEvent.assistantEntryRef : undefined, entryRef("answer-entry"));
  assert.equal(migrated?.state.timeline.at(-1)?.type, "run.completed");
  assert.equal(await fs.readFile(path.join(runDirectory, "snapshot.ordinary-run-v5.json"), "utf8"), original);

  await restarted.get("migrated-run");
  await restarted.save(migrated!.state, migrated!.revision);
  assert.equal(await fs.readFile(path.join(runDirectory, "snapshot.ordinary-run-v5.json"), "utf8"), original);
});

test("file repository migrates a nonterminal v5 snapshot without inventing output facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v5-running-migration-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const running = transitionOrdinaryRun({
    state: state("migrated-running", "2026-01-01T00:00:00.000Z"),
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-start",
  });
  const saved = await repository.save(running, 0);
  const snapshotPath = path.join(root, "runs", "migrated-running", "snapshot.json");
  await fs.writeFile(snapshotPath, JSON.stringify({ ...saved, schemaVersion: "ordinary-run/v5" }), "utf8");

  const migrated = await createFileSystemOrdinaryRunRepository(root).get("migrated-running");
  assert.equal(migrated?.schemaVersion, "ordinary-run/v7");
  assert.equal(migrated?.state.timeline.some((event) => event.type === "model.output.completed"), false);
});

test("file repository rejects historical v5 snapshots without an explicit stable memory owner", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v5-ownerless-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const saved = await repository.save(state("ownerless-v5", "2026-01-01T00:00:00.000Z"), 0);
  const snapshotPath = path.join(root, "runs", "ownerless-v5", "snapshot.json");
  const legacy = JSON.parse(JSON.stringify({ ...saved, schemaVersion: "ordinary-run/v5" })) as {
    state: { birth: { memoryOwner?: unknown; agentNoteVersions?: unknown } };
  };
  delete legacy.state.birth.memoryOwner;
  legacy.state.birth.agentNoteVersions = {
    global: `sha256:${"a".repeat(64)}`,
    workspace: `sha256:${"b".repeat(64)}`,
  };
  await fs.writeFile(snapshotPath, JSON.stringify(legacy), "utf8");

  await assert.rejects(
    () => repository.get("ownerless-v5"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError &&
      error.message.includes("lacks an explicit stable memoryOwner"),
  );
  assert.equal(await fs.readFile(snapshotPath, "utf8"), JSON.stringify(legacy));
});

test("v5 migration never overwrites a different retained snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v5-backup-conflict-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const saved = await repository.save(state("migration-conflict", "2026-01-01T00:00:00.000Z"), 0);
  const runDirectory = path.join(root, "runs", "migration-conflict");
  const snapshotPath = path.join(runDirectory, "snapshot.json");
  const original = JSON.stringify({ ...saved, schemaVersion: "ordinary-run/v5" });
  await fs.writeFile(snapshotPath, original, "utf8");
  await fs.writeFile(path.join(runDirectory, "snapshot.ordinary-run-v5.json"), "different retained bytes", "utf8");

  await assert.rejects(
    createFileSystemOrdinaryRunRepository(root).get("migration-conflict"),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError &&
      /existing v5 backup differs/u.test(error.message),
  );
  assert.equal(await fs.readFile(snapshotPath, "utf8"), original);
  assert.equal(await fs.readFile(path.join(runDirectory, "snapshot.ordinary-run-v5.json"), "utf8"), "different retained bytes");
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

test("file repository explicitly rejects ordinary-run/v3 and v6 without migration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-v2-incompatible-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const saved = await repository.save(state("v2-run", "2026-01-01T00:00:00.000Z"), 0);
  const snapshotPath = path.join(root, "runs", "v2-run", "snapshot.json");
  for (const schemaVersion of ["ordinary-run/v3", "ordinary-run/v6"] as const) {
    await fs.writeFile(snapshotPath, JSON.stringify({ ...saved, schemaVersion }), "utf8");
    await assert.rejects(
      repository.get("v2-run"),
      (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError &&
        error.message.includes("ordinary-run/v7"),
    );
  }
});

test("file repository rejects a tool catalog missing the frozen schema or hash", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-incomplete-tool-contract-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const saved = await repository.save(state("incomplete-tool-contract", "2026-01-01T00:00:00.000Z"), 0);
  const snapshotPath = path.join(root, "runs", "incomplete-tool-contract", "snapshot.json");
  const savedDocument = JSON.parse(JSON.stringify(saved)) as {
    state: { birth: { capabilitySnapshot: { toolCatalog: { tools: Array<Record<string, unknown>> } } } };
  };
  savedDocument.state.birth.capabilitySnapshot.toolCatalog.tools.push({
    name: "read",
    description: "Read a workspace file.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    definitionHash: `sha256:${"0".repeat(64)}`,
    enabled: true,
    availability: "available",
  });
  for (const field of ["inputSchema", "definitionHash"]) {
    const invalidDocument = JSON.parse(JSON.stringify(savedDocument)) as typeof savedDocument;
    delete invalidDocument.state.birth.capabilitySnapshot.toolCatalog.tools[0]![field];
    await fs.writeFile(snapshotPath, JSON.stringify(invalidDocument), "utf8");
    await assert.rejects(repository.get("incomplete-tool-contract"), (error: unknown) =>
      error instanceof OrdinaryRunSnapshotIncompatibleError && error.code === "ordinary_run_snapshot_incompatible",
    );
  }
});

test("file repository round-trips a provider-ordered pending Session tool round", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-pending-session-round-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = state("pending-session-round", "2026-01-01T00:00:00.000Z");
  const running = transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-2",
  });
  const rollbackable = withInputEntry(running);
  const pending = transitionOrdinaryRun({
    state: rollbackable,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "assistant_tool_call_entry_committed",
      sessionId: "agent-session-1",
      assistantEntryRef: entryRef("assistant-tools"),
      toolCallIds: ["call-2", "call-1"],
    } },
    recordedAt: "2026-01-01T00:00:01.300Z",
    eventId: "checkpoint-tools",
  });
  await repository.save(pending, 0);
  assert.deepEqual((await repository.get(pending.runId))?.state.pendingToolRound, {
    assistantEntryRef: entryRef("assistant-tools"),
    toolCallIds: ["call-2", "call-1"],
  });
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

test("file repository round-trips optional latest Agent request usage and rejects invalid values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-latest-request-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const withLatestRequest = {
    ...state("latest-request-run", "2026-01-01T00:00:00.000Z"),
    usage: {
      requestCount: 11,
      inputTokens: 411_553,
      latestAgentRequest: {
        inputTokens: 60_000,
        outputTokens: 1_000,
        totalTokens: 61_000,
        cachedInputTokens: 50_000,
        uncachedInputTokens: 10_000,
      },
    },
  };

  await repository.save(withLatestRequest, 0);
  assert.deepEqual((await repository.get(withLatestRequest.runId))?.state.usage, withLatestRequest.usage);
  await assert.rejects(
    repository.save({
      ...state("invalid-latest-request", "2026-01-01T00:00:01.000Z"),
      usage: { latestAgentRequest: { inputTokens: -1 } },
    }, 0),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );
});

test("file repository restores v6 snapshots with or without optional tool metrics", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-tool-metrics-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const withoutMetrics = state("without-tool-metrics", "2026-01-01T00:00:00.000Z");
  await repository.save(withoutMetrics, 0);
  assert.equal((await repository.get(withoutMetrics.runId))?.state.toolMetrics, undefined);

  const collector = new OrdinaryToolMetricsCollector();
  collector.record({
    kind: "execution",
    toolName: "read",
    operationType: "read-only",
    status: "completed",
    rawBodyTokens: 120,
    rawEnvelopeTokens: 180,
    finalEnvelopeTokens: 180,
  });
  collector.record({
    kind: "execution",
    toolName: "shell",
    operationType: "execute",
    status: "completed",
    rawBodyTokens: 20,
    rawEnvelopeTokens: 40,
    finalEnvelopeTokens: 40,
  });
  const withMetrics = {
    ...state("with-tool-metrics", "2026-01-01T00:00:01.000Z"),
    toolMetrics: collector.snapshot(),
  };
  await repository.save(withMetrics, 0);
  assert.deepEqual((await repository.get(withMetrics.runId))?.state.toolMetrics, withMetrics.toolMetrics);

  await assert.rejects(
    repository.save({ ...state("invalid-tool-metrics", "2026-01-01T00:00:02.000Z"), toolMetrics: { schemaVersion: "ordinary-tool-metrics/v1" } } as never, 0),
    (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError,
  );
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
    state: withResponseCandidate(running),
    transition: {
      type: "complete",
      session: executionRefs("answer-entry"),
      toolCalls: [],
      usage: { requestCount: 2, inputTokens: 4, outputTokens: 1, totalTokens: 5 },
      capabilityResolution: resolution,
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  await repository.save(completed, started.revision);
  const restored = (await repository.get("capability-run"))?.state;
  assert.deepEqual(restored?.capabilityResolution, resolution);
  assert.equal(restored?.usage.requestCount, 2);

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
  const parents = ["parent-a", "parent-b"];
  const rootToolCalls = parents.map((parent) => ({
    callId: parent,
    toolName: "agent_call",
    input: { agentId: parent },
    output: { answer: parent },
    status: "completed" as const,
    delegatedExecution: {
      modelRounds: 2,
      toolCallCount: 1,
      usage: { requestCount: 2, inputTokens: 18, outputTokens: 7, totalTokens: 25 },
    },
    durationMs: 2,
  }));
  const nestedToolCalls = parents.map((parent) => ({
    callId: "shared-provider-call",
    factId: `agent-tool:${parent.length}:${parent}/tool:shared-provider-call`,
    parentToolCallFactId: parent,
    toolName: "read_fact",
    input: { parent },
    ...(parent === "parent-a"
      ? {
          output: undefined,
          status: "failed" as const,
          error: "The nested tool executed and failed.",
          failureAttribution: "execution_failure" as const,
        }
      : { output: { value: parent }, status: "completed" as const }),
    durationMs: 1,
  }));
  const toolCalls = [...rootToolCalls, ...nestedToolCalls];
  const completed = transitionOrdinaryRun({
    state: withResponseCandidate(running),
    transition: {
      type: "complete",
      session: executionRefs("answer-entry"),
      toolCalls,
      usage: {},
    },
    recordedAt: "2026-01-01T00:00:02.000Z",
    eventId: "event-3",
  });

  const saved = await repository.save(completed, started.revision);
  const persistedToolCalls = (await repository.get("scoped-tool-run"))?.state.toolCalls;
  assert.equal(persistedToolCalls?.length, 4);
  assert.equal(persistedToolCalls?.[2]?.factId, nestedToolCalls[0]?.factId);
  assert.equal(persistedToolCalls?.[2]?.status, "failed");
  assert.equal(persistedToolCalls?.[2]?.failureAttribution, "execution_failure");
  assert.equal(persistedToolCalls?.[2]?.output, undefined);
  assert.deepEqual(persistedToolCalls?.[0]?.delegatedExecution, rootToolCalls[0]?.delegatedExecution);
  assert.equal(Object.keys(saved.state.toolResultRecordedAt).length, 4);
});

test("file repository rejects malformed or orphaned nested tool fact graphs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-invalid-nested-facts-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const rootResult = {
    callId: "delegation-call",
    toolName: "agent_call",
    input: { agentId: "reviewer" },
    output: { answer: "reviewed" },
    status: "completed" as const,
    durationMs: 2,
  };
  const nestedResult = {
    callId: "read-call",
    factId: "delegation-call/tool:read-call",
    parentToolCallFactId: "delegation-call",
    toolName: "read",
    input: { path: "README.md" },
    output: { content: "contents" },
    status: "completed" as const,
    durationMs: 1,
  };
  const cases = [
    [{ ...nestedResult, parentToolCallFactId: "missing-root" }],
    [rootResult, { ...nestedResult, factId: undefined }],
    [rootResult, nestedResult, {
      ...nestedResult,
      callId: "nested-child",
      factId: "delegation-call/tool:nested-child",
      parentToolCallFactId: nestedResult.factId,
    }],
    [rootResult, { ...nestedResult, parentToolCallFactId: undefined }],
  ];

  for (const [index, toolCalls] of cases.entries()) {
    const invalid = {
      ...state(`invalid-nested-facts-${index}`, "2026-01-01T00:00:00.000Z"),
      toolCalls,
      toolResultRecordedAt: Object.fromEntries(toolCalls.map((result) => [
        `${"factId" in result && result.factId !== undefined ? result.factId : result.callId}:${result.status}`,
        "2026-01-01T00:00:01.000Z",
      ])),
    };
    await assert.rejects(
      repository.save(invalid, 0),
      (error: unknown) => error instanceof OrdinaryRunSnapshotIncompatibleError &&
        /nested tool (?:fact|result)|known root tool fact|root tool fact/u.test(error.message),
    );
  }
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
    sessionRef: ordinaryAgentSessionRef(),
    turn: ordinaryRunTurn(runId),
    runInput: { userMessage: "hello" },
    birth: ordinaryRunBirth(),
    recordedAt,
    eventId: "event-1",
  });
}

function entryRef(entryId: string) {
  return { sessionId: "agent-session-1", entryId };
}

function executionRefs(latestEntryId: string) {
  return {
    sessionId: "agent-session-1",
    startLeafRef: null,
    inputEntryRef: entryRef("input-entry"),
    safeLeafRef: entryRef("input-entry"),
    latestLeafRef: entryRef(latestEntryId),
    compactionEntryRefs: [],
  };
}

function withResponseCandidate(stateValue: ReturnType<typeof transitionOrdinaryRun>) {
  const input = withInputEntry(stateValue);
  return transitionOrdinaryRun({
    state: input,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "assistant_response_entry_committed", sessionId: "agent-session-1", assistantEntryRef: entryRef("answer-entry"),
    } },
    recordedAt: "2026-01-01T00:00:01.300Z",
    eventId: "checkpoint-response",
  });
}

function withInputEntry(stateValue: ReturnType<typeof transitionOrdinaryRun>) {
  const started = transitionOrdinaryRun({
    state: stateValue,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "start_leaf_captured", sessionId: "agent-session-1", startLeafRef: null,
    } },
    recordedAt: "2026-01-01T00:00:01.100Z",
    eventId: "checkpoint-start",
  });
  return transitionOrdinaryRun({
    state: started,
    transition: { type: "record_session_checkpoint", checkpoint: {
      kind: "input_entry_committed", sessionId: "agent-session-1", inputEntryRef: entryRef("input-entry"),
    } },
    recordedAt: "2026-01-01T00:00:01.200Z",
    eventId: "checkpoint-input",
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
