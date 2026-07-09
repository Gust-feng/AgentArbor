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
import {
  childAgentImportantSignal,
  compactWorklineText,
  visibleWorkflowStatusLabel,
} from "../deep-view-model";
import {
  deepIntakeChatItems,
  deepPlanConfirmationViewModel,
  deepRunTranscriptViewModel,
  runtimeHealthNoticeViewModel,
} from "../deep-transcript-model";
export type { DeepWorkItemDetailViewModel } from "../deep-view-model";
import {
  deepChildAgentWorkflowSegments,
  deepChildWorkflowHasRenderableSegments,
  deepWorkItemDetailViewModel,
  synthesisReviewLabel,
} from "../deep-work-detail-model";
import type {
  DeepPlanConfirmationViewModel,
  DeepRunTranscriptBlock,
  DeepRuntimeHealthNoticeViewModel,
} from "../deep-transcript-model";
import type {
  DeepRunChildSummaryViewModel,
  DeepSelectedWorkItem,
  DeepWorklineItemViewModel,
} from "../deep-view-model";
import {
  type ActivityBadge,
  type ActivityExpandedSection,
  type ActivityItem,
} from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import type {
  DeepConversationView,
  DeepIntakeStatus,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
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
