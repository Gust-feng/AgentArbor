/**
 * Redesign 风格对话转录渲染器。
 *
 * 消费与旧 TranscriptChain 完全相同的 ConversationDisplayItem[] 数据，
 * 但用 Redesign 的 --aa-* 设计 token 和 inline style 渲染，
 * 不再依赖旧 styles/ 目录中的 CSS 类。
 *
 * 数据权威不变：projectConversationDisplayList 产出什么，这里就渲染什么。
 * 全量可见性不变：工具活动、确认流、失败归因、Sub-Agent 嵌套全部保留。
 */
import React, { useCallback, useMemo, useSyncExternalStore, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  Terminal,
  Search,
  Globe2,
  Pencil,
  FolderOpen,
  Bot,
  Wrench,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ConversationTurn, ConversationTurnAttachment } from "../../../../contracts/conversation";
import type { AgentDeliverable, BasicAgentRun, DesktopWorkView, TranscriptNode } from "../../../../contracts/run";
import type { ToolCallResult } from "../../../../../../../domain/tools";
import type { LiveRunBuffer } from "../../../../../../panel-read-model/run/panel-run-live-buffer";
import type { WorklineProjectedTurn } from "../../../../../../panel-read-model/assistant/panel-assistant-workline";
import type { LiveRunTranscriptProjection } from "../../../../../../panel-read-model/transcript/panel-live-transcript";
import { projectConversationDisplayList } from "../../../../../../panel-conversation/panel-conversation-display-list";
import { shouldCollapseStandaloneTimeline } from "../../../../../../panel-read-model/assistant/panel-assistant-timeline-collapse";
import {
  getTranscriptCache,
  subscribeTranscriptCache,
  transcriptNodesCacheForConversation,
  transcriptToolResultsCacheForConversation,
} from "../../../../panel-ui-transcript-store";
import type { ChatModelOption } from "../../../../components/chat-empty";
import type { ConfirmationProjection } from "../../../../components/transcript-timeline";
import { RichText, StreamingRichText } from "../../../../components/rich-text";
import { ConfirmationNode } from "../../../../components/transcript-confirmation";
import { ActivityEvidencePanel } from "../../../../components/activity-evidence";
import { toolResultForActivity } from "../../../../tool-result-association";
import { RADII, contentCard } from "./tokens";
import type {
  ConversationDisplayItem,
} from "../../../../../../panel-conversation/panel-conversation-display-list";
import type { AssistantWorkflowDisplay } from "../../../../../../panel-read-model/assistant/panel-assistant-workflow-display";
import {
  isVisibleOrdinaryActivityItem,
  resolveActivityToolKind,
  type ActivityItem,
} from "../../../../../../panel-read-model/transcript/panel-transcript-activity-copy";
import type { AgentWorkTimelineView } from "../../../../../../panel-read-model/assistant/panel-agent-work-timeline-view";
import { projectAgentWorkTimelineView } from "../../../../../../panel-read-model/assistant/panel-agent-work-timeline-view";
import {
  assistantTerminalNoticeTitle,
  type AssistantFailureParts,
  type AssistantTerminalStatus,
} from "../../../../../../panel-read-model/assistant/panel-assistant-failure";

/* ─── 主入口 ─── */

export type RedesignTranscriptProps = {
  readonly conversationId?: string;
  readonly projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[];
  readonly turns: readonly ConversationTurn[];
  readonly currentRunId?: string;
  readonly currentRunNodes: readonly TranscriptNode[];
  readonly currentRunToolResults: readonly ToolCallResult[];
  readonly run?: BasicAgentRun;
  readonly live?: LiveRunBuffer;
  readonly workView?: DesktopWorkView;
  readonly pending?: ConfirmationProjection;
  readonly showModelUsage: boolean;
  readonly standaloneRun?: {
    readonly currentRunId?: string;
    readonly runStatus?: string;
    readonly answer?: string;
    readonly deliverable?: AgentDeliverable;
    readonly runProjection: LiveRunTranscriptProjection & { readonly nodes: readonly TranscriptNode[] };
    readonly pending?: ConfirmationProjection;
  };
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
};

export function RedesignTranscript(props: RedesignTranscriptProps): React.ReactElement | null {
  const cachedHistoricalSnapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeTranscriptCache(props.conversationId, listener),
      [props.conversationId],
    ),
    getTranscriptCache,
    getTranscriptCache,
  );
  const cachedHistoricalNodes = transcriptNodesCacheForConversation(cachedHistoricalSnapshot, props.conversationId);
  const cachedHistoricalToolResults = transcriptToolResultsCacheForConversation(
    cachedHistoricalSnapshot,
    props.conversationId,
  );
  const toolResultsByRunId = useMemo(() => props.currentRunId === undefined
    ? cachedHistoricalToolResults
    : {
        ...cachedHistoricalToolResults,
        [props.currentRunId]: props.currentRunToolResults,
      }, [cachedHistoricalToolResults, props.currentRunId, props.currentRunToolResults]);
  const conversationDisplay = useMemo(() => {
    const collapseTimeline = shouldCollapseStandaloneTimeline({
      runStatus: props.standaloneRun?.runStatus,
      hasPendingConfirmation: props.standaloneRun?.pending !== undefined,
    });
    return projectConversationDisplayList({
      conversationId: props.conversationId,
      projectedTurns: props.projectedTurns,
      turns: props.turns,
      cachedNodesByRunId: cachedHistoricalNodes,
      currentRunId: props.currentRunId,
      currentRunNodes: props.currentRunNodes,
      run: props.run,
      live: props.live,
      workView: props.workView,
      pending: props.pending,
      standaloneRun: props.standaloneRun === undefined ? undefined : { ...props.standaloneRun, collapseTimeline },
    });
  }, [
    cachedHistoricalNodes, props.conversationId, props.projectedTurns, props.turns,
    props.currentRunId, props.currentRunNodes, props.run, props.live, props.workView,
    props.pending, props.standaloneRun,
  ]);

  const items = conversationDisplay.items;
  if (items.length === 0) return null;

  return (
    <div className="space-y-6">
      {items.map((item) => {
        if (item.kind === "user") {
          return <RedesignUserMessage key={item.key} content={item.turn.content} attachments={item.turn.attachments} />;
        }
        if (item.failure !== undefined) {
          return (
            <RedesignFailureMessage
              key={item.key}
              failure={item.failure}
              terminalStatus={item.terminalStatus}
              workflow={item.workflow}
              toolResultsByRunId={toolResultsByRunId}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy}
            />
          );
        }
        return (
          <RedesignAssistantMessage
            key={item.key}
            live={item.live}
            workflow={item.workflow}
            toolResultsByRunId={toolResultsByRunId}
            onDecision={props.onDecision}
            confirmationBusy={item.hasPendingConfirmation && props.confirmationBusy}
          />
        );
      })}
    </div>
  );
}

/* ─── 用户消息 ─── */

const RedesignUserMessage = React.memo(function RedesignUserMessage(props: {
  readonly content: string;
  readonly attachments?: readonly ConversationTurnAttachment[];
}) {
  const attachments = props.attachments?.filter((a) => a.attachmentId.trim().length > 0) ?? [];
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[520px] flex-col items-end gap-1.5">
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.attachmentId}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                style={{ background: "var(--aa-surface-hover, #eeebe6)", color: "var(--aa-text-2)" }}
              >
                <FileText size={11} className="shrink-0" />
                <span className="max-w-[160px] truncate">{attachment.title}</span>
              </span>
            ))}
          </div>
        )}
        {props.content.trim().length > 0 && (
          <div
            className="px-4 py-3 text-sm"
            style={{ ...contentCard, background: "#ffffff", lineHeight: 1.75, color: "var(--aa-text-1)" }}
          >
            <RichText text={props.content} />
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── 助手消息 ─── */

function RedesignAssistantMessage(props: {
  readonly live?: boolean;
  readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
  readonly toolResultsByRunId: Readonly<Record<string, readonly ToolCallResult[]>>;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy?: boolean;
}) {
  const workflow = props.workflow;
  if (workflow === undefined) {
    return <RedesignPendingDots />;
  }
  return (
    <div className="space-y-3">
      {workflow.segments.map((segment, index) => {
        if (segment.kind === "activity") {
          return (
            <RedesignActivityTimeline
              key={segment.segmentKey}
              timeline={segment.timeline}
              collapsed={segment.collapsed}
              lifecycle={segment.lifecycle}
              onDecision={props.onDecision}
              confirmationBusy={props.confirmationBusy === true}
              toolResultsByRunId={props.toolResultsByRunId}
            />
          );
        }
        if (segment.kind === "awaiting") {
          return <RedesignPendingDots key={`awaiting-${index}`} />;
        }
        return (
          <RedesignAnswerBlock
            key={segment.segmentKey}
            text={segment.text}
            live={props.live === true && index === workflow.segments.length - 1}
          />
        );
      })}
    </div>
  );
}

/* ─── 失败消息 ─── */

function RedesignFailureMessage(props: {
  readonly failure: AssistantFailureParts;
  readonly terminalStatus?: AssistantTerminalStatus;
  readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;
  readonly toolResultsByRunId: Readonly<Record<string, readonly ToolCallResult[]>>;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}) {
  const workflow = props.workflow;
  const bodySegments = workflow?.segments.filter((s) => s.kind !== "activity") ?? [];
  const activitySegments = workflow?.segments.filter((s) => s.kind === "activity") ?? [];
  return (
    <div className="space-y-3">
      {bodySegments.map((segment, index) => {
        if (segment.kind === "awaiting") return <RedesignPendingDots key={`a-${index}`} />;
        return <RedesignAnswerBlock key={segment.segmentKey} text={segment.text} live={false} />;
      })}
      {/* 失败通知 */}
      <div
        className="flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm"
        style={{ background: "rgba(200,64,64,0.06)", border: "1px solid rgba(200,64,64,0.15)", color: "var(--aa-text-1)" }}
      >
        <CircleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--aa-status-error, #C84040)" }} />
        <div className="min-w-0 space-y-1">
          <p className="font-medium" style={{ color: "var(--aa-status-error, #C84040)" }}>
            {assistantTerminalNoticeTitle(props.terminalStatus ?? "failed")}
          </p>
          {props.failure.error !== undefined && (
            <p className="text-xs" style={{ color: "var(--aa-text-2)", lineHeight: 1.6 }}>{props.failure.error}</p>
          )}
        </div>
      </div>
      {activitySegments.map((segment) => (
        segment.kind === "activity" ? (
          <RedesignActivityTimeline
            key={segment.segmentKey}
            timeline={segment.timeline}
            collapsed={segment.collapsed}
            lifecycle={segment.lifecycle}
            onDecision={props.onDecision}
            confirmationBusy={props.confirmationBusy}
            toolResultsByRunId={props.toolResultsByRunId}
          />
        ) : null
      ))}
    </div>
  );
}

/* ─── 回答文本块 ─── */

const RedesignAnswerBlock = React.memo(function RedesignAnswerBlock(props: {
  readonly text: string;
  readonly live: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  if (props.text.trim().length === 0) return null;
  return (
    <div
      className="reading-prose group text-sm"
      style={{ color: "var(--aa-text-1)", lineHeight: 1.85 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {props.live ? <StreamingRichText text={props.text} live /> : <RichText text={props.text} />}
      {!props.live && hovered && (
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(props.text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="mt-1.5 flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-black/5"
          style={{ color: "var(--aa-text-3)" }}
        >
          {copied ? <Check size={10} style={{ color: "var(--aa-status-done)" }} /> : <Copy size={10} />}
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </div>
  );
});

/* ─── 等待指示器 ─── */

function RedesignPendingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2" role="status" aria-label="正在处理">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--aa-accent, #6865a7)", opacity: 0.5, animation: `aa-thinking 1.2s ${i * 0.18}s infinite` }}
        />
      ))}
      <style>{`@keyframes aa-thinking{0%,80%,100%{transform:scale(0.7);opacity:0.3}40%{transform:scale(1);opacity:0.75}}`}</style>
    </div>
  );
}

/* ─── 工具活动时间线 ─── */

function RedesignActivityTimeline(props: {
  readonly timeline: AgentWorkTimelineView<TranscriptNode, ConfirmationProjection>;
  readonly collapsed?: boolean;
  readonly lifecycle?: "open" | "settled" | "attention";
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
  readonly toolResultsByRunId: Readonly<Record<string, readonly ToolCallResult[]>>;
}) {
  const { confirmation, items, hasContent } = props.timeline;
  if (!hasContent) return null;
  const visibleItems = items.filter(isVisibleOrdinaryActivityItem);
  if (visibleItems.length === 0 && confirmation.current === undefined) return null;

  const autoOpen = props.lifecycle === "open" || props.lifecycle === "attention" || confirmation.current !== undefined;
  const [open, setOpen] = useState(autoOpen || props.collapsed !== true);

  const doneCount = visibleItems.filter((i) => i.phase === "completed" || i.phase === "failed").length;
  const running = visibleItems.some((i) => i.phase === "executing" || i.phase === "preparing");
  const summaryLabel = running
    ? `工具调用 ${doneCount}/${visibleItems.length}`
    : `工具调用 ${visibleItems.length} 已完成`;

  return (
    <div className="overflow-hidden" style={{ ...contentCard, borderRadius: RADII.md }}>
      {/* 摘要行 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        style={{ color: "var(--aa-text-2)" }}
      >
        <Wrench size={11} style={{ color: "var(--aa-text-3)" }} />
        <span className="font-medium" style={{ color: running ? "var(--aa-accent)" : "var(--aa-status-done, #48A870)" }}>
          {summaryLabel}
        </span>
        {running && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--aa-accent)", animation: "pulse 1.2s infinite" }} />
        )}
        <span className="ml-auto" style={{ color: "var(--aa-text-3)" }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {/* 展开的活动列表 */}
      {open && visibleItems.length > 0 && (
        <div className="space-y-1 px-3 pb-2.5" style={{ borderTop: "1px solid var(--aa-border)" }}>
          <div className="space-y-1.5 pt-2">
            {visibleItems.map((item) => (
              <RedesignActivityItem
                key={item.key}
                item={item}
                toolResult={toolResultForActivity(item, props.timeline.nodes, props.toolResultsByRunId)}
                resolveChildResult={(child) => toolResultForActivity(child, props.timeline.nodes, props.toolResultsByRunId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 确认卡片 */}
      {confirmation.current !== undefined && (
        <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--aa-border)" }}>
          <ConfirmationNode
            confirmation={confirmation.current}
            busy={props.confirmationBusy}
            onDecision={props.onDecision}
          />
        </div>
      )}
    </div>
  );
}

/* ─── 单条活动记录 ─── */

const TOOL_ICONS: Record<string, React.ReactNode> = {
  terminal: <Terminal size={11} />,
  file_read: <FileText size={11} />,
  file_write: <Pencil size={11} />,
  search: <Search size={11} />,
  web: <Globe2 size={11} />,
  folder: <FolderOpen size={11} />,
  sub_agent: <Bot size={11} />,
};

function RedesignActivityItem(props: {
  readonly item: ActivityItem;
  readonly toolResult?: ToolCallResult;
  readonly resolveChildResult: (item: ActivityItem) => ToolCallResult | undefined;
}) {
  const { item } = props;
  const toolKind = item.toolKind ?? resolveActivityToolKind(item);
  const icon = TOOL_ICONS[toolKind] ?? <Wrench size={11} />;
  const isActive = item.phase === "executing" || item.phase === "preparing";
  const isFailed = item.phase === "failed";
  const displayText = item.lead !== undefined ? `${item.lead.action} ${item.lead.subject}` : item.copy.detail;
  const badgeLabel = item.badges?.[0]?.label;
  const hasEvidence = (item.expandedSections?.length ?? 0) > 0 ||
    item.copy.expandedDetail !== undefined ||
    props.toolResult !== undefined;
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0 text-xs" style={{ color: "var(--aa-text-2)" }}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-left"
        onClick={hasEvidence ? () => setOpen((value) => !value) : undefined}
        aria-expanded={hasEvidence ? open : undefined}
        style={{ cursor: hasEvidence ? "pointer" : "default" }}
      >
      {/* 状态指示 */}
      {isActive ? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-t-transparent animate-spin"
          style={{ borderColor: "var(--aa-accent)", borderTopColor: "transparent" }}
        />
      ) : isFailed ? (
        <CircleAlert size={10} className="shrink-0" style={{ color: "var(--aa-status-error, #C84040)" }} />
      ) : (
        <Check size={10} className="shrink-0" style={{ color: "var(--aa-status-done, #48A870)" }} />
      )}
      {/* 工具图标 */}
      <span className="shrink-0" style={{ color: "var(--aa-text-3)", lineHeight: 0 }}>{icon}</span>
      {/* 标签 */}
      <span className="min-w-0 truncate">{displayText}</span>
      {/* 详情 */}
      {badgeLabel !== undefined && (
        <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--aa-text-3)" }}>{badgeLabel}</span>
      )}
      {hasEvidence && (
        <span className="ml-auto shrink-0" style={{ color: "var(--aa-text-3)" }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      )}
      </button>
      {open && hasEvidence && (
        <div className="min-w-0 pb-1 pl-[34px] pt-2">
          <ActivityEvidencePanel item={item} toolResult={props.toolResult} />
        </div>
      )}
      {item.children !== undefined && item.children.length > 0 && (
        <div className="ml-3 mt-1 space-y-1 border-l pl-3" style={{ borderColor: "var(--aa-border)" }}>
          {item.children.map((child) => (
            <RedesignActivityItem
              key={child.key}
              item={child}
              toolResult={props.resolveChildResult(child)}
              resolveChildResult={props.resolveChildResult}
            />
          ))}
        </div>
      )}
    </div>
  );
}
