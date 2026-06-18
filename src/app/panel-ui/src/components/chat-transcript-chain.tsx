import React, { useCallback, useRef } from "react";
import {
  Copy,
} from "lucide-react";
import type { ConversationTurn } from "../contracts/conversation";
import type {
  TranscriptNode,
} from "../contracts/run";
import type { LiveAnswerTone } from "../../../panel-ui-live-transcript";
import type { AssistantWorkflowDisplay } from "../../../panel-assistant-workflow-display";
import type { ConversationDisplayItem } from "../../../panel-conversation-display-list";
import { LiveStreamBox } from "./live-stream-text";
import { RichText } from "./rich-text";
import type { ChatModelOption } from "./chat-empty";
import type { AssistantFailureParts } from "../../../panel-assistant-failure";
import {
  assistantModelForTurn,
  selectedComposerModel,
  type AssistantModelBadge,
} from "./chat-session-projection";
import {
  AgentWorkTimeline,
  type ConfirmationProjection,
} from "./transcript-timeline";

export { isRefreshingRunStatus } from "../../../panel-transcript-turn-projection";

export function TranscriptChain(props: {
  readonly items: readonly ConversationDisplayItem<ConversationTurn, TranscriptNode, ConfirmationProjection>[];
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
  readonly hiddenEarlierTurnCount?: number;
  readonly onShowEarlierTurns?: () => void;
}): React.ReactElement | null {
  // 稳定化 onDecision 回调，使 React.memo 可以跳过已完成 turn
  const onDecisionRef = useRef(props.onDecision);
  onDecisionRef.current = props.onDecision;
  const stableOnDecision = useCallback((decision: "approve_once" | "deny" | "guidance", guidance?: string) => {
    onDecisionRef.current(decision, guidance);
  }, []);
  const items = props.items;
  if (items.length === 0) return null;

  return (
    <div className="transcript-list">
      {(props.hiddenEarlierTurnCount ?? 0) > 0 && props.onShowEarlierTurns !== undefined && (
        <button
          type="button"
          className="transcript-load-earlier"
          onClick={props.onShowEarlierTurns}
        >
          查看更早消息
        </button>
      )}
      {items.map((item) => {
        if (item.kind === "user") {
          return <UserMessage key={item.key} content={item.turn.content} status={item.turn.status} />;
        }
        const model = item.source === "turn" && item.turn !== undefined
          ? assistantModelForTurn(item.turn, props.models, props.selectedModelId)
          : selectedComposerModel(props.models, props.selectedModelId);
        return item.failure !== undefined
          ? (
            <AssistantFailureMessage
              key={item.key}
              failure={item.failure}
              model={model}
              workflow={item.workflow}
            />
          )
          : (
            <AssistantMessage
              key={item.key}
              live={item.live}
              animateOnMount={item.animateOnMount}
              model={model}
              workflow={item.workflow}
              onDecision={stableOnDecision}
              confirmationBusy={item.hasPendingConfirmation && props.confirmationBusy}
            />
          );
      })}
    </div>
  );
}

const UserMessage = React.memo(function UserMessage({ content, status }: { readonly content: string; readonly status: string }): React.ReactElement {
  const queued = status === "pending";
  return (
    <article className="user-message" {...(queued ? { "data-entering": "" } : undefined)}>
      <div className="user-message-wrap">
        <div className="user-message-content">
          <RichText text={content} />
        </div>
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
  readonly live?: boolean;
  readonly animateOnMount?: boolean;
  readonly model?: AssistantModelBadge;
  readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
};

export function AssistantMessage(props: AssistantMessageProps): React.ReactElement {
  return <MemoAssistantMessage {...props} />;
}

const MemoAssistantMessage = React.memo(function AssistantMessageContent(props: AssistantMessageProps): React.ReactElement {
  const workflow = props.workflow;
  if (workflow === undefined) {
    return <AssistantPendingBlock />;
  }
  const entering = props.animateOnMount === true || props.live === true;
  return (
    <article
      className="assistant-message assistant-workline"
      {...(entering ? { "data-entering": "" } : undefined)}
    >
      <AssistantMessageLabel model={props.model} />
      <div className="assistant-message-body">
        {workflow.segments.map((segment, index) => {
          return (
            <AssistantWorkflowSegment
              key={segment.kind === "awaiting" ? `awaiting-${index}` : segment.segmentKey}
              segment={segment}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy === true}
            />
          );
        })}
        {workflow.copyText.trim().length > 0 && workflow.showCopyActions && (
          <div className="turn-actions">
            <button type="button" onClick={() => copyToClipboard(workflow.copyText)}>
              <Copy size={13} />
              复制
            </button>
          </div>
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
  readonly failure: AssistantFailureParts;
  readonly model?: AssistantModelBadge;
  readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
};

const AssistantFailureMessage = React.memo(function AssistantFailureMessage(props: AssistantFailureMessageProps): React.ReactElement {
  const workflow = props.workflow;
  const collapsedClass = workflowHasCollapsedActivity(workflow) ? " assistant-workline-collapsed" : "";
  return (
    <article className={`assistant-message assistant-message-failed assistant-workline${collapsedClass}`}>
      <AssistantMessageLabel model={props.model} />
      <div className="assistant-message-body">
        {workflow !== undefined
          ? workflow.segments.map((segment, index) => (
            <AssistantWorkflowSegment
              key={segment.kind === "awaiting" ? `awaiting-${index}` : segment.segmentKey}
              segment={segment}
              confirmationBusy={false}
            />
          ))
          : props.failure.previous.length > 0 && (
          <AssistantAnswerBlock
            text={props.failure.previous}
            copyText={props.failure.previous}
            showActions={true}
          />
        )}
        {workflow !== undefined && workflow.copyText.trim().length > 0 && workflow.showCopyActions && (
          <div className="turn-actions">
            <button type="button" onClick={() => copyToClipboard(workflow.copyText)}>
              <Copy size={13} />
              复制
            </button>
          </div>
        )}
        <p className="assistant-error-message">{props.failure.error}</p>
      </div>
    </article>
  );
}, assistantFailureMessagePropsEqual);

function AssistantWorkflowSegment(props: {
  readonly segment: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>["segments"][number];
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const segment = props.segment;
  if (segment.kind === "activity") {
    return (
      <AgentWorkTimeline
        view={segment.timeline}
        collapsed={segment.collapsed}
        lifecycle={segment.lifecycle}
        collapseReason={segment.collapseReason}
        onDecision={props.onDecision}
        confirmationBusy={props.confirmationBusy}
      />
    );
  }
  if (segment.kind === "awaiting") {
    return <AssistantPendingBlock />;
  }
  return (
    <AssistantAnswerBlock
      text={segment.text}
      copyText={segment.copyText}
      showActions={false}
      live={segment.live}
      animateOnMount={segment.animateOnMount}
      liveTone={segment.tone}
    />
  );
}

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
          <div className="rich-text rich-text-streaming">{streamingPreviewText(displayed)}</div>
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

function AssistantMessageLabel({ model }: { readonly model?: AssistantModelBadge }): React.ReactElement {
  const modelLabel = assistantModelLabel(model);
  return (
    <div className="assistant-message-label">
      {model?.iconSvg !== undefined && (
        <span className="assistant-message-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: model.iconSvg }} />
      )}
      {modelLabel !== undefined && <span className="assistant-message-model">{modelLabel}</span>}
    </div>
  );
}

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
  return left.workflow === right.workflow &&
    left.live === right.live &&
    left.animateOnMount === right.animateOnMount &&
    assistantModelBadgesEqual(left.model, right.model) &&
    left.onDecision === right.onDecision &&
    left.confirmationBusy === right.confirmationBusy;
}

function assistantFailureMessagePropsEqual(left: AssistantFailureMessageProps, right: AssistantFailureMessageProps): boolean {
  return left.failure.previous === right.failure.previous &&
    left.failure.error === right.failure.error &&
    assistantModelBadgesEqual(left.model, right.model) &&
    left.workflow === right.workflow;
}

function assistantModelBadgesEqual(left: AssistantModelBadge | undefined, right: AssistantModelBadge | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.modelName === right.modelName &&
    left.providerLabel === right.providerLabel &&
    left.providerIdentity === right.providerIdentity &&
    left.iconSvg === right.iconSvg;
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}

function workflowHasCollapsedActivity(
  workflow: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection> | undefined,
): boolean {
  return workflow?.segments.some((segment) => segment.kind === "activity" && segment.collapsed) === true;
}

function assistantAvatarInitial(model: AssistantModelBadge | undefined): string {
  return (model?.providerLabel.trim() || model?.modelName.trim() || "A").slice(0, 1).toUpperCase();
}

function assistantModelLabel(model: AssistantModelBadge | undefined): string | undefined {
  if (model === undefined) return undefined;
  const name = model.modelName.trim();
  return name.length > 0 ? name : undefined;
}

function streamingPreviewText(value: string): string {
  return stripTrailingStreamingMarkdown(
    value
      .replace(/\r\n/g, "\n")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-*]\s+/gm, "")
      .replace(/^\d+[.)、]\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
  );
}

function stripTrailingStreamingMarkdown(value: string): string {
  return value
    .replace(/(?:\n(?:[-*]|\d+[.)、]|#{1,6}|>|`{1,3}|\|)\s*)+$/u, "")
    .replace(/(?:\*\*|__|`)+$/u, "")
    .replace(/\s+$/u, "");
}
