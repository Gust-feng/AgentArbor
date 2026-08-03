import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { OrdinaryFeatureError, type OrdinaryExecutionOutcome, type OrdinaryExecutionPort, type OrdinaryFeatureDiagnostic, type OrdinaryRunRepository, type OrdinaryRunState } from "./contracts.js";
import { createFileSystemOrdinaryConversationControlRepository } from "./conversation-control-repository.js";
import { createFileSystemOrdinaryRunRepository } from "./file-system-repository.js";
import { createOrdinaryAgentFeature } from "./ordinary-agent-feature.js";
import { ordinaryAgentSessionRef, ordinaryRunBirth } from "./test-support.js";
import type { AgentSessionEntryRef, AgentSessionExecutionRefs, AgentSessionRef, AgentSessionRepository } from "../model-runtime/agent-session.js";

test("submitTurn serializes queued turns from the active Session branch", async (t) => {
  const firstStarted = createGate();
  const releaseFirst = createGate();
  const observed: Array<{ readonly message: string; readonly startLeaf: string | null }> = [];
  const run = await fixture(t, {
    async execute(input) {
      const startLeaf = await run.sessions.getActiveLeaf(input.sessionRef);
      observed.push({ message: input.runInput.userMessage, startLeaf: startLeaf?.entryId ?? null });
      const prepared = await prepareSession(input, run.sessions);
      if (input.runInput.userMessage === "first") {
        firstStarted.enter();
        await releaseFirst.released;
      }
      return complete(input, run.sessions, `answer:${input.runInput.userMessage}`, prepared);
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  await firstStarted.entered;
  const second = await run.feature.commands.submitTurn({ conversationId: first.conversation.conversationId, input: { userMessage: "second" }, birth: ordinaryRunBirth() });
  assert.equal(second.run.status.kind, "queued");
  assert.equal(second.run.turn.predecessorRunId, first.run.runId);
  releaseFirst.release();
  await waitForStatus(run.feature, first.run.runId, "completed");
  await waitForStatus(run.feature, second.run.runId, "completed");
  assert.deepEqual(observed.map((item) => item.message), ["first", "second"]);
  assert.equal(observed[1]?.startLeaf, `${first.run.runId}-answer`);
  assert.deepEqual((await run.feature.queries.getConversation(first.conversation.conversationId))?.turns.map((turn) => turn.content), ["first", "answer:first", "second", "answer:second"]);
});

test("failed first submission removes an uncommitted conversation birth so the same submission can retry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-conversation-birth-cleanup-"));
  const sessions = new SessionHarness();
  const durableRepository = createFileSystemOrdinaryRunRepository(root);
  let failInitialSave = true;
  const repository: OrdinaryRunRepository = {
    ...durableRepository,
    async save(state, expectedRevision) {
      if (failInitialSave && expectedRevision === 0) {
        failInitialSave = false;
        throw new Error("initial run snapshot unavailable");
      }
      return durableRepository.save(state, expectedRevision);
    },
  };
  const conversationRepository = createFileSystemOrdinaryConversationControlRepository(root);
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository,
    execution: immediateExecution(sessions),
    sessionRepository: sessions,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  const request = {
    submissionId: "birth-cleanup-retry",
    input: { userMessage: "retry this submission" },
    birth: ordinaryRunBirth(),
  };
  await assert.rejects(feature.commands.submitTurn(request), /initial run snapshot unavailable/u);
  assert.equal(await conversationRepository.get("conversation:birth-cleanup-retry"), undefined);
  assert.equal(sessions.deleted.length, 1);

  const retried = await feature.commands.submitTurn(request);
  const completed = await waitForStatus(feature, retried.run.runId, "completed");
  assert.equal(completed.status.kind, "completed");
});

test("conversation projection reads completed Session answers in one batch", async (t) => {
  const run = await fixture(t, immediateExecution);
  const first = await submitAndComplete(run.feature, undefined, "one");
  const second = await submitAndComplete(run.feature, first.conversation.conversationId, "two");
  const third = await submitAndComplete(run.feature, first.conversation.conversationId, "three");
  run.sessions.assistantEntryReadBatches.length = 0;

  const conversation = await run.feature.queries.getConversation(first.conversation.conversationId);

  assert.deepEqual(conversation?.turns.filter((turn) => turn.role === "assistant").map((turn) => turn.content), [
    "answer:one",
    "answer:two",
    "answer:three",
  ]);
  assert.deepEqual(run.sessions.assistantEntryReadBatches, [[
    `${first.run.runId}-answer`,
    `${second.run.runId}-answer`,
    `${third.run.runId}-answer`,
  ]]);
});

test("a cancelled queued middle turn does not hide or block its successor", async (t) => {
  const firstStarted = createGate();
  const releaseFirst = createGate();
  const observed: string[] = [];
  const run = await fixture(t, {
    async execute(input) {
      observed.push(input.runInput.userMessage);
      const session = await prepareSession(input, run.sessions);
      if (input.runInput.userMessage === "first") {
        firstStarted.enter();
        await Promise.race([releaseFirst.released, waitForAbort(input.abortSignal)]);
      }
      return complete(input, run.sessions, `answer:${input.runInput.userMessage}`, session);
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  await firstStarted.entered;
  const second = await run.feature.commands.submitTurn({ conversationId: first.conversation.conversationId, input: { userMessage: "second" }, birth: ordinaryRunBirth() });
  const third = await run.feature.commands.submitTurn({ conversationId: first.conversation.conversationId, input: { userMessage: "third" }, birth: ordinaryRunBirth() });
  await run.feature.commands.cancel(second.run.runId, "cancel_middle");
  releaseFirst.release();
  await waitForStatus(run.feature, first.run.runId, "completed");
  await waitForStatus(run.feature, third.run.runId, "completed");
  assert.deepEqual(observed, ["first", "third"]);
  assert.equal((await run.feature.queries.getRun(second.run.runId))?.status.kind, "cancelled");
  assert.equal((await run.feature.queries.getRun(third.run.runId))?.status.kind, "completed");
  assert.deepEqual(
    (await run.feature.queries.getConversation(first.conversation.conversationId))?.turns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content),
    ["first", "third"],
  );
});

test("conversation rename and pin persist control state without copying transcript facts", async (t) => {
  const run = await fixture(t, immediateExecution);
  const submitted = await run.feature.commands.submitTurn({ input: { userMessage: "private input" }, birth: ordinaryRunBirth() });
  await waitForStatus(run.feature, submitted.run.runId, "completed");
  const conversationId = submitted.conversation.conversationId;
  await run.feature.commands.renameConversation(conversationId, "  Renamed   conversation  ");
  await run.feature.commands.setConversationPinned(conversationId, true);
  await run.feature.release();
  const raw = await fs.readFile(path.join(run.root, "conversations", encodeURIComponent(conversationId), "snapshot.json"), "utf8");
  assert.equal(raw.includes("private input"), false);
  assert.equal(raw.includes("answer:private input"), false);
  const restarted = createOrdinaryAgentFeature({ repository: createFileSystemOrdinaryRunRepository(run.root), conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root), sessionRepository: run.sessions, execution: immediateExecution(run.sessions) });
  t.after(() => restarted.release());
  const restored = await restarted.queries.getConversation(conversationId);
  assert.equal(restored?.title, "Renamed conversation");
  assert.equal(restored?.pinnedAt !== undefined, true);
  assert.equal(restored?.turns[1]?.content, "answer:private input");
});

test("rollback moves the Session active branch and survives restart without lineage metadata", async (t) => {
  const run = await fixture(t, immediateExecution);
  const first = await submitAndComplete(run.feature, undefined, "one");
  const second = await submitAndComplete(run.feature, first.conversation.conversationId, "two");
  await submitAndComplete(run.feature, first.conversation.conversationId, "three");
  const conversationId = first.conversation.conversationId;
  const rolledBack = await run.feature.commands.rollbackConversation({ conversationId, targetRunId: first.run.runId });
  assert.deepEqual(rolledBack.turns.filter((turn) => turn.role === "user").map((turn) => turn.content), ["one"]);
  const branch = await submitAndComplete(run.feature, conversationId, "branch");
  assert.equal(branch.run.turn.predecessorRunId, first.run.runId);
  await run.feature.release();
  const restarted = createOrdinaryAgentFeature({ repository: createFileSystemOrdinaryRunRepository(run.root), conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root), sessionRepository: run.sessions, execution: immediateExecution(run.sessions) });
  t.after(() => restarted.release());
  const restored = await restarted.queries.getConversation(conversationId);
  assert.deepEqual(restored?.turns.filter((turn) => turn.role === "user").map((turn) => turn.content), ["one", "branch"]);
  assert.equal(restored?.latestRunId, branch.run.runId);
  assert.notEqual(branch.run.runId, second.run.runId);
});

test("rollback refuses to revive a cancelled queued turn that never entered the Session", async (t) => {
  const firstStarted = createGate();
  const releaseFirst = createGate();
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions);
      if (input.runInput.userMessage === "first") {
        firstStarted.enter();
        await releaseFirst.released;
      }
      return complete(input, run.sessions, `answer:${input.runInput.userMessage}`, session);
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  await firstStarted.entered;
  const cancelled = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "cancelled" },
    birth: ordinaryRunBirth(),
  });
  await run.feature.commands.cancel(cancelled.run.runId, "cancelled_by_user");
  releaseFirst.release();
  await waitForStatus(run.feature, first.run.runId, "completed");

  await assert.rejects(
    run.feature.commands.rollbackConversation({
      conversationId: first.conversation.conversationId,
      targetRunId: first.run.runId,
    }),
    (error: unknown) => error instanceof OrdinaryFeatureError && error.code === "ordinary_run_state_conflict",
  );
  assert.equal((await run.sessions.getActiveLeaf(first.run.sessionRef))?.entryId, `${first.run.runId}-answer`);
});

test("deleteConversation returns after tombstoning when execution ignores cancellation", async (t) => {
  const started = createGate();
  let finishExecution!: () => void;
  const run = await fixture(t, {
    async execute(input) {
      run.sessions.ensure(input.sessionRef);
      started.enter();
      return new Promise<OrdinaryExecutionOutcome>((resolve) => {
        finishExecution = () => resolve({
          status: "cancelled",
          reason: "late cancellation settlement",
          toolCalls: [],
          usage: {},
        });
      });
    },
  });
  const submitted = await run.feature.commands.submitTurn({
    input: { userMessage: "ignore cancellation" },
    birth: ordinaryRunBirth(),
  });
  await started.entered;

  const deletion = run.feature.commands.deleteConversation(submitted.conversation.conversationId);
  let timeout: NodeJS.Timeout | undefined;
  const returnedBeforeExecution = await Promise.race([
    deletion.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 1_000);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);

  assert.equal(returnedBeforeExecution, true);
  assert.equal(await run.feature.queries.getConversation(submitted.conversation.conversationId), undefined);
  assert.equal(await run.feature.queries.getRun(submitted.run.runId), undefined);
  assert.equal(await run.feature.queries.getStableTerminalRunFacts(submitted.run.runId), undefined);
  assert.equal(await run.feature.events.replay(submitted.run.runId), undefined);
  assert.deepEqual(await run.feature.queries.listRuns(Number.MAX_SAFE_INTEGER), []);

  finishExecution();
  await deletion;
  await waitForCondition(() => run.sessions.deleted.length === 1);
});

test("deleteConversation survives run enumeration failure after the tombstone commit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-delete-enumeration-"));
  const sessions = new SessionHarness();
  const baseRepository = createFileSystemOrdinaryRunRepository(root);
  const enumerationError = new Error("run enumeration unavailable");
  let failRunEnumeration = false;
  const repository = {
    ...baseRepository,
    async list(limit?: number) {
      if (failRunEnumeration) throw enumerationError;
      return baseRepository.list(limit);
    },
  };
  const diagnostics: OrdinaryFeatureDiagnostic[] = [];
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: immediateExecution(sessions),
    sessionRepository: sessions,
    onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  const completed = await submitAndComplete(feature, undefined, "delete despite failed enumeration");
  const conversationId = completed.conversation.conversationId;
  const runId = completed.run.runId;

  failRunEnumeration = true;
  await feature.commands.deleteConversation(conversationId);

  assert.equal(await feature.queries.getConversation(conversationId), undefined);
  assert.equal(await feature.queries.getRun(runId), undefined);
  assert.equal(await feature.events.replay(runId), undefined);
  await waitForCondition(() => sessions.deleteAttempts.length === 1 && diagnostics.length === 1);
  assert.equal(await baseRepository.get(runId), undefined);
  assert.deepEqual(diagnostics, [{
    kind: "conversation_cleanup_failed",
    conversationId,
    phase: "run_enumeration",
    error: enumerationError,
  }]);
});

test("conversation cleanup retries one transient evidence failure without restart", async (t) => {
  let evidenceAttempts = 0;
  const run = await fixture(t, immediateExecution, async () => {
    evidenceAttempts += 1;
    if (evidenceAttempts === 1) throw new Error("transient evidence failure");
  });
  const completed = await submitAndComplete(run.feature, undefined, "retry cleanup in process");
  const conversationId = completed.conversation.conversationId;
  const repository = createFileSystemOrdinaryRunRepository(run.root);

  await run.feature.commands.deleteConversation(conversationId);
  await waitForCondition(() => evidenceAttempts >= 2 && run.sessions.deleteAttempts.length >= 2);

  assert.equal(await repository.get(completed.run.runId), undefined);
  assert.equal(await run.feature.queries.getConversation(conversationId), undefined);
  assert.equal(run.sessions.deleted.length, 1);
});

test("startup finalizes tombstoned conversations without recovering their runs", async (t) => {
  const releasedEvidence: string[] = [];
  const run = await fixture(t, {
    execute: async (input) => complete(input, run.sessions, "done"),
  }, (ownerId) => { releasedEvidence.push(ownerId); });
  const first = await submitAndComplete(run.feature, undefined, "first deleted turn");
  const second = await submitAndComplete(run.feature, first.conversation.conversationId, "second deleted turn");
  const controls = createFileSystemOrdinaryConversationControlRepository(run.root);
  const conversationId = first.conversation.conversationId;
  const control = await controls.get(conversationId);
  assert.ok(control !== undefined);

  await run.feature.release();
  await controls.save(
    { ...control.state, deletedAt: "2026-08-02T01:00:00.000Z" },
    control.revision,
    "2026-08-02T01:00:00.000Z",
  );

  const diagnostics: string[] = [];
  const restarted = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(run.root),
    conversationRepository: controls,
    execution: { async execute() { throw new Error("deleted runs must not execute"); } },
    sessionRepository: run.sessions,
    releaseToolEvidenceOwner: async (ownerId) => { releasedEvidence.push("restart:" + ownerId); },
    onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic.kind); },
  });
  assert.deepEqual(await restarted.queries.listConversations(), []);
  assert.equal(await restarted.queries.getRun(first.run.runId), undefined);
  assert.equal(await restarted.queries.getRun(second.run.runId), undefined);
  assert.deepEqual(releasedEvidence.sort(), [
    "restart:" + first.run.runId,
    "restart:" + second.run.runId,
  ].sort());
  assert.deepEqual(run.sessions.deleted, [control.state.sessionRef.sessionId]);
  assert.equal(diagnostics.includes("conversation_unavailable"), false);
  await restarted.release();
});

test("startup retries cleanup that remained blocked by tool evidence release", async (t) => {
  const evidenceFailure = new Error("tool evidence release failed once");
  const evidenceAttempts: string[] = [];
  const diagnostics: OrdinaryFeatureDiagnostic[] = [];
  let allowEvidenceRelease = false;
  const run = await fixture(t, immediateExecution, async (ownerId) => {
    evidenceAttempts.push(ownerId);
    if (!allowEvidenceRelease) throw evidenceFailure;
  }, (diagnostic) => { diagnostics.push(diagnostic); });
  const completed = await submitAndComplete(run.feature, undefined, "delete and retry cleanup");
  const conversationId = completed.conversation.conversationId;
  const runId = completed.run.runId;
  const sessionId = completed.run.sessionRef.sessionId;
  const repository = createFileSystemOrdinaryRunRepository(run.root);

  await run.feature.commands.deleteConversation(conversationId);

  assert.equal(await run.feature.queries.getConversation(conversationId), undefined);
  assert.deepEqual(await run.feature.queries.listConversations(), []);
  assert.equal(await run.feature.queries.getRun(runId), undefined);
  assert.deepEqual(await run.feature.queries.listRuns(Number.MAX_SAFE_INTEGER), []);
  assert.equal(await run.feature.queries.getStableTerminalRunFacts(runId), undefined);
  assert.equal(await run.feature.events.replay(runId), undefined);
  await waitForCondition(() => run.sessions.deleteAttempts.length >= 1);
  assert.equal(evidenceAttempts.length >= 1, true);
  assert.equal(evidenceAttempts.every((ownerId) => ownerId === runId), true);
  assert.equal(diagnostics.every((diagnostic) => diagnostic.kind === "conversation_cleanup_failed" &&
    diagnostic.conversationId === conversationId &&
    diagnostic.phase === "tool_evidence" &&
    diagnostic.runId === runId &&
    diagnostic.error === evidenceFailure), true);
  assert.notEqual(await repository.get(runId), undefined);

  await run.feature.release();
  const evidenceAttemptsBeforeRestart = evidenceAttempts.length;
  const sessionAttemptsBeforeRestart = run.sessions.deleteAttempts.length;
  let restartedExecutions = 0;
  let restartedEvidenceAttempts = 0;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root),
    execution: {
      async execute() {
        restartedExecutions += 1;
        throw new Error("tombstoned runs must not execute");
      },
    },
    sessionRepository: run.sessions,
    releaseToolEvidenceOwner: async (ownerId) => {
      evidenceAttempts.push(ownerId);
      restartedEvidenceAttempts += 1;
      if (restartedEvidenceAttempts === 1) throw evidenceFailure;
    },
    onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); },
  });

  assert.deepEqual(await restarted.queries.listConversations(), []);
  assert.equal(await restarted.queries.getRun(runId), undefined);
  assert.equal(await restarted.events.replay(runId), undefined);
  assert.equal(restartedExecutions, 0);
  await waitForCondition(() => restartedEvidenceAttempts >= 2 &&
    run.sessions.deleteAttempts.length >= sessionAttemptsBeforeRestart + 2);
  assert.equal(evidenceAttempts.length, evidenceAttemptsBeforeRestart + 2);
  assert.equal(await repository.get(runId), undefined);
  assert.deepEqual(run.sessions.deleteAttempts, Array(sessionAttemptsBeforeRestart + 2).fill(sessionId));
  assert.equal(diagnostics.length, evidenceAttemptsBeforeRestart + 1);
  await restarted.release();
});


test("deleteConversation removes Session and tool evidence after writing a tombstone", async (t) => {
  const releasedEvidence: string[] = [];
  const run = await fixture(t, {
    execute: async (input) => complete(input, run.sessions, "done"),
  }, (ownerId) => { releasedEvidence.push(ownerId); });
  const first = await submitAndComplete(run.feature, undefined, "delete me");
  const second = await submitAndComplete(run.feature, first.conversation.conversationId, "second");
  const conversationId = first.conversation.conversationId;
  const controlBeforeDelete = await createFileSystemOrdinaryConversationControlRepository(run.root).get(conversationId);
  await run.feature.commands.deleteConversation(conversationId);
  await run.feature.commands.deleteConversation(conversationId);
  await waitForCondition(() => releasedEvidence.length === 2 && run.sessions.deleted.length === 1);
  assert.equal(await run.feature.queries.getConversation(conversationId), undefined);
  assert.deepEqual(await run.feature.queries.listConversations(), []);
  assert.equal(await run.feature.queries.getRun(first.run.runId), undefined);
  assert.equal(await run.feature.queries.getRun(second.run.runId), undefined);
  assert.deepEqual(releasedEvidence.sort(), [first.run.runId, second.run.runId].sort());
  assert.deepEqual(run.sessions.deleted, [controlBeforeDelete?.state.sessionRef.sessionId]);
  const tombstone = await createFileSystemOrdinaryConversationControlRepository(run.root).get(conversationId);
  assert.equal(tombstone?.state.deletedAt !== undefined, true);
});

async function fixture(
  t: test.TestContext,
  executionFactory: ((sessions: SessionHarness) => OrdinaryExecutionPort | Promise<OrdinaryExecutionPort>) | OrdinaryExecutionPort,
  releaseToolEvidenceOwner?: (ownerId: string) => void | Promise<void>,
  onDiagnostic?: (diagnostic: OrdinaryFeatureDiagnostic) => void,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-conversation-"));
  const sessions = new SessionHarness();
  const execution = typeof executionFactory === "function" ? await executionFactory(sessions) : executionFactory;
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    sessionRepository: sessions,
    releaseToolEvidenceOwner,
    onDiagnostic,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  return { root, feature, sessions };
}

function immediateExecution(sessions: SessionHarness): OrdinaryExecutionPort {
  return { execute: (input) => complete(input, sessions, `answer:${input.runInput.userMessage}`) };
}

async function submitAndComplete(feature: ReturnType<typeof createOrdinaryAgentFeature>, conversationId: string | undefined, userMessage: string) {
  const result = await feature.commands.submitTurn({ conversationId, input: { userMessage }, birth: ordinaryRunBirth() });
  await waitForStatus(feature, result.run.runId, "completed");
  return { ...result, conversation: (await feature.queries.getConversation(result.conversation.conversationId))! };
}

async function prepareSession(input: Parameters<OrdinaryExecutionPort["execute"]>[0], sessions: SessionHarness): Promise<AgentSessionExecutionRefs> {
  const startLeafRef = await sessions.getActiveLeaf(input.sessionRef);
  await input.onSessionWriteCheckpoint?.({ kind: "start_leaf_captured", sessionId: input.sessionRef.sessionId, startLeafRef });
  const inputEntryRef = sessions.append(input.sessionRef, `${input.runId}-input`, startLeafRef);
  await input.onSessionWriteCheckpoint?.({ kind: "input_entry_committed", sessionId: input.sessionRef.sessionId, inputEntryRef });
  return { sessionId: input.sessionRef.sessionId, startLeafRef, inputEntryRef, safeLeafRef: inputEntryRef, latestLeafRef: inputEntryRef, compactionEntryRefs: [] };
}

async function complete(input: Parameters<OrdinaryExecutionPort["execute"]>[0], sessions: SessionHarness, answer: string, prepared?: AgentSessionExecutionRefs): Promise<OrdinaryExecutionOutcome> {
  const session = prepared ?? await prepareSession(input, sessions);
  const assistantEntryRef = sessions.append(input.sessionRef, `${input.runId}-answer`, undefined, answer);
  await input.onSessionWriteCheckpoint?.({ kind: "assistant_response_entry_committed", sessionId: input.sessionRef.sessionId, assistantEntryRef });
  return { status: "completed", answer, session: { ...session, latestLeafRef: assistantEntryRef }, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for Ordinary conversation cleanup");
}

async function waitForStatus(feature: ReturnType<typeof createOrdinaryAgentFeature>, runId: string, status: OrdinaryRunState["status"]["kind"]): Promise<OrdinaryRunState> {
  let latest: OrdinaryRunState | undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    latest = await feature.queries.getRun(runId);
    if (latest?.status.kind === status) return latest;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${runId} to reach ${status}; latest=${JSON.stringify(latest?.status)}`);
}
async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function clock(start = "2026-01-01T00:00:00.000Z") { let value = Date.parse(start); return () => new Date(value++).toISOString(); }
function ids(initial = 0) { let value = initial; return (prefix: string) => `${prefix}-${++value}`; }
function createGate() { let enter!: () => void; let release!: () => void; return { entered: new Promise<void>((resolve) => { enter = resolve; }), released: new Promise<void>((resolve) => { release = resolve; }), enter, release }; }
async function removeTestDirectory(root: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); return; }
    catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
      if (attempt === 6 || (code !== "ENOTEMPTY" && code !== "EPERM" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

type SessionNode = { readonly ref: AgentSessionEntryRef; readonly parent: AgentSessionEntryRef | null; readonly text: string };
class SessionHarness implements AgentSessionRepository {
  readonly deleted: string[] = [];
  readonly deleteAttempts: string[] = [];
  readonly assistantEntryReadBatches: string[][] = [];
  private readonly nodes = new Map<string, Map<string, SessionNode>>();
  private readonly active = new Map<string, AgentSessionEntryRef | null>();
  private readonly refs = new Map<string, AgentSessionRef>();
  ensure(ref: AgentSessionRef): void { this.refs.set(ref.sessionId, ref); this.nodes.set(ref.sessionId, this.nodes.get(ref.sessionId) ?? new Map()); if (!this.active.has(ref.sessionId)) this.active.set(ref.sessionId, null); }
  append(ref: AgentSessionRef, entryId: string, parent = this.active.get(ref.sessionId) ?? null, text = ""): AgentSessionEntryRef { this.ensure(ref); const entry = { sessionId: ref.sessionId, entryId }; this.nodes.get(ref.sessionId)!.set(entryId, { ref: entry, parent, text }); this.active.set(ref.sessionId, entry); return entry; }
  async create(input: { readonly sessionId: string; readonly sessionCwd: string }): Promise<AgentSessionRef> { const ref = { ...ordinaryAgentSessionRef(input.sessionId), sessionCwd: input.sessionCwd }; this.ensure(ref); return ref; }
  async getActiveLeaf(ref: AgentSessionRef): Promise<AgentSessionEntryRef | null> { this.ensure(ref); return this.active.get(ref.sessionId) ?? null; }
  async moveActiveLeaf(ref: AgentSessionRef, target: AgentSessionEntryRef | null): Promise<AgentSessionEntryRef | null> { this.ensure(ref); this.active.set(ref.sessionId, target); return target; }
  async getActiveBranchEntryRefs(ref: AgentSessionRef): Promise<readonly AgentSessionEntryRef[]> { const result: AgentSessionEntryRef[] = []; let current = this.active.get(ref.sessionId) ?? null; while (current !== null) { result.push(current); current = this.nodes.get(ref.sessionId)?.get(current.entryId)?.parent ?? null; } return result.reverse(); }
  async readAssistantEntries(input: { readonly entryRefs: readonly AgentSessionEntryRef[] }) {
    this.assistantEntryReadBatches.push(input.entryRefs.map((entryRef) => entryRef.entryId));
    return input.entryRefs.map((entryRef) => ({ entryRef, text: this.nodes.get(entryRef.sessionId)?.get(entryRef.entryId)?.text ?? "" }));
  }
  async readToolCalls(_input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef }): Promise<readonly ToolCallRequest[]> { return []; }
  async reconcileToolResultEntries(input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef; readonly orderedResults: readonly ToolCallResult[] }): Promise<AgentSessionEntryRef> { return this.append(input.sessionRef, `${input.assistantEntryRef.entryId}-results`); }
  async delete(ref: AgentSessionRef): Promise<void> { this.deleteAttempts.push(ref.sessionId); if (this.refs.has(ref.sessionId)) this.deleted.push(ref.sessionId); this.nodes.delete(ref.sessionId); this.active.delete(ref.sessionId); this.refs.delete(ref.sessionId); }
}
