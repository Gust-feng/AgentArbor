import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { BasicAgentRun } from "../../domain/basic-agent/index.js";
import type {
  RuntimeArtifactRecord,
  RuntimeConfirmationRecord,
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import {
  basicRunFromRuntimeSnapshot,
  restoredBasicEventsFromRuntimeSnapshot,
  submitRestoredBasicConfirmationDecision,
} from "./persistence.js";

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
  assert.equal(restoredEvents.includes("function fallbackBasicEventsFromRuntimeSnapshot"), true);
  assert.equal(confirmations.includes("export function upsertRestoredConfirmation"), true);
  assert.equal(confirmations.includes("export function restoredConfirmationDecisionEvent"), true);
  assert.equal(status.includes("export function agentTaskStatusFromSnapshot"), true);
});

test("restored basic events rebuild safe replay from runtime snapshot", () => {
  const events = restoredBasicEventsFromRuntimeSnapshot({
    ...snapshotFixture(),
    run: {
      ...runFixture(),
      status: "completed",
      resultSummary: "done with sk-hidden-secret-token",
    },
    events: [
      runtimeEvent(1, "goal.received", "raw goal ignored"),
      runtimeEvent(2, "tool.requested", "run command"),
      runtimeEvent(3, "tool.completed", "done with sk-hidden-secret-token"),
    ],
  });

  assert.deepEqual(events.map((event) => event.type), [
    "run.started",
    "tool.requested",
    "tool.completed",
    "final.result",
  ]);
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(JSON.stringify(events).includes("sk-hidden-secret-token"), false);
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
  assert.equal(database.snapshot.confirmations[0]?.guidance?.includes("sk-guidance-secret-token"), false);
  assert.equal(database.snapshot.basicEvents.at(-1)?.type, "user.guidance");
  assert.equal(database.snapshot.basicRun?.status, "needs_input");
});

test("restored basic run derives user-action state from pending confirmation", () => {
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

  assert.equal(run.status, "approval_needed");
  assert.equal(run.requiresUserAction, true);
  assert.equal(run.nextStep, undefined);
});

test("restored basic run keeps the frozen runtime agent definition ref", () => {
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

  const run = basicRunFromRuntimeSnapshot(snapshot);

  assert.deepEqual(run.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.notDeepEqual(run.agentDefinitionRef, snapshot.basicRun?.agentDefinitionRef);
  assert.equal(JSON.stringify(run.agentDefinitionRef).includes("systemPrompt"), false);
});

class MemoryRuntimeDatabase implements RuntimeDatabase {
  constructor(public snapshot: RuntimeRunSnapshot) {}

  async upsertWorkspace(record: RuntimeWorkspaceRecord): Promise<RuntimeWorkspaceRecord> {
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

  async upsertRun(record: RuntimeRunRecord): Promise<RuntimeRunRecord> {
    this.snapshot = { ...this.snapshot, run: record };
    return record;
  }

  async upsertBasicRun(record: BasicAgentRun): Promise<BasicAgentRun> {
    this.snapshot = { ...this.snapshot, basicRun: record };
    return record;
  }

  async replaceBasicRunEvents(_runId: string, events: readonly BasicAgentRunEvent[]): Promise<readonly BasicAgentRunEvent[]> {
    this.snapshot = { ...this.snapshot, basicEvents: events };
    return events;
  }

  async replaceRunEvents(_runId: string, events: readonly RuntimeEventRecord[]): Promise<readonly RuntimeEventRecord[]> {
    this.snapshot = { ...this.snapshot, events };
    return events;
  }

  async replaceModelCalls(_runId: string, calls: readonly RuntimeModelCallRecord[]): Promise<readonly RuntimeModelCallRecord[]> {
    this.snapshot = { ...this.snapshot, modelCalls: calls };
    return calls;
  }

  async replaceToolCalls(_runId: string, calls: readonly RuntimeToolCallRecord[]): Promise<readonly RuntimeToolCallRecord[]> {
    this.snapshot = { ...this.snapshot, toolCalls: calls };
    return calls;
  }

  async replaceArtifacts(_runId: string, artifacts: readonly RuntimeArtifactRecord[]): Promise<readonly RuntimeArtifactRecord[]> {
    this.snapshot = { ...this.snapshot, artifacts };
    return artifacts;
  }

  async replaceConfirmations(_runId: string, confirmations: readonly RuntimeConfirmationRecord[]): Promise<readonly RuntimeConfirmationRecord[]> {
    this.snapshot = { ...this.snapshot, confirmations };
    return confirmations;
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
  return {
    run: runFixture(),
    basicEvents: [],
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
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
  };
}

function runtimeEvent(
  sequence: number,
  type: RuntimeEventRecord["type"],
  summary: string
): RuntimeEventRecord {
  return {
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    type,
    summary,
    scope: "aboveground",
    severity: "info",
    progress: { status: "completed", label: "completed" },
    refs: [],
    traceId: "trace-1",
    intent: type.replaceAll(".", "_"),
    createdAt: "2026-06-02T00:00:00.000Z",
    recordedAt: "2026-06-02T00:00:00.000Z",
  };
}
