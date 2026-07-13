import assert from "node:assert/strict";
import test from "node:test";
import type {
  RuntimeContextLedgerRecord,
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeConversationRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { PanelRunJobStore } from "./run-jobs.js";
import { submitRestoredBasicConfirmationDecision } from "../basic-agent-runtime/persistence.js";
import { createOrdinaryAgentRuntime } from "../desktop-agent/ordinary-agent-runtime.js";
import type { PanelRunPersistenceRuntime } from "./run-persistence.js";
import { persistPanelRun, persistPanelRunInBackground } from "./run-persistence.js";
import { enqueuePanelPersistence, waitForPanelPersistenceIdle } from "./persistence.js";

test("persistPanelRun uses frozen capability workspace instead of current config workspace", async () => {
  const database = new MemoryRuntimeDatabase();
  const runJobs = new PanelRunJobStore();
  const runtime = persistenceRuntime(database, runJobs);
  const job = runJobs.create({
    runKind: "underground",
    runMode: "deep",
    goal: "Persist without frozen workspace",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  await persistPanelRun(runtime, job);

  assert.equal(database.workspaceRecords.length, 0);
  assert.equal(database.runRecords[0]?.workspaceId, undefined);
  assert.equal(database.runRecords[0]?.workspacePath, undefined);
});

test("persistPanelRun writes the workspace frozen at run birth", async () => {
  const database = new MemoryRuntimeDatabase();
  const runJobs = new PanelRunJobStore();
  const runtime = persistenceRuntime(database, runJobs);
  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "Persist frozen workspace",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    agentDefinitionRef: {
      agentId: "desktop-agent-session",
      agentDisplayName: "Desktop Agent",
      promptRef: "prompt:desktop-root-agent:v1",
      promptVersion: "v1",
      outputContractId: "desktop.agent_response.v1",
      toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
      definitionHash: "sha256:run-persistence-test",
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-test",
      createdAt: "2026-05-31T00:00:00.000Z",
      activeModel: modelConfig(),
      modelCapabilities: {
        contextWindowTokens: 128_000,
        maxOutputTokens: 4_000,
        supportsToolCalling: true,
        supportsParallelToolCalls: false,
        supportsStructuredOutputs: false,
        supportsStreaming: true,
        supportsVisionInput: false,
        supportsReasoningEffort: false,
        preferredApiStyle: "chat_completions",
        stability: "stable",
      },
      toolCatalog: {
        scope: "desktop-basic",
        tools: [],
        allowedTools: [],
      },
      skillCatalog: [],
    subAgentCatalog: [],
      mcpCatalog: [],
      workspace: {
        workspaceDirectory: "Z:\\FrozenWorkspace",
        updatedAt: "2026-05-30T00:00:00.000Z",
      },
      securitySummary: "Frozen facts for this run.",
      warnings: [],
    },
  });

  await persistPanelRun(runtime, job);

  assert.equal(database.workspaceRecords.length, 1);
  assert.equal(database.workspaceRecords[0]?.workspaceId, `workspace:run:${job.runId}`);
  assert.equal(database.runRecords[0]?.workspaceId, `workspace:run:${job.runId}`);
  assert.equal(database.workspaceRecords[0]?.path, "Z:\\FrozenWorkspace");
  assert.equal(database.runRecords[0]?.workspacePath, "Z:\\FrozenWorkspace");
});

test("persistPanelRun stores safe context ledger projection for triggered skills", async () => {
  const database = new MemoryRuntimeDatabase();
  const runJobs = new PanelRunJobStore();
  const basicRun = basicRunFixture("run-placeholder");
  const runtime = persistenceRuntime(database, runJobs, {
    getBasicRun: (runId) => ({ ...basicRun, runId }),
    replayEvents: (runId) => basicReplayFixture(runId),
  });
  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "please review this change",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: {
      agentId: "desktop-agent-session",
      agentDisplayName: "Desktop Agent",
      promptRef: "prompt:desktop-root-agent:v1",
      promptVersion: "v1",
      outputContractId: "desktop.agent_response.v1",
      toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
      definitionHash: "sha256:run-persistence-skill-test",
    },
  });
  runJobs.complete(job.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-skill-persist",
        goalSummary: "please review this change",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "done",
          modelCallRefs: [],
          toolCallRefs: [],
          evidenceRefs: [],
          resultBlocks: [],
        },
        modelCallRefs: [],
        toolCallRefs: [],
        activity: [],
        context: {
          usageSummary: "技能 1",
          budget: {
            maxMessages: 20,
            maxChars: 8_000,
            usedChars: 120,
          },
          truncated: false,
          items: [{
            itemId: "context:skill:repo-review",
            sourceKind: "skill",
            summary: [
              "Triggered skill: Repo Review",
              "Why: 触发词：review",
              "FULL PRIVATE SKILL BODY SHOULD NOT PERSIST",
            ].join("\n"),
            visibility: "model",
            truncated: false,
          }],
          truncationReport: {
            truncated: false,
            omittedItemCount: 0,
            truncatedItemIds: [],
          },
        },
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  await persistPanelRun(runtime, job);

  assert.equal(database.contextLedgers.length, 1);
  assert.equal(database.contextLedgers[0]?.entries.some((entry) => entry.kind === "skill"), true);
  assert.equal(JSON.stringify(database.contextLedgers[0]).includes("Repo Review"), true);
  assert.equal(JSON.stringify(database.contextLedgers[0]).includes("FULL PRIVATE SKILL BODY"), false);
});

test("persistPanelRunInBackground records failures without poisoning the queue", async () => {
  const database = new FailOnceUpsertRunDatabase();
  const runJobs = new PanelRunJobStore();
  const runtime = persistenceRuntime(database, runJobs);
  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "Persist in background",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: {
      agentId: "desktop-agent-session",
      agentDisplayName: "Desktop Agent",
      promptRef: "prompt:desktop-root-agent:v1",
      promptVersion: "v1",
      outputContractId: "desktop.agent_response.v1",
      toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
      definitionHash: "sha256:run-persistence-background-test",
    },
  });
  const unhandledRejections: unknown[] = [];
  const loggedErrors: unknown[][] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    loggedErrors.push(args);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    persistPanelRunInBackground(runtime, job);
    persistPanelRunInBackground(runtime, job);
    await waitForPanelPersistenceIdle(runtime.persistenceChains);
    await flushUnhandledRejections();
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    console.error = originalConsoleError;
  }

  const diagnostic = job.streamEvents.find((event) => event.eventId.includes(":persistence.failed:"));
  assert.equal(database.saveRunSnapshotAttempts, 2);
  assert.equal(database.runRecords.length, 1);
  assert.equal(runtime.persistenceChains.size, 0);
  assert.equal(unhandledRejections.length, 0);
  assert.equal(loggedErrors.length, 1);
  assert.equal(diagnostic?.type, "agent.note.completed");
  assert.equal(diagnostic?.status, "failed");
  assert.equal(diagnostic?.detail?.errorDomain, "runtime_error");
  assert.equal(diagnostic?.detail?.errorFacts?.operation, "persist_panel_run");
  assert.equal(diagnostic?.detail?.errorFacts?.runId, job.runId);
});

test("restored confirmation waits for an in-flight background snapshot of the same run", async () => {
  const database = new GatedSnapshotDatabase();
  const runJobs = new PanelRunJobStore();
  const agentDefinitionRef = {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    definitionHash: "sha256:run-persistence-confirmation-race-test",
  };
  const runtime = persistenceRuntime(database, runJobs, {
    getBasicRun: (runId) => ({
      ...basicRunFixture(runId),
      status: "approval_needed",
      agentDefinitionRef,
    }),
    replayEvents: (runId) => ({
      cursor: { runId, lastSequence: 1, eventCount: 1 },
      events: [{
        id: `${runId}:event:1`,
        runId,
        sequence: 1,
        type: "user_approval.requested",
        title: "等待确认",
        summary: "是否继续？",
        status: "approval_needed",
        timestamp: "2026-05-31T00:00:01.000Z",
        refs: [],
        visibility: "compact",
      }],
    }),
  });
  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "Persist confirmation without a stale overwrite",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef,
  });
  const confirmationId = "confirmation-background-race";
  const ordinaryRuntime = createOrdinaryAgentRuntime();
  ordinaryRuntime.eventLog.append({
    id: `${job.runId}:confirmation-requested`,
    traceId: `${job.runId}:trace`,
    from: { id: "desktop-agent-session", role: "agent" },
    type: "user_approval.requested",
    intent: "request_confirmation",
    payload: {
      confirmationId,
      question: "是否继续？",
      consequence: "将执行受控测试动作。",
      riskLevel: "medium",
    },
    createdAt: "2026-05-31T00:00:01.000Z",
  });
  runJobs.attachRuntime({
    runId: job.runId,
    runtime: ordinaryRuntime,
    traceId: `${job.runId}:trace`,
    goalId: `${job.runId}:goal`,
  });
  runJobs.awaitApproval(job.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
  });
  const approvalJob = runJobs.get(job.runId);
  assert.ok(approvalJob);
  await persistPanelRun(runtime, approvalJob);

  const gate = database.gateNextSnapshotSave();
  persistPanelRunInBackground(runtime, approvalJob);
  await gate.started;
  let restored: BasicAgentRun | undefined;
  const decision = enqueuePanelPersistence(runtime.persistenceChains, job.runId, async () => {
    restored = await submitRestoredBasicConfirmationDecision({
      runtimeDatabase: database,
      runId: job.runId,
      confirmationId,
      decision: { decision: "deny" },
    });
  });

  gate.release();
  await decision;
  await waitForPanelPersistenceIdle(runtime.persistenceChains);
  const committed = await database.getRun(job.runId);

  assert.equal(restored?.status, "blocked");
  assert.equal(committed?.run.status, "blocked");
  assert.equal(committed?.confirmations.find((item) => item.confirmationId === confirmationId)?.status, "denied");
});

function persistenceRuntime(
  database: MemoryRuntimeDatabase,
  runJobs: PanelRunJobStore,
  overrides: {
    readonly getBasicRun?: (runId: string) => BasicAgentRun | undefined;
    readonly replayEvents?: (runId: string) => {
      readonly cursor: { readonly runId: string; readonly lastSequence: number; readonly eventCount: number };
      readonly events: readonly RunEvent[];
    } | undefined;
  } = {}
): PanelRunPersistenceRuntime {
  return {
    runJobs,
    runExecutor: {
      get: (runId) => overrides.getBasicRun?.(runId),
      replayEvents: (runId) => overrides.replayEvents?.(runId),
      syncRunEvents: () => [],
    },
    conversations: {
      getReadModel: () => undefined,
    },
    persistenceChains: new Map(),
    runtimeDatabase: database,
    runtimePaths: {
      appHome: "C:\\AgentArbor\\app",
      runtimeHome: "C:\\AgentArbor\\runtime",
    },
  };
}

function basicRunFixture(runId: string): BasicAgentRun {
  return {
    runId,
    title: "已完成",
    goalSummary: "please review this change",
    status: "completed",
    runMode: "agent",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:01.000Z",
    requiresUserAction: false,
    eventCursor: {
      lastSequence: 1,
      eventCount: 1,
    },
  };
}

function basicReplayFixture(runId: string): {
  readonly cursor: { readonly runId: string; readonly lastSequence: number; readonly eventCount: number };
  readonly events: readonly RunEvent[];
} {
  return {
    cursor: {
      runId,
      lastSequence: 1,
      eventCount: 1,
    },
    events: [{
      id: `${runId}:event:1`,
      runId,
      sequence: 1,
      type: "final.result",
      title: "已回答",
      summary: "已回答。",
      status: "completed",
      timestamp: "2026-05-31T00:00:01.000Z",
      refs: [],
      visibility: "compact",
    }],
  };
}

class MemoryRuntimeDatabase implements RuntimeDatabase {
  readonly workspaceRecords: RuntimeWorkspaceRecord[] = [];
  readonly runRecords: RuntimeRunRecord[] = [];
  readonly contextLedgers: RuntimeContextLedgerRecord[] = [];

  readonly snapshots = new Map<string, RuntimeRunSnapshot>();

  async upsertConversation(record: RuntimeConversationRecord): Promise<RuntimeConversationRecord> {
    return record;
  }

  async getConversation(_conversationId: string): Promise<RuntimeConversationRecord | undefined> {
    return undefined;
  }

  async listConversations(_limit?: number): Promise<readonly RuntimeConversationRecord[]> {
    return [];
  }

  async deleteConversation(_conversationId: string): Promise<void> {
    return undefined;
  }

  async saveRunSnapshot(content: RuntimeRunSnapshot): Promise<RuntimeRunSnapshot> {
    const stored = structuredClone(content);
    this.snapshots.set(stored.run.runId, stored);
    this.runRecords.push(stored.run);
    if (stored.workspace !== undefined) {
      this.workspaceRecords.push(stored.workspace);
    }
    if (stored.contextLedger !== undefined) {
      this.contextLedgers.push(stored.contextLedger);
    }
    return structuredClone(stored);
  }

  async getRun(runId: string): Promise<RuntimeRunSnapshot | undefined> {
    const snapshot = this.snapshots.get(runId);
    return snapshot === undefined ? undefined : structuredClone(snapshot);
  }

  async listRuns(_limit?: number): Promise<readonly RuntimeRunRecord[]> {
    return [];
  }
}

class FailOnceUpsertRunDatabase extends MemoryRuntimeDatabase {
  saveRunSnapshotAttempts = 0;

  override async saveRunSnapshot(content: RuntimeRunSnapshot): Promise<RuntimeRunSnapshot> {
    this.saveRunSnapshotAttempts += 1;
    if (this.saveRunSnapshotAttempts === 1) {
      const error = new Error("simulated runtime database write failure") as Error & { code: string };
      error.code = "EIO";
      throw error;
    }
    return super.saveRunSnapshot(content);
  }
}

class GatedSnapshotDatabase extends MemoryRuntimeDatabase {
  private nextSaveGate: {
    readonly started: () => void;
    readonly released: Promise<void>;
  } | undefined;

  gateNextSnapshotSave(): { readonly started: Promise<void>; readonly release: () => void } {
    const started = deferred();
    const released = deferred();
    this.nextSaveGate = {
      started: started.resolve,
      released: released.promise,
    };
    return {
      started: started.promise,
      release: released.resolve,
    };
  }

  override async saveRunSnapshot(content: RuntimeRunSnapshot): Promise<RuntimeRunSnapshot> {
    const gate = this.nextSaveGate;
    if (gate !== undefined) {
      this.nextSaveGate = undefined;
      gate.started();
      await gate.released;
    }
    return super.saveRunSnapshot(content);
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

async function flushUnhandledRejections(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "fake-model",
    secretRef: "secret://test/model",
    secretConfigured: false,
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["docs"],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 0,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "capability-snapshot-test",
    createdAt: "2026-05-31T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools: [],
      allowedTools: [],
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-05-30T00:00:00.000Z",
    },
    securitySummary: "Frozen facts for this run.",
    warnings: [],
  };
}
