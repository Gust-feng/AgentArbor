/**
 * 多 Agent 默认视图。
 *
 * 默认层只把 `/api/deep/*` 的 read-model 投影成入口计划、父 Agent 工作流和点击详情；
 * 不重建运行事实，不引入流程图式运行树，也不改普通 agent 主线。
 */
import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  Send,
} from "lucide-react";
import type { AgentWorkTimelineView } from "../../../panel-agent-work-timeline-view";
import { splitConversationTurnsAroundRun } from "../../../panel-ui-deep-transcript";
import {
  displayActivityItemsForNodes,
  type ActivityBadge,
  type ActivityExpandedSection,
  type ActivityItem,
} from "../../../panel-transcript-activity-copy";
import type {
  DeepChildAgentRunParentInstructionView,
  DeepChildAgentRunPendingApprovalView,
  DeepChildAgentRunModelMessageTraceView,
  DeepChildAgentRunToolCallTraceView,
  DeepChildAgentRunExecutionView,
  DeepChildAgentRunExecutionSegmentView,
  DeepChildAgentRunView,
  DeepConversationView,
  DeepChildRunStatus,
  DeepChildSummaryView,
  DeepConclusionView,
  DeepIntakeStatus,
  DeepIntakeTurn,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepLiveDecisionProjection,
  DeepParentSynthesisChildReviewView,
  DeepRunFollowUpTurn,
  DeepRunView,
} from "../contracts/deep";
import type { TranscriptNode } from "../contracts/run";
import { RichText } from "./rich-text";
import { AssistantMessageLabel } from "./assistant-message-label";
import type { AssistantModelBadge } from "./chat-session-projection";
import { AgentWorkTimeline, type ConfirmationProjection } from "./transcript-timeline";

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
  readonly assistantModel?: AssistantModelBadge;
  readonly selectedWorkItem?: DeepSelectedWorkItem;
  readonly onSelectWorkItem?: (item: DeepSelectedWorkItem) => void;
  readonly onStartConfirmedRun?: (input: {
    readonly intakeTurnId?: string;
    readonly confirmedObjective: string;
    readonly confirmedPlan: string;
  }) => void | Promise<void>;
  readonly resynthesisBusy?: boolean;
  readonly onResynthesize?: () => void | Promise<void>;
  readonly onStopRun?: () => void | Promise<void>;
};

type DeepChildMessageHandler = (childRunId: string, message: string) => void | Promise<void>;

type DeepChildConfirmationHandler = (
  childRunId: string,
  confirmationId: string,
  decision: "approve_once" | "deny" | "guidance",
  guidance?: string,
) => void | Promise<void>;

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

type DeepTaskPlanItemViewModel = {
  readonly itemId: string;
  readonly kind: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly timestamp: string;
};

export type DeepSelectedWorkItem = {
  readonly kind: "manager_step" | "child_agent" | "synthesis" | "conclusion";
  readonly id: string;
};

export type DeepPlanConfirmationViewModel = {
  readonly intakeTurnId: string;
  readonly objective: string;
  readonly plan: string;
  readonly assistantMessage: string;
};

export type DeepRunTranscriptViewModel = {
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly blocks: readonly DeepRunTranscriptBlock[];
  readonly planInsertIndex: number;
  readonly planConfirmation?: DeepPlanConfirmationViewModel;
  readonly workflowItems: readonly DeepTaskPlanItemViewModel[];
  readonly children: readonly DeepRunChildSummaryViewModel[];
};

export type DeepRunTranscriptBlock =
  | {
      readonly kind: "user_goal";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "assistant_text";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly tone: "current" | "waiting" | "problem" | "complete";
    }
  | {
      readonly kind: "conclusion";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly stale: boolean;
      readonly staleMessage?: string;
    }
  | {
      readonly kind: "child_agent_list";
      readonly id: string;
      readonly children: readonly DeepRunChildSummaryViewModel[];
      readonly status: DeepLiveChildWorkflowItem["status"];
    }
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "waiting" | "problem" | "complete";
    };

export type DeepWorkItemDetailViewModel = {
  readonly kind: DeepSelectedWorkItem["kind"];
  readonly detailId: string;
  readonly title: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly summary: string;
  readonly workflowItems: readonly DeepLiveChildWorkflowItem[];
  readonly worklineItems: readonly DeepWorklineItemViewModel[];
  readonly child?: DeepRunChildSummaryViewModel;
};

type DeepWorklineItemViewModel = {
  readonly itemId: string;
  readonly title: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly timestamp: string;
  readonly tone: ActivityItem["tone"];
  readonly phase: ActivityItem["phase"];
  readonly toolKind?: ActivityItem["toolKind"];
  readonly badges?: readonly ActivityBadge[];
  readonly expandedSections?: readonly ActivityExpandedSection[];
};

type DeepRuntimeHealthNoticeViewModel = {
  readonly state: "stalled" | "orphaned";
  readonly text: string;
  readonly canStop: boolean;
};

type DeepChildAgentWorkflowSegment =
  | {
      readonly kind: "model";
      readonly segmentId: string;
      readonly text: string;
      readonly tone: "thinking" | "narration" | "system";
    }
  | {
      readonly kind: "activity";
      readonly segmentId: string;
      readonly items: readonly DeepWorklineItemViewModel[];
      readonly lifecycle: "open" | "settled" | "attention";
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
          assistantModel={props.assistantModel}
          onStartConfirmedRun={props.onStartConfirmedRun}
        />
      );
    }
    if (props.busy) {
      return <DeepViewPending pendingGoal={props.pendingGoal} />;
    }
    return <DeepViewEmpty />;
  }
  return (
    <DeepRunTranscriptPane
      view={props.view}
      conversation={props.conversation}
      intakeStatus={props.intakeStatus}
      busy={props.busy}
      pendingGoal={props.pendingGoal}
      assistantModel={props.assistantModel}
      resynthesisBusy={props.resynthesisBusy}
      selectedWorkItem={props.selectedWorkItem}
      onSelectWorkItem={props.onSelectWorkItem}
      onStartConfirmedRun={props.onStartConfirmedRun}
      onResynthesize={props.onResynthesize}
      onStopRun={props.onStopRun}
    />
  );
}

function DeepIntakeChatView(props: {
  readonly conversation: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  readonly busy: boolean;
  readonly pendingGoal?: string;
  readonly assistantModel?: AssistantModelBadge;
  readonly onStartConfirmedRun?: DeepViewProps["onStartConfirmedRun"];
}): React.ReactElement {
  const items = deepIntakeChatItems(props.conversation.intakeTurns, props.intakeStatus);
  const plan = deepPlanConfirmationViewModel(props.conversation, props.intakeStatus);
  const pendingGoal = props.pendingGoal?.trim();
  return (
    <div className="deep-view deep-chat-view deep-intake-chat-view chat-active-screen">
      <div className="chat-active-scroll">
        <div className="chat-active-grid">
          <section className="deep-chat-thread session-stream" aria-label="助手回复">
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
                  assistantModel={props.assistantModel}
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
            {plan !== undefined && (
              <DeepPlanConfirmationCard
                model={plan}
                busy={props.busy}
                onStart={props.onStartConfirmedRun}
              />
            )}
          </section>
        </div>
      </div>
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
    const assistantTexts = [
      turn.assistantMessage,
      turn.action === "start_collaboration" && turn.plan !== undefined && intakeStatus !== "plan_ready"
        ? turn.plan
        : undefined,
    ].filter((text): text is string => text !== undefined && text.trim().length > 0);
    items.push({
      kind: "parent_message",
      id: `intake-assistant:${turn.turnId}`,
      label: "助手",
      text: assistantTexts.join("\n\n"),
      tone:
        turn.action === "ask_user"
          ? "waiting"
          : turn.action === "direct_answer"
            ? "complete"
            : intakeStatus === "running"
              ? "current"
              : "complete",
    });
  }
  return items;
}

function deepPlanConfirmationViewModel(
  conversation: DeepConversationView,
  intakeStatus: DeepIntakeStatus | undefined,
): DeepPlanConfirmationViewModel | undefined {
  if (intakeStatus !== "plan_ready") {
    return undefined;
  }
  const turn = [...conversation.intakeTurns].reverse().find(
    (item) => item.action === "start_collaboration" && item.plan !== undefined,
  );
  if (turn === undefined || turn.plan === undefined) {
    return undefined;
  }
  return {
    intakeTurnId: turn.turnId,
    objective: turn.normalizedObjective ?? conversation.currentObjective ?? conversation.goal,
    plan: turn.plan,
    assistantMessage: turn.assistantMessage,
  };
}

function DeepPlanConfirmationCard(props: {
  readonly model: DeepPlanConfirmationViewModel;
  readonly busy: boolean;
  readonly onStart?: DeepViewProps["onStartConfirmedRun"];
}): React.ReactElement {
  const [objective, setObjective] = React.useState(props.model.objective);
  const [plan, setPlan] = React.useState(props.model.plan);
  React.useEffect(() => {
    setObjective(props.model.objective);
    setPlan(props.model.plan);
  }, [props.model.intakeTurnId, props.model.objective, props.model.plan]);
  const trimmedObjective = objective.trim();
  const trimmedPlan = plan.trim();
  return (
    <section className="deep-plan-confirmation" aria-label="计划确认">
      <div className="deep-plan-confirmation-head">
        <span>计划</span>
        <h2>确认后开始深度研究</h2>
      </div>
      <p>{props.model.assistantMessage}</p>
      <label>
        <span>主题</span>
        <input
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          disabled={props.busy}
        />
      </label>
      <label>
        <span>计划</span>
        <textarea
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          disabled={props.busy}
          rows={5}
        />
      </label>
      <div className="deep-plan-confirmation-actions">
        <button
          type="button"
          disabled={props.busy || trimmedObjective.length === 0 || trimmedPlan.length === 0}
          onClick={() => props.onStart?.({
            intakeTurnId: props.model.intakeTurnId,
            confirmedObjective: trimmedObjective,
            confirmedPlan: trimmedPlan,
          })}
        >
          开始深度研究
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            setObjective(props.model.objective);
            setPlan(props.model.plan);
          }}
        >
          重置计划
        </button>
      </div>
    </section>
  );
}

function DeepRunTranscriptPane(props: {
  readonly view: DeepRunView;
  readonly conversation?: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  readonly busy: boolean;
  readonly pendingGoal?: string;
  readonly assistantModel?: AssistantModelBadge;
  readonly resynthesisBusy?: boolean;
  readonly selectedWorkItem?: DeepSelectedWorkItem;
  readonly onSelectWorkItem?: (item: DeepSelectedWorkItem) => void;
  readonly onStartConfirmedRun?: DeepViewProps["onStartConfirmedRun"];
  readonly onResynthesize?: () => void | Promise<void>;
  readonly onStopRun?: () => void | Promise<void>;
}): React.ReactElement {
  const { view } = props;
  const model = deepRunTranscriptViewModel(view, props.conversation, props.intakeStatus, props.pendingGoal);
  const planBusy = props.busy || props.resynthesisBusy === true;
  const runtimeNotice = runtimeHealthNoticeViewModel(view);

  return (
    <div className="deep-view deep-run-transcript chat-active-screen" data-run-status={view.run.status}>
      <div className="chat-active-scroll">
        <div className="chat-active-grid">
          <section className="deep-run-transcript-thread session-stream" aria-label="助手回复">
            {model.blocks.map((block, index) => {
              if (block.kind === "user_goal") {
                return (
                  <React.Fragment key={block.id}>
                    {index === model.planInsertIndex && model.planConfirmation !== undefined && (
                      <DeepPlanConfirmationCard
                        model={model.planConfirmation}
                        busy={planBusy}
                        onStart={props.onStartConfirmedRun}
                      />
                    )}
                    <DeepUserMessage item={block} />
                  </React.Fragment>
                );
              }
              if (block.kind === "notice") {
                return (
                  <React.Fragment key={block.id}>
                    {index === model.planInsertIndex && model.planConfirmation !== undefined && (
                      <DeepPlanConfirmationCard
                        model={model.planConfirmation}
                        busy={planBusy}
                        onStart={props.onStartConfirmedRun}
                      />
                    )}
                    <DeepSystemNotice item={block} />
                  </React.Fragment>
                );
              }
              if (block.kind === "child_agent_list") {
                return (
                  <React.Fragment key={block.id}>
                    {index === model.planInsertIndex && model.planConfirmation !== undefined && (
                      <DeepPlanConfirmationCard
                        model={model.planConfirmation}
                        busy={planBusy}
                        onStart={props.onStartConfirmedRun}
                      />
                    )}
                    <DeepRunTranscriptChildListBlock
                      assistantModel={props.assistantModel}
                      block={block}
                      selectedWorkItem={props.selectedWorkItem}
                      onSelectWorkItem={props.onSelectWorkItem}
                    />
                  </React.Fragment>
                );
              }
              if (block.kind === "conclusion") {
                return (
                  <React.Fragment key={block.id}>
                    {index === model.planInsertIndex && model.planConfirmation !== undefined && (
                      <DeepPlanConfirmationCard
                        model={model.planConfirmation}
                        busy={planBusy}
                        onStart={props.onStartConfirmedRun}
                      />
                    )}
                    <DeepConclusionMessage
                      assistantModel={props.assistantModel}
                      item={block}
                      busy={props.resynthesisBusy === true}
                      onResynthesize={props.onResynthesize}
                    />
                  </React.Fragment>
                );
              }
              return (
                <React.Fragment key={block.id}>
                  {index === model.planInsertIndex && model.planConfirmation !== undefined && (
                    <DeepPlanConfirmationCard
                      model={model.planConfirmation}
                      busy={planBusy}
                      onStart={props.onStartConfirmedRun}
                    />
                  )}
                  <DeepParentMessage assistantModel={props.assistantModel} item={block} />
                </React.Fragment>
              );
            })}
            {model.planConfirmation !== undefined && model.planInsertIndex === model.blocks.length && (
              <DeepPlanConfirmationCard
                model={model.planConfirmation}
                busy={planBusy}
                onStart={props.onStartConfirmedRun}
              />
            )}
            {runtimeNotice !== undefined && (
              <DeepRuntimeHealthNotice
                notice={runtimeNotice}
                onStopRun={props.onStopRun}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function DeepRunTranscriptChildListBlock(props: {
  readonly assistantModel?: AssistantModelBadge;
  readonly block: Extract<DeepRunTranscriptBlock, { readonly kind: "child_agent_list" }>;
  readonly selectedWorkItem?: DeepSelectedWorkItem;
  readonly onSelectWorkItem?: (item: DeepSelectedWorkItem) => void;
}): React.ReactElement {
  const selectedChildId = props.selectedWorkItem?.kind === "child_agent"
    ? props.selectedWorkItem.id
    : undefined;
  return (
    <article className="assistant-message deep-run-child-list-block">
      <AssistantMessageLabel model={props.assistantModel} fallbackLabel="助手" />
      <div className="assistant-message-body">
        <div className="deep-run-child-list" role="list" aria-label="协作项">
          {props.block.children.map((child) => {
            const selected = selectedChildId === child.childRunId;
            const signal = childAgentImportantSignal(child);
            const statusLabel = visibleWorkflowStatusLabel(child.status);
            return (
              <div className="deep-run-child-list-entry" role="listitem" key={child.childRunId}>
                <button
                  type="button"
                  className="deep-run-child-list-item"
                  data-status={child.status}
                  data-selected={selected ? "true" : undefined}
                  data-attention={child.needsAttention ? "true" : undefined}
                  aria-pressed={selected}
                  onClick={() => props.onSelectWorkItem?.({ kind: "child_agent", id: child.childRunId })}
                >
                  <span className="deep-run-child-list-head">
                    <span className="deep-run-child-list-title">{child.title}</span>
                    {statusLabel !== undefined && (
                      <span className={`deep-chat-child-status deep-status-${child.status}`}>
                        {statusLabel}
                      </span>
                    )}
                  </span>
                  {child.objective.trim().length > 0 && (
                    <span className="deep-run-child-list-objective">
                      {compactWorklineText(child.objective, 150)}
                    </span>
                  )}
                  {signal !== undefined && (
                    <span className="deep-run-child-list-signal">{signal}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function parentDecisionText(view: DeepRunView): string | undefined {
  return view.liveProjection.decision?.summary;
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

function conclusionNeedsResynthesis(view: DeepRunView, conclusionText: string | undefined): boolean {
  return conclusionText !== undefined && view.liveProjection.synthesis?.status === "pending";
}

function parentNotice(
  view: DeepRunView,
): Extract<DeepChatItem, { readonly kind: "system_notice" }> | undefined {
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

function runtimeHealthNoticeViewModel(
  view: DeepRunView,
): DeepRuntimeHealthNoticeViewModel | undefined {
  const health = view.run.runtimeHealth;
  if (health?.state !== "stalled" && health?.state !== "orphaned") {
    return undefined;
  }
  const lastActivity = formatRuntimeHealthLastActivity(health.lastActivityAt);
  return {
    state: health.state,
    text: health.state === "stalled"
      ? `这次运行一段时间没有新进展，最后活动 ${lastActivity}。`
      : `这次运行已失联，最后活动 ${lastActivity}。`,
    canStop: health.canStop,
  };
}

function formatRuntimeHealthLastActivity(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "时间未知";
  }
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 60 * 60_000) {
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeepUserMessage(props: {
  readonly item: { readonly kind?: string; readonly id: string; readonly text: string };
}): React.ReactElement {
  return (
    <article className="user-message">
      <div className="user-message-wrap">
        <div className="user-message-content">
          <RichText text={props.item.text} />
        </div>
      </div>
    </article>
  );
}

function DeepParentMessage(props: {
  readonly assistantModel?: AssistantModelBadge;
  readonly item: {
    readonly id: string;
    readonly label: string;
    readonly text: string;
    readonly tone: "current" | "complete" | "waiting" | "problem";
  };
}): React.ReactElement {
  return (
    <article className="assistant-message assistant-workline">
      <AssistantMessageLabel model={props.assistantModel} fallbackLabel={props.item.label} />
      <div className="assistant-message-body">
        <div className="assistant-answer">
          <RichText text={props.item.text} />
        </div>
      </div>
    </article>
  );
}

function DeepConclusionMessage(props: {
  readonly assistantModel?: AssistantModelBadge;
  readonly item: Extract<DeepRunTranscriptBlock, { readonly kind: "conclusion" }>;
  readonly busy: boolean;
  readonly onResynthesize?: () => void | Promise<void>;
}): React.ReactElement {
  const showResynthesize = props.item.stale && props.onResynthesize !== undefined;
  return (
    <article className="assistant-message assistant-workline">
      <AssistantMessageLabel model={props.assistantModel} fallbackLabel={props.item.label} />
      <div className="assistant-message-body">
        <div className={`deep-compact-conclusion ${props.item.stale ? "needs-resynthesis" : ""}`}>
          <CheckCircle2 className="deep-compact-conclusion-icon" size={20} aria-hidden="true" />
          <div className="deep-compact-conclusion-copy">
            <span className="deep-compact-conclusion-label">综合结论</span>
            <RichText text={props.item.text} />
            {props.item.staleMessage && (
              <p className="deep-compact-conclusion-note">{props.item.staleMessage}</p>
            )}
          </div>
        </div>
        {showResynthesize && (
          <div className="deep-compact-conclusion-actions">
            <button
              type="button"
              disabled={props.busy}
              onClick={() => {
                void props.onResynthesize?.();
              }}
            >
              {props.busy ? "重新综合中..." : "重新综合"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function DeepSystemNotice(props: {
  readonly item: {
    readonly id: string;
    readonly text: string;
    readonly tone: "waiting" | "problem" | "complete";
  };
}): React.ReactElement {
  const Icon = props.item.tone === "problem" ? AlertTriangle : props.item.tone === "complete" ? CheckCircle2 : Clock3;
  return (
    <div className={`deep-chat-system-notice deep-chat-system-${props.item.tone}`} role="status">
      <Icon size={14} aria-hidden="true" />
      <span>{props.item.text}</span>
    </div>
  );
}

function DeepRuntimeHealthNotice(props: {
  readonly notice: DeepRuntimeHealthNoticeViewModel;
  readonly onStopRun?: () => void | Promise<void>;
}): React.ReactElement {
  return (
    <div className={`deep-chat-system-notice deep-chat-system-problem deep-runtime-health-notice deep-runtime-health-${props.notice.state}`} role="status">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>{props.notice.text}</span>
      {props.notice.canStop && props.onStopRun !== undefined && (
        <button
          type="button"
          onClick={() => {
            void props.onStopRun?.();
          }}
        >
          停止本次运行
        </button>
      )}
    </div>
  );
}

function childAgentSummaryItems(view: DeepRunView): readonly DeepRunChildSummaryViewModel[] {
  const childRunIds = new Set<string>();
  for (const liveChild of view.liveProjection.children) {
    childRunIds.add(liveChild.childRunId);
  }
  for (const childRun of view.report?.agentRunTree.childRuns ?? []) {
    childRunIds.add(childRun.childRunId);
  }
  for (const childSummary of view.report?.childSummaries ?? []) {
    childRunIds.add(childSummary.childRunId);
  }
  return [...childRunIds].map((childRunId) => childAgentSummaryItem(view, childRunId));
}

function ChildTaskApproval(props: {
  readonly childRunId: string;
  readonly pendingApproval: NonNullable<DeepLiveChildProjection["pendingApproval"]>;
  readonly busy: boolean;
  readonly onDecision?: DeepChildConfirmationHandler;
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
    <div className="deep-child-task-approval" aria-label="协作项等待确认">
      <div className="deep-child-task-approval-head">
        <span>{props.pendingApproval.title}</span>
        <small>{props.pendingApproval.toolName}</small>
      </div>
      <p>{props.pendingApproval.actionSummary}</p>
      {props.onDecision && (
        <div className="deep-child-task-approval-controls">
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
    <div className="deep-view deep-chat-view deep-view-pending chat-active-screen" role="status" aria-live="polite">
      <div className="chat-active-scroll">
        <div className="chat-active-grid">
          <section className="deep-chat-thread session-stream" aria-label="助手回复">
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
      </div>
    </div>
  );
}

function DeepViewEmpty(): React.ReactElement {
  return (
    <div className="deep-view deep-chat-view deep-view-empty">
      <section className="deep-chat-empty-state" aria-label="Agent 集群空状态">
        <HelpCircle size={18} aria-hidden="true" />
        <p>描述一个需要协作处理的目标。</p>
      </section>
    </div>
  );
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

function visibleWorkflowStatusLabel(status: DeepLiveChildWorkflowItem["status"]): string | undefined {
  if (status === "failed" || status === "blocked" || status === "interrupted" || status === "cancelled") {
    return workflowItemStatusLabel(status);
  }
  return undefined;
}

function meaningfulChildResultText(value: string | undefined, objective?: string): string | undefined {
  const text = value?.trim();
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  if (isNaturalChildStateText(text)) {
    return undefined;
  }
  const objectiveText = objective?.trim();
  if (objectiveText !== undefined && objectiveText.length > 0 && normalizeChildText(text) === normalizeChildText(objectiveText)) {
    return undefined;
  }
  return text;
}

function isNaturalChildStateText(value: string): boolean {
  const normalized = normalizeChildText(value);
  return normalized === "等待启动" ||
    normalized === "等待确认" ||
    normalized === "等待工具确认" ||
    normalized === "等待处理" ||
    normalized === "等待外部条件" ||
    normalized === "进行中" ||
    normalized === "正在探索" ||
    normalized === "结果已返回" ||
    normalized === "已产生执行结果" ||
    normalized === "已中断" ||
    normalized === "未完成" ||
    normalized === "执行未完成" ||
    normalized === "状态更新" ||
    normalized === "完成";
}

function normalizeChildText(value: string): string {
  return value.replace(/\s+/g, "");
}

function childAgentSummaryItem(
  view: DeepRunView,
  childRunId: string,
): DeepRunChildSummaryViewModel {
  const liveChild = view.liveProjection.children.find((child) => child.childRunId === childRunId);
  const childRun = view.report?.agentRunTree.childRuns.find((child) => child.childRunId === childRunId);
  const childSummary = view.report?.childSummaries.find((child) => child.childRunId === childRunId);
  const synthesisReview = view.report?.synthesisRecords
    .flatMap((record) => record.childReviews ?? [])
    .find((review) => review.childRunId === childRunId);
  const status = liveChild?.status ?? childRun?.status ?? childSummary?.status ?? "planned";
  const objective = liveChild?.objective ?? childRun?.spec.instructions?.objective ?? childSummary?.spec.objective ?? "";
  const latestResult = meaningfulChildResultText(liveChild?.latestResult ?? liveChild?.summary ?? childSummary?.summary, objective);
  const findings = childSummary?.findings ?? [];
  const evidenceRefs = childSummary?.evidenceRefs ?? childRun?.evidenceRefs ?? [];
  const uncertainty = liveChild?.uncertainty ?? childSummary?.uncertainty ?? childRun?.uncertainty;
  const confidence = liveChild?.confidence ?? childSummary?.confidence ?? childRun?.confidence;
  const pendingApproval = liveChild?.pendingApproval ?? childRun?.pendingApproval;
  const workflowItems = liveChild?.workflowItems ?? childSummaryWorkflowItems(childRun, childSummary, view.liveProjection.updatedAt);
  const title = displayAgentName(liveChild?.displayName ?? childRun?.spec.displayName ?? childSummary?.spec.displayName ?? `协作项 ${childRunId}`);
  const childStatus = childWorkflowStatus(status);
  return {
    childRunId,
    title,
    status: childStatus,
    summary: latestResult ?? childFailureTextFromRecord(status, uncertainty ?? childRun?.failureReason) ?? objective,
    objective,
    latestResult,
    findings,
    evidenceRefs,
    uncertainty,
    confidence,
    updatedAt: liveChild?.updatedAt ?? childRun?.completedAt ?? childRun?.startedAt ?? workflowItems.at(-1)?.timestamp ?? view.liveProjection.updatedAt,
    workflowItems,
    childRun,
    needsAttention: childStatus === "blocked" || pendingApproval !== undefined,
    pendingApproval,
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

function goalReceivedTaskPlanItem(view: DeepRunView): DeepTaskPlanItemViewModel {
  const goalEvent = view.eventSequence.find((event) => event.type === "deep.goal_received");
  return {
    itemId: `manager-goal:${view.run.runId}`,
    kind: "goal_received",
    title: "目标已接收",
    detail: view.run.goal,
    status: "completed",
    timestamp: goalEvent?.timestamp ?? view.run.startedAt,
  };
}

function runWorkflowStatus(view: DeepRunView): DeepLiveChildWorkflowItem["status"] {
  switch (view.run.status) {
    case "pending":
      return "pending";
    case "running":
    case "corrected":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
    case "stopped":
      return "interrupted";
    default:
      return "running";
  }
}

function childWorkflowStatus(status: DeepChildRunStatus): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "planned":
      return "pending";
    case "running":
    case "resumed":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "pending";
  }
}

function childFailureTextFromRecord(status: DeepChildRunStatus, detail: string | undefined): string | undefined {
  if (status !== "failed" && status !== "interrupted" && status !== "blocked") {
    return undefined;
  }
  return meaningfulChildResultText(detail);
}

export function DeepWorkItemDetailPanel(props: {
  readonly view: DeepRunView;
  readonly selectedWorkItem: DeepSelectedWorkItem;
  readonly busy: boolean;
  readonly childOperationBusyId?: string;
  readonly onClose?: () => void;
  readonly onChildMessage?: DeepChildMessageHandler;
  readonly onChildConfirmation?: DeepChildConfirmationHandler;
}): React.ReactElement | null {
  const detail = deepWorkItemDetailViewModel(props.view, props.selectedWorkItem);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    setMessage("");
  }, [props.selectedWorkItem.kind, props.selectedWorkItem.id]);
  if (detail === undefined) {
    return null;
  }
  const childBusy = detail.child !== undefined && props.childOperationBusyId === detail.child.childRunId;
  const detailStatusLabel = visibleWorkflowStatusLabel(detail.status);
  const trimmed = message.trim();
  return (
    <aside className="deep-work-detail-panel" aria-label="详情">
      <div className="deep-work-detail-inner">
        <header className="deep-work-detail-header">
          <div className="deep-work-detail-title">
            <span>详情</span>
            <h2>{detail.title}</h2>
          </div>
          <div className="deep-work-detail-meta">
            {detailStatusLabel !== undefined && (
              <span className={`deep-chat-child-status deep-status-${detail.status}`}>{detailStatusLabel}</span>
            )}
            {props.onClose && (
              <button type="button" onClick={props.onClose} aria-label="关闭详情">
                关闭
              </button>
            )}
          </div>
        </header>

        <div className="deep-work-detail-scrollbody">
          {detail.summary.trim().length > 0 && (
            <section className="deep-work-detail-section">
              <p>{detail.summary}</p>
            </section>
          )}

          {detail.child !== undefined && (
            <DeepChildAgentWorkflow
              child={detail.child}
              fallbackItems={detail.worklineItems}
            />
          )}

          {detail.worklineItems.length > 0 && (detail.child === undefined || !deepChildWorkflowHasRenderableSegments(detail.child, detail.worklineItems)) && (
            <section className="deep-work-detail-section">
              <div className="deep-work-detail-section-head">
                <span>执行记录</span>
                <small>{detail.worklineItems.length} 条动作</small>
              </div>
              <div className="deep-work-detail-workline">
                <AgentWorkTimeline
                  view={detailTimelineView(detail.worklineItems)}
                  lifecycle={workflowLifecycle(detail.status)}
                  confirmationBusy={false}
                />
              </div>
            </section>
          )}

          {detail.child?.synthesisReview && <p>{synthesisReviewLabel(detail.child.synthesisReview)}</p>}
        </div>

        {detail.child !== undefined && (detail.child.pendingApproval && props.onChildConfirmation || props.onChildMessage) && (
          <div className="deep-work-detail-actionbar">
            {detail.child.pendingApproval && props.onChildConfirmation && (
              <ChildTaskApproval
                childRunId={detail.child.childRunId}
                pendingApproval={detail.child.pendingApproval}
                busy={childBusy}
                onDecision={props.onChildConfirmation}
              />
            )}

            {props.onChildMessage && (
              <form
                className="deep-work-detail-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (trimmed.length === 0 || childBusy) return;
                  Promise.resolve(props.onChildMessage?.(detail.child?.childRunId ?? "", trimmed)).then(() => setMessage(""));
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

function DeepChildAgentWorkflow(props: {
  readonly child: DeepRunChildSummaryViewModel;
  readonly fallbackItems: readonly DeepWorklineItemViewModel[];
}): React.ReactElement | null {
  const segments = deepChildAgentWorkflowSegments(props.child, props.fallbackItems);
  if (segments.length === 0) {
    return null;
  }
  return (
    <section className="deep-work-detail-section deep-child-agent-workflow-section" aria-label="协作详情">
      <div className="deep-child-agent-workflow">
        {segments.map((segment) => {
          if (segment.kind === "model") {
            return (
              <div
                className={`assistant-answer deep-child-agent-model-output deep-child-agent-model-${segment.tone}`}
                key={segment.segmentId}
              >
                <RichText text={segment.text} />
              </div>
            );
          }
          return (
            <div className="deep-child-agent-tool-group" key={segment.segmentId}>
              <AgentWorkTimeline
                view={detailTimelineView(segment.items)}
                collapsed={true}
                lifecycle={segment.lifecycle}
                confirmationBusy={false}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function deepChildWorkflowHasRenderableSegments(
  child: DeepRunChildSummaryViewModel,
  fallbackItems: readonly DeepWorklineItemViewModel[],
): boolean {
  return deepChildAgentWorkflowSegments(child, fallbackItems).length > 0;
}

type DeepRunChildSummaryViewModel = {
  readonly childRunId: string;
  readonly title: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly summary: string;
  readonly objective: string;
  readonly latestResult?: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly uncertainty?: string;
  readonly confidence?: number;
  readonly updatedAt: string;
  readonly workflowItems: readonly DeepLiveChildWorkflowItem[];
  readonly childRun?: DeepChildAgentRunView;
  readonly needsAttention: boolean;
  readonly pendingApproval?: DeepLiveChildProjection["pendingApproval"];
  readonly synthesisReview?: DeepParentSynthesisChildReviewView;
};

function deepRunTranscriptViewModel(
  view: DeepRunView,
  conversation: DeepConversationView | undefined,
  intakeStatus: DeepIntakeStatus | undefined,
  pendingGoal: string | undefined,
): DeepRunTranscriptViewModel {
  const workflowItems = runTranscriptWorkflowItems(view);
  const children = childAgentSummaryItems(view);
  const effectiveConversation = conversation ?? view.conversation;
  const conversationBlocks = effectiveConversation === undefined
    ? {
        leadingBlocks: [],
        trailingBlocks: [],
      }
    : deepConversationTranscriptBlocks(effectiveConversation, view.run.runId, view.run.updatedAt, intakeStatus);
  const blocks = deepRunTranscriptBlocks(
    view,
    children,
    conversationBlocks.leadingBlocks,
    conversationBlocks.trailingBlocks,
    pendingGoal,
  );
  return {
    status: runWorkflowStatus(view),
    blocks,
    planInsertIndex: conversationBlocks.trailingBlocks.length > 0
      ? blocks.length
      : Math.min(conversationBlocks.leadingBlocks.length, blocks.length),
    planConfirmation: effectiveConversation === undefined
      ? undefined
      : deepPlanConfirmationViewModel(effectiveConversation, intakeStatus),
    workflowItems,
    children,
  };
}

function deepRunTranscriptBlocks(
  view: DeepRunView,
  children: readonly DeepRunChildSummaryViewModel[],
  leadingConversationBlocks: readonly DeepRunTranscriptBlock[],
  trailingConversationBlocks: readonly DeepRunTranscriptBlock[],
  pendingGoal: string | undefined,
): readonly DeepRunTranscriptBlock[] {
  const blocks: DeepRunTranscriptBlock[] = [...leadingConversationBlocks];
  if (blocks.length === 0) {
    blocks.push({
      kind: "user_goal",
      id: `goal:${view.run.runId}`,
      text: view.conversation?.currentObjective ?? view.run.goal,
    });
  }

  const childAgentListBlock: DeepRunTranscriptBlock | undefined = children.length === 0
    ? undefined
    : {
        kind: "child_agent_list",
        id: `workflow:${view.run.runId}`,
        children,
        status: runWorkflowStatus(view),
      };
  const decisionText = parentDecisionText(view);
  const decisionBlock: DeepRunTranscriptBlock | undefined = decisionText === undefined
    ? undefined
    : {
        kind: "assistant_text",
        id: `decision:${view.liveProjection.decision?.decisionId ?? view.run.runId}`,
        label: "助手",
        text: decisionText,
        tone: view.liveProjection.phase === "needs_input" ? "waiting" : "current",
      };
  const decisionComesBeforeChildren = managerDecisionComesBeforeChildren(view);
  if (decisionComesBeforeChildren && decisionBlock !== undefined) {
    blocks.push(decisionBlock);
  }
  if (childAgentListBlock !== undefined) {
    blocks.push(childAgentListBlock);
  }
  if (!decisionComesBeforeChildren && decisionBlock !== undefined) {
    blocks.push(decisionBlock);
  }

  const synthesisText = parentSynthesisText(view);
  const conclusionText = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);
  const staleConclusion = conclusionNeedsResynthesis(view, conclusionText);
  if (synthesisText !== undefined && conclusionText === undefined) {
    blocks.push({
      kind: "assistant_text",
      id: `synthesis:${view.liveProjection.synthesis?.synthesisId ?? view.report?.reportId ?? view.run.runId}`,
      label: "助手",
      text: synthesisText,
      tone: view.liveProjection.synthesis?.status === "pending" ? "waiting" : "current",
    });
  }

  if (conclusionText !== undefined) {
    blocks.push({
      kind: "conclusion",
      id: `conclusion:${view.report?.conclusion.conclusionId ?? view.liveProjection.conclusion?.conclusionId ?? view.run.runId}`,
      label: "助手",
      text: conclusionText,
      stale: staleConclusion,
      staleMessage: staleConclusion ? "协作材料已更新，当前结论待重新综合。" : undefined,
    });
  }

  const notice = parentNotice(view);
  if (notice !== undefined) {
    blocks.push({
      kind: "notice",
      id: notice.id,
      text: notice.text,
      tone: notice.tone,
    });
  }

  blocks.push(...trailingConversationBlocks);

  const pending = pendingGoal?.trim();
  if (
    pending !== undefined &&
    pending.length > 0 &&
    !trailingConversationBlocks.some((block) => block.kind === "user_goal" && block.text.trim() === pending)
  ) {
    blocks.push({
      kind: "user_goal",
      id: `pending-goal:${view.run.runId}`,
      text: pending,
    });
  }

  return blocks;
}

function managerDecisionComesBeforeChildren(view: DeepRunView): boolean {
  if (view.liveProjection.children.length === 0) {
    return true;
  }
  const decisionId = view.liveProjection.decision?.decisionId;
  if (decisionId !== undefined) {
    const decisionEvent = view.eventSequence.find((event) =>
      event.type === "deep.manager.decided" &&
      event.refs.some((ref) => ref.kind === "delegation_decision" && ref.refId === decisionId)
    );
    const firstChildEvent = view.eventSequence.find((event) => isChildLifecycleEvent(event.type));
    if (decisionEvent !== undefined && firstChildEvent !== undefined) {
      return decisionEvent.sequence < firstChildEvent.sequence;
    }
  }
  return view.liveProjection.decision?.action === "spawn_children";
}

function isChildLifecycleEvent(type: DeepRunView["eventSequence"][number]["type"]): boolean {
  return type.startsWith("deep.child.");
}

function deepConversationTranscriptBlocks(
  conversation: DeepConversationView,
  activeRunId: string,
  runUpdatedAt: string,
  intakeStatus: DeepIntakeStatus | undefined,
): {
  readonly leadingBlocks: readonly DeepRunTranscriptBlock[];
  readonly trailingBlocks: readonly DeepRunTranscriptBlock[];
} {
  const { leadingTurns, trailingTurns } = splitConversationTurnsAroundRun(conversation.intakeTurns, runUpdatedAt);
  return {
    leadingBlocks: deepConversationTurnTranscriptBlocks(leadingTurns, activeRunId, intakeStatus),
    trailingBlocks: [
      ...deepConversationTurnTranscriptBlocks(trailingTurns, activeRunId, intakeStatus),
      ...deepRunFollowUpTranscriptBlocks(conversation.followUpTurns ?? [], activeRunId),
    ],
  };
}

function deepConversationTurnTranscriptBlocks(
  turns: readonly DeepIntakeTurn[],
  activeRunId: string,
  intakeStatus: DeepIntakeStatus | undefined,
): readonly DeepRunTranscriptBlock[] {
  const blocks: DeepRunTranscriptBlock[] = [];
  for (const item of deepIntakeChatItems(turns, intakeStatus)) {
    if (item.kind === "user_goal") {
      blocks.push({
        kind: "user_goal",
        id: `conversation:${activeRunId}:${item.id}`,
        text: item.text,
      });
      continue;
    }
    if (item.kind === "system_notice") {
      blocks.push({
        kind: "notice",
        id: `conversation:${activeRunId}:${item.id}`,
        text: item.text,
        tone: item.tone,
      });
      continue;
    }
    blocks.push({
      kind: "assistant_text",
      id: `conversation:${activeRunId}:${item.id}`,
      label: item.label,
      text: item.text,
      tone: item.tone,
    });
  }
  return blocks;
}

function deepRunFollowUpTranscriptBlocks(
  turns: readonly DeepRunFollowUpTurn[],
  activeRunId: string,
): readonly DeepRunTranscriptBlock[] {
  return turns
    .filter((turn) => turn.runId === activeRunId)
    .map((turn) => ({
      kind: "user_goal" as const,
      id: `follow-up:${activeRunId}:${turn.turnId}`,
      text: turn.userMessage,
    }));
}

export function deepRunWorkItemExists(view: DeepRunView, selected: DeepSelectedWorkItem): boolean {
  if (selected.kind === "child_agent") {
    return childAgentSummaryItems(view).some((child) => child.childRunId === selected.id);
  }
  return runTranscriptWorkflowItems(view).some((item) => selectedWorkItemEquals(selected, {
    kind: item.kind === "summary" ? "synthesis" : item.kind === "result" ? "conclusion" : "manager_step",
    id: item.itemId,
  }));
}

function detailTimelineView(
  items: readonly DeepWorklineItemViewModel[],
): AgentWorkTimelineView<TranscriptNode, ConfirmationProjection> {
  return activityTimelineView(items.map(detailActivityItem));
}

function activityTimelineView(
  items: readonly ActivityItem[],
): AgentWorkTimelineView<TranscriptNode, ConfirmationProjection> {
  return {
    nodes: [],
    items,
    confirmation: {},
    hasContent: items.length > 0,
  };
}

function detailActivityItem(item: DeepWorklineItemViewModel): ActivityItem {
  return worklineActivityItem({
    itemId: item.itemId,
    key: detailActivityKey(item),
    title: item.title,
    label: item.label,
    detail: item.detail,
    status: item.status,
    tone: item.tone,
    phase: item.phase,
    toolKind: item.toolKind,
    badges: item.badges,
    expandedSections: item.expandedSections,
  });
}

function worklineActivityItem(input: {
  readonly itemId: string;
  readonly key: string;
  readonly title: string;
  readonly label?: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItem["status"];
  readonly tone: ActivityItem["tone"];
  readonly phase: ActivityItem["phase"];
  readonly toolKind?: ActivityItem["toolKind"];
  readonly badges?: readonly ActivityBadge[];
  readonly expandedSections?: readonly ActivityExpandedSection[];
}): ActivityItem {
  return {
    nodeId: input.itemId,
    key: input.key,
    copy: {
      label: input.label,
      detail: activityDetailText(input.title, input.detail),
    },
    tone: input.tone,
    phase: input.phase,
    toolKind: input.toolKind,
    statusBadge: activityStatusBadge(input.status),
    badges: input.badges,
    expandedSections: input.expandedSections,
  };
}

function activityDetailText(title: string, detail: string | undefined): string {
  const trimmedDetail = detail?.trim();
  if (trimmedDetail === undefined || trimmedDetail.length === 0) {
    return title;
  }
  return `${title}：${trimmedDetail}`;
}

function activityStatusBadge(status: DeepLiveChildWorkflowItem["status"]): ActivityBadge | undefined {
  switch (status) {
    case "blocked":
      return { label: "待处理", tone: "warning" };
    case "failed":
      return { label: "失败", tone: "danger" };
    case "interrupted":
      return { label: "中断", tone: "danger" };
    case "cancelled":
      return { label: "取消", tone: "warning" };
    case "running":
    case "pending":
    case "completed":
    default:
      return undefined;
  }
}

function detailActivityKey(item: DeepWorklineItemViewModel): string {
  return `deep-detail:${item.itemId}`;
}

function workflowLifecycle(status: DeepLiveChildWorkflowItem["status"]): "open" | "settled" | "attention" {
  if (status === "completed") {
    return "settled";
  }
  if (status === "failed" || status === "blocked" || status === "interrupted" || status === "cancelled") {
    return "attention";
  }
  return "open";
}

function childAgentImportantSignal(child: DeepRunChildSummaryViewModel): string | undefined {
  const objective = compactWorklineText(child.objective, 150);
  const signal = childAgentSignalText(child);
  if (signal === undefined || signal === objective) {
    return undefined;
  }
  return signal;
}

function childAgentSignalText(child: DeepRunChildSummaryViewModel): string | undefined {
  if (child.pendingApproval !== undefined) {
    return compactWorklineText(child.pendingApproval.title || child.pendingApproval.actionSummary, 110);
  }
  const result = meaningfulChildResultText(child.latestResult ?? child.summary, child.objective);
  if (child.status === "completed") {
    return result === undefined ? undefined : compactWorklineText(result, 120);
  }
  if (child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled") {
    return result === undefined ? undefined : compactWorklineText(result, 120);
  }
  return child.latestResult === undefined || result === undefined ? undefined : compactWorklineText(result, 120);
}

function compactWorklineText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function deepWorkItemDetailViewModel(
  view: DeepRunView,
  selected: DeepSelectedWorkItem,
): DeepWorkItemDetailViewModel | undefined {
  if (selected.kind === "child_agent") {
    const child = childAgentSummaryItem(view, selected.id);
    return {
      kind: selected.kind,
      detailId: selected.id,
      title: child.title,
      status: child.status,
      summary: child.objective || meaningfulChildResultText(child.latestResult ?? child.summary, child.objective) || "",
      workflowItems: child.workflowItems,
      worklineItems: childDetailWorklineItems(child),
      child,
    };
  }
  const workflowItem = runTranscriptWorkflowItems(view).find((item) => item.itemId === selected.id);
  if (workflowItem === undefined) {
    return undefined;
  }
  const detailWorkflowItem = workflowItemFromTaskPlanItem(workflowItem);
  return {
    kind: selected.kind,
    detailId: selected.id,
    title: workflowItem.title,
    status: workflowItem.status,
    summary: workflowItem.detail ?? workflowItem.title,
    workflowItems: [detailWorkflowItem],
    worklineItems: deepWorklineItems([detailWorkflowItem]),
  };
}

function deepChildAgentWorkflowSegments(
  child: DeepRunChildSummaryViewModel,
  fallbackItems: readonly DeepWorklineItemViewModel[],
): readonly DeepChildAgentWorkflowSegment[] {
  const childRun = child.childRun;
  const segments = childRun === undefined
    ? deepChildAgentWorkflowSegmentsFromItems(fallbackItems)
    : deepChildAgentWorkflowSegmentsFromRun(child, childRun);
  return appendLatestResultWorkflowSegment(child, mergeAdjacentChildAgentActivitySegments(segments));
}

function deepChildAgentWorkflowSegmentsFromRun(
  child: DeepRunChildSummaryViewModel,
  childRun: DeepChildAgentRunView,
): readonly DeepChildAgentWorkflowSegment[] {
  const segments: DeepChildAgentWorkflowSegment[] = [];
  for (const instruction of childRun.parentInstructions ?? []) {
    const instructionText = instruction.instructionSummary.trim();
    if (instructionText.length > 0) {
      segments.push({
        kind: "model",
        segmentId: `parent-instruction:${childRun.childRunId}:${instruction.instructionId}`,
        text: instructionText,
        tone: "narration",
      });
    }
  }
  for (const [segmentIndex, segment] of (childRun.executionHistory ?? []).entries()) {
    appendExecutionSegmentWorkflow(segments, childRun.childRunId, segmentIndex, segment, segment.recordedAt);
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    appendExecutionSegmentWorkflow(
      segments,
      childRun.childRunId,
      "latest",
      childRun.execution,
      childRun.completedAt ?? child.updatedAt,
    );
  }
  return segments;
}

function appendExecutionSegmentWorkflow(
  segments: DeepChildAgentWorkflowSegment[],
  childRunId: string,
  segmentIndex: string | number,
  execution: DeepChildAgentRunExecutionView,
  recordedAt: string,
): void {
  const emittedToolCallIds = new Set<string>();
  const messages = execution.modelMessages ?? [];
  for (const [messageIndex, message] of messages.entries()) {
    const messageText = childModelMessageText(message);
    if (messageText !== undefined) {
      segments.push({
        kind: "model",
        segmentId: `model:${childRunId}:${segmentIndex}:${message.responseId ?? message.requestId}:${messageIndex}`,
        text: messageText,
        tone: message.status === "failed" || message.status === "cancelled" ? "system" : "thinking",
      });
    }
    const matchedCalls = matchingToolCalls(message.toolCallIds, execution.toolCalls);
    if (matchedCalls.length > 0) {
      for (const call of matchedCalls) {
        emittedToolCallIds.add(call.callId);
      }
      segments.push(toolActivityWorkflowSegment(childRunId, segmentIndex, `message:${messageIndex}`, matchedCalls, recordedAt));
    }
  }
  const remainingCalls = execution.toolCalls.filter((call) => !emittedToolCallIds.has(call.callId));
  if (remainingCalls.length > 0) {
    segments.push(toolActivityWorkflowSegment(childRunId, segmentIndex, "remaining", remainingCalls, recordedAt));
  }
}

function toolActivityWorkflowSegment(
  childRunId: string,
  segmentIndex: string | number,
  groupId: string,
  toolCalls: readonly DeepChildAgentRunToolCallTraceView[],
  recordedAt: string,
): DeepChildAgentWorkflowSegment {
  return {
    kind: "activity",
    segmentId: `tools:${childRunId}:${segmentIndex}:${groupId}`,
    items: toolCalls.map((call, callIndex) => childToolCallWorklineItem(childRunId, segmentIndex, callIndex, call, recordedAt)),
    lifecycle: toolCalls.some((call) => call.status === "approval_required" || call.status === "failed" || call.status === "cancelled")
      ? "attention"
      : "settled",
  };
}

function deepChildAgentWorkflowSegmentsFromItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepChildAgentWorkflowSegment[] {
  const segments: DeepChildAgentWorkflowSegment[] = [];
  let pendingTools: DeepWorklineItemViewModel[] = [];
  let groupIndex = 0;
  const flushTools = (): void => {
    if (pendingTools.length === 0) {
      return;
    }
    segments.push({
      kind: "activity",
      segmentId: `tools:projection:${groupIndex}`,
      items: pendingTools,
      lifecycle: workflowLifecycleForToolItems(pendingTools),
    });
    pendingTools = [];
    groupIndex += 1;
  };
  for (const item of items) {
    if (isToolWorklineItem(item)) {
      pendingTools.push(item);
      continue;
    }
    flushTools();
    if (isModelWorklineItem(item) || item.itemId.startsWith("latest-result:") || item.itemId.startsWith("parent-instruction:")) {
      const text = item.detail?.trim();
      if (text !== undefined && text.length > 0) {
        segments.push({
          kind: "model",
          segmentId: item.itemId,
          text,
          tone: item.tone === "system" ? "system" : item.tone === "thinking" ? "thinking" : "narration",
        });
      }
    }
  }
  flushTools();
  return segments;
}

function isToolWorklineItem(item: DeepWorklineItemViewModel): boolean {
  return item.itemId.startsWith("tool:") || item.itemId.startsWith("tool-waiting:") || item.tone === "tool";
}

function isModelWorklineItem(item: DeepWorklineItemViewModel): boolean {
  return item.itemId.startsWith("model:") || item.tone === "thinking";
}

function workflowLifecycleForToolItems(items: readonly DeepWorklineItemViewModel[]): "open" | "settled" | "attention" {
  if (items.some((item) => item.status === "failed" || item.status === "blocked" || item.status === "interrupted" || item.status === "cancelled")) {
    return "attention";
  }
  if (items.some((item) => item.status === "running" || item.status === "pending")) {
    return "open";
  }
  return "settled";
}

function mergeAdjacentChildAgentActivitySegments(
  segments: readonly DeepChildAgentWorkflowSegment[],
): readonly DeepChildAgentWorkflowSegment[] {
  const merged: DeepChildAgentWorkflowSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === "activity" && previous?.kind === "activity") {
      merged[merged.length - 1] = {
        kind: "activity",
        segmentId: `${previous.segmentId}+${segment.segmentId}`,
        items: [...previous.items, ...segment.items],
        lifecycle: mergeChildAgentActivityLifecycle(previous.lifecycle, segment.lifecycle),
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function mergeChildAgentActivityLifecycle(
  left: Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"],
  right: Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"],
): Extract<DeepChildAgentWorkflowSegment, { readonly kind: "activity" }>["lifecycle"] {
  if (left === "attention" || right === "attention") {
    return "attention";
  }
  if (left === "open" || right === "open") {
    return "open";
  }
  return "settled";
}

function appendLatestResultWorkflowSegment(
  child: DeepRunChildSummaryViewModel,
  segments: readonly DeepChildAgentWorkflowSegment[],
): readonly DeepChildAgentWorkflowSegment[] {
  const resultText = childMaterialResultText(child);
  if (resultText === undefined) {
    return segments;
  }
  const normalized = resultText.replace(/\s+/g, " ");
  const alreadyShown = segments.some((segment) =>
    segment.kind === "model" && segment.text.replace(/\s+/g, " ") === normalized
  );
  if (alreadyShown) {
    return segments;
  }
  return [
    ...segments,
    {
      kind: "model",
      segmentId: `latest-result:${child.childRunId}`,
      text: resultText,
      tone: child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled"
        ? "system"
        : "narration",
    },
  ];
}

function childMaterialResultText(child: DeepRunChildSummaryViewModel): string | undefined {
  const sections: string[] = [];
  const findings = child.findings.map((finding) => finding.trim()).filter((finding) => finding.length > 0);
  const evidenceRefs = child.evidenceRefs.map((ref) => ref.trim()).filter((ref) => ref.length > 0);
  const uncertainty = meaningfulChildResultText(child.uncertainty);
  const summary = meaningfulChildResultText(child.latestResult, child.objective);
  if (summary !== undefined) {
    sections.push(summary);
  }
  if (findings.length > 0) {
    sections.push(`发现：\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  }
  if (uncertainty !== undefined && uncertainty.length > 0) {
    sections.push(`不确定性：${uncertainty}`);
  }
  if (evidenceRefs.length > 0) {
    sections.push(`证据：${evidenceRefs.join("、")}`);
  }
  return sections.length === 0 ? undefined : sections.join("\n\n");
}

function childDetailWorklineItems(child: DeepRunChildSummaryViewModel): readonly DeepWorklineItemViewModel[] {
  const projectionItems = deepWorklineItems(child.workflowItems);
  const childRunItems = childRunWorklineItems(child);
  const itemById = new Map<string, DeepWorklineItemViewModel>();
  for (const item of projectionItems) {
    itemById.set(item.itemId, item);
  }
  for (const item of childRunItems) {
    itemById.set(item.itemId, item);
  }
  const items = [...childDetailVisibleWorklineItems(sortWorklineItems([...itemById.values()]))];
  const latestResult = meaningfulChildResultText(child.latestResult, child.objective);
  if (latestResult !== undefined && latestResult.length > 0 && !items.some((item) => item.detail === latestResult)) {
    items.push({
      itemId: `latest-result:${child.childRunId}`,
      title: "结果已返回",
      label: "结果",
      detail: latestResult,
      status: child.status === "completed" ? "completed" : child.status,
      timestamp: child.updatedAt,
      tone: child.status === "failed" || child.status === "blocked" || child.status === "interrupted" || child.status === "cancelled"
        ? "system"
        : "narration",
      phase: worklinePhase(child.status),
    });
  }
  return items;
}

function childDetailVisibleWorklineItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepWorklineItemViewModel[] {
  const concreteItems = items.filter(isChildDetailConcreteActionItem);
  if (concreteItems.length > 0) {
    return concreteItems;
  }
  const fallback = items.find((item) => item.itemId.startsWith("status:")) ??
    items.find((item) => item.itemId.startsWith("execution:")) ??
    items.find((item) => item.itemId.startsWith("objective:"));
  return fallback === undefined ? items : [fallback];
}

function isChildDetailConcreteActionItem(item: DeepWorklineItemViewModel): boolean {
  if (
    item.itemId.startsWith("model:") ||
    item.itemId.startsWith("tool:") ||
    item.itemId.startsWith("tool-waiting:") ||
    item.itemId.startsWith("parent-instruction:") ||
    item.itemId.startsWith("latest-result:")
  ) {
    return true;
  }
  return item.itemId.startsWith("status:") &&
    (item.status === "failed" ||
      item.status === "blocked" ||
      item.status === "interrupted" ||
      item.status === "cancelled");
}

function childRunWorklineItems(child: DeepRunChildSummaryViewModel): readonly DeepWorklineItemViewModel[] {
  const childRun = child.childRun;
  if (childRun === undefined) {
    return [];
  }
  const items: DeepWorklineItemViewModel[] = [];
  if (child.objective.trim().length > 0) {
    items.push({
      itemId: `objective:${childRun.childRunId}`,
      title: "目标已明确",
      label: "目标",
      detail: child.objective,
      status: "completed",
      timestamp: childRun.startedAt,
      tone: "narration",
      phase: "completed",
    });
  }
  for (const instruction of childRun.parentInstructions ?? []) {
    items.push(parentInstructionWorklineItem(childRun.childRunId, instruction));
  }
  for (const [segmentIndex, segment] of (childRun.executionHistory ?? []).entries()) {
    const segmentModelItems: DeepWorklineItemViewModel[] = [];
    for (const [messageIndex, message] of (segment.modelMessages ?? []).entries()) {
      const item = childModelMessageWorklineItem(childRun.childRunId, segmentIndex, messageIndex, message);
      if (item !== undefined) {
        segmentModelItems.push(item);
      }
    }
    items.push(...segmentModelItems);
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push(childToolCallWorklineItem(childRun.childRunId, segmentIndex, callIndex, call, segment.recordedAt));
    }
    items.push(executionSegmentWorklineItem(childRun.childRunId, segmentIndex, segment));
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    const recordedAt = childRun.completedAt ?? child.updatedAt;
    const latestModelItems: DeepWorklineItemViewModel[] = [];
    for (const [messageIndex, message] of (childRun.execution.modelMessages ?? []).entries()) {
      const item = childModelMessageWorklineItem(childRun.childRunId, "latest", messageIndex, message);
      if (item !== undefined) {
        latestModelItems.push(item);
      }
    }
    items.push(...latestModelItems);
    for (const [callIndex, call] of childRun.execution.toolCalls.entries()) {
      items.push(childToolCallWorklineItem(childRun.childRunId, "latest", callIndex, call, recordedAt));
    }
    items.push({
      itemId: `execution:${childRun.childRunId}`,
      title: child.status === "running" ? "正在探索" : "已产生执行结果",
      label: "模型",
      detail: `模型 ${childRun.execution.modelRounds} 轮，工具 ${childRun.execution.toolRounds} 次`,
      status: child.status === "running" ? "running" : "completed",
      timestamp: recordedAt,
      tone: "thinking",
      phase: child.status === "running" ? "executing" : "completed",
      toolKind: "thinking",
    });
  }
  if (childRun.pendingApproval !== undefined) {
    items.push(childPendingApprovalWorklineItem(childRun.childRunId, childRun.pendingApproval));
  }
  items.push(childRunStatusWorklineItem(child, childRun));
  return sortWorklineItems(items);
}

function childModelMessageWorklineItem(
  childRunId: string,
  segmentIndex: string | number,
  messageIndex: number,
  message: DeepChildAgentRunModelMessageTraceView,
): DeepWorklineItemViewModel | undefined {
  const detail = childModelMessageText(message);
  if (detail === undefined) {
    return undefined;
  }
  const status: DeepLiveChildWorkflowItem["status"] =
    message.status === "completed"
      ? "completed"
      : message.status === "cancelled"
        ? "cancelled"
        : "failed";
  return {
    itemId: `model:${childRunId}:${segmentIndex}:${message.responseId ?? message.requestId}:${messageIndex}`,
    title: childModelMessageTitle(message, messageIndex),
    label: message.reasoningSummary !== undefined && message.text === undefined ? "推理" : "模型",
    detail,
    status,
    timestamp: message.completedAt,
    tone: status === "failed" || status === "cancelled" ? "system" : "thinking",
    phase: worklinePhase(status),
    toolKind: status === "failed" || status === "cancelled" ? "system" : "thinking",
  };
}

function childModelMessageText(message: DeepChildAgentRunModelMessageTraceView): string | undefined {
  const text = message.text?.trim();
  if (text !== undefined && text.length > 0) {
    return childMaterialTextFromModelOutput(text) ?? text;
  }
  const reasoning = message.reasoningSummary?.trim();
  if (reasoning !== undefined && reasoning.length > 0) {
    return reasoning;
  }
  return undefined;
}

function childMaterialTextFromModelOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  return childMaterialTextFromUnknown(parsed);
}

function childMaterialTextFromUnknown(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sections: string[] = [];
  const summary = stringField(value, "summary");
  if (summary !== undefined) {
    sections.push(summary);
  }
  const findings = arrayField(value, "findings").map(formatChildMaterialFinding).filter(isNonEmptyString);
  if (findings.length > 0) {
    sections.push(`发现：\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  }
  const uncertainty = childMaterialUncertaintyText(value.uncertainty);
  if (uncertainty !== undefined) {
    sections.push(`不确定性：${uncertainty}`);
  }
  const evidenceRefs = arrayField(value, "evidenceRefs").map(formatChildMaterialEvidenceRef).filter(isNonEmptyString);
  if (evidenceRefs.length > 0) {
    sections.push(`证据：${evidenceRefs.join("、")}`);
  }
  return sections.length === 0 ? undefined : sections.join("\n\n");
}

function formatChildMaterialFinding(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const title = stringField(value, "title");
  const detail = stringField(value, "detail");
  const applicability = stringField(value, "applicability");
  const text = [title, detail].filter(isNonEmptyString).join("：");
  if (text.length === 0) {
    return applicability;
  }
  return applicability === undefined ? text : `${text}（${applicability}）`;
}

function formatChildMaterialEvidenceRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const path = stringField(value, "path");
  const type = stringField(value, "type");
  const notes = stringField(value, "notes");
  const head = path ?? type;
  if (head === undefined) {
    return notes;
  }
  return notes === undefined ? head : `${head}（${notes}）`;
}

function childMaterialUncertaintyText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(isNonEmptyString);
  return items.length === 0 ? undefined : items.join("；");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function matchingToolCalls(
  toolCallIds: readonly string[],
  toolCalls: readonly DeepChildAgentRunToolCallTraceView[],
): readonly DeepChildAgentRunToolCallTraceView[] {
  if (toolCallIds.length === 0) {
    return [];
  }
  const ids = new Set(toolCallIds);
  const matched = toolCalls.filter((call) => ids.has(call.callId));
  return matched.length > 0 ? matched : [];
}

function childModelMessageTitle(
  message: DeepChildAgentRunModelMessageTraceView,
  messageIndex: number,
): string {
  if ((message.toolCallIds?.length ?? 0) > 0) {
    return "工具调用前说明";
  }
  return `模型回答 ${messageIndex + 1}`;
}

function parentInstructionWorklineItem(
  childRunId: string,
  instruction: DeepChildAgentRunParentInstructionView,
): DeepWorklineItemViewModel {
  const status = parentInstructionWorkflowStatus(instruction.status);
  return {
    itemId: `parent-instruction:${childRunId}:${instruction.instructionId}`,
    title: parentInstructionTitle(instruction.status),
    label: "补充",
    detail: instruction.instructionSummary,
    status,
    timestamp: instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt,
    tone: instruction.status === "queued" ? "confirmation" : "narration",
    phase: worklinePhase(status),
  };
}

function childToolCallWorklineItem(
  childRunId: string,
  segmentIndex: string | number,
  callIndex: number,
  call: DeepChildAgentRunToolCallTraceView,
  recordedAt: string,
): DeepWorklineItemViewModel {
  const status = childToolCallWorkflowStatus(call.status);
  const projected = toolCallActivityItem(childRunId, segmentIndex, callIndex, call, recordedAt);
  const toolKind = projected?.toolKind ?? toolKindFromName(call.toolName);
  const detail = projected?.copy.detail ?? call.summary ?? call.inputSummary ?? childToolCallStatusLabel(call.status);
  return {
    itemId: `tool:${childRunId}:${segmentIndex}:${call.callId || callIndex}`,
    title: call.toolName,
    label: projected?.copy.label ?? toolLabelForKind(toolKind),
    detail,
    status,
    timestamp: recordedAt,
    tone: projected?.tone ?? "tool",
    phase: projected?.phase ?? worklinePhase(status),
    toolKind,
    badges: mergeActivityBadges(projected?.badges, toolCallBadges(call)),
    expandedSections: mergeExpandedSections(projected?.expandedSections, toolCallExpandedSections(call)),
  };
}

function toolCallActivityItem(
  childRunId: string,
  segmentIndex: string | number,
  callIndex: number,
  call: DeepChildAgentRunToolCallTraceView,
  recordedAt: string,
): ActivityItem | undefined {
  const node: TranscriptNode = {
    nodeId: `deep-tool:${childRunId}:${segmentIndex}:${call.callId || callIndex}`,
    runId: childRunId,
    sequence: toolCallSequence(segmentIndex, callIndex),
    eventType: toolCallEventType(call.status),
    kind: "tool",
    phase: toolCallTranscriptPhase(call.status),
    title: call.toolName,
    summary: call.summary ?? call.inputSummary ?? childToolCallStatusLabel(call.status),
    timestamp: recordedAt,
    toolName: call.toolName,
    display: call.display,
    refs: call.callId.trim().length === 0 ? [] : [{ kind: "tool_call", id: call.callId }],
  };
  return displayActivityItemsForNodes([node])[0];
}

function toolCallSequence(segmentIndex: string | number, callIndex: number): number {
  if (typeof segmentIndex === "number") {
    return segmentIndex * 1_000 + callIndex;
  }
  return callIndex;
}

function toolCallEventType(status: DeepChildAgentRunToolCallTraceView["status"]): string {
  if (status === "completed") {
    return "tool.completed";
  }
  if (status === "approval_required") {
    return "tool.requested";
  }
  return "tool.failed";
}

function toolCallTranscriptPhase(
  status: DeepChildAgentRunToolCallTraceView["status"],
): TranscriptNode["phase"] {
  switch (status) {
    case "completed":
      return "completed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function mergeActivityBadges(
  left: readonly ActivityBadge[] | undefined,
  right: readonly ActivityBadge[] | undefined,
): readonly ActivityBadge[] | undefined {
  const badges = [...(left ?? []), ...(right ?? [])];
  const seen = new Set<string>();
  const merged: ActivityBadge[] = [];
  for (const badge of badges) {
    const key = `${badge.label.trim()}\u0000${badge.tone ?? ""}\u0000${badge.monospace === true ? "1" : "0"}`;
    if (badge.label.trim().length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(badge);
  }
  return merged.length === 0 ? undefined : merged;
}

function mergeExpandedSections(
  left: readonly ActivityExpandedSection[] | undefined,
  right: readonly ActivityExpandedSection[] | undefined,
): readonly ActivityExpandedSection[] | undefined {
  const sections = [...(left ?? []), ...(right ?? [])];
  const seen = new Set<string>();
  const merged: ActivityExpandedSection[] = [];
  for (const section of sections) {
    const title = section.title.trim();
    const content = section.content.trim();
    const key = `${title}\u0000${content}`;
    if (title.length === 0 || content.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...section, title, content });
  }
  return merged.length === 0 ? undefined : merged;
}

function toolCallBadges(call: DeepChildAgentRunToolCallTraceView): readonly ActivityBadge[] | undefined {
  const badges: ActivityBadge[] = [];
  if (call.durationMs !== undefined && Number.isFinite(call.durationMs)) {
    badges.push({ label: durationLabel(call.durationMs), monospace: true });
  }
  if (call.status === "completed") {
    badges.push({ label: "已完成", tone: "success" });
  } else if (call.status === "failed") {
    badges.push({ label: "失败", tone: "danger" });
  } else if (call.status === "approval_required") {
    badges.push({ label: "待确认", tone: "warning" });
  } else if (call.status === "cancelled") {
    badges.push({ label: "已取消", tone: "warning" });
  }
  return badges.length === 0 ? undefined : badges;
}

function toolCallExpandedSections(
  call: DeepChildAgentRunToolCallTraceView,
): readonly ActivityExpandedSection[] | undefined {
  const sections: ActivityExpandedSection[] = [];
  if (call.inputSummary !== undefined) {
    sections.push({ title: "输入", content: call.inputSummary, format: "code" });
  }
  if (call.summary !== undefined) {
    sections.push({
      title: call.status === "failed" ? "失败" : "结果",
      content: call.summary,
      tone: call.status === "failed" ? "danger" : undefined,
    });
  }
  return sections.length === 0 ? undefined : sections;
}

function durationLabel(value: number): string {
  if (value < 1_000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  const seconds = value / 1_000;
  const rounded = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `${rounded.replace(/\.0$/, "")}s`;
}

function executionSegmentWorklineItem(
  childRunId: string,
  segmentIndex: number,
  segment: DeepChildAgentRunExecutionSegmentView,
): DeepWorklineItemViewModel {
  return {
    itemId: `segment:${childRunId}:${segmentIndex}`,
    title: executionSegmentTitle(segment.outcome),
    label: "模型",
    detail: `模型 ${segment.modelRounds} 轮，工具 ${segment.toolRounds} 次`,
    status: segment.outcome,
    timestamp: segment.recordedAt,
    tone: segment.outcome === "completed" ? "thinking" : "system",
    phase: worklinePhase(segment.outcome),
    toolKind: segment.outcome === "completed" ? "thinking" : "system",
  };
}

function childPendingApprovalWorklineItem(
  childRunId: string,
  pendingApproval: DeepChildAgentRunPendingApprovalView,
): DeepWorklineItemViewModel {
  const toolKind = toolKindFromName(pendingApproval.toolName);
  return {
    itemId: `tool-waiting:${childRunId}:${pendingApproval.confirmationId}`,
    title: pendingApproval.toolName,
    label: toolLabelForKind(toolKind),
    detail: pendingApproval.actionSummary,
    status: "blocked",
    timestamp: pendingApproval.requestedAt,
    tone: "confirmation",
    phase: "blocked",
    toolKind,
  };
}

function childRunStatusWorklineItem(
  child: DeepRunChildSummaryViewModel,
  childRun: DeepChildAgentRunView,
): DeepWorklineItemViewModel {
  const status = childWorkflowStatus(childRun.status);
  const detail = childRun.failureReason ??
    meaningfulChildResultText(child.latestResult, child.objective) ??
    meaningfulChildResultText(child.summary, child.objective);
  return {
    itemId: `status:${childRun.childRunId}:${childRun.status}`,
    title: childRunStatusTitle(childRun.status),
    label: "状态",
    detail,
    status,
    timestamp: childRun.completedAt ?? child.updatedAt,
    tone: status === "failed" || status === "blocked" || status === "interrupted" || status === "cancelled" ? "system" : "narration",
    phase: worklinePhase(status),
  };
}

function parentInstructionWorkflowStatus(
  status: DeepChildAgentRunParentInstructionView["status"],
): DeepLiveChildWorkflowItem["status"] {
  if (status === "queued") {
    return "pending";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "completed";
}

function parentInstructionTitle(status: DeepChildAgentRunParentInstructionView["status"]): string {
  if (status === "queued") {
    return "收到补充要求";
  }
  if (status === "cancelled") {
    return "补充要求已取消";
  }
  return "执行补充要求";
}

function childToolCallWorkflowStatus(
  status: DeepChildAgentRunToolCallTraceView["status"],
): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function childToolCallStatusLabel(status: DeepChildAgentRunToolCallTraceView["status"]): string {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "approval_required":
      return "等待确认";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function executionSegmentTitle(outcome: DeepChildAgentRunExecutionSegmentView["outcome"]): string {
  switch (outcome) {
    case "completed":
      return "模型回合完成";
    case "blocked":
      return "模型回合等待处理";
    case "failed":
      return "模型回合失败";
    case "interrupted":
      return "模型回合中断";
    default:
      return "模型回合";
  }
}

function childRunStatusTitle(status: DeepChildRunStatus): string {
  switch (status) {
    case "planned":
      return "等待启动";
    case "running":
    case "resumed":
      return "正在探索";
    case "blocked":
      return "等待处理";
    case "completed":
      return "结果已返回";
    case "failed":
      return "未完成";
    case "interrupted":
      return "已中断";
    default:
      return "状态更新";
  }
}

function sortWorklineItems(
  items: readonly DeepWorklineItemViewModel[],
): readonly DeepWorklineItemViewModel[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestampOrder = left.item.timestamp.localeCompare(right.item.timestamp);
      return timestampOrder === 0 ? left.index - right.index : timestampOrder;
    })
    .map(({ item }) => item);
}

function workflowItemFromTaskPlanItem(item: DeepTaskPlanItemViewModel): DeepLiveChildWorkflowItem {
  return {
    itemId: item.itemId,
    kind: item.status === "running" ? "running" : item.status === "failed" ? "failed" : item.status === "interrupted" ? "interrupted" : "completed",
    title: item.title,
    detail: item.detail,
    status: item.status,
    timestamp: item.timestamp,
  };
}

function selectedWorkItemEquals(
  left: DeepSelectedWorkItem | undefined,
  right: DeepSelectedWorkItem,
): boolean {
  return left?.kind === right.kind && left.id === right.id;
}

function deepWorklineItems(items: readonly DeepLiveChildWorkflowItem[]): readonly DeepWorklineItemViewModel[] {
  return items.map(deepWorklineItem);
}

function deepWorklineItem(item: DeepLiveChildWorkflowItem): DeepWorklineItemViewModel {
  const toolName = workflowItemToolName(item);
  const toolKind = toolKindFromName(toolName);
  return {
    itemId: item.itemId,
    title: worklineTitle(item, toolName),
    label: worklineLabel(item, toolName),
    detail: worklineDetail(item, toolName),
    status: item.status,
    timestamp: item.timestamp,
    tone: worklineTone(item, toolKind),
    phase: worklinePhase(item.status),
    toolKind,
  };
}

function worklineLabel(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string {
  if (toolName !== undefined) {
    return toolLabelForKind(toolKindFromName(toolName));
  }
  switch (item.kind) {
    case "objective_set":
      return "目标";
    case "model_message":
      return "模型";
    case "running":
      return "运行";
    case "parent_message_queued":
    case "parent_message_applied":
      return "补充";
    case "completed":
      return "结果";
    case "blocked":
    case "interrupted":
    case "failed":
      return "状态";
    case "tool_waiting":
    case "tool_completed":
      return "工具";
    default:
      return "工作";
  }
}

function workflowItemToolName(item: DeepLiveChildWorkflowItem): string | undefined {
  const detail = item.detail?.trim();
  const detailMatch = detail?.match(/^([a-zA-Z][\w.-]{1,40})\s*[:：]/);
  if (detailMatch?.[1]) {
    return detailMatch[1];
  }
  const kind = item.kind.trim();
  if (/^(search|read|edit|write|command|shell|web|list_dir|grep|rg)$/i.test(kind)) {
    return kind;
  }
  return undefined;
}

function toolKindFromName(toolName: string | undefined): DeepWorklineItemViewModel["toolKind"] | undefined {
  if (toolName === undefined) {
    return undefined;
  }
  const normalized = toolName.toLowerCase();
  if (normalized.includes("search") || normalized === "rg" || normalized === "grep") {
    return "search";
  }
  if (normalized.includes("read") || normalized === "cat" || normalized === "list_dir") {
    return "read";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return "edit";
  }
  if (normalized.includes("web") || normalized.includes("browser")) {
    return "web";
  }
  if (normalized.includes("command") || normalized.includes("shell") || normalized === "exec") {
    return "command";
  }
  return "other";
}

function toolLabelForKind(toolKind: DeepWorklineItemViewModel["toolKind"] | undefined): string {
  switch (toolKind) {
    case "command":
      return "命令";
    case "search":
      return "搜索";
    case "read":
      return "读取";
    case "edit":
      return "编辑";
    case "web":
      return "网页";
    case "confirmation":
      return "确认";
    default:
      return "工具";
  }
}

function worklineTitle(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string {
  if (toolName !== undefined) {
    return toolName;
  }
  return item.title;
}

function worklineDetail(item: DeepLiveChildWorkflowItem, toolName: string | undefined): string | undefined {
  if (toolName !== undefined) {
    return workflowToolStatusDetail(item, toolName);
  }
  return item.detail;
}

function workflowToolStatusDetail(
  item: DeepLiveChildWorkflowItem,
  toolName: string,
): string | undefined {
  const detail = item.detail?.trim();
  if (detail !== undefined && detail.length > 0) {
    const prefixed = detail.match(/^[^:：]+[:：]\s*(.+)$/);
    return prefixed?.[1]?.trim() || detail;
  }
  return visibleWorkflowStatusLabel(item.status);
}

function worklineTone(
  item: DeepLiveChildWorkflowItem,
  toolKind: DeepWorklineItemViewModel["toolKind"] | undefined,
): DeepWorklineItemViewModel["tone"] {
  if (toolKind !== undefined) {
    return "tool";
  }
  if (item.status === "pending") {
    return "confirmation";
  }
  if (item.status === "failed" || item.status === "blocked" || item.status === "interrupted") {
    return "system";
  }
  if (item.kind.includes("decision")) {
    return "decision";
  }
  if (item.kind === "model_message") {
    return "thinking";
  }
  if (item.kind.includes("running") || item.status === "running") {
    return "thinking";
  }
  return "narration";
}

function worklinePhase(status: DeepLiveChildWorkflowItem["status"]): DeepWorklineItemViewModel["phase"] {
  switch (status) {
    case "running":
      return "executing";
    case "failed":
      return "failed";
    case "interrupted":
      return "failed";
    case "blocked":
      return "blocked";
    case "pending":
      return "waiting_approval";
    case "cancelled":
      return "cancelled";
    case "completed":
    default:
      return "completed";
  }
}

function runTranscriptWorkflowItems(view: DeepRunView): readonly DeepTaskPlanItemViewModel[] {
  const items: DeepTaskPlanItemViewModel[] = [goalReceivedTaskPlanItem(view)];
  const decision = view.liveProjection.decision;
  if (view.brief !== undefined) {
    items.push({
      itemId: `brief:${view.run.runId}`,
      kind: "brief",
      title: "确认范围",
      detail: view.brief.scopeSummary,
      status: "completed",
      timestamp: view.run.startedAt,
    });
  }
  if (decision !== undefined) {
    items.push({
      itemId: `decision:${decision.decisionId}`,
      kind: "decision",
      title: runTranscriptDecisionTitle(decision.action),
      detail: decision.summary,
      status: decision.action === "wait_children" ? "pending" : decision.action === "stop" ? "completed" : "running",
      timestamp: decision.updatedAt,
    });
  }
  if (view.liveProjection.children.length > 0) {
    const childTone = childActivityTone(view.liveProjection.children);
    items.push({
      itemId: `children:${view.run.runId}`,
      kind: "children",
      title: "协作处理",
      detail: childActivityIntro(view.liveProjection.children),
      status: childTone === "complete" ? "completed" : childTone === "problem" ? "blocked" : "running",
      timestamp: view.liveProjection.updatedAt,
    });
  }
  const synthesis = parentSynthesisText(view);
  if (synthesis !== undefined) {
    items.push({
      itemId: `summary:${view.run.runId}`,
      kind: "summary",
      title: "整理结果",
      detail: synthesis,
      status: view.liveProjection.synthesis?.status === "pending" ? "pending" : "completed",
      timestamp: view.liveProjection.synthesis?.updatedAt ?? view.run.updatedAt,
    });
  }
  const conclusion = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);
  if (conclusion !== undefined) {
    items.push({
      itemId: `result:${view.run.runId}`,
      kind: "result",
      title: "完成回答",
      detail: conclusion,
      status: "completed",
      timestamp: view.report?.conclusion?.createdAt ?? view.liveProjection.conclusion?.updatedAt ?? view.run.updatedAt,
    });
  }
  return items;
}

function runTranscriptDecisionTitle(action: DeepLiveDecisionProjection["action"]): string {
  switch (action) {
    case "direct_answer":
      return "直接回答";
    case "spawn_children":
      return "安排协作";
    case "wait_children":
      return "等待结果";
    case "continue_child":
      return "补充协作项";
    case "synthesize":
      return "整理材料";
    case "ask_user":
      return "需要补充";
    case "stop":
      return "完成";
    default:
      return "继续处理";
  }
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
