import React, { useCallback, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Copy,
  Gauge,
  Zap,
  type LucideIcon,
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
        <AssistantResponseMeta workflow={workflow} />
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
        {workflow !== undefined && <AssistantResponseMeta workflow={workflow} />}
        <AssistantFailureNotice error={props.failure.error} />
        {activitySegments.length > 0 && (
          <div className="assistant-failure-activity">
            {activitySegments.map((segment) => (
              <AssistantWorkflowSegment
                key={segment.segmentKey}
                segment={segment}
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

const AssistantResponseMeta = React.memo(function AssistantResponseMeta(props: {
  readonly workflow: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
}): React.ReactElement | null {
  const showActions = props.workflow.copyText.trim().length > 0 && props.workflow.showCopyActions;
  const usage = workflowModelUsage(props.workflow);
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
        <span key={item.key} title={item.title}>
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
