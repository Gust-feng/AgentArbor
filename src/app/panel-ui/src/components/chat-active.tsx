import React, { useEffect, useMemo, useRef } from "react";
import {
  ClipboardList,
  Copy,
  FileText,
  Sparkles,
} from "lucide-react";
import type { ObservationRef } from "../contracts/common";
import type { Conversation, ConversationTurn } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkSession,
  PendingConfirmation,
  TranscriptNode,
} from "../contracts/run";
import { terminalStatuses } from "../ui-state";
import {
  projectLiveRunTranscript,
  type LiveAnswerTone,
} from "../../../panel-ui-live-transcript";
import type { LiveRunBuffer } from "../../../panel-ui-live-run-buffer";
import { LiveStreamBox } from "./live-stream-text";
import { RichText } from "./rich-text";
import { ChatInputBar, type ChatInputProps, type ChatModelOption } from "./chat-empty";
import { sanitizeFailureCopy, userVisibleAnswer } from "./chat-visible-text";
import {
  assistantModelForTurn,
  selectedComposerModel,
  showStandaloneRun,
  visibleDeliverable,
  visibleResultText,
  visibleRunProblem,
  visibleTurns,
  type AssistantModelBadge,
} from "./chat-session-projection";
import {
  AgentWorkTimeline,
  pendingForTurn,
  type ConfirmationProjection,
} from "./transcript-timeline";
import { nodesForRun, visibleTranscriptNodes } from "./transcript-node-visibility";

export function ChatActive(props: ChatInputProps & {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]>;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentRunId = props.run?.runId ?? props.live?.runId ?? props.conversation?.activeRunId;
  const turns = useMemo(() => visibleTurns(props.conversation?.turns ?? [], currentRunId), [props.conversation?.turns, currentRunId]);
  const transcriptNodes = useMemo(() => visibleTranscriptNodes(props.transcriptNodes), [props.transcriptNodes]);
  const currentRunProjection = useMemo(
    () => projectLiveRunTranscript(nodesForRun(transcriptNodes, currentRunId), props.live),
    [transcriptNodes, currentRunId, props.live]
  );
  const currentRunAssistantTurn = currentRunId === undefined
    ? undefined
    : [...turns].reverse().find((turn) => turn.role === "assistant" && turn.runId === currentRunId && turn.content.trim().length > 0);
  const detailAnswer = props.detail?.runId === undefined || currentRunId === undefined || props.detail.runId === currentRunId
    ? visibleResultText(props.detail)
    : undefined;
  const answer = props.workSession?.answer?.content ?? detailAnswer ?? currentRunAssistantTurn?.content;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
  const deliverable = visibleDeliverable(props.workSession?.deliverable, answer, currentRunAssistantTurn?.content);
  const liveAnswer = currentRunProjection.answer;
  const running = props.run !== undefined && !terminalStatuses.has(props.run.status);
  const statusNotice = visibleRunProblem(props.run, props.workSession, props.detail, props.error);
  const standaloneRun = showStandaloneRun({
    turns,
    run: props.run,
    transcriptNodes,
    answer,
    liveAnswer,
    pending,
    deliverable,
    statusNotice,
  });
  const latestTurn = turns.at(-1);
  const scrollKey = [
    latestTurn?.turnId,
    latestTurn?.content.length,
    liveAnswer?.text.length,
    props.run?.status,
    props.run?.eventCursor.lastSequence,
    transcriptNodes.at(-1)?.nodeId,
  ].join(":");

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    window.requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [scrollKey]);

  const guidanceInputProps = pending === undefined
    ? props
    : {
        ...props,
        placeholder: "补充要求或限制...",
        onSubmit: () => {
          const guidance = props.value.trim();
          if (guidance.length === 0 || props.confirmationBusy) return;
          props.onDecision("guidance", guidance);
          props.onChange("");
        },
      };
  const hasVisibleContent = turns.length > 0 || standaloneRun || statusNotice !== undefined;

  return (
    <div className="chat-active-screen">
      <div className="chat-active-scroll" ref={scrollRef}>
        <div className="chat-active-grid">
          <main className="session-stream" aria-label="任务会话">
            {hasVisibleContent ? (
              <>
                <TranscriptChain
                  turns={turns}
                  models={props.models}
                  selectedModelId={props.selectedModelId}
                  transcriptNodes={transcriptNodes}
                  live={props.live}
                  pending={pending}
                  onDecision={props.onDecision}
                  confirmationBusy={props.confirmationBusy}
                />
                {standaloneRun && (
                  <AssistantMessage
                    content={liveAnswer?.text ?? answer ?? ""}
                    live={liveAnswer?.streaming === true}
                    liveTone={liveAnswer?.tone}
                    model={selectedComposerModel(props.models, props.selectedModelId)}
                    transcriptNodes={currentRunProjection.nodes}
                    pending={pending}
                    deliverable={deliverable}
                    onDecision={props.onDecision}
                    confirmationBusy={props.confirmationBusy}
                  />
                )}
                {statusNotice !== undefined && <StatusNotice {...statusNotice} />}
              </>
            ) : (
              <div className="session-placeholder">
                <AssistantAvatar />
                <TypingDots />
              </div>
            )}
          </main>
        </div>
      </div>

      <ChatInputBar
        {...guidanceInputProps}
        running={running}
        placeholder={guidanceInputProps.placeholder ?? "继续补充、改写计划或让 AgentArbor 执行下一步..."}
        variant="floating"
      />
    </div>
  );
}

function TranscriptChain(props: {
  readonly turns: readonly ConversationTurn[];
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly live?: LiveRunBuffer;
  readonly pending?: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  if (props.turns.length === 0) return null;
  return (
    <div className="transcript-list">
      {props.turns.map((turn) => {
        if (turn.role === "user") {
          return <UserMessage key={turn.turnId} content={turn.content} />;
        }
        const model = assistantModelForTurn(turn, props.models, props.selectedModelId);
        const live = props.live?.runId === turn.runId ? props.live : undefined;
        const runProjection = projectLiveRunTranscript(nodesForRun(props.transcriptNodes, turn.runId), live);
        const pending = pendingForTurn(props.pending, turn.runId);
        return turn.status === "failed"
          ? <AssistantFailureMessage key={turn.turnId} content={turn.content} model={model} />
          : (
            <AssistantMessage
              key={turn.turnId}
              content={runProjection.answer?.text ?? turn.content}
              live={runProjection.answer?.streaming === true}
              liveTone={runProjection.answer?.tone}
              model={model}
              transcriptNodes={runProjection.nodes}
              pending={pending}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy}
            />
          );
      })}
    </div>
  );
}

function UserMessage({ content }: { readonly content: string }): React.ReactElement {
  return (
    <article className="user-message">
      <div>
        <RichText text={content} />
      </div>
    </article>
  );
}

function AssistantMessage(props: {
  readonly content: string;
  readonly live?: boolean;
  readonly liveTone?: LiveAnswerTone;
  readonly model?: AssistantModelBadge;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly pending?: ConfirmationProjection;
  readonly deliverable?: AgentDeliverable;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
}): React.ReactElement {
  const visible = userVisibleAnswer(props.content).trim();
  const hasAnswer = visible.length > 0;
  const nodes = props.transcriptNodes ?? [];
  const live = props.live === true;
  return (
    <article className="assistant-message">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AgentWorkTimeline
          nodes={nodes}
          pending={props.pending}
          onDecision={props.onDecision}
          confirmationBusy={props.confirmationBusy === true}
        />
        {hasAnswer && (
          live
            ? (
                <LiveStreamBox
                  text={visible}
                  live={true}
                  tone={props.liveTone ?? "formal"}
                  renderText={(displayed) => <RichText text={displayed} />}
                />
              )
            : <AssistantAnswerBlock
                text={visible}
                copyText={visible}
                showActions={true}
              />
        )}
        {props.deliverable !== undefined && <ResultPreview deliverable={props.deliverable} />}
      </div>
    </article>
  );
}

function AssistantFailureMessage(props: {
  readonly content: string;
  readonly model?: AssistantModelBadge;
}): React.ReactElement {
  const message = sanitizeFailureCopy(props.content);
  return (
    <article className="assistant-message assistant-message-failed">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <p className="assistant-error-message">{message}</p>
      </div>
    </article>
  );
}

function AssistantAnswerBlock(props: {
  readonly text: string;
  readonly copyText: string;
  readonly showActions: boolean;
}): React.ReactElement {
  return (
    <div className="assistant-answer">
      <RichText text={props.text} />
      {props.showActions && (
        <div className="turn-actions">
          <button type="button" onClick={() => copyToClipboard(props.copyText)}>
            <Copy size={13} />
            复制
          </button>
        </div>
      )}
    </div>
  );
}

function ResultPreview({ deliverable }: { readonly deliverable: AgentDeliverable }): React.ReactElement {
  const nextActions = deliverable.nextActions ?? [];
  return (
    <>
      <article className="result-preview">
        <header>
          <FileText size={16} />
          <h2>{deliverable.title}</h2>
        </header>
        <div className="result-summary">
          <RichText text={deliverable.summary} />
        </div>
        {deliverable.sections.slice(0, 4).map((section) => (
          <section key={section.sectionId}>
            <h3>{section.title}</h3>
            <RichText text={section.content} />
          </section>
        ))}
        {deliverable.evidenceRefs.length > 0 && <EvidenceRefs refs={deliverable.evidenceRefs} />}
      </article>
      {nextActions.length > 0 && <NextSteps actions={nextActions} />}
    </>
  );
}

function EvidenceRefs({ refs }: { readonly refs: readonly ObservationRef[] }): React.ReactElement {
  return (
    <section className="evidence-refs" aria-label="证据">
      <h3>证据</h3>
      <div>
        {refs.slice(0, 6).map((ref) => (
          <span key={`${ref.kind}:${ref.id}`}>{ref.label ?? ref.id}</span>
        ))}
      </div>
    </section>
  );
}

function NextSteps({ actions }: { readonly actions: readonly string[] }): React.ReactElement {
  return (
    <section className="next-steps">
      <div>
        <ClipboardList size={15} />
        <h2>下一步</h2>
      </div>
      <ul>
        {actions.slice(0, 5).map((action) => <li key={action}>{action}</li>)}
      </ul>
    </section>
  );
}

function StatusNotice(props: { readonly title: string; readonly message: string; readonly tone: "warning" | "error" }): React.ReactElement {
  return (
    <article className={`status-notice ${props.tone}`}>
      <h2>{props.title}</h2>
      <RichText text={props.message} />
    </article>
  );
}

function AssistantAvatar({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  return (
    <div className="assistant-avatar" aria-label={model === undefined ? "助手" : `${model.providerLabel} ${model.modelName}`}>
      {model?.iconSvg === undefined
        ? <Sparkles size={13} aria-hidden="true" />
        : <span className="assistant-avatar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: model.iconSvg }} />}
    </div>
  );
}

function TypingDots(): React.ReactElement {
  return (
    <div className="typing-dots" aria-label="正在整理">
      <span />
      <span />
      <span />
    </div>
  );
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}
