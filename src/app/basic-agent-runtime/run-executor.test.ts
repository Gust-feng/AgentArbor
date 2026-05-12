import assert from "node:assert/strict";
import test from "node:test";
import { PanelRunJobStore } from "../panel-run-jobs.js";
import { BasicAgentRunExecutor } from "./run-executor.js";

test("BasicAgentRunExecutor owns basic run projection and replay cursor", async () => {
  const runJobs = new PanelRunJobStore();
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

  executor.syncPanelStreamEvents(job);
  const replay = executor.replayEvents(run.runId, 0);
  assert.equal(replay?.cursor.eventCount, 1);
  assert.equal(replay?.events[0]?.type, "tool.completed");
});

test("BasicAgentRunExecutor freezes capability snapshot when the run is created", async () => {
  const runJobs = new PanelRunJobStore();
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
