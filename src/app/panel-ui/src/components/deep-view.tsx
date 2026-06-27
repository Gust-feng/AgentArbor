/**
 * Deep 视图容器组件（T3-4d）。
 *
 * 组装 deep 运行的用户可见投影：运行头（goal + 状态）+ run tree 投影 +
 * 可解释结论区。对应 design §2.2.1/§6.2，落地 FR-006/FR-009 视图侧。
 *
 * 渲染规则：
 *   - `deepBusy` 且无 view：显示运行启动占位（提交后等待首轮投影）。
 *   - 有 view：渲染运行头 + [`DeepRunTree`](./deep-run-tree) + （若有 report.conclusion）
 *     [`DeepConclusion`](./deep-conclusion)。
 *   - 既无 view 且未 busy：显示空态引导（deep 模式尚未发起任务）。
 *
 * 本组件只做呈现编排，不承担数据获取（轮询/SSE 由 T3-4e 在 App 层注入 view）。
 */
import React from "react";
import { Loader2, Target } from "lucide-react";
import type { DeepRunStatus, DeepRunView } from "../contracts/deep";
import { DeepRunTree } from "./deep-run-tree";
import { DeepConclusion } from "./deep-conclusion";

type DeepViewProps = {
  /** 当前 deep run 投影；未发起或尚未拿到首轮时为 undefined。 */
  readonly view: DeepRunView | undefined;
  /** deep 提交/运行进行中标志（对应 AppState.deepBusy）。 */
  readonly busy: boolean;
};

/**
 * Deep 视图容器入口。
 */
export function DeepView(props: DeepViewProps): React.ReactElement {
  if (props.view === undefined) {
    if (props.busy) {
      return <DeepViewPending />;
    }
    return <DeepViewEmpty />;
  }
  return <DeepViewContent view={props.view} busy={props.busy} />;
}

// ---------------------------------------------------------------------------
// 有 view：运行头 + 树 + 结论
// ---------------------------------------------------------------------------

type DeepViewContentProps = {
  readonly view: DeepRunView;
  readonly busy: boolean;
};

function DeepViewContent(props: DeepViewContentProps): React.ReactElement {
  const { view, busy } = props;
  const conclusion = view.report?.conclusion;
  return (
    <div className="deep-view">
      <header className="deep-view-head">
        <Target className="deep-view-goal-icon" aria-hidden="true" />
        <div className="deep-view-goal-body">
          <h2 className="deep-view-goal">{view.run.goal}</h2>
          <div className="deep-view-meta">
            <span className={`deep-status-badge deep-status-${view.run.status}`}>{runStatusLabel(view.run.status)}</span>
            <span className="deep-view-run-id" title="run 标识">
              {view.run.runId}
            </span>
            {busy && (
              <span className="deep-view-busy">
                <Loader2 className="deep-view-busy-icon" aria-hidden="true" />
                后台执行中
              </span>
            )}
          </div>
        </div>
      </header>

      <DeepRunTree view={view} />

      {conclusion && <DeepConclusion conclusion={conclusion} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 占位与空态
// ---------------------------------------------------------------------------

function DeepViewPending(): React.ReactElement {
  return (
    <div className="deep-view deep-view-pending" role="status" aria-live="polite">
      <Loader2 className="deep-view-pending-icon" aria-hidden="true" />
      <p className="deep-view-pending-text">正在启动 deep 运行，首轮投影到达后将在此呈现。</p>
    </div>
  );
}

function DeepViewEmpty(): React.ReactElement {
  return (
    <div className="deep-view deep-view-empty">
      <Target className="deep-view-empty-icon" aria-hidden="true" />
      <p className="deep-view-empty-text">
        Deep 模式会派出 manager 与子 agent 多路探索，综合出可解释结论。输入目标后开始。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 共享工具
// ---------------------------------------------------------------------------

function runStatusLabel(status: DeepRunStatus): string {
  switch (status) {
    case "pending":
      return "待启动";
    case "running":
      return "运行中";
    case "interrupted":
      return "已打断";
    case "corrected":
      return "已纠正";
    case "stopped":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    default:
      return status;
  }
}
