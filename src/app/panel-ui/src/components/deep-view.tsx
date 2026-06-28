/**
 * 多 Agent 默认视图。
 *
 * 默认层只把 `/api/deep/*` 的安全 read-model 投影成助手回复流和轻量协作进展；
 * 事件、运行树和长材料不进入默认聊天主线；协作项细节由右侧详情分栏承接。这里不重建运行事实，
 * 也不改普通 agent 主线。
 */
import React from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  HelpCircle,
  Loader2,
  Send,
  User,
  X,
} from "lucide-react";
import type {
  DeepChildAgentRunView,
  DeepConversationView,
  DeepChildRunStatus,
  DeepChildSummaryView,
  DeepConclusionView,
  DeepIntakeStatus,
  DeepIntakeTurn,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepParentSynthesisChildReviewView,
  DeepRunView,
} from "../contracts/deep";

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
  readonly selectedChildRunId?: string;
  readonly childOperationBusyId?: string;
  readonly resynthesisBusy?: boolean;
  readonly onSelectChild?: (childRunId: string) => void;
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
    }
  | {
      readonly kind: "system_notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "waiting" | "problem" | "complete";
    };

export type DeepChildInspectorViewModel = {
  readonly childRunId: string;
  readonly displayName: string;
  readonly status: DeepChildRunStatus;
  readonly objective: string;
  readonly latestResult?: string;
  readonly updatedAt: string;
  readonly workflowItems: readonly DeepLiveChildWorkflowItem[];
  readonly execution?: DeepLiveChildProjection["execution"];
  readonly parentInstructions?: DeepLiveChildProjection["parentInstructions"];
  readonly pendingApproval?: DeepLiveChildProjection["pendingApproval"];
  readonly synthesisReview?: DeepParentSynthesisChildReviewView;
};

export type DeepCollaborationIndexItemViewModel = {
  readonly childRunId: string;
  readonly displayName: string;
  readonly status: DeepChildRunStatus;
  readonly statusLabel: string;
  readonly role: string;
  readonly objective: string;
  readonly latestResult: string;
  readonly selected: boolean;
  readonly active: boolean;
  readonly needsAttention: boolean;
  readonly executionSummary?: string;
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
}): React.ReactElement {
  const { view } = props;
  const items = deepChatItems(view);

  return (
    <div className="deep-view deep-chat-view" data-run-status={view.run.status}>
      <section className="deep-chat-thread" aria-label="助手回复">
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
            />
          );
        })}
      </section>
    </div>
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

export function DeepCollaborationIndex(props: {
  readonly children: readonly DeepLiveChildProjection[];
  readonly selectedChildRunId?: string;
  readonly activeChildRunId?: string;
  readonly runStatusLabel?: string;
  readonly updatedLabel?: string;
  readonly onSelectChild?: (childRunId: string) => void;
}): React.ReactElement | null {
  if (props.children.length === 0) {
    return null;
  }
  const items: DeepCollaborationIndexItemViewModel[] = props.children.map((child) => ({
    childRunId: child.childRunId,
    displayName: displayAgentName(child.displayName),
    status: child.status,
    statusLabel: childStatusLabel(child.status),
    role: child.role,
    objective: child.objective,
    latestResult: childResultText(child) ?? childStatusLabel(child.status),
    selected: props.selectedChildRunId === child.childRunId,
    active: props.activeChildRunId === child.childRunId,
    needsAttention: child.status === "blocked" || child.pendingApproval !== undefined,
    executionSummary: childExecutionSummary(child),
  }));
  return (
    <section className="deep-collaboration-index" aria-label="协作项索引">
      <div className="deep-collaboration-index-head">
        <div className="deep-section-heading">
          <span>协作概览</span>
          <small>{collaborationSummary(props.children)}</small>
        </div>
        {(props.runStatusLabel !== undefined || props.updatedLabel !== undefined) && (
          <div className="deep-collaboration-index-runmeta" aria-label="运行状态">
            {props.runStatusLabel !== undefined && <span>{props.runStatusLabel}</span>}
            {props.updatedLabel !== undefined && <small>{props.updatedLabel}</small>}
          </div>
        )}
      </div>
      <div className="deep-collaboration-index-list">
        {items.map((item) => (
          <button
            type="button"
            key={item.childRunId}
            className={`deep-collaboration-index-item deep-collaboration-${item.status} ${item.selected ? "selected" : ""} ${item.active ? "active" : ""}`}
            aria-pressed={item.selected}
            onClick={() => props.onSelectChild?.(item.childRunId)}
          >
            <span className={`deep-collaboration-index-dot deep-collaboration-dot-${item.status}`} aria-hidden="true" />
            <span className="deep-collaboration-index-copy">
              <span className="deep-collaboration-index-item-head">
                <strong>{item.displayName}</strong>
                <span className={`deep-chat-child-status deep-status-${item.status}`}>{item.statusLabel}</span>
              </span>
              <span className="deep-collaboration-index-role">{item.role}</span>
              <span className="deep-collaboration-index-result">{item.latestResult}</span>
              <span className="deep-collaboration-index-objective">{item.objective}</span>
              <span className="deep-collaboration-index-meta">
                {item.executionSummary && <small>{item.executionSummary}</small>}
                {item.needsAttention && <small className="attention">待处理</small>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
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

function DeepViewPending(props: { readonly pendingGoal?: string }): React.ReactElement {
  const pendingGoal = props.pendingGoal?.trim();
  return (
    <div className="deep-view deep-chat-view deep-view-pending" role="status" aria-live="polite">
      <section className="deep-chat-thread" aria-label="助手回复">
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
  if (child.latestResult) {
    return child.latestResult;
  }
  if (child.summary) {
    return child.summary;
  }
  if (child.status === "failed" || child.status === "interrupted" || child.status === "blocked") {
    return childFailureText(child);
  }
  return childStateNote(child.status);
}

function childExecutionSummary(child: DeepLiveChildProjection): string | undefined {
  const execution = child.execution;
  if (execution === undefined) {
    return undefined;
  }
  return `模型 ${execution.modelRounds} / 工具 ${execution.toolRounds}`;
}

function collaborationSummary(children: readonly DeepLiveChildProjection[]): string {
  const running = children.filter((child) => child.status === "running" || child.status === "resumed").length;
  const blocked = children.filter((child) => child.status === "blocked" || child.pendingApproval !== undefined).length;
  const completed = children.filter((child) => child.status === "completed").length;
  if (blocked > 0) {
    return `${blocked} 项待处理 / 共 ${children.length} 项`;
  }
  if (running > 0) {
    return `${running} 项进行中 / 共 ${children.length} 项`;
  }
  return `${completed} 项已返回 / 共 ${children.length} 项`;
}

function runStatusLabel(status: DeepRunView["run"]["status"]): string {
  switch (status) {
    case "pending":
      return "待启动";
    case "running":
      return "运行中";
    case "interrupted":
      return "已打断";
    case "corrected":
      return "已修正";
    case "stopped":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
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

function workflowItemStatusLabel(status: DeepLiveChildWorkflowItem["status"]): string {
  switch (status) {
    case "pending":
      return "等待";
    case "running":
      return "进行中";
    case "completed":
      return "完成";
    case "blocked":
      return "待处理";
    case "failed":
      return "失败";
    case "interrupted":
      return "中断";
    case "cancelled":
      return "取消";
    default:
      return status;
  }
}

function workflowItemTone(status: DeepLiveChildWorkflowItem["status"]): "active" | "complete" | "waiting" | "problem" {
  switch (status) {
    case "running":
      return "active";
    case "blocked":
    case "pending":
      return "waiting";
    case "failed":
    case "interrupted":
    case "cancelled":
      return "problem";
    case "completed":
    default:
      return "complete";
  }
}

function childInspectorViewModel(
  view: DeepRunView,
  childRunId: string | undefined,
): DeepChildInspectorViewModel | undefined {
  if (childRunId === undefined) {
    return undefined;
  }
  const liveChild = view.liveProjection.children.find((child) => child.childRunId === childRunId);
  const childRun = view.report?.agentRunTree.childRuns.find((child) => child.childRunId === childRunId);
  const childSummary = view.report?.childSummaries.find((child) => child.childRunId === childRunId);
  if (liveChild === undefined && childRun === undefined && childSummary === undefined) {
    return undefined;
  }
  const synthesisReview = view.report?.synthesisRecords
    .flatMap((record) => record.childReviews ?? [])
    .find((review) => review.childRunId === childRunId);
  return {
    childRunId,
    displayName: liveChild?.displayName ?? childRun?.spec.displayName ?? childSummary?.spec.displayName ?? `协作项 ${childRunId}`,
    status: liveChild?.status ?? childRun?.status ?? childSummary?.status ?? "planned",
    objective: liveChild?.objective ?? childRun?.spec.instructions?.objective ?? childSummary?.spec.objective ?? "",
    latestResult: liveChild?.latestResult ?? liveChild?.summary ?? childSummary?.summary,
    updatedAt: liveChild?.updatedAt ?? childRun?.completedAt ?? childRun?.startedAt ?? view.liveProjection.updatedAt,
    workflowItems: liveChild?.workflowItems ?? childSummaryWorkflowItems(childRun, childSummary, view.liveProjection.updatedAt),
    execution: liveChild?.execution ?? childRunExecutionProjection(childRun),
    parentInstructions: liveChild?.parentInstructions ?? childRunParentInstructionProjection(childRun),
    pendingApproval: liveChild?.pendingApproval ?? childRun?.pendingApproval,
    synthesisReview,
  };
}

function childSummaryWorkflowItems(
  childRun: DeepChildAgentRunView | undefined,
  childSummary: DeepChildSummaryView | undefined,
  updatedAt: string,
): readonly DeepLiveChildWorkflowItem[] {
  if (childRun === undefined && childSummary === undefined) {
    return [];
  }
  const childRunId = childRun?.childRunId ?? childSummary?.childRunId ?? "child";
  const objective = childRun?.spec.instructions?.objective ?? childSummary?.spec.objective ?? "";
  const summary = childSummary?.summary;
  return [
    {
      itemId: `objective:${childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: objective,
      status: "completed",
      timestamp: childRun?.startedAt ?? updatedAt,
    },
    {
      itemId: `status:${childRunId}:${childRun?.status ?? childSummary?.status ?? "completed"}`,
      kind: childRun?.status === "blocked" || childRun?.status === "failed" || childRun?.status === "interrupted"
        ? childRun.status
        : "completed",
      title: childRun?.status === "blocked" ? "等待处理" : childRun?.status === "failed" ? "未完成" : "结果已返回",
      detail: childRun?.failureReason ?? summary,
      status: childRun?.status === "blocked" || childRun?.status === "failed" || childRun?.status === "interrupted"
        ? childRun.status
        : "completed",
      timestamp: childRun?.completedAt ?? updatedAt,
    },
  ];
}

function childRunExecutionProjection(
  childRun: DeepChildAgentRunView | undefined,
): DeepChildInspectorViewModel["execution"] {
  if (childRun === undefined) {
    return undefined;
  }
  const latest = childRun.executionHistory?.at(-1);
  const execution = latest ?? childRun.execution;
  if (execution === undefined) {
    return undefined;
  }
  return {
    modelRounds: execution.modelRounds,
    toolRounds: execution.toolRounds,
    segmentCount: childRun.executionHistory?.length ?? 1,
    latestOutcome: latest?.outcome,
  };
}

function childRunParentInstructionProjection(
  childRun: DeepChildAgentRunView | undefined,
): DeepChildInspectorViewModel["parentInstructions"] {
  return childRun?.parentInstructions;
}

export function DeepChildInspector(props: {
  readonly view: DeepRunView;
  readonly selectedChildRunId?: string;
  readonly busy: boolean;
  readonly childOperationBusyId?: string;
  readonly onClose: () => void;
  readonly onChildMessage?: DeepViewProps["onChildMessage"];
  readonly onChildConfirmation?: DeepViewProps["onChildConfirmation"];
}): React.ReactElement | null {
  const model = childInspectorViewModel(props.view, props.selectedChildRunId);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    setMessage("");
  }, [props.selectedChildRunId]);
  if (model === undefined) {
    return null;
  }
  const childBusy = props.childOperationBusyId === model.childRunId;
  const trimmed = message.trim();
  return (
    <aside className="deep-child-inspector" aria-label="协作项详情">
      <div className="deep-child-inspector-inner">
        <header className="deep-child-inspector-header">
          <div className="deep-child-inspector-title">
            <span className="deep-child-inspector-kicker">协作项详情</span>
            <h2>{displayAgentName(model.displayName)}</h2>
          </div>
          <div className="deep-child-inspector-meta">
            <span className={`deep-chat-child-status deep-status-${model.status}`}>{childStatusLabel(model.status)}</span>
            <button
              type="button"
              className="deep-child-inspector-close"
              onClick={props.onClose}
              aria-label="关闭协作项详情"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="deep-child-inspector-scrollbody">
          <div className="deep-child-inspector-summary">
            <div className="deep-child-inspector-section">
              <span className="deep-child-inspector-label">目标</span>
              <p>{model.objective}</p>
            </div>

            {model.latestResult && (
              <div className="deep-child-inspector-section">
                <span className="deep-child-inspector-label">当前结果</span>
                <p>{model.latestResult}</p>
              </div>
            )}

            <div className="deep-child-inspector-section">
              <span className="deep-child-inspector-label">更新时间</span>
              <p>{formatShortTime(model.updatedAt)}</p>
            </div>
          </div>

          {model.execution && (
            <div className="deep-child-inspector-metrics" aria-label="执行统计">
              <div>
                <span>模型轮次</span>
                <strong>{model.execution.modelRounds}</strong>
              </div>
              <div>
                <span>工具轮次</span>
                <strong>{model.execution.toolRounds}</strong>
              </div>
              <div>
                <span>执行段</span>
                <strong>{model.execution.segmentCount}</strong>
              </div>
            </div>
          )}

          <section className="deep-child-inspector-timeline" aria-label="协作项工作流程">
            <h3>工作流程</h3>
            <ol className="deep-child-inspector-timeline-list">
              {model.workflowItems.map((item) => (
                <li key={item.itemId} className={`deep-child-inspector-timeline-item deep-child-inspector-${workflowItemTone(item.status)}`}>
                  <span className="deep-child-inspector-timeline-marker" aria-hidden="true">
                    {workflowItemTone(item.status) === "active" ? (
                      <Loader2 />
                    ) : workflowItemTone(item.status) === "complete" ? (
                      <CheckCircle2 />
                    ) : workflowItemTone(item.status) === "problem" ? (
                      <AlertTriangle />
                    ) : (
                      <Clock3 />
                    )}
                  </span>
                  <div className="deep-child-inspector-timeline-copy">
                    <div className="deep-child-inspector-timeline-head">
                      <span>{item.title}</span>
                      <small>{workflowItemStatusLabel(item.status)}</small>
                    </div>
                    {item.detail && <p>{item.detail}</p>}
                    <time>{formatShortTime(item.timestamp)}</time>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {model.synthesisReview && (
            <div className="deep-child-inspector-section">
              <span className="deep-child-inspector-label">综合采纳</span>
              <p>{synthesisReviewLabel(model.synthesisReview)}</p>
            </div>
          )}

          {model.parentInstructions && model.parentInstructions.length > 0 && (
            <section className="deep-child-inspector-section" aria-label="跟进记录">
              <span className="deep-child-inspector-label">跟进记录</span>
              <ul className="deep-child-inspector-followups">
                {model.parentInstructions.map((instruction) => (
                  <li key={instruction.instructionId}>
                    <div>
                      <strong>{instruction.instructionSummary}</strong>
                      <span>{workflowItemStatusLabel(instruction.status === "queued" ? "pending" : instruction.status === "cancelled" ? "cancelled" : "completed")}</span>
                    </div>
                    {instruction.review && <p>{instruction.review.reason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {(model.pendingApproval && props.onChildConfirmation || props.onChildMessage) && (
          <div className="deep-child-inspector-actionbar">
            {model.pendingApproval && props.onChildConfirmation && (
              <ChildNodeApproval
                childRunId={model.childRunId}
                pendingApproval={model.pendingApproval}
                busy={childBusy}
                onDecision={props.onChildConfirmation}
              />
            )}

            {props.onChildMessage && (
              <form
                className="deep-child-inspector-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (trimmed.length === 0 || childBusy) return;
                  Promise.resolve(props.onChildMessage?.(model.childRunId, trimmed)).then(() => setMessage(""));
                }}
              >
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={childBusy}
                  placeholder="补充给这个协作项..."
                  aria-label="补充给这个协作项"
                />
                <button type="submit" disabled={childBusy || trimmed.length === 0}>
                  <Send size={13} aria-hidden="true" />
                  <span>继续</span>
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function synthesisReviewLabel(review: DeepParentSynthesisChildReviewView): string {
  if (review.decision === "accepted") {
    return `已采纳：${review.reason}`;
  }
  if (review.decision === "rejected") {
    return `未采纳：${review.reason}`;
  }
  return `待继续跟进：${review.reason}`;
}
