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
  Play,
  type LucideIcon,
} from "lucide-react";
import type {
  DeepAgentRunTreeRef,
  DeepAgentRunTreeView,
  DeepChildAgentRunPendingApprovalView,
  DeepChildAgentRunView,
  DeepLiveChildProjection,
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
  blocked: "受阻",
  completed: "已完成",
  failed: "已失败",
  interrupted: "已中断",
  resumed: "已恢复",
};

/** 委托决策动作中文标签。 */
const DELEGATION_ACTION_LABEL: Record<DeepDelegationAction, string> = {
  spawn_children: "安排探索",
  wait_for_children: "等待探索",
  interrupt_child: "中断探索",
  resume_child: "恢复探索",
  request_parent_synthesis: "请求综合",
  request_user_clarification: "请求用户澄清",
  request_convergence: "请求收敛",
  stop: "停止",
};

/** 综合 next action 中文标签。 */
const SYNTHESIS_NEXT_ACTION_LABEL: Record<DeepParentSynthesisNextAction, string> = {
  continue_exploration: "继续探索",
  request_convergence: "请求收敛",
  request_user_clarification: "请求用户澄清",
  stop: "停止",
};

const SYNTHESIS_CHILD_REVIEW_LABEL: Record<NonNullable<DeepParentSynthesisView["childReviews"]>[number]["decision"], string> = {
  accepted: "采纳",
  rejected: "拒绝",
  needs_followup: "需跟进",
};

/** 置信度渲染为百分比字符串（0..1 → 0%..100%）。 */
function confidencePercent(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
}

function displayAgentName(value: string): string {
  if (value === "Deep Manager") {
    return "助手";
  }
  const childMatch = /^Deep Child (\d+)$/.exec(value);
  if (childMatch) {
    return `协作项 ${childMatch[1]}`;
  }
  return value;
}

type DeepRunTreeProps = {
  /** 完整 deep run view（含 run 摘要 + 计数 ref + 可选 report）。 */
  readonly view: DeepRunView;
  readonly busy?: boolean;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: (childRunId: string, message: string) => void | Promise<void>;
  readonly onChildConfirmation?: (
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ) => void | Promise<void>;
};

/**
 * Deep run tree 投影入口。按 report 是否产出分流到完整树或计数占位。
 */
export function DeepRunTree(props: DeepRunTreeProps): React.ReactElement {
  if (props.view.report === undefined) {
    return (
      <DeepRunTreeProgress
        view={props.view}
        busy={props.busy === true}
        childOperationBusyId={props.childOperationBusyId}
        onChildMessage={props.onChildMessage}
        onChildConfirmation={props.onChildConfirmation}
      />
    );
  }
  return (
    <DeepRunTreeFull
      tree={props.view.report.agentRunTree}
      summaries={props.view.report.childSummaries}
      busy={props.busy === true}
      childOperationBusyId={props.childOperationBusyId}
      onChildMessage={props.onChildMessage}
      onChildConfirmation={props.onChildConfirmation}
    />
  );
}

// ---------------------------------------------------------------------------
// 运行中：计数投影占位
// ---------------------------------------------------------------------------

type DeepRunTreeProgressProps = {
  readonly view: DeepRunView;
  readonly busy: boolean;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: DeepRunTreeProps["onChildMessage"];
  readonly onChildConfirmation?: DeepRunTreeProps["onChildConfirmation"];
};

function DeepRunTreeProgress(props: DeepRunTreeProgressProps): React.ReactElement {
  const treeRef = props.view.agentRunTree;
  const children = props.view.liveProjection.children;
  return (
    <section className="deep-tree deep-tree-progress" aria-label="协作详情">
      <header className="deep-tree-head">
        <Network className="deep-tree-icon" aria-hidden="true" />
        <h3 className="deep-tree-title">协作详情</h3>
        <span className={`deep-status-badge deep-status-${treeRef.status}`}>{RUN_STATUS_LABEL[props.view.run.status]}</span>
      </header>
      <p className="deep-tree-progress-hint">协作详情正在生成，当前展示已返回的探索状态。</p>
      <DeepLiveTreeMap treeRef={treeRef} />
      {children.length > 0 && (
        <div className="deep-tree-group">
          <h4 className="deep-tree-group-title">
            <GitBranch className="deep-tree-group-icon" aria-hidden="true" />
            探索记录（{children.length}）
          </h4>
          <ul className="deep-tree-children">
            {children.map((child) => (
              <LiveChildRunNode
                key={child.childRunId}
                child={child}
                busy={props.childOperationBusyId !== undefined}
                onChildMessage={props.onChildMessage}
                onChildConfirmation={props.onChildConfirmation}
              />
            ))}
          </ul>
        </div>
      )}
      <ul className="deep-tree-counts">
        <li>
          <span className="deep-tree-count-label">探索项</span>
          <span className="deep-tree-count-value">{treeRef.childRunCount}</span>
        </li>
        <li>
          <span className="deep-tree-count-label">委托决策</span>
          <span className="deep-tree-count-value">{treeRef.delegationDecisionCount}</span>
        </li>
        <li>
          <span className="deep-tree-count-label">综合记录</span>
          <span className="deep-tree-count-value">{treeRef.parentSynthesisCount}</span>
        </li>
      </ul>
    </section>
  );
}

function LiveChildRunNode(props: {
  readonly child: DeepLiveChildProjection;
  readonly busy: boolean;
  readonly onChildMessage?: DeepRunTreeProps["onChildMessage"];
  readonly onChildConfirmation?: DeepRunTreeProps["onChildConfirmation"];
}): React.ReactElement {
  const { child } = props;
  const confidence = confidencePercent(child.confidence);
  return (
    <li className={`deep-child deep-child-${child.status}`}>
      <div className="deep-child-head">
        <span className="deep-child-name">{displayAgentName(child.displayName)}</span>
        <span className="deep-child-role">{child.role}</span>
        <span className={`deep-status-badge deep-status-${child.status}`}>{CHILD_STATUS_LABEL[child.status]}</span>
      </div>
      <p className="deep-child-objective">{child.objective}</p>
      {child.summary && <p className="deep-child-summary">{child.summary}</p>}
      <div className="deep-child-meta">
        {confidence && (
          <span className="deep-child-confidence">
            置信度 {confidence}
          </span>
        )}
        {child.uncertainty && (
          <span className="deep-child-uncertainty">
            {child.uncertainty}
          </span>
        )}
      </div>
      {child.pendingApproval && (
        <ChildApprovalBlock
          childRunId={child.childRunId}
          pendingApproval={child.pendingApproval}
          busy={props.busy}
          onChildConfirmation={props.onChildConfirmation}
        />
      )}
      {props.onChildMessage && (
        <ChildMessageControls
          childRunId={child.childRunId}
          busy={props.busy}
          onSubmit={props.onChildMessage}
        />
      )}
    </li>
  );
}

function DeepLiveTreeMap(props: { readonly treeRef: DeepAgentRunTreeRef }): React.ReactElement {
  const childCount = props.treeRef.childRunCount;
  const visibleChildCount = childCount === 0 ? 2 : Math.min(childCount, 4);
  const hiddenChildCount = Math.max(0, childCount - visibleChildCount);
  return (
    <div className="deep-tree-live-map" aria-label="协作结构">
      <div className="deep-tree-live-node deep-tree-live-root">
        <span>助手</span>
        <small>{props.treeRef.rootAgentId}</small>
      </div>
      <div className="deep-tree-live-branch" aria-hidden="true" />
      <div className="deep-tree-live-children">
        {Array.from({ length: visibleChildCount }, (_, index) => (
          <div
            key={index}
            className={`deep-tree-live-node deep-tree-live-child ${childCount === 0 ? "pending" : ""}`}
          >
            <span>{childCount === 0 ? "探索位" : `协作项 ${index + 1}`}</span>
            <small>{childCount === 0 ? "等待派生" : "已投影"}</small>
          </div>
        ))}
        {hiddenChildCount > 0 && (
          <div className="deep-tree-live-node deep-tree-live-child more">
            <span>+{hiddenChildCount}</span>
            <small>更多协作项</small>
          </div>
        )}
      </div>
      <div className="deep-tree-live-branch deep-tree-live-branch-merge" aria-hidden="true" />
      <div className={`deep-tree-live-node deep-tree-live-synthesis ${props.treeRef.parentSynthesisCount === 0 ? "pending" : ""}`}>
        <span>综合</span>
        <small>{props.treeRef.parentSynthesisCount === 0 ? "等待材料" : `${props.treeRef.parentSynthesisCount} 次综合`}</small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 完整树：root + children + decisions + syntheses
// ---------------------------------------------------------------------------

type DeepRunTreeFullProps = {
  readonly tree: DeepAgentRunTreeView;
  readonly summaries: readonly DeepChildSummaryView[];
  readonly busy: boolean;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: DeepRunTreeProps["onChildMessage"];
  readonly onChildConfirmation?: DeepRunTreeProps["onChildConfirmation"];
};

function DeepRunTreeFull(props: DeepRunTreeFullProps): React.ReactElement {
  const summaryByChildRunId = new Map<string, DeepChildSummaryView>();
  for (const summary of props.summaries) {
    summaryByChildRunId.set(summary.childRunId, summary);
  }
  return (
    <section className="deep-tree" aria-label="协作详情">
      <header className="deep-tree-head">
        <Network className="deep-tree-icon" aria-hidden="true" />
        <h3 className="deep-tree-title">协作详情</h3>
        <span className={`deep-status-badge deep-status-${props.tree.status}`}>{treeStatusLabel(props.tree.status)}</span>
      </header>

      <div className="deep-tree-root">
        <NodeRow icon={Layers} label="助手" title={displayAgentName(props.tree.rootSpec.displayName)} meta={props.tree.rootSpec.role} />
        <p className="deep-tree-root-kind">类型：{props.tree.rootSpec.agentKind}</p>
      </div>

      {props.tree.childRuns.length > 0 && (
        <div className="deep-tree-group">
          <h4 className="deep-tree-group-title">
            <GitBranch className="deep-tree-group-icon" aria-hidden="true" />
            探索记录（{props.tree.childRuns.length}）
          </h4>
          <ul className="deep-tree-children">
            {props.tree.childRuns.map((childRun) => (
              <ChildRunNode
                key={childRun.childRunId}
                run={childRun}
                summary={summaryByChildRunId.get(childRun.childRunId)}
                busy={props.childOperationBusyId !== undefined}
                onChildMessage={props.onChildMessage}
                onChildConfirmation={props.onChildConfirmation}
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
          <h4 className="deep-tree-group-title">综合记录（{props.tree.parentSyntheses.length}）</h4>
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
// 协作项节点
// ---------------------------------------------------------------------------

type ChildRunNodeProps = {
  readonly run: DeepChildAgentRunView;
  readonly summary: DeepChildSummaryView | undefined;
  readonly busy: boolean;
  readonly onChildMessage?: DeepRunTreeProps["onChildMessage"];
  readonly onChildConfirmation?: DeepRunTreeProps["onChildConfirmation"];
};

function ChildRunNode(props: ChildRunNodeProps): React.ReactElement {
  const { run, summary } = props;
  const confidence = confidencePercent(summary?.confidence ?? run.confidence);
  const objective = run.spec.instructions?.objective ?? summary?.spec.objective;
  return (
    <li className={`deep-child deep-child-${run.status}`}>
      <div className="deep-child-head">
        <span className="deep-child-name">{displayAgentName(run.spec.displayName)}</span>
        <span className="deep-child-role">{run.spec.role}</span>
        <span className={`deep-status-badge deep-status-${run.status}`}>{CHILD_STATUS_LABEL[run.status]}</span>
      </div>
      {objective && <p className="deep-child-objective">{objective}</p>}
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
          <span className="deep-child-confidence">
            置信度 {confidence}
          </span>
        )}
        {(summary?.uncertainty ?? run.uncertainty) && (
          <span className="deep-child-uncertainty">
            {(summary?.uncertainty ?? run.uncertainty) as string}
          </span>
        )}
        {run.failureReason && <span className="deep-child-failure">失败原因：{run.failureReason}</span>}
      </div>
      {run.execution && (
        <div className="deep-child-execution" aria-label="协作项执行事实">
          <span>模型 {run.execution.modelRounds} 轮</span>
          <span>工具 {run.execution.toolRounds} 轮</span>
          {run.execution.toolCalls.length > 0 && (
            <span>工具调用 {run.execution.toolCalls.length}</span>
          )}
          {run.executionHistory && run.executionHistory.length > 1 && (
            <span>执行段 {run.executionHistory.length}</span>
          )}
          {run.parentInstructions && run.parentInstructions.length > 0 && (
            <span>跟进 {run.parentInstructions.length}</span>
          )}
        </div>
      )}
      {run.pendingApproval && (
        <ChildApprovalBlock
          childRunId={run.childRunId}
          pendingApproval={run.pendingApproval}
          busy={props.busy}
          onChildConfirmation={props.onChildConfirmation}
        />
      )}
      {props.onChildMessage && (
        <ChildMessageControls
          childRunId={run.childRunId}
          busy={props.busy}
          onSubmit={props.onChildMessage}
        />
      )}
      {run.evidenceRefs.length > 0 && (
        <div className="deep-child-refs">
          <span className="deep-ref-label">证据引用</span>
          <RefChips refs={run.evidenceRefs} />
        </div>
      )}
    </li>
  );
}

function ChildMessageControls(props: {
  readonly childRunId: string;
  readonly busy: boolean;
  readonly onSubmit: NonNullable<DeepRunTreeProps["onChildMessage"]>;
}): React.ReactElement {
  const [message, setMessage] = React.useState("");
  const trimmed = message.trim();
  return (
    <form
      className="deep-child-followup"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0 || props.busy) return;
        Promise.resolve(props.onSubmit(props.childRunId, trimmed)).then(() => setMessage(""));
      }}
    >
      <input
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={props.busy}
        placeholder="补充给这个协作项..."
        aria-label="补充给这个协作项"
      />
      <button type="submit" disabled={props.busy || trimmed.length === 0} aria-label="继续协作项">
        <Play size={13} aria-hidden="true" />
        <span>继续</span>
      </button>
    </form>
  );
}

function ChildApprovalBlock(props: {
  readonly childRunId: string;
  readonly pendingApproval: DeepChildAgentRunPendingApprovalView;
  readonly busy: boolean;
  readonly onChildConfirmation?: DeepRunTreeProps["onChildConfirmation"];
}): React.ReactElement {
  const { pendingApproval } = props;
  return (
    <div className="deep-child-approval" aria-label="协作项等待确认">
      <div className="deep-child-approval-head">
        <span>{pendingApproval.title}</span>
        <span>{pendingApproval.toolName}</span>
      </div>
      <p>{pendingApproval.actionSummary}</p>
      {pendingApproval.affectedResources.length > 0 && (
        <div className="deep-child-approval-resources">
          <span className="deep-ref-label">影响范围</span>
          <RefChips refs={pendingApproval.affectedResources} />
        </div>
      )}
      {pendingApproval.resumeAvailability && (
        <span className="deep-child-approval-resume">
          {pendingApproval.resumeAvailability === "live" ? "可继续" : "重启后不可继续"}
        </span>
      )}
      {props.onChildConfirmation && (
        <ChildConfirmationControls
          childRunId={props.childRunId}
          pendingApproval={pendingApproval}
          busy={props.busy}
          onDecision={props.onChildConfirmation}
        />
      )}
    </div>
  );
}

function ChildConfirmationControls(props: {
  readonly childRunId: string;
  readonly pendingApproval: DeepChildAgentRunPendingApprovalView;
  readonly busy: boolean;
  readonly onDecision: NonNullable<DeepRunTreeProps["onChildConfirmation"]>;
}): React.ReactElement {
  const [guidance, setGuidance] = React.useState("");
  const trimmedGuidance = guidance.trim();
  const decide = (
    decision: "approve_once" | "deny" | "guidance",
    nextGuidance?: string,
  ): void => {
    Promise.resolve(
      props.onDecision(
        props.childRunId,
        props.pendingApproval.confirmationId,
        decision,
        nextGuidance,
      ),
    ).then(() => setGuidance(""));
  };
  return (
    <div className="deep-child-approval-actions" aria-label="协作项确认操作">
      <div className="deep-child-approval-buttons">
        <button
          type="button"
          disabled={props.busy}
          onClick={() => decide("approve_once")}
        >
          批准一次
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => decide("deny")}
        >
          不执行
        </button>
      </div>
      <form
        className="deep-child-guidance"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.busy || trimmedGuidance.length === 0) return;
          decide("guidance", trimmedGuidance);
        }}
      >
        <input
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          disabled={props.busy}
          placeholder="给协作项补充要求..."
          aria-label="给协作项补充要求"
        />
        <button type="submit" disabled={props.busy || trimmedGuidance.length === 0}>
          发送
        </button>
      </form>
    </div>
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
          <span className="deep-ref-label">关联协作项</span>
          <RefChips refs={decision.childRunIds} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 综合节点
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
      {synthesis.childReviews && synthesis.childReviews.length > 0 && (
        <div className="deep-synthesis-reviews" aria-label="协作审查">
          {synthesis.childReviews.map((review) => (
            <div className="deep-synthesis-review" key={`${synthesis.synthesisId}:${review.childRunId}`}>
              <span className={`deep-synthesis-review-decision ${review.decision}`}>
                {SYNTHESIS_CHILD_REVIEW_LABEL[review.decision]}
              </span>
              <span className="deep-synthesis-review-child">{review.childRunId}</span>
              <span className="deep-synthesis-review-reason">{review.reason}</span>
            </div>
          ))}
        </div>
      )}
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
        <li key={ref} className="deep-ref-chip">
          {ref}
        </li>
      ))}
    </ul>
  );
}
