import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { OrdinaryExecutionOutcome, OrdinaryExecutionPort, OrdinaryRunState } from "./contracts.js";
import { createFileSystemOrdinaryRunRepository } from "./file-system-repository.js";
import { createOrdinaryAgentFeature } from "./ordinary-agent-feature.js";
import { ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("feature owns completed and failed Ordinary run outcomes", async (t) => {
  const completedFixture = await fixture(t, executionFor("completed"));
  await completedFixture.feature.commands.start(startInput("completed-run"));
  const completed = await waitForStatus(completedFixture.feature, "completed-run", "completed");
  assert.deepEqual(completed.status, { kind: "completed", answer: "final answer" });
  assert.equal(completed.canonicalMessages.at(-1)?.content, "final answer");

  const failedFixture = await fixture(t, executionFor("failed"));
  await failedFixture.feature.commands.start(startInput("failed-run"));
  const failed = await waitForStatus(failedFixture.feature, "failed-run", "failed");
  assert.deepEqual(failed.status, {
    kind: "failed",
    error: { code: "model_failed", message: "provider unavailable" },
  });
});

test("feature cancellation aborts live execution and cannot be overwritten by a late result", async (t) => {
  let observedSignal: AbortSignal | undefined;
  const execution: OrdinaryExecutionPort = {
    execute(input) {
      observedSignal = input.abortSignal;
      return new Promise((_, reject) => input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason), { once: true }));
    },
  };
  const run = await fixture(t, execution);
  await run.feature.commands.start(startInput("cancelled-run"));
  const cancelled = await run.feature.commands.cancel("cancelled-run", "user_stopped");

  assert.equal(observedSignal?.aborted, true);
  assert.deepEqual(cancelled.status, { kind: "cancelled", reason: "user_stopped" });
  await waitForSettledMicrotasks();
  assert.equal((await run.feature.queries.getRun("cancelled-run"))?.status.kind, "cancelled");
});

test("feature resumes the exact live approval continuation", async (t) => {
  const request = confirmation("approval-run");
  let decided = 0;
  const approvalOutcome: OrdinaryExecutionOutcome = {
    status: "approval_required",
    canonicalMessages: [{ role: "user", content: "change file" }],
    toolCalls: [],
    confirmationRequests: [request],
    continuation: {
      availability: "live_only",
      async decide({ decision }) {
        decided += 1;
        assert.equal(decision.confirmationId, request.confirmationId);
        return completedOutcome();
      },
    },
  };
  const run = await fixture(t, { async execute() { return approvalOutcome; } });
  await run.feature.commands.start(startInput("approval-run"));
  await waitForStatus(run.feature, "approval-run", "awaiting_approval");
  await run.feature.commands.decideApproval({
    confirmationId: request.confirmationId,
    runId: "approval-run",
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:10.000Z",
  });
  const completed = await waitForStatus(run.feature, "approval-run", "completed");

  assert.equal(decided, 1);
  assert.deepEqual(completed.timeline.map((event) => event.type), [
    "run.created", "run.started", "run.approval_requested", "run.approval_decided", "run.completed",
  ]);
  assert.deepEqual(completed.timeline.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  const requested = completed.timeline.find((event) => event.type === "run.approval_requested");
  const decidedEvent = completed.timeline.find((event) => event.type === "run.approval_decided");
  assert.deepEqual(requested, {
    eventId: requested?.eventId,
    runId: "approval-run",
    sequence: 3,
    type: "run.approval_requested",
    recordedAt: requested?.recordedAt,
    confirmationIds: [request.confirmationId],
    toolCallIds: [],
  });
  assert.equal(decidedEvent?.type === "run.approval_decided" ? decidedEvent.confirmationId : undefined, request.confirmationId);
});

test("feature restart turns a persisted approval pause into an honest blocked state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-restart-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const first = await createOrdinaryAgentFeature({
    repository,
    execution: { async execute() {
      return {
        status: "approval_required",
        canonicalMessages: [{ role: "user", content: "change file" }],
        toolCalls: [],
        confirmationRequests: [confirmation("restart-run")],
        continuation: { availability: "live_only", async decide() { return completedOutcome(); } },
      };
    } },
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  await first.commands.start(startInput("restart-run"));
  await waitForStatus(first, "restart-run", "awaiting_approval");
  await first.release();

  const restarted = await createOrdinaryAgentFeature({
    repository,
    execution: { async execute() { throw new Error("must not restart execution"); } },
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(() => restarted.release());
  const state = await restarted.queries.getRun("restart-run");

  assert.deepEqual(state?.status, {
    kind: "blocked",
    reason: {
      code: "confirmation_continuation_lost",
      message: "The live confirmation continuation was lost when the process restarted.",
    },
    continueBy: "new_turn",
  });
  assert.equal(state?.timeline.at(-1)?.type, "run.blocked");
});

test("a queued run starts only after its predecessor reaches a terminal state", async (t) => {
  let completePredecessor: ((outcome: OrdinaryExecutionOutcome) => void) | undefined;
  let executionCount = 0;
  const execution: OrdinaryExecutionPort = {
    execute() {
      executionCount += 1;
      if (executionCount === 1) {
        return new Promise<OrdinaryExecutionOutcome>((resolve) => { completePredecessor = resolve; });
      }
      return Promise.resolve(completedOutcome());
    },
  };
  const run = await fixture(t, execution);
  await run.feature.commands.start(startInput("first-run"));
  const secondInput = startInput("second-run");
  const queued = await run.feature.commands.start({
    ...secondInput,
    turn: { ...secondInput.turn, predecessorRunId: "first-run" },
  });
  assert.equal(queued.status.kind, "queued");
  assert.equal(executionCount, 1);

  completePredecessor?.(completedOutcome());
  await waitForStatus(run.feature, "first-run", "completed");
  await waitForStatus(run.feature, "second-run", "completed");
  assert.equal(executionCount, 2);
});

test("subscriber failures cannot turn a committed run transition into a command failure", async (t) => {
  const run = await fixture(t, executionFor("completed"));
  run.feature.events.subscribe("listener-run", () => { throw new Error("projection failed"); });
  await run.feature.commands.start(startInput("listener-run"));
  assert.equal((await waitForStatus(run.feature, "listener-run", "completed")).status.kind, "completed");
});

test("the synchronous factory gates concurrent first calls on one recovery pass", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-ready-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = createFileSystemOrdinaryRunRepository(root);
  let releaseList: (() => void) | undefined;
  const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
  let listCalls = 0;
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...base,
      async list(limit) { listCalls += 1; await listGate; return base.list(limit); },
    },
    execution: executionFor("completed"),
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  t.after(() => feature.release());
  const query = feature.queries.getRun("missing");
  const command = feature.commands.start(startInput("ready-run"));
  assert.equal(listCalls, 1);
  assert.equal(await Promise.race([query.then(() => "settled"), Promise.resolve("pending")]), "pending");
  releaseList?.();
  assert.equal(await query, undefined);
  await command;
  await waitForStatus(feature, "ready-run", "completed");
  assert.equal(listCalls, 1);
  await feature.release();
});

test("eager recovery failures are observed and remain stable for later commands", async () => {
  const recoveryError = new Error("repository unavailable");
  const feature = createOrdinaryAgentFeature({
    repository: {
      async save() { throw new Error("must not save"); },
      async get() { return undefined; },
      async list() { throw recoveryError; },
      async delete() { return undefined; },
    },
    execution: executionFor("completed"),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(feature.queries.getRun("missing"), (error: unknown) => error === recoveryError);
  await assert.rejects(feature.commands.start(startInput("never-started")), (error: unknown) => error === recoveryError);
  await feature.release();
});

async function fixture(t: test.TestContext, execution: OrdinaryExecutionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-feature-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const feature = await createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    execution,
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  t.after(() => feature.release());
  return { feature, root };
}

function executionFor(status: "completed" | "failed"): OrdinaryExecutionPort {
  const value: OrdinaryExecutionOutcome = status === "completed"
    ? completedOutcome()
    : {
        status,
        error: { code: "model_failed", message: "provider unavailable" },
        canonicalMessages: [{ role: "user", content: "hello" }],
        toolCalls: [],
      };
  return { async execute() { return value; } };
}

function completedOutcome(): OrdinaryExecutionOutcome {
  return {
    status: "completed",
    answer: "final answer",
    canonicalMessages: [{ role: "user", content: "hello" }, { role: "assistant", content: "final answer" }],
    toolCalls: [],
  };
}

function startInput(runId: string) {
  return {
    runId,
    turn: ordinaryRunTurn(runId),
    input: { userMessage: "hello" },
    birth: ordinaryRunBirth(),
  } as const;
}

function confirmation(runId: string): ConfirmationRequest {
  return {
    confirmationId: `${runId}-confirmation`,
    runId,
    title: "Confirm command",
    actionSummary: "Run a command",
    affectedResources: ["workspace"],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: "2026-01-01T00:00:02.000Z",
    sourceRefs: [],
  };
}

async function waitForStatus(
  feature: Awaited<ReturnType<typeof createOrdinaryAgentFeature>>,
  runId: string,
  status: OrdinaryRunState["status"]["kind"],
): Promise<OrdinaryRunState> {
  const current = await feature.queries.getRun(runId);
  if (current?.status.kind === status) return current;
  return new Promise<OrdinaryRunState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${runId} to reach ${status}`));
    }, 2_000);
    const unsubscribe = feature.events.subscribe(runId, () => {
      void feature.queries.getRun(runId).then((state) => {
        if (state?.status.kind !== status) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }, reject);
    });
  });
}

function monotonicClock(start = "2026-01-01T00:00:00.000Z"): () => string {
  let time = Date.parse(start);
  return () => new Date(time++).toISOString();
}

function deterministicIds(initialIndex = 0) {
  let index = initialIndex;
  return (prefix: string) => `${prefix}-${++index}`;
}

async function waitForSettledMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
