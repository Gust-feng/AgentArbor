import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryAgentFeature,
  OrdinaryConversationReadModel,
  OrdinaryRunState,
} from "../ordinary-agent/index.js";
import {
  USAGE_HEATMAP_WINDOW_DAYS,
  createPanelUsageStatistics,
} from "./panel-usage-statistics.js";

test("panel usage statistics aggregates canonical Ordinary conversations and run usage", async () => {
  const conversations = [
    conversation("conversation-1", "2026-06-26T01:00:00.000Z", [
      turn("turn-1", "2026-06-26T01:00:00.000Z"),
      turn("turn-2", "2026-06-26T01:00:01.000Z"),
      turn("turn-3", "2026-06-27T01:00:00.000Z"),
    ]),
    conversation("conversation-2", "2026-06-28T01:00:00.000Z", [
      turn("turn-4", "2026-06-28T01:00:00.000Z"),
      turn("turn-5", "2026-06-28T01:00:01.000Z"),
    ]),
  ];
  const runs = [
    ordinaryRun("run-1", "2026-06-26T01:00:01.000Z", {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 40,
    }),
    ordinaryRun("run-2", "2026-06-28T01:00:01.000Z", {
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      cachedInputTokens: 5,
    }),
  ];

  const response = await createPanelUsageStatistics({
    ordinaryAgentFeature: ordinaryFeature(conversations, runs),
    generatedAt: "2026-06-28T12:00:00.000Z",
  });
  const statistics = response.statistics;
  const day26 = statistics.dailyActivity.find((item) => item.date === "2026-06-26");
  const day28 = statistics.dailyActivity.find((item) => item.date === "2026-06-28");

  assert.equal(statistics.storageAvailable, true);
  assert.equal(statistics.heatmapWindowDays, USAGE_HEATMAP_WINDOW_DAYS);
  assert.equal(statistics.firstActivityDate, "2026-06-26");
  assert.equal(statistics.lastActivityDate, "2026-06-28");
  assert.deepEqual(statistics.totals, {
    conversationCount: 2,
    messageCount: 5,
    runCount: 2,
    inputTokens: 200,
    outputTokens: 50,
    totalTokens: 260,
    cacheSavedTokens: 45,
  });
  assert.equal(statistics.dailyActivity.length, USAGE_HEATMAP_WINDOW_DAYS);
  assert.equal(day26?.messageCount, 2);
  assert.equal(day26?.inputTokens, 120);
  assert.equal(day26?.outputTokens, 30);
  assert.equal(day26?.cacheSavedTokens, 40);
  assert.equal(day28?.messageCount, 2);
  assert.equal(day28?.inputTokens, 80);
  assert.equal(day28?.outputTokens, 20);
  assert.equal(day26?.level, 5);
  assert.equal(day28?.level, 5);
});

test("panel usage statistics returns an empty current view when Ordinary has no records", async () => {
  const response = await createPanelUsageStatistics({
    ordinaryAgentFeature: ordinaryFeature([], []),
    generatedAt: "2026-06-28T12:00:00.000Z",
  });

  assert.deepEqual(response.statistics.totals, {
    conversationCount: 0,
    messageCount: 0,
    runCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheSavedTokens: 0,
  });
  assert.equal(response.statistics.firstActivityDate, undefined);
  assert.equal(response.statistics.lastActivityDate, undefined);
  assert.equal(response.statistics.dailyActivity.every((item) => item.level === 0), true);
});

function ordinaryFeature(
  conversations: readonly OrdinaryConversationReadModel[],
  runs: readonly OrdinaryRunState[],
): OrdinaryAgentFeature {
  const byId = new Map(runs.map((run) => [run.runId, run]));
  return {
    queries: {
      listConversations: async () => conversations,
      listRuns: async () => runs.map((run) => ({ runId: run.runId })),
      getRun: async (runId: string) => byId.get(runId),
    },
  } as unknown as OrdinaryAgentFeature;
}

function conversation(
  conversationId: string,
  createdAt: string,
  turns: readonly OrdinaryConversationReadModel["turns"][number][],
): OrdinaryConversationReadModel {
  return {
    conversationId,
    createdAt,
    updatedAt: turns.at(-1)?.updatedAt ?? createdAt,
    turns,
  } as OrdinaryConversationReadModel;
}

function turn(
  turnId: string,
  createdAt: string,
): OrdinaryConversationReadModel["turns"][number] {
  return {
    turnId,
    createdAt,
    updatedAt: createdAt,
  } as OrdinaryConversationReadModel["turns"][number];
}

function ordinaryRun(
  runId: string,
  createdAt: string,
  usage: OrdinaryRunState["usage"],
): OrdinaryRunState {
  return {
    runId,
    usage,
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      terminalAt: createdAt,
    },
  } as OrdinaryRunState;
}
