import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tools/index.js";
import { OrdinaryFeatureError, type OrdinaryExecutionOutcome, type OrdinaryExecutionPort, type OrdinaryRunState } from "./contracts.js";
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

test("submitTurn resolves stable submission ids idempotently and rejects changed input", async (t) => {
  const run = await fixture(t, immediateExecution);
  const first = await run.feature.commands.submitTurn({
    submissionId: "remote-command-1",
    input: { userMessage: "from phone" },
    birth: ordinaryRunBirth(),
  });
  const repeated = await run.feature.commands.submitTurn({
    submissionId: "remote-command-1",
    input: { userMessage: "from phone" },
    birth: ordinaryRunBirth(),
  });
  assert.equal(repeated.run.runId, first.run.runId);
  assert.equal(repeated.conversation.conversationId, first.conversation.conversationId);
  assert.equal(repeated.conversation.turns.filter((turn) => turn.role === "user").length, 1);
  await assert.rejects(
    run.feature.commands.submitTurn({
      submissionId: "remote-command-1",
      input: { userMessage: "changed retry" },
      birth: ordinaryRunBirth(),
    }),
    (error: unknown) => error instanceof OrdinaryFeatureError && error.code === "ordinary_run_conflict",
  );
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
  assert.equal(await run.feature.queries.getConversation(conversationId), undefined);
  assert.deepEqual(await run.feature.queries.listConversations(), []);
  assert.equal(await run.feature.queries.getRun(first.run.runId), undefined);
  assert.equal(await run.feature.queries.getRun(second.run.runId), undefined);
  assert.deepEqual(releasedEvidence.sort(), [first.run.runId, second.run.runId].sort());
  assert.deepEqual(run.sessions.deleted, [controlBeforeDelete?.state.sessionRef.sessionId]);
  const tombstone = await createFileSystemOrdinaryConversationControlRepository(run.root).get(conversationId);
  assert.equal(tombstone?.state.deletedAt !== undefined, true);
});

async function fixture(t: test.TestContext, executionFactory: ((sessions: SessionHarness) => OrdinaryExecutionPort | Promise<OrdinaryExecutionPort>) | OrdinaryExecutionPort, releaseToolEvidenceOwner?: (ownerId: string) => void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-conversation-"));
  const sessions = new SessionHarness();
  const execution = typeof executionFactory === "function" ? await executionFactory(sessions) : executionFactory;
  const feature = createOrdinaryAgentFeature({ repository: createFileSystemOrdinaryRunRepository(root), conversationRepository: createFileSystemOrdinaryConversationControlRepository(root), execution, sessionRepository: sessions, releaseToolEvidenceOwner, now: clock(), idFactory: ids() });
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
  async delete(ref: AgentSessionRef): Promise<void> { if (this.refs.has(ref.sessionId)) this.deleted.push(ref.sessionId); this.nodes.delete(ref.sessionId); this.active.delete(ref.sessionId); this.refs.delete(ref.sessionId); }
}
