import assert from "node:assert/strict";
import test from "node:test";
import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import { OrdinaryRuntimeSnapshotContractError } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import { restorePersistedPanelConversation } from "./conversation-restore.js";

test("conversation restore rejects an invalid Ordinary snapshot before trusting a completed assistant tail", async () => {
  const runId = "invalid-completed-run";
  const conversationId = "conversation-invalid-completed-tail";
  const conversations = new PanelConversationStore();
  let persistedConversation: RuntimeConversationRecord | undefined;
  const runtimeDatabase: Pick<RuntimeDatabase, "getRun" | "upsertConversation"> = {
    getRun: async (requestedRunId) =>
      requestedRunId === runId ? invalidOrdinarySnapshot(runId, "completed") : undefined,
    upsertConversation: async (record) => {
      persistedConversation = record;
      return record;
    },
  };

  await assert.rejects(
    restorePersistedPanelConversation(
      { conversations, runtimeDatabase },
      conversationRecord(conversationId, runId)
    ),
    (error: unknown) =>
      error instanceof OrdinaryRuntimeSnapshotContractError &&
      error.missingFacts.includes("run.capabilitySnapshot")
  );

  assert.equal(conversations.get(conversationId), undefined);
  assert.equal(persistedConversation, undefined);
});

function conversationRecord(conversationId: string, runId: string): RuntimeConversationRecord {
  return {
    conversationId,
    title: "失效运行",
    preview: "旧完成记录不能进入新契约。",
    status: "completed",
    latestRunId: runId,
    queuedRunIds: [],
    queuedRunCount: 0,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:02.000Z",
    turns: [
      {
        turnId: "turn-user-invalid-tail",
        role: "user",
        title: "用户",
        content: "继续旧任务",
        status: "completed",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      {
        turnId: "turn-assistant-invalid-tail",
        role: "assistant",
        title: "已完成",
        content: "这条回答来自失效的旧运行记录。",
        status: "completed",
        runId,
        createdAt: "2026-07-12T00:00:01.000Z",
        updatedAt: "2026-07-12T00:00:02.000Z",
      },
    ],
  };
}

function invalidOrdinarySnapshot(
  runId: string,
  status: RuntimeRunSnapshot["run"]["status"]
): RuntimeRunSnapshot {
  return {
    run: {
      runId,
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status,
      goalSummary: "旧运行",
      aiMode: "fake",
      appHome: "C:/AgentArbor",
      runHome: `C:/AgentArbor/runs/${runId}`,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:02.000Z",
    },
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
  };
}
