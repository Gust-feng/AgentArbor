import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createAgentSessionLoop } from "../../adapters/intelligence/agent-session-loop.js";
import { FileSystemAgentSessionRepository } from "../../adapters/intelligence/file-system-agent-session-repository.js";
import { createModelProviderBinding } from "../../adapters/intelligence/model-provider-binding.js";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionGateway,
} from "../../domain/tools/index.js";
import type {
  OrdinaryExecutionOutcome,
  OrdinaryExecutionPort,
  OrdinaryRunRepository,
  OrdinaryRunState,
} from "./contracts.js";
import { createFileSystemOrdinaryConversationControlRepository } from "./conversation-control-repository.js";
import { createFileSystemOrdinaryRunRepository } from "./file-system-repository.js";
import { createOrdinaryAgentLoopExecutionPort } from "./agent-loop-execution.js";
import { createOrdinaryAgentFeature } from "./ordinary-agent-feature.js";
import {
  createInitialOrdinaryRunState,
  recordOrdinaryToolResult,
  transitionOrdinaryRun,
} from "./state.js";
import {
  ordinaryAgentSessionRef,
  ordinaryRunBirth,
  ordinaryRunTurn,
} from "./test-support.js";
import type {
  AgentSessionEntryRef,
  AgentSessionExecutionRefs,
  AgentSessionRef,
  AgentSessionRepository,
} from "../model-runtime/agent-session.js";

test("Ordinary feature persists completed, failed, and cancelled outcomes with Session phases", async (t) => {
  const completed = await fixture(t, { execute: async (input) => completedOutcome(input, "done", completed.sessions) });
  await completed.feature.commands.start(startInput("completed"));
  const completedState = await waitForStatus(completed.feature, "completed", "completed");
  assert.equal(completedState.status.kind, "completed");
  assert.equal(completedState.session.phase, "rollbackable");
  assert.equal(completedState.session.phase === "rollbackable" ? completedState.session.endLeafRef.entryId : undefined, "completed-answer");

  const failed = await fixture(t, { execute: async (input) => {
    const session = await prepareSession(input, failed.sessions);
    return { status: "failed", error: { code: "provider_failed", message: "disconnected" }, session, toolCalls: [], usage: {} };
  }});
  await failed.feature.commands.start(startInput("failed"));
  const failedState = await waitForStatus(failed.feature, "failed", "failed");
  assert.equal(failedState.session.phase, "rollbackable");
  assert.equal(failedState.status.kind, "failed");

  const cancelled = await fixture(t, { execute: async (input) => {
    const session = await prepareSession(input, cancelled.sessions);
    await waitForAbort(input.abortSignal);
    throw new Error("execution observed cancellation");
  }});
  await cancelled.feature.commands.start(startInput("cancelled"));
  await waitForSessionPhase(cancelled.feature, "cancelled", "rollbackable");
  const cancellation = cancelled.feature.commands.cancel("cancelled", "cancelled_by_user");
  const cancelledState = await cancellation;
  assert.equal(cancelledState.status.kind, "cancelled");
  assert.equal(cancelledState.session.phase, "rollbackable");
});

test("Pi immediate schema failures become Ordinary facts before the tool-round checkpoint", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-pi-immediate-failure-"));
  const executionEnvironment = new NodeExecutionEnv({ cwd: root });
  const sessions = new FileSystemAgentSessionRepository({
    fileSystem: executionEnvironment,
    sessionsRoot: path.join(root, "sessions"),
  });
  const runId = "pi-schema-failure";
  const sessionRef = await sessions.create({ sessionId: `${runId}-session`, sessionCwd: root });
  const model = fauxProvider();
  model.setResponses([
    fauxAssistantMessage(
      fauxToolCall("strict_tool", {}, { id: "schema-invalid-call" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("continued after the rejected call"),
  ]);
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "pi-immediate-failure-profile",
    apiKey: "test-key",
    model: "pi-immediate-failure-model",
  }, { createResponsesTransport: () => providerStreams(model.provider) });
  const definition: ToolDefinition = {
    name: "strict_tool",
    description: "Read one required path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 } },
      required: ["path"],
      additionalProperties: false,
    },
    metadata: {
      category: "filesystem",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
  const gateway: ToolExecutionGateway = {
    list: () => [definition],
    has: (name) => name === definition.name,
    preflight(request) { return { status: "ready", request }; },
    async execute() { throw new Error("Schema-invalid calls must not reach the executor."); },
  };
  const execution = createOrdinaryAgentLoopExecutionPort({
    resources: {
      async acquire(input) {
        const lease = await sessions.acquire(input.sessionRef);
        const loop = createAgentSessionLoop({
          executionEnvironment,
          modelRegistry: binding.modelRegistry,
          selectedModel: binding.selectedModel,
          agentSession: lease.session,
        });
        return {
          loop,
          resolvedMessages: [{ role: "user", content: input.runInput.userMessage }],
          tools: {
            definitions: [definition],
            gateway,
            context: {
              callerAgentId: "ordinary-agent",
              traceId: input.runId,
              goalId: input.runId,
              confirmationPolicy: "prompt",
            },
            permission: {
              callerAgentId: "ordinary-agent",
              allowedTools: [definition.name],
              confirmationPolicy: "prompt",
            },
          },
          revokeSessionTo: (target) => lease.revokeTo(target),
          releaseSession: () => lease.release(),
          release: () => loop.release(),
        };
      },
    },
  });
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    sessionRepository: sessions,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => {
    await feature.release();
    await executionEnvironment.cleanup();
    await removeTestDirectory(root);
  });

  await feature.commands.start({ ...startInput(runId), sessionRef });
  const state = await waitForStatus(feature, runId, "completed");

  assert.equal(state.status.kind === "completed" ? state.status.answer : undefined, "continued after the rejected call");
  assert.equal(state.pendingToolRound, undefined);
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.toolCalls[0]?.status, "failed");
  assert.equal(state.toolCalls[0]?.errorFacts?.code, "pi_tool_schema_validation_failed");
  assert.equal(state.toolCalls[0]?.failureAttribution, "schema_validation");
  assert.equal(
    state.toolCalls.some((result) => result.errorFacts?.code === "tool_execution_outcome_unknown"),
    false,
  );
  assert.equal(model.state.callCount, 2);
});

test("terminal run snapshot is saved before Session finalization", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-terminal-order-"));
  const base = createFileSystemOrdinaryRunRepository(root);
  const order: string[] = [];
  let feature: ReturnType<typeof createOrdinaryAgentFeature> | undefined;
  const repository: OrdinaryRunRepository = {
    ...base,
    async save(state, revision) {
      if (state.status.kind === "completed") order.push("terminal-save");
      return base.save(state, revision);
    },
  };
  const sessions = new SessionHarness();
  const execution: OrdinaryExecutionPort = {
    execute: (input) => completedOutcome(input, "saved first", sessions),
    async finalizeSession(runId) {
      assert.equal((await feature?.queries.getRun(runId))?.status.kind, "completed");
      order.push("session-finalize");
    },
  };
  feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    sessionRepository: sessions,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature?.release(); await removeTestDirectory(root); });
  await feature.commands.start(startInput("terminal-order"));
  await waitForStatus(feature, "terminal-order", "completed");
  assert.deepEqual(order, ["terminal-save", "session-finalize"]);
});

test("cancellation serializes behind an in-flight Session checkpoint save", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-checkpoint-cancel-"));
  const base = createFileSystemOrdinaryRunRepository(root);
  let markCheckpointEntered!: () => void;
  let releaseCheckpoint!: () => void;
  const checkpointEntered = new Promise<void>((resolve) => { markCheckpointEntered = resolve; });
  const checkpointReleased = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
  let checkpointBlocked = true;
  const repository: OrdinaryRunRepository = {
    ...base,
    async save(state, revision) {
      if (checkpointBlocked && state.runId === "checkpoint-cancel" && state.session.phase === "started") {
        checkpointBlocked = false;
        markCheckpointEntered();
        await checkpointReleased;
      }
      return base.save(state, revision);
    },
  };
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: new SessionHarness(),
    execution: {
      async execute(input) {
        await input.onSessionWriteCheckpoint?.({
          kind: "start_leaf_captured",
          sessionId: input.sessionRef.sessionId,
          startLeafRef: null,
        });
        await waitForAbort(input.abortSignal);
        return { status: "cancelled", reason: "cancelled_by_user", toolCalls: [], usage: {} };
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { releaseCheckpoint(); await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("checkpoint-cancel"));
  await checkpointEntered;
  const cancellation = feature.commands.cancel("checkpoint-cancel", "cancelled_by_user");
  releaseCheckpoint();

  const state = await cancellation;
  assert.equal(state.status.kind, "cancelled");
  assert.equal(state.session.phase, "started");
});

test("approval continuation resumes the exact Session branch and persists resolved tool facts", async (t) => {
  const request = confirmation("approval-run");
  let decideCalled = false;
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions, { toolCalls: [{
        callId: request.toolCallFactId,
        toolName: "shell",
        input: { command: "write" },
      }] });
      const approval: ToolCallResult = {
        callId: request.toolCallFactId,
        toolName: "shell",
        input: { command: "write" },
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: request,
      };
      return {
        status: "approval_required",
        session,
        toolCalls: [approval],
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        confirmationRequests: [request],
        continuation: {
          availability: "live_only" as const,
          async decide() {
            decideCalled = true;
            const result: ToolCallResult = { ...approval, output: { ok: true }, status: "completed", durationMs: 1, confirmationRequest: undefined };
            await input.onToolResult?.(result);
            const resultLeaf = run.sessions.append(input.sessionRef, `${input.runId}-tool-result`);
            await input.onSessionWriteCheckpoint?.({ kind: "tool_result_entries_committed", sessionId: input.sessionRef.sessionId, toolRoundLeafRef: resultLeaf, toolCallIds: [result.callId] });
            return completedOutcome(input, "approved", run.sessions, { ...session, safeLeafRef: resultLeaf, latestLeafRef: resultLeaf });
          },
          async release() {},
        },
      };
    },
  });
  await run.feature.commands.start(startInput("approval-run"));
  await waitForStatus(run.feature, "approval-run", "awaiting_approval");
  await run.feature.commands.decideApproval({
    ownerRunId: "approval-run",
    confirmationId: request.confirmationId,
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:10.000Z",
  });
  const state = await waitForStatus(run.feature, "approval-run", "completed");
  assert.equal(decideCalled, true);
  assert.equal(state.status.kind, "completed");
  assert.equal(state.toolCalls.find((result) => result.callId === request.toolCallFactId)?.status, "completed");
  assert.equal(state.session.phase === "rollbackable" ? state.session.endLeafRef.entryId : undefined, "approval-run-answer");
});

test("successive approval pauses retain the original run cancellation controller", async (t) => {
  const first = confirmation("retained-controller-a");
  const second = confirmation("retained-controller-b");
  let initialSignal: AbortSignal | undefined;
  let resumedSignal: AbortSignal | undefined;
  const run = await fixture(t, {
    async execute(input) {
      initialSignal = input.abortSignal;
      const session = await prepareSession(input, run.sessions, { toolCalls: [
        { callId: first.toolCallFactId, toolName: "shell", input: { command: "a" } },
        { callId: second.toolCallFactId, toolName: "shell", input: { command: "b" } },
      ] });
      return {
        status: "approval_required",
        session,
        toolCalls: [approvalResult(first), approvalResult(second)],
        usage: {},
        confirmationRequests: [first, second],
        continuation: {
          availability: "live_only" as const,
          async decide(input) {
            resumedSignal = input.abortSignal;
            return {
              status: "approval_required" as const,
              session,
              toolCalls: [approvalResult(first), approvalResult(second)],
              usage: {},
              confirmationRequests: [second],
              continuation: {
                availability: "live_only" as const,
                async decide() { throw new Error("second decision is not needed for this regression"); },
                async release() {},
              },
            };
          },
          async release() {},
        },
      };
    },
  });

  await run.feature.commands.start(startInput("retained-controller"));
  await waitForStatus(run.feature, "retained-controller", "awaiting_approval");
  await run.feature.commands.decideApproval({
    ownerRunId: "retained-controller",
    confirmationId: first.confirmationId,
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:10.000Z",
  });
  const awaitingSecond = await waitForStatus(run.feature, "retained-controller", "awaiting_approval");
  assert.deepEqual(awaitingSecond.status.kind === "awaiting_approval"
    ? awaitingSecond.status.confirmationRequests.map((request) => request.confirmationId)
    : [], [second.confirmationId]);
  assert.equal(resumedSignal, initialSignal);

  await run.feature.commands.cancel("retained-controller", "cancelled_between_confirmations");
  assert.equal(initialSignal?.aborted, true);
});

test("a committed context compaction checkpoint becomes a durable Ordinary activity", async (t) => {
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions);
      const compactionEntryRef = run.sessions.append(input.sessionRef, `${input.runId}-compaction`);
      await input.onSessionWriteCheckpoint?.({
        kind: "compaction_entry_committed",
        sessionId: input.sessionRef.sessionId,
        compactionEntryRef,
        tokensBefore: 4_096,
      });
      return completedOutcome(input, "compacted", run.sessions, {
        ...session,
        safeLeafRef: compactionEntryRef,
        latestLeafRef: compactionEntryRef,
        compactionEntryRefs: [compactionEntryRef],
      });
    },
  });

  await run.feature.commands.start(startInput("compaction-activity"));
  await waitForStatus(run.feature, "compaction-activity", "completed");
  const replay = await run.feature.events.replay("compaction-activity");
  const activity = replay?.activities.find((item) =>
    item.type === "run.transition" && item.event.type === "context.compaction.completed");

  assert.equal(activity?.type, "run.transition");
  assert.deepEqual(activity?.type === "run.transition" && activity.event.type === "context.compaction.completed"
    ? { entryId: activity.event.compactionEntryRef.entryId, tokensBefore: activity.event.tokensBefore }
    : undefined, { entryId: "compaction-activity-compaction", tokensBefore: 4_096 });
});

test("release closes a live approval continuation and finalizes its safe Session leaf", async (t) => {
  const request = confirmation("approval-release");
  const order: string[] = [];
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions, { toolCalls: [{ callId: request.toolCallFactId, toolName: "shell", input: { command: "write" } }] });
      return {
        status: "approval_required", session,
        toolCalls: [approvalResult(request)], usage: {}, confirmationRequests: [request],
        continuation: { availability: "live_only" as const, async decide() { throw new Error("must not decide"); }, async release() { order.push("continuation-release"); } },
      };
    },
    async finalizeSession(_runId, target) { order.push(`session-finalize:${target?.entryId ?? "null"}`); },
  });
  await run.feature.commands.start(startInput("approval-release"));
  await waitForStatus(run.feature, "approval-release", "awaiting_approval");
  await run.feature.release();
  assert.deepEqual(order, ["continuation-release", "session-finalize:approval-release-input"]);
});

test("tool facts reconcile in provider order after restart without replaying execution", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-tool-recovery-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const sessionRef = ordinaryAgentSessionRef();
  sessions.ensure(sessionRef);
  const startLeaf = sessions.append(sessionRef, "recovery-input");
  const assistantLeaf = sessions.appendToolCalls(sessionRef, "recovery-assistant", [
    { callId: "call-1", toolName: "read", input: { path: "a.txt" } },
    { callId: "call-2", toolName: "read", input: { path: "b.txt" } },
  ], startLeaf);
  const birth = ordinaryRunBirth();
  let state = createInitialOrdinaryRunState({ runId: "recovery-run", sessionRef, turn: ordinaryRunTurn("recovery-run"), runInput: { userMessage: "inspect" }, birth, recordedAt: clock()(), eventId: "created" });
  state = transitionOrdinaryRun({ state, transition: { type: "start" }, recordedAt: clock()(), eventId: "started" });
  state = transitionOrdinaryRun({ state, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null } }, recordedAt: clock()(), eventId: "checkpoint-1" });
  state = transitionOrdinaryRun({ state, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: sessionRef.sessionId, inputEntryRef: startLeaf } }, recordedAt: clock()(), eventId: "checkpoint-2" });
  state = transitionOrdinaryRun({ state, transition: { type: "record_session_checkpoint", checkpoint: { kind: "assistant_tool_call_entry_committed", sessionId: sessionRef.sessionId, assistantEntryRef: assistantLeaf, toolCallIds: ["call-1", "call-2"] } }, recordedAt: clock()(), eventId: "checkpoint-3" });
  state = { ...state, pendingToolRound: { assistantEntryRef: assistantLeaf, toolCallIds: ["call-1", "call-2"] } };
  state = recordOrdinaryToolResult({ state, result: completedTool("call-1", "a.txt"), recordedAt: "2026-01-01T00:00:04.000Z" });
  await repository.save(state, 0);
  await controls.save({ conversationId: "conversation-1", createdAt: state.timestamps.createdAt, sessionRef }, 0, state.timestamps.createdAt);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({
    repository, conversationRepository: controls, sessionRepository: sessions,
    execution: { async execute() { executions += 1; throw new Error("recovery must not replay execution"); } },
    now: clock("2026-01-01T00:00:10.000Z"), idFactory: ids(20),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });
  const recovered = await waitForStatus(restarted, "recovery-run", "blocked");
  assert.equal(executions, 0);
  assert.equal(recovered.status.kind, "blocked");
  assert.equal(recovered.status.reason.code, "tool_execution_outcome_unknown");
  assert.deepEqual(recovered.toolCalls.map((result) => result.callId), ["call-1", "call-2"]);
  assert.equal(recovered.toolCalls[1]?.errorFacts?.code, "tool_execution_outcome_unknown");
  assert.deepEqual(sessions.reconciled.at(-1)?.orderedResults.map((result) => result.callId), ["call-1", "call-2"]);
  assert.equal(sessions.active(sessionRef)?.entryId, "recovery-assistant-results-1");
});

test("restart converts a lost approval or running execution into an honest blocked state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-restart-blocked-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const sessionRef = ordinaryAgentSessionRef();
  sessions.ensure(sessionRef);
  const inputLeaf = sessions.append(sessionRef, "approval-input");
  const request = confirmation("lost-approval");
  const birth = ordinaryRunBirth();
  let state = createInitialOrdinaryRunState({ runId: "lost-approval", sessionRef, turn: ordinaryRunTurn("lost-approval"), runInput: { userMessage: "write" }, birth, recordedAt: clock()(), eventId: "created" });
  state = transitionOrdinaryRun({ state, transition: { type: "start" }, recordedAt: clock()(), eventId: "started" });
  state = transitionOrdinaryRun({ state, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null } }, recordedAt: clock()(), eventId: "checkpoint-1" });
  state = transitionOrdinaryRun({ state, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: sessionRef.sessionId, inputEntryRef: inputLeaf } }, recordedAt: clock()(), eventId: "checkpoint-2" });
  state = transitionOrdinaryRun({ state, transition: { type: "request_approval", status: { kind: "awaiting_approval", confirmationRequests: [request], continuationAvailability: "live_only" }, toolCalls: [approvalResult(request)], usage: {} }, recordedAt: clock()(), eventId: "approval" });
  await repository.save(state, 0);
  await controls.save({ conversationId: "conversation-1", createdAt: state.timestamps.createdAt, sessionRef }, 0, state.timestamps.createdAt);

  const runningRef = ordinaryAgentSessionRef("running-session");
  sessions.ensure(runningRef);
  const runningInput = sessions.append(runningRef, "running-input");
  let running = createInitialOrdinaryRunState({
    runId: "lost-running",
    sessionRef: runningRef,
    turn: { ...ordinaryRunTurn("lost-running"), conversationId: "conversation-2" },
    runInput: { userMessage: "continue" },
    birth,
    recordedAt: "2026-01-01T00:01:00.000Z",
    eventId: "running-created",
  });
  running = transitionOrdinaryRun({ state: running, transition: { type: "start" }, recordedAt: "2026-01-01T00:01:00.001Z", eventId: "running-started" });
  running = transitionOrdinaryRun({ state: running, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: runningRef.sessionId, startLeafRef: null } }, recordedAt: "2026-01-01T00:01:00.002Z", eventId: "running-checkpoint-1" });
  running = transitionOrdinaryRun({ state: running, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: runningRef.sessionId, inputEntryRef: runningInput } }, recordedAt: "2026-01-01T00:01:00.003Z", eventId: "running-checkpoint-2" });
  await repository.save(running, 0);
  await controls.save({ conversationId: "conversation-2", createdAt: running.timestamps.createdAt, sessionRef: runningRef }, 0, running.timestamps.createdAt);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({ repository, conversationRepository: controls, sessionRepository: sessions, execution: { async execute() { executions += 1; throw new Error("must not execute after restart"); } }, now: clock(), idFactory: ids(40) });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });
  const blocked = await waitForStatus(restarted, "lost-approval", "blocked");
  assert.equal(blocked.status.kind, "blocked");
  assert.equal(blocked.status.reason.code, "confirmation_continuation_lost");
  assert.equal(blocked.toolCalls[0]?.status, "cancelled");
  const interrupted = await waitForStatus(restarted, "lost-running", "blocked");
  assert.equal(interrupted.status.kind, "blocked");
  assert.equal(interrupted.status.reason.code, "execution_continuation_lost");
  assert.equal(executions, 0);
});

test("restart reconciles a lost approval from a rolled-back file-system Session branch", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-fs-approval-recovery-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const fileSystem = new NodeExecutionEnv({ cwd: root });
  const sessionsRoot = path.join(root, "agent-sessions");
  const sessions = new FileSystemAgentSessionRepository({ fileSystem, sessionsRoot });
  const sessionRef = await sessions.create({ sessionId: "fs-approval-session", sessionCwd: root });
  const lease = await sessions.acquire(sessionRef);
  const inputEntryId = await lease.session.appendMessage({ role: "user", content: "write", timestamp: 1 });
  const request = confirmation("fs-lost-approval");
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{
      type: "toolCall",
      id: request.toolCallFactId,
      name: "shell",
      arguments: { command: "write" },
    }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  const inputEntryRef = { sessionId: sessionRef.sessionId, entryId: inputEntryId };
  const assistantEntryRef = { sessionId: sessionRef.sessionId, entryId: assistantEntryId };
  await lease.revokeTo(inputEntryRef);
  await lease.release();

  const birth = ordinaryRunBirth();
  let state = createInitialOrdinaryRunState({
    runId: "fs-lost-approval",
    sessionRef,
    turn: ordinaryRunTurn("fs-lost-approval"),
    runInput: { userMessage: "write" },
    birth,
    recordedAt: clock()(),
    eventId: "created",
  });
  state = transitionOrdinaryRun({ state, transition: { type: "start" }, recordedAt: clock()(), eventId: "started" });
  state = transitionOrdinaryRun({
    state,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null },
    },
    recordedAt: clock()(),
    eventId: "checkpoint-1",
  });
  state = transitionOrdinaryRun({
    state,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: { kind: "input_entry_committed", sessionId: sessionRef.sessionId, inputEntryRef },
    },
    recordedAt: clock()(),
    eventId: "checkpoint-2",
  });
  state = transitionOrdinaryRun({
    state,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: {
        kind: "assistant_tool_call_entry_committed",
        sessionId: sessionRef.sessionId,
        assistantEntryRef,
        toolCallIds: [request.toolCallFactId],
      },
    },
    recordedAt: clock()(),
    eventId: "checkpoint-3",
  });
  state = transitionOrdinaryRun({
    state,
    transition: {
      type: "request_approval",
      status: {
        kind: "awaiting_approval",
        confirmationRequests: [request],
        continuationAvailability: "live_only",
      },
      toolCalls: [approvalResult(request)],
      usage: {},
    },
    recordedAt: clock()(),
    eventId: "approval",
  });
  await repository.save(state, 0);
  await controls.save({
    conversationId: state.turn.conversationId,
    createdAt: state.timestamps.createdAt,
    sessionRef,
  }, 0, state.timestamps.createdAt);

  const restartedSessions = new FileSystemAgentSessionRepository({ fileSystem, sessionsRoot });
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: restartedSessions,
    execution: { async execute() { throw new Error("lost approval recovery must not execute"); } },
    now: clock("2026-01-01T00:00:10.000Z"),
    idFactory: ids(60),
  });
  t.after(async () => {
    await restarted.release();
    await fileSystem.cleanup();
    await removeTestDirectory(root);
  });

  const recovered = await waitForStatus(restarted, "fs-lost-approval", "blocked");
  assert.equal(recovered.status.kind, "blocked");
  assert.equal(recovered.status.reason.code, "confirmation_continuation_lost");
  assert.equal(recovered.pendingToolRound, undefined);
  assert.equal(recovered.toolCalls[0]?.status, "cancelled");
  const branch = await restartedSessions.getActiveBranchEntryRefs(sessionRef);
  assert.deepEqual(branch.slice(0, 2), [inputEntryRef, assistantEntryRef]);
  assert.equal(branch.length, 3);
});

test("restart does not activate a stale root queue when the Session branch is unavailable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-stale-root-recovery-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const sessionRef = ordinaryAgentSessionRef();
  sessions.ensure(sessionRef);
  const birth = ordinaryRunBirth();
  const recordedAt = clock();
  const inputEntryRef = { sessionId: sessionRef.sessionId, entryId: "completed-input" };
  const assistantEntryRef = { sessionId: sessionRef.sessionId, entryId: "completed-answer" };
  let completed = createInitialOrdinaryRunState({
    runId: "completed-root",
    sessionRef,
    turn: ordinaryRunTurn("completed-root"),
    runInput: { userMessage: "completed" },
    birth,
    recordedAt: recordedAt(),
    eventId: "completed-created",
  });
  completed = transitionOrdinaryRun({ state: completed, transition: { type: "start" }, recordedAt: recordedAt(), eventId: "completed-started" });
  completed = transitionOrdinaryRun({ state: completed, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null } }, recordedAt: recordedAt(), eventId: "completed-checkpoint-1" });
  completed = transitionOrdinaryRun({ state: completed, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: sessionRef.sessionId, inputEntryRef } }, recordedAt: recordedAt(), eventId: "completed-checkpoint-2" });
  completed = transitionOrdinaryRun({ state: completed, transition: { type: "record_session_checkpoint", checkpoint: { kind: "assistant_response_entry_committed", sessionId: sessionRef.sessionId, assistantEntryRef } }, recordedAt: recordedAt(), eventId: "completed-checkpoint-3" });
  completed = transitionOrdinaryRun({
    state: completed,
    transition: {
      type: "complete",
      answer: "done",
      session: {
        sessionId: sessionRef.sessionId,
        startLeafRef: null,
        inputEntryRef,
        safeLeafRef: assistantEntryRef,
        latestLeafRef: assistantEntryRef,
        compactionEntryRefs: [],
      },
      toolCalls: [],
      usage: {},
    },
    recordedAt: recordedAt(),
    eventId: "completed-terminal",
  });
  const stale = createInitialOrdinaryRunState({
    runId: "stale-root",
    sessionRef,
    turn: ordinaryRunTurn("stale-root"),
    runInput: { userMessage: "must not run" },
    birth,
    recordedAt: recordedAt(),
    eventId: "stale-created",
  });
  await repository.save(completed, 0);
  await repository.save(stale, 0);
  await controls.save({
    conversationId: completed.turn.conversationId,
    createdAt: completed.timestamps.createdAt,
    sessionRef,
  }, 0, completed.timestamps.createdAt);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: { async execute() { executions += 1; throw new Error("stale queue must not execute"); } },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(60),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  assert.equal((await restarted.queries.getRun("stale-root"))?.status.kind, "queued");
  assert.equal(executions, 0);
  assert.equal(await restarted.queries.getConversation(completed.turn.conversationId), undefined);
});

test("feature release aborts live execution and releases its owned resources", async (t) => {
  const gate = createGate();
  const order: string[] = [];
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions);
      gate.enter();
      await waitForAbort(input.abortSignal, () => { order.push("abort"); });
      return { status: "cancelled", reason: String(input.abortSignal.reason), session, toolCalls: [], usage: {} };
    },
    async finalizeSession() { order.push("finalize"); },
  });
  await run.feature.commands.start(startInput("resource-release"));
  await gate.entered;
  await run.feature.release();
  assert.deepEqual(order, ["abort", "finalize"]);
});

test("a failed Session finalization surfaces a diagnostic and does not permanently deadlock the queue", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-finalize-retry-"));
  const sessions = new SessionHarness();
  let finalizeAttempts = 0;
  const diagnostics: { kind: string; runId?: string }[] = [];
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      execute: async (input) => completedOutcome(input, `answer ${input.runId}`, sessions),
      async finalizeSession() {
        finalizeAttempts += 1;
        // The first finalizeExecutionSession call burns both inline attempts.
        if (finalizeAttempts <= 2) throw new Error("transient finalize failure");
      },
    },
    onDiagnostic: (diagnostic) => diagnostics.push({
      kind: diagnostic.kind,
      ...(diagnostic.kind === "session_finalization_failed" ? { runId: diagnostic.runId } : {}),
    }),
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("finalize-retry-1"));
  await waitForStatus(feature, "finalize-retry-1", "completed");
  assert.deepEqual(diagnostics, [{ kind: "session_finalization_failed", runId: "finalize-retry-1" }]);

  // Scheduling a successor must retry the stuck finalization instead of
  // waiting forever behind a permanently closed barrier.
  const successor = startInput("finalize-retry-2");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "finalize-retry-1" },
  });
  const state = await waitForStatus(feature, "finalize-retry-2", "completed");
  assert.equal(state.status.kind, "completed");
  assert.equal(finalizeAttempts >= 3, true);
});

test("stable terminal facts appear only after terminal commit and notify subscribers", async (t) => {
  const run = await fixture(t, { execute: async (input) => completedOutcome(input, "stable done", run.sessions) });
  const notified: string[] = [];
  const unsubscribe = run.feature.events.subscribeStableTerminalRuns((runId) => notified.push(runId));
  t.after(unsubscribe);

  assert.equal(await run.feature.queries.getStableTerminalRunFacts("stable-facts"), undefined);
  await run.feature.commands.start(startInput("stable-facts"));
  await waitForStatus(run.feature, "stable-facts", "completed");
  const deadline = Date.now() + 5_000;
  while (notified.length === 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(notified, ["stable-facts"]);

  const facts = await run.feature.queries.getStableTerminalRunFacts("stable-facts");
  assert.notEqual(facts, undefined);
  assert.equal(facts?.runId, "stable-facts");
  assert.equal(facts?.status.kind, "completed");
  assert.equal(facts?.userMessage, "stable-facts");
  assert.equal(facts?.executionStarted, true);
  assert.equal(typeof facts?.terminalAt, "string");
  assert.equal(typeof facts?.sourceRevision, "number");
  assert.deepEqual(facts?.toolFacts, []);
  assert.equal("input" in (facts ?? {}), false);
});

test("cancelled run exposes stable facts only after accepted tool results settle", async (t) => {
  const gate = createGate();
  let releaseToolResult!: () => void;
  const toolResultGate = new Promise<void>((resolve) => { releaseToolResult = resolve; });
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions);
      gate.enter();
      await waitForAbort(input.abortSignal);
      // The already accepted tool finishes after cancellation was requested.
      await toolResultGate;
      const late = completedTool("late-tool", "late.txt");
      await input.onToolResult?.(late);
      return { status: "cancelled", reason: String(input.abortSignal.reason), session, toolCalls: [late], usage: {} };
    },
  });
  await run.feature.commands.start(startInput("stable-cancel"));
  await gate.entered;

  const cancellation = run.feature.commands.cancel("stable-cancel", "cancelled_by_user");
  releaseToolResult();
  await cancellation;
  await waitForStableTerminalFacts(run.feature, "stable-cancel");
  const facts = await run.feature.queries.getStableTerminalRunFacts("stable-cancel");
  assert.equal(facts?.status.kind, "cancelled");
  assert.equal(facts?.toolFacts.length, 1);
  assert.equal(facts?.toolFacts[0]?.toolName, "read");
  assert.equal(facts?.toolFacts[0]?.status, "completed");
  assert.equal("output" in (facts?.toolFacts[0] ?? {}), false);
});

test("restart reconciliation makes recovered blocked runs stable and readable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-stable-restart-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const sessionRef = ordinaryAgentSessionRef();
  sessions.ensure(sessionRef);
  const recordedAt = clock();
  let running = createInitialOrdinaryRunState({
    runId: "stable-lost-run",
    sessionRef,
    turn: ordinaryRunTurn("stable-lost-run"),
    runInput: { userMessage: "interrupted work" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "lost-created",
  });
  running = transitionOrdinaryRun({ state: running, transition: { type: "start" }, recordedAt: recordedAt(), eventId: "lost-started" });
  await repository.save(running, 0);
  await controls.save({
    conversationId: running.turn.conversationId,
    createdAt: running.timestamps.createdAt,
    sessionRef,
  }, 0, running.timestamps.createdAt);

  const notified: string[] = [];
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: { async execute() { throw new Error("recovered run must not re-execute"); } },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(80),
  });
  restarted.events.subscribeStableTerminalRuns((runId) => notified.push(runId));
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  await waitForStatus(restarted, "stable-lost-run", "blocked");
  const facts = await waitForStableTerminalFacts(restarted, "stable-lost-run");
  assert.equal(facts.status.kind, "blocked");
  assert.equal(facts.status.kind === "blocked" ? facts.status.reason.code : undefined, "execution_continuation_lost");
  assert.equal(facts.executionStarted, true);
});

test("listRuns plus stable facts reconciliation view skips runs that are not yet stable", async (t) => {
  const gate = createGate();
  const run = await fixture(t, {
    async execute(input) {
      const session = await prepareSession(input, run.sessions);
      gate.enter();
      await waitForAbort(input.abortSignal);
      return { status: "cancelled", reason: String(input.abortSignal.reason), session, toolCalls: [], usage: {} };
    },
  });
  await run.feature.commands.start(startInput("unstable-live"));
  await gate.entered;
  const summaries = await run.feature.queries.listRuns(Number.MAX_SAFE_INTEGER);
  assert.equal(summaries.some((summary) => summary.runId === "unstable-live"), true);
  assert.equal(await run.feature.queries.getStableTerminalRunFacts("unstable-live"), undefined);
  await run.feature.commands.cancel("unstable-live");
  await waitForStableTerminalFacts(run.feature, "unstable-live");
});

async function waitForStableTerminalFacts(
  feature: ReturnType<typeof createOrdinaryAgentFeature>,
  runId: string,
): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof createOrdinaryAgentFeature>["queries"]["getStableTerminalRunFacts"]>>>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const facts = await feature.queries.getStableTerminalRunFacts(runId);
    if (facts !== undefined) return facts;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for stable terminal facts of ${runId}`);
}

async function fixture(t: test.TestContext, execution: OrdinaryExecutionPort) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-feature-"));
  const sessions = new SessionHarness();
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution,
    sessionRepository: sessions,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });
  return { root, feature, sessions };
}

async function prepareSession(input: Parameters<OrdinaryExecutionPort["execute"]>[0], sessions: SessionHarness, options: { readonly toolCalls?: readonly ToolCallRequest[] } = {}): Promise<AgentSessionExecutionRefs> {
  sessions.ensure(input.sessionRef);
  const startLeafRef = await sessions.active(input.sessionRef);
  await input.onSessionWriteCheckpoint?.({ kind: "start_leaf_captured", sessionId: input.sessionRef.sessionId, startLeafRef });
  const inputEntryRef = sessions.append(input.sessionRef, `${input.runId}-input`, startLeafRef);
  await input.onSessionWriteCheckpoint?.({ kind: "input_entry_committed", sessionId: input.sessionRef.sessionId, inputEntryRef });
  let safeLeafRef = inputEntryRef;
  if (options.toolCalls !== undefined) {
    const assistantEntryRef = sessions.appendToolCalls(input.sessionRef, `${input.runId}-tool-call`, options.toolCalls, inputEntryRef);
    await input.onSessionWriteCheckpoint?.({ kind: "assistant_tool_call_entry_committed", sessionId: input.sessionRef.sessionId, assistantEntryRef, toolCallIds: options.toolCalls.map((call) => call.callId) });
  }
  return { sessionId: input.sessionRef.sessionId, startLeafRef, inputEntryRef, safeLeafRef, latestLeafRef: safeLeafRef, compactionEntryRefs: [] };
}

async function completedOutcome(input: Parameters<OrdinaryExecutionPort["execute"]>[0], answer: string, sessions: SessionHarness, prepared?: AgentSessionExecutionRefs): Promise<OrdinaryExecutionOutcome> {
  const session = prepared ?? await prepareSession(input, sessions);
  const assistantEntryRef = sessions.append(input.sessionRef, `${input.runId}-answer`);
  await input.onSessionWriteCheckpoint?.({ kind: "assistant_response_entry_committed", sessionId: input.sessionRef.sessionId, assistantEntryRef });
  return { status: "completed", answer, session: { ...session, latestLeafRef: assistantEntryRef }, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
}

function startInput(runId: string, conversationId = "conversation-1"): { runId: string; sessionRef: AgentSessionRef; turn: ReturnType<typeof ordinaryRunTurn>; input: { userMessage: string }; birth: ReturnType<typeof ordinaryRunBirth> } {
  const sessionRef = ordinaryAgentSessionRef();
  return { runId, sessionRef, turn: { ...ordinaryRunTurn(runId), conversationId }, input: { userMessage: runId }, birth: ordinaryRunBirth() };
}

function confirmation(runId: string): ConfirmationRequest {
  return { confirmationId: `${runId}-confirmation`, toolCallFactId: `${runId}:tool-fact`, title: "Confirm command", actionSummary: "Run a command", affectedResources: ["workspace"], riskLevel: "medium", resumeAvailability: "live", requestedAt: "2026-01-01T00:00:02.000Z", sourceRefs: [] };
}
function approvalResult(request: ConfirmationRequest): ToolCallResult {
  return { callId: request.toolCallFactId, toolName: "shell", input: { command: "write" }, output: undefined, status: "approval_required", durationMs: 0, confirmationRequest: request };
}
function completedTool(callId: string, file: string): ToolCallResult {
  return { callId, toolName: "read", input: { path: file }, output: { content: file }, status: "completed", durationMs: 1 };
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
async function waitForSessionPhase(feature: ReturnType<typeof createOrdinaryAgentFeature>, runId: string, phase: OrdinaryRunState["session"]["phase"]): Promise<OrdinaryRunState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await feature.queries.getRun(runId);
    if (state?.session.phase === phase) return state;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${runId} Session phase ${phase}`);
}
async function waitForAbort(signal: AbortSignal, onAbort?: () => void): Promise<void> {
  if (signal.aborted) { onAbort?.(); return; }
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => { onAbort?.(); resolve(); }, { once: true }));
}

function clock(start = "2026-01-01T00:00:00.000Z") {
  let value = Date.parse(start);
  return () => new Date(value++).toISOString();
}
function ids(initial = 0) {
  let value = initial;
  return (prefix: string) => `${prefix}-${++value}`;
}
function providerStreams(provider: ReturnType<typeof fauxProvider>["provider"]): ProviderStreams {
  return {
    stream: provider.stream.bind(provider),
    streamSimple: provider.streamSimple.bind(provider),
  };
}
function createGate() {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  return { entered, enter };
}

test("settled terminal runs release their in-memory activity stream and replay from persistence", async (t) => {
  const run = await fixture(t, { execute: async (input) => completedOutcome(input, "evicted answer", run.sessions) });
  await run.feature.commands.start(startInput("evicted-run"));
  await waitForStatus(run.feature, "evicted-run", "completed");

  // 无订阅者的稳定终态 run：流应已被驱逐；replay 必须仍能从持久化状态重建完整活动。
  const first = await run.feature.events.replay("evicted-run");
  assert.notEqual(first, undefined);
  assert.equal(first!.activities.length > 0, true, "replay must rebuild activities from the persisted timeline");
  assert.equal(
    first!.activities.every((activity) => activity.durability === "durable"),
    true,
    "a rebuilt terminal stream only contains durable facts",
  );

  // 重建的投影必须游标稳定：两次 replay 之间续用游标不能触发 reset。
  const second = await run.feature.events.replay("evicted-run", first!.cursor);
  assert.equal(second!.reset, false, "repeated terminal replays must stay cursor-compatible");
  assert.deepEqual(second!.activities, [], "an up-to-date cursor sees no new activities");

  // 终态答案不因驱逐而丢失。
  const terminalTransition = first!.activities.filter((activity) => activity.type === "run.transition").at(-1);
  assert.equal(terminalTransition?.type, "run.transition");

  // 订阅期间流被固定；最后一个订阅者退订后再次释放，replay 依旧可用。
  const unsubscribe = run.feature.events.subscribe("evicted-run", () => undefined);
  const whileSubscribed = await run.feature.events.replay("evicted-run");
  assert.notEqual(whileSubscribed, undefined);
  unsubscribe();
  const afterUnsubscribe = await run.feature.events.replay("evicted-run");
  assert.equal(afterUnsubscribe!.activities.length, first!.activities.length,
    "the activity projection must survive stream release cycles unchanged");
});
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

type SessionNode = { readonly ref: AgentSessionEntryRef; readonly parent: AgentSessionEntryRef | null };
class SessionHarness implements AgentSessionRepository {
  readonly reconciled: Array<{ readonly orderedResults: readonly ToolCallResult[] }> = [];
  private readonly roots = new Map<string, AgentSessionRef>();
  private readonly nodes = new Map<string, Map<string, SessionNode>>();
  private readonly activeLeaves = new Map<string, AgentSessionEntryRef | null>();
  private readonly calls = new Map<string, readonly ToolCallRequest[]>();
  ensure(ref: AgentSessionRef): void { this.roots.set(ref.sessionId, ref); this.nodes.set(ref.sessionId, this.nodes.get(ref.sessionId) ?? new Map()); if (!this.activeLeaves.has(ref.sessionId)) this.activeLeaves.set(ref.sessionId, null); }
  active(ref: AgentSessionRef): AgentSessionEntryRef | null { return this.activeLeaves.get(ref.sessionId) ?? null; }
  append(ref: AgentSessionRef, entryId: string, parent = this.active(ref)): AgentSessionEntryRef { this.ensure(ref); const entry = { sessionId: ref.sessionId, entryId }; this.nodes.get(ref.sessionId)!.set(entryId, { ref: entry, parent }); this.activeLeaves.set(ref.sessionId, entry); return entry; }
  appendToolCalls(ref: AgentSessionRef, entryId: string, calls: readonly ToolCallRequest[], parent = this.active(ref)): AgentSessionEntryRef { const entry = this.append(ref, entryId, parent); this.calls.set(`${ref.sessionId}:${entryId}`, calls.map((call) => structuredClone(call))); return entry; }
  async create(input: { readonly sessionId: string; readonly sessionCwd: string }): Promise<AgentSessionRef> { const ref = { ...ordinaryAgentSessionRef(input.sessionId), sessionCwd: input.sessionCwd }; this.ensure(ref); return ref; }
  async getActiveLeaf(ref: AgentSessionRef): Promise<AgentSessionEntryRef | null> { return this.active(ref); }
  async moveActiveLeaf(ref: AgentSessionRef, target: AgentSessionEntryRef | null): Promise<AgentSessionEntryRef | null> { this.ensure(ref); this.activeLeaves.set(ref.sessionId, target); return target; }
  async getActiveBranchEntryRefs(ref: AgentSessionRef): Promise<readonly AgentSessionEntryRef[]> { const result: AgentSessionEntryRef[] = []; let current = this.active(ref); while (current !== null) { result.push(current); current = this.nodes.get(ref.sessionId)?.get(current.entryId)?.parent ?? null; } return result.reverse(); }
  async readToolCalls(input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef }): Promise<readonly ToolCallRequest[]> { return this.calls.get(`${input.sessionRef.sessionId}:${input.assistantEntryRef.entryId}`) ?? []; }
  async reconcileToolResultEntries(input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef; readonly orderedResults: readonly ToolCallResult[] }): Promise<AgentSessionEntryRef> { this.reconciled.push({ orderedResults: structuredClone(input.orderedResults) }); return this.append(input.sessionRef, `${input.assistantEntryRef.entryId}-results-${this.reconciled.length}`, input.assistantEntryRef); }
  async delete(ref: AgentSessionRef): Promise<void> { this.roots.delete(ref.sessionId); this.nodes.delete(ref.sessionId); this.activeLeaves.delete(ref.sessionId); }
}
