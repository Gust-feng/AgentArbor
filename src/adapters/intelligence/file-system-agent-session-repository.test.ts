import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { SessionError } from "@earendil-works/pi-agent-core";
import {
  AgentSessionRepositoryError,
  FileSystemAgentSessionRepository,
} from "./file-system-agent-session-repository.js";
import { SessionGenerationError } from "./session-write-fence.js";

test("file-system agent session repository restores the active leaf through a stable ref", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const firstLease = await fixture.repository.acquire(ref);
  const userEntryId = await firstLease.session.appendMessage({
    role: "user",
    content: "hello",
    timestamp: 1,
  });
  await firstLease.release();

  const reopenedRepository = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const reopened = await reopenedRepository.acquire(ref);

  assert.equal(await reopened.session.getLeafId(), userEntryId);
  const metadata = await reopened.session.getMetadata();
  assert.equal(metadata.id, ref.sessionId);
  assert.equal(metadata.cwd, ref.sessionCwd);
  assert.equal(metadata.path, path.join(fixture.sessionsRoot, ...ref.storageKey.split("/")));
  assert.equal(metadata.createdAt, ref.createdAt);
  await reopened.release();
});

test("file-system agent session repository enforces one active writer per session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const firstLease = await fixture.repository.acquire(ref);

  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_writer_active",
  );

  await firstLease.release();
  const nextLease = await fixture.repository.acquire(ref);
  await nextLease.release();
});

test("file-system agent session repository reads the active branch while its writer remains leased", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const writer = await fixture.repository.acquire(ref);
  const userEntryId = await writer.session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
  const assistantEntryId = await writer.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "README.md" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });

  assert.deepEqual(await fixture.repository.getActiveBranchEntryRefs(ref), [
    { sessionId: ref.sessionId, entryId: userEntryId },
    { sessionId: ref.sessionId, entryId: assistantEntryId },
  ]);
  assert.deepEqual(await fixture.repository.getActiveLeaf(ref), {
    sessionId: ref.sessionId,
    entryId: assistantEntryId,
  });
  assert.deepEqual(await fixture.repository.readToolCalls({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
  }), [{ callId: "call-1", toolName: "read_file", input: { path: "README.md" } }]);

  await writer.release();
});

test("file-system agent session repository moves the active leaf without deleting the abandoned branch", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const initial = await fixture.repository.acquire(ref);
  const firstEntryId = await initial.session.appendMessage({ role: "user", content: "one", timestamp: 1 });
  const abandonedEntryId = await initial.session.appendMessage({ role: "user", content: "two", timestamp: 2 });
  await initial.release();

  const moved = await fixture.repository.moveActiveLeaf(ref, { sessionId: ref.sessionId, entryId: firstEntryId });
  assert.deepEqual(moved, { sessionId: ref.sessionId, entryId: firstEntryId });
  assert.deepEqual(await fixture.repository.getActiveLeaf(ref), moved);

  const branch = await fixture.repository.acquire(ref);
  const replacementEntryId = await branch.session.appendMessage({ role: "user", content: "branch", timestamp: 3 });
  assert.equal((await branch.session.getEntry(abandonedEntryId))?.type, "message");
  assert.equal((await branch.session.getEntry(replacementEntryId))?.parentId, firstEntryId);
  await branch.release();
});

test("file-system agent session repository reopens the restored branch for a successor generation", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const oldLease = await fixture.repository.acquire(ref);
  const safeLeafId = await oldLease.session.appendCustomEntry("safe");
  const abandonedLeafId = await oldLease.session.appendCustomEntry("abandoned");

  await oldLease.revokeTo({ sessionId: ref.sessionId, entryId: safeLeafId });
  const nextLease = await fixture.repository.acquire(ref);
  assert.notEqual(nextLease.session.getStorage(), oldLease.session.getStorage());
  assert.equal(await nextLease.session.getLeafId(), safeLeafId);
  const successorLeafId = await nextLease.session.appendCustomEntry("successor");
  assert.equal((await nextLease.session.getEntry(successorLeafId))?.parentId, safeLeafId);
  assert.equal((await nextLease.session.getEntry(abandonedLeafId))?.type, "custom");

  await assert.rejects(
    oldLease.session.appendCustomEntry("late-old-write"),
    (error: unknown) => error instanceof SessionGenerationError && error.code === "generation_revoked",
  );
  await oldLease.release();
  assert.equal(await nextLease.session.getLeafId(), successorLeafId);
  await nextLease.release();
});

test("file-system agent session repository rejects a revoke target from another session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);

  await assert.rejects(
    lease.revokeTo({ sessionId: "another-session", entryId: "entry" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_ref_invalid",
  );
  await lease.release();
});

test("file-system agent session repository reads active tool calls and reconciles missing results idempotently", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "call-1", name: "read_file", arguments: { path: "README.md" } },
      { type: "toolCall", id: "call-2", name: "list_dir", arguments: { path: "." } },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  await lease.release();
  const assistantEntryRef = { sessionId: ref.sessionId, entryId: assistantEntryId };

  assert.deepEqual(await fixture.repository.readToolCalls({ sessionRef: ref, assistantEntryRef }), [
    { callId: "call-1", toolName: "read_file", input: { path: "README.md" } },
    { callId: "call-2", toolName: "list_dir", input: { path: "." } },
  ]);
  const orderedResults = [
    { callId: "call-1", toolName: "read_file", input: { path: "README.md" }, output: { content: "read" }, status: "completed" as const, durationMs: 1 },
    { callId: "call-2", toolName: "list_dir", input: { path: "." }, output: ["src"], status: "completed" as const, durationMs: 1 },
  ];
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[0]!, orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /unique root tool results/u.test(error.message),
  );
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /tool-call order/u.test(error.message),
  );
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[1]!, orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /tool-call order/u.test(error.message),
  );
  const reconciled = await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  const firstBranch = await fixture.repository.getActiveBranchEntryRefs(ref);
  assert.equal(firstBranch.at(-1)?.entryId, reconciled.entryId);
  assert.equal(firstBranch.length, 3);

  const repeated = await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  assert.deepEqual(repeated, reconciled);
  assert.deepEqual(await fixture.repository.getActiveBranchEntryRefs(ref), firstBranch);
});

test("file-system agent session repository surfaces malformed JSONL instead of opening a partial session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const filePath = path.join(fixture.sessionsRoot, ...ref.storageKey.split("/"));
  const appendResult = await fixture.fileSystem.appendFile(filePath, "not-json\n");
  assert.equal(appendResult.ok, true);

  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof SessionError && error.code === "invalid_entry",
  );
});

test("file-system agent session repository rejects a JSONL branch with a missing parent", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const filePath = path.join(fixture.sessionsRoot, ...ref.storageKey.split("/"));
  const appendResult = await fixture.fileSystem.appendFile(filePath, `${JSON.stringify({
    type: "custom",
    id: "orphan-entry",
    parentId: "missing-parent",
    timestamp: new Date().toISOString(),
    customType: "test",
  })}\n`);
  assert.equal(appendResult.ok, true);

  const lease = await fixture.repository.acquire(ref);
  await assert.rejects(
    lease.session.getBranch(),
    (error: unknown) => error instanceof SessionError && error.code === "invalid_session" &&
      /missing-parent/u.test(error.message),
  );
  await lease.release();
});

test("file-system agent session repository restores a pending tool branch after rollback", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const safeEntryId = await lease.session.appendMessage({ role: "user", content: "write", timestamp: 1 });
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "write_file", arguments: { path: "a.txt" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  await lease.revokeTo({ sessionId: ref.sessionId, entryId: safeEntryId });
  await lease.release();

  const restarted = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const reconciled = await restarted.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
    recoveryLeafRef: { sessionId: ref.sessionId, entryId: safeEntryId },
    orderedResults: [{
      callId: "call-1",
      toolName: "write_file",
      input: { path: "a.txt" },
      output: undefined,
      status: "failed",
      error: "Execution outcome is unknown after restart.",
      errorFacts: { code: "tool_execution_outcome_unknown" },
      durationMs: 0,
    }],
  });

  assert.deepEqual(await restarted.getActiveBranchEntryRefs(ref), [
    { sessionId: ref.sessionId, entryId: safeEntryId },
    { sessionId: ref.sessionId, entryId: assistantEntryId },
    reconciled,
  ]);
});

test("file-system agent session repository refuses to revive a stale tool branch", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const safeEntryId = await lease.session.appendMessage({ role: "user", content: "write", timestamp: 1 });
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "write_file", arguments: { path: "a.txt" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  await lease.revokeTo({ sessionId: ref.sessionId, entryId: safeEntryId });
  await lease.release();
  const successor = await fixture.repository.acquire(ref);
  await successor.session.appendMessage({ role: "user", content: "new branch", timestamp: 3 });
  await successor.release();

  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
      recoveryLeafRef: { sessionId: ref.sessionId, entryId: safeEntryId },
      orderedResults: [{
        callId: "call-1",
        toolName: "write_file",
        input: { path: "a.txt" },
        output: undefined,
        status: "failed",
        durationMs: 0,
      }],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /recovery leaf does not match/u.test(error.message),
  );
});

test("file-system agent session repository rejects traversal and forged metadata", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });

  await assert.rejects(
    fixture.repository.acquire({ ...ref, storageKey: "../outside.jsonl" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_ref_invalid",
  );
  await assert.rejects(
    fixture.repository.acquire({ ...ref, sessionId: "forged-session" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_metadata_mismatch",
  );
});

test("file-system agent session repository delete is idempotent and refuses an active writer", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);

  await assert.rejects(
    fixture.repository.delete(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_writer_active",
  );
  await lease.release();
  await fixture.repository.delete(ref);
  await fixture.repository.delete(ref);
  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_not_found",
  );
});

async function repositoryFixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-session-repository-"));
  const sessionsRoot = path.join(root, "sessions");
  const workspace = path.join(root, "workspace");
  const fileSystem = new NodeExecutionEnv({ cwd: root });
  const repository = new FileSystemAgentSessionRepository({ fileSystem, sessionsRoot });
  t.after(async () => {
    await fileSystem.cleanup();
    await rm(root, { recursive: true, force: true });
  });
  return { fileSystem, repository, sessionsRoot, workspace };
}
