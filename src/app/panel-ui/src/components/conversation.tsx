import React, { useState } from "react";
import { eventTitle, statusTone } from "../text";
import type { AgentDeliverable, BasicAgentRun, Conversation, DesktopRunDetail, DesktopWorkSession, PendingConfirmation, RunEvent } from "../types";

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
  const answer = props.workSession?.deliverable === undefined ? visibleResultText(props.detail) : undefined;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
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
              <p>{turn.content}</p>
            </article>
          ))}
          {props.workSession !== undefined ? <WorkSessionCard workSession={props.workSession} /> : props.run !== undefined && <RunCard run={props.run} />}
          {props.workSession?.deliverable !== undefined && <DeliverableCard deliverable={props.workSession.deliverable} />}
          {(props.workSession?.visibleEvents ?? props.events).length > 0 && <ActivityTimeline events={props.workSession?.visibleEvents ?? props.events} />}
          {pending !== undefined && (
            <ConfirmationCard confirmation={pending} onDecision={props.onDecision} />
          )}
          {answer !== undefined && (
            <article className="result-card">
              <span className="eyebrow">结果</span>
              <h2>{props.detail?.restoredResult?.title ?? "已整理"}</h2>
              <p>{answer}</p>
            </article>
          )}
          {props.error !== undefined && <p className="error-line">{props.error}</p>}
        </div>
      )}
    </div>
  );
}

function WorkSessionCard({ workSession }: { readonly workSession: DesktopWorkSession }): React.ReactElement {
  return (
    <article className={`run-card work-stage ${workSession.stage}`}>
      <div>
        <span className={`status-dot ${statusTone(workSession.run.status)}`} />
        <strong>{workSession.headline}</strong>
      </div>
      <p>{workSession.currentAction}</p>
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
      <p>{deliverable.summary}</p>
      {deliverable.sections.slice(0, 4).map((section) => (
        <section key={section.sectionId}>
          <h3>{section.title}</h3>
          <p>{section.content}</p>
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
      <p>{run.currentStep || run.goalSummary}</p>
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
            {event.summary && <p>{event.summary}</p>}
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
  return (
    <article className="confirmation-card">
      <span className="eyebrow">待确认 · {props.confirmation.riskLevel}</span>
      <h2>{props.confirmation.title || "需要确认"}</h2>
      <p>{"actionSummary" in props.confirmation ? props.confirmation.actionSummary : props.confirmation.question}</p>
      {"consequence" in props.confirmation && <p className="muted">{props.confirmation.consequence}</p>}
      <textarea value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="补充你的要求或限制" rows={3} />
      <div className="button-row">
        <button type="button" className="primary" onClick={() => props.onDecision("approve_once")}>批准一次</button>
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
