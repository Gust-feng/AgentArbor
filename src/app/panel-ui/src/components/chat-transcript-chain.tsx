import React, { useCallback, useLayoutEffect, useRef } from "react";
import {
  Copy,
} from "lucide-react";
import type { ConversationTurn } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopWorkView,
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
  readonly workView?: DesktopWorkView;
  readonly pending?: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  const emptyAssistantShellsRef = useRef<AssistantShellSnapshot>(assistantShellSnapshot([]));
  useLayoutEffect(() => {
    emptyAssistantShellsRef.current = assistantShellSnapshot(props.turns.map((projection) => projection.turn));
  }, [props.turns]);

  // 稳定化 onDecision 回调，使 React.memo 可以跳过已完成 turn
  const onDecisionRef = useRef(props.onDecision);
  onDecisionRef.current = props.onDecision;
  const stableOnDecision = useCallback((decision: "approve_once" | "deny" | "guidance", guidance?: string) => {
    onDecisionRef.current(decision, guidance);
  }, []);

  if (props.turns.length === 0) return null;

  const turns = props.turns.map((projection) => projection.turn);
  const latestAssistantTurnId = latestAssistantTurnIdForTurns(turns);
  const shells = emptyAssistantShellsRef.current;

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
          previousEmptyShells: shells,
          run: props.run,
          transcriptNodes: props.transcriptNodes,
          live: props.live,
          workView: props.workView,
          pending: props.pending,
        });
        const model = assistantModelForTurn(turn, props.models, props.selectedModelId);
        const collapseTimeline = shouldCollapseTimelineAfterTurn({
          displayRunId: assistant.displayRunId,
          live: assistant.live,
          pending: assistant.pending,
          run: props.run,
          turnStatus: turn.status,
        });

        return turn.status === "failed"
          ? (
            <AssistantFailureMessage
              key={turn.turnId}
              content={turn.content}
              model={model}
              transcriptNodes={assistant.runProjection.nodes}
              collapseTimeline={collapseTimeline}
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
              collapseTimeline={collapseTimeline}
              pending={assistant.pending}
              deliverable={assistant.deliverable}
              onDecision={stableOnDecision}
              confirmationBusy={assistant.pending !== undefined && props.confirmationBusy}
            />
          );
      })}
    </div>
  );
}

const UserMessage = React.memo(function UserMessage({ content, status }: { readonly content: string; readonly status: string }): React.ReactElement {
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
});

type AssistantMessageProps = {
  readonly content: string;
  readonly live?: boolean;
  readonly keepStreamMounted?: boolean;
  readonly animateOnMount?: boolean;
  readonly liveTone?: LiveAnswerTone;
  readonly model?: AssistantModelBadge;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly collapseTimeline?: boolean;
  readonly pending?: ConfirmationProjection;
  readonly deliverable?: AgentDeliverable;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
};

export function AssistantMessage(props: AssistantMessageProps): React.ReactElement {
  return <MemoAssistantMessage {...props} />;
}

const MemoAssistantMessage = React.memo(function AssistantMessageContent(props: AssistantMessageProps): React.ReactElement {
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
    <article className={`assistant-message assistant-workline ${props.collapseTimeline === true ? "assistant-workline-collapsed" : ""}`}>
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AgentWorkTimeline
          view={view.timeline}
          collapsed={props.collapseTimeline === true}
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
}, assistantMessagePropsEqual);

const AssistantPendingBlock = React.memo(function AssistantPendingBlock(): React.ReactElement {
  return (
    <div className="assistant-answer assistant-answer-pending" aria-label="正在输出">
      <TypingDots />
    </div>
  );
});

type AssistantFailureMessageProps = {
  readonly content: string;
  readonly model?: AssistantModelBadge;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly collapseTimeline?: boolean;
};

const AssistantFailureMessage = React.memo(function AssistantFailureMessage(props: AssistantFailureMessageProps): React.ReactElement {
  const failure = assistantFailureParts(props.content);
  const timeline = projectAgentWorkTimelineView<TranscriptNode, ConfirmationProjection>({ nodes: props.transcriptNodes ?? [] });
  return (
    <article className={`assistant-message assistant-message-failed ${props.collapseTimeline === true ? "assistant-workline-collapsed" : ""}`}>
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AgentWorkTimeline
          view={timeline}
          collapsed={props.collapseTimeline === true}
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
}, assistantFailureMessagePropsEqual);

const AssistantAnswerBlock = React.memo(function AssistantAnswerBlock(props: {
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
        renderStreamingText={(displayed) => (
          <div className="rich-text rich-text-streaming">{displayed}</div>
        )}
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
});

export function AssistantAvatar({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  return <MemoAssistantAvatar model={model} />;
}

const MemoAssistantAvatar = React.memo(function AssistantAvatarContent({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  return (
    <div className="assistant-avatar" aria-label={model === undefined ? "助手" : `${model.providerLabel} ${model.modelName}`}>
      {model?.iconSvg === undefined
        ? <span className="assistant-avatar-initial" aria-hidden="true">{assistantAvatarInitial(model)}</span>
        : <span className="assistant-avatar-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: model.iconSvg }} />}
    </div>
  );
}, (left, right) => assistantModelBadgesEqual(left.model, right.model));

export function TypingDots(): React.ReactElement {
  return <MemoTypingDots />;
}

const MemoTypingDots = React.memo(function TypingDotsContent(): React.ReactElement {
  return (
    <div className="typing-dots" aria-label="正在整理">
      <span />
      <span />
      <span />
    </div>
  );
});

function assistantMessagePropsEqual(left: AssistantMessageProps, right: AssistantMessageProps): boolean {
  return left.content === right.content &&
    left.live === right.live &&
    left.keepStreamMounted === right.keepStreamMounted &&
    left.animateOnMount === right.animateOnMount &&
    left.liveTone === right.liveTone &&
    assistantModelBadgesEqual(left.model, right.model) &&
    transcriptNodeListsEqual(left.transcriptNodes, right.transcriptNodes) &&
    left.collapseTimeline === right.collapseTimeline &&
    left.pending === right.pending &&
    left.deliverable === right.deliverable &&
    left.onDecision === right.onDecision &&
    left.confirmationBusy === right.confirmationBusy;
}

function assistantFailureMessagePropsEqual(left: AssistantFailureMessageProps, right: AssistantFailureMessageProps): boolean {
  return left.content === right.content &&
    assistantModelBadgesEqual(left.model, right.model) &&
    transcriptNodeListsEqual(left.transcriptNodes, right.transcriptNodes) &&
    left.collapseTimeline === right.collapseTimeline;
}

function assistantModelBadgesEqual(left: AssistantModelBadge | undefined, right: AssistantModelBadge | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.modelName === right.modelName &&
    left.providerLabel === right.providerLabel &&
    left.providerIdentity === right.providerIdentity &&
    left.iconSvg === right.iconSvg;
}

function transcriptNodeListsEqual(
  left: readonly TranscriptNode[] | undefined,
  right: readonly TranscriptNode[] | undefined
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}

function assistantAvatarInitial(model: AssistantModelBadge | undefined): string {
  return (model?.providerLabel.trim() || model?.modelName.trim() || "A").slice(0, 1).toUpperCase();
}

function shouldCollapseTimelineAfterTurn(input: {
  readonly displayRunId?: string;
  readonly live: boolean;
  readonly pending?: ConfirmationProjection;
  readonly run?: BasicAgentRun;
  readonly turnStatus: string;
}): boolean {
  if (input.live || input.pending !== undefined) return false;
  if (input.displayRunId !== undefined && input.run?.runId === input.displayRunId) {
    return isSettledRunStatus(input.run.status);
  }
  return isSettledTurnStatus(input.turnStatus);
}

function isSettledRunStatus(status: BasicAgentRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

function isSettledTurnStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}
