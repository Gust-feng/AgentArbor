import React, { useState } from "react";
import { eventTitle, statusTone } from "../text";
import type { AgentDeliverable, BasicAgentRun, Conversation, DesktopRunDetail, DesktopWorkSession, PendingConfirmation, RunEvent } from "../types";
import { RichText } from "./rich-text";

export function ConversationView(props: {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const turns = props.conversation?.turns ?? [];
  const answer = props.workSession?.deliverable === undefined
    ? props.workSession?.answer?.content ?? visibleResultText(props.detail)
    : undefined;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
  const hasAssistantTurn = turns.some((turn) => turn.role === "assistant" && turn.content.trim().length > 0);
  const plainCompletedAnswer =
    props.run?.status === "completed" &&
    props.workSession?.deliverable === undefined &&
    answer !== undefined &&
    pending === undefined;
  const visibleEvents = props.workSession?.visibleEvents ?? props.events;
  const shouldShowActivity = !plainCompletedAnswer || visibleEvents.some(isSubstantiveEvent);
  const shouldShowWorkSession = props.workSession !== undefined && !plainCompletedAnswer;
  const shouldShowAnswerCard = answer !== undefined && !hasAssistantTurn;
  return (
    <div className="conversation-pane">
      {turns.length === 0 && props.run === undefined ? (
        <section className="empty-state">
          <span className="eyebrow">本地桌面工作台</span>
          <h1>在忙什么呢？</h1>
          <p>可以随便问，也可以交给我一个需要查证、读取上下文或等待确认的任务。</p>
        </section>
      ) : (
        <div className="thread">
          {turns.map((turn) => (
            <article className={`message ${turn.role}`} key={turn.turnId}>
              <header>{turn.role === "user" ? "你" : turn.title || "助手"}</header>
              <RichText text={turn.content} />
            </article>
          ))}
          {shouldShowWorkSession ? <WorkSessionCard workSession={props.workSession} /> : props.run !== undefined && !plainCompletedAnswer && <RunCard run={props.run} />}
          {props.workSession?.deliverable !== undefined && <DeliverableCard deliverable={props.workSession.deliverable} />}
          {shouldShowActivity && visibleEvents.length > 0 && <ActivityTimeline events={visibleEvents} />}
          {pending !== undefined && (
            <ConfirmationCard confirmation={pending} onDecision={props.onDecision} />
          )}
          {shouldShowAnswerCard && (
            <article className="result-card">
              <span className="eyebrow">结果</span>
              <h2>{props.workSession?.answer?.title ?? props.detail?.restoredResult?.title ?? "已整理"}</h2>
              <RichText text={answer} />
              {props.workSession?.answer?.nextActions.length ? (
                <div className="deliverable-meta">
                  {props.workSession.answer.nextActions.slice(0, 3).map((action) => <span key={action}>{action}</span>)}
                </div>
              ) : null}
            </article>
          )}
          {props.error !== undefined && <p className="error-line">{props.error}</p>}
        </div>
      )}
    </div>
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

function WorkSessionCard({ workSession }: { readonly workSession: DesktopWorkSession }): React.ReactElement {
  return (
    <article className={`run-card work-stage ${workSession.stage}`}>
      <div>
        <span className={`status-dot ${statusTone(workSession.run.status)}`} />
        <strong>{workSession.headline}</strong>
      </div>
      <RichText text={workSession.currentAction} />
      {workSession.contextAttachments.length > 0 && (
        <div className="inline-context-list">
          {workSession.contextAttachments.slice(0, 4).map((attachment) => (
            <span key={attachment.attachmentId}>{attachment.title}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function DeliverableCard({ deliverable }: { readonly deliverable: AgentDeliverable }): React.ReactElement {
  return (
    <article className="deliverable-card">
      <span className="eyebrow">交付结果</span>
      <h2>{deliverable.title}</h2>
      <RichText text={deliverable.summary} />
      {deliverable.sections.slice(0, 4).map((section) => (
        <section key={section.sectionId}>
          <h3>{section.title}</h3>
          <RichText text={section.content} />
        </section>
      ))}
      {(deliverable.toolDisplays.length > 0 || deliverable.nextActions.length > 0) && (
        <div className="deliverable-meta">
          {deliverable.toolDisplays.length > 0 && <span>工具摘要 {deliverable.toolDisplays.length}</span>}
          {deliverable.nextActions.length > 0 && <span>下一步 {deliverable.nextActions.length}</span>}
        </div>
      )}
    </article>
  );
}

function RunCard({ run }: { readonly run: BasicAgentRun }): React.ReactElement {
  return (
    <article className="run-card">
      <div>
        <span className={`status-dot ${statusTone(run.status)}`} />
        <strong>{run.title}</strong>
      </div>
      <RichText text={run.currentStep || run.goalSummary} />
      {run.nextStep && <small>{run.nextStep}</small>}
    </article>
  );
}

function ActivityTimeline({ events }: { readonly events: readonly RunEvent[] }): React.ReactElement {
  return (
    <section className="activity-timeline" aria-label="近期活动">
      <h2>近期活动</h2>
      {events.filter((event) => event.visibility !== "debug").slice(-12).map((event) => (
        <article key={event.id} className={`activity-item ${statusTone(event.status)}`}>
          <span />
          <div>
            <strong>{eventTitle(event)}</strong>
            {event.summary && <RichText text={event.summary} />}
          </div>
        </article>
      ))}
    </section>
  );
}

function ConfirmationCard(props: {
  readonly confirmation: PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]>;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const [guidance, setGuidance] = useState("");
  const resumeLost = props.confirmation.resumeAvailability === "lost_after_restart";
  return (
    <article className="confirmation-card">
      <span className="eyebrow">待确认 · {props.confirmation.riskLevel}</span>
      <h2>{props.confirmation.title || "需要确认"}</h2>
      <RichText text={"actionSummary" in props.confirmation ? props.confirmation.actionSummary : props.confirmation.question} />
      {"consequence" in props.confirmation && <p className="muted">{props.confirmation.consequence}</p>}
      {resumeLost && <p className="muted">应用重启后无法继续原危险操作。请补充指导或重新发起后续任务。</p>}
      <textarea value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="补充你的要求或限制" rows={3} />
      <div className="button-row">
        <button type="button" className="primary" disabled={resumeLost} onClick={() => props.onDecision("approve_once")}>批准一次</button>
        <button type="button" onClick={() => props.onDecision("deny")}>拒绝</button>
        <button type="button" onClick={() => props.onDecision("guidance", guidance)}>补充指导</button>
      </div>
    </article>
  );
}

function visibleResultText(detail: DesktopRunDetail | undefined): string | undefined {
  return (
    detail?.canvas?.agent?.answer?.answer ??
    detail?.canvas?.workSession?.directAnswer?.answer ??
    detail?.canvas?.workSession?.report?.decisionSummary ??
    detail?.restoredResult?.summary
  );
}
