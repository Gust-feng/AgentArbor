import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { BasicAgentRunExecutor } from "./run-executor.js";
import type {
  BasicAgentRunExecutorConfig,
  BasicAgentRunStartFacts,
  BasicAgentRunStartInput,
} from "./contracts.js";
import {
  BasicAgentConfirmationDecisionError,
  BasicAgentPendingContinuationStore,
} from "./run-executor-continuations.js";
import type { BasicAgentRunJob } from "./run-job.js";
import { InMemoryBasicAgentRunJobStore } from "./run-job-store.js";

const sourceDirectory = path.join(process.cwd(), "src", "app", "basic-agent-runtime");

function preparedStartFacts(
  input: BasicAgentRunStartInput,
  overrides: Partial<BasicAgentRunStartFacts> = {}
): BasicAgentRunStartFacts {
  const config = overrides.config ?? modelConfig();
  const capabilitySnapshotPart = "capabilitySnapshot" in overrides
    ? overrides.capabilitySnapshot === undefined
      ? {}
      : { capabilitySnapshot: overrides.capabilitySnapshot }
    : { capabilitySnapshot: capabilitySnapshot() };
  const agentDefinitionPart = "agentDefinitionRef" in overrides
    ? overrides.agentDefinitionRef === undefined
      ? {}
      : { agentDefinitionRef: overrides.agentDefinitionRef }
    : input.runKind === "desktop" && input.runMode === "agent"
      ? { agentDefinitionRef: defaultAgentDefinitionRef() }
      : {};
  return {
    aiMode: overrides.aiMode ?? input.aiMode ?? config.defaultAiMode,
    config,
    informationAccess: overrides.informationAccess ?? informationAccess(),
    toolConfirmationPolicy: overrides.toolConfirmationPolicy,
    ...capabilitySnapshotPart,
    ...agentDefinitionPart,
  };
}

function defaultPrepareRunStart(
  overrides: Partial<BasicAgentRunStartFacts> = {}
): BasicAgentRunExecutorConfig["prepareRunStart"] {
  return async (input) => preparedStartFacts(input, overrides);
}

function executorConfig(input: {
  readonly runJobs: InMemoryBasicAgentRunJobStore;
  readonly activeRunJobs?: Set<Promise<void>>;
  readonly abortControllers?: Map<string, AbortController>;
  readonly prepareRunStart?: BasicAgentRunExecutorConfig["prepareRunStart"];
  readonly persistRun?: BasicAgentRunExecutorConfig["persistRun"];
  readonly persistRunInBackground?: BasicAgentRunExecutorConfig["persistRunInBackground"];
  readonly cleanupRunResources?: BasicAgentRunExecutorConfig["cleanupRunResources"];
  readonly inspectRunResources?: BasicAgentRunExecutorConfig["inspectRunResources"];
  readonly execute?: BasicAgentRunExecutorConfig["executionAdapter"]["execute"];
  readonly failRun?: BasicAgentRunExecutorConfig["failRun"];
  readonly onRuntimeReady?: BasicAgentRunExecutorConfig["onRuntimeReady"];
  readonly onModelOutputDelta?: BasicAgentRunExecutorConfig["onModelOutputDelta"];
  readonly onRunFinished?: BasicAgentRunExecutorConfig["onRunFinished"];
}): BasicAgentRunExecutorConfig {
  return {
    prepareRunStart: input.prepareRunStart ?? defaultPrepareRunStart(),
    runJobs: input.runJobs,
    activeRunJobs: input.activeRunJobs ?? new Set(),
    abortControllers: input.abortControllers ?? new Map(),
    persistRun: input.persistRun ?? (async () => undefined),
    persistRunInBackground: input.persistRunInBackground,
    cleanupRunResources: input.cleanupRunResources,
    inspectRunResources: input.inspectRunResources,
    executionAdapter: {
      execute: input.execute ?? (async () => {
        throw new Error("not used");
      }),
    },
    failRun: input.failRun ?? (async () => undefined),
    onRuntimeReady: input.onRuntimeReady ?? (() => undefined),
    onModelOutputDelta: input.onModelOutputDelta ?? (() => undefined),
    onRunFinished: input.onRunFinished ?? (() => undefined),
  };
}

test("BasicAgentRunExecutor keeps continuation state split from execution orchestration", async () => {
  const [executorSource, continuationsSource, runJobStoreSource] = await Promise.all([
    readFile(path.join(sourceDirectory, "run-executor.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "run-executor-continuations.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "run-job-store.ts"), "utf8"),
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
  assert.equal(runJobStoreSource.includes("function basicAgentJobLabel"), true);
  assert.equal(runJobStoreSource.includes("job.agentDefinitionRef?.agentDisplayName"), true);
  assert.equal(runJobStoreSource.includes("agentLabel: basicAgentJobLabel(job)"), true);
  assert.equal(runJobStoreSource.includes('agentLabel: "AgentArbor"'), false);
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
  const executor = new BasicAgentRunExecutor(executorConfig({ runJobs }));

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

test("BasicAgentRunExecutor defaults tool confirmation policy from prepared start facts", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ toolConfirmationPolicy: "full_access" }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "use persisted confirmation policy",
    aiMode: "fake",
    startImmediately: false,
  });
  const explicitPrompt = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "use request confirmation policy",
    aiMode: "fake",
    toolConfirmationPolicy: "prompt",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.toolConfirmationPolicy, "full_access");
  assert.equal(runJobs.get(explicitPrompt.runId)?.toolConfirmationPolicy, "prompt");
});

test("BasicAgentRunExecutor can defer scheduling until the caller has responded", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let executed = false;
  const activeRunJobs = new Set<Promise<void>>();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    activeRunJobs,
    execute: async () => {
      executed = true;
      return { completed: true };
    },
  }));

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

test("BasicAgentRunExecutor does not complete when execution result has no terminal state", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => ({
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "adapter forgot terminal state",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "failed");

  const failed = runJobs.get(run.runId);
  assert.equal(failed?.failed?.error.code, "execution_result_missing_terminal_state");
  assert.equal(executor.get(run.runId)?.status, "failed");
});

test("BasicAgentRunExecutor can return before background persistence settles", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let resolvePersistence: (() => void) | undefined;
  let backgroundPersistenceStarted = false;
  let backgroundPersistenceCompleted = false;
  const persistenceGate = new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  });
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
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
  }));

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

test("BasicAgentRunExecutor waits for prepared start facts before creating and persisting a run", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const startInputs: BasicAgentRunStartInput[] = [];
  let persisted = false;
  let resolveStartFacts: ((value: BasicAgentRunStartFacts) => void) | undefined;
  const startFactsPromise = new Promise<BasicAgentRunStartFacts>((resolve) => {
    resolveStartFacts = resolve;
  });
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: async (input) => {
      startInputs.push(input);
      return startFactsPromise;
    },
    persistRun: async () => {
      persisted = true;
    },
  }));

  const startPromise = executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "prepared startup",
    aiMode: "fake",
    startImmediately: false,
  });
  await Promise.resolve();

  assert.equal(startInputs.length, 1);
  assert.equal(persisted, false);

  resolveStartFacts?.(preparedStartFacts(startInputs[0], {
    capabilitySnapshot: {
      ...capabilitySnapshot(),
      snapshotId: "snapshot-prepared",
    },
  }));

  const run = await startPromise;
  assert.equal(run.status, "queued");
  assert.equal(persisted, true);
  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot?.snapshotId, "snapshot-prepared");
});

test("BasicAgentRunExecutor does not create or persist a run when start preparation fails", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let persisted = false;
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: async () => {
      throw new Error("start facts failed");
    },
    persistRun: async () => {
      persisted = true;
    },
  }));

  await assert.rejects(
    () => executor.start({
      runKind: "desktop",
      runMode: "agent",
      goal: "missing start facts",
      aiMode: "fake",
      startImmediately: false,
    }),
    /start facts failed/
  );
  assert.equal(persisted, false);
});

test("BasicAgentRunExecutor derives deep mode for underground runs before preparing start facts", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const startInputs: BasicAgentRunStartInput[] = [];
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: async (input) => {
      startInputs.push(input);
      return preparedStartFacts(input, { capabilitySnapshot: undefined });
    },
  }));

  const run = await executor.start({
    runKind: "underground",
    goal: "default underground mode",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(startInputs[0]?.runMode, "deep");
  assert.equal(run.runMode, "deep");
  assert.equal(runJobs.get(run.runId)?.runMode, "deep");
  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot, undefined);
});

test("BasicAgentRunExecutor rejects invalid run kind and mode pairs before start preparation", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let prepared = false;
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: async (input) => {
      prepared = true;
      return preparedStartFacts(input);
    },
  }));

  await assert.rejects(
    () =>
      executor.start({
        runKind: "desktop",
        runMode: "deep",
        goal: "invalid desktop deep run",
        aiMode: "fake",
        startImmediately: false,
      }),
    /Desktop run jobs must use ordinary agent mode/
  );
  assert.equal(prepared, false);
});

test("InMemoryBasicAgentRunJobStore rejects invalid run kind and mode pairs at job birth", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();

  assert.throws(
    () =>
      runJobs.create({
        runKind: "underground",
        runMode: "agent",
        goal: "invalid underground agent run",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
      }),
    /Underground run jobs must use deep mode/
  );
});

test("InMemoryBasicAgentRunJobStore requires frozen birth facts for ordinary desktop agent jobs", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();

  assert.throws(
    () =>
      runJobs.create({
        runKind: "desktop",
        runMode: "agent",
        goal: "missing capability snapshot",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
        agentDefinitionRef: defaultAgentDefinitionRef(),
      }),
    /capability snapshot frozen at run birth/
  );
  assert.throws(
    () =>
      runJobs.create({
        runKind: "desktop",
        runMode: "agent",
        goal: "missing agent definition ref",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
        capabilitySnapshot: capabilitySnapshot(),
      }),
    /AgentDefinition ref frozen at run birth/
  );
});

test("BasicAgentRunExecutor reject recovers through the same run", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const resumedInputs: unknown[] = [];
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => ({
      pendingApproval: {
        confirmationId: "confirmation-tool",
        async resume() {
          throw new Error("approval resume should not be used");
        },
        async resumeWithDecision(input) {
          resumedInputs.push(input);
          return {
            completed: true,
            canvas: {
              kind: "desktop_agent_canvas",
              agent: {},
            },
          };
        },
      },
    }),
  }));

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
    decision: "deny",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  assert.equal(resumedInputs.length, 1);
  const resumedInput = resumedInputs[0] as { readonly decision: string; readonly guidance?: string; readonly abortSignal?: AbortSignal };
  assert.equal(resumedInput.decision, "deny");
  assert.equal(resumedInput.guidance, undefined);
  assert.equal(typeof resumedInput.abortSignal?.aborted, "boolean");
  assert.equal(runJobs.get(run.runId)?.confirmationDecisions[0]?.decision, "deny");
  assert.equal(executor.get(run.runId)?.status, "completed");
});

test("BasicAgentRunExecutor approve continues before long command continuations finish", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const activeRunJobs = new Set<Promise<void>>();
  let releaseContinuation: (() => void) | undefined;
  let continuationStarted = false;
  let continuationFinished = false;
  const continuationGate = new Promise<void>((resolve) => {
    releaseContinuation = resolve;
  });
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    activeRunJobs,
    execute: async () => ({
      pendingApproval: {
        confirmationId: "confirmation-command",
        async resume() {
          continuationStarted = true;
          await continuationGate;
          continuationFinished = true;
          return {
            completed: true,
            canvas: {
              kind: "desktop_agent_canvas",
              agent: {},
            },
          };
        },
        async resumeWithDecision() {
          throw new Error("approval test should not use resumeWithDecision");
        },
      },
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {
          pendingConfirmation: {
            confirmationId: "confirmation-command",
          },
        },
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "run a long command after confirmation",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "approval_needed");

  const returned = await withTimeout(
    executor.submitConfirmationDecision({
      runId: run.runId,
      confirmationId: "confirmation-command",
      decision: "approve_once",
    }),
    100
  );

  assert.equal(returned.status, "running");
  assert.equal(runJobs.get(run.runId)?.status, "running");
  assert.equal(activeRunJobs.size, 1);
  assert.equal(continuationFinished, false);

  await waitUntil(() => continuationStarted);
  releaseContinuation?.();
  await waitUntil(() => continuationFinished);
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");
  await waitUntil(() => activeRunJobs.size === 0);
});

test("BasicAgentRunExecutor stores backend run capability resolution from execution result", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => ({
      completed: true,
      capabilityResolution: capabilityResolution(),
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "persist capability resolution",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.deepEqual(job?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(job?.completed?.capabilityResolution?.snapshotId, "snapshot-fixture");
});

test("InMemoryBasicAgentRunJobStore keeps capability resolution on failed runs", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const run = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "fail after resolving tools",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: defaultAgentDefinitionRef(),
  });

  runJobs.fail(run.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    capabilityResolution: capabilityResolution(),
    error: {
      code: "model_failed",
      message: "模型调用失败。",
    },
  });

  const failed = runJobs.get(run.runId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.capabilityResolution?.snapshotId, "snapshot-fixture");
  assert.deepEqual(failed?.failed?.capabilityResolution?.allowedTools, ["search"]);
});

test("BasicAgentRunExecutor stores failed execution result capability resolution", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => ({
      capabilityResolution: capabilityResolution(),
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
      failed: {
        code: "model_failed",
        message: "模型调用失败。",
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "fail after resolving tools",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "failed");

  const failed = runJobs.get(run.runId);
  assert.equal(failed?.failed?.error.code, "model_failed");
  assert.equal(failed?.capabilityResolution?.snapshotId, "snapshot-fixture");
  assert.deepEqual(failed?.failed?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(failed?.failed?.canvas?.kind, "desktop_agent_canvas");
});

test("BasicAgentRunExecutor keeps created run facts when the adapter returns a different snapshot", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const createdSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    activeModel: {
      ...modelConfig(),
      profileId: "created-profile",
      model: "created-model",
      openAI: {
        stream: true,
        parallelToolCalls: true,
      },
    },
  };
  const effectiveSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    activeModel: {
      ...modelConfig(),
      profileId: "effective-profile",
      model: "effective-model",
      openAI: {
        stream: false,
      },
    },
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      config: createdSnapshot.activeModel,
      capabilitySnapshot: createdSnapshot,
    }),
    execute: async () => ({
      completed: true,
      config: effectiveSnapshot.activeModel,
      informationAccess: {
        ...informationAccess(),
        sourcePreference: ["docs"],
        web: {
          ...informationAccess().web,
          maxResults: 99,
        },
      },
      capabilitySnapshot: effectiveSnapshot,
      capabilityResolution: {
        ...capabilityResolution(),
        snapshotId: "different-snapshot",
      },
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "persist effective execution facts",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.config.profileId, "created-profile");
  assert.equal(job?.config.model, "created-model");
  assert.deepEqual(job?.config.openAI, { stream: true, parallelToolCalls: true });
  assert.equal(job?.capabilitySnapshot?.activeModel.profileId, "created-profile");
  assert.deepEqual(job?.capabilitySnapshot?.activeModel.openAI, { stream: true, parallelToolCalls: true });
  assert.deepEqual(job?.informationAccess.sourcePreference, ["web"]);
  assert.equal(job?.informationAccess.web.maxResults, 5);
  assert.equal(job?.completed?.config.profileId, "created-profile");
  assert.equal(job?.completed?.capabilitySnapshot?.activeModel.profileId, "created-profile");
  assert.deepEqual(job?.completed?.informationAccess.sourcePreference, ["web"]);
  assert.equal(job?.completed?.informationAccess.web.maxResults, 5);
  assert.equal(job?.capabilityResolution, undefined);
  assert.equal(job?.completed?.capabilityResolution, undefined);
});

test("BasicAgentRunExecutor accepts execution request settings for the same frozen snapshot", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const createdSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    activeModel: {
      ...modelConfig(),
      profileId: "created-profile",
      model: "created-model",
      openAI: {
        stream: true,
        parallelToolCalls: true,
      },
    },
  };
  const effectiveSnapshot: BasicAgentCapabilitySnapshot = {
    ...createdSnapshot,
    activeModel: {
      ...createdSnapshot.activeModel,
      openAI: {
        stream: false,
      },
    },
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      config: createdSnapshot.activeModel,
      capabilitySnapshot: createdSnapshot,
    }),
    execute: async () => ({
      completed: true,
      config: effectiveSnapshot.activeModel,
      informationAccess: informationAccess(),
      capabilitySnapshot: effectiveSnapshot,
      capabilityResolution: capabilityResolution(),
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "persist effective request settings for same snapshot",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.config.profileId, "created-profile");
  assert.equal(job?.config.model, "created-model");
  assert.deepEqual(job?.config.openAI, { stream: false });
  assert.equal(job?.capabilitySnapshot?.activeModel.profileId, "created-profile");
  assert.deepEqual(job?.capabilitySnapshot?.activeModel.openAI, { stream: false });
  assert.equal(job?.completed?.config.profileId, "created-profile");
  assert.equal(job?.completed?.capabilitySnapshot?.activeModel.profileId, "created-profile");
  assert.deepEqual(job?.capabilityResolution?.allowedTools, ["search"]);
  assert.deepEqual(job?.completed?.capabilityResolution?.allowedTools, ["search"]);
});

test("BasicAgentRunExecutor rejects capability resolution that rewrites frozen tool metadata", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => {
      const resolution = capabilityResolution();
      return {
        completed: true,
        capabilityResolution: {
          ...resolution,
          toolExposures: resolution.toolExposures.map((tool) => ({
            ...tool,
            riskLevel: "high" as const,
          })),
        },
        canvas: {
          kind: "desktop_agent_canvas",
          agent: {},
        },
      };
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "reject forged tool risk",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.capabilityResolution, undefined);
  assert.equal(job?.completed?.capabilityResolution, undefined);
});

test("BasicAgentRunExecutor rejects capability resolution that rewrites frozen agent identity", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    execute: async () => {
      const resolution = capabilityResolution();
      return {
        completed: true,
        capabilityResolution: {
          ...resolution,
          agentId: "forged-agent",
          agentDisplayName: "Forged Agent",
          toolVisibilityProfileId: "forged-agent:ordinary-visible-tools:v1",
        },
        canvas: {
          kind: "desktop_agent_canvas",
          agent: {},
        },
      };
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "reject forged agent identity",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.capabilityResolution, undefined);
  assert.equal(job?.completed?.capabilityResolution, undefined);
});

test("BasicAgentRunExecutor rejects capability resolution that expands a frozen run tool boundary", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const snapshot = capabilitySnapshotWithReadFile();
  const run = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "keep frozen tool boundary",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: snapshot,
    agentDefinitionRef: defaultAgentDefinitionRef(),
  });
  const frozenResolution = capabilityResolutionWithReadFile({
    allowedTools: ["search"],
    readFileModelVisible: false,
  });
  runJobs.awaitApproval(run.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: snapshot,
    capabilityResolution: frozenResolution,
    canvas: {
      kind: "desktop_agent_canvas",
      agent: {
        pendingConfirmation: {
          confirmationId: "confirmation-test",
        },
      },
    },
  });

  runJobs.complete(run.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: snapshot,
    capabilityResolution: capabilityResolutionWithReadFile({
      allowedTools: ["search", "read_file"],
      readFileModelVisible: true,
    }),
    canvas: {
      kind: "desktop_agent_canvas",
      agent: {},
    },
  });

  const job = runJobs.get(run.runId);
  assert.equal(job?.status, "completed");
  assert.deepEqual(job?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(job?.capabilityResolution?.toolExposures.find((tool) => tool.name === "read_file")?.modelVisible, false);
  assert.deepEqual(job?.completed?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(job?.completed?.capabilityResolution?.toolExposures.find((tool) => tool.name === "read_file")?.modelVisible, false);
});

test("BasicAgentRunExecutor accepts capability resolution with frozen skill and MCP metadata", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const snapshot = capabilitySnapshotWithSkillAndMcp();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ capabilitySnapshot: snapshot }),
    execute: async () => ({
      completed: true,
      capabilityResolution: capabilityResolutionWithSkillAndMcp(),
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {},
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "accept frozen capability metadata",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.deepEqual(job?.capabilityResolution?.enabledSkills.map((skill) => skill.id), ["skill:context"]);
  assert.deepEqual(job?.completed?.capabilityResolution?.mcpDrafts.map((draft) => draft.draftId), ["mcp:context-server"]);
});

test("BasicAgentRunExecutor rejects capability resolution that rewrites frozen skill metadata", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const snapshot = capabilitySnapshotWithSkillAndMcp();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ capabilitySnapshot: snapshot }),
    execute: async () => {
      const resolution = capabilityResolutionWithSkillAndMcp();
      return {
        completed: true,
        capabilityResolution: {
          ...resolution,
          enabledSkills: resolution.enabledSkills.map((skill) => ({
            ...skill,
            description: "Forged skill description.",
          })),
        },
        canvas: {
          kind: "desktop_agent_canvas",
          agent: {},
        },
      };
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "reject forged skill",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.capabilityResolution, undefined);
  assert.equal(job?.completed?.capabilityResolution, undefined);
});

test("BasicAgentRunExecutor rejects capability resolution that rewrites frozen MCP metadata", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const snapshot = capabilitySnapshotWithSkillAndMcp();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ capabilitySnapshot: snapshot }),
    execute: async () => {
      const resolution = capabilityResolutionWithSkillAndMcp();
      return {
        completed: true,
        capabilityResolution: {
          ...resolution,
          mcpDrafts: resolution.mcpDrafts.map((draft) => ({
            ...draft,
            label: "Forged MCP",
          })),
        },
        canvas: {
          kind: "desktop_agent_canvas",
          agent: {},
        },
      };
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "reject forged mcp",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "completed");

  const job = runJobs.get(run.runId);
  assert.equal(job?.capabilityResolution, undefined);
  assert.equal(job?.completed?.capabilityResolution, undefined);
});

test("BasicAgentRunExecutor inspects run resources after completed and failed terminal outcomes", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const cleanupRunIds: string[] = [];
  const inspections: Array<{ readonly runId: string; readonly terminalStatus: string }> = [];
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    cleanupRunResources: (runId) => {
      cleanupRunIds.push(runId);
    },
    inspectRunResources: (runId, context) => {
      inspections.push({ runId, terminalStatus: context.terminalStatus });
    },
    execute: async ({ job }) => {
      if (job.goal.includes("fail")) {
        return {
          failed: {
            code: "model_failed",
            message: "model failed",
          },
        };
      }
      return { completed: true };
    },
  }));

  const completed = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "complete with resource inspection",
    aiMode: "fake",
  });
  const failed = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "fail with resource inspection",
    aiMode: "fake",
  });

  await waitUntil(() => runJobs.get(completed.runId)?.status === "completed");
  await waitUntil(() => runJobs.get(failed.runId)?.status === "failed");

  assert.deepEqual(cleanupRunIds, []);
  assert.deepEqual(inspections, [
    { runId: completed.runId, terminalStatus: "completed" },
    { runId: failed.runId, terminalStatus: "failed" },
  ]);
});

test("BasicAgentRunExecutor keeps frozen run facts on cancellation payloads", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const steps: string[] = [];
  const cleanupRunIds: string[] = [];
  const cleanupContexts: unknown[] = [];
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      capabilitySnapshot: {
        ...capabilitySnapshot(),
        snapshotId: "snapshot-cancel",
      },
    }),
    cleanupRunResources: (runId, context) => {
      cleanupRunIds.push(runId);
      cleanupContexts.push(context);
      steps.push(`cleanup:${runJobs.get(runId)?.status ?? "missing"}`);
    },
    onRunFinished: (job) => {
      steps.push(`finished:${job.status}`);
    },
    persistRun: async (job) => {
      steps.push(`persist:${job.status}`);
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "cancel with frozen facts",
    aiMode: "fake",
    startImmediately: false,
  });
  await executor.cancel(run.runId);

  const job = runJobs.get(run.runId);
  assert.deepEqual(cleanupRunIds, [run.runId]);
  assert.deepEqual(cleanupContexts, [{ reason: "cancel", terminalStatus: "cancelled" }]);
  assert.deepEqual(steps.slice(-3), ["cleanup:cancelled", "finished:cancelled", "persist:cancelled"]);
  assert.equal(job?.status, "cancelled");
  assert.equal(job?.capabilitySnapshot?.snapshotId, "snapshot-cancel");
  assert.equal(job?.cancelled?.capabilitySnapshot?.snapshotId, "snapshot-cancel");
  assert.equal(job?.cancelled?.config.profileId, job?.config.profileId);
  assert.deepEqual(job?.cancelled?.informationAccess.sourcePreference, job?.informationAccess.sourcePreference);
});

test("BasicAgentRunExecutor preserves cancellation when cleanup fails", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  let cleanupCalls = 0;
  let inspectCalls = 0;
  let finished = false;
  let persisted = false;
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      capabilitySnapshot: {
        ...capabilitySnapshot(),
        snapshotId: "snapshot-cleanup-failure",
      },
    }),
    cleanupRunResources: () => {
      cleanupCalls += 1;
      throw new Error("cleanup failed");
    },
    inspectRunResources: (_runId, context) => {
      inspectCalls += 1;
      assert.equal(context.terminalStatus, "cancelled");
      throw new Error("inspection failed");
    },
    onRunFinished: (job) => {
      finished = job.status === "cancelled";
    },
    persistRun: async (job) => {
      persisted = job.status === "cancelled";
    },
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "cancel despite cleanup failure",
    aiMode: "fake",
    startImmediately: false,
  });
  const returned = await executor.cancel(run.runId);

  const job = runJobs.get(run.runId);
  assert.equal(cleanupCalls, 1);
  assert.equal(inspectCalls, 1);
  assert.equal(finished, true);
  assert.equal(persisted, true);
  assert.equal(returned.status, "cancelled");
  assert.equal(job?.status, "cancelled");
  assert.equal(job?.cancelled?.reason.code, "run_cancelled");
  assert.equal(job?.cancelled?.capabilitySnapshot?.snapshotId, "snapshot-cleanup-failure");
});

test("BasicAgentRunExecutor keeps frozen run facts when approval continuation is lost", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      capabilitySnapshot: {
      ...capabilitySnapshot(),
      snapshotId: "snapshot-lost-continuation",
      },
    }),
    execute: async () => ({
      pendingApproval: {
        confirmationId: "confirmation-lost",
        async resume() {
          return {};
        },
        async resumeWithDecision() {
          return {};
        },
      },
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {
          pendingConfirmation: {
            confirmationId: "confirmation-lost",
          },
        },
      },
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "approval continuation will be lost",
    aiMode: "fake",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "approval_needed");
  const job = runJobs.get(run.runId);
  assert.equal(job?.capabilitySnapshot?.snapshotId, "snapshot-lost-continuation");
  const inspections: { readonly runId: string; readonly terminalStatus: string }[] = [];
  const restartedExecutor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    inspectRunResources: (runId, context) => {
      inspections.push({ runId, terminalStatus: context.terminalStatus });
    },
    execute: async () => {
      throw new Error("lost continuation test should not start a fresh run");
    },
  }));

  await restartedExecutor.submitConfirmationDecision({
    runId: run.runId,
    confirmationId: "confirmation-lost",
    decision: "approve_once",
  });
  await waitUntil(() => runJobs.get(run.runId)?.status === "blocked");

  const blocked = runJobs.get(run.runId);
  assert.equal(blocked?.blocked?.reason.code, "confirmation_continuation_lost");
  assert.equal(blocked?.blocked?.reason.message, "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。");
  assert.equal(blocked?.blocked?.capabilitySnapshot?.snapshotId, "snapshot-lost-continuation");
  assert.equal(blocked?.blocked?.config.profileId, blocked?.config.profileId);
  assert.deepEqual(blocked?.blocked?.informationAccess.sourcePreference, blocked?.informationAccess.sourcePreference);
  assert.deepEqual(inspections, [{ runId: run.runId, terminalStatus: "blocked" }]);
});

test("BasicAgentRunExecutor stores prepared agent definition ref when a run is created", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const agentDefinitionRef = defaultAgentDefinitionRef();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ agentDefinitionRef }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "capture agent ref at birth",
    aiMode: "fake",
    startImmediately: false,
  });
  const job = runJobs.get(run.runId);

  assert.deepEqual(run.agentDefinitionRef, agentDefinitionRef);
  assert.deepEqual(job?.agentDefinitionRef, agentDefinitionRef);
  assert.equal(JSON.stringify(run.agentDefinitionRef).includes("systemPrompt"), false);
  assert.equal(JSON.stringify(job?.agentDefinitionRef).includes("systemPrompt"), false);
});

test("BasicAgentRunExecutor omits agent definition ref when prepared start facts omit it", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      capabilitySnapshot: undefined,
    }),
  }));

  const run = await executor.start({
    runKind: "underground",
    runMode: "deep",
    goal: "compat deep run",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.agentDefinitionRef, undefined);
  assert.equal(run.agentDefinitionRef, undefined);
  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot, undefined);
});

test("InMemoryBasicAgentRunJobStore labels self stream events from frozen agent definition ref", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const agentDefinitionRef: RunAgentDefinitionRef = {
    agentId: "custom-basic-agent",
    agentDisplayName: "Custom Basic Agent",
    promptRef: "prompt:custom-basic-agent:v1",
    promptVersion: "v1",
    outputContractId: "custom.basic_agent_response.v1",
    toolVisibilityProfileId: "custom-basic-agent:ordinary-visible-tools:v1",
    definitionHash: "sha256:custom-basic-agent-test",
  };
  const createRun = (goal: string, ref?: RunAgentDefinitionRef): BasicAgentRunJob => {
    return runJobs.create({
      runKind: "desktop",
      runMode: "agent",
      goal,
      aiMode: "fake",
      config: modelConfig(),
      informationAccess: informationAccess(),
      capabilitySnapshot: capabilitySnapshot(),
      agentDefinitionRef: ref ?? defaultAgentDefinitionRef(),
    });
  };
  const terminalPayload = (message: string) => ({
    config: modelConfig(),
    informationAccess: informationAccess(),
    reason: {
      code: "test_terminal",
      message,
    },
  });

  const cancelled = createRun("cancel with custom agent", agentDefinitionRef);
  runJobs.cancel(cancelled.runId, terminalPayload("cancelled"));
  assert.equal(runJobs.get(cancelled.runId)?.streamEvents.at(-1)?.agentLabel, "Custom Basic Agent");

  const blocked = createRun("block with custom agent", agentDefinitionRef);
  runJobs.block(blocked.runId, terminalPayload("blocked"));
  assert.equal(runJobs.get(blocked.runId)?.streamEvents.at(-1)?.agentLabel, "Custom Basic Agent");

  const resumed = createRun("resume with custom agent", agentDefinitionRef);
  runJobs.recordRunResumed(resumed.runId, {
    confirmationId: "confirmation-custom-agent",
    resumedAt: "2026-06-02T00:00:00.000Z",
  });
  assert.equal(runJobs.get(resumed.runId)?.streamEvents.at(-1), undefined);

  const fallback = createRun("cancel with blank agent label", {
    ...defaultAgentDefinitionRef(),
    agentDisplayName: " ",
  });
  runJobs.cancel(fallback.runId, terminalPayload("fallback"));
  assert.equal(runJobs.get(fallback.runId)?.streamEvents.at(-1)?.agentLabel, "AgentArbor");
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
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: defaultAgentDefinitionRef(),
    ...overrides,
  };
}

function capabilityResolution(): RunCapabilityResolution {
  return {
    resolutionId: "capability-resolution-test",
    snapshotId: "snapshot-fixture",
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    allowedTools: ["search"],
    toolExposures: [
      {
        name: "search",
        displayName: "Search",
        enabled: true,
        modelVisible: true,
        scopes: ["desktop-basic", "research"],
        availability: "available",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        reason: "可用。",
      },
    ],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-05-12T00:00:00.000Z",
  };
}

function capabilityResolutionWithSkillAndMcp(): RunCapabilityResolution {
  return {
    ...capabilityResolution(),
    enabledSkills: [
      {
        id: "skill:context",
        name: "Context Skill",
        description: "Collects curated context for the ordinary Agent.",
        triggers: ["context", "workspace"],
      },
    ],
    mcpDrafts: [
      {
        draftId: "mcp:context-server",
        source: "mcp",
        label: "Context MCP",
        availability: "configured",
        enabled: true,
        reason: "已登记。",
      },
    ],
  };
}

function capabilityResolutionWithReadFile(input: {
  readonly allowedTools: readonly string[];
  readonly readFileModelVisible: boolean;
}): RunCapabilityResolution {
  return {
    ...capabilityResolution(),
    allowedTools: input.allowedTools,
    toolExposures: [
      ...capabilityResolution().toolExposures,
      {
        name: "read_file",
        displayName: "Read File",
        enabled: true,
        modelVisible: input.readFileModelVisible,
        scopes: ["desktop-basic", "workspace"],
        availability: "available",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        reason: input.readFileModelVisible ? "可用。" : "当前模式不可用。",
      },
    ],
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for confirmation decision response.")), timeoutMs);
    }),
  ]);
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

function defaultAgentDefinitionRef(): RunAgentDefinitionRef {
  return {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    definitionHash: "sha256:desktop-agent-session-test",
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-fixture",
    createdAt: "2026-05-12T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
    toolCatalog: {
      scope: "desktop-basic",
      allowedTools: ["search"],
      tools: [
        {
          name: "search",
          displayName: "Search",
          displayDescription: "Search the web.",
          description: "Search the web.",
          category: "research",
          categoryLabel: "Research",
          riskLevel: "low",
          riskLabel: "Low",
          operationType: "read-only",
          operationLabel: "Read only",
          requiresConfirmation: false,
          confirmationLabel: "No confirmation",
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 800,
            omitRawOutput: true,
          },
          scopes: ["desktop-basic", "research"],
          enabled: true,
          availability: "available",
        },
      ],
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-05-12T00:00:00.000Z",
    },
    securitySummary: "safe",
    warnings: [],
  };
}

function capabilitySnapshotWithSkillAndMcp(): BasicAgentCapabilitySnapshot {
  return {
    ...capabilitySnapshot(),
    skillCatalog: [
      {
        id: "skill:context",
        name: "Context Skill",
        description: "Collects curated context for the ordinary Agent.",
        enabled: true,
        sourcePath: "Z:/AgentArbor/.agents/skills/context/SKILL.md",
        triggers: ["context", "workspace"],
      },
    ],
    mcpCatalog: [
      {
        serverId: "context-server",
        label: "Context MCP",
        transport: "stdio",
        enabled: true,
        availability: "configured",
        commandSummary: "context-mcp",
        envSecretRefCount: 0,
        authSecretRefCount: 0,
        confirmationMode: "always",
        toolExposureMode: "none",
        enabledTools: [],
        autoApprovedTools: [],
        tools: [],
        exposedTools: [],
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  };
}

function capabilitySnapshotWithReadFile(): BasicAgentCapabilitySnapshot {
  return {
    ...capabilitySnapshot(),
    toolCatalog: {
      ...capabilitySnapshot().toolCatalog,
      allowedTools: ["search", "read_file"],
      tools: [
        ...capabilitySnapshot().toolCatalog.tools,
        {
          name: "read_file",
          displayName: "Read File",
          displayDescription: "Read a workspace file.",
          description: "Read a workspace file.",
          category: "workspace",
          categoryLabel: "Workspace",
          riskLevel: "low",
          riskLabel: "Low",
          operationType: "read-only",
          operationLabel: "Read only",
          requiresConfirmation: false,
          confirmationLabel: "No confirmation",
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 800,
            omitRawOutput: true,
          },
          scopes: ["desktop-basic", "workspace"],
          enabled: true,
          availability: "available",
        },
      ],
    },
  };
}

test("BasicAgentRunExecutor stores prepared capability snapshot when a run is created", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const preparedSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-created",
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({ capabilitySnapshot: preparedSnapshot }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "hello",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot?.snapshotId, "snapshot-created");
});

test("BasicAgentRunExecutor stores prepared config as the run config", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const preparedConfig: SanitizedModelProviderConfig = {
    ...modelConfig(),
    profileId: "snapshot-profile",
    model: "snapshot-model",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
  const preparedSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-model",
    activeModel: preparedConfig,
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      config: preparedConfig,
      capabilitySnapshot: preparedSnapshot,
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "use prepared config",
    aiMode: "fake",
    startImmediately: false,
  });

  const job = runJobs.get(run.runId);
  assert.equal(job?.config.profileId, "snapshot-profile");
  assert.equal(job?.config.model, "snapshot-model");
  assert.equal(job?.capabilitySnapshot?.activeModel.profileId, "snapshot-profile");
});

test("BasicAgentRunExecutor stores prepared ai mode when input omits aiMode", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const preparedConfig: SanitizedModelProviderConfig = {
    ...modelConfig(),
    defaultAiMode: "openai-compatible",
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      aiMode: "openai-compatible",
      config: preparedConfig,
    }),
  }));

  const run = await executor.start({
    runKind: "desktop",
    runMode: "agent",
    goal: "use prepared default ai mode",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.aiMode, "openai-compatible");
});

test("BasicAgentRunExecutor stores prepared direct config without capability snapshot", async () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const preparedConfig: SanitizedModelProviderConfig = {
    ...modelConfig(),
    profileId: "underground-profile",
    model: "underground-model",
  };
  const executor = new BasicAgentRunExecutor(executorConfig({
    runJobs,
    prepareRunStart: defaultPrepareRunStart({
      config: preparedConfig,
      capabilitySnapshot: undefined,
    }),
  }));

  const run = await executor.start({
    runKind: "underground",
    runMode: "deep",
    goal: "compat deep run",
    aiMode: "fake",
    startImmediately: false,
  });

  assert.equal(runJobs.get(run.runId)?.config.profileId, "underground-profile");
  assert.equal(runJobs.get(run.runId)?.capabilitySnapshot, undefined);
});
