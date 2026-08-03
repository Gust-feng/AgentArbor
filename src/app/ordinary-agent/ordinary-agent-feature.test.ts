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
  createFileSystemOrdinaryManagedAttachmentRepository,
  OrdinaryManagedAttachmentRepositoryError,
  type OrdinaryManagedAttachmentRepository,
} from "./managed-attachment-repository.js";
import {
  createInitialOrdinaryRunState,
  recordOrdinaryNestedToolRequests,
  recordOrdinaryToolResult,
  transitionOrdinaryRun,
} from "./state.js";
import {
  ordinaryAgentSessionRef,
  ordinaryRunBirth,
  ordinaryRunTurn,
} from "./test-support.js";
import type {
  AgentLoopAgentTool,
} from "../model-runtime/agent-loop.js";
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

  const replay = await feature.events.replay(runId);
  assert.deepEqual(replay?.activities.filter((activity) => activity.type === "model.output.completed")
    .map((activity) => activity.content), ["", "continued after the rejected call"]);
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

test("Ordinary persists delegated nested write-ahead before execution and closes it with the result", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-nested-write-ahead-integration-"));
  const executionEnvironment = new NodeExecutionEnv({ cwd: root });
  const sessions = new FileSystemAgentSessionRepository({
    fileSystem: executionEnvironment,
    sessionsRoot: path.join(root, "sessions"),
  });
  const runId = "nested-write-ahead-integration";
  const sessionRef = await sessions.create({ sessionId: `${runId}-session`, sessionCwd: root });
  const baseRepository = createFileSystemOrdinaryRunRepository(root);
  let nestedWriteAheadSaved = false;
  const repository: OrdinaryRunRepository = {
    ...baseRepository,
    async save(state, expectedRevision) {
      const saved = await baseRepository.save(state, expectedRevision);
      if (state.pendingNestedToolCalls !== undefined) nestedWriteAheadSaved = true;
      return saved;
    },
  };
  const model = fauxProvider();
  model.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "parent-agent-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "nested-read" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated result"),
    fauxAssistantMessage("parent result"),
  ]);
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "nested-write-ahead-profile",
    apiKey: "test-key",
    model: "nested-write-ahead-model",
  }, { createResponsesTransport: () => providerStreams(model.provider) });
  const readDefinition: ToolDefinition = {
    name: "read",
    description: "Read one file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    metadata: {
      category: "workspace",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
  const agentDefinition: ToolDefinition = {
    name: "agent_call",
    description: "Call one bounded specialist Agent.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
      additionalProperties: false,
    },
    metadata: {
      category: "other",
      riskLevel: "medium",
      operationType: "read-write",
      requiresConfirmation: false,
    },
  };
  let executeCount = 0;
  const gateway: ToolExecutionGateway = {
    list: () => [readDefinition],
    has: (name) => name === readDefinition.name,
    preflight: (request) => ({ status: "ready", request }),
    async execute(request) {
      assert.equal(nestedWriteAheadSaved, true);
      executeCount += 1;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    async deliverResult(result) { return result; },
  };
  const agentTool: AgentLoopAgentTool = {
    toolName: "agent_call",
    async resolve() {
      return {
        agentName: "reviewer",
        instructions: "Inspect the delegated file.",
        input: "Read README.md.",
        callerAgentId: "sub-agent:reviewer",
        allowedTools: ["read"],
      };
    },
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
            definitions: [readDefinition, agentDefinition],
            gateway,
            context: {
              callerAgentId: "ordinary-agent",
              traceId: input.runId,
              goalId: input.runId,
              confirmationPolicy: "prompt",
            },
            permission: {
              callerAgentId: "ordinary-agent",
              allowedTools: [readDefinition.name, agentDefinition.name],
              confirmationPolicy: "prompt",
            },
          },
          agentTools: [agentTool],
          revokeSessionTo: (target) => lease.revokeTo(target),
          releaseSession: () => lease.release(),
          release: () => loop.release(),
        };
      },
    },
  });
  const feature = createOrdinaryAgentFeature({
    repository,
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

  const nested = state.toolCalls.find((result) => result.parentToolCallFactId === "parent-agent-call");
  assert.equal(state.pendingNestedToolCalls, undefined);
  assert.equal(nested?.factId, "agent-tool:17:parent-agent-call/tool:nested-read");
  assert.equal(nested?.status, "completed");
  assert.equal(state.toolCalls.find((result) => result.callId === "parent-agent-call")?.status, "completed");
  assert.equal(nestedWriteAheadSaved, true);
  assert.equal(executeCount, 1);
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

test("run birth rolls back newly claimed managed attachments when the run snapshot cannot be saved", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-claim-rollback-"));
  const attachmentRoot = path.join(root, "managed-attachments");
  const managedRepository = createFileSystemOrdinaryManagedAttachmentRepository(attachmentRoot);
  const instanceId = "instance-rollback";
  const attachmentId = "ordinary-managed-attachment-rollback";
  await managedRepository.createDraft({
    attachmentId,
    instanceId,
    originalName: "notes.txt",
    mimeType: "text/plain",
    content: Buffer.from("rollback me", "utf8"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const base = createFileSystemOrdinaryRunRepository(root);
  const repository: OrdinaryRunRepository = {
    ...base,
    async save() {
      throw new Error("run snapshot unavailable");
    },
  };
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { throw new Error("execution must not start"); } },
    sessionRepository: new SessionHarness(),
    managedAttachmentRepository: managedRepository,
    managedAttachmentInstanceId: instanceId,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release().catch(() => undefined); await removeTestDirectory(root); });

  const input = startInput("managed-claim-rollback");
  await assert.rejects(feature.commands.start({
    ...input,
    input: {
      userMessage: input.input.userMessage,
      taskSoil: {
        contextRefs: [{
          attachmentId,
          ref: `uploaded-attachment:${attachmentId}`,
          kind: "file",
          title: "notes.txt",
        }],
        permissionBoundaryRefs: [`read:uploaded-attachment:${attachmentId}`],
      },
    },
  }), /run snapshot unavailable/u);

  const restored = await managedRepository.get(attachmentId);
  assert.equal(restored.owner.kind, "draft");
  assert.equal(restored.owner.kind === "draft" ? restored.owner.instanceId : undefined, instanceId);
});

test("run birth compensates attachment claims reported after a partial multi-file write", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-partial-claim-"));
  const attachmentRoot = path.join(root, "managed-attachments");
  const baseManagedRepository = createFileSystemOrdinaryManagedAttachmentRepository(attachmentRoot);
  const instanceId = "instance-partial-claim";
  const attachmentIds = ["partial-first", "partial-second"];
  let releaseAttempts = 0;
  let resolveRollbackRetry!: () => void;
  const rollbackRetried = new Promise<void>((resolve) => { resolveRollbackRetry = resolve; });
  const diagnostics: string[] = [];
  for (const attachmentId of attachmentIds) {
    await baseManagedRepository.createDraft({
      attachmentId,
      instanceId,
      originalName: attachmentId + ".txt",
      content: Buffer.from(attachmentId, "utf8"),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const managedRepository: OrdinaryManagedAttachmentRepository = {
    createDraft: baseManagedRepository.createDraft.bind(baseManagedRepository),
    get: baseManagedRepository.get.bind(baseManagedRepository),
    resolveContentPath: baseManagedRepository.resolveContentPath.bind(baseManagedRepository),
    async claimForConversation(input) {
      const partial = await baseManagedRepository.claimForConversation({
        ...input,
        attachmentIds: [input.attachmentIds[0]!],
      });
      throw new OrdinaryManagedAttachmentRepositoryError(
        "ordinary_managed_attachment_storage_failure",
        "simulated second owner write failure",
        {
          partialClaim: {
            instanceId: input.instanceId,
            conversationId: input.conversationId,
            attachmentIds: partial.newlyClaimedAttachmentIds,
          },
        },
      );
    },
    async releaseConversationClaim(input) {
      releaseAttempts += 1;
      if (releaseAttempts === 1) {
        throw new OrdinaryManagedAttachmentRepositoryError(
          "ordinary_managed_attachment_storage_failure",
          "simulated rollback write failure",
        );
      }
      await baseManagedRepository.releaseConversationClaim(input);
      resolveRollbackRetry();
    },
    discardDraft: baseManagedRepository.discardDraft.bind(baseManagedRepository),
    deleteConversation: baseManagedRepository.deleteConversation.bind(baseManagedRepository),
    removeDraftsOwnedBy: baseManagedRepository.removeDraftsOwnedBy.bind(baseManagedRepository),
    recoverAtStartup: baseManagedRepository.recoverAtStartup.bind(baseManagedRepository),
  };
  const sessions = new SessionHarness();
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { async execute() { throw new Error("execution must not start"); } },
    sessionRepository: sessions,
    managedAttachmentRepository: managedRepository,
    managedAttachmentInstanceId: instanceId,
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "managed_attachment_claim_rollback_failed") diagnostics.push(diagnostic.kind);
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release().catch(() => undefined); await removeTestDirectory(root); });

  const input = startInput("partial-claim");
  await assert.rejects(feature.commands.start({
    ...input,
    input: {
      userMessage: input.input.userMessage,
      taskSoil: {
        contextRefs: attachmentIds.map((attachmentId) => ({
          attachmentId,
          ref: "uploaded-attachment:" + attachmentId,
          kind: "file" as const,
        })),
        permissionBoundaryRefs: attachmentIds.map((attachmentId) => "read:uploaded-attachment:" + attachmentId),
      },
    },
  }), (error: unknown) => error instanceof OrdinaryManagedAttachmentRepositoryError &&
    error.code === "ordinary_managed_attachment_storage_failure");

  await rollbackRetried;
  assert.equal(releaseAttempts, 2);
  assert.deepEqual(diagnostics, ["managed_attachment_claim_rollback_failed"]);
  assert.deepEqual((await baseManagedRepository.get(attachmentIds[0]!)).owner, { kind: "draft", instanceId });
  assert.deepEqual((await baseManagedRepository.get(attachmentIds[1]!)).owner, { kind: "draft", instanceId });
});

test("a delayed claim rollback cannot release an attachment adopted by a same-submission retry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-claim-adoption-"));
  const attachmentRoot = path.join(root, "managed-attachments");
  const baseManagedRepository = createFileSystemOrdinaryManagedAttachmentRepository(attachmentRoot);
  const instanceId = "instance-claim-adoption";
  const attachmentId = "claim-adoption";
  await baseManagedRepository.createDraft({
    attachmentId,
    instanceId,
    originalName: "adopted.txt",
    content: Buffer.from("adopted", "utf8"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  let claimAttempts = 0;
  let releaseAttempts = 0;
  const managedRepository: OrdinaryManagedAttachmentRepository = {
    createDraft: baseManagedRepository.createDraft.bind(baseManagedRepository),
    get: baseManagedRepository.get.bind(baseManagedRepository),
    resolveContentPath: baseManagedRepository.resolveContentPath.bind(baseManagedRepository),
    async claimForConversation(input) {
      claimAttempts += 1;
      return await baseManagedRepository.claimForConversation(input);
    },
    async releaseConversationClaim(input) {
      releaseAttempts += 1;
      if (releaseAttempts === 1) {
        throw new OrdinaryManagedAttachmentRepositoryError(
          "ordinary_managed_attachment_storage_failure",
          "simulated first rollback failure",
        );
      }
      await baseManagedRepository.releaseConversationClaim(input);
    },
    discardDraft: baseManagedRepository.discardDraft.bind(baseManagedRepository),
    deleteConversation: baseManagedRepository.deleteConversation.bind(baseManagedRepository),
    removeDraftsOwnedBy: baseManagedRepository.removeDraftsOwnedBy.bind(baseManagedRepository),
    recoverAtStartup: baseManagedRepository.recoverAtStartup.bind(baseManagedRepository),
  };
  const baseRunRepository = createFileSystemOrdinaryRunRepository(root);
  let runSaveAttempts = 0;
  const runRepository: OrdinaryRunRepository = {
    ...baseRunRepository,
    async save(state, revision) {
      runSaveAttempts += 1;
      if (runSaveAttempts === 1) throw new Error("first run snapshot unavailable");
      return await baseRunRepository.save(state, revision);
    },
  };
  const sessions = new SessionHarness();
  const feature = createOrdinaryAgentFeature({
    repository: runRepository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    execution: { execute: (input) => completedOutcome(input, "adopted answer", sessions) },
    sessionRepository: sessions,
    managedAttachmentRepository: managedRepository,
    managedAttachmentInstanceId: instanceId,
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release().catch(() => undefined); await removeTestDirectory(root); });

  const runInput = {
    userMessage: "retry this submission",
    taskSoil: {
      contextRefs: [{ attachmentId, ref: `uploaded-attachment:${attachmentId}`, kind: "file" as const }],
      permissionBoundaryRefs: [`read:uploaded-attachment:${attachmentId}`],
    },
  };
  await assert.rejects(feature.commands.submitTurn({
    submissionId: "claim-adoption-submission",
    input: runInput,
    birth: ordinaryRunBirth(),
  }), /first run snapshot unavailable/u);

  const retried = await feature.commands.submitTurn({
    submissionId: "claim-adoption-submission",
    input: runInput,
    birth: ordinaryRunBirth(),
  });
  await waitForStatus(feature, retried.run.runId, "completed");
  await new Promise<void>((resolve) => setTimeout(resolve, 400));

  assert.equal(releaseAttempts, 1);
  assert.deepEqual((await baseManagedRepository.get(attachmentId)).owner, {
    kind: "conversation",
    conversationId: retried.run.turn.conversationId,
  });
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

test("cancellation aborts execution only after its durable terminal save succeeds", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-save-order-"));
  const base = createFileSystemOrdinaryRunRepository(root);
  const order: string[] = [];
  let rejectCancellationSave = true;
  const repository: OrdinaryRunRepository = {
    ...base,
    async save(state, revision) {
      if (state.status.kind === "cancelled") {
        if (rejectCancellationSave) {
          rejectCancellationSave = false;
          order.push("cancel-save-failed");
          throw new Error("cancel snapshot unavailable");
        }
        order.push("cancel-save");
      }
      return base.save(state, revision);
    },
  };
  const gate = createGate();
  const feature = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: new SessionHarness(),
    execution: {
      async execute(input) {
        gate.enter();
        await waitForAbort(input.abortSignal, () => { order.push("abort"); });
        return { status: "cancelled", reason: String(input.abortSignal.reason), toolCalls: [], usage: {} };
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("cancel-save-order"));
  await gate.entered;
  await assert.rejects(feature.commands.cancel("cancel-save-order"), /cancel snapshot unavailable/u);
  assert.deepEqual(order, ["cancel-save-failed"]);
  assert.equal((await feature.queries.getRun("cancel-save-order"))?.status.kind, "running");

  const cancelled = await feature.commands.cancel("cancel-save-order");
  assert.equal(cancelled.status.kind, "cancelled");
  assert.deepEqual(order, ["cancel-save-failed", "cancel-save", "abort"]);
});

test("cancellation returns after its durable commit while Session cleanup continues in the background", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-background-finalize-"));
  const sessions = new SessionHarness();
  const executionStarted = createGate();
  const finalizationStarted = createGate();
  let releaseFinalization!: () => void;
  const finalizationReleased = new Promise<void>((resolve) => { releaseFinalization = resolve; });
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const session = await prepareSession(input, sessions);
        if (input.runId === "background-finalize-predecessor") {
          executionStarted.enter();
          await waitForAbort(input.abortSignal);
          return { status: "cancelled", reason: String(input.abortSignal.reason), session, toolCalls: [], usage: {} };
        }
        return completedOutcome(input, "successor completed", sessions, session);
      },
      async finalizeSession(runId) {
        if (runId !== "background-finalize-predecessor") return;
        finalizationStarted.enter();
        await finalizationReleased;
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { releaseFinalization(); await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("background-finalize-predecessor"));
  await executionStarted.entered;
  const successor = startInput("background-finalize-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "background-finalize-predecessor" },
  });

  const cancelled = await feature.commands.cancel("background-finalize-predecessor");
  assert.equal(cancelled.status.kind, "cancelled");
  await finalizationStarted.entered;
  assert.equal((await feature.queries.getRun(successor.runId))?.status.kind, "queued");

  releaseFinalization();
  assert.equal((await waitForStatus(feature, successor.runId, "completed")).status.kind, "completed");
});

test("repeated cancellation coalesces finalization and feature release waits for the owned cleanup", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-cleanup-owner-"));
  const sessions = new SessionHarness();
  const executionStarted = createGate();
  const finalizationStarted = createGate();
  let releaseFinalization!: () => void;
  const finalizationReleased = new Promise<void>((resolve) => { releaseFinalization = resolve; });
  let finalizeCalls = 0;
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const session = await prepareSession(input, sessions);
        executionStarted.enter();
        await waitForAbort(input.abortSignal);
        return { status: "cancelled", reason: String(input.abortSignal.reason), session, toolCalls: [], usage: {} };
      },
      async finalizeSession() {
        finalizeCalls += 1;
        finalizationStarted.enter();
        await finalizationReleased;
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => {
    releaseFinalization();
    await feature.release().catch(() => undefined);
    await removeTestDirectory(root);
  });

  await feature.commands.start(startInput("cancel-cleanup-owner"));
  await executionStarted.entered;
  assert.equal((await feature.commands.cancel("cancel-cleanup-owner")).status.kind, "cancelled");
  await finalizationStarted.entered;
  assert.equal((await feature.commands.cancel("cancel-cleanup-owner")).status.kind, "cancelled");
  assert.equal(finalizeCalls, 1);

  let releaseCompleted = false;
  const release = feature.release().then(() => { releaseCompleted = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(releaseCompleted, false);
  releaseFinalization();
  await release;
  assert.equal(finalizeCalls, 1);
});

test("cancelled approval retries release before opening stable terminal facts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-continuation-cleanup-"));
  const sessions = new SessionHarness();
  const request = confirmation("cancel-continuation-cleanup");
  const diagnostics: Array<{ readonly phase: string; readonly message: string }> = [];
  const firstReleaseFailed = createGate();
  let releaseAttempts = 0;
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const session = await prepareSession(input, sessions, {
          toolCalls: [{ callId: request.toolCallFactId, toolName: "shell", input: { command: "write" } }],
        });
        return {
          status: "approval_required" as const,
          session,
          toolCalls: [approvalResult(request)],
          usage: {},
          confirmationRequests: [request],
          continuation: {
            availability: "live_only" as const,
            async decide() { throw new Error("decision is not expected"); },
            async release() {
              releaseAttempts += 1;
              if (releaseAttempts === 1) {
                firstReleaseFailed.enter();
                throw new Error("continuation release failed");
              }
            },
          },
        };
      },
    },
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "cancellation_cleanup_failed") {
        diagnostics.push({ phase: diagnostic.phase, message: String(diagnostic.error) });
      }
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("cancel-continuation-cleanup"));
  await waitForStatus(feature, "cancel-continuation-cleanup", "awaiting_approval");
  assert.equal((await feature.commands.cancel("cancel-continuation-cleanup")).status.kind, "cancelled");
  await firstReleaseFailed.entered;
  assert.equal(await feature.queries.getStableTerminalRunFacts("cancel-continuation-cleanup"), undefined);
  const stable = await waitForStableTerminalFacts(feature, "cancel-continuation-cleanup");

  assert.equal(stable.status.kind, "cancelled");
  assert.equal(stable.toolFacts.length, 1);
  assert.equal(releaseAttempts, 2);
  assert.deepEqual(diagnostics, [{ phase: "continuation_release", message: "Error: continuation release failed" }]);
});

test("cancelled approval waits for continuation release before terminal settlement", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-continuation-barrier-"));
  const sessions = new SessionHarness();
  const request = confirmation("cancel-continuation-barrier");
  const releaseStarted = createGate();
  let allowRelease!: () => void;
  const releaseAllowed = new Promise<void>((resolve) => { allowRelease = resolve; });
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const session = await prepareSession(input, sessions, {
          toolCalls: [{ callId: request.toolCallFactId, toolName: "shell", input: { command: "write" } }],
        });
        const cancelledResult: ToolCallResult = {
          callId: request.toolCallFactId,
          toolName: "shell",
          input: { command: "write" },
          output: undefined,
          status: "cancelled",
          durationMs: 1,
        };
        return {
          status: "approval_required" as const,
          session,
          toolCalls: [approvalResult(request)],
          usage: {},
          confirmationRequests: [request],
          continuation: {
            availability: "live_only" as const,
            async decide() { throw new Error("decision is not expected"); },
            async release() {
              releaseStarted.enter();
              await releaseAllowed;
              await input.onToolResult?.(cancelledResult);
            },
          },
        };
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("cancel-continuation-barrier"));
  await waitForStatus(feature, "cancel-continuation-barrier", "awaiting_approval");
  await feature.commands.cancel("cancel-continuation-barrier");
  await releaseStarted.entered;
  assert.equal(await feature.queries.getStableTerminalRunFacts("cancel-continuation-barrier"), undefined);

  allowRelease();
  const stable = await waitForStableTerminalFacts(feature, "cancel-continuation-barrier");
  const state = await feature.queries.getRun("cancel-continuation-barrier");
  assert.equal(stable.toolFacts[0]?.status, "cancelled");
  assert.equal(state?.pendingToolRound, undefined);
  assert.equal(state?.toolCalls[0]?.status, "cancelled");
});

test("cancelled approval retries failed Session finalization before activating its queued successor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cancel-finalize-retry-"));
  const sessions = new SessionHarness();
  const request = confirmation("cancel-finalize-retry");
  let finalizeAttempts = 0;
  const executed: string[] = [];
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        executed.push(input.runId);
        if (input.runId !== "cancel-finalize-predecessor") {
          return completedOutcome(input, "successor completed", sessions);
        }
        const session = await prepareSession(input, sessions, {
          toolCalls: [{ callId: request.toolCallFactId, toolName: "shell", input: { command: "write" } }],
        });
        return {
          status: "approval_required" as const,
          session,
          toolCalls: [approvalResult(request)],
          usage: {},
          confirmationRequests: [request],
          continuation: {
            availability: "live_only" as const,
            async decide() { throw new Error("decision is not expected"); },
            async release() { return undefined; },
          },
        };
      },
      async finalizeSession(runId) {
        if (runId !== "cancel-finalize-predecessor") return;
        finalizeAttempts += 1;
        if (finalizeAttempts <= 2) throw new Error("transient Session finalization failure");
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("cancel-finalize-predecessor"));
  await waitForStatus(feature, "cancel-finalize-predecessor", "awaiting_approval");
  const successor = startInput("cancel-finalize-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "cancel-finalize-predecessor" },
  });
  await feature.commands.cancel("cancel-finalize-predecessor");

  assert.equal((await waitForStatus(feature, successor.runId, "completed")).status.kind, "completed");
  assert.deepEqual(executed, ["cancel-finalize-predecessor", "cancel-finalize-successor"]);
  assert.equal(finalizeAttempts, 3);
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

test("approval continuation failure finalizes its Session before activating a queued successor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-approval-failure-finalize-"));
  const sessions = new SessionHarness();
  const request = confirmation("approval-failure-finalize");
  let predecessorFinalized = false;
  const executed: string[] = [];
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        executed.push(input.runId);
        if (input.runId !== "approval-failure-predecessor") {
          if (!predecessorFinalized) throw new Error("queued successor acquired Session before predecessor finalization");
          return completedOutcome(input, "successor completed", sessions);
        }
        const session = await prepareSession(input, sessions, {
          toolCalls: [{ callId: request.toolCallFactId, toolName: "shell", input: { command: "write" } }],
        });
        return {
          status: "approval_required" as const,
          session,
          toolCalls: [approvalResult(request)],
          usage: {},
          confirmationRequests: [request],
          continuation: {
            availability: "live_only" as const,
            async decide() { throw new Error("provider disconnected after approval"); },
            async release() { return undefined; },
          },
        };
      },
      async finalizeSession(runId) {
        if (runId === "approval-failure-predecessor") predecessorFinalized = true;
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("approval-failure-predecessor"));
  await waitForStatus(feature, "approval-failure-predecessor", "awaiting_approval");
  const successor = startInput("approval-failure-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "approval-failure-predecessor" },
  });
  await feature.commands.decideApproval({
    ownerRunId: "approval-failure-predecessor",
    confirmationId: request.confirmationId,
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:10.000Z",
  });

  assert.equal((await waitForStatus(feature, "approval-failure-predecessor", "failed")).status.kind, "failed");
  assert.equal((await waitForStatus(feature, successor.runId, "completed")).status.kind, "completed");
  assert.equal(predecessorFinalized, true);
  assert.deepEqual(executed, ["approval-failure-predecessor", "approval-failure-successor"]);
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
  const nestedRequest = {
    callId: "nested-write",
    factId: "agent-tool:6:call-2/tool:nested-write",
    parentToolCallFactId: "call-2",
    toolName: "write",
    input: { path: "b.txt", content: "updated" },
  };
  state = recordOrdinaryNestedToolRequests({
    state,
    requests: [nestedRequest],
    recordedAt: "2026-01-01T00:00:05.000Z",
  });
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
  assert.deepEqual(recovered.toolCalls.map((result) => result.factId ?? result.callId), [
    "call-1",
    nestedRequest.factId,
    "call-2",
  ]);
  const nestedUnknown = recovered.toolCalls.find((result) => result.factId === nestedRequest.factId);
  assert.equal(recovered.pendingNestedToolCalls, undefined);
  assert.equal(nestedUnknown?.errorFacts?.code, "tool_execution_outcome_unknown");
  assert.equal(nestedUnknown?.parentToolCallFactId, "call-2");
  assert.deepEqual(nestedUnknown?.input, nestedRequest.input);
  assert.equal(recovered.toolCalls.find((result) => result.callId === "call-2")?.errorFacts?.code, "tool_execution_outcome_unknown");
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
  const runningAnswer = sessions.append(runningRef, "running-answer", runningInput, "answer before restart");
  running = transitionOrdinaryRun({ state: running, transition: { type: "record_session_checkpoint", checkpoint: { kind: "assistant_response_entry_committed", sessionId: runningRef.sessionId, assistantEntryRef: runningAnswer }, modelRequestId: "running-request" }, recordedAt: "2026-01-01T00:01:00.004Z", eventId: "running-checkpoint-3" });
  await repository.save(running, 0);
  await controls.save({ conversationId: "conversation-2", createdAt: running.timestamps.createdAt, sessionRef: runningRef }, 0, running.timestamps.createdAt);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({ repository, conversationRepository: controls, sessionRepository: sessions, execution: { async execute() { executions += 1; throw new Error("must not execute after restart"); } }, now: clock(), idFactory: ids(40) });
  const unsubscribe = restarted.events.subscribe("lost-running", () => undefined);
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });
  const blocked = await waitForStatus(restarted, "lost-approval", "blocked");
  assert.equal(blocked.status.kind, "blocked");
  assert.equal(blocked.status.reason.code, "confirmation_continuation_lost");
  assert.equal(blocked.toolCalls[0]?.status, "cancelled");
  const interrupted = await waitForStatus(restarted, "lost-running", "blocked");
  assert.equal(interrupted.status.kind, "blocked");
  assert.equal(interrupted.status.reason.code, "execution_continuation_lost");
  const replay = await restarted.events.replay("lost-running");
  assert.deepEqual(replay?.activities.filter((activity) => activity.type === "model.output.completed")
    .map((activity) => activity.content), ["answer before restart"]);
  unsubscribe();
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

test("restart activates a healthy persisted root queue and completes it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-healthy-root-recovery-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const runId = "healthy-root-queued";
  const sessionRef = ordinaryAgentSessionRef("healthy-root-session");
  const recordedAt = clock();
  const queued = createInitialOrdinaryRunState({
    runId,
    sessionRef,
    turn: ordinaryRunTurn(runId),
    runInput: { userMessage: "recover this queued root" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "healthy-root-created",
  });
  await repository.save(queued, 0);
  await controls.save({
    conversationId: queued.turn.conversationId,
    createdAt: queued.timestamps.createdAt,
    sessionRef,
  }, 0, queued.timestamps.createdAt);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        executions += 1;
        return completedOutcome(input, "recovered root answer", sessions);
      },
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(120),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  const recovered = await waitForStatus(restarted, runId, "completed");
  assert.equal(recovered.status.kind, "completed");
  assert.equal(executions, 1);
});

test("restart isolates a persisted root queue when its conversation control is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-missing-conversation-control-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const sessions = new SessionHarness();
  const runId = "missing-control-queued";
  const sessionRef = ordinaryAgentSessionRef("missing-control-session");
  const recordedAt = clock();
  const queued = createInitialOrdinaryRunState({
    runId,
    sessionRef,
    turn: ordinaryRunTurn(runId),
    runInput: { userMessage: "do not recover without control" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "missing-control-created",
  });
  await repository.save(queued, 0);

  let executions = 0;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute() {
        executions += 1;
        throw new Error("a run without conversation control must not execute");
      },
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(120),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  assert.equal(await restarted.queries.getRun(runId), undefined);
  assert.deepEqual(await restarted.queries.listRuns(Number.MAX_SAFE_INTEGER), []);
  assert.equal(await restarted.events.replay(runId), undefined);
  await restarted.release();
  assert.equal(executions, 0);
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

  assert.equal(await restarted.queries.getRun("stale-root"), undefined);
  assert.deepEqual(await restarted.queries.listRuns(Number.MAX_SAFE_INTEGER), []);
  assert.equal(await restarted.events.replay("stale-root"), undefined);
  assert.equal(executions, 0);
  assert.equal(await restarted.queries.getConversation(completed.turn.conversationId), undefined);
});

test("startup isolates a damaged Session while healthy conversations and new tasks remain available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-session-isolation-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const recordedAt = clock();
  const birth = ordinaryRunBirth();

  const damagedSession = ordinaryAgentSessionRef("damaged-session");
  sessions.ensure(damagedSession);
  const damagedInput = sessions.append(damagedSession, "damaged-input");
  const damagedAnswer = sessions.append(damagedSession, "damaged-answer", damagedInput, "partial answer");
  let damaged = createInitialOrdinaryRunState({
    runId: "damaged-run",
    sessionRef: damagedSession,
    turn: { ...ordinaryRunTurn("damaged-run"), conversationId: "damaged-conversation" },
    runInput: { userMessage: "damaged" },
    birth,
    recordedAt: recordedAt(),
    eventId: "damaged-created",
  });
  damaged = transitionOrdinaryRun({ state: damaged, transition: { type: "start" }, recordedAt: recordedAt(), eventId: "damaged-started" });
  damaged = transitionOrdinaryRun({ state: damaged, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: damagedSession.sessionId, startLeafRef: null } }, recordedAt: recordedAt(), eventId: "damaged-checkpoint-1" });
  damaged = transitionOrdinaryRun({ state: damaged, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: damagedSession.sessionId, inputEntryRef: damagedInput } }, recordedAt: recordedAt(), eventId: "damaged-checkpoint-2" });
  damaged = transitionOrdinaryRun({ state: damaged, transition: { type: "record_session_checkpoint", checkpoint: { kind: "assistant_response_entry_committed", sessionId: damagedSession.sessionId, assistantEntryRef: damagedAnswer }, modelRequestId: "damaged-model-request" }, recordedAt: recordedAt(), eventId: "damaged-checkpoint-3" });

  const healthySession = ordinaryAgentSessionRef("healthy-session");
  sessions.ensure(healthySession);
  const healthyInput = sessions.append(healthySession, "healthy-input");
  const healthyAnswer = sessions.append(healthySession, "healthy-answer", healthyInput, "healthy answer");
  let healthy = createInitialOrdinaryRunState({
    runId: "healthy-run",
    sessionRef: healthySession,
    turn: { ...ordinaryRunTurn("healthy-run"), conversationId: "healthy-conversation" },
    runInput: { userMessage: "healthy" },
    birth,
    recordedAt: recordedAt(),
    eventId: "healthy-created",
  });
  healthy = transitionOrdinaryRun({ state: healthy, transition: { type: "start" }, recordedAt: recordedAt(), eventId: "healthy-started" });
  healthy = transitionOrdinaryRun({ state: healthy, transition: { type: "record_session_checkpoint", checkpoint: { kind: "start_leaf_captured", sessionId: healthySession.sessionId, startLeafRef: null } }, recordedAt: recordedAt(), eventId: "healthy-checkpoint-1" });
  healthy = transitionOrdinaryRun({ state: healthy, transition: { type: "record_session_checkpoint", checkpoint: { kind: "input_entry_committed", sessionId: healthySession.sessionId, inputEntryRef: healthyInput } }, recordedAt: recordedAt(), eventId: "healthy-checkpoint-2" });
  healthy = transitionOrdinaryRun({ state: healthy, transition: { type: "record_session_checkpoint", checkpoint: { kind: "assistant_response_entry_committed", sessionId: healthySession.sessionId, assistantEntryRef: healthyAnswer } }, recordedAt: recordedAt(), eventId: "healthy-checkpoint-3" });
  healthy = transitionOrdinaryRun({
    state: healthy,
    transition: {
      type: "complete",
      session: { sessionId: healthySession.sessionId, startLeafRef: null, inputEntryRef: healthyInput, safeLeafRef: healthyAnswer, latestLeafRef: healthyAnswer, compactionEntryRefs: [] },
      toolCalls: [],
      usage: {},
    },
    recordedAt: recordedAt(),
    eventId: "healthy-completed",
  });

  await repository.save(damaged, 0);
  await repository.save(healthy, 0);
  await controls.save({ conversationId: damaged.turn.conversationId, createdAt: damaged.timestamps.createdAt, sessionRef: damagedSession }, 0, damaged.timestamps.createdAt);
  await controls.save({ conversationId: healthy.turn.conversationId, createdAt: healthy.timestamps.createdAt, sessionRef: healthySession }, 0, healthy.timestamps.createdAt);
  sessions.failAssistantReadsFor(damagedSession.sessionId);

  const diagnostics: string[] = [];
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: { execute: (input) => completedOutcome(input, "new answer", sessions) },
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "conversation_unavailable") diagnostics.push(diagnostic.conversationId);
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(100),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  assert.deepEqual((await restarted.queries.listConversations()).map((conversation) => conversation.conversationId), ["healthy-conversation"]);
  assert.equal(await restarted.queries.getConversation("damaged-conversation"), undefined);
  const submitted = await restarted.commands.submitTurn({ input: { userMessage: "new task" }, birth });
  await waitForStatus(restarted, submitted.run.runId, "completed");
  assert.deepEqual(diagnostics, ["damaged-conversation"]);
});

test("startup enumeration failures stay diagnostic while new runs remain available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-startup-enumeration-"));
  const durableRuns = createFileSystemOrdinaryRunRepository(root);
  const durableConversations = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const diagnostics: string[] = [];
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...durableRuns,
      async inspectRecoveryInventory() { throw new Error("run enumeration unavailable"); },
    },
    conversationRepository: {
      ...durableConversations,
      async list() { throw new Error("conversation enumeration unavailable"); },
    },
    sessionRepository: sessions,
    execution: { execute: (input) => completedOutcome(input, "new answer", sessions) },
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "startup_recovery_failed") diagnostics.push(diagnostic.source);
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(100),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("live-after-enumeration-failure"));
  await waitForStatus(feature, "live-after-enumeration-failure", "completed");
  assert.deepEqual(diagnostics.sort(), ["conversation_repository", "run_repository"]);
});

test("startup run enumeration failure isolates persisted runs that were not reconciled", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-run-enumeration-isolation-"));
  const durableRuns = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const runId = "unreconciled-persisted-run";
  const sessionRef = ordinaryAgentSessionRef("unreconciled-persisted-session");
  const recordedAt = clock();
  const queued = createInitialOrdinaryRunState({
    runId,
    sessionRef,
    turn: ordinaryRunTurn(runId),
    runInput: { userMessage: "do not expose without startup reconciliation" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "unreconciled-created",
  });
  await durableRuns.save(queued, 0);
  await controls.save({
    conversationId: queued.turn.conversationId,
    createdAt: queued.timestamps.createdAt,
    sessionRef,
  }, 0, queued.timestamps.createdAt);

  let executions = 0;
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...durableRuns,
      async inspectRecoveryInventory() { throw new Error("run enumeration unavailable"); },
    },
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: {
      async execute() {
        executions += 1;
        throw new Error("an unreconciled persisted run must not execute");
      },
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(100),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  assert.equal(await feature.queries.getRun(runId), undefined);
  assert.equal(await feature.events.replay(runId), undefined);
  await feature.release();
  assert.equal(executions, 0);
});

test("incomplete run recovery inventory preserves conversation-owned managed attachments", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-incomplete-inventory-"));
  const managedRepository = createFileSystemOrdinaryManagedAttachmentRepository(path.join(root, "managed-attachments"));
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const conversationId = "managed-incomplete-conversation";
  const attachmentId = "managed-incomplete-attachment";
  const sessionRef = ordinaryAgentSessionRef("managed-incomplete-session");
  sessions.ensure(sessionRef);
  await managedRepository.createDraft({
    attachmentId,
    instanceId: "previous-instance",
    originalName: "preserve.txt",
    content: Buffer.from("must survive incomplete inventory", "utf8"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await managedRepository.claimForConversation({
    attachmentIds: [attachmentId],
    instanceId: "previous-instance",
    conversationId,
    claimedAt: "2026-01-01T00:00:01.000Z",
  });
  await controls.save({
    conversationId,
    createdAt: "2026-01-01T00:00:00.000Z",
    sessionRef,
  }, 0, "2026-01-01T00:00:00.000Z");
  const damagedRunDirectory = path.join(root, "runs", "damaged-managed-run");
  await fs.mkdir(damagedRunDirectory, { recursive: true });
  await fs.writeFile(path.join(damagedRunDirectory, "snapshot.json"), "{ invalid", "utf8");

  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: controls,
    sessionRepository: sessions,
    managedAttachmentRepository: managedRepository,
    managedAttachmentInstanceId: "current-instance",
    execution: { async execute() { throw new Error("damaged recovery must not execute"); } },
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.queries.listConversations();
  assert.deepEqual((await managedRepository.get(attachmentId)).owner, {
    kind: "conversation",
    conversationId,
  });
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

test("queued successor activation keeps retrying failed Session finalization without a new turn", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-finalize-pump-"));
  const sessions = new SessionHarness();
  const predecessorStarted = createGate();
  let releasePredecessor!: () => void;
  const predecessorReleased = new Promise<void>((resolve) => { releasePredecessor = resolve; });
  let finalizeAttempts = 0;
  let finalizeFailures = 4;
  const feature = createOrdinaryAgentFeature({
    repository: createFileSystemOrdinaryRunRepository(root),
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        if (input.runId === "finalize-pump-predecessor") {
          predecessorStarted.enter();
          await predecessorReleased;
        }
        return completedOutcome(input, `answer ${input.runId}`, sessions);
      },
      async finalizeSession(runId) {
        if (runId !== "finalize-pump-predecessor") return;
        finalizeAttempts += 1;
        if (finalizeFailures > 0) {
          finalizeFailures -= 1;
          throw new Error("Session finalization remains temporarily unavailable");
        }
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { releasePredecessor(); await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("finalize-pump-predecessor"));
  await predecessorStarted.entered;
  const successor = startInput("finalize-pump-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "finalize-pump-predecessor" },
  });
  releasePredecessor();

  assert.equal((await waitForStatus(feature, successor.runId, "completed")).status.kind, "completed");
  assert.equal(finalizeAttempts, 5);
});

test("successor activation retries one transient persistence failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-successor-activation-"));
  const durableRepository = createFileSystemOrdinaryRunRepository(root);
  const sessions = new SessionHarness();
  let activationSaveFailures = 1;
  let releasePredecessor!: () => void;
  const predecessorReleased = new Promise<void>((resolve) => { releasePredecessor = resolve; });
  let markPredecessorStarted!: () => void;
  const predecessorStarted = new Promise<void>((resolve) => { markPredecessorStarted = resolve; });
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...durableRepository,
      async save(state, expectedRevision) {
        if (state.runId === "activation-successor" && state.status.kind === "running" && activationSaveFailures > 0) {
          activationSaveFailures -= 1;
          throw new Error("transient successor save failure");
        }
        return durableRepository.save(state, expectedRevision);
      },
    },
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const prepared = await prepareSession(input, sessions);
        if (input.runId === "activation-predecessor") {
          markPredecessorStarted();
          await predecessorReleased;
        }
        return completedOutcome(input, `answer ${input.runId}`, sessions, prepared);
      },
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("activation-predecessor"));
  await predecessorStarted;
  const successor = startInput("activation-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "activation-predecessor" },
  });
  assert.equal((await feature.queries.getRun("activation-successor"))?.status.kind, "queued");

  releasePredecessor();
  await waitForStatus(feature, "activation-successor", "completed");
  assert.equal(activationSaveFailures, 0);
});

test("successor activation retains ownership across repeated persistence failures", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-successor-activation-exhausted-"));
  const durableRepository = createFileSystemOrdinaryRunRepository(root);
  const sessions = new SessionHarness();
  let activationSaveAttempts = 0;
  let activationSaveFailures = 4;
  let releasePredecessor!: () => void;
  const predecessorReleased = new Promise<void>((resolve) => { releasePredecessor = resolve; });
  let markPredecessorStarted!: () => void;
  const predecessorStarted = new Promise<void>((resolve) => { markPredecessorStarted = resolve; });
  const diagnostics: Array<{ readonly predecessorRunId: string; readonly consecutiveFailures: number }> = [];
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...durableRepository,
      async save(state, expectedRevision) {
        if (state.runId === "activation-exhausted-successor" &&
            state.status.kind === "running" && state.session.phase === "not_started") {
          activationSaveAttempts += 1;
          if (activationSaveFailures > 0) {
            activationSaveFailures -= 1;
            throw new Error("successor persistence remains temporarily unavailable");
          }
        }
        return durableRepository.save(state, expectedRevision);
      },
    },
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        const prepared = await prepareSession(input, sessions);
        if (input.runId === "activation-exhausted-predecessor") {
          markPredecessorStarted();
          await predecessorReleased;
        }
        return completedOutcome(input, `answer ${input.runId}`, sessions, prepared);
      },
    },
    onDiagnostic: (diagnostic) => {
      if (diagnostic.kind === "successor_activation_failed") {
        diagnostics.push({
          predecessorRunId: diagnostic.predecessorRunId ?? "missing-predecessor",
          consecutiveFailures: diagnostic.consecutiveFailures,
        });
      }
    },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await feature.commands.start(startInput("activation-exhausted-predecessor"));
  await predecessorStarted;
  const successor = startInput("activation-exhausted-successor");
  await feature.commands.start({
    ...successor,
    turn: { ...successor.turn, ordinal: 2, predecessorRunId: "activation-exhausted-predecessor" },
  });
  assert.equal((await feature.queries.getRun(successor.runId))?.status.kind, "queued");

  releasePredecessor();
  assert.equal((await waitForStatus(feature, successor.runId, "completed")).status.kind, "completed");
  assert.equal(activationSaveAttempts, 5);
  assert.deepEqual(diagnostics, [1, 2, 3, 4].map((consecutiveFailures) => ({
    predecessorRunId: "activation-exhausted-predecessor",
    consecutiveFailures,
  })));
});

test("root queued activation remains feature-owned after its initial start save fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-root-activation-retry-"));
  const durableRepository = createFileSystemOrdinaryRunRepository(root);
  const sessions = new SessionHarness();
  let activationSaveAttempts = 0;
  let activationSaveFailures = 3;
  const feature = createOrdinaryAgentFeature({
    repository: {
      ...durableRepository,
      async save(state, expectedRevision) {
        if (state.runId === "root-activation-retry" &&
            state.status.kind === "running" && state.session.phase === "not_started") {
          activationSaveAttempts += 1;
          if (activationSaveFailures > 0) {
            activationSaveFailures -= 1;
            throw new Error("root activation persistence remains temporarily unavailable");
          }
        }
        return durableRepository.save(state, expectedRevision);
      },
    },
    conversationRepository: createFileSystemOrdinaryConversationControlRepository(root),
    sessionRepository: sessions,
    execution: { execute: (input) => completedOutcome(input, "root completed", sessions) },
    now: clock(),
    idFactory: ids(),
  });
  t.after(async () => { await feature.release(); await removeTestDirectory(root); });

  await assert.rejects(
    feature.commands.start(startInput("root-activation-retry")),
    /root activation persistence remains temporarily unavailable/u,
  );
  assert.equal((await waitForStatus(feature, "root-activation-retry", "completed")).status.kind, "completed");
  assert.equal(activationSaveAttempts, 4);
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

test("restart restores the durable safe Session leaf before activating a queued successor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-session-leaf-recovery-"));
  const repository = createFileSystemOrdinaryRunRepository(root);
  const controls = createFileSystemOrdinaryConversationControlRepository(root);
  const sessions = new SessionHarness();
  const sessionRef = ordinaryAgentSessionRef("recovered-session");
  const conversationId = "recovered-conversation";
  const recordedAt = clock();
  sessions.ensure(sessionRef);

  let cancelled = createInitialOrdinaryRunState({
    runId: "recovered-cancelled",
    sessionRef,
    turn: { ...ordinaryRunTurn("recovered-cancelled"), conversationId },
    runInput: { userMessage: "cancelled before Session cleanup" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "recovered-cancelled-created",
  });
  cancelled = transitionOrdinaryRun({
    state: cancelled,
    transition: { type: "start" },
    recordedAt: recordedAt(),
    eventId: "recovered-cancelled-started",
  });
  cancelled = transitionOrdinaryRun({
    state: cancelled,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: { kind: "start_leaf_captured", sessionId: sessionRef.sessionId, startLeafRef: null },
    },
    recordedAt: recordedAt(),
    eventId: "recovered-start-leaf",
  });
  const safeLeaf = sessions.append(sessionRef, "recovered-safe-input", null);
  cancelled = transitionOrdinaryRun({
    state: cancelled,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: { kind: "input_entry_committed", sessionId: sessionRef.sessionId, inputEntryRef: safeLeaf },
    },
    recordedAt: recordedAt(),
    eventId: "recovered-input",
  });
  const unacceptedLeaf = sessions.append(sessionRef, "recovered-unaccepted-answer", safeLeaf);
  cancelled = transitionOrdinaryRun({
    state: cancelled,
    transition: {
      type: "record_session_checkpoint",
      checkpoint: {
        kind: "assistant_response_entry_committed",
        sessionId: sessionRef.sessionId,
        assistantEntryRef: unacceptedLeaf,
      },
    },
    recordedAt: recordedAt(),
    eventId: "recovered-unaccepted-output",
  });
  cancelled = transitionOrdinaryRun({
    state: cancelled,
    transition: { type: "cancel", reason: "cancelled_by_user" },
    recordedAt: recordedAt(),
    eventId: "recovered-cancelled-terminal",
  });
  await repository.save(cancelled, 0);

  const successor = createInitialOrdinaryRunState({
    runId: "recovered-successor",
    sessionRef,
    turn: {
      ...ordinaryRunTurn("recovered-successor"),
      conversationId,
      ordinal: 2,
      predecessorRunId: cancelled.runId,
    },
    runInput: { userMessage: "continue from the accepted prefix" },
    birth: ordinaryRunBirth(),
    recordedAt: recordedAt(),
    eventId: "recovered-successor-created",
  });
  await repository.save(successor, 0);
  await controls.save({
    conversationId,
    createdAt: cancelled.timestamps.createdAt,
    sessionRef,
  }, 0, cancelled.timestamps.createdAt);

  let observedStartLeaf: AgentSessionEntryRef | null | undefined;
  const restarted = createOrdinaryAgentFeature({
    repository,
    conversationRepository: controls,
    sessionRepository: sessions,
    execution: {
      async execute(input) {
        observedStartLeaf = await sessions.getActiveLeaf(input.sessionRef);
        return completedOutcome(input, "continued", sessions);
      },
    },
    now: clock("2026-01-01T00:01:00.000Z"),
    idFactory: ids(90),
  });
  t.after(async () => { await restarted.release(); await removeTestDirectory(root); });

  await waitForStatus(restarted, successor.runId, "completed");
  assert.deepEqual(observedStartLeaf, safeLeaf);
  assert.notDeepEqual(observedStartLeaf, unacceptedLeaf);
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
  const assistantEntryRef = sessions.append(input.sessionRef, `${input.runId}-answer`, undefined, answer);
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

type SessionNode = { readonly ref: AgentSessionEntryRef; readonly parent: AgentSessionEntryRef | null; readonly text: string };
class SessionHarness implements AgentSessionRepository {
  readonly reconciled: Array<{ readonly orderedResults: readonly ToolCallResult[] }> = [];
  private readonly roots = new Map<string, AgentSessionRef>();
  private readonly nodes = new Map<string, Map<string, SessionNode>>();
  private readonly activeLeaves = new Map<string, AgentSessionEntryRef | null>();
  private readonly calls = new Map<string, readonly ToolCallRequest[]>();
  private readonly assistantReadFailures = new Set<string>();
  ensure(ref: AgentSessionRef): void { this.roots.set(ref.sessionId, ref); this.nodes.set(ref.sessionId, this.nodes.get(ref.sessionId) ?? new Map()); if (!this.activeLeaves.has(ref.sessionId)) this.activeLeaves.set(ref.sessionId, null); }
  active(ref: AgentSessionRef): AgentSessionEntryRef | null { return this.activeLeaves.get(ref.sessionId) ?? null; }
  append(ref: AgentSessionRef, entryId: string, parent = this.active(ref), text = ""): AgentSessionEntryRef { this.ensure(ref); const entry = { sessionId: ref.sessionId, entryId }; this.nodes.get(ref.sessionId)!.set(entryId, { ref: entry, parent, text }); this.activeLeaves.set(ref.sessionId, entry); return entry; }
  appendToolCalls(ref: AgentSessionRef, entryId: string, calls: readonly ToolCallRequest[], parent = this.active(ref)): AgentSessionEntryRef { const entry = this.append(ref, entryId, parent); this.calls.set(`${ref.sessionId}:${entryId}`, calls.map((call) => structuredClone(call))); return entry; }
  async create(input: { readonly sessionId: string; readonly sessionCwd: string }): Promise<AgentSessionRef> { const ref = { ...ordinaryAgentSessionRef(input.sessionId), sessionCwd: input.sessionCwd }; this.ensure(ref); return ref; }
  async getActiveLeaf(ref: AgentSessionRef): Promise<AgentSessionEntryRef | null> { return this.active(ref); }
  async moveActiveLeaf(ref: AgentSessionRef, target: AgentSessionEntryRef | null): Promise<AgentSessionEntryRef | null> { this.ensure(ref); this.activeLeaves.set(ref.sessionId, target); return target; }
  async getActiveBranchEntryRefs(ref: AgentSessionRef): Promise<readonly AgentSessionEntryRef[]> { const result: AgentSessionEntryRef[] = []; let current = this.active(ref); while (current !== null) { result.push(current); current = this.nodes.get(ref.sessionId)?.get(current.entryId)?.parent ?? null; } return result.reverse(); }
  failAssistantReadsFor(sessionId: string): void { this.assistantReadFailures.add(sessionId); }
  async readAssistantEntries(input: { readonly sessionRef: AgentSessionRef; readonly entryRefs: readonly AgentSessionEntryRef[] }) {
    if (this.assistantReadFailures.has(input.sessionRef.sessionId)) throw new Error("Session JSONL is damaged");
    return input.entryRefs.map((entryRef) => ({ entryRef, text: this.nodes.get(entryRef.sessionId)?.get(entryRef.entryId)?.text ?? "" }));
  }
  async readToolCalls(input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef }): Promise<readonly ToolCallRequest[]> { return this.calls.get(`${input.sessionRef.sessionId}:${input.assistantEntryRef.entryId}`) ?? []; }
  async reconcileToolResultEntries(input: { readonly sessionRef: AgentSessionRef; readonly assistantEntryRef: AgentSessionEntryRef; readonly orderedResults: readonly ToolCallResult[] }): Promise<AgentSessionEntryRef> { this.reconciled.push({ orderedResults: structuredClone(input.orderedResults) }); return this.append(input.sessionRef, `${input.assistantEntryRef.entryId}-results-${this.reconciled.length}`, input.assistantEntryRef); }
  async delete(ref: AgentSessionRef): Promise<void> { this.roots.delete(ref.sessionId); this.nodes.delete(ref.sessionId); this.activeLeaves.delete(ref.sessionId); }
}
