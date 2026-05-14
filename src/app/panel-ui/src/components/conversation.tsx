import React, { useMemo, useState } from "react";
import { Copy, Maximize2, RotateCcw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { motion } from "motion/react";
import { TASK_SUGGESTIONS } from "../text";
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
  readonly onSelectSuggestion?: (suggestion: string) => void;
  readonly onReset?: () => void;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const turns = useMemo(() => visibleTurns(props.conversation?.turns ?? []), [props.conversation?.turns]);
  const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.content.trim().length > 0);
  const answer = props.workSession?.answer?.content ?? visibleResultText(props.detail) ?? latestAssistantTurn?.content;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
  const deliverable = visibleDeliverable(props.workSession?.deliverable, answer, latestAssistantTurn?.content);
  const completedAnswer =
    props.run?.status === "completed" &&
    deliverable === undefined &&
    answer !== undefined &&
    pending === undefined;
  const shouldAppendAnswer = completedAnswer && latestAssistantTurn === undefined;
  const showStatusBubble =
    props.run !== undefined &&
    pending === undefined &&
    deliverable === undefined &&
    isActiveRunStatus(props.run.status);

  if (turns.length === 0 && props.run === undefined && props.error === undefined) {
    return <EmptyCommandCenter attachments={props.attachments} onSelectSuggestion={props.onSelectSuggestion} />;
  }

  return (
    <div className="chat-scroll">
      <div className="chat-thread">
        <ConversationTranscript turns={turns} />
        {shouldAppendAnswer && <AssistantPlainAnswer answer={answer} />}
        {pending !== undefined && <ConfirmationCard confirmation={pending} onDecision={props.onDecision} busy={props.confirmationBusy} />}
        {deliverable !== undefined && <DeliverableCard deliverable={deliverable} />}
        {showStatusBubble && <AssistantStatusBubble run={props.run} workSession={props.workSession} />}
        {props.error !== undefined && (
          <div className="flex flex-col gap-3">
            <p className="error-line">{props.error}</p>
            {props.run === undefined && props.onReset && (
              <div className="flex gap-2">
                <button type="button" className="h-8 px-4 rounded-lg bg-[#111827] text-white text-sm hover:bg-[#1F2937] transition-colors" onClick={props.onReset}>
                  清除错误
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCommandCenter(props: {
  readonly attachments: readonly ContextAttachment[];
  readonly onSelectSuggestion?: (suggestion: string) => void;
}): React.ReactElement {
  return (
    <section className="chat-empty-surface" aria-label="对话空状态">
      <div className="command-center relative w-full">
        <SproutPaths />
        <motion.div
          className="w-16 h-16 rounded-2xl bg-[#F3F4F6] border border-[#E8E9EE] flex items-center justify-center mb-6 shadow-inner"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
        >
          <Sparkles size={24} className="text-[#9CA3AF]" />
        </motion.div>
        <motion.h2
          className="text-[#111827] mb-2.5 text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
        >
          在忙什么呢？
        </motion.h2>
        <motion.p
          className="text-sm text-[#9CA3AF] text-center max-w-[320px] leading-relaxed mb-7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.34 }}
        >
          可以随便问，也可以交给它需要查证、整理上下文和等待确认的桌面任务
        </motion.p>
        <motion.div
          className="flex flex-wrap gap-2 justify-center max-w-[680px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.48, ease: "easeOut" }}
        >
          {TASK_SUGGESTIONS.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => props.onSelectSuggestion?.(example)}
              className="px-4 py-1.5 rounded-full text-sm text-[#6B7280] border border-[#E2E3E8] bg-white hover:bg-[#F9FAFB] hover:border-[#D1D5DB] hover:text-[#374151] transition-all"
            >
              {example}
            </button>
          ))}
        </motion.div>
        {props.attachments.length > 0 && (
          <p className="mt-5 text-xs text-[#B0B2BC]">已添加 {props.attachments.length} 个上下文</p>
        )}
      </div>
    </section>
  );
}

function SproutPaths(): React.ReactElement {
  const paths = [
    { d: "M 300 158 C 240 120 150 68 75 12", delay: 0 },
    { d: "M 300 158 C 300 110 298 68 296 12", delay: 0.07 },
    { d: "M 300 158 C 360 120 450 68 525 12", delay: 0.14 },
  ];

  return (
    <div className="absolute pointer-events-none z-0 bottom-[calc(50%+16px)] left-1/2 -translate-x-1/2 w-[600px] h-[170px] max-w-[80vw] overflow-visible opacity-80">
      <svg width="600" height="170" viewBox="0 0 600 170" overflow="visible">
        <motion.circle
          cx="300"
          cy="158"
          r="2.5"
          fill="#F87171"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1, 1, 0], opacity: [0, 0.55, 0.55, 0] }}
          transition={{ duration: 1.2, delay: 1.1, times: [0, 0.08, 0.72, 1], ease: "easeInOut" }}
        />
        {paths.map(({ d, delay }, index) => (
          <motion.path
            key={index}
            d={d}
            stroke="#F87171"
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 0.75], opacity: [0, 0.28, 0.28, 0] }}
            transition={{
              pathLength: { duration: 0.55, delay: 1.2 + delay, ease: [0.25, 0.46, 0.45, 0.94] },
              opacity: { duration: 1.1, delay: 1.2 + delay, times: [0, 0.12, 0.62, 1], ease: "easeInOut" },
            }}
          />
        ))}
      </svg>
    </div>
  );
}

function visibleTurns(turns: readonly ConversationTurn[]): readonly ConversationTurn[] {
  return turns.filter((turn) => turn.role === "user" || turn.content.trim().length > 0);
}

function visibleDeliverable(
  deliverable: AgentDeliverable | undefined,
  answer: string | undefined,
  latestAssistantContent: string | undefined
): AgentDeliverable | undefined {
  if (deliverable === undefined) return undefined;
  if (isDuplicateAnswerDeliverable(deliverable, answer) || isDuplicateAnswerDeliverable(deliverable, latestAssistantContent)) {
    return undefined;
  }
  if (isInternalSummaryTitle(deliverable.title)) {
    return undefined;
  }
  return deliverable;
}

function isInternalSummaryTitle(title: string): boolean {
  return ["已", "整理", "结果"].every((part) => title.includes(part)) || ["结果", "摘要"].every((part) => title.includes(part));
}

function isDuplicateAnswerDeliverable(deliverable: AgentDeliverable, answer: string | undefined): boolean {
  if (answer === undefined || answer.trim().length === 0) return false;
  const normalizedAnswer = normalizeComparableText(answer);
  if (normalizeComparableText(deliverable.summary) === normalizedAnswer) return true;
  return deliverable.sections.some((section) => normalizeComparableText(section.content) === normalizedAnswer);
}

function normalizeComparableText(value: string): string {
  return userVisibleAnswer(value).replace(/\s+/g, " ").trim();
}

function ConversationTranscript(props: {
  readonly turns: readonly ConversationTurn[];
}): React.ReactElement | null {
  if (props.turns.length === 0) return null;
  return (
    <div className="flex flex-col gap-5" aria-label="对话记录">
      <DateDivider label="当前会话" />
      {props.turns.map((turn) => turn.role === "user"
        ? <UserTurnBubble key={turn.turnId} turn={turn} />
        : <AssistantTurnBubble key={turn.turnId} turn={turn} />)}
    </div>
  );
}

function userVisibleAnswer(text: string): string {
  return text
    .replace(/AgentArbor\s*桌面\s*Root Agent/g, "AgentArbor 桌面助手")
    .replace(/Root Agent/g, "助手");
}

function UserTurnBubble(props: { readonly turn: ConversationTurn }): React.ReactElement {
  return (
    <article className="flex justify-end">
      <div className="max-w-[72%]">
        <div className="bg-[#F3F4F6] rounded-2xl rounded-tr-md px-4 py-3 inline-flex flex-col gap-2">
          <div className="text-sm text-[#374151]">
            <RichText text={props.turn.content} />
          </div>
        </div>
      </div>
    </article>
  );
}

function AssistantTurnBubble(props: { readonly turn: ConversationTurn }): React.ReactElement {
  const content = userVisibleAnswer(props.turn.content);
  return (
    <article className="flex gap-3 group">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 max-w-[80%]">
        <div className="text-sm text-[#374151] py-1">
          <RichText text={content} />
        </div>
        <div className="flex items-center gap-0.5 mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <TurnActionButton icon={<Copy size={13} />} label="复制" onClick={() => copyToClipboard(content)} />
          <TurnActionButton icon={<RotateCcw size={13} />} label="重新生成" />
          <TurnActionButton icon={<Maximize2 size={13} />} label="展开" />
          <TurnActionButton icon={<ThumbsUp size={13} />} label="有用" />
          <TurnActionButton icon={<ThumbsDown size={13} />} label="无用" />
        </div>
      </div>
    </article>
  );
}

function DateDivider({ label }: { readonly label: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="flex-1 h-px bg-[#F3F4F6]" />
      <span className="text-[11px] text-[#D1D5DB] select-none">{label}</span>
      <div className="flex-1 h-px bg-[#F3F4F6]" />
    </div>
  );
}

function AssistantStatusBubble(props: {
  readonly run: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
}): React.ReactElement {
  const currentAction = props.run.runMode === "deep" ? "正在处理任务…" : "正在回复…";
  return (
    <article className="flex gap-3 group">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 max-w-[80%] py-1">
        <div className="text-sm text-[#6B7280] leading-relaxed">
          <RichText text={currentAction} />
        </div>
        <TypingDots />
      </div>
    </article>
  );
}

function AssistantPlainAnswer({ answer }: { readonly answer: string }): React.ReactElement {
  return (
    <article className="flex gap-3 group">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 max-w-[80%]">
        <div className="text-sm text-[#374151] py-1">
          <RichText text={userVisibleAnswer(answer)} />
        </div>
        <div className="flex items-center gap-0.5 mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <TurnActionButton icon={<Copy size={13} />} label="复制" onClick={() => copyToClipboard(userVisibleAnswer(answer))} />
        </div>
      </div>
    </article>
  );
}

function AssistantAvatar(): React.ReactElement {
  return (
    <div className="w-7 h-7 rounded-xl bg-[#111827] flex items-center justify-center shrink-0 mt-0.5 shadow-sm text-white/70">
      <Sparkles size={12} />
    </div>
  );
}

function TypingDots(): React.ReactElement {
  return (
    <div className="flex items-center gap-1 py-2" aria-label="正在整理">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="w-1.5 h-1.5 rounded-full bg-[#D1D5DB] animate-bounce"
          style={{ animationDelay: `${index * 120}ms`, animationDuration: "0.9s" }}
        />
      ))}
    </div>
  );
}

function DeliverableCard({ deliverable }: { readonly deliverable: AgentDeliverable }): React.ReactElement {
  const copyValue = [
    deliverable.title,
    deliverable.summary,
    ...deliverable.sections.map((section) => `${section.title}\n${section.content}`),
  ].join("\n\n");
  return (
    <article className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[#111827] leading-tight">{deliverable.title}</h2>
        </div>
        <button type="button" className="h-7 px-2 rounded-lg text-xs text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6]" onClick={() => copyToClipboard(copyValue)}>复制</button>
      </header>
      <div className="text-sm text-[#374151]">
        <RichText text={deliverable.summary} />
      </div>
      {deliverable.sections.slice(0, 4).map((section) => (
        <section key={section.sectionId} className="border-t border-[#F3F4F6] pt-3 flex flex-col gap-1.5">
          <h3 className="text-sm text-[#111827]">{section.title}</h3>
          <div className="text-sm text-[#6B7280]">
            <RichText text={section.content} />
          </div>
        </section>
      ))}
      <ResultMeta nextActions={deliverable.nextActions} />
    </article>
  );
}

function ResultMeta(props: {
  readonly nextActions: readonly string[];
}): React.ReactElement | null {
  if (props.nextActions.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <section className="border-t border-[#F3F4F6] pt-3 flex flex-col gap-2">
        <h3 className="text-sm text-[#111827]">下一步</h3>
        <ul className="m-0 pl-5 text-sm text-[#6B7280] flex flex-col gap-1">
          {props.nextActions.slice(0, 4).map((action) => <li key={action}>{action}</li>)}
        </ul>
      </section>
    </div>
  );
}

function TurnActionButton(props: {
  readonly icon: React.ReactNode;
  readonly label?: string;
  readonly onClick?: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] transition-colors"
      onClick={props.onClick}
    >
      {props.icon}
      {props.label && <span>{props.label}</span>}
    </button>
  );
}

function ConfirmationCard(props: {
  readonly confirmation: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly busy: boolean;
}): React.ReactElement {
  const [guidance, setGuidance] = useState("");
  const resumeLost = props.confirmation.resumeAvailability === "lost_after_restart";
  const affectedResources = confirmationAffectedResources(props.confirmation);
  const risk = confirmationRisk(props.confirmation);
  return (
    <article className={`rounded-xl border px-4 py-4 flex flex-col gap-3 ${risk === "high" ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#FDE68A] bg-[#FFFBEB]"}`}>
      <span className="text-xs text-[#D97706]">待确认 · {riskLabel(risk)}</span>
      <h2 className="text-[#111827] leading-tight">{props.confirmation.title || "需要确认"}</h2>
      <div className="text-sm text-[#374151]">
        <RichText text={confirmationAction(props.confirmation)} />
      </div>
      {affectedResources.length > 0 && (
        <div className="rounded-xl border border-[#FDE68A] bg-white/70 px-3 py-2">
          <strong className="text-sm text-[#111827]">影响对象</strong>
          <ul className="mt-1 m-0 pl-5 text-sm text-[#6B7280]">{affectedResources.slice(0, 6).map((resource) => <li key={resource}>{resource}</li>)}</ul>
        </div>
      )}
      {"consequence" in props.confirmation && <p className="text-sm text-[#6B7280]">{props.confirmation.consequence}</p>}
      {resumeLost && <p className="text-sm text-[#6B7280]">应用重启后无法继续原动作。请补充指导或重新发起后续任务。</p>}
      <textarea className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none disabled:opacity-60" value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="补充你的要求或限制" rows={3} disabled={props.busy} />
      <div className="flex items-center flex-wrap gap-2">
        <button type="button" className="h-8 px-4 rounded-lg bg-[#111827] text-white text-sm disabled:opacity-40" disabled={resumeLost || props.busy} onClick={() => props.onDecision("approve_once")}>{props.busy ? "提交中…" : "批准一次"}</button>
        <button type="button" className="h-8 px-4 rounded-lg border border-[#E5E7EB] bg-white text-[#374151] text-sm hover:bg-[#F9FAFB] disabled:opacity-40" disabled={props.busy} onClick={() => props.onDecision("deny")}>拒绝</button>
        <button type="button" className="h-8 px-4 rounded-lg border border-[#E5E7EB] bg-white text-[#374151] text-sm hover:bg-[#F9FAFB] disabled:opacity-40" disabled={props.busy || guidance.trim().length === 0} onClick={() => props.onDecision("guidance", guidance)}>补充指导</button>
      </div>
    </article>
  );
}

function isActiveRunStatus(status: BasicAgentRun["status"]): boolean {
  return status === "queued" || status === "planning" || status === "running";
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
