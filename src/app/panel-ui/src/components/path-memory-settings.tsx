import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import type {
  PathMemoryOutcome,
  PathMemoryRecord,
  PathMemoryTerminalStatus,
  PathMemoryToolStep,
} from "../contracts/path-memory";
import { deletePathMemory, pathMemoryDiagnosticsQuery, pathMemoryListQuery } from "../path-memory-query";
import "./path-memory-settings.css";

type TerminalStatusFilter = PathMemoryTerminalStatus | "all";

const TERMINAL_STATUS_OPTIONS: readonly { readonly value: TerminalStatusFilter; readonly label: string }[] = [
  { value: "all", label: "全部终态" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
  { value: "blocked", label: "受阻" },
];

export function PathMemorySettings(): React.ReactElement {
  const [statusFilter, setStatusFilter] = useState<TerminalStatusFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const query = useQuery(pathMemoryListQuery({
    terminalStatus: statusFilter === "all" ? undefined : statusFilter,
    workspaceRoot: workspaceFilter.trim().length > 0 ? workspaceFilter.trim() : undefined,
  }));

  return (
    <div className="path-memory-page">
      <PathMemoryDiagnosticsPanel />
      <div className="path-memory-toolbar">
        <label className="path-memory-filter">
          <span>终态</span>
          <select
            aria-label="按终态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TerminalStatusFilter)}
          >
            {TERMINAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="path-memory-filter path-memory-filter-workspace">
          <span>工作区</span>
          <input
            type="text"
            aria-label="按工作区过滤"
            placeholder="工作区路径"
            value={workspaceFilter}
            onChange={(event) => setWorkspaceFilter(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="path-memory-icon-button"
          aria-label={query.isFetching ? "刷新中" : "刷新路径记忆"}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw size={15} className={query.isFetching ? "is-spinning" : undefined} />
        </button>
      </div>
      <PathMemoryListBody
        pending={query.isPending}
        error={query.isError && query.data === undefined
          ? (query.error instanceof Error ? query.error.message : "路径记忆读取失败。")
          : undefined}
        onRetry={() => void query.refetch()}
        memories={query.data}
      />
    </div>
  );
}

function PathMemoryListBody(props: {
  readonly pending: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly memories?: readonly PathMemoryRecord[];
}): React.ReactElement {
  if (props.pending) {
    return <div className="path-memory-loading" aria-busy="true">正在加载路径记忆...</div>;
  }
  if (props.error !== undefined) {
    return (
      <div className="path-memory-error" role="alert">
        <div>
          <strong>路径记忆暂时不可用</strong>
          <p>{props.error}</p>
        </div>
        <button type="button" className="path-memory-action" onClick={props.onRetry}>
          <RefreshCw size={14} />
          <span>重试</span>
        </button>
      </div>
    );
  }
  const memories = props.memories ?? [];
  if (memories.length === 0) {
    return <div className="path-memory-empty">尚无路径记忆记录。完成一次任务后会自动采集。</div>;
  }
  return (
    <ul className="path-memory-list" aria-label="路径记忆记录">
      {memories.map((memory) => (
        <PathMemoryRow key={memory.id} memory={memory} />
      ))}
    </ul>
  );
}

function PathMemoryRow(props: { readonly memory: PathMemoryRecord }): React.ReactElement {
  const memory = props.memory;
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const queryClient = useQueryClient();

  const performDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deletePathMemory(memory.id);
      await queryClient.invalidateQueries({ queryKey: ["path-memory"] });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败。");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="path-memory-item">
      <div className="path-memory-row">
        <button
          type="button"
          className="path-memory-row-main"
          aria-expanded={expanded}
          aria-label={`查看路径记忆详情：${truncate(memory.goal.userRequest, 40)}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="path-memory-row-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="path-memory-row-request" title={memory.goal.userRequest}>
            {truncate(memory.goal.userRequest, 80)}
          </span>
          <span className={`path-memory-status-badge ${terminalStatusTone(memory.outcome.terminalStatus)}`}>
            {terminalStatusLabel(memory.outcome.terminalStatus)}
          </span>
          <span className="path-memory-row-meta">{memory.path.toolSteps.length} 步</span>
          <span className="path-memory-row-meta" title={memory.source.conversationId}>
            {truncate(memory.source.conversationId, 14)}
          </span>
          <span className="path-memory-row-meta">{formatTimestamp(memory.source.terminalAt)}</span>
        </button>
        <div className="path-memory-row-actions">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="path-memory-action danger"
                disabled={deleting}
                onClick={() => void performDelete()}
              >
                {deleting ? "删除中" : "确认删除"}
              </button>
              <button
                type="button"
                className="path-memory-action"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="path-memory-icon-button danger"
              aria-label={`删除路径记忆：${truncate(memory.goal.userRequest, 40)}`}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {deleteError !== undefined && (
        <p className="path-memory-delete-error" role="alert">{deleteError}</p>
      )}
      {expanded && <PathMemoryDetail memory={memory} />}
    </li>
  );
}

function PathMemoryDetail(props: { readonly memory: PathMemoryRecord }): React.ReactElement {
  const memory = props.memory;
  return (
    <div className="path-memory-detail" aria-label="路径记忆详情">
      <section>
        <h4>用户请求</h4>
        <p className="path-memory-detail-request">{memory.goal.userRequest}</p>
      </section>
      <section>
        <h4>来源</h4>
        <dl className="path-memory-detail-facts">
          <DetailFact label="运行" value={memory.source.runId} />
          <DetailFact label="对话" value={memory.source.conversationId} />
          <DetailFact label="用户回合" value={memory.source.userTurnId} />
          <DetailFact label="助手回合" value={memory.source.assistantTurnId} />
          <DetailFact label="运行创建" value={formatTimestamp(memory.source.runCreatedAt)} />
          <DetailFact label="终态时间" value={formatTimestamp(memory.source.terminalAt)} />
          <DetailFact label="采集时间" value={formatTimestamp(memory.capturedAt)} />
        </dl>
      </section>
      <section>
        <h4>工作区</h4>
        <dl className="path-memory-detail-facts">
          <DetailFact label="根目录" value={memory.scope.workspaceRoot} />
          <DetailFact label="选择方式" value={memory.scope.workspaceSelection === "explicit" ? "显式指定" : "默认"} />
        </dl>
      </section>
      <section>
        <h4>工具步骤</h4>
        {memory.path.toolSteps.length === 0 ? (
          <p className="path-memory-detail-muted">
            {memory.path.executionStarted ? "本次运行没有记录工具步骤。" : "本次运行未开始执行。"}
          </p>
        ) : (
          <div className="path-memory-steps-wrap">
            <table className="path-memory-steps-table">
              <thead>
                <tr><th>#</th><th>工具</th><th>状态</th><th>耗时</th><th>错误</th></tr>
              </thead>
              <tbody>
                {memory.path.toolSteps.map((step) => (
                  <ToolStepRow key={step.toolFactId} step={step} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h4>结果</h4>
        <OutcomeDetail outcome={memory.outcome} />
      </section>
      <section>
        <h4>验证</h4>
        <p className="path-memory-detail-muted">{verificationLabel(memory.verification.status)}</p>
      </section>
      {memory.evidenceRefs.length > 0 && (
        <section>
          <h4>证据引用</h4>
          <ul className="path-memory-refs">
            {memory.evidenceRefs.map((ref) => (
              <li key={ref}><code>{ref}</code></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ToolStepRow(props: { readonly step: PathMemoryToolStep }): React.ReactElement {
  const step = props.step;
  return (
    <tr>
      <td>{step.ordinal}</td>
      <td><strong>{step.toolName}</strong></td>
      <td>
        <span className={`path-memory-status-badge ${toolStepTone(step.status)}`}>
          {toolStepStatusLabel(step.status)}
        </span>
      </td>
      <td>{formatDuration(step.durationMs)}</td>
      <td className="path-memory-step-error">{step.error?.message ?? "—"}</td>
    </tr>
  );
}

function OutcomeDetail(props: { readonly outcome: PathMemoryOutcome }): React.ReactElement {
  const outcome = props.outcome;
  switch (outcome.terminalStatus) {
    case "completed":
      return (
        <dl className="path-memory-detail-facts">
          <DetailFact label="回答引用" value={outcome.answerRef} />
        </dl>
      );
    case "failed":
      return (
        <dl className="path-memory-detail-facts">
          <DetailFact label="错误代码" value={outcome.error.code} />
          <DetailFact label="错误信息" value={outcome.error.message} />
        </dl>
      );
    case "cancelled":
      return (
        <dl className="path-memory-detail-facts">
          <DetailFact label="取消原因" value={outcome.reason} />
        </dl>
      );
    case "blocked":
      return (
        <dl className="path-memory-detail-facts">
          <DetailFact label="受阻代码" value={outcome.reason.code} />
          <DetailFact label="受阻原因" value={outcome.reason.message} />
        </dl>
      );
  }
}

function DetailFact(props: { readonly label: string; readonly value: string }): React.ReactElement {
  return (
    <div className="path-memory-detail-fact">
      <dt>{props.label}</dt>
      <dd><code>{props.value}</code></dd>
    </div>
  );
}

function PathMemoryDiagnosticsPanel(): React.ReactElement {
  const query = useQuery(pathMemoryDiagnosticsQuery);
  if (query.isPending) {
    return <div className="path-memory-diagnostics is-muted" aria-busy="true">正在读取采集状况...</div>;
  }
  if (query.isError || query.data === undefined) {
    return <div className="path-memory-diagnostics is-muted">诊断暂不可用</div>;
  }
  const diagnostics = query.data;
  return (
    <div className="path-memory-diagnostics" aria-label="采集健康状况">
      <div className="path-memory-diagnostics-facts">
        <span>记录总数 <strong>{diagnostics.records.total}</strong></span>
        <span>实时采集 <strong>{diagnostics.realtime.captured}</strong></span>
        <span>实时失败 <strong>{diagnostics.realtime.failures}</strong></span>
        <span>对账 <strong>{reconciliationStatusLabel(diagnostics.reconciliation.status)}</strong></span>
      </div>
      {diagnostics.lastFailure !== undefined && (
        <p className="path-memory-diagnostics-failure" role="alert">
          最近一次采集失败（{formatTimestamp(diagnostics.lastFailure.occurredAt)}）：{diagnostics.lastFailure.message}
        </p>
      )}
    </div>
  );
}

function reconciliationStatusLabel(status: "running" | "completed" | "failed"): string {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function verificationLabel(status: "verified" | "failed" | "not_recorded"): string {
  switch (status) {
    case "verified":
      return "已验证";
    case "failed":
      return "验证失败";
    case "not_recorded":
      return "未记录验证";
  }
}

function terminalStatusLabel(status: PathMemoryTerminalStatus): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "blocked":
      return "受阻";
  }
}

function terminalStatusTone(status: PathMemoryTerminalStatus): "success" | "danger" | "neutral" | "warning" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
    case "blocked":
      return "warning";
  }
}

function toolStepStatusLabel(status: PathMemoryToolStep["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

function toolStepTone(status: PathMemoryToolStep["status"]): "success" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
  }
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2).replace(/\.0+$/u, "")} s`;
}
