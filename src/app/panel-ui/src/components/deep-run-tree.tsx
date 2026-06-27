/**
 * Deep agent run tree 投影组件（T3-4d）。
 *
 * 渲染 [`DeepRunView`](src/app/panel-ui/src/contracts/deep.ts:424) 中的可复盘证据链，
 * 落地 FR-009（agent run tree 可观察投影，可复盘）。
 *
 * 两态渲染：
 *   - `report` 已产出（run 完成/停止/失败收尾）：渲染完整领域树
 *     [`DeepAgentRunTreeView`](src/app/panel-ui/src/contracts/deep.ts:376)
 *     —— root manager + child runs + delegation decisions + parent syntheses，
 *     并用 `report.childSummaries` 补齐每个 child 的摘要/findings/置信度。
 *   - `report` 未产出（run 仍在运行/未收尾）：仅渲染
 *     [`DeepAgentRunTreeRef`](src/app/panel-ui/src/contracts/deep.ts:116) 计数投影，
 *     告知用户 tree 规模与状态，不臆造细节。
 *
 * 安全口径（FR-007）：本组件只消费契约中的安全投影字段，不渲染 raw prompt/response/output；
 * 证据引用只展示 refId 标识，不尝试解析其原始内容。
 */
import React from "react";
import {
  GitBranch,
  Layers,
  Network,
  type LucideIcon,
} from "lucide-react";
import type {
  DeepAgentRunTreeRef,
  DeepAgentRunTreeView,
  DeepChildAgentRunView,
  DeepChildRunStatus,
  DeepChildSummaryView,
  DeepDelegationAction,
  DeepDelegationDecisionView,
  DeepParentSynthesisNextAction,
  DeepParentSynthesisView,
  DeepRunStatus,
  DeepRunView,
} from "../contracts/deep";

/** DeepRunStatus 中文标签。 */
const RUN_STATUS_LABEL: Record<DeepRunStatus, string> = {
  pending: "待启动",
  running: "运行中",
  interrupted: "已打断",
  corrected: "已纠正",
  stopped: "已停止",
  completed: "已完成",
  failed: "已失败",
};

/** ChildAgentRun 状态中文标签。 */
const CHILD_STATUS_LABEL: Record<DeepChildRunStatus, string> = {
  planned: "已规划",
  running: "探索中",
  completed: "已完成",
  failed: "已失败",
  interrupted: "已打断",
  resumed: "已恢复",
};

/** 委托决策动作中文标签。 */
const DELEGATION_ACTION_LABEL: Record<DeepDelegationAction, string> = {
  spawn_children: "派生子任务",
  wait_for_children: "等待子任务",
  interrupt_child: "打断子任务",
  resume_child: "恢复子任务",
  request_parent_synthesis: "请求父层综合",
  request_user_clarification: "请求用户澄清",
  request_convergence: "请求收敛",
  stop: "停止",
};

/** 父层综合 next action 中文标签。 */
const SYNTHESIS_NEXT_ACTION_LABEL: Record<DeepParentSynthesisNextAction, string> = {
  continue_exploration: "继续探索",
  request_convergence: "请求收敛",
  request_user_clarification: "请求用户澄清",
  stop: "停止",
};

/** 置信度渲染为百分比字符串（0..1 → 0%..100%）。 */
function confidencePercent(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
}

type DeepRunTreeProps = {
  /** 完整 deep run view（含 run 摘要 + 计数 ref + 可选 report）。 */
  readonly view: DeepRunView;
};

/**
 * Deep run tree 投影入口。按 report 是否产出分流到完整树或计数占位。
 */
export function DeepRunTree(props: DeepRunTreeProps): React.ReactElement {
  if (props.view.report === undefined) {
    return <DeepRunTreeProgress ref={props.view.agentRunTree} runStatus={props.view.run.status} />;
  }
  return <DeepRunTreeFull tree={props.view.report.agentRunTree} summaries={props.view.report.childSummaries} />;
}

// ---------------------------------------------------------------------------
// 运行中：计数投影占位
// ---------------------------------------------------------------------------

type DeepRunTreeProgressProps = {
  readonly ref: DeepAgentRunTreeRef;
  readonly runStatus: DeepRunStatus;
};

function DeepRunTreeProgress(props: DeepRunTreeProgressProps): React.ReactElement {
  return (
    <section className="deep-tree deep-tree-progress" aria-label="deep 运行树投影">
      <header className="deep-tree-head">
        <Network className="deep-tree-icon" aria-hidden="true" />
        <h3 className="deep-tree-title">运行树</h3>
        <span className={`deep-status-badge deep-status-${props.ref.status}`}>{RUN_STATUS_LABEL[props.runStatus]}</span>
      </header>
      <p className="deep-tree-progress-hint">
        运行进行中，完整树将在 manager 收尾后呈现。当前规模：
      </p>
      <ul className="deep-tree-counts">
        <li>
          <span className="deep-tree-count-label">子任务</span>
          <span className="deep-tree-count-value">{props.ref.childRunCount}</span>
        </li>
        <li>
          <span className="deep-tree-count-label">委托决策</span>
          <span className="deep-tree-count-value">{props.ref.delegationDecisionCount}</span>
        </li>
        <li>
          <span className="deep-tree-count-label">父层综合</span>
          <span className="deep-tree-count-value">{props.ref.parentSynthesisCount}</span>
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 完整树：root + children + decisions + syntheses
// ---------------------------------------------------------------------------

type DeepRunTreeFullProps = {
  readonly tree: DeepAgentRunTreeView;
  readonly summaries: readonly DeepChildSummaryView[];
};

function DeepRunTreeFull(props: DeepRunTreeFullProps): React.ReactElement {
  const summaryByChildRunId = new Map<string, DeepChildSummaryView>();
  for (const summary of props.summaries) {
    summaryByChildRunId.set(summary.childRunId, summary);
  }
  return (
    <section className="deep-tree" aria-label="deep 运行树投影">
      <header className="deep-tree-head">
        <Network className="deep-tree-icon" aria-hidden="true" />
        <h3 className="deep-tree-title">运行树</h3>
        <span className={`deep-status-badge deep-status-${props.tree.status}`}>{treeStatusLabel(props.tree.status)}</span>
      </header>

      <div className="deep-tree-root">
        <NodeRow icon={Layers} label="Root Manager" title={props.tree.rootSpec.displayName} meta={props.tree.rootSpec.role} />
        <p className="deep-tree-root-kind">类型：{props.tree.rootSpec.agentKind}</p>
      </div>

      {props.tree.childRuns.length > 0 && (
        <div className="deep-tree-group">
          <h4 className="deep-tree-group-title">
            <GitBranch className="deep-tree-group-icon" aria-hidden="true" />
            子任务探索（{props.tree.childRuns.length}）
          </h4>
          <ul className="deep-tree-children">
            {props.tree.childRuns.map((childRun) => (
              <ChildRunNode
                key={childRun.childRunId}
                run={childRun}
                summary={summaryByChildRunId.get(childRun.childRunId)}
              />
            ))}
          </ul>
        </div>
      )}

      {props.tree.delegationDecisions.length > 0 && (
        <div className="deep-tree-group">
          <h4 className="deep-tree-group-title">委托决策（{props.tree.delegationDecisions.length}）</h4>
          <ul className="deep-tree-decisions">
            {props.tree.delegationDecisions.map((decision) => (
              <DecisionNode key={decision.decisionId} decision={decision} />
            ))}
          </ul>
        </div>
      )}

      {props.tree.parentSyntheses.length > 0 && (
        <div className="deep-tree-group">
          <h4 className="deep-tree-group-title">父层综合（{props.tree.parentSyntheses.length}）</h4>
          <ul className="deep-tree-syntheses">
            {props.tree.parentSyntheses.map((synthesis) => (
              <SynthesisNode key={synthesis.synthesisId} synthesis={synthesis} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function treeStatusLabel(status: DeepAgentRunTreeView["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    case "stopped":
      return "已停止";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// 子任务节点
// ---------------------------------------------------------------------------

type ChildRunNodeProps = {
  readonly run: DeepChildAgentRunView;
  readonly summary: DeepChildSummaryView | undefined;
};

function ChildRunNode(props: ChildRunNodeProps): React.ReactElement {
  const { run, summary } = props;
  const confidence = confidencePercent(summary?.confidence ?? run.confidence);
  return (
    <li className={`deep-child deep-child-${run.status}`}>
      <div className="deep-child-head">
        <span className="deep-child-name">{run.spec.displayName}</span>
        <span className="deep-child-role">{run.spec.role}</span>
        <span className={`deep-status-badge deep-status-${run.status}`}>{CHILD_STATUS_LABEL[run.status]}</span>
      </div>
      {summary?.summary && <p className="deep-child-summary">{summary.summary}</p>}
      {summary && summary.findings.length > 0 && (
        <ul className="deep-child-findings">
          {summary.findings.map((finding, index) => (
            <li key={index}>{finding}</li>
          ))}
        </ul>
      )}
      <div className="deep-child-meta">
        {confidence && (
          <span className="deep-child-confidence" title="置信度">
            置信度 {confidence}
          </span>
        )}
        {(summary?.uncertainty ?? run.uncertainty) && (
          <span className="deep-child-uncertainty" title="主要不确定性">
            {(summary?.uncertainty ?? run.uncertainty) as string}
          </span>
        )}
        {run.failureReason && <span className="deep-child-failure">失败原因：{run.failureReason}</span>}
      </div>
      {run.evidenceRefs.length > 0 && (
        <div className="deep-child-refs">
          <span className="deep-ref-label">证据引用</span>
          <RefChips refs={run.evidenceRefs} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 委托决策节点
// ---------------------------------------------------------------------------

type DecisionNodeProps = {
  readonly decision: DeepDelegationDecisionView;
};

function DecisionNode(props: DecisionNodeProps): React.ReactElement {
  const { decision } = props;
  const confidence = confidencePercent(decision.confidence);
  return (
    <li className="deep-decision">
      <div className="deep-decision-head">
        <span className="deep-decision-action">{DELEGATION_ACTION_LABEL[decision.action]}</span>
        {confidence && <span className="deep-decision-confidence">置信度 {confidence}</span>}
        {decision.source === "deterministic_fallback" && (
          <span className="deep-source-badge deep-source-fallback">兜底</span>
        )}
      </div>
      <p className="deep-decision-rationale">{decision.rationale}</p>
      {decision.uncertainty && <p className="deep-decision-uncertainty">不确定性：{decision.uncertainty}</p>}
      {decision.childRunIds.length > 0 && (
        <div className="deep-decision-refs">
          <span className="deep-ref-label">关联子任务</span>
          <RefChips refs={decision.childRunIds} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 父层综合节点
// ---------------------------------------------------------------------------

type SynthesisNodeProps = {
  readonly synthesis: DeepParentSynthesisView;
};

function SynthesisNode(props: SynthesisNodeProps): React.ReactElement {
  const { synthesis } = props;
  const confidence = confidencePercent(synthesis.confidence);
  return (
    <li className="deep-synthesis">
      <div className="deep-synthesis-head">
        <span className="deep-synthesis-next">下一步：{SYNTHESIS_NEXT_ACTION_LABEL[synthesis.nextAction]}</span>
        {confidence && <span className="deep-synthesis-confidence">置信度 {confidence}</span>}
        {synthesis.source === "deterministic_fallback" && (
          <span className="deep-source-badge deep-source-fallback">兜底</span>
        )}
      </div>
      <p className="deep-synthesis-summary">{synthesis.decisionSummary}</p>
      {synthesis.uncertainty && <p className="deep-synthesis-uncertainty">不确定性：{synthesis.uncertainty}</p>}
      {(synthesis.retainedMaterialRefs.length > 0 || synthesis.rejectedMaterialRefs.length > 0) && (
        <div className="deep-synthesis-material">
          {synthesis.retainedMaterialRefs.length > 0 && (
            <div className="deep-synthesis-material-group">
              <span className="deep-ref-label">保留材料</span>
              <RefChips refs={synthesis.retainedMaterialRefs} />
            </div>
          )}
          {synthesis.rejectedMaterialRefs.length > 0 && (
            <div className="deep-synthesis-material-group">
              <span className="deep-ref-label">剔除材料</span>
              <RefChips refs={synthesis.rejectedMaterialRefs} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 共享：节点行 + 引用芯片
// ---------------------------------------------------------------------------

type NodeRowProps = {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly title: string;
  readonly meta?: string;
};

function NodeRow(props: NodeRowProps): React.ReactElement {
  const Icon = props.icon;
  return (
    <div className="deep-node-row">
      <Icon className="deep-node-icon" aria-hidden="true" />
      <span className="deep-node-label">{props.label}</span>
      <span className="deep-node-title">{props.title}</span>
      {props.meta && <span className="deep-node-meta">{props.meta}</span>}
    </div>
  );
}

type RefChipsProps = {
  readonly refs: readonly string[];
};

function RefChips(props: RefChipsProps): React.ReactElement {
  return (
    <ul className="deep-ref-chips">
      {props.refs.map((ref) => (
        <li key={ref} className="deep-ref-chip" title={`引用 ${ref}`}>
          {ref}
        </li>
      ))}
    </ul>
  );
}
