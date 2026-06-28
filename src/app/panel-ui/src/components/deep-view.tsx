/**
 * 多 Agent 默认视图。
 *
 * 默认层只把 `/api/deep/*` 的安全 read-model 投影成助手回复流和轻量协作进展；
 * 事件、运行树和长材料只在按需打开的协作记录里出现。这里不重建运行事实，
 * 也不改普通 agent 主线。
 */
import React from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  HelpCircle,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
  User,
  XCircle,
} from "lucide-react";
import type {
  DeepConversationView,
  DeepChildRunStatus,
  DeepConclusionView,
  DeepIntakeStatus,
  DeepIntakeTurn,
  DeepLiveChildProjection,
  DeepLivePhase,
  DeepRunStatus,
  DeepRunView,
  DeepStreamEvent,
} from "../contracts/deep";
import { DeepConclusion } from "./deep-conclusion";
import { DeepRunTree } from "./deep-run-tree";

type DeepViewProps = {
  /** 当前多 Agent run 投影；未发起或尚未拿到首轮时为 undefined。 */
  readonly view: DeepRunView | undefined;
  /** intake 对话；可能尚未创建协作 run。 */
  readonly conversation?: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  /** 多 Agent 提交/运行进行中标志（对应 AppState.deepBusy）。 */
  readonly busy: boolean;
  /** 首轮 view 到达前保留的本地提交目标，不作为后端运行事实使用。 */
  readonly pendingGoal?: string;
  readonly childOperationBusyId?: string;
  readonly resynthesisBusy?: boolean;
  readonly onChildMessage?: (childRunId: string, message: string) => void | Promise<void>;
  readonly onChildConfirmation?: (
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ) => void | Promise<void>;
  readonly onResynthesize?: () => void | Promise<void>;
};

type DeepChatItem =
  | {
      readonly kind: "user_goal";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "parent_message";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly tone: "current" | "complete" | "waiting" | "problem";
      readonly children?: readonly DeepLiveChildProjection[];
    }
  | {
      readonly kind: "system_notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "waiting" | "problem" | "complete";
    };

type DeepWorkflowItem = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly tone: "active" | "complete" | "waiting" | "problem";
};

export function DeepView(props: DeepViewProps): React.ReactElement {
  if (props.view === undefined) {
    if (props.conversation !== undefined && props.conversation.intakeTurns.length > 0) {
      return (
        <DeepIntakeChatView
          conversation={props.conversation}
          intakeStatus={props.intakeStatus}
          busy={props.busy}
          pendingGoal={props.pendingGoal}
        />
      );
    }
    if (props.busy) {
      return <DeepViewPending pendingGoal={props.pendingGoal} />;
    }
    return <DeepViewEmpty />;
  }
  return (
    <DeepChatView
      view={props.view}
      busy={props.busy}
      childOperationBusyId={props.childOperationBusyId}
      resynthesisBusy={props.resynthesisBusy}
      onChildMessage={props.onChildMessage}
      onChildConfirmation={props.onChildConfirmation}
      onResynthesize={props.onResynthesize}
    />
  );
}

function DeepIntakeChatView(props: {
  readonly conversation: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  readonly busy: boolean;
  readonly pendingGoal?: string;
}): React.ReactElement {
  const items = deepIntakeChatItems(props.conversation.intakeTurns, props.intakeStatus);
  const pendingGoal = props.pendingGoal?.trim();
  return (
    <div className="deep-view deep-chat-view deep-intake-chat-view">
      <section className="deep-chat-thread" aria-label="助手回复">
        <div className="deep-chat-live-status" aria-label="多 Agent 当前状态">
          <span className={`deep-phase-chip deep-phase-${intakePhaseClass(props.intakeStatus, props.busy)}`}>
            {intakeStatusLabel(props.intakeStatus, props.busy)}
          </span>
          {props.busy && (
            <span className="deep-chat-live-dot">
              <Loader2 aria-hidden="true" />
              实时
            </span>
          )}
        </div>
        {items.map((item) => {
          if (item.kind === "user_goal") {
            return <DeepUserMessage key={item.id} item={item} />;
          }
          if (item.kind === "system_notice") {
            return <DeepSystemNotice key={item.id} item={item} />;
          }
          return (
            <DeepParentMessage
              key={item.id}
              item={item}
              activeChildRunId=""
            />
          );
        })}
        {props.busy && pendingGoal && (
          <DeepUserMessage
            item={{
              kind: "user_goal",
              id: "pending-intake-goal",
              text: pendingGoal,
            }}
          />
        )}
      </section>
    </div>
  );
}

function deepIntakeChatItems(
  turns: readonly DeepIntakeTurn[],
  intakeStatus: DeepIntakeStatus | undefined,
): readonly DeepChatItem[] {
  const items: DeepChatItem[] = [];
  for (const turn of turns) {
    items.push({
      kind: "user_goal",
      id: `intake-user:${turn.turnId}`,
      text: turn.userMessage,
    });
    items.push({
      kind: "parent_message",
      id: `intake-assistant:${turn.turnId}`,
      label: "助手",
      text: turn.assistantMessage,
      tone:
        turn.action === "ask_user"
          ? "waiting"
          : turn.action === "direct_answer"
            ? "complete"
            : intakeStatus === "running"
              ? "current"
              : "complete",
    });
    if (turn.action === "start_collaboration" && turn.plan !== undefined) {
      items.push({
        kind: "parent_message",
        id: `intake-plan:${turn.turnId}`,
        label: "助手",
        text: turn.plan,
        tone: "current",
      });
    }
  }
  return items;
}

function DeepChatView(props: {
  readonly view: DeepRunView;
  readonly busy: boolean;
  readonly childOperationBusyId?: string;
  readonly resynthesisBusy?: boolean;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
  readonly onResynthesize?: DeepViewProps["onResynthesize"];
}): React.ReactElement {
  const { view, busy } = props;
  const items = deepChatItems(view);
  const conclusion = view.report?.conclusion;
  const needsResynthesis = conclusion !== undefined && view.liveProjection.synthesis?.status === "pending";
  const canResynthesize =
    props.onResynthesize !== undefined &&
    view.report !== undefined &&
    view.report.childSummaries.length > 0;
  const showCollaborationRecord = hasCollaborationRecord(view);

  return (
    <div className="deep-view deep-chat-view" data-run-status={view.run.status}>
      <section className="deep-chat-thread" aria-label="助手回复">
        <DeepLiveStatus view={view} busy={busy} />
        <DeepWorkflowStrip view={view} busy={busy} />
        {items.map((item) => {
          if (item.kind === "user_goal") {
            return <DeepUserMessage key={item.id} item={item} />;
          }
          if (item.kind === "system_notice") {
            return <DeepSystemNotice key={item.id} item={item} />;
          }
          return (
            <DeepParentMessage
              key={item.id}
              item={item}
              activeChildRunId={view.liveProjection.activeNodeId}
              childOperationBusyId={props.childOperationBusyId}
              onChildMessage={props.onChildMessage}
              onChildConfirmation={props.onChildConfirmation}
            />
          );
        })}
      </section>

      {showCollaborationRecord && (
        <DeepCollaborationRecord
          view={view}
          busy={busy}
          needsResynthesis={needsResynthesis}
          canResynthesize={canResynthesize}
          resynthesisBusy={props.resynthesisBusy}
          childOperationBusyId={props.childOperationBusyId}
          onChildMessage={props.onChildMessage}
          onChildConfirmation={props.onChildConfirmation}
          onResynthesize={props.onResynthesize}
        />
      )}
    </div>
  );
}

function DeepCollaborationRecord(props: {
  readonly view: DeepRunView;
  readonly busy: boolean;
  readonly needsResynthesis: boolean;
  readonly canResynthesize: boolean;
  readonly resynthesisBusy?: boolean;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
  readonly onResynthesize?: DeepViewProps["onResynthesize"];
}): React.ReactElement {
  const { view } = props;
  const conclusion = view.report?.conclusion;
  return (
    <details className="deep-record-section">
      <summary>
        <ChevronDown size={14} aria-hidden="true" />
        <span>协作记录</span>
      </summary>
      <div className="deep-detail-body">
        <div className="deep-detail-meta">
          <span className={`deep-status-badge deep-status-${view.run.status}`}>
            {runStatusLabel(view.run.status)}
          </span>
          <span>更新 {formatShortTime(view.liveProjection.updatedAt)}</span>
          {props.canResynthesize && (
            <button
              type="button"
              className="deep-resynthesis-button"
              disabled={props.busy || props.resynthesisBusy === true}
              onClick={() => void props.onResynthesize?.()}
              aria-label="重新综合"
              title={props.needsResynthesis ? "当前协作材料已更新，需要重新综合" : "重新综合当前协作材料"}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>{props.resynthesisBusy === true ? "综合中" : "重新综合"}</span>
            </button>
          )}
          {props.needsResynthesis && <span className="deep-resynthesis-state">待重新综合</span>}
        </div>
        {view.brief && <DeepBriefDetails brief={view.brief} />}
        {conclusion && <DeepConclusion conclusion={conclusion} />}
        <DeepEventTimeline events={view.eventSequence} busy={props.busy} />
        <DeepRunTree
          view={view}
          busy={props.busy}
          childOperationBusyId={props.childOperationBusyId}
          onChildMessage={props.onChildMessage}
          onChildConfirmation={props.onChildConfirmation}
        />
      </div>
    </details>
  );
}

function hasCollaborationRecord(view: DeepRunView): boolean {
  return (
    view.brief !== undefined ||
    view.liveProjection.children.length > 0 ||
    view.report !== undefined ||
    view.eventSequence.length > 1 ||
    view.run.status === "failed" ||
    view.run.status === "stopped" ||
    view.run.status === "interrupted"
  );
}

function deepChatItems(view: DeepRunView): readonly DeepChatItem[] {
  const items: DeepChatItem[] = [
    {
      kind: "user_goal",
      id: `goal:${view.run.runId}`,
      text: view.run.goal,
    },
  ];

  const decisionText = parentDecisionText(view);
  if (decisionText !== undefined) {
    items.push({
      kind: "parent_message",
      id: `decision:${view.liveProjection.decision?.decisionId ?? view.run.runId}`,
      label: "助手",
      text: decisionText,
      tone: view.liveProjection.phase === "needs_input" ? "waiting" : "current",
    });
  }

  if (view.liveProjection.children.length > 0) {
    items.push({
      kind: "parent_message",
      id: `children:${view.run.runId}:${view.liveProjection.children.length}`,
      label: "助手",
      text: childActivityIntro(view.liveProjection.children),
      tone: childActivityTone(view.liveProjection.children),
      children: view.liveProjection.children,
    });
  }

  const synthesisText = parentSynthesisText(view);
  if (synthesisText !== undefined) {
    items.push({
      kind: "parent_message",
      id: `synthesis:${view.liveProjection.synthesis?.synthesisId ?? view.report?.reportId ?? view.run.runId}`,
      label: "助手",
      text: synthesisText,
      tone: view.liveProjection.synthesis?.status === "pending" ? "waiting" : "current",
    });
  }

  const conclusionText = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);
  if (conclusionText !== undefined) {
    items.push({
      kind: "parent_message",
      id: `conclusion:${view.report?.conclusion.conclusionId ?? view.liveProjection.conclusion?.conclusionId ?? view.run.runId}`,
      label: "助手",
      text: conclusionText,
      tone: "complete",
    });
  }

  const notice = parentNotice(view);
  if (notice !== undefined) {
    items.push(notice);
  }

  return items;
}

function parentDecisionText(view: DeepRunView): string | undefined {
  if (view.liveProjection.phase === "needs_input") {
    const summary = view.liveProjection.decision?.summary;
    return summary === undefined
      ? "这个目标还缺少关键范围，我需要你补充后再继续。"
      : `${summary}`;
  }
  if (view.liveProjection.decision?.summary !== undefined) {
    return view.liveProjection.decision.summary;
  }
  if (view.brief !== undefined) {
    return `${view.brief.scopeSummary}；${view.brief.sourcePolicySummary}${view.brief.plannedAngles.length > 0 ? `；我会从 ${view.brief.plannedAngles.length} 个角度展开协作探索。` : "。"}`;
  }
  return undefined;
}

function childActivityIntro(children: readonly DeepLiveChildProjection[]): string {
  const running = children.filter((child) => child.status === "running" || child.status === "resumed").length;
  const completed = children.filter((child) => child.status === "completed").length;
  const blocked = children.filter((child) => child.status === "blocked").length;
  if (running > 0) {
    return `我已经安排 ${children.length} 个协作项，正在等待其中 ${running} 个继续返回材料。`;
  }
  if (blocked > 0) {
    return `${blocked} 个协作项需要处理后才能继续，我会把可操作项列在下面。`;
  }
  if (completed === children.length) {
    return `协作项已全部返回，我会审查这些结论后再综合回答。`;
  }
  return `我已经安排 ${children.length} 个协作项，并会把关键结论汇总回来。`;
}

function childActivityTone(children: readonly DeepLiveChildProjection[]): "current" | "complete" | "problem" {
  if (children.some((child) => child.status === "failed" || child.status === "interrupted" || child.status === "blocked")) {
    return "problem";
  }
  if (children.length > 0 && children.every((child) => child.status === "completed")) {
    return "complete";
  }
  return "current";
}

function parentSynthesisText(view: DeepRunView): string | undefined {
  if (view.liveProjection.synthesis?.summary !== undefined) {
    return view.liveProjection.synthesis.summary;
  }
  const latestSynthesis = view.report?.synthesisRecords.at(-1);
  return latestSynthesis?.decisionSummary;
}

function parentConclusionText(
  conclusion: DeepConclusionView | undefined,
  liveConclusion: DeepRunView["liveProjection"]["conclusion"],
): string | undefined {
  if (conclusion !== undefined) {
    return conclusion.conclusion;
  }
  return liveConclusion?.oneLineRationale;
}

function parentNotice(view: DeepRunView): DeepChatItem | undefined {
  if (view.liveProjection.phase === "needs_input") {
    return {
      kind: "system_notice",
      id: `needs-input:${view.run.runId}`,
      text: "等待你补充要求或范围。",
      tone: "waiting",
    };
  }
  if (view.run.status === "stopped") {
    return {
      kind: "system_notice",
      id: `stopped:${view.run.runId}`,
      text: "已停止，已有材料已保留。",
      tone: "complete",
    };
  }
  if (view.run.status === "failed") {
    return {
      kind: "system_notice",
      id: `failed:${view.run.runId}`,
      text: "运行失败，已记录可用过程。",
      tone: "problem",
    };
  }
  return undefined;
}

function DeepLiveStatus(props: { readonly view: DeepRunView; readonly busy: boolean }): React.ReactElement {
  const { view, busy } = props;
  const childCount = view.liveProjection.children.length;
  const runningChildCount = view.liveProjection.children.filter(
    (child) => child.status === "running" || child.status === "resumed",
  ).length;
  return (
    <div className="deep-chat-live-status" aria-label="多 Agent 当前状态">
      <span className={`deep-phase-chip deep-phase-${view.liveProjection.phase}`}>
        {compactPhaseLabel(view.liveProjection.phase, view.run.status, childCount, runningChildCount)}
      </span>
      {(busy || view.run.status === "running") && (
        <span className="deep-chat-live-dot">
          <Loader2 aria-hidden="true" />
          实时
        </span>
      )}
    </div>
  );
}

function intakePhaseClass(
  status: DeepIntakeStatus | undefined,
  busy: boolean,
): DeepLivePhase {
  if (busy || status === "running") {
    return "deciding";
  }
  if (status === "needs_input") {
    return "needs_input";
  }
  if (status === "answered") {
    return "completed";
  }
  return "starting";
}

function intakeStatusLabel(
  status: DeepIntakeStatus | undefined,
  busy: boolean,
): string {
  if (busy || status === "running") {
    return "理解中";
  }
  if (status === "needs_input") {
    return "等待补充";
  }
  if (status === "answered") {
    return "已回答";
  }
  return "未开始";
}

function DeepWorkflowStrip(props: { readonly view: DeepRunView; readonly busy: boolean }): React.ReactElement | null {
  const items = workflowItemsForView(props.view, props.busy);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="deep-workflow-strip" aria-label="协作进展">
      <ol className="deep-workflow-list">
        {items.map((item) => (
          <li key={item.id} className={`deep-workflow-item deep-workflow-${item.tone}`}>
            <span className="deep-workflow-marker" aria-hidden="true">
              {item.tone === "active" ? (
                <Loader2 />
              ) : item.tone === "complete" ? (
                <CheckCircle2 />
              ) : item.tone === "problem" ? (
                <AlertTriangle />
              ) : (
                <Clock3 />
              )}
            </span>
            <span className="deep-workflow-copy">
              <span className="deep-workflow-label">{item.label}</span>
              {item.detail !== undefined && <span className="deep-workflow-detail">{item.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function workflowItemsForView(view: DeepRunView, busy: boolean): readonly DeepWorkflowItem[] {
  const items: DeepWorkflowItem[] = [];
  const phase = view.liveProjection.phase;
  const decision = view.liveProjection.decision?.summary ?? view.brief?.scopeSummary;
  const children = view.liveProjection.children;
  const synthesis = view.liveProjection.synthesis?.summary ?? view.report?.synthesisRecords.at(-1)?.decisionSummary;
  const conclusion = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);

  if (phase === "needs_input") {
    items.push({
      id: `needs-input:${view.run.runId}`,
      label: "等待补充",
      detail: "补充范围后继续。",
      tone: "waiting",
    });
  } else if (decision !== undefined) {
    items.push({
      id: `decision:${view.liveProjection.decision?.decisionId ?? view.run.runId}`,
      label: "方向已明确",
      detail: decision,
      tone: phase === "deciding" ? "active" : "complete",
    });
  } else if (busy || phase === "starting" || phase === "deciding" || view.run.status === "running") {
    items.push({
      id: `planning:${view.run.runId}`,
      label: "规划中",
      tone: "active",
    });
  }

  if (children.length > 0) {
    items.push({
      id: `children:${view.run.runId}:${children.length}`,
      label: childWorkflowLabel(children),
      detail: childWorkflowDetail(children),
      tone: workflowToneFromChildren(children, phase),
    });
  }

  if (synthesis !== undefined || phase === "synthesizing") {
    items.push({
      id: `synthesis:${view.liveProjection.synthesis?.synthesisId ?? view.report?.reportId ?? view.run.runId}`,
      label: phase === "synthesizing" ? "整理中" : "已整理",
      detail: synthesis,
      tone: phase === "synthesizing" || view.liveProjection.synthesis?.status === "pending" ? "active" : "complete",
    });
  }

  if (conclusion !== undefined) {
    items.push({
      id: `conclusion:${view.report?.conclusion.conclusionId ?? view.liveProjection.conclusion?.conclusionId ?? view.run.runId}`,
      label: "已形成结论",
      detail: conclusion,
      tone: "complete",
    });
  }

  if (view.run.status === "failed") {
    items.push({
      id: `failed:${view.run.runId}`,
      label: "未完成",
      tone: "problem",
    });
  }

  return items;
}

function childWorkflowLabel(children: readonly DeepLiveChildProjection[]): string {
  const running = children.filter((child) => child.status === "running" || child.status === "resumed").length;
  const completed = children.filter((child) => child.status === "completed").length;
  const blocked = children.filter((child) => child.status === "blocked").length;
  if (running > 0) {
    return `${running} 项进行中`;
  }
  if (blocked > 0) {
    return `${blocked} 项待处理`;
  }
  if (completed === children.length) {
    return `${completed} 项已返回`;
  }
  return `${children.length} 项已安排`;
}

function childWorkflowDetail(children: readonly DeepLiveChildProjection[]): string | undefined {
  const active = children.find((child) => child.status === "running" || child.status === "resumed" || child.status === "blocked");
  const completed = children.find((child) => child.status === "completed" && child.summary !== undefined);
  const child = active ?? completed ?? children[0];
  const result = childResultText(child);
  return result ?? child.objective;
}

function workflowToneFromChildren(
  children: readonly DeepLiveChildProjection[],
  phase: DeepLivePhase,
): DeepWorkflowItem["tone"] {
  if (children.some((child) => child.status === "failed" || child.status === "interrupted" || child.status === "blocked")) {
    return "problem";
  }
  if (children.length > 0 && children.every((child) => child.status === "completed")) {
    return phase === "exploring" ? "active" : "complete";
  }
  return "active";
}

function DeepUserMessage(props: {
  readonly item: Extract<DeepChatItem, { readonly kind: "user_goal" }>;
}): React.ReactElement {
  return (
    <article className="deep-chat-message deep-chat-user-message">
      <div className="deep-chat-user-bubble">
        <span className="deep-chat-message-icon" aria-hidden="true">
          <User size={15} />
        </span>
        <p>{props.item.text}</p>
      </div>
    </article>
  );
}

function DeepParentMessage(props: {
  readonly item: Extract<DeepChatItem, { readonly kind: "parent_message" }>;
  readonly activeChildRunId: string;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
}): React.ReactElement {
  return (
    <article className={`deep-chat-message deep-chat-parent-message deep-chat-parent-${props.item.tone}`}>
      <div className="assistant-message-label">
        <span className="assistant-message-icon" aria-hidden="true">
          <Bot size={14} />
        </span>
        <span>{props.item.label}</span>
      </div>
      <div className="deep-chat-parent-body">
        <div className="deep-chat-parent-answer">
          <p>{props.item.text}</p>
        </div>
        {props.item.children !== undefined && props.item.children.length > 0 && (
          <DeepChildActivityStrip
            children={props.item.children}
            activeChildRunId={props.activeChildRunId}
            childOperationBusyId={props.childOperationBusyId}
            onChildMessage={props.onChildMessage}
            onChildConfirmation={props.onChildConfirmation}
          />
        )}
      </div>
    </article>
  );
}

function DeepSystemNotice(props: {
  readonly item: Extract<DeepChatItem, { readonly kind: "system_notice" }>;
}): React.ReactElement {
  const Icon = props.item.tone === "problem" ? AlertTriangle : props.item.tone === "complete" ? CheckCircle2 : Clock3;
  return (
    <div className={`deep-chat-system-notice deep-chat-system-${props.item.tone}`} role="status">
      <Icon size={14} aria-hidden="true" />
      <span>{props.item.text}</span>
    </div>
  );
}

function DeepChildActivityStrip(props: {
  readonly children: readonly DeepLiveChildProjection[];
  readonly activeChildRunId: string;
  readonly childOperationBusyId?: string;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
}): React.ReactElement {
  return (
    <div className="deep-chat-child-strip" aria-label="协作进展">
      {props.children.map((child) => (
        <DeepChildActivityCard
          key={child.childRunId}
          child={child}
          active={props.activeChildRunId === child.childRunId}
          busy={props.childOperationBusyId === child.childRunId}
          onChildMessage={props.onChildMessage}
          onChildConfirmation={props.onChildConfirmation}
        />
      ))}
    </div>
  );
}

function DeepChildActivityCard(props: {
  readonly child: DeepLiveChildProjection;
  readonly active: boolean;
  readonly busy: boolean;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
}): React.ReactElement {
  const result = childResultText(props.child);
  return (
    <section
      className={`deep-chat-child-card deep-chat-child-${props.child.status} ${props.active ? "active" : ""}`}
      title={props.child.objective}
    >
      <div className="deep-chat-child-head">
        <ChildStatusIcon status={props.child.status} />
        <span className="deep-chat-child-name">{displayAgentName(props.child.displayName)}</span>
        <span className={`deep-chat-child-status deep-status-${props.child.status}`}>
          {childStatusLabel(props.child.status)}
        </span>
        {props.child.parentOperation && (
          <span
            className={`deep-child-node-parent-op deep-child-node-parent-op-${props.child.parentOperation.status}`}
            title={props.child.parentOperation.messageRef}
          >
            {parentOperationLabel(props.child.parentOperation)}
          </span>
        )}
      </div>
      <p className="deep-chat-child-objective">{props.child.objective}</p>
      {result && <p className="deep-chat-child-result">{result}</p>}
      <div className="deep-chat-child-actions">
        {props.child.pendingApproval && (
          <ChildNodeApproval
            childRunId={props.child.childRunId}
            pendingApproval={props.child.pendingApproval}
            busy={props.busy}
            onDecision={props.onChildConfirmation}
          />
        )}
        {props.onChildMessage && (
          <ChildNodeFollowup
            childRunId={props.child.childRunId}
            busy={props.busy}
            onSubmit={props.onChildMessage}
          />
        )}
      </div>
    </section>
  );
}

function ChildNodeFollowup(props: {
  readonly childRunId: string;
  readonly busy: boolean;
  readonly onSubmit: NonNullable<DeepViewProps["onChildMessage"]>;
}): React.ReactElement {
  const [message, setMessage] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const trimmed = message.trim();
  if (!expanded) {
    return (
      <button
        type="button"
        className="deep-child-node-followup-toggle"
        disabled={props.busy}
        title="继续这个协作项"
        aria-label="继续这个协作项"
        onClick={() => setExpanded(true)}
      >
        <MessageSquarePlus size={13} aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="deep-child-node-followup">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length === 0 || props.busy) return;
          Promise.resolve(props.onSubmit(props.childRunId, trimmed)).then(() => {
            setMessage("");
            setExpanded(false);
          });
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
          <Send size={12} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function ChildNodeApproval(props: {
  readonly childRunId: string;
  readonly pendingApproval: NonNullable<DeepLiveChildProjection["pendingApproval"]>;
  readonly busy: boolean;
  readonly onDecision?: NonNullable<DeepViewProps["onChildConfirmation"]>;
}): React.ReactElement {
  const [guidance, setGuidance] = React.useState("");
  const trimmedGuidance = guidance.trim();
  const decide = (
    decision: "approve_once" | "deny" | "guidance",
    nextGuidance?: string,
  ): void => {
    if (props.onDecision === undefined || props.busy) return;
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
    <div className="deep-child-node-approval" aria-label="协作项等待确认">
      <div className="deep-child-node-approval-head">
        <span>{props.pendingApproval.title}</span>
        <small>{props.pendingApproval.toolName}</small>
      </div>
      <p>{props.pendingApproval.actionSummary}</p>
      {props.onDecision && (
        <div className="deep-child-node-approval-controls">
          <button type="button" disabled={props.busy} onClick={() => decide("approve_once")}>
            批准
          </button>
          <button type="button" disabled={props.busy} onClick={() => decide("deny")}>
            不执行
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmedGuidance.length === 0) return;
              decide("guidance", trimmedGuidance);
            }}
          >
            <input
              value={guidance}
              onChange={(event) => setGuidance(event.target.value)}
              disabled={props.busy}
              placeholder="补充指导..."
              aria-label="给协作项补充指导"
            />
            <button type="submit" disabled={props.busy || trimmedGuidance.length === 0}>
              发送
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ChildStatusIcon(props: { readonly status: DeepChildRunStatus }): React.ReactElement {
  if (props.status === "completed") {
    return <CheckCircle2 className="deep-child-node-status complete" aria-label="已完成" />;
  }
  if (props.status === "blocked") {
    return <AlertTriangle className="deep-child-node-status blocked" aria-label="受阻" />;
  }
  if (props.status === "failed" || props.status === "interrupted") {
    return <XCircle className="deep-child-node-status problem" aria-label="未完成" />;
  }
  if (props.status === "running" || props.status === "resumed") {
    return <Loader2 className="deep-child-node-status running" aria-label="进行中" />;
  }
  return <CircleDot className="deep-child-node-status pending" aria-label="等待中" />;
}

function DeepBriefDetails(props: {
  readonly brief: NonNullable<DeepRunView["brief"]>;
}): React.ReactElement {
  const { brief } = props;
  return (
    <section className="deep-brief-details" aria-label="计划详情">
      <header className="deep-panel-head">
        <Sparkles className="deep-panel-icon" aria-hidden="true" />
        <h3 className="deep-panel-title">计划详情</h3>
      </header>
      <dl className="deep-brief-detail-list">
        <div>
          <dt>范围</dt>
          <dd>{brief.scopeSummary}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{brief.sourcePolicySummary}</dd>
        </div>
        {brief.plannedAngles.length > 0 && (
          <div>
            <dt>角度</dt>
            <dd>{brief.plannedAngles.join(" / ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function DeepEventTimeline(props: {
  readonly events: readonly DeepStreamEvent[];
  readonly busy: boolean;
}): React.ReactElement {
  const events = props.events.slice(-5);
  return (
    <section className="deep-event-timeline" aria-label="关键事件">
      <header className="deep-panel-head">
        <Clock3 className="deep-panel-icon" aria-hidden="true" />
        <h3 className="deep-panel-title">关键事件</h3>
      </header>
      {events.length === 0 ? (
        <p className="deep-event-empty">{props.busy ? "等待事件返回。" : "暂无事件。"}</p>
      ) : (
        <ol className="deep-event-list">
          {events.map((event) => (
            <li key={event.id} className={`deep-event deep-event-${event.status}`}>
              <span className="deep-event-marker" aria-hidden="true" />
              <div className="deep-event-body">
                <div className="deep-event-head">
                  <span className="deep-event-title">{eventTitle(event)}</span>
                  <span className="deep-event-time">{formatShortTime(event.timestamp)}</span>
                </div>
                <p className="deep-event-summary">{event.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DeepViewPending(props: { readonly pendingGoal?: string }): React.ReactElement {
  const pendingGoal = props.pendingGoal?.trim();
  return (
    <div className="deep-view deep-chat-view deep-view-pending" role="status" aria-live="polite">
      <section className="deep-chat-thread" aria-label="助手回复">
        <div className="deep-chat-live-status" aria-label="多 Agent 当前状态">
          <span className="deep-phase-chip deep-phase-deciding">理解中</span>
          <span className="deep-chat-live-dot">
            <Loader2 aria-hidden="true" />
            实时
          </span>
        </div>
        {pendingGoal && (
          <DeepUserMessage
            item={{
              kind: "user_goal",
              id: "pending-goal",
              text: pendingGoal,
            }}
          />
        )}
      </section>
    </div>
  );
}

function DeepViewEmpty(): React.ReactElement {
  return (
    <div className="deep-view deep-chat-view deep-view-empty">
      <section className="deep-chat-empty-state" aria-label="多 Agent 空状态">
        <HelpCircle size={18} aria-hidden="true" />
        <p>描述一个需要协作处理的目标。</p>
      </section>
    </div>
  );
}

function eventTitle(event: DeepStreamEvent): string {
  switch (event.type) {
    case "deep.goal_received":
      return "已接收目标";
    case "deep.manager.decided":
      return "已规划";
    case "deep.child.started":
      return "探索开始";
    case "deep.child.waiting":
      return "等待探索";
    case "deep.child.instruction_queued":
      return "已追加要求";
    case "deep.child.completed":
      return "探索完成";
    case "deep.child.blocked":
      return "探索受阻";
    case "deep.child.interrupted":
      return "探索中断";
    case "deep.child.failed":
      return "探索失败";
    case "deep.parent_synthesis.completed":
      return "已综合";
    case "deep.interrupted":
      return "运行打断";
    case "deep.corrected":
      return "收到补充";
    case "deep.stopped":
      return "运行停止";
    case "deep.conclusion.produced":
      return "结论生成";
    default:
      return event.title;
  }
}

function compactPhaseLabel(
  phase: DeepLivePhase,
  status: DeepRunStatus,
  childCount: number,
  runningChildCount: number,
): string {
  if (status === "failed") {
    return "运行失败";
  }
  switch (phase) {
    case "starting":
      return "规划中";
    case "deciding":
      return "规划中";
    case "exploring":
      return runningChildCount > 0
        ? `${runningChildCount} 个协作项进行中`
        : `${childCount} 个协作项已安排`;
    case "synthesizing":
      return "综合中";
    case "completed":
      return "已完成";
    case "needs_input":
      return "等待补充";
    case "stopped":
      return "已停止";
    case "failed":
      return "运行失败";
    default:
      return runStatusLabel(status);
  }
}

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

function formatShortTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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

function childFailureText(child: DeepLiveChildProjection): string | undefined {
  if (child.status !== "failed" && child.status !== "interrupted" && child.status !== "blocked") {
    return undefined;
  }
  return child.uncertainty ?? child.summary ?? (child.status === "interrupted" ? "已中断" : child.status === "blocked" ? "等待外部条件" : "任务未完成");
}

function childStateNote(status: DeepChildRunStatus): string | undefined {
  if (status === "planned") {
    return "等待启动";
  }
  if (status === "running" || status === "resumed") {
    return "进行中";
  }
  if (status === "blocked") {
    return "等待外部条件";
  }
  return undefined;
}

function childResultText(child: DeepLiveChildProjection): string | undefined {
  if (child.summary) {
    return child.summary;
  }
  if (child.status === "failed" || child.status === "interrupted" || child.status === "blocked") {
    return childFailureText(child);
  }
  return childStateNote(child.status);
}

function childStatusLabel(status: DeepChildRunStatus): string {
  switch (status) {
    case "planned":
      return "等待";
    case "running":
    case "resumed":
      return "进行中";
    case "blocked":
      return "受阻";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "interrupted":
      return "中断";
    default:
      return status;
  }
}

function parentOperationLabel(
  operation: NonNullable<DeepLiveChildProjection["parentOperation"]>,
): string {
  if (operation.status === "queued") {
    return operation.queuedCount !== undefined && operation.queuedCount > 1
      ? `已追加 ${operation.queuedCount}`
      : "已追加";
  }
  if (operation.status === "cancelled") {
    return "已取消";
  }
  return "已跟进";
}
