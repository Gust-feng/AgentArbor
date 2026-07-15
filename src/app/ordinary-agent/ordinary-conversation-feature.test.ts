import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OrdinaryExecutionOutcome, OrdinaryExecutionPort, OrdinaryRunRepository, OrdinaryRunState } from "./contracts.js";
import { createFileSystemOrdinaryConversationControlRepository } from "./conversation-control-repository.js";
import { createFileSystemOrdinaryRunRepository } from "./file-system-repository.js";
import { createOrdinaryAgentFeature } from "./ordinary-agent-feature.js";
import { ordinaryRunBirth } from "./test-support.js";

test("submitTurn serializes queued turns and rebases the successor on completed canonical context", async (t) => {
  let finishFirst: ((outcome: OrdinaryExecutionOutcome) => void) | undefined;
  const observedMessages: OrdinaryRunState["canonicalMessages"][] = [];
  let calls = 0;
  const run = await fixture(t, {
    execute(input) {
      calls += 1;
      observedMessages.push(input.messages);
      if (calls === 1) return new Promise((resolve) => { finishFirst = resolve; });
      return Promise.resolve(completed(input, `answer:${input.runInput.userMessage}`));
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  const second = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "second" },
    birth: ordinaryRunBirth(),
  });
  assert.equal(second.run.status.kind, "queued");
  assert.equal(second.run.turn.predecessorRunId, first.run.runId);
  assert.equal(second.run.turn.ordinal, 2);

  finishFirst?.(completedFromMessages(observedMessages[0]!, "answer:first"));
  await waitForStatus(run.feature, first.run.runId, "completed");
  await waitForStatus(run.feature, second.run.runId, "completed");
  assert.deepEqual(observedMessages[1]?.map((message) => `${message.role}:${message.content}`), [
    "user:first", "assistant:answer:first", "user:second",
  ]);
  const conversation = await run.feature.queries.getConversation(first.conversation.conversationId);
  assert.deepEqual(conversation?.turns.map((turn) => `${turn.role}:${turn.content}`), [
    "user:first", "assistant:answer:first", "user:second", "assistant:answer:second",
  ]);
});

test("cancelling a queued middle turn does not start its successor past an active ancestor", async (t) => {
  let executions = 0;
  const run = await fixture(t, {
    execute(input) {
      executions += 1;
      return new Promise<OrdinaryExecutionOutcome>((resolve) => {
        input.abortSignal.addEventListener("abort", () => resolve({
          status: "cancelled",
          reason: String(input.abortSignal.reason),
          canonicalMessages: input.messages,
          toolCalls: [],
          usage: {},
        }), { once: true });
      });
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  const second = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "second" },
    birth: ordinaryRunBirth(),
  });
  const third = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "third" },
    birth: ordinaryRunBirth(),
  });

  await run.feature.commands.cancel(second.run.runId, "cancel_middle");

  assert.equal(executions, 1);
  assert.equal((await run.feature.queries.getRun(first.run.runId))?.status.kind, "running");
  assert.equal((await run.feature.queries.getRun(second.run.runId))?.status.kind, "cancelled");
  assert.equal((await run.feature.queries.getRun(third.run.runId))?.status.kind, "queued");
});

test("a successor behind a cancelled queued turn starts after its active ancestor with complete context", async (t) => {
  let finishFirst: ((outcome: OrdinaryExecutionOutcome) => void) | undefined;
  const observed: { readonly message: string; readonly messages: OrdinaryRunState["canonicalMessages"] }[] = [];
  const run = await fixture(t, {
    execute(input) {
      observed.push({ message: input.runInput.userMessage, messages: input.messages });
      if (input.runInput.userMessage === "first") {
        return new Promise<OrdinaryExecutionOutcome>((resolve) => { finishFirst = resolve; });
      }
      return Promise.resolve(completed(input, `answer:${input.runInput.userMessage}`));
    },
  });
  const first = await run.feature.commands.submitTurn({ input: { userMessage: "first" }, birth: ordinaryRunBirth() });
  const second = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "second" },
    birth: ordinaryRunBirth(),
  });
  const third = await run.feature.commands.submitTurn({
    conversationId: first.conversation.conversationId,
    input: { userMessage: "third" },
    birth: ordinaryRunBirth(),
  });
  await run.feature.commands.cancel(second.run.runId, "cancel_middle");
  assert.deepEqual(observed.map((entry) => entry.message), ["first"]);

  finishFirst?.(completedFromMessages(observed[0]!.messages, "answer:first"));
  await waitForStatus(run.feature, first.run.runId, "completed");
  await waitForStatus(run.feature, third.run.runId, "completed");

  assert.deepEqual(observed.map((entry) => entry.message), ["first", "third"]);
  assert.equal(
    observed[1]?.messages.some((message) => message.role === "assistant" && message.content === "answer:first"),
    true,
  );
  assert.equal(observed[1]?.messages.at(-1)?.content, "third");
});

test("conversation control persists rename and pin without copying turn content or run results", async (t) => {
  const run = await fixture(t, immediateExecution());
  const submitted = await run.feature.commands.submitTurn({ input: { userMessage: "sensitive user text" }, birth: ordinaryRunBirth() });
  await waitForStatus(run.feature, submitted.run.runId, "completed");
  await run.feature.commands.renameConversation(submitted.conversation.conversationId, "  Renamed   conversation  ");
  await run.feature.commands.setConversationPinned(submitted.conversation.conversationId, true);
  await run.feature.release();

  const raw = await fs.readFile(path.join(run.root, "conversations", encodeURIComponent(submitted.conversation.conversationId), "snapshot.json"), "utf8");
  assert.equal(raw.includes("sensitive user text"), false);
  assert.equal(raw.includes("answer:sensitive user text"), false);
  const restarted = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(run.root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root),
    execution: immediateExecution(),
    now: clock("2026-02-01T00:00:00.000Z"),
    idFactory: ids(100),
  });
  t.after(() => restarted.release());
  const restored = await restarted.queries.getConversation(submitted.conversation.conversationId);
  assert.equal(restored?.title, "Renamed conversation");
  assert.equal(restored?.pinnedAt !== undefined, true);
  assert.equal(restored?.turns[1]?.content, "answer:sensitive user text");
});

test("two rollbacks preserve a lineage graph across restart and never resurrect discarded runs", async (t) => {
  const run = await fixture(t, immediateExecution());
  const first = await submitAndComplete(run.feature, undefined, "one");
  const second = await submitAndComplete(run.feature, first.conversation.conversationId, "two");
  await submitAndComplete(run.feature, first.conversation.conversationId, "three");

  const rolledBack = await run.feature.commands.rollbackConversation({
    conversationId: first.conversation.conversationId,
    targetRunId: first.run.runId,
  });
  assert.deepEqual(rolledBack.turns.filter((turn) => turn.role === "user").map((turn) => turn.content), ["one"]);
  const branch = await submitAndComplete(run.feature, first.conversation.conversationId, "branch");
  assert.equal(branch.run.turn.predecessorRunId, first.run.runId);
  const rolledBackAgain = await run.feature.commands.rollbackConversation({
    conversationId: first.conversation.conversationId,
    targetRunId: branch.run.runId,
  });
  assert.deepEqual(rolledBackAgain.turns.filter((turn) => turn.role === "user").map((turn) => turn.content), ["one", "branch"]);
  const control = await createFileSystemOrdinaryConversationControlRepository(run.root).get(first.conversation.conversationId);
  assert.equal(control?.state.lineages.length, 3);
  assert.equal(control?.state.lineages.at(-1)?.parentLineageId, control?.state.lineages.at(-2)?.lineageId);
  assert.equal(second.run.runId === rolledBackAgain.latestRunId, false);

  await run.feature.release();
  const restarted = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(run.root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root),
    execution: immediateExecution(),
  });
  t.after(() => restarted.release());
  const restored = await restarted.queries.getConversation(first.conversation.conversationId);
  assert.deepEqual(restored?.turns.filter((turn) => turn.role === "user").map((turn) => turn.content), ["one", "branch"]);
});

test("deleteConversation commits a tombstone first, cancels owned work, and is idempotent", async (t) => {
  const run = await fixture(t, {
    execute(input) {
      return new Promise((resolve) => input.abortSignal.addEventListener("abort", () => resolve({
        status: "cancelled", reason: String(input.abortSignal.reason), canonicalMessages: input.messages, toolCalls: [], usage: {},
      }), { once: true }));
    },
  });
  const submitted = await run.feature.commands.submitTurn({ input: { userMessage: "delete me" }, birth: ordinaryRunBirth() });
  await run.feature.commands.deleteConversation(submitted.conversation.conversationId);
  await run.feature.commands.deleteConversation(submitted.conversation.conversationId);
  assert.equal(await run.feature.queries.getConversation(submitted.conversation.conversationId), undefined);
  assert.deepEqual(await run.feature.queries.listConversations(), []);
  assert.equal(await run.feature.queries.getRun(submitted.run.runId), undefined);
  await assert.rejects(run.feature.commands.submitTurn({
    conversationId: submitted.conversation.conversationId,
    input: { userMessage: "resurrect" },
    birth: ordinaryRunBirth(),
  }), /deleted/u);
  assert.equal((await createFileSystemOrdinaryConversationControlRepository(run.root).get(submitted.conversation.conversationId))?.state.deletedAt !== undefined, true);
});

test("a failed first run commit leaves only a hidden retry-safe conversation control", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-empty-conversation-"));
  const failedRepository: OrdinaryRunRepository = {
    async save() { throw new Error("run storage unavailable"); },
    async get() { return undefined; },
    async list() { return []; },
    async delete() { return undefined; },
  };
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const feature = createOrdinaryAgentFeature({
    repository: failedRepository,
    conversationRepository: controls,
    execution: immediateExecution(),
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  await assert.rejects(feature.commands.submitTurn({ input: { userMessage: "cannot save" }, birth: ordinaryRunBirth() }), /storage unavailable/u);
  assert.deepEqual(await feature.queries.listConversations(), []);
  assert.equal((await controls.list()).length, 1);
});

async function fixture(t: test.TestContext, execution: OrdinaryExecutionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-conversation-"));
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  return { root, feature };
}

function immediateExecution(): OrdinaryExecutionPort {
  return { async execute(input) { return completed(input, `answer:${input.runInput.userMessage}`); } };
}
function completed(input: Parameters<OrdinaryExecutionPort["execute"]>[0], answer: string): OrdinaryExecutionOutcome {
  return completedFromMessages(input.messages, answer);
}
function completedFromMessages(messages: OrdinaryRunState["canonicalMessages"], answer: string): OrdinaryExecutionOutcome {
  return {
    status: "completed", answer,
    canonicalMessages: [...messages, { role: "assistant", content: answer }],
    toolCalls: [], usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  };
}
async function submitAndComplete(feature: ReturnType<typeof createOrdinaryAgentFeature>, conversationId: string | undefined, message: string) {
  const result = await feature.commands.submitTurn({ conversationId, input: { userMessage: message }, birth: ordinaryRunBirth() });
  await waitForStatus(feature, result.run.runId, "completed");
  return { ...result, conversation: (await feature.queries.getConversation(result.conversation.conversationId))! };
}
async function waitForStatus(feature: ReturnType<typeof createOrdinaryAgentFeature>, runId: string, status: OrdinaryRunState["status"]["kind"]): Promise<void> {
  if ((await feature.queries.getRun(runId))?.status.kind === status) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out waiting for ${status}`)); }, 2_000);
    const unsubscribe = feature.events.subscribe(runId, () => {
      void feature.queries.getRun(runId).then((state) => {
        if (state?.status.kind !== status) return;
        clearTimeout(timeout); unsubscribe(); resolve();
      }, reject);
    });
  });
}
function clock(start = "2026-01-01T00:00:00.000Z") {
  let value = Date.parse(start);
  return () => new Date(value++).toISOString();
}
function ids(initial = 0) {
  let value = initial;
  return (prefix: string) => `${prefix}-${++value}`;
}

async function removeTestDirectory(root: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { await fs.rm(root, { recursive: true, force: true }); return; }
    catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
      if (attempt === 6 || (code !== "ENOTEMPTY" && code !== "EPERM" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}
