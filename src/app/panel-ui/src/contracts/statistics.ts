export type UsageStatisticsResponse = {
  readonly ok: true;
  readonly status: "completed";
  readonly statistics: UsageStatistics;
};

export type UsageStatistics = {
  readonly generatedAt: string;
  readonly storageAvailable: boolean;
  readonly scope: "all_local";
  readonly heatmapWindowDays: 182;
  readonly firstActivityDate?: string;
  readonly lastActivityDate?: string;
  readonly totals: UsageStatisticsTotals;
  readonly dailyActivity: readonly UsageStatisticsDailyActivity[];
};

export type UsageStatisticsTotals = {
  readonly conversationCount: number;
  readonly messageCount: number;
  readonly runCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheSavedTokens: number;
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
