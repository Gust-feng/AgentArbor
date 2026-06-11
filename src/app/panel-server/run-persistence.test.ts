import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeDatabase, RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
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
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import { PanelRunJobStore } from "../panel-run-jobs.js";
import type { PanelRunPersistenceRuntime } from "./run-persistence.js";
import { persistPanelRun } from "./run-persistence.js";

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
  assert.equal(database.workspaceRecords[0]?.path, "Z:\\FrozenWorkspace");
  assert.equal(database.runRecords[0]?.workspacePath, "Z:\\FrozenWorkspace");
});

function persistenceRuntime(database: MemoryRuntimeDatabase, runJobs: PanelRunJobStore): PanelRunPersistenceRuntime {
  return {
    runJobs,
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
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

class MemoryRuntimeDatabase implements RuntimeDatabase {
  readonly workspaceRecords: RuntimeWorkspaceRecord[] = [];
  readonly runRecords: RuntimeRunRecord[] = [];

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

  async getRun(_runId: string): Promise<RuntimeRunSnapshot | undefined> {
    return undefined;
  }

  async listRuns(_limit?: number): Promise<readonly RuntimeRunRecord[]> {
    return [];
  }
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
