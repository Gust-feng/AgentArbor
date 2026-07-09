import assert from "node:assert/strict";
import test from "node:test";
import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeModelCallRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../../domain/runtime-database/index.js";
import {
  USAGE_HEATMAP_WINDOW_DAYS,
  createPanelUsageStatistics,
  createUsageStatistics,
} from "./panel-usage-statistics.js";

test("usage statistics aggregates conversations, runs, token usage, and recent heatmap levels", () => {
  const generatedAt = "2026-06-28T12:00:00.000Z";
  const conversations: RuntimeConversationRecord[] = [
    conversationRecord({
      conversationId: "conversation-1",
      createdAt: "2026-06-26T01:00:00.000Z",
      turns: [
        turnRecord("turn-1", "user", "2026-06-26T01:00:00.000Z"),
        turnRecord("turn-2", "assistant", "2026-06-26T01:00:01.000Z", "run-agent"),
        turnRecord("turn-3", "user", "2026-06-27T01:00:00.000Z"),
      ],
    }),
    conversationRecord({
      conversationId: "conversation-2",
      createdAt: "2026-06-28T01:00:00.000Z",
      turns: [
        turnRecord("turn-4", "user", "2026-06-28T01:00:00.000Z"),
        turnRecord("turn-5", "assistant", "2026-06-28T01:00:01.000Z", "run-deep"),
      ],
    }),
  ];
  const runs: RuntimeRunRecord[] = [
    runRecord({
      runId: "run-agent",
      runMode: "agent",
      createdAt: "2026-06-26T01:00:01.000Z",
      updatedAt: "2026-06-26T01:00:02.000Z",
    }),
    runRecord({
      runId: "run-deep",
      runMode: "deep",
      createdAt: "2026-06-28T01:00:01.000Z",
      updatedAt: "2026-06-28T01:00:02.000Z",
    }),
  ];
  const statistics = createUsageStatistics({
    generatedAt,
    storageAvailable: true,
    conversations,
    runs,
    snapshots: [
      snapshotRecord(runs[0]!, [
        modelCallRecord("request-1", {
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          cachedInputTokens: 40,
        }),
        modelCallRecord("request-2"),
        modelCallRecord("request-3", { inputTokens: 8, outputTokens: 2 }, "failed"),
      ]),
      snapshotRecord(runs[1]!, [
        modelCallRecord("request-4", {
          inputTokens: 80,
          outputTokens: 20,
          reasoningOutputTokens: 10,
          cachedInputTokens: 5,
        }),
      ]),
    ],
  });

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
    modelCallCount: 3,
    inputTokens: 200,
    outputTokens: 50,
    totalTokens: 260,
    cacheSavedTokens: 45,
    unknownUsageModelCallCount: 1,
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

test("usage statistics returns an empty local view without storage", () => {
  const statistics = createUsageStatistics({
    generatedAt: "2026-06-28T12:00:00.000Z",
    storageAvailable: false,
    conversations: [],
    runs: [],
    snapshots: [],
  });

  assert.equal(statistics.storageAvailable, false);
  assert.equal(statistics.firstActivityDate, undefined);
  assert.equal(statistics.lastActivityDate, undefined);
  assert.deepEqual(statistics.totals, {
    conversationCount: 0,
    messageCount: 0,
    runCount: 0,
    modelCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheSavedTokens: 0,
    unknownUsageModelCallCount: 0,
  });
  assert.equal(statistics.dailyActivity.every((item) => item.level === 0), true);
});

test("panel usage statistics reads model calls through the runtime database fast path", async () => {
  const run = runRecord({
    runId: "run-fast",
    runMode: "agent",
    createdAt: "2026-06-28T01:00:01.000Z",
    updatedAt: "2026-06-28T01:00:02.000Z",
  });
  let getRunCalled = false;
  const runtimeDatabase = {
    listConversations: async () => [],
    listRuns: async () => [run],
    listModelCallsForRuns: async (runIds: readonly string[]) => {
      assert.deepEqual(runIds, ["run-fast"]);
      return [
        {
          runId: "run-fast",
          modelCalls: [
            modelCallRecord("request-fast", {
              inputTokens: 5,
              outputTokens: 2,
            }),
          ],
        },
      ];
    },
    getRun: async () => {
      getRunCalled = true;
      throw new Error("getRun should not be used for usage statistics when model-call fast path exists.");
    },
  } as unknown as RuntimeDatabase;

  const response = await createPanelUsageStatistics({
    runtimeDatabase,
    generatedAt: "2026-06-28T12:00:00.000Z",
  });

  assert.equal(getRunCalled, false);
  assert.equal(response.statistics.totals.runCount, 1);
  assert.equal(response.statistics.totals.modelCallCount, 1);
  assert.equal(response.statistics.totals.inputTokens, 5);
  assert.equal(response.statistics.totals.outputTokens, 2);
  assert.equal(response.statistics.totals.totalTokens, 7);
});

function conversationRecord(input: {
  readonly conversationId: string;
  readonly createdAt: string;
  readonly turns: RuntimeConversationRecord["turns"];
}): RuntimeConversationRecord {
  return {
    conversationId: input.conversationId,
    title: input.conversationId,
    preview: "preview",
    status: "completed",
    latestRunId: input.turns.find((turn) => turn.role === "assistant")?.runId,
    queuedRunIds: [],
    queuedRunCount: 0,
    createdAt: input.createdAt,
    updatedAt: input.turns.at(-1)?.updatedAt ?? input.createdAt,
    turns: input.turns,
  };
}

function turnRecord(
  turnId: string,
  role: RuntimeConversationRecord["turns"][number]["role"],
  createdAt: string,
  runId?: string
): RuntimeConversationRecord["turns"][number] {
  return {
    turnId,
    role,
    title: turnId,
    content: turnId,
    status: "completed",
    runId,
    createdAt,
    updatedAt: createdAt,
  };
}

function runRecord(input: {
  readonly runId: string;
  readonly runMode: RuntimeRunRecord["runMode"];
  readonly createdAt: string;
  readonly updatedAt: string;
}): RuntimeRunRecord {
  return {
    runId: input.runId,
    profile: "lite",
    runKind: input.runMode === "agent" ? "desktop" : "underground",
    runMode: input.runMode,
    status: "completed",
    goalSummary: input.runId,
    aiMode: "fake",
    appHome: "/tmp/app",
    runHome: `/tmp/app/runtime/runs/${input.runId}`,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    completedAt: input.updatedAt,
  };
}

function snapshotRecord(
  run: RuntimeRunRecord,
  modelCalls: readonly RuntimeModelCallRecord[]
): RuntimeRunSnapshot {
  return {
    run,
    basicEvents: [],
    events: [],
    modelCalls,
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
  };
}

function modelCallRecord(
  requestId: string,
  usage?: RuntimeModelCallRecord["usage"],
  status: RuntimeModelCallRecord["status"] = "completed"
): RuntimeModelCallRecord {
  return {
    requestId,
    runId: "run",
    status,
    usage,
    eventRefs: [],
  };
}
