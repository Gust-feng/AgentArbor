import React, { useState } from "react";
import { eventTitle, STATUS_LABELS, statusTone, TASK_EXAMPLES } from "../text";
import type { AgentDeliverable, BasicAgentRun, ContextAttachment, Conversation, ConversationTurn, DesktopRunDetail, DesktopWorkSession, PendingConfirmation, RunEvent } from "../types";
import { RichText } from "./rich-text";

type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]>;

export function ConversationView(props: {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation;
  readonly attachments: readonly ContextAttachment[];
  readonly onSelectExample: (example: string) => void;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const turns = props.conversation?.turns ?? [];
  const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.content.trim().length > 0);
  const answer = props.workSession?.deliverable === undefined
    ? props.workSession?.answer?.content ?? visibleResultText(props.detail) ?? latestAssistantTurn?.content
    : undefined;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
  const visibleEvents = props.workSession?.visibleEvents ?? props.events;
  const deliverable = props.workSession?.deliverable;
  const completedAnswer =
    props.run?.status === "completed" &&
    props.workSession?.deliverable === undefined &&
    answer !== undefined &&
    pending === undefined;
  const shouldShowProgress =
    props.run !== undefined &&
    (!completedAnswer || visibleEvents.some(isSubstantiveEvent) || props.workSession !== undefined);

  return (
    <div className="conversation-pane">
      {turns.length === 0 && props.run === undefined ? (
        <EmptyCommandCenter attachments={props.attachments} onSelectExample={props.onSelectExample} />
      ) : (
        <div className="task-canvas">
          <TaskBrief
            conversation={props.conversation}
            run={props.run}
            workSession={props.workSession}
          />
          {pending !== undefined && <ConfirmationCard confirmation={pending} onDecision={props.onDecision} />}
          {deliverable !== undefined && <DeliverableCard deliverable={deliverable} />}
          {completedAnswer && (
            <AnswerCard
              title={props.workSession?.answer?.title ?? props.detail?.restoredResult?.title ?? "结果已整理"}
              answer={answer}
              nextActions={props.workSession?.answer?.nextActions ?? props.detail?.canvas?.workSession?.report?.nextActions ?? []}
            />
          )}
          {shouldShowProgress && <WorkProgress run={props.run} workSession={props.workSession} events={visibleEvents} />}
          {turns.length > 0 && <ConversationRecord turns={turns} highlightedTurnId={completedAnswer ? latestAssistantTurn?.turnId : undefined} />}
          {props.error !== undefined && <p className="error-line">{props.error}</p>}
        </div>
      )}
    </div>
  );
}

function EmptyCommandCenter(props: {
  readonly attachments: readonly ContextAttachment[];
  readonly onSelectExample: (example: string) => void;
}): React.ReactElement {
  return (
    <section className="command-center" aria-label="任务工作台">
      <div className="command-center-intro">
        <span className="eyebrow">Desktop Basic Agent</span>
        <h1>在忙什么呢？</h1>
        <p>可以直接提问，也可以把文件、文件夹、网页或当前工作区作为上下文交给我处理。</p>
      </div>
      <div className="command-grid">
        <section className="command-panel primary-panel">
          <h2>开始一项任务</h2>
          <p>选择一个例子后，可以在下方补充目标、材料和限制。</p>
          <div className="command-example-grid">
            {TASK_EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => props.onSelectExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </section>
        <section className="command-panel">
          <h2>上下文入口</h2>
          <ul className="command-checklist">
            <li>添加当前工作区，让它理解项目边界。</li>
            <li>添加文件或文件夹，只给出引用和短摘要。</li>
            <li>添加网页，用作查证和报告证据。</li>
          </ul>
          <p className="muted">{props.attachments.length > 0 ? `已添加 ${props.attachments.length} 个上下文。` : "下方输入区可以立即添加上下文。"}</p>
        </section>
        <section className="command-panel">
          <h2>工作状态</h2>
          <ul className="command-checklist">
            <li>运行时展示正在做什么和下一步。</li>
            <li>有风险的动作会先请求确认。</li>
            <li>完成后优先展示可使用的结果。</li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function TaskBrief(props: {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
}): React.ReactElement {
  const run = props.workSession?.run ?? props.run;
  const title = run?.title ?? props.conversation?.title ?? "当前任务";
  const summary = props.workSession?.headline ?? run?.goalSummary ?? "会话已开始。";
  const context = props.workSession?.contextAttachments ?? [];
  return (
    <section className="task-brief">
      <div className="task-brief-main">
        <span className="eyebrow">任务简报</span>
        <h2>{title}</h2>
        <RichText text={summary} />
      </div>
      <div className="task-brief-side">
        {run !== undefined && <span className={`status-pill ${statusTone(run.status)}`}>{STATUS_LABELS[run.status]}</span>}
        {run?.runMode === "deep" && <span className="mode-badge">深入处理</span>}
      </div>
      <ContextStrip attachments={context} />
    </section>
  );
}

function ContextStrip({ attachments }: { readonly attachments: readonly ContextAttachment[] }): React.ReactElement {
  return (
    <div className="context-strip" aria-label="已使用上下文">
      <strong>上下文</strong>
      {attachments.length === 0 ? (
        <span className="muted">未添加额外上下文。</span>
      ) : (
        attachments.slice(0, 6).map((attachment) => (
          <span className={`context-token ${attachment.status}`} key={attachment.attachmentId}>
            {attachment.title}
          </span>
        ))
      )}
    </div>
  );
}

function WorkProgress(props: {
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
}): React.ReactElement {
  const currentAction = props.workSession?.currentAction ?? props.run?.currentStep ?? props.run?.goalSummary ?? "正在准备任务。";
  const nextStep = props.run?.nextStep;
  const visibleEvents = props.events.filter((event) => event.visibility !== "debug").slice(-8);
  return (
    <section className="work-progress" aria-label="工作进度">
      <header>
        <div>
          <span className="eyebrow">工作进度</span>
          <h2>{stageLabel(props.workSession?.stage, props.run?.status)}</h2>
        </div>
        {props.run !== undefined && <span className={`status-pill ${statusTone(props.run.status)}`}>{STATUS_LABELS[props.run.status]}</span>}
      </header>
      <div className="current-action">
        <strong>{currentAction}</strong>
        {nextStep !== undefined && <small>下一步：{nextStep}</small>}
      </div>
      {visibleEvents.length > 0 ? (
        <div className="activity-timeline compact" aria-label="近期活动">
          {visibleEvents.map((event) => (
            <article key={event.id} className={`activity-item ${statusTone(event.status)}`}>
              <span />
              <div>
                <strong>{eventTitle(event)}</strong>
                {event.summary && <RichText text={event.summary} />}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">任务启动后，会在这里显示可读的工作笔记。</p>
      )}
    </section>
  );
}

function DeliverableCard({ deliverable }: { readonly deliverable: AgentDeliverable }): React.ReactElement {
  const copyValue = [
    deliverable.title,
    deliverable.summary,
    ...deliverable.sections.map((section) => `${section.title}\n${section.content}`),
  ].join("\n\n");
  return (
    <article className="deliverable-card">
      <header>
        <div>
          <span className="eyebrow">交付结果</span>
          <h2>{deliverable.title}</h2>
        </div>
        <button type="button" className="ghost" onClick={() => copyToClipboard(copyValue)}>复制结果</button>
      </header>
      <RichText text={deliverable.summary} />
      {deliverable.sections.slice(0, 4).map((section) => (
        <section key={section.sectionId}>
          <h3>{section.title}</h3>
          <RichText text={section.content} />
        </section>
      ))}
      <ResultMeta evidenceCount={deliverable.evidenceRefs.length} toolCount={deliverable.toolDisplays.length} nextActions={deliverable.nextActions} />
    </article>
  );
}

function AnswerCard(props: {
  readonly title: string;
  readonly answer: string;
  readonly nextActions: readonly string[];
}): React.ReactElement {
  return (
    <article className="result-card deliverable-card direct-answer">
      <header>
        <div>
          <span className="eyebrow">结果</span>
          <h2>{props.title}</h2>
        </div>
        <button type="button" className="ghost" onClick={() => copyToClipboard(props.answer)}>复制回答</button>
      </header>
      <RichText text={props.answer} />
      <ResultMeta evidenceCount={0} toolCount={0} nextActions={props.nextActions} />
    </article>
  );
}

function ResultMeta(props: {
  readonly evidenceCount: number;
  readonly toolCount: number;
  readonly nextActions: readonly string[];
}): React.ReactElement | null {
  if (props.evidenceCount === 0 && props.toolCount === 0 && props.nextActions.length === 0) {
    return null;
  }
  return (
    <div className="result-meta">
      {(props.evidenceCount > 0 || props.toolCount > 0) && (
        <div className="deliverable-meta">
          {props.evidenceCount > 0 && <span>证据 {props.evidenceCount}</span>}
          {props.toolCount > 0 && <span>工具摘要 {props.toolCount}</span>}
        </div>
      )}
      {props.nextActions.length > 0 && (
        <section className="next-actions">
          <h3>下一步</h3>
          <ul>
            {props.nextActions.slice(0, 4).map((action) => <li key={action}>{action}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function ConversationRecord(props: {
  readonly turns: readonly ConversationTurn[];
  readonly highlightedTurnId?: string;
}): React.ReactElement {
  return (
    <details className="conversation-record">
      <summary>输入与回复记录</summary>
      <div className="thread compact-thread">
        {props.turns.map((turn) => (
          <article className={`message ${turn.role} ${turn.turnId === props.highlightedTurnId ? "subdued" : ""}`} key={turn.turnId}>
            <header>{turn.role === "user" ? "你" : turn.title || "助手"}</header>
            <RichText text={turn.content} />
          </article>
        ))}
      </div>
    </details>
  );
}

function ConfirmationCard(props: {
  readonly confirmation: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const [guidance, setGuidance] = useState("");
  const resumeLost = props.confirmation.resumeAvailability === "lost_after_restart";
  const affectedResources = confirmationAffectedResources(props.confirmation);
  const risk = confirmationRisk(props.confirmation);
  return (
    <article className={`confirmation-card risk-${risk}`}>
      <span className="eyebrow">待确认 · {riskLabel(risk)}</span>
      <h2>{props.confirmation.title || "需要确认"}</h2>
      <RichText text={confirmationAction(props.confirmation)} />
      {affectedResources.length > 0 && (
        <div className="approval-resources">
          <strong>影响对象</strong>
          <ul>{affectedResources.slice(0, 6).map((resource) => <li key={resource}>{resource}</li>)}</ul>
        </div>
      )}
      {"consequence" in props.confirmation && <p className="muted">{props.confirmation.consequence}</p>}
      {resumeLost && <p className="muted">应用重启后无法继续原动作。请补充指导或重新发起后续任务。</p>}
      <textarea value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="补充你的要求或限制" rows={3} />
      <div className="button-row">
        <button type="button" className="primary" disabled={resumeLost} onClick={() => props.onDecision("approve_once")}>批准一次</button>
        <button type="button" onClick={() => props.onDecision("deny")}>拒绝</button>
        <button type="button" onClick={() => props.onDecision("guidance", guidance)}>补充指导</button>
      </div>
    </article>
  );
}

function isSubstantiveEvent(event: RunEvent): boolean {
  return event.type.startsWith("tool.") ||
    event.type === "confirmation.needed" ||
    event.status === "approval_needed" ||
    event.status === "failed" ||
    event.status === "blocked" ||
    event.status === "cancelled";
}

function stageLabel(stage: DesktopWorkSession["stage"] | undefined, status: BasicAgentRun["status"] | undefined): string {
  if (stage === "understanding" || status === "planning") return "正在理解任务";
  if (stage === "gathering_context") return "正在读取上下文";
  if (stage === "using_tools") return "正在查找资料";
  if (stage === "awaiting_approval" || status === "approval_needed") return "等待你确认";
  if (stage === "composing_result") return "正在整理结果";
  if (stage === "completed" || status === "completed") return "已形成结果";
  if (stage === "blocked" || status === "blocked") return "需要你处理";
  if (stage === "failed" || status === "failed") return "未能完成";
  if (stage === "cancelled" || status === "cancelled") return "已取消";
  return "正在处理";
}

function confirmationAction(confirmation: ConfirmationProjection): string {
  return "actionSummary" in confirmation ? confirmation.actionSummary : confirmation.question;
}

function confirmationAffectedResources(confirmation: ConfirmationProjection): readonly string[] {
  return "affectedResources" in confirmation ? confirmation.affectedResources : [];
}

function confirmationRisk(confirmation: ConfirmationProjection): "low" | "medium" | "high" {
  if (confirmation.riskLevel === "high" || confirmation.riskLevel === "medium" || confirmation.riskLevel === "low") {
    return confirmation.riskLevel;
  }
  return "medium";
}

function riskLabel(risk: "low" | "medium" | "high"): string {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  return "低风险";
}

function visibleResultText(detail: DesktopRunDetail | undefined): string | undefined {
  return (
    detail?.canvas?.agent?.answer?.answer ??
    detail?.canvas?.workSession?.directAnswer?.answer ??
    detail?.canvas?.workSession?.report?.decisionSummary ??
    detail?.restoredResult?.summary
  );
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}
