import React from "react";
import {
  ChartColumn,
  Cpu,
  MessageSquareText,
  MessagesSquare,
  RefreshCw,
  Zap,
} from "lucide-react";
import { getJson } from "../api";
import type {
  UsageStatistics,
  UsageStatisticsDailyActivity,
  UsageStatisticsResponse,
  UsageStatisticsTotals,
} from "../contracts/statistics";

type UsageStatisticsState = {
  readonly loading: boolean;
  readonly error?: string;
  readonly statistics?: UsageStatistics;
};

let usageStatisticsCache: UsageStatistics | undefined;
let usageStatisticsPromise: Promise<UsageStatistics> | undefined;

export function preloadUsageStatistics(): void {
  void loadUsageStatistics();
}

export function UsageStatisticsSettings(): React.ReactElement {
  const mountedRef = React.useRef(true);
  const [state, setState] = React.useState<UsageStatisticsState>(() =>
    usageStatisticsCache === undefined
      ? { loading: true }
      : { loading: false, statistics: usageStatisticsCache }
  );

  const loadStatistics = React.useCallback(async (options?: { readonly force?: boolean }): Promise<void> => {
    const force = options?.force === true;
    setState((previous) => ({
      ...previous,
      loading: force || previous.statistics === undefined,
      error: undefined,
    }));
    try {
      const statistics = await loadUsageStatistics({ force });
      if (!mountedRef.current) {
        return;
      }
      setState({ loading: false, statistics });
    } catch (error) {
      if (!mountedRef.current || isAbortError(error)) {
        return;
      }
      setState((previous) => ({
        loading: false,
        statistics: previous.statistics,
        error: error instanceof Error ? error.message : "使用统计读取失败。",
      }));
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    if (usageStatisticsCache === undefined) {
      void loadStatistics();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [loadStatistics]);

  if (state.loading && state.statistics === undefined) {
    return <UsageStatisticsLoading />;
  }

  if (state.error !== undefined && state.statistics === undefined) {
    return (
      <section className="settings-card usage-settings-error">
        <div className="settings-card-title-row">
          <h3>使用统计</h3>
          <button type="button" className="usage-refresh-button" onClick={() => void loadStatistics()}>
            <RefreshCw size={14} />
            <span>重试</span>
          </button>
        </div>
        <p>{state.error}</p>
      </section>
    );
  }

  const statistics = state.statistics;
  if (statistics === undefined) {
    return <UsageStatisticsLoading />;
  }

  const totals = statistics.totals;
  const empty = totals.conversationCount === 0 && totals.messageCount === 0 && totals.runCount === 0;

  return (
    <div className="usage-settings">
      <section className="settings-card usage-heatmap-card" aria-label="聊天热力图">
        <button
          type="button"
          className="usage-refresh-button"
          aria-label={state.loading ? "刷新中" : "刷新使用统计"}
          onClick={() => void loadStatistics({ force: true })}
        >
          <RefreshCw size={15} />
        </button>
        {empty ? (
          <div className="usage-empty-state">暂无本机使用记录</div>
        ) : (
          <UsageHeatmap days={statistics.dailyActivity} />
        )}
        <UsageHeatmapSummary totals={totals} />
      </section>

      <section className="usage-stat-grid" aria-label="使用统计汇总">
        <UsageStatCard
          icon={<ChartColumn size={20} />}
          value={formatCompactNumber(totals.conversationCount)}
          label="总对话数"
        />
        <UsageStatCard
          icon={<MessagesSquare size={20} />}
          value={formatCompactNumber(totals.messageCount)}
          label="总消息数"
        />
        <UsageStatCard
          icon={<Cpu size={20} />}
          value={formatCompactNumber(totals.inputTokens)}
          label="输入 Token"
        />
        <UsageStatCard
          icon={<MessageSquareText size={20} />}
          value={formatCompactNumber(totals.outputTokens)}
          label="输出 Token"
        />
        <UsageStatCard
          wide
          icon={<Zap size={20} />}
          value={formatCompactNumber(totals.cacheSavedTokens)}
          label="缓存节省 Token"
        />
      </section>
    </div>
  );
}

function UsageStatisticsLoading(): React.ReactElement {
  return (
    <div className="usage-settings">
      <section className="settings-card usage-heatmap-card" aria-label="使用统计加载中" aria-busy="true">
        <div className="usage-heatmap-skeleton" />
      </section>
      <section className="usage-stat-grid" aria-label="使用统计载入中">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={`usage-stat-card loading${index === 4 ? " wide" : ""}`} />
        ))}
      </section>
    </div>
  );
}

function UsageHeatmap(props: { readonly days: readonly UsageStatisticsDailyActivity[] }): React.ReactElement {
  return (
    <div className="usage-heatmap-wrap">
      <div className="usage-heatmap-grid" aria-label="最近使用热力图">
        {props.days.map((day) => (
          <span
            key={day.date}
            className="usage-heatmap-cell"
            data-level={day.level}
            aria-label={`${day.date}，${day.messageCount} 条消息`}
          />
        ))}
      </div>
      <div className="usage-heatmap-legend" aria-label="热力图图例">
        <span>少</span>
        {[0, 1, 2, 3, 4, 5].map((level) => (
          <span key={level} className="usage-heatmap-cell" data-level={level} aria-hidden="true" />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

function UsageHeatmapSummary(props: { readonly totals: UsageStatisticsTotals }): React.ReactElement {
  return (
    <div className="usage-heatmap-summary" aria-label="使用统计关键数据">
      <UsageHeatmapSummaryItem label="运行数" value={formatCompactNumber(props.totals.runCount)} />
      <UsageHeatmapSummaryItem label="总 Token" value={formatCompactNumber(props.totals.totalTokens)} />
    </div>
  );
}

function UsageHeatmapSummaryItem(props: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="usage-heatmap-summary-item">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function UsageStatCard(props: {
  readonly icon: React.ReactNode;
  readonly value: string;
  readonly label: string;
  readonly wide?: boolean;
}): React.ReactElement {
  return (
    <div className={`usage-stat-card${props.wide === true ? " wide" : ""}`}>
      <span className="usage-stat-icon" aria-hidden="true">
        {props.icon}
      </span>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${trimCompact(value / 1_000_000, value < 10_000_000 ? 2 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${trimCompact(value / 1_000, value < 100_000 ? 1 : 0)}K`;
  }
  return String(Math.floor(value));
}

function trimCompact(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function loadUsageStatistics(options?: { readonly force?: boolean }): Promise<UsageStatistics> {
  if (options?.force !== true) {
    if (usageStatisticsCache !== undefined) {
      return Promise.resolve(usageStatisticsCache);
    }
    if (usageStatisticsPromise !== undefined) {
      return usageStatisticsPromise;
    }
  }
  usageStatisticsPromise = getJson<UsageStatisticsResponse>("/api/runtime/usage-statistics")
    .then((response) => {
      usageStatisticsCache = response.statistics;
      return response.statistics;
    })
    .finally(() => {
      usageStatisticsPromise = undefined;
    });
  return usageStatisticsPromise;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError";
}
