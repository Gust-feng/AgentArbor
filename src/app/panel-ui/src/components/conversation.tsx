import React, { useState } from "react";
import { eventTitle, statusTone } from "../text";
import type { BasicAgentRun, Conversation, DesktopRunDetail, PendingConfirmation, RunEvent } from "../types";

export function ConversationView(props: {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const turns = props.conversation?.turns ?? [];
  const answer = visibleResultText(props.detail);
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
          {props.run !== undefined && <RunCard run={props.run} />}
          {props.events.length > 0 && <ActivityTimeline events={props.events} />}
          {props.pendingConfirmation !== undefined && (
            <ConfirmationCard confirmation={props.pendingConfirmation} onDecision={props.onDecision} />
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
  readonly confirmation: PendingConfirmation;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const [guidance, setGuidance] = useState("");
  return (
    <article className="confirmation-card">
      <span className="eyebrow">待确认 · {props.confirmation.riskLevel}</span>
      <h2>{props.confirmation.title || "需要确认"}</h2>
      <p>{props.confirmation.question}</p>
      <p className="muted">{props.confirmation.consequence}</p>
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
