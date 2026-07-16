import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import { CodedExecutionError } from "../execution-errors/index.js";
import { ModelRuntimeConfigurationError } from "../model-runtime/index.js";
import {
  OrdinaryFeatureError,
  type OrdinaryExecutionOutcome,
  type OrdinaryExecutionPort,
  type OrdinaryRunState,
} from "./contracts.js";
import { createFileSystemOrdinaryRunRepository } from "./file-system-repository.js";
import { createFileSystemOrdinaryConversationControlRepository } from "./conversation-control-repository.js";
import { createOrdinaryAgentFeature } from "./ordinary-agent-feature.js";
import { createInitialOrdinaryRunState, transitionOrdinaryRun } from "./state.js";
import { ordinaryCapabilityResolution, ordinaryRunBirth, ordinaryRunTurn } from "./test-support.js";

test("feature owns completed and failed Ordinary run outcomes", async (t) => {
  const completedFixture = await fixture(t, executionFor("completed"));
  await completedFixture.feature.commands.start(startInput("completed-run"));
  const completed = await waitForStatus(completedFixture.feature, "completed-run", "completed");
  assert.deepEqual(completed.status, { kind: "completed", answer: "final answer" });
  assert.equal(completed.canonicalMessages.at(-1)?.content, "final answer");
  assert.deepEqual(completed.capabilityResolution, ordinaryCapabilityResolution());

  const failedFixture = await fixture(t, executionFor("failed"));
  await failedFixture.feature.commands.start(startInput("failed-run"));
  const failed = await waitForStatus(failedFixture.feature, "failed-run", "failed");
  assert.deepEqual(failed.status, {
    kind: "failed",
    error: { code: "model_failed", message: "provider unavailable" },
  });
});

test("feature persists explicit execution error codes and keeps unknown fallback", async (t) => {
  const configured = await fixture(t, {
    async execute() {
      throw new ModelRuntimeConfigurationError({
        code: "missing_model_name",
        message: "A model name is required.",
        summaryInput: { enabled: true, mode: "openai-responses" },
      });
    },
  });
  await configured.feature.commands.start(startInput("configured-error-run"));
  const configuredFailure = await waitForStatus(configured.feature, "configured-error-run", "failed");
  assert.deepEqual(configuredFailure.status, {
    kind: "failed",
    error: { code: "missing_model_name", message: "A model name is required." },
  });

  const boundary = await fixture(t, {
    async execute() {
      throw new CodedExecutionError("tool_boundary_resolution_failed", "Tool boundary failed.");
    },
  });
  await boundary.feature.commands.start(startInput("boundary-error-run"));
  const boundaryFailure = await waitForStatus(boundary.feature, "boundary-error-run", "failed");
  assert.deepEqual(boundaryFailure.status, {
    kind: "failed",
    error: { code: "tool_boundary_resolution_failed", message: "Tool boundary failed." },
  });

  const unknown = await fixture(t, { async execute() { throw new Error("unexpected defect"); } });
  await unknown.feature.commands.start(startInput("unknown-error-run"));
  const unknownFailure = await waitForStatus(unknown.feature, "unknown-error-run", "failed");
  assert.deepEqual(unknownFailure.status, {
    kind: "failed",
    error: { code: "ordinary_execution_failed", message: "unexpected defect" },
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

test("feature preserves a tool result that completes after cancellation commits", async (t) => {
  const toolResult = resolvedToolResult("call-after-cancel");
  let finishTool: (() => void) | undefined;
  let markExecutionStarted: (() => void) | undefined;
  let markFactPersisted: (() => void) | undefined;
  const toolGate = new Promise<void>((resolve) => { finishTool = resolve; });
  const executionStarted = new Promise<void>((resolve) => { markExecutionStarted = resolve; });
  const factPersisted = new Promise<void>((resolve) => { markFactPersisted = resolve; });
  const run = await fixture(t, {
    async execute(input) {
      markExecutionStarted?.();
      await toolGate;
      await input.onToolResult?.(toolResult);
      markFactPersisted?.();
      return {
        status: "cancelled",
        reason: String(input.abortSignal.reason),
        canonicalMessages: input.messages,
        toolCalls: [toolResult],
        usage: {},
      };
    },
  });
  await run.feature.commands.start(startInput("cancel-late-tool-run"));
  await executionStarted;
  const cancelled = await run.feature.commands.cancel("cancel-late-tool-run", "user_stopped");
  assert.equal(cancelled.status.kind, "cancelled");

  finishTool?.();
  await factPersisted;
  const final = await run.feature.queries.getRun("cancel-late-tool-run");
  assert.deepEqual(final?.status, { kind: "cancelled", reason: "user_stopped" });
  assert.deepEqual(final?.toolCalls, [toolResult]);
  const activities = (await run.feature.events.replay("cancel-late-tool-run"))?.activities ?? [];
  assert.equal(activities.filter((activity) => activity.type === "tool.result").length, 1);
});

test("feature activity stream supports output delta subscribe and cursor replay while a run is live", async (t) => {
  let emitDelta: ((delta: string) => void) | undefined;
  let emitToolResult: ((result: ToolCallResult) => Promise<void>) | undefined;
  let finish: ((outcome: OrdinaryExecutionOutcome) => void) | undefined;
  let markEntered: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const run = await fixture(t, {
    execute(input) {
      emitDelta = input.onTextDelta;
      emitToolResult = input.onToolResult;
      markEntered?.();
      return new Promise<OrdinaryExecutionOutcome>((resolve) => { finish = resolve; });
    },
  });
  const observed: string[] = [];
  run.feature.events.subscribe("stream-run", (activity) => observed.push(activity.type));
  await run.feature.commands.start(startInput("stream-run"));
  await entered;

  emitDelta?.("hel");
  emitDelta?.("lo");
  const toolResult = {
    callId: "call-read",
    toolName: "read_file",
    input: { path: "README.md" },
    output: { content: "read result" },
    status: "completed" as const,
    durationMs: 2,
  };
  await emitToolResult?.(toolResult);
  const first = await run.feature.events.replay("stream-run");
  assert.deepEqual(first?.activities.filter((activity) => activity.type === "model.output.delta").map((activity) => activity.delta), ["hel", "lo"]);
  assert.deepEqual(first?.activities.filter((activity) => activity.type === "model.request").map((activity) => activity.reason), ["initial", "after_tool"]);
  assert.deepEqual(first?.activities.map((activity) => activity.sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(first?.activities.some((activity) => activity.type === "tool.result"), true);

  emitDelta?.("!");
  const incremental = await run.feature.events.replay("stream-run", first?.cursor);
  assert.deepEqual(incremental?.activities.map((activity) => activity.type), ["model.output.delta"]);
  assert.deepEqual(incremental?.activities.map((activity) => activity.sequence), [8]);

  finish?.({ ...completedOutcome(), toolCalls: [toolResult] });
  await waitForStatus(run.feature, "stream-run", "completed");
  assert.equal(observed.at(-1), "run.transition");
  const completedReplay = await run.feature.events.replay("stream-run");
  assert.equal(completedReplay?.activities.some((activity) =>
    activity.type === "tool.result" && activity.durability === "durable"), true);

  await run.feature.release();
  const restarted = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(run.root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(run.root),
    execution: executionFor("completed"),
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(() => restarted.release());
  const restartedReplay = await restarted.events.replay("stream-run");
  assert.equal(restartedReplay?.activities.some((activity) =>
    activity.type === "tool.result" && activity.durability === "durable"), true);
});

test("feature persists an executed tool fact before a simulated crash and rebuilds it once after restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-tool-crash-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const toolResult = resolvedToolResult("call-before-crash");
  let markPersisted: (() => void) | undefined;
  const persisted = new Promise<void>((resolve) => { markPersisted = resolve; });
  const first = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: {
      async execute(input) {
        await input.onToolResult?.(toolResult);
        await input.onToolResult?.(toolResult);
        markPersisted?.();
        return new Promise<OrdinaryExecutionOutcome>((resolve) => {
          input.abortSignal.addEventListener("abort", () => resolve({
            status: "cancelled",
            reason: String(input.abortSignal.reason),
            canonicalMessages: input.messages,
            toolCalls: [toolResult],
            usage: {},
          }), { once: true });
        });
      },
    },
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  let restarted: ReturnType<typeof createOrdinaryAgentFeature> | undefined;
  t.after(async () => {
    await restarted?.release();
    await first.release();
    await removeTestDirectory(root);
  });

  await first.commands.start(startInput("tool-crash-run"));
  await persisted;
  const beforeRestart = await repository.get("tool-crash-run");
  assert.equal(beforeRestart?.state.status.kind, "running");
  assert.deepEqual(beforeRestart?.state.toolCalls, [toolResult]);
  const toolRecordedAt = beforeRestart?.state.toolResultRecordedAt["call-before-crash:completed"];
  assert.equal(typeof toolRecordedAt, "string");

  restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { throw new Error("must not restart interrupted execution"); } },
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  const blocked = await restarted.queries.getRun("tool-crash-run");
  assert.equal(blocked?.status.kind, "blocked");
  assert.deepEqual(blocked?.toolCalls, [toolResult]);
  const toolActivities = (await restarted.events.replay("tool-crash-run"))?.activities.filter(
    (activity) => activity.type === "tool.result",
  ) ?? [];
  assert.equal(toolActivities.length, 1);
  assert.equal(toolActivities[0]?.recordedAt, toolRecordedAt);
  assert.deepEqual(toolActivities[0]?.type === "tool.result" ? toolActivities[0].result : undefined, toolResult);
});

test("feature keeps a durable tool fact when execution subsequently fails", async (t) => {
  const toolResult = resolvedToolResult("call-before-failure");
  const run = await fixture(t, {
    async execute(input) {
      await input.onToolResult?.(toolResult);
      throw new Error("provider failed after tool execution");
    },
  });
  await run.feature.commands.start(startInput("tool-then-failure-run"));
  const failed = await waitForStatus(run.feature, "tool-then-failure-run", "failed");
  assert.deepEqual(failed.toolCalls, [toolResult]);
  const activities = (await run.feature.events.replay("tool-then-failure-run"))?.activities ?? [];
  assert.equal(activities.filter((activity) => activity.type === "tool.result").length, 1);
  assert.ok(activities.findIndex((activity) => activity.type === "tool.result") <
    activities.findIndex((activity) => activity.type === "run.transition" && activity.event.type === "run.failed"));
});

test("feature projects terminal-only tool results before the terminal transition", async (t) => {
  const toolResult = resolvedToolResult("call-terminal-only");
  const run = await fixture(t, {
    async execute() { return { ...completedOutcome(), toolCalls: [toolResult] }; },
  });
  await run.feature.commands.start(startInput("terminal-tool-run"));
  await waitForStatus(run.feature, "terminal-tool-run", "completed");
  const activities = (await run.feature.events.replay("terminal-tool-run"))?.activities ?? [];
  const toolIndex = activities.findIndex((activity) => activity.type === "tool.result");
  const terminalIndex = activities.findIndex((activity) =>
    activity.type === "run.transition" && activity.event.type === "run.completed");
  assert.ok(toolIndex >= 0 && toolIndex < terminalIndex);
  assert.deepEqual((await run.feature.queries.getRun("terminal-tool-run"))?.toolCalls, [toolResult]);
});

test("feature ignores output deltas that arrive after cancellation", async (t) => {
  let emitDelta: ((delta: string) => void) | undefined;
  let markEntered: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const run = await fixture(t, {
    execute(input) {
      emitDelta = input.onTextDelta;
      markEntered?.();
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
  const observed: string[] = [];
  run.feature.events.subscribe("late-delta-run", (activity) => {
    if (activity.type === "model.output.delta") observed.push(activity.delta);
  });
  await run.feature.commands.start(startInput("late-delta-run"));
  await entered;
  emitDelta?.("before cancel");
  await run.feature.commands.cancel("late-delta-run", "user_stopped");
  emitDelta?.("after cancel");

  assert.deepEqual(observed, ["before cancel"]);
  assert.equal((await run.feature.events.replay("late-delta-run"))?.activities.some((activity) => activity.type === "model.output.delta"), false);
});

test("feature resumes the exact live approval continuation", async (t) => {
  const request = confirmation("approval-run");
  let decided = 0;
  const approvalOutcome: OrdinaryExecutionOutcome = {
    status: "approval_required",
    canonicalMessages: [{ role: "user", content: "change file" }],
    toolCalls: [],
    usage: { inputTokens: 3, totalTokens: 3 },
    confirmationRequests: [request],
    continuation: {
      availability: "live_only",
      async decide({ decision }) {
        decided += 1;
        assert.equal(decision.confirmationId, request.confirmationId);
        return completedOutcome();
      },
      async release() { return undefined; },
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
    confirmationRequests: [request],
    toolCallIds: [],
  });
  assert.deepEqual(decidedEvent?.type === "run.approval_decided" ? decidedEvent.decision : undefined, {
    confirmationId: request.confirmationId,
    runId: "approval-run",
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:10.000Z",
  });
});

test("concurrent confirmation decisions have one owner and never consume or block its continuation", async (t) => {
  const request = confirmation("approval-overlap-run");
  let decideCalls = 0;
  let releaseCalls = 0;
  let markDecisionEntered: (() => void) | undefined;
  let finishDecision: (() => void) | undefined;
  const decisionEntered = new Promise<void>((resolve) => { markDecisionEntered = resolve; });
  const decisionGate = new Promise<void>((resolve) => { finishDecision = resolve; });
  const run = await fixture(t, {
    async execute() {
      return {
        status: "approval_required",
        canonicalMessages: [{ role: "user", content: "change file" }],
        toolCalls: [],
        usage: {},
        confirmationRequests: [request],
        continuation: {
          availability: "live_only",
          async decide() {
            decideCalls += 1;
            markDecisionEntered?.();
            await decisionGate;
            return completedOutcome();
          },
          async release() { releaseCalls += 1; },
        },
      };
    },
  });
  await run.feature.commands.start(startInput("approval-overlap-run"));
  await waitForStatus(run.feature, "approval-overlap-run", "awaiting_approval");

  try {
    const first = await run.feature.commands.decideApproval(approvalDecision(request));
    assert.equal(first.status.kind, "running");
    await decisionEntered;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(
        run.feature.commands.decideApproval(approvalDecision(request)),
        (error: unknown) => error instanceof OrdinaryFeatureError &&
          error.code === "ordinary_confirmation_in_progress",
      );
    }
    assert.equal((await run.feature.queries.getRun(request.runId))?.status.kind, "running");
    assert.equal(decideCalls, 1);
    assert.equal(releaseCalls, 0);
  } finally {
    finishDecision?.();
  }

  await waitForStatus(run.feature, request.runId, "completed");
  assert.equal(decideCalls, 1);
  assert.equal(releaseCalls, 0);
});

test("feature commits cancellation before approval cleanup and cleanup failure cannot rewrite it", async (t) => {
  const request = confirmation("approval-cancel-run");
  let markReleaseStarted: (() => void) | undefined;
  let finishRelease: (() => void) | undefined;
  const releaseStarted = new Promise<void>((resolve) => { markReleaseStarted = resolve; });
  const releaseGate = new Promise<void>((resolve) => { finishRelease = resolve; });
  const run = await fixture(t, {
    async execute() {
      return {
        status: "approval_required",
        canonicalMessages: [{ role: "user", content: "change file" }],
        toolCalls: [],
        usage: {},
        confirmationRequests: [request],
        continuation: {
          availability: "live_only",
          async decide() { return completedOutcome(); },
          async release() {
            markReleaseStarted?.();
            await releaseGate;
            throw new Error("cleanup failed");
          },
        },
      };
    },
  });
  await run.feature.commands.start(startInput("approval-cancel-run"));
  await waitForStatus(run.feature, "approval-cancel-run", "awaiting_approval");

  const cancelling = run.feature.commands.cancel("approval-cancel-run", "user_stopped");
  await releaseStarted;
  assert.deepEqual((await run.feature.queries.getRun("approval-cancel-run"))?.status, {
    kind: "cancelled",
    reason: "user_stopped",
  });
  finishRelease?.();
  assert.equal((await cancelling).status.kind, "cancelled");
  assert.equal((await run.feature.queries.getRun("approval-cancel-run"))?.status.kind, "cancelled");
});

test("feature release disposes a pending live approval continuation once", async (t) => {
  const request = confirmation("approval-feature-release-run");
  let releases = 0;
  const run = await fixture(t, {
    async execute() {
      return {
        status: "approval_required",
        canonicalMessages: [{ role: "user", content: "change file" }],
        toolCalls: [],
        usage: {},
        confirmationRequests: [request],
        continuation: {
          availability: "live_only",
          async decide() { return completedOutcome(); },
          async release() { releases += 1; },
        },
      };
    },
  });
  await run.feature.commands.start(startInput("approval-feature-release-run"));
  await waitForStatus(run.feature, "approval-feature-release-run", "awaiting_approval");

  await run.feature.release();
  await run.feature.release();
  assert.equal(releases, 1);
});

test("feature restart turns a persisted approval pause into an honest blocked state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-restart-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const request = confirmation("restart-run");
  const first = await createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() {
      return {
        status: "approval_required",
        canonicalMessages: [
          { role: "user", content: "change file" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ callId: "restart-call", toolName: "shell_command", input: { command: "write" } }],
          },
        ],
        toolCalls: [{
          callId: "restart-call",
          toolName: "shell_command",
          input: { command: "write" },
          output: undefined,
          status: "approval_required",
          durationMs: 0,
          confirmationRequest: request,
        }],
        usage: { inputTokens: 4, totalTokens: 4 },
        confirmationRequests: [request],
        continuation: {
          availability: "live_only",
          async decide() { return completedOutcome(); },
          async release() { return undefined; },
        },
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
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { throw new Error("must not restart execution"); } },
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });
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
  assert.equal(state?.toolCalls[0]?.status, "cancelled");
  assert.equal(state?.toolCalls[0]?.errorFacts?.code, "confirmation_continuation_lost");
  assert.equal(state?.canonicalMessages.at(-1)?.role, "tool");
  assert.equal(state?.canonicalMessages.at(-1)?.toolCallId, "restart-call");
});

test("feature restart blocks an interrupted running execution instead of replaying side effects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-running-restart-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const initial = createInitialOrdinaryRunState({
    ...startInput("running-restart-run"),
    runInput: startInput("running-restart-run").input,
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-created",
  });
  await repository.save(initial, 0);
  await repository.save(transitionOrdinaryRun({
    state: initial,
    transition: { type: "start" },
    recordedAt: "2026-01-01T00:00:01.000Z",
    eventId: "event-started",
  }), 1);
  let executions = 0;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { executions += 1; return completedOutcome(); } },
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  const state = await restarted.queries.getRun("running-restart-run");
  assert.deepEqual(state?.status, {
    kind: "blocked",
    reason: {
      code: "execution_continuation_lost",
      message: "The live execution was interrupted when the process restarted.",
    },
    continueBy: "new_turn",
  });
  assert.equal(executions, 0);
});

test("feature restart safely activates a persisted root queued run", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-root-queued-restart-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const input = startInput("root-queued-restart-run");
  await repository.save(createInitialOrdinaryRunState({
    runId: input.runId,
    turn: input.turn,
    runInput: input.input,
    birth: input.birth,
    recordedAt: "2026-01-01T00:00:00.000Z",
    eventId: "event-created",
  }), 0);
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: executionFor("completed"),
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  const completed = await waitForStatus(restarted, input.runId, "completed");
  assert.deepEqual(completed.status, { kind: "completed", answer: "final answer" });
  assert.deepEqual(completed.timeline.map((event) => event.type), ["run.created", "run.started", "run.completed"]);
});

test("activity restart resets an old cursor, drops live deltas, and replays complete approval facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-activity-restart-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const request = confirmation("activity-restart-run");
  const decision = {
    confirmationId: request.confirmationId,
    runId: request.runId,
    decision: "guidance" as const,
    guidance: "Use the safer path",
    decidedAt: "2026-01-01T00:00:10.000Z",
  };
  const first = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: {
      async execute(input) {
        input.onTextDelta?.("volatile delta");
        return {
          status: "approval_required",
          canonicalMessages: [{ role: "user", content: "change file" }],
          toolCalls: [],
          usage: { inputTokens: 4, totalTokens: 4 },
          confirmationRequests: [request],
          continuation: {
            availability: "live_only",
            async decide() { return completedOutcome({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }); },
            async release() { return undefined; },
          },
        };
      },
    },
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  await first.commands.start(startInput("activity-restart-run"));
  await waitForStatus(first, "activity-restart-run", "awaiting_approval");
  const liveReplay = await first.events.replay("activity-restart-run");
  assert.equal(liveReplay?.activities.some((activity) => activity.type === "model.output.delta"), true);
  await first.commands.decideApproval(decision);
  await waitForStatus(first, "activity-restart-run", "completed");
  await first.release();

  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { throw new Error("must not execute"); } },
    now: monotonicClock("2026-01-02T00:00:00.000Z"),
    idFactory: deterministicIds(100),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });
  const replay = await restarted.events.replay("activity-restart-run", liveReplay?.cursor);
  assert.equal(replay?.reset, true);
  assert.equal(replay?.activities.some((activity) => activity.type === "model.output.delta"), false);
  const events = replay?.activities.flatMap((activity) => activity.type === "run.transition" ? [activity.event] : []) ?? [];
  const requested = events.find((event) => event.type === "run.approval_requested");
  const decided = events.find((event) => event.type === "run.approval_decided");
  assert.deepEqual(requested?.type === "run.approval_requested" ? requested.confirmationRequests : undefined, [request]);
  assert.deepEqual(decided?.type === "run.approval_decided" ? decided.decision : undefined, decision);
  assert.deepEqual((await restarted.queries.getRun("activity-restart-run"))?.usage, { inputTokens: 8, outputTokens: 2, totalTokens: 10 });
});

test("feature carries cumulative usage across multiple approval continuations", async (t) => {
  const firstRequest = confirmationWithId("usage-run", "usage-confirmation-1");
  const secondRequest = confirmationWithId("usage-run", "usage-confirmation-2");
  const run = await fixture(t, {
    async execute() {
      return approvalOutcome(firstRequest, { inputTokens: 3, totalTokens: 3 }, async () =>
        approvalOutcome(secondRequest, { inputTokens: 7, totalTokens: 7 }, async () =>
          completedOutcome({ inputTokens: 11, outputTokens: 2, totalTokens: 13 })));
    },
  });
  await run.feature.commands.start(startInput("usage-run"));
  await waitForStatus(run.feature, "usage-run", "awaiting_approval");
  assert.deepEqual((await run.feature.queries.getRun("usage-run"))?.usage, { inputTokens: 3, totalTokens: 3 });
  await run.feature.commands.decideApproval(approvalDecision(firstRequest));
  await waitForApprovalRequest(run.feature, "usage-run", secondRequest.confirmationId);
  assert.deepEqual((await run.feature.queries.getRun("usage-run"))?.usage, { inputTokens: 7, totalTokens: 7 });
  await run.feature.commands.decideApproval(approvalDecision(secondRequest));
  const completed = await waitForStatus(run.feature, "usage-run", "completed");
  assert.deepEqual(completed.usage, { inputTokens: 11, outputTokens: 2, totalTokens: 13 });
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
    turn: { ...secondInput.turn, ordinal: 2, predecessorRunId: "first-run" },
  });
  assert.equal(queued.status.kind, "queued");
  assert.equal(executionCount, 1);

  completePredecessor?.(completedOutcome());
  await waitForStatus(run.feature, "first-run", "completed");
  await waitForStatus(run.feature, "second-run", "completed");
  assert.equal(executionCount, 2);
});

test("successor birth cannot miss a predecessor terminal commit across consecutive races", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-successor-race-"));
  const baseRepository = createFileSystemOrdinaryRunRepository(root);
  const birthGates = new Map<string, ReturnType<typeof createManualGate>>();
  const executions = new Map<string, (outcome: OrdinaryExecutionOutcome) => void>();
  const repository = {
    ...baseRepository,
    async save(state: OrdinaryRunState, expectedRevision: number) {
      const gate = expectedRevision === 0 ? birthGates.get(state.runId) : undefined;
      if (gate !== undefined) {
        gate.enter();
        await gate.released;
      }
      return baseRepository.save(state, expectedRevision);
    },
  };
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: {
      execute(input) {
        return new Promise<OrdinaryExecutionOutcome>((resolve) => {
          let settled = false;
          const settle = (outcome: OrdinaryExecutionOutcome): void => {
            if (settled) return;
            settled = true;
            executions.delete(input.runId);
            resolve(outcome);
          };
          executions.set(input.runId, settle);
          input.abortSignal.addEventListener("abort", () => settle({
            status: "cancelled",
            reason: String(input.abortSignal.reason),
            canonicalMessages: input.messages,
            toolCalls: [],
            usage: {},
          }), { once: true });
        });
      },
    },
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  t.after(async () => {
    for (const gate of birthGates.values()) gate.release();
    for (const settle of executions.values()) settle(completedOutcome());
    await feature.release();
    await removeTestDirectory(root);
  });

  await feature.commands.start(startInput("race-run-1"));
  await waitForExecution(executions, "race-run-1");
  let predecessorRunId = "race-run-1";
  for (let ordinal = 2; ordinal <= 4; ordinal += 1) {
    const runId = `race-run-${ordinal}`;
    const gate = createManualGate();
    birthGates.set(runId, gate);
    const next = startInput(runId);
    const starting = feature.commands.start({
      ...next,
      turn: {
        ...next.turn,
        ordinal,
        predecessorRunId,
      },
    });
    await gate.entered;

    executions.get(predecessorRunId)?.(completedOutcome());
    await waitForStatus(feature, predecessorRunId, "completed");
    gate.release();

    const started = await starting;
    assert.notEqual(started.status.kind, "queued");
    await waitForExecution(executions, runId);
    predecessorRunId = runId;
  }
  executions.get(predecessorRunId)?.(completedOutcome());
  await waitForStatus(feature, predecessorRunId, "completed");
});

test("subscriber failures cannot turn a committed run transition into a command failure", async (t) => {
  const run = await fixture(t, executionFor("completed"));
  run.feature.events.subscribe("listener-run", () => { throw new Error("projection failed"); });
  await run.feature.commands.start(startInput("listener-run"));
  assert.equal((await waitForStatus(run.feature, "listener-run", "completed")).status.kind, "completed");
});

test("the synchronous factory gates concurrent first calls on one recovery pass", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-ready-"));
  const base = createFileSystemOrdinaryRunRepository(root);
  let releaseList: (() => void) | undefined;
  const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
  let listCalls = 0;
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...base,
      async list(limit) { listCalls += 1; await listGate; return base.list(limit); },
    },
    conversationRepository: emptyConversationRepository(),
    execution: executionFor("completed"),
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  const query = feature.queries.getRun("missing");
  const command = feature.commands.start(startInput("ready-run"));
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(listCalls, 1);
    assert.equal(await Promise.race([query.then(() => "settled"), Promise.resolve("pending")]), "pending");
  } finally {
    releaseList?.();
  }
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
    conversationRepository: emptyConversationRepository(),
    execution: executionFor("completed"),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(feature.queries.getRun("missing"), (error: unknown) => error === recoveryError);
  await assert.rejects(feature.commands.start(startInput("never-started")), (error: unknown) => error === recoveryError);
  await feature.release();
});

async function fixture(t: test.TestContext, execution: OrdinaryExecutionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-feature-"));
  const feature = await createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    now: monotonicClock(),
    idFactory: deterministicIds(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
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
        usage: {},
      };
  return { async execute() { return value; } };
}

function completedOutcome(usage = { inputTokens: 8, outputTokens: 2, totalTokens: 10 }): OrdinaryExecutionOutcome {
  return {
    status: "completed",
    answer: "final answer",
    canonicalMessages: [{ role: "user", content: "hello" }, { role: "assistant", content: "final answer" }],
    toolCalls: [],
    usage,
    capabilityResolution: ordinaryCapabilityResolution(),
  };
}

function resolvedToolResult(callId: string): ToolCallResult {
  return {
    callId,
    toolName: "read_file",
    input: { path: "README.md" },
    output: { content: "read result" },
    status: "completed",
    durationMs: 2,
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
  return confirmationWithId(runId, `${runId}-confirmation`);
}

function confirmationWithId(runId: string, confirmationId: string): ConfirmationRequest {
  return {
    confirmationId,
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

function approvalDecision(request: ConfirmationRequest) {
  return {
    confirmationId: request.confirmationId,
    runId: request.runId,
    decision: "approve_once" as const,
    decidedAt: "2026-01-01T00:00:10.000Z",
  };
}

function approvalOutcome(
  request: ConfirmationRequest,
  usage: NonNullable<OrdinaryExecutionOutcome["usage"]>,
  decide: () => Promise<OrdinaryExecutionOutcome>,
): OrdinaryExecutionOutcome {
  return {
    status: "approval_required",
    canonicalMessages: [{ role: "user", content: "hello" }],
    toolCalls: [],
    usage,
    confirmationRequests: [request],
    continuation: {
      availability: "live_only",
      async decide() { return decide(); },
      async release() { return undefined; },
    },
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
    const timeout = setTimeout(async () => {
      unsubscribe();
      const latest = await feature.queries.getRun(runId).catch(() => undefined);
      reject(new Error(`Timed out waiting for ${runId} to reach ${status}; current state is ${JSON.stringify(latest?.status ?? "missing")}`));
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

function createManualGate(): {
  readonly entered: Promise<void>;
  readonly released: Promise<void>;
  enter(): void;
  release(): void;
} {
  let markEntered: (() => void) | undefined;
  let markReleased: (() => void) | undefined;
  return {
    entered: new Promise<void>((resolve) => { markEntered = resolve; }),
    released: new Promise<void>((resolve) => { markReleased = resolve; }),
    enter() { markEntered?.(); },
    release() { markReleased?.(); },
  };
}

async function waitForExecution(
  executions: ReadonlyMap<string, (outcome: OrdinaryExecutionOutcome) => void>,
  runId: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!executions.has(runId)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${runId} execution to start`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitForApprovalRequest(
  feature: Awaited<ReturnType<typeof createOrdinaryAgentFeature>>,
  runId: string,
  confirmationId: string,
): Promise<OrdinaryRunState> {
  const current = await feature.queries.getRun(runId);
  if (current?.status.kind === "awaiting_approval" &&
      current.status.confirmationRequests.some((request) => request.confirmationId === confirmationId)) return current;
  return new Promise<OrdinaryRunState>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${confirmationId}`));
    }, 2_000);
    const unsubscribe = feature.events.subscribe(runId, () => {
      void feature.queries.getRun(runId).then((state) => {
        if (state?.status.kind !== "awaiting_approval" ||
            !state.status.confirmationRequests.some((request) => request.confirmationId === confirmationId)) return;
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

function emptyConversationRepository() {
  return {
    async save() { throw new Error("must not save conversation"); },
    async get() { return undefined; },
    async list() { return []; },
  };
}
