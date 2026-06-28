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
} from "../contracts/statistics";

type UsageStatisticsState = {
  readonly loading: boolean;
  readonly error?: string;
  readonly statistics?: UsageStatistics;
};

export function UsageStatisticsSettings(): React.ReactElement {
  const [state, setState] = React.useState<UsageStatisticsState>({ loading: true });

  const loadStatistics = React.useCallback(async (signal?: AbortSignal): Promise<void> => {
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    try {
      const response = await getJson<UsageStatisticsResponse>("/api/runtime/usage-statistics", { signal });
      setState({ loading: false, statistics: response.statistics });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "使用统计读取失败。",
      });
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadStatistics(controller.signal);
    return () => controller.abort();
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
      <section className="settings-card usage-heatmap-card">
        <div className="settings-card-title-row">
          <h3>聊天热力图</h3>
          <button type="button" className="usage-refresh-button" onClick={() => void loadStatistics()}>
            <RefreshCw size={14} />
            <span>{state.loading ? "刷新中" : "刷新"}</span>
          </button>
        </div>
        <div className="usage-range-row">
          <span>{statistics.storageAvailable ? activityRangeText(statistics) : "未启用本机运行数据"}</span>
          <time dateTime={statistics.generatedAt}>{formatDateTime(statistics.generatedAt)}</time>
        </div>
        {empty ? (
          <div className="usage-empty-state">暂无本机使用记录</div>
        ) : (
          <UsageHeatmap days={statistics.dailyActivity} />
        )}
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
      <section className="settings-card usage-heatmap-card" aria-busy="true">
        <div className="settings-card-title-row">
          <h3>聊天热力图</h3>
          <span>载入中</span>
        </div>
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
            title={`${day.date} · ${day.messageCount} 条消息`}
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

function activityRangeText(statistics: UsageStatistics): string {
  if (statistics.firstActivityDate === undefined || statistics.lastActivityDate === undefined) {
    return "本机全部历史";
  }
  if (statistics.firstActivityDate === statistics.lastActivityDate) {
    return statistics.firstActivityDate;
  }
  return `${statistics.firstActivityDate} 至 ${statistics.lastActivityDate}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError";
}
