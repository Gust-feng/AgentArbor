import type { ModelUsage } from "../domain/intelligence/index.js";
import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeModelCallRecord,
  RuntimeRunModelCallsRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
} from "../domain/runtime-database/index.js";

export const USAGE_HEATMAP_WINDOW_DAYS = 182;
const ALL_LOCAL_RECORD_LIMIT = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type UsageStatisticsResponse = {
  readonly ok: true;
  readonly status: "completed";
  readonly statistics: UsageStatistics;
};

export type UsageStatistics = {
  readonly generatedAt: string;
  readonly storageAvailable: boolean;
  readonly scope: "all_local";
  readonly heatmapWindowDays: typeof USAGE_HEATMAP_WINDOW_DAYS;
  readonly firstActivityDate?: string;
  readonly lastActivityDate?: string;
  readonly totals: UsageStatisticsTotals;
  readonly dailyActivity: readonly UsageStatisticsDailyActivity[];
};

export type UsageStatisticsTotals = {
  readonly conversationCount: number;
  readonly messageCount: number;
  readonly runCount: number;
  readonly modelCallCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheSavedTokens: number;
  readonly unknownUsageModelCallCount: number;
};

export type UsageStatisticsDailyActivity = {
  readonly date: string;
  readonly messageCount: number;
  readonly conversationCount: number;
  readonly runCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheSavedTokens: number;
  readonly level: 0 | 1 | 2 | 3 | 4 | 5;
};

export async function createPanelUsageStatistics(input: {
  readonly runtimeDatabase?: RuntimeDatabase;
  readonly generatedAt?: string;
}): Promise<UsageStatisticsResponse> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (input.runtimeDatabase === undefined) {
    return {
      ok: true,
      status: "completed",
      statistics: createUsageStatistics({
        generatedAt,
        storageAvailable: false,
        conversations: [],
        runs: [],
        snapshots: [],
        modelCallsByRun: [],
      }),
    };
  }

  const [conversations, runs] = await Promise.all([
    input.runtimeDatabase.listConversations(ALL_LOCAL_RECORD_LIMIT),
    input.runtimeDatabase.listRuns(ALL_LOCAL_RECORD_LIMIT),
  ]);
  const modelCallsByRun = await listModelCallsForRuns(input.runtimeDatabase, runs);
  return {
    ok: true,
    status: "completed",
    statistics: createUsageStatistics({
      generatedAt,
      storageAvailable: true,
      conversations,
      runs,
      modelCallsByRun,
      snapshots: [],
    }),
  };
}

export function createUsageStatistics(input: {
  readonly generatedAt: string;
  readonly storageAvailable: boolean;
  readonly conversations: readonly RuntimeConversationRecord[];
  readonly runs: readonly RuntimeRunRecord[];
  readonly snapshots?: readonly RuntimeRunSnapshot[];
  readonly modelCallsByRun?: readonly UsageStatisticsModelCallGroup[];
}): UsageStatistics {
  const daily = createDailyBuckets(input.generatedAt);
  const activityDates: string[] = [];
  const totals: MutableUsageStatisticsTotals = {
    conversationCount: input.conversations.length,
    messageCount: 0,
    runCount: input.runs.length,
    modelCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheSavedTokens: 0,
    unknownUsageModelCallCount: 0,
  };

  for (const conversation of input.conversations) {
    addActivityDate(activityDates, conversation.createdAt);
    addActivityDate(activityDates, conversation.updatedAt);
    addDailyCount(daily, conversation.createdAt, "conversationCount", 1);
    totals.messageCount += conversation.turns.length;
    for (const turn of conversation.turns) {
      addActivityDate(activityDates, turn.createdAt);
      addActivityDate(activityDates, turn.updatedAt);
      addDailyCount(daily, turn.createdAt, "messageCount", 1);
    }
  }

  const runById = new Map(input.runs.map((run) => [run.runId, run]));
  for (const run of input.runs) {
    addActivityDate(activityDates, run.createdAt);
    addActivityDate(activityDates, run.updatedAt);
    addDailyCount(daily, run.createdAt, "runCount", 1);
  }

  for (const group of modelCallGroups(input)) {
    const run = runById.get(group.runId) ?? group.run;
    if (run === undefined) {
      continue;
    }
    for (const call of group.modelCalls) {
      addModelCallUsage(totals, daily, run, call);
    }
  }

  const dailyActivity = finalizeDailyActivity(daily);
  return {
    generatedAt: input.generatedAt,
    storageAvailable: input.storageAvailable,
    scope: "all_local",
    heatmapWindowDays: USAGE_HEATMAP_WINDOW_DAYS,
    firstActivityDate: minDate(activityDates),
    lastActivityDate: maxDate(activityDates),
    totals,
    dailyActivity,
  };
}

type MutableUsageStatisticsTotals = {
  -readonly [K in keyof UsageStatisticsTotals]: UsageStatisticsTotals[K];
};

type UsageStatisticsModelCallGroup = {
  readonly runId: string;
  readonly run?: RuntimeRunRecord;
  readonly modelCalls: readonly RuntimeModelCallRecord[];
};

async function listModelCallsForRuns(
  runtimeDatabase: RuntimeDatabase,
  runs: readonly RuntimeRunRecord[]
): Promise<readonly RuntimeRunModelCallsRecord[]> {
  if (runtimeDatabase.listModelCallsForRuns !== undefined) {
    return runtimeDatabase.listModelCallsForRuns(runs.map((run) => run.runId));
  }
  const snapshots = await Promise.all(runs.map((run) => runtimeDatabase.getRun(run.runId)));
  return snapshots
    .filter((snapshot): snapshot is RuntimeRunSnapshot => snapshot !== undefined)
    .map((snapshot) => ({
      runId: snapshot.run.runId,
      modelCalls: snapshot.modelCalls,
    }));
}

function modelCallGroups(input: {
  readonly snapshots?: readonly RuntimeRunSnapshot[];
  readonly modelCallsByRun?: readonly UsageStatisticsModelCallGroup[];
}): readonly UsageStatisticsModelCallGroup[] {
  if (input.modelCallsByRun !== undefined) {
    return input.modelCallsByRun;
  }
  return (input.snapshots ?? []).map((snapshot) => ({
    runId: snapshot.run.runId,
    run: snapshot.run,
    modelCalls: snapshot.modelCalls,
  }));
}

type MutableDailyActivity = Omit<UsageStatisticsDailyActivity, "level"> & {
  level?: UsageStatisticsDailyActivity["level"];
};

function addModelCallUsage(
  totals: MutableUsageStatisticsTotals,
  daily: Map<string, MutableDailyActivity>,
  run: RuntimeRunRecord,
  call: RuntimeModelCallRecord
): void {
  if (call.status !== "completed") {
    return;
  }
  totals.modelCallCount += 1;
  const usage = normalizedUsage(call.usage);
  if (usage === undefined) {
    totals.unknownUsageModelCallCount += 1;
    return;
  }
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.totalTokens += usage.totalTokens;
  totals.cacheSavedTokens += usage.cacheSavedTokens;
  const date = run.completedAt ?? run.updatedAt;
  addDailyCount(daily, date, "inputTokens", usage.inputTokens);
  addDailyCount(daily, date, "outputTokens", usage.outputTokens);
  addDailyCount(daily, date, "cacheSavedTokens", usage.cacheSavedTokens);
}

function normalizedUsage(usage: ModelUsage | undefined): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheSavedTokens: number;
} | undefined {
  if (usage === undefined) {
    return undefined;
  }
  const inputTokens = nonNegativeAmount(usage.inputTokens);
  const outputTokens = nonNegativeAmount(usage.outputTokens);
  const reasoningOutputTokens = nonNegativeAmount(usage.reasoningOutputTokens);
  const totalTokens = usage.totalTokens === undefined
    ? inputTokens + outputTokens + reasoningOutputTokens
    : nonNegativeAmount(usage.totalTokens);
  const cacheSavedTokens = nonNegativeAmount(usage.cachedInputTokens);
  if (inputTokens + outputTokens + totalTokens + cacheSavedTokens + nonNegativeAmount(usage.uncachedInputTokens) === 0) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheSavedTokens,
  };
}

function createDailyBuckets(generatedAt: string): Map<string, MutableDailyActivity> {
  const buckets = new Map<string, MutableDailyActivity>();
  const end = parseIsoDay(generatedAt) ?? parseIsoDay(new Date().toISOString())!;
  const start = new Date(end.getTime() - (USAGE_HEATMAP_WINDOW_DAYS - 1) * DAY_MS);
  for (let index = 0; index < USAGE_HEATMAP_WINDOW_DAYS; index += 1) {
    const date = isoDay(new Date(start.getTime() + index * DAY_MS));
    buckets.set(date, {
      date,
      messageCount: 0,
      conversationCount: 0,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheSavedTokens: 0,
    });
  }
  return buckets;
}

function addDailyCount<K extends keyof Omit<UsageStatisticsDailyActivity, "date" | "level">>(
  daily: Map<string, MutableDailyActivity>,
  timestamp: string | undefined,
  key: K,
  amount: number
): void {
  const day = dayString(timestamp);
  if (day === undefined || amount <= 0) {
    return;
  }
  const bucket = daily.get(day);
  if (bucket === undefined) {
    return;
  }
  bucket[key] += amount;
}

function finalizeDailyActivity(daily: Map<string, MutableDailyActivity>): readonly UsageStatisticsDailyActivity[] {
  const items = [...daily.values()];
  const maxMessages = Math.max(0, ...items.map((item) => item.messageCount));
  return items.map((item) => ({
    ...item,
    level: activityLevel(item.messageCount, maxMessages),
  }));
}

function activityLevel(value: number, maxValue: number): UsageStatisticsDailyActivity["level"] {
  if (value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(5, Math.ceil((value / maxValue) * 5))) as UsageStatisticsDailyActivity["level"];
}

function addActivityDate(dates: string[], timestamp: string | undefined): void {
  const date = dayString(timestamp);
  if (date !== undefined) {
    dates.push(date);
  }
}

function minDate(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : [...values].sort()[0];
}

function maxDate(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : [...values].sort().at(-1);
}

function dayString(timestamp: string | undefined): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  return parseIsoDay(timestamp) === undefined ? undefined : timestamp.slice(0, 10);
}

function parseIsoDay(timestamp: string): Date | undefined {
  const day = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
    return undefined;
  }
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nonNegativeAmount(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : value;
}
