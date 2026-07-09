import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Gauge,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ConversationTurn, ConversationTurnAttachment } from "../contracts/conversation";
import { compact } from "../text";
import type {
  SubAgentRunView,
  TranscriptNode,
} from "../contracts/run";
import type { LiveAnswerTone } from "../../../panel-ui-live-transcript";
import { stabilizeStreamingMarkdown } from "../../../panel-ui-streaming";
import type { AssistantWorkflowDisplay } from "../../../panel-read-model/assistant/panel-assistant-workflow-display";
import type { ConversationDisplayItem } from "../../../panel-conversation-display-list";
import { LiveStreamBox } from "./live-stream-text";
import { RichText } from "./rich-text";
import type { ChatModelOption } from "./chat-empty";
import type { AssistantFailureParts } from "../../../panel-read-model/assistant/panel-assistant-failure";
import {
  assistantModelForTurn,
  selectedComposerModel,
  type AssistantModelBadge,
} from "./chat-session-projection";
import { AssistantMessageLabel } from "./assistant-message-label";
import {
  AgentWorkTimeline,
  type ConfirmationProjection,
} from "./transcript-timeline";

export { isRefreshingRunStatus } from "../../../panel-read-model/transcript/panel-transcript-turn-projection";

export function TranscriptChain(props: {
  readonly items: readonly ConversationDisplayItem<ConversationTurn, TranscriptNode, ConfirmationProjection>[];
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly showModelUsage: boolean;
  readonly subAgentRuns?: readonly SubAgentRunView[];
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
          return (
            <UserMessage
              key={item.key}
              content={item.turn.content}
              status={item.turn.status}
              attachments={item.turn.attachments}
            />
          );
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
              showModelUsage={props.showModelUsage}
              subAgentRuns={props.subAgentRuns}
            />
          )
          : (
            <AssistantMessage
              key={item.key}
              live={item.live}
              animateOnMount={item.animateOnMount}
              model={model}
              workflow={item.workflow}
              showModelUsage={props.showModelUsage}
              subAgentRuns={props.subAgentRuns}
              onDecision={stableOnDecision}
              confirmationBusy={item.hasPendingConfirmation && props.confirmationBusy}
            />
          );
      })}
    </div>
  );
}

const UserMessage = React.memo(function UserMessage(props: {
  readonly content: string;
  readonly status: string;
  readonly attachments?: readonly ConversationTurnAttachment[];
}): React.ReactElement {
  const { content, status } = props;
  const queued = status === "pending";
  return (
    <article className="user-message" {...(queued ? { "data-entering": "" } : undefined)}>
      <div className="user-message-wrap">
        <UserMessageAttachments attachments={props.attachments} />
        {content.trim().length > 0 && (
          <UserMessageContent content={content} />
        )}
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

const USER_MESSAGE_COLLAPSE_CHAR_LIMIT = 720;
const USER_MESSAGE_COLLAPSE_LINE_LIMIT = 12;

const UserMessageContent = React.memo(function UserMessageContent(props: {
  readonly content: string;
}): React.ReactElement {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const collapsible = useMemo(() => shouldCollapseUserMessage(props.content), [props.content]);
  const collapsed = collapsible && !expanded;
  return (
    <>
      <div
        id={contentId}
        className="user-message-content"
        {...(collapsible ? { "data-collapsible": "true" } : undefined)}
        {...(collapsed ? { "data-collapsed": "true" } : undefined)}
      >
        <RichText text={props.content} />
      </div>
      {collapsible && (
        <button
          type="button"
          className="user-message-toggle"
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? "收起" : "显示更多"}</span>
          {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
      )}
    </>
  );
});

const UserMessageAttachments = React.memo(function UserMessageAttachments(props: {
  readonly attachments?: readonly ConversationTurnAttachment[];
}): React.ReactElement | null {
  const attachments = props.attachments?.filter((attachment) => attachment.attachmentId.trim().length > 0) ?? [];
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="user-message-attachments" aria-label="已发送附件">
      {attachments.map((attachment) => {
        const mediaPreview = attachment.mediaPreview?.kind === "image" ? attachment.mediaPreview : undefined;
        if (mediaPreview !== undefined) {
          return (
            <figure className="user-message-image-attachment" key={attachment.attachmentId}>
              <img
                src={mediaPreview.url}
                alt={attachment.title}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
              <figcaption>
                <strong>{attachment.title}</strong>
                <span>{compact(attachmentSummary(attachment), 72)}</span>
              </figcaption>
            </figure>
          );
        }
        return (
          <span className="user-message-file-attachment" key={attachment.attachmentId}>
            <strong>{attachment.title}</strong>
            <small>{compact(attachment.summary ?? attachmentSummary(attachment), 72)}</small>
          </span>
        );
      })}
    </div>
  );
});

type AssistantMessageProps = {
  readonly live?: boolean;
  readonly animateOnMount?: boolean;
  readonly model?: AssistantModelBadge;
  readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
  readonly showModelUsage: boolean;
  readonly subAgentRuns?: readonly SubAgentRunView[];
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
              subAgentRuns={props.subAgentRuns}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy === true}
            />
          );
        })}
        <AssistantResponseMeta workflow={workflow} showModelUsage={props.showModelUsage} />
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
  readonly showModelUsage: boolean;
  readonly subAgentRuns?: readonly SubAgentRunView[];
};

const AssistantFailureMessage = React.memo(function AssistantFailureMessage(props: AssistantFailureMessageProps): React.ReactElement {
  const workflow = props.workflow;
  const bodySegments = workflow?.segments.filter((segment) => segment.kind !== "activity") ?? [];
  const activitySegments = workflow?.segments.filter((segment) => segment.kind === "activity") ?? [];
  const collapsedClass = workflowHasCollapsedActivity(workflow) ? " assistant-workline-collapsed" : "";
  return (
    <article className={`assistant-message assistant-message-failed assistant-workline${collapsedClass}`}>
      <AssistantMessageLabel model={props.model} />
      <div className="assistant-message-body">
        {workflow !== undefined
          ? bodySegments.map((segment, index) => (
            <AssistantWorkflowSegment
              key={segment.kind === "awaiting" ? `awaiting-${index}` : segment.segmentKey}
              segment={segment}
              subAgentRuns={props.subAgentRuns}
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
        {workflow !== undefined && <AssistantResponseMeta workflow={workflow} showModelUsage={props.showModelUsage} />}
        <AssistantFailureNotice error={props.failure.error} />
        {activitySegments.length > 0 && (
          <div className="assistant-failure-activity">
            {activitySegments.map((segment) => (
              <AssistantWorkflowSegment
              key={segment.segmentKey}
              segment={segment}
              subAgentRuns={props.subAgentRuns}
              confirmationBusy={false}
            />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}, assistantFailureMessagePropsEqual);

function AssistantWorkflowSegment(props: {
  readonly segment: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>["segments"][number];
  readonly subAgentRuns?: readonly SubAgentRunView[];
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
        subAgentRuns={props.subAgentRuns}
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
          <div className="rich-text rich-text-streaming">
            <RichText text={stabilizeStreamingMarkdown(displayed)} />
          </div>
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

const AssistantResponseMeta = React.memo(function AssistantResponseMeta(props: {
  readonly workflow: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
  readonly showModelUsage: boolean;
}): React.ReactElement | null {
  const showActions = props.workflow.copyText.trim().length > 0 && props.workflow.showCopyActions;
  const usage = props.showModelUsage ? workflowModelUsage(props.workflow) : undefined;
  if (!showActions && usage === undefined) {
    return null;
  }
  return (
    <div className="assistant-response-meta">
      {showActions && (
        <div className="turn-actions">
          <button type="button" onClick={() => copyToClipboard(props.workflow.copyText)}>
            <Copy size={13} />
            复制
          </button>
        </div>
      )}
      <AssistantModelUsageLine usage={usage} />
    </div>
  );
});

type AssistantModelUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly uncachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly latencyMs?: number;
  readonly firstTokenLatencyMs?: number;
  readonly outputDurationMs?: number;
  readonly outputTokensPerSecond?: number;
};

type AssistantModelUsageItem = {
  readonly key: string;
  readonly icon: LucideIcon;
  readonly text: string;
  readonly title: string;
};

const AssistantModelUsageLine = React.memo(function AssistantModelUsageLine(props: {
  readonly usage?: AssistantModelUsage;
}): React.ReactElement | null {
  const items = modelUsageItems(props.usage);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="assistant-model-usage" aria-label="模型 token 信息">
      {items.map((item) => (
        <span key={item.key}>
          <item.icon size={13} strokeWidth={2.2} aria-hidden="true" />
          {item.text}
        </span>
      ))}
    </div>
  );
});

function AssistantFailureNotice(props: {
  readonly error: string;
}): React.ReactElement {
  return (
    <section className="assistant-error-message assistant-failure-notice" aria-label="错误信息">
      <strong>错误信息</strong>
      <RichText text={props.error.replace(/^错误信息[:：]\s*/u, "")} />
    </section>
  );
}

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
    left.showModelUsage === right.showModelUsage &&
    left.live === right.live &&
    left.animateOnMount === right.animateOnMount &&
    assistantModelBadgesEqual(left.model, right.model) &&
    left.subAgentRuns === right.subAgentRuns &&
    left.onDecision === right.onDecision &&
    left.confirmationBusy === right.confirmationBusy;
}

function assistantFailureMessagePropsEqual(left: AssistantFailureMessageProps, right: AssistantFailureMessageProps): boolean {
  return left.failure.previous === right.failure.previous &&
    left.failure.error === right.failure.error &&
    left.showModelUsage === right.showModelUsage &&
    assistantModelBadgesEqual(left.model, right.model) &&
    left.subAgentRuns === right.subAgentRuns &&
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

function shouldCollapseUserMessage(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length > USER_MESSAGE_COLLAPSE_CHAR_LIMIT) {
    return true;
  }
  return normalized.split("\n").length > USER_MESSAGE_COLLAPSE_LINE_LIMIT;
}

function attachmentSummary(attachment: ConversationTurnAttachment): string {
  const mimeType = attachment.mediaPreview?.mimeType ?? attachment.readonlyPreviewMeta?.mimeType;
  const byteLength = attachment.mediaPreview?.byteLength ?? attachment.readonlyPreviewMeta?.byteLength;
  const parts = [mimeType, byteSizeLabel(byteLength)].filter((value): value is string => value !== undefined);
  return parts.length === 0 ? attachment.summary ?? attachment.kind : parts.join(" · ");
}

function byteSizeLabel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} bytes`;
}

function workflowModelUsage(
  workflow: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>
): AssistantModelUsage | undefined {
  return [...workflow.segments]
    .reverse()
    .find((segment): segment is Extract<typeof segment, { readonly kind: "body" }> =>
      segment.kind === "body" && segment.modelUsage !== undefined
    )
    ?.modelUsage;
}

function modelUsageItems(usage: AssistantModelUsage | undefined): readonly AssistantModelUsageItem[] {
  if (usage === undefined) {
    return [];
  }
  const items: AssistantModelUsageItem[] = [];
  const inputItem = inputUsageItem(usage);
  if (inputItem !== undefined) {
    items.push(inputItem);
  }
  const outputText = formatTokenCount(usage.outputTokens);
  if (outputText !== undefined) {
    const reasoningText = formatTokenCount(usage.reasoningOutputTokens);
    items.push({
      key: "output",
      icon: ArrowDown,
      text: reasoningText === undefined ? `${outputText} tokens` : `${outputText} tokens (${reasoningText} reasoning)`,
      title: "输出 token",
    });
  }
  const speedText = formatTokenSpeed(usage.outputTokensPerSecond);
  if (speedText !== undefined) {
    items.push({
      key: "speed",
      icon: Zap,
      text: speedText,
      title: "输出 token 速度",
    });
  }
  const latencyText = formatDuration(usage.latencyMs);
  if (latencyText !== undefined) {
    items.push({
      key: "latency",
      icon: Clock3,
      text: latencyText,
      title: "总耗时",
    });
  }
  const firstTokenText = formatDuration(usage.firstTokenLatencyMs);
  if (firstTokenText !== undefined) {
    items.push({
      key: "first-token",
      icon: Gauge,
      text: `首 token ${firstTokenText}`,
      title: "首 token 延迟",
    });
  }
  return items;
}

function inputUsageItem(usage: AssistantModelUsage): AssistantModelUsageItem | undefined {
  const inputText = formatTokenCount(usage.inputTokens);
  const cachedText = formatTokenCount(usage.cachedInputTokens);
  const uncachedText = formatTokenCount(usage.uncachedInputTokens);
  if (inputText !== undefined) {
    return {
      key: "input",
      icon: ArrowUp,
      text: cachedText === undefined ? `${inputText} tokens` : `${inputText} tokens (${cachedText} cached)`,
      title: "本次模型请求的总输入上下文 token；括号内为 provider 报告的缓存命中部分。系统提示、工具 schema、历史对话和附件上下文都可能计入总输入，命中缓存时计入 cached。",
    };
  }
  if (cachedText !== undefined || uncachedText !== undefined) {
    const parts = [
      uncachedText === undefined ? undefined : `${uncachedText} new`,
      cachedText === undefined ? undefined : `${cachedText} cached`,
    ].filter((part): part is string => part !== undefined);
    return {
      key: "input",
      icon: ArrowUp,
      text: parts.join(" + "),
      title: "输入上下文 token，按 provider usage 拆分为 cache miss 与 cache hit；工具、系统提示和历史前缀命中缓存时计入 cached。",
    };
  }
  return undefined;
}

function formatTokenSpeed(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const fixed = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${trimTrailingZeros(fixed)} tok/s`;
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return undefined;
  }
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1_000;
  return `${trimTrailingZeros((seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)))}s`;
}

function formatTokenCount(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const rounded = Math.max(0, Math.floor(value));
  if (rounded >= 1_000_000) {
    return `${trimTrailingZeros((rounded / 1_000_000).toFixed(1))}M`;
  }
  if (rounded >= 1_000) {
    return `${trimTrailingZeros((rounded / 1_000).toFixed(1))}K`;
  }
  return rounded.toLocaleString("en-US");
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}
