import assert from "node:assert/strict";
import test from "node:test";
import type {
  RuntimeContextLedgerRecord,
  RuntimeDatabase,
  RuntimeRunSnapshot,
  RuntimeSubAgentRunRecord,
} from "../../domain/runtime-database/index.js";
import type {
  RuntimeArtifactRecord,
  RuntimeConfirmationRecord,
  RuntimeConversationRecord,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { PanelRunJobStore } from "./run-jobs.js";
import type { PanelRunPersistenceRuntime } from "./run-persistence.js";
import { persistPanelRun, persistPanelRunInBackground } from "./run-persistence.js";
import { waitForPanelPersistenceIdle } from "./persistence.js";

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
  assert.equal(database.upsertRunAttempts, 2);
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

  async upsertWorkspace(record: RuntimeWorkspaceRecord): Promise<RuntimeWorkspaceRecord> {
    this.workspaceRecords.push(record);
    return record;
  }

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

  async upsertRun(record: RuntimeRunRecord): Promise<RuntimeRunRecord> {
    this.runRecords.push(record);
    return record;
  }

  async upsertBasicRun(record: BasicAgentRun): Promise<BasicAgentRun> {
    return record;
  }

  async replaceBasicRunEvents(_runId: string, events: readonly RunEvent[]): Promise<readonly RunEvent[]> {
    return events;
  }

  async replaceRunEvents(_runId: string, events: readonly RuntimeEventRecord[]): Promise<readonly RuntimeEventRecord[]> {
    return events;
  }

  async replaceModelCalls(_runId: string, calls: readonly RuntimeModelCallRecord[]): Promise<readonly RuntimeModelCallRecord[]> {
    return calls;
  }

  async replaceToolCalls(_runId: string, calls: readonly RuntimeToolCallRecord[]): Promise<readonly RuntimeToolCallRecord[]> {
    return calls;
  }

  async replaceArtifacts(_runId: string, artifacts: readonly RuntimeArtifactRecord[]): Promise<readonly RuntimeArtifactRecord[]> {
    return artifacts;
  }

  async replaceConfirmations(_runId: string, confirmations: readonly RuntimeConfirmationRecord[]): Promise<readonly RuntimeConfirmationRecord[]> {
    return confirmations;
  }

  async replaceSubAgentRuns(_runId: string, records: readonly RuntimeSubAgentRunRecord[]): Promise<readonly RuntimeSubAgentRunRecord[]> {
    return records;
  }

  async upsertContextLedger(record: RuntimeContextLedgerRecord): Promise<RuntimeContextLedgerRecord> {
    this.contextLedgers.push(record);
    return record;
  }

  async getRun(_runId: string): Promise<RuntimeRunSnapshot | undefined> {
    return undefined;
  }

  async listRuns(_limit?: number): Promise<readonly RuntimeRunRecord[]> {
    return [];
  }
}

class FailOnceUpsertRunDatabase extends MemoryRuntimeDatabase {
  upsertRunAttempts = 0;

  override async upsertRun(record: RuntimeRunRecord): Promise<RuntimeRunRecord> {
    this.upsertRunAttempts += 1;
    if (this.upsertRunAttempts === 1) {
      const error = new Error("simulated runtime database write failure") as Error & { code: string };
      error.code = "EIO";
      throw error;
    }
    return super.upsertRun(record);
  }
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
