import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type {
  RuntimeDatabase,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  submitRestoredBasicConfirmationDecision,
} from "./persistence.js";
import { OrdinaryRuntimeSnapshotContractError } from "./persistence-snapshot-contract.js";

test("persisted Basic run is projected from frozen run facts and supplied events", () => {
  const events: readonly RunEvent[] = [{
    id: "run-1:final",
    runId: "run-1",
    sequence: 3,
    type: "final.result",
    title: "结果",
    summary: "完成",
    status: "completed",
    timestamp: "2026-06-02T00:00:05.000Z",
    refs: [],
    visibility: "compact",
  }];
  const snapshot = snapshotFixture({ status: "completed", resultSummary: "完成" });
  const run = basicRunFromRuntimeSnapshot(snapshot, events);

  assert.equal(run.runId, "run-1");
  assert.equal(run.goalSummary, "safe goal");
  assert.equal(run.status, "completed");
  assert.equal(run.currentStep, "完成");
  assert.deepEqual(run.eventCursor, { lastSequence: 3, eventCount: 1 });
});

test("ordinary snapshot clean break still rejects incomplete tool facts", () => {
  assert.throws(
    () => basicRunFromRuntimeSnapshot({
      ...snapshotFixture(),
      events: [{
        eventId: "event-1",
        runId: "run-1",
        sequence: 1,
        type: "tool.completed",
        summary: "completed",
        scope: "runtime",
        severity: "info",
        progress: { status: "completed", label: "completed" },
        refs: [{ kind: "tool_call", id: "call-1" }],
        traceId: "trace-1",
        intent: "complete_tool_execution",
        createdAt: "2026-06-02T00:00:01.000Z",
        recordedAt: "2026-06-02T00:00:01.000Z",
      }],
    }),
    (error) => error instanceof OrdinaryRuntimeSnapshotContractError &&
      error.missingFacts.includes("events.1.payload"),
  );
});

test("restored guidance writes only canonical snapshot fields", async () => {
  const longGuidance = `${"继续处理并保留完整要求。".repeat(80)}END`;
  const legacySnapshot = {
    ...snapshotWithPendingConfirmation("confirmation-guidance"),
    basicRun: { stale: true },
    basicEvents: [{ stale: true }],
  };
  const database = memoryDatabase(legacySnapshot);

  const snapshot = await submitRestoredBasicConfirmationDecision({
    runtimeDatabase: database,
    runId: "run-1",
    confirmationId: "confirmation-guidance",
    decision: { decision: "guidance", guidance: longGuidance },
  });

  assert.equal(snapshot?.run.status, "needs_input");
  assert.equal(database.snapshot.run.status, "needs_input");
  assert.equal(database.snapshot.confirmations[0]?.status, "guidance");
  assert.equal(database.snapshot.confirmations[0]?.guidance, longGuidance);
  assert.equal(Object.hasOwn(database.snapshot, "basicRun"), false);
  assert.equal(Object.hasOwn(database.snapshot, "basicEvents"), false);
});

test("restored approval records the decision and reports the lost live continuation", async () => {
  const database = memoryDatabase(snapshotWithPendingConfirmation("confirmation-approve"));

  const snapshot = await submitRestoredBasicConfirmationDecision({
    runtimeDatabase: database,
    runId: "run-1",
    confirmationId: "confirmation-approve",
    decision: { decision: "approve_once" },
  });

  assert.equal(snapshot?.run.status, "blocked");
  assert.equal(database.snapshot.run.stopReason, "confirmation_continuation_lost");
  assert.equal(database.snapshot.run.continuationAvailability, "lost_after_restart");
  assert.equal(database.snapshot.confirmations[0]?.status, "approved");
});

test("restored confirmation decisions do not rewrite terminal runs", async () => {
  for (const status of ["failed", "cancelled"] as const) {
    const pending = snapshotWithPendingConfirmation(`confirmation-${status}`);
    const database = memoryDatabase({
      ...pending,
      run: {
        ...pending.run,
        status,
      },
    });

    const run = await submitRestoredBasicConfirmationDecision({
      runtimeDatabase: database,
      runId: "run-1",
      confirmationId: `confirmation-${status}`,
      decision: { decision: "deny" },
    });

    assert.equal(run, undefined);
    assert.equal(database.saveCount, 0);
    assert.equal(database.snapshot.run.status, status);
    assert.equal(database.snapshot.confirmations[0]?.status, "pending");
  }
});

function memoryDatabase(initial: RuntimeRunSnapshot): RuntimeDatabase & {
  snapshot: RuntimeRunSnapshot;
  saveCount: number;
} {
  const database = {
    snapshot: structuredClone(initial),
    saveCount: 0,
    async getRun(runId: string) {
      return this.snapshot.run.runId === runId ? structuredClone(this.snapshot) : undefined;
    },
    async saveRunSnapshot(snapshot: RuntimeRunSnapshot) {
      this.saveCount += 1;
      this.snapshot = structuredClone(snapshot);
      return structuredClone(this.snapshot);
    },
  };
  return database as unknown as RuntimeDatabase & {
    snapshot: RuntimeRunSnapshot;
    saveCount: number;
  };
}

function snapshotWithPendingConfirmation(confirmationId: string): RuntimeRunSnapshot {
  return {
    ...snapshotFixture({ status: "approval_needed" }),
    confirmations: [{
      confirmationId,
      runId: "run-1",
      conversationId: "conversation-1",
      status: "pending",
      title: "运行命令",
      actionSummary: "运行命令：pnpm test",
      affectedResources: ["shell:test"],
      riskLevel: "medium",
      requestedAt: "2026-06-02T00:00:02.000Z",
      eventRefs: [`confirmation:${confirmationId}`],
    }],
  };
}

function snapshotFixture(
  runOverrides: Partial<RuntimeRunRecord> = {}
): RuntimeRunSnapshot {
  return {
    run: { ...runFixture(), ...runOverrides },
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
  };
}

function runFixture(): RuntimeRunRecord {
  return {
    runId: "run-1",
    profile: "lite",
    runKind: "desktop",
    runMode: "agent",
    status: "running",
    goalSummary: "safe goal",
    aiMode: "fake",
    conversationId: "conversation-1",
    traceId: "trace-1",
    appHome: "C:\\AgentArbor\\app",
    runHome: "C:\\AgentArbor\\runtime\\runs\\run-1",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:05.000Z",
    agentDefinitionRef: {
      agentId: "desktop-agent-session",
      agentDisplayName: "Desktop Agent",
      promptRef: "prompt:desktop-root-agent:v1",
      promptVersion: "v1",
      outputContractId: "desktop.agent_response.v1",
      toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
      definitionHash: "sha256:persistence-test",
    },
    capabilitySnapshot: capabilitySnapshot(),
    informationAccess: informationAccess(),
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-persistence-test",
    createdAt: "2026-06-02T00:00:00.000Z",
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
    toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
    securitySummary: "Frozen persistence test facts.",
    warnings: [],
  };
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
    updatedAt: "2026-06-02T00:00:00.000Z",
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
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
    stubs: { docs: "stub", packages: "stub", github: "stub", run_memory: "stub" },
  };
}
