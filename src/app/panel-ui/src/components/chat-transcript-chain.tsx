import React, { useLayoutEffect, useRef } from "react";
import {
  Copy,
  Sparkles,
} from "lucide-react";
import type { ConversationTurn } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopWorkSession,
  TranscriptNode,
} from "../contracts/run";
import type { LiveAnswerTone } from "../../../panel-ui-live-transcript";
import type { WorklineProjectedTurn } from "../../../panel-ui-chat-workline";
import type { LiveRunBuffer } from "../../../panel-ui-live-run-buffer";
import { projectAssistantMessageView } from "../../../panel-assistant-message-view";
import { LiveStreamBox } from "./live-stream-text";
import { RichText } from "./rich-text";
import type { ChatModelOption } from "./chat-empty";
import { assistantFailureParts } from "../../../panel-assistant-failure";
import {
  assistantModelForTurn,
  type AssistantModelBadge,
} from "./chat-session-projection";
import {
  AgentWorkTimeline,
  type ConfirmationProjection,
} from "./transcript-timeline";
import { projectAgentWorkTimelineView } from "../../../panel-agent-work-timeline-view";
import {
  assistantShellSnapshot,
  latestAssistantTurnIdForTurns,
  projectAssistantTranscriptTurn,
  type AssistantShellSnapshot,
} from "../../../panel-transcript-turn-projection";

export { isRefreshingRunStatus } from "../../../panel-transcript-turn-projection";

export function TranscriptChain(props: {
  readonly turns: readonly WorklineProjectedTurn<ConversationTurn>[];
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly run?: BasicAgentRun;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly live?: LiveRunBuffer;
  readonly workSession?: DesktopWorkSession;
  readonly pending?: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  const emptyAssistantShellsRef = useRef<AssistantShellSnapshot>(assistantShellSnapshot([]));
  useLayoutEffect(() => {
    emptyAssistantShellsRef.current = assistantShellSnapshot(props.turns.map((projection) => projection.turn));
  }, [props.turns]);

  if (props.turns.length === 0) return null;
  const turns = props.turns.map((projection) => projection.turn);
  const latestAssistantTurnId = latestAssistantTurnIdForTurns(turns);
  return (
    <div className="transcript-list">
      {props.turns.map((projection, turnIndex) => {
        const turn = projection.turn;
        if (turn.role === "user") {
          return <UserMessage key={turn.turnId} content={turn.content} status={turn.status} />;
        }
        const assistant = projectAssistantTranscriptTurn({
          projectedTurn: projection,
          turnIndex,
          turns,
          latestAssistantTurnId,
          previousEmptyShells: emptyAssistantShellsRef.current,
          run: props.run,
          transcriptNodes: props.transcriptNodes,
          live: props.live,
          workSession: props.workSession,
          pending: props.pending,
        });
        const model = assistantModelForTurn(turn, props.models, props.selectedModelId);
        return turn.status === "failed"
          ? (
            <AssistantFailureMessage
              key={turn.turnId}
              content={turn.content}
              model={model}
              transcriptNodes={assistant.runProjection.nodes}
            />
          )
          : (
            <AssistantMessage
              key={turn.turnId}
              content={assistant.content}
              live={assistant.live}
              keepStreamMounted={assistant.keepStreamMounted}
              animateOnMount={assistant.animateOnMount}
              liveTone={assistant.liveTone}
              model={model}
              transcriptNodes={assistant.runProjection.nodes}
              pending={assistant.pending}
              deliverable={assistant.deliverable}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy}
            />
          );
      })}
    </div>
  );
}

function UserMessage({ content, status }: { readonly content: string; readonly status: string }): React.ReactElement {
  const queued = status === "pending";
  return (
    <article className="user-message">
      <div>
        <RichText text={content} />
        {queued && (
          <p className="user-message-queued" role="status" aria-label="等待当前回复完成">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </p>
        )}
      </div>
    </article>
  );
}

export function AssistantMessage(props: {
  readonly content: string;
  readonly live?: boolean;
  readonly keepStreamMounted?: boolean;
  readonly animateOnMount?: boolean;
  readonly liveTone?: LiveAnswerTone;
  readonly model?: AssistantModelBadge;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly pending?: ConfirmationProjection;
  readonly deliverable?: AgentDeliverable;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
}): React.ReactElement {
  const view = projectAssistantMessageView({
    content: props.content,
    deliverable: props.deliverable,
    transcriptNodes: props.transcriptNodes,
    pending: props.pending,
    live: props.live,
    keepStreamMounted: props.keepStreamMounted,
    animateOnMount: props.animateOnMount,
    liveTone: props.liveTone,
  });
  return (
    <article className="assistant-message assistant-workline">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AgentWorkTimeline
          view={view.timeline}
          onDecision={props.onDecision}
          confirmationBusy={props.confirmationBusy === true}
        />
        {view.awaitingFirstVisibleOutput && <AssistantPendingBlock />}
        {view.answer !== undefined && (
          <AssistantAnswerBlock
            text={view.answer.text}
            copyText={view.answer.copyText}
            showActions={view.answer.showActions}
            live={view.answer.live}
            animateOnMount={view.answer.animateOnMount}
            liveTone={view.answer.tone}
          />
        )}
      </div>
    </article>
  );
}

function AssistantPendingBlock(): React.ReactElement {
  return (
    <div className="assistant-answer assistant-answer-pending" aria-label="正在输出">
      <TypingDots />
    </div>
  );
}

function AssistantFailureMessage(props: {
  readonly content: string;
  readonly model?: AssistantModelBadge;
  readonly transcriptNodes?: readonly TranscriptNode[];
}): React.ReactElement {
  const failure = assistantFailureParts(props.content);
  const timeline = projectAgentWorkTimelineView<TranscriptNode, ConfirmationProjection>({ nodes: props.transcriptNodes ?? [] });
  return (
    <article className="assistant-message assistant-message-failed">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AgentWorkTimeline
          view={timeline}
          confirmationBusy={false}
        />
        {failure.previous.length > 0 && (
          <AssistantAnswerBlock
            text={failure.previous}
            copyText={failure.previous}
            showActions={true}
          />
        )}
        <p className="assistant-error-message">{failure.error}</p>
      </div>
    </article>
  );
}

function AssistantAnswerBlock(props: {
  readonly text: string;
  readonly copyText: string;
  readonly showActions: boolean;
  readonly live?: boolean;
  readonly animateOnMount?: boolean;
  readonly liveTone?: LiveAnswerTone;
}): React.ReactElement {
  return (
    <div className="assistant-answer">
      <LiveStreamBox
        text={props.text}
        live={props.live === true}
        animateOnMount={props.animateOnMount === true}
        tone={props.liveTone ?? "formal"}
        renderText={(displayed) => <RichText text={displayed} />}
      />
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

export function AssistantAvatar({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  return (
    <div className="assistant-avatar" aria-label={model === undefined ? "助手" : `${model.providerLabel} ${model.modelName}`}>
      {model?.iconSvg === undefined
        ? <Sparkles size={13} aria-hidden="true" />
        : <span className="assistant-avatar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: model.iconSvg }} />}
    </div>
  );
}

export function TypingDots(): React.ReactElement {
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
