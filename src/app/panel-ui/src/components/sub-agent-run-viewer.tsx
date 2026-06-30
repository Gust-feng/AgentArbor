import React from "react";
import {
  Bot,
  Clock3,
  FileText,
  ListTree,
  MessageSquareText,
  Wrench,
  X,
} from "lucide-react";
import type { SubAgentRunView } from "../contracts/run";

type SubAgentDrawerTab = "overview" | "io" | "tools" | "diagnostics";

type SubAgentBatchStats = {
  readonly total?: number;
  readonly completed?: number;
  readonly failed?: number;
  readonly cancelled?: number;
  readonly approvalRequired?: number;
  readonly notStarted?: number;
};

type SubAgentRunViewerProps = {
  readonly runs: readonly SubAgentRunView[];
  readonly selectedRunId?: string;
  readonly selectedBatchId?: string;
  readonly onSelectRun: (runId: string) => void;
  readonly onClose: () => void;
};

export function SubAgentRunDrawer(props: SubAgentRunViewerProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = React.useState<SubAgentDrawerTab>("overview");
  const selected =
    props.runs.find((run) => run.subRunId === props.selectedRunId) ??
    props.runs.find((run) => run.batchId === props.selectedBatchId);
  if (selected === undefined) {
    return null;
  }
  const batchRuns = selected.batchId === undefined
    ? []
    : props.runs.filter((run) => run.batchId === selected.batchId).sort(compareSubAgentRuns);
  return (
    <aside className="sub-agent-drawer" aria-label="子 Agent 运行详情">
      <header className="sub-agent-drawer-header">
        <div>
          <p>子 Agent</p>
          <h2>{selected.subAgentName}</h2>
        </div>
        <button type="button" className="sub-agent-drawer-close" onClick={props.onClose} aria-label="关闭子 Agent 详情">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {batchRuns.length > 1 && (
        <nav className="sub-agent-run-list" aria-label="批次子 Agent">
          {batchRuns.map((run) => (
            <button
              type="button"
              key={run.subRunId}
              data-active={run.subRunId === selected.subRunId ? "true" : undefined}
              onClick={() => props.onSelectRun(run.subRunId)}
            >
              <span>{run.subAgentName}</span>
              <small>{statusLabel(run.status)}</small>
            </button>
          ))}
        </nav>
      )}
      <div className="sub-agent-drawer-tabs" role="tablist" aria-label="子 Agent 详情页签">
        <TabButton activeTab={activeTab} tab="overview" onSelect={setActiveTab}>概览</TabButton>
        <TabButton activeTab={activeTab} tab="io" onSelect={setActiveTab}>输入输出</TabButton>
        <TabButton activeTab={activeTab} tab="tools" onSelect={setActiveTab}>工具</TabButton>
        <TabButton activeTab={activeTab} tab="diagnostics" onSelect={setActiveTab}>诊断</TabButton>
      </div>
      <div className="sub-agent-drawer-body">
        {activeTab === "overview" && (
        <section className="sub-agent-detail-section" role="tabpanel">
          <h3><Bot size={15} aria-hidden="true" />概览</h3>
          <MetricGrid run={selected} />
          <KeyValue label="任务" value={selected.task} />
          {selected.context !== undefined && <KeyValue label="上下文" value={selected.context} />}
          <KeyValue label="摘要" value={selected.summary} />
          {selected.error !== undefined && <KeyValue label="失败原因" value={selected.error} tone="danger" />}
        </section>
        )}
        {activeTab === "io" && (
        <section className="sub-agent-detail-section" role="tabpanel">
          <h3><MessageSquareText size={15} aria-hidden="true" />输入输出</h3>
          {selected.modelExchanges.length === 0 ? (
            <p className="sub-agent-empty">没有记录到模型交换。</p>
          ) : selected.modelExchanges.map((exchange, index) => (
            <article className="sub-agent-exchange" key={exchange.requestId}>
              <h4>第 {index + 1} 轮</h4>
              <pre><code>{exchange.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n")}</code></pre>
              {exchange.textOutput !== undefined && <KeyValue label="输出" value={exchange.textOutput} />}
              {exchange.toolCalls.length > 0 && (
                <KeyValue label="工具请求" value={exchange.toolCalls.map((call) => `${call.toolName} (${call.callId})`).join("\n")} />
              )}
              {exchange.failureMessage !== undefined && <KeyValue label="失败" value={exchange.failureMessage} tone="danger" />}
            </article>
          ))}
        </section>
        )}
        {activeTab === "tools" && (
        <section className="sub-agent-detail-section" role="tabpanel">
          <h3><Wrench size={15} aria-hidden="true" />工具</h3>
          {selected.toolTraces.length === 0 ? (
            <p className="sub-agent-empty">没有内部工具调用。</p>
          ) : selected.toolTraces.map((tool) => (
            <article className="sub-agent-tool-row" key={tool.callId}>
              <header>
                <strong>{tool.toolName}</strong>
                <span data-status={tool.status}>{statusLabel(tool.status)}</span>
              </header>
              {tool.confirmationId !== undefined && <small>等待父 run 确认：{tool.confirmationId}</small>}
              {tool.outputSummary !== undefined && <p>{tool.outputSummary}</p>}
              {tool.error !== undefined && <p className="sub-agent-danger">{tool.error}</p>}
            </article>
          ))}
        </section>
        )}
        {activeTab === "diagnostics" && (
        <section className="sub-agent-detail-section" role="tabpanel">
          <h3><ListTree size={15} aria-hidden="true" />诊断</h3>
          <KeyValue label="subRunId" value={selected.subRunId} />
          {selected.parentToolCallId !== undefined && <KeyValue label="parentToolCallId" value={selected.parentToolCallId} />}
          {selected.batchId !== undefined && <KeyValue label="batchId" value={selected.batchId} />}
          {selected.batchIndex !== undefined && <KeyValue label="batchIndex" value={String(selected.batchIndex)} />}
          <KeyValue label="model request" value={selected.modelExchanges.map((item) => item.requestId).join("\n") || "无"} />
          <KeyValue label="model response" value={selected.modelExchanges.map((item) => item.responseId).filter(Boolean).join("\n") || "无"} />
        </section>
        )}
      </div>
    </aside>
  );
}

export function SubAgentInlineCard(props: {
  readonly run?: SubAgentRunView;
  readonly batchRuns?: readonly SubAgentRunView[];
  readonly batchStats?: SubAgentBatchStats;
  readonly fallbackTitle: string;
  readonly fallbackSummary?: string;
}): React.ReactElement {
  const batchRuns = props.batchRuns ?? [];
  const run = props.run ?? batchRuns[0];
  const total = props.batchStats?.total ?? (batchRuns.length > 1 ? batchRuns.length : undefined);
  const completed = props.batchStats?.completed ?? batchRuns.filter((item) => item.status === "completed").length;
  const failed = props.batchStats?.failed ?? batchRuns.filter((item) => item.status === "failed").length;
  const cancelled = props.batchStats?.cancelled ?? batchRuns.filter((item) => item.status === "cancelled").length;
  const approval = props.batchStats?.approvalRequired ?? batchRuns.filter((item) => item.status === "approval_required").length;
  const notStarted = props.batchStats?.notStarted ?? 0;
  const isBatch = total !== undefined;
  const title = total !== undefined ? `子 Agent 批次 · ${total}` : run?.subAgentName ?? props.fallbackTitle;
  const summary = isBatch
    ? batchSummary({ completed, failed, cancelled, approvalRequired: approval, notStarted })
    : run?.summary ?? props.fallbackSummary ?? "";
  return (
    <div className="sub-agent-inline-card">
      <span className="sub-agent-inline-icon"><Bot size={14} aria-hidden="true" /></span>
      <span className="sub-agent-inline-main">
        <strong>{title}</strong>
        {summary.trim().length > 0 && <small>{summary}</small>}
      </span>
      <span className="sub-agent-inline-meta">
        <Clock3 size={13} aria-hidden="true" />
        {durationLabel(run?.durationMs)}
      </span>
      <span className="sub-agent-inline-meta">
        <FileText size={13} aria-hidden="true" />
        {metricSummary(run, batchRuns, isBatch)}
      </span>
    </div>
  );
}

function TabButton(props: {
  readonly activeTab: SubAgentDrawerTab;
  readonly tab: SubAgentDrawerTab;
  readonly onSelect: (tab: SubAgentDrawerTab) => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.activeTab === props.tab}
      data-active={props.activeTab === props.tab ? "true" : undefined}
      onClick={() => props.onSelect(props.tab)}
    >
      {props.children}
    </button>
  );
}

function batchSummary(input: {
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly approvalRequired: number;
  readonly notStarted: number;
}): string {
  const parts = [`${input.completed} 成功`, `${input.failed} 失败`];
  if (input.cancelled > 0) {
    parts.push(`${input.cancelled} 取消`);
  }
  if (input.approvalRequired > 0) {
    parts.push(`${input.approvalRequired} 待确认`);
  }
  if (input.notStarted > 0) {
    parts.push(`${input.notStarted} 未启动`);
  }
  return parts.join("，");
}

function metricSummary(run: SubAgentRunView | undefined, batchRuns: readonly SubAgentRunView[], isBatch: boolean): string {
  if (isBatch) {
    const modelRounds = batchRuns.reduce((sum, item) => sum + item.modelRounds, 0);
    const toolCalls = batchRuns.reduce((sum, item) => sum + item.toolCalls, 0);
    return `${modelRounds} 轮 / ${toolCalls} 工具`;
  }
  return `${run?.modelRounds ?? 0} 轮 / ${run?.toolCalls ?? 0} 工具`;
}

function MetricGrid(props: { readonly run: SubAgentRunView }): React.ReactElement {
  return (
    <div className="sub-agent-metrics">
      <Metric label="状态" value={statusLabel(props.run.status)} />
      <Metric label="耗时" value={durationLabel(props.run.durationMs)} />
      <Metric label="模型轮次" value={String(props.run.modelRounds)} />
      <Metric label="工具次数" value={String(props.run.toolCalls)} />
    </div>
  );
}

function Metric(props: { readonly label: string; readonly value: string }): React.ReactElement {
  return (
    <span>
      <small>{props.label}</small>
      <strong>{props.value}</strong>
    </span>
  );
}

function KeyValue(props: { readonly label: string; readonly value: string; readonly tone?: "danger" }): React.ReactElement {
  return (
    <div className="sub-agent-key-value" data-tone={props.tone}>
      <span>{props.label}</span>
      <pre><code>{props.value}</code></pre>
    </div>
  );
}

function compareSubAgentRuns(left: SubAgentRunView, right: SubAgentRunView): number {
  const batch = (left.batchIndex ?? 0) - (right.batchIndex ?? 0);
  return batch === 0 ? left.startedAt.localeCompare(right.startedAt) : batch;
}

function statusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "approval_required") return "待确认";
  if (status === "cancelled") return "已取消";
  if (status === "requested") return "已请求";
  return "运行中";
}

function durationLabel(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "0ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}
