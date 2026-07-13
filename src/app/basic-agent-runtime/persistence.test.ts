import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type {
  BasicAgentCapabilitySnapshot,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type {
  RuntimeArtifactRecord,
  RuntimeConfirmationRecord,
  RuntimeContextLedgerRecord,
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeSubAgentRunRecord,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  restoredBasicEventsFromRuntimeSnapshot,
  submitRestoredBasicConfirmationDecision,
} from "./persistence.js";
import { OrdinaryRuntimeSnapshotContractError } from "./persistence-snapshot-contract.js";

const sourceDirectory = path.join(process.cwd(), "src", "app", "basic-agent-runtime");

test("basic agent persistence keeps restore projection helpers split from database orchestration", async () => {
  const [persistence, restoredEvents, confirmations, status] = await Promise.all([
    readFile(path.join(sourceDirectory, "persistence.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "persistence-restored-events.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "persistence-confirmations.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "persistence-status.ts"), "utf8"),
  ]);

  assert.equal(persistence.includes('from "./persistence-restored-events.js"'), true);
  assert.equal(persistence.includes('from "./persistence-confirmations.js"'), true);
  assert.equal(persistence.includes('from "./persistence-status.js"'), true);
  assert.equal(persistence.includes("function fallbackBasicEventsFromRuntimeSnapshot"), false);
  assert.equal(persistence.includes("function restoredConfirmationDecisionEvent"), false);
  assert.equal(persistence.includes("function agentTaskStatusFromRuntimeStatus"), false);
  assert.equal(restoredEvents.includes("export function restoredBasicEventsFromRuntimeSnapshot"), true);
  assert.equal(restoredEvents.includes("function fallbackBasicEventsFromRuntimeSnapshot"), false);
  assert.equal(restoredEvents.includes("createRestoredBasicTerminalEvent"), false);
  assert.equal(restoredEvents.includes("requireRestorableOrdinaryRuntimeSnapshot"), true);
  assert.equal(confirmations.includes("export function upsertRestoredConfirmation"), true);
  assert.equal(confirmations.includes("export function restoredConfirmationDecisionEvent"), true);
  assert.equal(status.includes("export function agentTaskStatusFromSnapshot"), true);
});

test("restored basic events join runtime summaries through stable event refs", () => {
  const events = restoredBasicEventsFromRuntimeSnapshot({
    ...snapshotFixture(),
    run: {
      ...runFixture(),
      status: "completed",
      resultSummary: "done with sk-hidden-secret-token",
    },
    basicEvents: [
      {
        ...basicEvent(1, "tool.requested", "run command", "running"),
        refs: [{ kind: "event", id: "event-11" }],
      },
      {
        ...basicEvent(2, "tool.completed", "done with sk-hidden-secret-token", "running"),
        refs: [{ kind: "event", id: "event-12" }],
      },
      basicEvent(3, "final.result", "done with sk-hidden-secret-token", "completed"),
    ],
    events: [
      runtimeEvent(1, "goal.received", "raw goal ignored"),
      runtimeEvent(2, "model.requested", "same-number event must not be joined"),
      runtimeEvent(11, "tool.requested", "runtime requested summary"),
      runtimeEvent(12, "tool.completed", "runtime completed summary"),
    ],
  });

  assert.deepEqual(events.map((event) => event.type), [
    "tool.requested",
    "tool.completed",
    "final.result",
  ]);
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(JSON.stringify(events).includes("sk-hidden-secret-token"), false);
  assert.equal(events[0]?.summary, "runtime requested summary");
  assert.equal(events[1]?.summary, "runtime completed summary");
  assert.equal(events[2]?.summary, undefined);
  assert.equal(JSON.stringify(events).includes("same-number event must not be joined"), false);
});

test("restored basic events reject terminal Ordinary snapshots without their terminal event", () => {
  assert.throws(
    () => restoredBasicEventsFromRuntimeSnapshot({
      ...snapshotFixture(),
      run: {
        ...runFixture(),
        status: "blocked",
      },
    }),
    (error: unknown) => {
      assert.equal(error instanceof OrdinaryRuntimeSnapshotContractError, true);
      assert.deepEqual(
        (error as OrdinaryRuntimeSnapshotContractError).missingFacts,
        ["basicEvents.run.blocked"]
      );
      return true;
    }
  );
});

test("ordinary snapshot clean break rejects tool lifecycle events without durable facts", () => {
  const invalidEvent = {
    ...runtimeEvent(1, "tool.completed", "completed"),
    payload: undefined,
  };
  assert.throws(
    () => basicRunFromRuntimeSnapshot({
      ...snapshotFixture(),
      events: [invalidEvent],
    }),
    (error) => error instanceof OrdinaryRuntimeSnapshotContractError &&
      error.missingFacts.includes("events.1.payload"),
  );
});

test("ordinary snapshot clean break rejects historical presentation caches", () => {
  const legacyCall = {
    callId: "tool-call-legacy",
    runId: "run-1",
    toolName: "read_file",
    status: "completed",
    summary: "legacy display cache",
    eventRefs: ["run-1:event:1"],
  } as unknown as RuntimeToolCallRecord;
  const legacyBasicEvent = {
    ...basicEvent(1, "tool.completed", "completed", "running"),
    detail: {
      display: { kind: "generic_tool_summary", summary: "legacy" },
    },
  } as BasicAgentRunEvent;

  assert.throws(
    () => basicRunFromRuntimeSnapshot({
      ...snapshotFixture(),
      basicEvents: [legacyBasicEvent],
      toolCalls: [legacyCall],
    }),
    (error) => error instanceof OrdinaryRuntimeSnapshotContractError &&
      error.missingFacts.includes("toolCalls.tool-call-legacy.presentation"),
  );
});

test("ordinary snapshot ignores historical Basic event display caches", () => {
  const snapshot = snapshotFixture();
  const restored = basicRunFromRuntimeSnapshot({
    ...snapshot,
    basicEvents: [{
      ...basicEvent(1, "run.started", "legacy summary", "running"),
      detail: { preview: "legacy preview", action: "legacy action" },
    }],
  });

  assert.equal(restored.currentStep, undefined);
});

test("ordinary snapshot treats executor output field names as opaque tool facts", () => {
  const snapshot = snapshotFixture();
  assert.doesNotThrow(() => basicRunFromRuntimeSnapshot({
    ...snapshot,
    events: snapshot.events.map((event) => event.type === "tool.completed"
      ? {
          ...event,
          payload: {
            callId: "tool-call-domain-display",
            toolName: "external_tool",
            output: {
              display: "domain-owned-display-mode",
              projection: "domain-owned-projection-name",
            },
            durationMs: 1,
          },
        }
      : event),
  }));
});

test("restored basic events omit lost approvals while preserving denied history", () => {
  const events = restoredBasicEventsFromRuntimeSnapshot({
    ...snapshotFixture(),
    basicEvents: [
      basicEvent(1, "run.started", "started", "running"),
      {
        ...basicEvent(2, "confirmation.needed", "等待批准", "approval_needed"),
        refs: [{ kind: "tool_call", id: "tool-call-approved" }],
      },
      {
        ...basicEvent(3, "user_approval.received", "已确认。", "blocked"),
        refs: [{ kind: "event", id: "confirmation:confirmation-approved" }],
      },
      {
        ...basicEvent(4, "confirmation.needed", "等待拒绝", "approval_needed"),
        refs: [{ kind: "tool_call", id: "tool-call-denied" }],
      },
      {
        ...basicEvent(5, "user_approval.received", "已不执行。", "blocked"),
        refs: [{ kind: "event", id: "confirmation:confirmation-denied" }],
      },
    ],
    confirmations: [
      {
        confirmationId: "confirmation-approved",
        runId: "run-1",
        status: "approved",
        title: "已确认",
        actionSummary: "运行命令：pnpm test",
        affectedResources: ["shell:test"],
        riskLevel: "medium",
        toolCallId: "tool-call-approved",
        requestedAt: "2026-06-02T00:00:02.000Z",
        decidedAt: "2026-06-02T00:00:03.000Z",
        eventRefs: ["event:confirmation-approved"],
      },
      {
        confirmationId: "confirmation-denied",
        runId: "run-1",
        status: "denied",
        title: "已不执行",
        actionSummary: "删除文件：old.txt",
        affectedResources: ["file:old.txt"],
        riskLevel: "high",
        toolCallId: "tool-call-denied",
        requestedAt: "2026-06-02T00:00:04.000Z",
        decidedAt: "2026-06-02T00:00:05.000Z",
        eventRefs: ["event:confirmation-denied"],
      },
    ],
    toolCalls: [
      {
        callId: "tool-call-approved",
        runId: "run-1",
        toolName: "shell_command",
        status: "approval_required",
        confirmationId: "confirmation-approved",
        eventRefs: [],
      },
      {
        callId: "tool-call-denied",
        runId: "run-1",
        toolName: "delete_file",
        status: "cancelled",
        confirmationId: "confirmation-denied",
        eventRefs: [],
      },
    ],
  });
  const serialized = JSON.stringify(events);

  assert.equal(events.filter((event) => event.type === "confirmation.needed").length, 1);
  assert.equal(events.find((event) => event.type === "confirmation.needed")?.summary, undefined);
  assert.equal(events.some((event) => event.type === "run.resumed"), false);
  assert.equal(events.some((event) => event.summary === "已确认。"), false);
  assert.equal(events.filter((event) => event.type === "user_approval.received").length, 1);
  assert.equal(events.find((event) => event.type === "user_approval.received")?.summary, undefined);
  assert.equal(serialized.includes("继续处理"), false);
});

test("restored confirmation decision updates run, confirmations, basic events, and basic run", async () => {
  const database = new MemoryRuntimeDatabase({
    ...snapshotFixture(),
    confirmations: [{
      confirmationId: "confirmation-1",
      runId: "run-1",
      status: "pending",
      title: "运行命令",
      actionSummary: "准备运行命令",
      affectedResources: ["shell:test"],
      riskLevel: "medium",
      requestedAt: "2026-06-02T00:00:02.000Z",
      eventRefs: ["event:confirmation"],
    }],
  });

  const run = await submitRestoredBasicConfirmationDecision({
    runtimeDatabase: database,
    runId: "run-1",
    confirmationId: "confirmation-1",
    decision: {
      decision: "guidance",
      guidance: "继续，但不要暴露 sk-guidance-secret-token",
    },
  });

  assert.equal(run?.status, "needs_input");
  assert.equal(database.snapshot.run.status, "needs_input");
  assert.equal(database.snapshot.confirmations[0]?.status, "guidance");
  assert.equal(database.snapshot.confirmations[0]?.guidance?.includes("sk-guidance-secret-token"), true);
  assert.equal(database.snapshot.basicEvents.at(-1)?.type, "user.guidance");
  assert.equal(database.snapshot.basicRun?.status, "needs_input");
});

test("restored approval without live continuation blocks with a new-turn recovery path", async () => {
  const database = new MemoryRuntimeDatabase({
    ...snapshotFixture(),
    confirmations: [{
      confirmationId: "confirmation-approve",
      runId: "run-1",
      status: "pending",
      title: "运行命令",
      actionSummary: "运行命令：pnpm test",
      affectedResources: ["shell:test"],
      riskLevel: "medium",
      requestedAt: "2026-06-02T00:00:02.000Z",
      eventRefs: ["event:confirmation"],
    }],
  });

  const run = await submitRestoredBasicConfirmationDecision({
    runtimeDatabase: database,
    runId: "run-1",
    confirmationId: "confirmation-approve",
    decision: {
      decision: "approve_once",
    },
  });

  assert.equal(run?.status, "blocked");
  assert.equal(database.snapshot.run.error?.message, "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。");
  assert.equal(database.snapshot.basicEvents.at(-1)?.summary, undefined);
  assert.equal(JSON.stringify(database.snapshot.basicEvents).includes("无法继续原操作"), false);
});

test("restored basic run trusts frozen run status instead of inferring it from confirmation records", () => {
  const run = basicRunFromRuntimeSnapshot({
    ...snapshotFixture(),
    run: {
      ...runFixture(),
      status: "running",
    },
    confirmations: [{
      confirmationId: "confirmation-1",
      runId: "run-1",
      status: "pending",
      title: "删除文件",
      actionSummary: "准备删除文件",
      affectedResources: ["file:test.md"],
      riskLevel: "high",
      requestedAt: "2026-06-02T00:00:02.000Z",
      eventRefs: ["event:confirmation"],
    }],
  });

  assert.equal(run.status, "blocked");
  assert.equal(run.requiresUserAction, true);
  assert.equal(run.nextStep, undefined);
});

test("restored basic run rejects conflicting duplicated agent definition facts", () => {
  const snapshot = {
    ...snapshotFixture(),
    run: {
      ...runFixture(),
      agentDefinitionRef: {
        agentId: "runtime-agent",
        agentDisplayName: "Runtime Agent",
        promptRef: "prompt:runtime-agent:v1",
        promptVersion: "1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "runtime-agent:ordinary-visible-tools:v1",
      },
    },
    basicRun: {
      runId: "run-1",
      conversationId: "conversation-1",
      title: "正在处理",
      goalSummary: "safe goal",
      status: "running",
      runMode: "agent",
      agentDefinitionRef: {
        agentId: "stale-basic-run-agent",
        agentDisplayName: "Stale Basic Run Agent",
        promptRef: "prompt:stale-basic-run-agent:v1",
        promptVersion: "1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "stale-basic-run-agent:ordinary-visible-tools:v1",
      },
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:05.000Z",
      eventCursor: {
        lastSequence: 0,
        eventCount: 0,
      },
    },
  } satisfies RuntimeRunSnapshot;

  assert.throws(
    () => basicRunFromRuntimeSnapshot(snapshot),
    (error) => error instanceof OrdinaryRuntimeSnapshotContractError &&
      error.missingFacts.includes("basicRun.agentDefinitionRefMismatch"),
  );
});

class MemoryRuntimeDatabase implements RuntimeDatabase {
  constructor(public snapshot: RuntimeRunSnapshot) {}

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
    this.snapshot = structuredClone(content);
    return structuredClone(this.snapshot);
  }

  async getRun(runId: string): Promise<RuntimeRunSnapshot | undefined> {
    return this.snapshot.run.runId === runId ? this.snapshot : undefined;
  }

  async listRuns(_limit?: number): Promise<readonly RuntimeRunRecord[]> {
    return [this.snapshot.run];
  }
}

type BasicAgentRunEvent = RuntimeRunSnapshot["basicEvents"][number];

function snapshotFixture(): RuntimeRunSnapshot {
  const run = runFixture();
  return {
    run,
    basicRun: {
      runId: run.runId,
      conversationId: run.conversationId,
      title: "正在处理",
      goalSummary: run.goalSummary,
      status: "running",
      runMode: "agent",
      agentDefinitionRef: run.agentDefinitionRef,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      requiresUserAction: false,
      eventCursor: {
        lastSequence: 1,
        eventCount: 1,
      },
    },
    basicEvents: [basicEvent(1, "run.started", "started", "running")],
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

function basicEvent(
  sequence: number,
  type: string,
  summary: string,
  status: BasicAgentRun["status"]
): BasicAgentRunEvent {
  return {
    id: `basic-event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    title: type,
    summary,
    status,
    timestamp: "2026-06-02T00:00:00.000Z",
    refs: [],
    visibility: "compact",
  };
}

function runtimeEvent(
  sequence: number,
  type: RuntimeEventRecord["type"],
  summary: string
): RuntimeEventRecord {
  const toolPayload = type === "tool.requested" || type === "tool.completed" || type === "tool.failed" || type === "tool.cancelled"
    ? {
        callId: "tool-call-1",
        toolName: "shell_command",
        input: { command: "pnpm test" },
        ...(type === "tool.completed"
          ? { output: { result: { command: "pnpm test", exitCode: 0 } }, durationMs: 5 }
          : type === "tool.failed"
            ? { error: "failed", durationMs: 5 }
            : type === "tool.cancelled"
              ? { reason: "cancelled", durationMs: 5 }
              : {}),
      }
    : undefined;
  return {
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    summary,
    scope: "aboveground",
    severity: "info",
    progress: { status: "completed", label: "completed" },
    refs: toolPayload === undefined ? [] : [{ kind: "tool_call", id: "tool-call-1" }],
    payload: toolPayload,
    traceId: "trace-1",
    intent: type.replaceAll(".", "_"),
    createdAt: "2026-06-02T00:00:00.000Z",
    recordedAt: "2026-06-02T00:00:00.000Z",
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
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}
