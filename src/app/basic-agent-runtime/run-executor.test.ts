import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { BasicAgentRunExecutor } from "./run-executor.js";
import {
  BasicAgentConfirmationDecisionError,
  BasicAgentPendingContinuationStore,
} from "./run-executor-continuations.js";
import type { BasicAgentRunJob } from "./run-job.js";
import { InMemoryBasicAgentRunJobStore } from "./run-job-store.js";

const sourceDirectory = path.join(process.cwd(), "src", "app", "basic-agent-runtime");

test("BasicAgentRunExecutor keeps continuation state split from execution orchestration", async () => {
  const [executorSource, continuationsSource] = await Promise.all([
    readFile(path.join(sourceDirectory, "run-executor.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "run-executor-continuations.ts"), "utf8"),
  ]);

  assert.equal(executorSource.includes('from "./run-executor-continuations.js"'), true);
  assert.equal(executorSource.includes("new BasicAgentPendingContinuationStore"), true);
  assert.equal(executorSource.includes("private readonly pendingToolContinuations"), false);
  assert.equal(executorSource.includes("function continuationKey"), false);
  assert.equal(executorSource.includes("function pendingConfirmationIdFromCanvas"), false);
  assert.equal(executorSource.includes("private assertPendingConfirmation"), false);
  assert.equal(continuationsSource.includes("export class BasicAgentPendingContinuationStore"), true);
  assert.equal(continuationsSource.includes("export class BasicAgentConfirmationDecisionError"), true);
  assert.equal(continuationsSource.includes("function continuationKey"), true);
  assert.equal(continuationsSource.includes("function pendingConfirmationIdFromCanvas"), true);
});

test("BasicAgentPendingContinuationStore validates and consumes pending confirmations", () => {
  const store = new BasicAgentPendingContinuationStore();
  const continuation = {
    confirmationId: "confirmation-tool",
    async resume() {
      return {};
    },
    async resumeWithDecision() {
      return {};
    },
  };
  const job = jobFixture({
    status: "approval_needed",
  });

  store.remember(job.runId, continuation);
  assert.doesNotThrow(() => store.assertPendingConfirmation(job, "confirmation-tool"));
  assert.equal(store.consume(job.runId, "confirmation-tool"), continuation);
  assert.throws(
    () => store.assertPendingConfirmation(job, "confirmation-tool"),
    (error) => error instanceof BasicAgentConfirmationDecisionError && error.code === "confirmation_not_pending"
  );
});

test("BasicAgentPendingContinuationStore accepts canvas pending confirmation and rejects stale decisions", () => {
  const store = new BasicAgentPendingContinuationStore();
  const job = jobFixture({
    status: "approval_needed",
    completed: {
      config: modelConfig(),
      informationAccess: informationAccess(),
      canvas: {
        agent: {
          pendingConfirmation: {
            confirmationId: "confirmation-canvas",
          },
        },
      },
    },
    confirmationDecisions: [{
      confirmationId: "confirmation-stale",
      runId: "run-executor-test",
      decision: "deny",
      decidedAt: "2026-06-02T00:00:01.000Z",
    }],
  });

  assert.doesNotThrow(() => store.assertPendingConfirmation(job, "confirmation-canvas"));
  assert.throws(
    () => store.assertPendingConfirmation({ ...job, status: "completed" }, "confirmation-canvas"),
    (error) => error instanceof BasicAgentConfirmationDecisionError && error.code === "invalid_confirmation_state"
  );
  assert.throws(
    () => store.assertPendingConfirmation(job, "confirmation-stale"),
    (error) => error instanceof BasicAgentConfirmationDecisionError && error.code === "confirmation_not_pending"
  );
});

test("BasicAgentRunExecutor owns basic run projection and replay cursor", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => ({
      profileId: "default",
      defaultAiMode: "fake",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://example.test",
      model: "test-model",
      secretRef: "secret:model-provider:default",
      secretConfigured: false,
      updatedAt: "2026-05-12T00:00:00.000Z",
    }),
    getInformationAccessConfig: async () => ({
      web: {
        provider: "none",
        providerKind: "tavily",
        maxResults: 5,
        secretRef: "secret:tavily",
        secretConfigured: false,
        status: "disabled",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      sourcePreference: ["web"],
      stubs: {
        docs: "readonly_stub",
        packages: "readonly_stub",
        github: "readonly_stub",
        run_memory: "readonly_stub",
      },
    }),
    runJobs,
    activeRunJobs: new Set(),
    abortControllers: new Map(),
    persistRun: async () => undefined,
    executionAdapter: {
      async execute() {
        throw new Error("not used");
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "hello",
    aiMode: "fake",
    startImmediately: false,
  });
  const job = runJobs.get(run.runId);
  assert.equal(run.status, "queued");
  assert.ok(job);

  runJobs.syncStreamEvents(run.runId, [{
    eventId: `${run.runId}:tool.completed`,
    runId: run.runId,
    type: "tool.completed",
    createdAt: "2026-05-12T00:00:01.000Z",
    summary: "已读取上下文。",
    status: "completed",
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: ["tool-1"],
  }]);
  assert.equal(executor.replayEvents(run.runId, 0)?.events.length, 0);

  executor.syncRunEvents(job);
  const replay = executor.replayEvents(run.runId, 0);
  assert.equal(replay?.cursor.eventCount, 1);
  assert.equal(replay?.events[0]?.type, "tool.completed");
});

test("BasicAgentRunExecutor can defer scheduling until the caller has responded", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let executed = false;
  const activeRunJobs = new Set<Promise<void>>();
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => modelConfig(),
    getInformationAccessConfig: async () => informationAccess(),
    runJobs,
    activeRunJobs,
    abortControllers: new Map(),
    persistRun: async () => undefined,
    executionAdapter: {
      async execute() {
        executed = true;
        return {};
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "stream soon",
    aiMode: "fake",
    deferSchedule: true,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(executed, false);
  assert.equal(activeRunJobs.size, 0);

  executor.schedule(run.runId);
  await waitUntil(() => executed);

  assert.equal(runJobs.get(run.runId)?.status, "completed");
});

test("BasicAgentRunExecutor can return before background persistence settles", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let resolvePersistence: (() => void) | undefined;
  let backgroundPersistenceStarted = false;
  let backgroundPersistenceCompleted = false;
  const persistenceGate = new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  });
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => modelConfig(),
    getInformationAccessConfig: async () => informationAccess(),
    runJobs,
    activeRunJobs: new Set(),
    abortControllers: new Map(),
    persistRun: async () => {
      throw new Error("foreground persistence should not run");
    },
    persistRunInBackground: (job) => {
      backgroundPersistenceStarted = true;
      void persistenceGate.then(() => {
        assert.notEqual(job.runId, "");
        backgroundPersistenceCompleted = true;
      });
    },
    executionAdapter: {
      async execute() {
        throw new Error("not used");
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "return before persistence",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(run.status, "queued");
  assert.equal(backgroundPersistenceStarted, true);
  assert.equal(backgroundPersistenceCompleted, false);
  resolvePersistence?.();
  await waitUntil(() => backgroundPersistenceCompleted);
});

test("BasicAgentRunExecutor loads startup metadata in parallel", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const started: string[] = [];
  let resolveModel: ((value: SanitizedModelProviderConfig) => void) | undefined;
  let resolveInformation: ((value: SanitizedInformationAccessConfig) => void) | undefined;
  let resolveCapability: ((value: BasicAgentCapabilitySnapshot) => void) | undefined;
  const modelPromise = new Promise<SanitizedModelProviderConfig>((resolve) => {
    resolveModel = resolve;
  });
  const informationPromise = new Promise<SanitizedInformationAccessConfig>((resolve) => {
    resolveInformation = resolve;
  });
  const capabilityPromise = new Promise<BasicAgentCapabilitySnapshot>((resolve) => {
    resolveCapability = resolve;
  });
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => {
      started.push("model");
      return modelPromise;
    },
    getInformationAccessConfig: async () => {
      started.push("information");
      return informationPromise;
    },
    getCapabilitySnapshot: async () => {
      started.push("capability");
      return capabilityPromise;
    },
    runJobs,
    activeRunJobs: new Set(),
    abortControllers: new Map(),
    persistRun: async () => undefined,
    executionAdapter: {
      async execute() {
        throw new Error("not used");
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const startPromise = executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "parallel startup",
    aiMode: "fake",
    startImmediately: false,
  });
  await Promise.resolve();

  assert.deepEqual(started, ["model", "information", "capability"]);

  resolveModel?.(modelConfig());
  resolveInformation?.(informationAccess());
  resolveCapability?.({
    snapshotId: "snapshot-parallel",
    createdAt: "2026-05-12T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: false,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
    toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    securitySummary: "safe",
    warnings: [],
  });

  const run = await startPromise;
  assert.equal(run.status, "queued");
});

test("BasicAgentRunExecutor resumes denied or guided confirmations through the same run", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const resumedInputs: unknown[] = [];
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => modelConfig(),
    getInformationAccessConfig: async () => informationAccess(),
    runJobs,
    activeRunJobs: new Set(),
    abortControllers: new Map(),
    persistRun: async () => undefined,
    executionAdapter: {
      async execute() {
        return {
          pendingApproval: {
            confirmationId: "confirmation-tool",
            async resume() {
              throw new Error("approval resume should not be used");
            },
            async resumeWithDecision(input) {
              resumedInputs.push(input);
              return {
                canvas: {
                  kind: "desktop_agent_canvas",
                  agent: {},
                },
              };
            },
          },
        };
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "needs confirmation",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "approval_needed");

  await executor.submitConfirmationDecision({
    runId: run.runId,
    confirmationId: "confirmation-tool",
    decision: "guidance",
    guidance: "不要执行删除，改为说明。",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  assert.equal(resumedInputs.length, 1);
  const resumedInput = resumedInputs[0] as { readonly decision: string; readonly guidance?: string; readonly abortSignal?: AbortSignal };
  assert.equal(resumedInput.decision, "guidance");
  assert.equal(resumedInput.guidance, "不要执行删除，改为说明。");
  assert.equal(typeof resumedInput.abortSignal?.aborted, "boolean");
  assert.equal(runJobs.get(run.runId)?.confirmationDecisions[0]?.decision, "guidance");
  assert.equal(executor.get(run.runId)?.status, "completed");
});

function jobFixture(overrides: Partial<BasicAgentRunJob> = {}): BasicAgentRunJob {
  return {
    runId: "run-executor-test",
    runKind: "desktop",
    runMode: "agent",
    goal: "safe goal",
    aiMode: "fake",
    status: "pending",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    streamEvents: [],
    confirmationDecisions: [],
    config: modelConfig(),
    informationAccess: informationAccess(),
    ...overrides,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    defaultAiMode: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "test-model",
    secretRef: "secret:model-provider:default",
    secretConfigured: false,
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret:tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    sourcePreference: ["web"],
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}

test("BasicAgentRunExecutor freezes capability snapshot when the run is created", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor({
    getModelProviderConfig: async () => ({
      profileId: "default",
      defaultAiMode: "fake",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://example.test",
      model: "test-model",
      secretRef: "secret:model-provider:default",
      secretConfigured: false,
      updatedAt: "2026-05-12T00:00:00.000Z",
    }),
    getInformationAccessConfig: async () => ({
      web: {
        provider: "none",
        providerKind: "tavily",
        maxResults: 5,
        secretRef: "secret:tavily",
        secretConfigured: false,
        status: "disabled",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      sourcePreference: ["web"],
      stubs: {
        docs: "readonly_stub",
        packages: "readonly_stub",
        github: "readonly_stub",
        run_memory: "readonly_stub",
      },
    }),
    getCapabilitySnapshot: async () => ({
      snapshotId: "snapshot-created",
      createdAt: "2026-05-12T00:00:00.000Z",
      activeModel: {
        profileId: "default",
        defaultAiMode: "fake",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://example.test",
        model: "test-model",
        secretRef: "secret:model-provider:default",
        secretConfigured: false,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      modelCapabilities: {
        contextWindowTokens: 16_000,
        maxOutputTokens: 4_000,
        supportsToolCalling: false,
        supportsParallelToolCalls: false,
        supportsStructuredOutputs: false,
        supportsStreaming: true,
        supportsVisionInput: false,
        supportsReasoningEffort: false,
        preferredApiStyle: "openai_compatible",
        stability: "unknown",
      },
      toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
      skillCatalog: [],
      mcpCatalog: [],
      workspace: {
        workspaceDirectory: process.cwd(),
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      securitySummary: "safe",
      warnings: [],
    }),
    runJobs,
    activeRunJobs: new Set(),
    abortControllers: new Map(),
    persistRun: async () => undefined,
    executionAdapter: {
      async execute() {
        throw new Error("not used");
      },
    },
    failRun: async () => undefined,
    onRuntimeReady: () => undefined,
    onModelOutputDelta: () => undefined,
    onRunFinished: () => undefined,
  });

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "hello",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot?.snapshotId, "snapshot-created");
});
