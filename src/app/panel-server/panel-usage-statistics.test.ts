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
import { OrdinaryToolMetricsCollector } from "../ordinary-agent/tool-runtime-metrics.js";

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
    ordinaryRun("run-1", "2026-06-26T01:00:01.000Z", "deepseek", "DeepSeek", "deepseek-v4", {
      requestCount: 2,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 40,
      firstTokenLatencyMs: 500,
    }),
    ordinaryRun("run-2", "2026-06-28T01:00:01.000Z", "openai", "OpenAI", "gpt-5", {
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      cachedInputTokens: 5,
      firstTokenLatencyMs: 300,
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
    requestCount: 3,
    inputTokens: 200,
    outputTokens: 50,
    totalTokens: 250,
    cacheSavedTokens: 45,
    cacheHitRate: 0.225,
    firstTokenLatency: {
      p50: 300,
      p75: 500,
      p95: 500,
      p99: 500,
    },
  });
  assert.deepEqual(statistics.modelBreakdown, [
    {
      providerId: "deepseek",
      providerLabel: "DeepSeek",
      model: "deepseek-v4",
      requestCount: 2,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cacheSavedTokens: 40,
      cacheHitRate: 1 / 3,
      averageFirstTokenLatencyMs: 500,
    },
    {
      providerId: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5",
      requestCount: 1,
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      cacheSavedTokens: 5,
      cacheHitRate: 0.0625,
      averageFirstTokenLatencyMs: 300,
    },
  ]);
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
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheSavedTokens: 0,
    cacheHitRate: 0,
  });
  assert.deepEqual(response.statistics.modelBreakdown, []);
  assert.equal(response.statistics.firstActivityDate, undefined);
  assert.equal(response.statistics.lastActivityDate, undefined);
  assert.equal(response.statistics.dailyActivity.every((item) => item.level === 0), true);
});

test("panel usage statistics merges persisted tool histograms without exposing inputs", async () => {
  const first = toolMetrics(100, 180, 160);
  const second = toolMetrics(5_000, 6_500, 5_900);
  second.recordDropped(2);
  const runOne = {
    ...ordinaryRun("tool-run-1", "2026-06-26T01:00:00.000Z", "openai", "OpenAI", "gpt-5", {}),
    toolMetrics: first.snapshot(),
  };
  const runTwo = {
    ...ordinaryRun("tool-run-2", "2026-06-26T01:01:00.000Z", "openai", "OpenAI", "gpt-5", {}),
    toolMetrics: second.snapshot(),
  };

  const response = await createPanelUsageStatistics({
    ordinaryAgentFeature: ordinaryFeature([], [runOne, runTwo]),
    generatedAt: "2026-06-28T12:00:00.000Z",
  });
  const tool = response.statistics.toolBreakdown?.[0];

  assert.equal(response.statistics.metricsDroppedCount, 2);
  assert.equal(tool?.toolName, "read_file");
  assert.equal(tool?.calls, 2);
  assert.deepEqual(tool?.rawBodyTokens, { p50: 128, p95: 6_000, p99: 6_000 });
  assert.deepEqual(tool?.rawEnvelopeTokens, { p50: 256, p95: 8_192, p99: 8_192 });
  assert.deepEqual(tool?.finalEnvelopeTokens, { p50: 256, p95: 6_000, p99: 6_000 });
  assert.equal(JSON.stringify(tool).includes("README.md"), false);
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
  providerId: string,
  providerLabel: string,
  model: string,
  usage: OrdinaryRunState["usage"],
): OrdinaryRunState {
  return {
    runId,
    birth: {
      config: {
        profileId: providerId,
        label: providerLabel,
        model,
      },
    },
    usage,
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      terminalAt: createdAt,
    },
  } as OrdinaryRunState;
}

function toolMetrics(rawBodyTokens: number, rawEnvelopeTokens: number, finalEnvelopeTokens: number): OrdinaryToolMetricsCollector {
  const collector = new OrdinaryToolMetricsCollector();
  collector.record({
    kind: "execution",
    toolName: "read_file",
    operationType: "read-only",
    status: "completed",
    rawBodyTokens,
    rawEnvelopeTokens,
    finalEnvelopeTokens,
  });
  return collector;
}
