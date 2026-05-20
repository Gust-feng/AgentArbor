import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { compact, eventTitle } from "../text";
import { resolveModelIconSvg } from "../model-icons";
import { modelProviderDisplayName, resolveModelProviderIdentity, type ModelProviderIdentity } from "../model-provider-logos";
import type {
  AgentDeliverable,
  BasicAgentRun,
  Conversation,
  ConversationTurn,
  DesktopRunDetail,
  DesktopWorkSession,
  PendingConfirmation,
  RunEvent,
  ObservationRef,
} from "../types";
import { terminalStatuses } from "../ui-state";
import { RichText } from "./rich-text";
import { ChatInputBar, type ChatInputProps, type ChatModelOption } from "./chat-empty";

type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]>;

type ActivitySummaryItem = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly tone: "active" | "done" | "warning" | "danger" | "muted";
  readonly kind?: "workspace" | "file" | "web" | "search" | "command" | "edit" | "answer" | "approval" | "thinking" | "system";
  readonly result?: ActivityResult;
};

type ActivityGroupKind = "thinking" | "tool" | "context" | "approval" | "work";

type ActivityGroup = {
  readonly id: string;
  readonly kind: ActivityGroupKind;
  readonly title: string;
  readonly summary?: string;
  readonly tone: ActivitySummaryItem["tone"];
  readonly items: readonly ActivitySummaryItem[];
  readonly startIndex: number;
};

type ActivityResultItem = {
  readonly label: string;
  readonly kind?: "file" | "dir" | "item";
  readonly meta?: string;
};

type ActivityResult =
  | {
      readonly kind: "items";
      readonly label: string;
      readonly items: readonly ActivityResultItem[];
      readonly more?: boolean;
    }
  | {
      readonly kind: "search";
      readonly label: string;
      readonly query?: string;
      readonly items: readonly { readonly title: string; readonly url?: string }[];
      readonly more?: boolean;
    }
  | {
      readonly kind: "command";
      readonly command?: string;
      readonly exitCode?: number;
      readonly output?: string;
    }
  | {
      readonly kind: "change";
      readonly path?: string;
      readonly meta?: string;
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

type AssistantTurnBlock =
  | {
      readonly kind: "answer";
      readonly id: string;
      readonly text: string;
      readonly live?: boolean;
    }
  | {
      readonly kind: "activity";
      readonly id: string;
      readonly item: ActivitySummaryItem;
    };

type AssistantTimelineSection =
  | Extract<AssistantTurnBlock, { readonly kind: "answer" }>
  | {
      readonly kind: "workflow";
      readonly id: string;
      readonly items: readonly ActivitySummaryItem[];
    };

type AssistantModelBadge = {
  readonly modelName: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly iconSvg?: string;
};

export function ChatActive(props: ChatInputProps & {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly error?: string;
  readonly pendingConfirmation?: ConfirmationProjection;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turns = useMemo(() => visibleTurns(props.conversation?.turns ?? []), [props.conversation?.turns]);
  const latestAssistantTurn = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.content.trim().length > 0);
  const answer = props.workSession?.answer?.content ?? visibleResultText(props.detail) ?? latestAssistantTurn?.content;
  const pending = props.workSession?.pendingConfirmation ?? props.pendingConfirmation;
  const deliverable = visibleDeliverable(props.workSession?.deliverable, answer, latestAssistantTurn?.content);
  const activityItems = visibleActivityItems(props.events, props.workSession);
  const currentRunActivityItems = activityItemsForRun(props.run?.runId, props.events, props.workSession);
  const liveAnswer = liveStreamingAnswer(props.events);
  const running = props.run !== undefined && !terminalStatuses.has(props.run.status);
  const hasCurrentRunAssistantTurn =
    props.run?.runId !== undefined &&
    turns.some((turn) => turn.role === "assistant" && turn.runId === props.run?.runId && turn.content.trim().length > 0);
  const hasCurrentRunFailedTurn =
    props.run?.runId !== undefined &&
    turns.some((turn) => turn.role === "assistant" && turn.runId === props.run?.runId && turn.status === "failed");
  const shouldShowWorkSession = pending !== undefined || deliverable !== undefined;
  const plainAnswer =
    !shouldShowWorkSession &&
    !hasCurrentRunAssistantTurn &&
    props.run?.status === "completed" &&
    answer !== undefined;
  const blockedStatus = visibleRunProblem(props.run, props.workSession, props.detail, props.error);
  const showLiveAnswer = liveAnswer !== undefined && !hasCurrentRunAssistantTurn;
  const showStatusNotice = blockedStatus !== undefined && !hasCurrentRunFailedTurn;
  const hasVisibleContent = turns.length > 0 || shouldShowWorkSession || plainAnswer || showLiveAnswer || showStatusNotice;
  const latestTurn = turns.at(-1);
  const scrollKey = [
    latestTurn?.turnId,
    latestTurn?.content.length,
    liveAnswer?.length,
    props.run?.status,
    props.run?.eventCursor.lastSequence,
  ].join(":");

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    window.requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [scrollKey]);

  return (
    <div className="chat-active-screen">
      <div className="chat-active-scroll" ref={scrollRef}>
        <div className="chat-active-grid">
          <main className="session-stream" aria-label="任务会话">
            {hasVisibleContent ? (
              <>
                <ConversationTranscript
                  turns={turns}
                  models={props.models}
                  selectedModelId={props.selectedModelId}
                  events={props.events}
                  workSession={props.workSession}
                />
                {shouldShowWorkSession && (
                  <AssistantWorkBlock
                    workSession={props.workSession}
                    pending={pending}
                    deliverable={deliverable}
                    activityItems={activityItems}
                    onDecision={props.onDecision}
                    confirmationBusy={props.confirmationBusy}
                  />
                )}
                {!shouldShowWorkSession && showLiveAnswer && (
                  <AssistantMessage
                    content={liveAnswer}
                    live
                    model={selectedComposerModel(props.models, props.selectedModelId)}
                    blocks={assistantTurnBlocksForRun(props.run?.runId, props.events, props.workSession, liveAnswer, true)}
                  />
                )}
                {plainAnswer && (
                  <AssistantMessage
                    content={answer}
                    model={selectedComposerModel(props.models, props.selectedModelId)}
                    blocks={assistantTurnBlocksForRun(props.run?.runId, props.events, props.workSession, answer)}
                  />
                )}
                {showStatusNotice && blockedStatus !== undefined && <StatusNotice {...blockedStatus} />}
                {running && !shouldShowWorkSession && liveAnswer === undefined && blockedStatus === undefined && !hasCurrentRunAssistantTurn && (
                  <AssistantPendingMessage
                    model={selectedComposerModel(props.models, props.selectedModelId)}
                    activityItems={currentRunActivityItems}
                  />
                )}
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
        {...props}
        running={running}
        placeholder="继续补充、改写计划或让 AgentArbor 执行下一步..."
        variant="floating"
      />
    </div>
  );
}

function ConversationTranscript(props: {
  readonly turns: readonly ConversationTurn[];
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly events: readonly RunEvent[];
  readonly workSession?: DesktopWorkSession;
}): React.ReactElement | null {
  const turns = props.turns;
  if (turns.length === 0) return null;
  return (
    <div className="transcript-list">
      {turns.map((turn) => {
        const model = assistantModelForTurn(turn, props.models, props.selectedModelId);
        const blocks = turn.role === "assistant"
          ? assistantTurnBlocksForRun(turn.runId, props.events, props.workSession, turn.content)
          : [];
        return turn.role === "user"
          ? <UserMessage key={turn.turnId} content={turn.content} />
          : turn.status === "failed"
            ? <AssistantFailureMessage key={turn.turnId} content={turn.content} model={model} blocks={blocks} />
            : <AssistantMessage key={turn.turnId} content={turn.content} model={model} blocks={blocks} />;
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
  readonly model?: AssistantModelBadge;
  readonly blocks?: readonly AssistantTurnBlock[];
}): React.ReactElement {
  const { content, live = false } = props;
  const visible = userVisibleAnswer(content);
  const blocks = normalizeAssistantBlocks(props.blocks, visible, live);
  return (
    <article className="assistant-message">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <AssistantTurnTimeline blocks={blocks} copyText={visible} />
        {live && <TypingDots />}
      </div>
    </article>
  );
}

function AssistantPendingMessage(props: {
  readonly model?: AssistantModelBadge;
  readonly activityItems?: readonly ActivitySummaryItem[];
}): React.ReactElement {
  return (
    <article className="assistant-message assistant-message-pending" aria-label="等待回复">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        <WorkflowFrame items={props.activityItems ?? []} />
        <TypingDots />
      </div>
    </article>
  );
}

function AssistantFailureMessage(props: {
  readonly content: string;
  readonly model?: AssistantModelBadge;
  readonly blocks?: readonly AssistantTurnBlock[];
}): React.ReactElement {
  const visible = userVisibleAnswer(props.content);
  const blocks = normalizeAssistantBlocks(props.blocks, visible);
  return (
    <article className="assistant-message assistant-message-failed">
      <AssistantAvatar model={props.model} />
      <div className="assistant-message-body">
        {blocks.length > 0 ? (
          <AssistantTurnTimeline blocks={blocks} copyText={visible} />
        ) : (
          <div className="assistant-failure-line">
            <AlertTriangle size={14} />
            <RichText text={visible} />
          </div>
        )}
      </div>
    </article>
  );
}

function AssistantWorkBlock(props: {
  readonly workSession?: DesktopWorkSession;
  readonly pending?: ConfirmationProjection;
  readonly deliverable?: AgentDeliverable;
  readonly activityItems: readonly ActivitySummaryItem[];
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const nextActions = props.deliverable?.nextActions ?? props.workSession?.answer?.nextActions ?? [];
  return (
    <article className="assistant-run-message" aria-label="助手回答">
      <AssistantAvatar />
      <div className="assistant-run-body">
        {props.pending !== undefined && (
          <ConfirmationBanner
            confirmation={props.pending}
            busy={props.confirmationBusy}
            onDecision={props.onDecision}
          />
        )}
        <WorkflowFrame items={props.activityItems} />
        {props.deliverable !== undefined && <ResultPreview deliverable={props.deliverable} />}
        {nextActions.length > 0 && <NextSteps actions={nextActions} />}
      </div>
    </article>
  );
}

function ProcessTrace({ items, startIndex = 1 }: { readonly items: readonly ActivitySummaryItem[]; readonly startIndex?: number }): React.ReactElement | null {
  const visibleItems = visibleWorkflowItems(items);
  if (visibleItems.length === 0) return null;
  return (
    <section className="activity-steps" aria-label="工作轨迹">
      {visibleItems.map((item, index) => <ProcessLine item={item} index={startIndex + index} key={item.id} />)}
    </section>
  );
}

function AssistantTurnTimeline(props: {
  readonly blocks: readonly AssistantTurnBlock[];
  readonly copyText: string;
}): React.ReactElement | null {
  if (props.blocks.length === 0) return null;
  const lastAnswerBlock = [...props.blocks].reverse().find((block) => block.kind === "answer" && block.text.trim().length > 0);
  const sections = groupAssistantTimelineSections(props.blocks);
  return (
    <div className="assistant-turn-timeline">
      {sections.map((section) => {
        if (section.kind === "answer") {
          return (
            <AssistantAnswerBlock
              key={section.id}
              text={section.text}
              copyText={props.copyText}
              showActions={section.id === lastAnswerBlock?.id}
            />
          );
        }
        return <WorkflowFrame items={section.items} key={section.id} />;
      })}
    </div>
  );
}

function groupAssistantTimelineSections(blocks: readonly AssistantTurnBlock[]): readonly AssistantTimelineSection[] {
  const sections: AssistantTimelineSection[] = [];
  let pendingItems: ActivitySummaryItem[] = [];

  const flush = (): void => {
    if (pendingItems.length === 0) return;
    sections.push({
      kind: "workflow",
      id: `workflow:${pendingItems[0]?.id ?? sections.length}`,
      items: mergeRepeatedActivityItems(dedupeActivityItems(pendingItems)),
    });
    pendingItems = [];
  };

  for (const block of blocks) {
    if (block.kind === "activity") {
      pendingItems.push(block.item);
      continue;
    }
    flush();
    sections.push(block);
  }
  flush();
  return sections;
}

function visibleWorkflowItems(items: readonly ActivitySummaryItem[]): readonly ActivitySummaryItem[] {
  return mergeRepeatedActivityItems(dedupeActivityItems(items.filter(isUsefulWorkflowItem))).slice(-8);
}

function AssistantAnswerBlock(props: {
  readonly text: string;
  readonly copyText: string;
  readonly showActions: boolean;
}): React.ReactElement {
  const copyText = props.copyText.trim().length > 0 ? props.copyText : props.text;
  return (
    <div className="assistant-answer">
      <RichText text={props.text} />
      {props.showActions && (
        <div className="turn-actions">
          <button type="button" onClick={() => copyToClipboard(copyText)}>
            <Copy size={13} />
            复制
          </button>
        </div>
      )}
    </div>
  );
}

function WorkflowFrame({ items }: { readonly items: readonly ActivitySummaryItem[] }): React.ReactElement | null {
  const visibleItems = visibleWorkflowItems(items);
  const [open, setOpen] = useState(shouldOpenWorkflowFrame(visibleItems));
  useEffect(() => {
    if (shouldOpenWorkflowFrame(visibleItems)) {
      setOpen(true);
    }
  }, [visibleItems]);
  if (visibleItems.length === 0) return null;
  const groups = groupWorkflowItems(visibleItems);
  const meta = workflowFrameMeta(visibleItems);
  return (
    <section className="workflow-frame" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="workflow-frame-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workflow-frame-title">{workflowFrameTitle(visibleItems)}</span>
        {meta !== undefined && <span className="workflow-frame-meta">{meta}</span>}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="workflow-frame-body">
          {groups.length === 1
            ? <ProcessTrace items={groups[0]?.items ?? []} startIndex={groups[0]?.startIndex ?? 1} />
            : (
              <div className="workflow-groups">
                {groups.map((group) => <WorkflowGroupBlock group={group} key={group.id} />)}
              </div>
            )}
        </div>
      )}
    </section>
  );
}

function WorkflowGroupBlock({ group }: { readonly group: ActivityGroup }): React.ReactElement {
  const [open, setOpen] = useState(shouldOpenWorkflowGroup(group));
  useEffect(() => {
    if (shouldOpenWorkflowGroup(group)) {
      setOpen(true);
    }
  }, [group]);
  return (
    <section className={`workflow-group ${group.tone}`} data-kind={group.kind} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="workflow-group-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workflow-group-dot" aria-hidden="true" />
        <span className="workflow-group-copy">
          <strong>{group.title}</strong>
          {group.summary !== undefined && <small>{group.summary}</small>}
        </span>
        {group.items.length > 1 && <span className="workflow-group-count">{group.items.length}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="workflow-group-body">
          <ProcessTrace items={group.items} startIndex={group.startIndex} />
        </div>
      )}
    </section>
  );
}

function shouldOpenWorkflowFrame(items: readonly ActivitySummaryItem[]): boolean {
  return items.some((item) =>
    item.tone === "active" ||
    item.tone === "warning" ||
    item.tone === "danger" ||
    item.kind === "approval"
  );
}

function workflowFrameTitle(items: readonly ActivitySummaryItem[]): string {
  const urgent = items.find((item) => item.tone === "warning" || item.tone === "danger" || item.kind === "approval");
  if (urgent !== undefined) return activityStepDescription(urgent);
  const active = items.find((item) => item.tone === "active");
  if (active !== undefined) return activityStepDescription(active);
  const primaryKind = dominantActivityKind(items);
  if (primaryKind === "file") return "读取文件";
  if (primaryKind === "workspace") return "查看工作区";
  if (primaryKind === "search") return "搜索资料";
  if (primaryKind === "web") return "查看网页";
  if (primaryKind === "command") return "运行命令";
  if (primaryKind === "edit") return "更新文件";
  return "过程";
}

function workflowFrameMeta(items: readonly ActivitySummaryItem[]): string | undefined {
  if (items.some((item) => item.tone === "active")) return "进行中";
  if (items.some((item) => item.tone === "warning" || item.tone === "danger")) return "需注意";
  const mergedResult = summarizeWorkflowResults(items);
  return mergedResult ?? (items.length > 1 ? `${items.length} 步` : undefined);
}

function dominantActivityKind(items: readonly ActivitySummaryItem[]): ActivitySummaryItem["kind"] {
  const counts = new Map<ActivitySummaryItem["kind"], number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function summarizeWorkflowResults(items: readonly ActivitySummaryItem[]): string | undefined {
  if (items.length === 1) {
    const result = items[0]?.result;
    if (result?.kind === "items" || result?.kind === "search") return result.label;
    if (result?.kind === "change" && result.meta !== undefined) return result.meta;
  }
  const itemResults = items
    .map((item) => item.result)
    .filter((result): result is Extract<ActivityResult, { readonly kind: "items" }> => result?.kind === "items");
  if (itemResults.length > 0 && itemResults.length === items.length) {
    const mergedItems = uniqueActivityResultItems(itemResults.flatMap((result) => result.items));
    return itemResultLabel(mergedItems);
  }
  return undefined;
}

function groupWorkflowItems(items: readonly ActivitySummaryItem[]): readonly ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let pending: ActivitySummaryItem[] = [];
  let pendingKind: ActivityGroupKind | undefined;
  let pendingStartIndex = 1;

  const flush = (): void => {
    if (pending.length === 0 || pendingKind === undefined) return;
    groups.push(createActivityGroup(pendingKind, pending, pendingStartIndex, groups.length));
    pending = [];
    pendingKind = undefined;
  };

  items.forEach((item, index) => {
    const kind = activityGroupKind(item);
    if (pendingKind !== undefined && kind !== pendingKind) {
      flush();
    }
    if (pending.length === 0) {
      pendingStartIndex = index + 1;
    }
    pendingKind = kind;
    pending.push(item);
  });
  flush();
  return groups;
}

function createActivityGroup(
  kind: ActivityGroupKind,
  items: readonly ActivitySummaryItem[],
  startIndex: number,
  index: number
): ActivityGroup {
  const primary = primaryActivityItem(items);
  return {
    id: `${kind}:${items[0]?.id ?? index}`,
    kind,
    title: activityGroupTitle(kind, items, primary),
    summary: activityGroupSummary(kind, items, primary),
    tone: activityGroupTone(items),
    items,
    startIndex,
  };
}

function activityGroupKind(item: ActivitySummaryItem): ActivityGroupKind {
  if (item.kind === "approval") return "approval";
  if (item.kind === "thinking" || item.type.startsWith("agent.note") || item.type.startsWith("model.output")) return "thinking";
  if (item.kind === "system" || item.type.startsWith("context.compaction")) return "context";
  if (
    item.kind === "workspace" ||
    item.kind === "file" ||
    item.kind === "web" ||
    item.kind === "search" ||
    item.kind === "command" ||
    item.kind === "edit" ||
    item.type.startsWith("tool.")
  ) {
    return "tool";
  }
  return "work";
}

function activityGroupTitle(
  kind: ActivityGroupKind,
  items: readonly ActivitySummaryItem[],
  primary: ActivitySummaryItem | undefined
): string {
  if (items.length === 1 && primary !== undefined) return activityStepDescription(primary);
  if (kind === "tool") return "工具调用";
  if (kind === "thinking") return "模型判断";
  if (kind === "context") return "上下文";
  if (kind === "approval") return "确认";
  return "工作推进";
}

function activityGroupSummary(
  kind: ActivityGroupKind,
  items: readonly ActivitySummaryItem[],
  primary: ActivitySummaryItem | undefined
): string | undefined {
  if (primary?.summary !== undefined && !sameActivityCopy(primary.summary, activityStepDescription(primary))) {
    return compact(primary.summary, 110);
  }
  const result = summarizeWorkflowResults(items);
  if (result !== undefined) return result;
  if (kind === "tool") {
    const kinds = [...new Set(items.map((item) => item.kind).filter((value): value is NonNullable<ActivitySummaryItem["kind"]> => value !== undefined))];
    const labels = kinds.map(activityKindShortLabel).filter((value): value is string => value !== undefined);
    return labels.length === 0 ? `${items.length} 步` : labels.slice(0, 3).join("、");
  }
  return items.length > 1 ? `${items.length} 步` : undefined;
}

function activityKindShortLabel(kind: NonNullable<ActivitySummaryItem["kind"]>): string | undefined {
  if (kind === "workspace") return "目录";
  if (kind === "file") return "文件";
  if (kind === "search") return "搜索";
  if (kind === "web") return "网页";
  if (kind === "command") return "命令";
  if (kind === "edit") return "变更";
  return undefined;
}

function activityGroupTone(items: readonly ActivitySummaryItem[]): ActivitySummaryItem["tone"] {
  if (items.some((item) => item.tone === "danger")) return "danger";
  if (items.some((item) => item.tone === "warning")) return "warning";
  if (items.some((item) => item.tone === "active")) return "active";
  if (items.every((item) => item.tone === "muted")) return "muted";
  return "done";
}

function primaryActivityItem(items: readonly ActivitySummaryItem[]): ActivitySummaryItem | undefined {
  return items.find((item) => item.tone === "active") ??
    items.find((item) => item.tone === "warning" || item.tone === "danger") ??
    items.at(-1);
}

function shouldOpenWorkflowGroup(group: ActivityGroup): boolean {
  return group.tone === "active" || group.tone === "warning" || group.tone === "danger" || group.kind === "approval";
}

function ProcessLine({ item, index }: { readonly item: ActivitySummaryItem; readonly index: number }): React.ReactElement {
  const [open, setOpen] = useState(isActivityOpenByDefault(item));
  const description = activityStepDescription(item);
  const label = activityStepLabel(item);
  const showLabel = label.length > 0 && !sameActivityCopy(label, description);
  return (
    <div className={`process-line ${item.tone}`} data-kind={item.kind ?? "system"} data-open={open ? "true" : "false"}>
      <span className="process-line-index" aria-label={`第 ${index} 步`} />
      <div className="process-line-content">
        <button
          type="button"
          className="process-line-heading"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {showLabel && <strong>{label}</strong>}
          <span>{description}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && (item.result !== undefined
          ? <ActivityResultView result={item.result} />
          : item.summary !== undefined && !sameActivityCopy(item.summary, description) && <p>{compact(item.summary, 180)}</p>)}
      </div>
    </div>
  );
}

function ActivityResultView({ result, compact: compactView = false }: { readonly result: ActivityResult; readonly compact?: boolean }): React.ReactElement {
  if (result.kind === "items") {
    return (
      <div className={`activity-result items ${compactView ? "compact" : ""}`}>
        <div className="activity-output-panel">
          <div className="activity-output-label">{result.label}{result.more === true ? " · 等" : ""}</div>
          <div className="activity-output-list">
            {result.items.slice(0, compactView ? 3 : 6).map((item) => (
              <span className={`activity-output-row ${item.kind ?? "item"}`} key={`${item.kind ?? "item"}:${item.label}`}>
                {item.kind === "dir"
                  ? <FolderOpen size={13} aria-hidden="true" />
                  : item.kind === "file"
                    ? <FileText size={13} aria-hidden="true" />
                    : null}
                <span>{item.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (result.kind === "search") {
    return (
      <div className={`activity-result ${compactView ? "compact" : ""}`}>
        <div className="activity-result-head">
          <span>{result.label}</span>
          {result.query !== undefined && <span>{compact(result.query, 64)}</span>}
        </div>
        <div className="activity-result-list">
          {result.items.slice(0, compactView ? 2 : 3).map((item) => (
            <span key={`${item.title}:${item.url ?? ""}`}>
              <strong>{compact(item.title, 72)}</strong>
              {item.url !== undefined && <em>{compact(item.url, 88)}</em>}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (result.kind === "command") {
    return (
      <div className={`activity-result command ${compactView ? "compact" : ""}`}>
        {result.command !== undefined && (
          <div className="activity-command-block">
            <div className="activity-command-prompt"><span>~</span><span>$</span></div>
            <pre>{result.command}</pre>
          </div>
        )}
        {(result.output !== undefined || result.exitCode !== undefined) && (
          <div className="activity-output-panel">
            <div className="activity-output-label">结果</div>
            <pre>{[
              result.output,
              result.exitCode !== undefined && result.exitCode !== 0 ? `exit ${result.exitCode}` : undefined,
            ].filter((item): item is string => item !== undefined && item.length > 0).join("\n") || "完成"}</pre>
          </div>
        )}
      </div>
    );
  }
  if (result.kind === "change") {
    return (
      <div className={`activity-result ${compactView ? "compact" : ""}`}>
        <div className="activity-output-panel">
          <div className="activity-output-label">变更</div>
          <div className="activity-output-list">
            {result.path !== undefined && <span className="activity-output-row file"><FileText size={13} aria-hidden="true" /><span>{compact(result.path, 96)}</span></span>}
            {result.meta !== undefined && <span className="activity-output-row"><span>{result.meta}</span></span>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`activity-result text ${compactView ? "compact" : ""}`}>
      <div className="activity-output-panel">
        <div className="activity-output-label">结果</div>
        <p>{compact(result.text, compactView ? 140 : 220)}</p>
      </div>
    </div>
  );
}

function activityStepLabel(item: ActivitySummaryItem): string {
  if (item.kind === "thinking") return "模型";
  if (item.kind === "command") return "命令";
  if (item.kind === "workspace") return "工作区";
  if (item.kind === "file") return "文件";
  if (item.kind === "search") return "搜索";
  if (item.kind === "web") return "网页";
  if (item.kind === "edit") return "变更";
  if (item.kind === "approval") return "确认";
  return "处理";
}

function activityStepDescription(item: ActivitySummaryItem): string {
  if (item.kind === "thinking" && item.summary !== undefined) {
    return compact(item.summary, 120);
  }
  if (item.result?.kind === "command" && item.result.command !== undefined) {
    return commandActivityDescription(item.result.command);
  }
  if (item.result?.kind === "items") {
    if (item.kind === "file") return `读取 ${item.result.label}`;
    if (item.kind === "workspace") return `查看 ${item.result.label}`;
    return item.result.label;
  }
  return item.title
    .replace(/^已/, "")
    .replace(/^正在/, "")
    .replace(/未完成$/, "失败");
}

function isUsefulWorkflowItem(item: ActivitySummaryItem): boolean {
  if (item.kind === "thinking" && item.result === undefined) {
    const copies = [item.title, item.summary, activityStepDescription(item)].filter((value): value is string => value !== undefined);
    if (copies.some(isLowValueModelStatus)) return false;
  }
  if (item.type === "agent.note.completed" && isToolChoiceBridgeCopy(item.summary)) return false;
  if (item.type === "model.output.completed" && isLowValueModelStatus(item.summary)) return false;
  return true;
}

function isLowValueModelStatus(value: string | undefined): boolean {
  const normalized = normalizeActivityCopy(value);
  return normalized === "等待模型输出" ||
    normalized === "正在组织直接回答" ||
    normalized === "等待模型路由结果" ||
    normalized === "模型调用完成本次没有通过安全策略展示的可见输出" ||
    normalized === "内容已整理并已进入报告或详情";
}

function isToolChoiceBridgeCopy(value: string | undefined): boolean {
  const normalized = normalizeActivityCopy(value);
  return normalized === "助手已选择使用工具工具结果会作为安全摘要进入后续处理";
}

function sameActivityCopy(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeActivityCopy(left);
  const normalizedRight = normalizeActivityCopy(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeActivityCopy(value: string | undefined): string {
  return userVisibleAnswer(value ?? "")
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
}

function commandActivityDescription(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (/^(get-childitem|dir|ls)\b/.test(normalized)) return "查看当前文件夹的内容";
  if (/^(rg|grep|findstr)\b/.test(normalized)) return "搜索文件内容";
  if (/^(git\s+(status|diff|show|log))\b/.test(normalized)) return "检查代码状态";
  if (/^(pnpm|npm|yarn)\b/.test(normalized)) return "运行项目命令";
  return "运行命令";
}

function ConfirmationBanner(props: {
  readonly confirmation: ConfirmationProjection;
  readonly busy: boolean;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const [guidance, setGuidance] = useState("");
  const resumeLost = props.confirmation.resumeAvailability === "lost_after_restart";
  const affectedResources = confirmationAffectedResources(props.confirmation);
  const risk = confirmationRisk(props.confirmation);
  return (
    <section className={`confirmation-banner ${risk}`}>
      <div className="confirmation-main">
        <AlertTriangle size={16} />
        <div>
          <h2>待确认</h2>
          <RichText text={confirmationAction(props.confirmation)} />
          {affectedResources.length > 0 && (
            <ul>
              {affectedResources.slice(0, 5).map((resource) => <li key={resource}>{resource}</li>)}
            </ul>
          )}
          {resumeLost && <p>应用重启后无法继续原动作。请补充指导或重新发起后续任务。</p>}
        </div>
      </div>
      <textarea
        value={guidance}
        onChange={(event) => setGuidance(event.target.value)}
        placeholder="补充你的要求或限制"
        rows={2}
        disabled={props.busy}
      />
      <div className="confirmation-actions">
        <button type="button" onClick={() => props.onDecision("approve_once")} disabled={props.busy || resumeLost}>
          {props.busy ? "提交中" : "批准一次"}
        </button>
        <button type="button" onClick={() => props.onDecision("deny")} disabled={props.busy}>
          拒绝
        </button>
        <button type="button" onClick={() => props.onDecision("guidance", guidance)} disabled={props.busy || guidance.trim().length === 0}>
          补充指导
        </button>
      </div>
    </section>
  );
}

function ResultPreview({ deliverable }: { readonly deliverable: AgentDeliverable }): React.ReactElement {
  return (
    <article className="result-preview">
      <header>
        <FileText size={16} />
        <h2>结果预览：{deliverable.title}</h2>
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

function visibleTurns(turns: readonly ConversationTurn[]): readonly ConversationTurn[] {
  return turns.filter((turn) => turn.role === "user" || turn.content.trim().length > 0);
}

function assistantModelForTurn(
  turn: ConversationTurn,
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  if (turn.responseModel !== undefined) {
    const matched = models.find(
      (model) =>
        model.profileId === turn.responseModel?.profileId &&
        model.modelId === turn.responseModel?.model
    );
    if (matched !== undefined) {
      return modelBadgeFromOption(matched);
    }
    const identity = resolveModelProviderIdentity({
      title: turn.responseModel.label,
      profileId: turn.responseModel.profileId,
      baseUrl: turn.responseModel.baseUrl,
      model: turn.responseModel.model,
    });
    return {
      modelName: turn.responseModel.model ?? turn.responseModel.label ?? "模型",
      providerLabel: identity === "unknown" ? turn.responseModel.label ?? "模型" : modelProviderDisplayName(identity),
      providerIdentity: identity,
      iconSvg: resolveModelIconSvg(identity),
    };
  }
  return selectedComposerModel(models, selectedModelId);
}

function selectedComposerModel(
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected === undefined ? undefined : modelBadgeFromOption(selected);
}

function modelBadgeFromOption(model: ChatModelOption): AssistantModelBadge {
  return {
    modelName: model.name,
    providerLabel: model.providerLabel,
    providerIdentity: model.providerIdentity,
    iconSvg: model.iconSvg,
  };
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
  return deliverable;
}

function assistantTurnBlocksForRun(
  runId: string | undefined,
  events: readonly RunEvent[],
  workSession: DesktopWorkSession | undefined,
  answer?: string,
  live = false
): readonly AssistantTurnBlock[] {
  const source = timelineEventsForRun(runId, events, workSession);
  const scopedWorkSession = workSession?.run.runId === runId ? workSession : undefined;
  const terminalRun =
    (scopedWorkSession !== undefined && terminalStatuses.has(scopedWorkSession.run.status)) ||
    source.some((event) => event.type === "final.result" || event.type === "run.failed" || event.type === "run.cancelled" || event.type === "run.blocked");
  const blocks: AssistantTurnBlock[] = [];
  const answerParts: string[] = [];
  let answerStartId: string | undefined;
  let hasEarlierTool = false;

  const flushAnswer = (fallbackId: string): void => {
    const text = userVisibleAnswer(answerParts.join("")).trim();
    if (text.length > 0) {
      blocks.push({
        kind: "answer",
        id: answerStartId ?? `answer:${fallbackId}`,
        text,
        live,
      });
    }
    answerParts.length = 0;
    answerStartId = undefined;
  };

  for (const event of source) {
    if (event.visibility === "debug") continue;
    if (event.type === "model.output.delta") {
      if (event.delta !== undefined && event.delta.length > 0) {
        answerStartId ??= `answer:${event.id}`;
        answerParts.push(event.delta);
      }
      continue;
    }
    if (event.type === "model.output.completed") {
      flushAnswer(event.id);
      continue;
    }
    if (!isTimelineActivityEvent(event, source)) continue;
    flushAnswer(event.id);
    const item = activityItemForEvent(event, { hasEarlierTool, terminalRun });
    if (item !== undefined) {
      blocks.push({ kind: "activity", id: item.id, item });
      if (event.type.startsWith("tool.")) hasEarlierTool = true;
    }
  }

  flushAnswer("tail");
  return normalizeAssistantBlocks(dedupeTimelineBlocks(blocks), answer, live);
}

function timelineEventsForRun(
  runId: string | undefined,
  events: readonly RunEvent[],
  workSession: DesktopWorkSession | undefined
): readonly RunEvent[] {
  const scopedEvents = runId === undefined ? [] : events.filter((event) => event.runId === runId);
  const source = scopedEvents.length > 0
    ? scopedEvents
    : runId !== undefined && workSession?.run.runId === runId
      ? workSession.visibleEvents
      : [];
  return source
    .map((event, index) => ({ event, index }))
    .sort((left, right) =>
      left.event.sequence - right.event.sequence ||
      Date.parse(left.event.timestamp) - Date.parse(right.event.timestamp) ||
      left.index - right.index
    )
    .map((item) => item.event);
}

function normalizeAssistantBlocks(
  blocks: readonly AssistantTurnBlock[] | undefined,
  fallbackAnswer: string | undefined,
  live = false
): readonly AssistantTurnBlock[] {
  const normalizedBlocks = (blocks ?? [])
    .map((block): AssistantTurnBlock | undefined => {
      if (block.kind === "activity") return block;
      const text = userVisibleAnswer(block.text).trim();
      return text.length === 0 ? undefined : { ...block, text, live: block.live ?? live };
    })
    .filter((block): block is AssistantTurnBlock => block !== undefined);
  const fallback = fallbackAnswer === undefined ? "" : userVisibleAnswer(fallbackAnswer).trim();
  if (fallback.length === 0) return normalizedBlocks;

  const answerBlocks = normalizedBlocks.filter((block): block is Extract<AssistantTurnBlock, { readonly kind: "answer" }> => block.kind === "answer");
  if (answerBlocks.length === 0) {
    return [...normalizedBlocks, { kind: "answer", id: "answer:fallback", text: fallback, live }];
  }

  const combined = normalizeComparableText(answerBlocks.map((block) => block.text).join("\n"));
  const target = normalizeComparableText(fallback);
  const looseCombined = normalizeLooseComparableText(combined);
  const looseTarget = normalizeLooseComparableText(target);
  if (combined === target || combined.includes(target)) return normalizedBlocks;
  if (looseCombined === looseTarget || looseCombined.includes(looseTarget)) return normalizedBlocks;
  if (answerBlocks.length === 1 && (target.includes(combined) || looseTarget.includes(looseCombined))) {
    return normalizedBlocks.map((block) =>
      block.kind === "answer" && block.id === answerBlocks[0]?.id
        ? { ...block, text: fallback, live: block.live ?? live }
        : block
    );
  }
  return [...normalizedBlocks, { kind: "answer", id: "answer:fallback", text: fallback, live }];
}

function dedupeTimelineBlocks(blocks: readonly AssistantTurnBlock[]): readonly AssistantTurnBlock[] {
  const result: AssistantTurnBlock[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (
      previous?.kind === "activity" &&
      block.kind === "activity" &&
      previous.item.type === block.item.type &&
      previous.item.title === block.item.title &&
      previous.item.summary === block.item.summary
    ) {
      continue;
    }
    if (previous?.kind === "answer" && block.kind === "answer") {
      result[result.length - 1] = {
        ...block,
        id: previous.id,
        text: `${previous.text}\n\n${block.text}`.trim(),
      };
      continue;
    }
    result.push(block);
  }
  return result;
}

function isTimelineActivityEvent(event: RunEvent, source: readonly RunEvent[]): boolean {
  if (event.type === "tool.requested") return !hasLaterToolResolution(event, source);
  if (
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.note.delta" ||
    event.type === "agent.note.completed" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed" ||
    event.type === "confirmation.needed" ||
    event.type === "user_approval.received" ||
    event.type === "user.guidance" ||
    event.type === "agent.delegation.planned" ||
    event.type === "agent.child.started" ||
    event.type === "agent.child.completed" ||
    event.type === "agent.child.waiting" ||
    event.type === "agent.parent_synthesis.completed"
  ) {
    return true;
  }
  return false;
}

function hasLaterToolResolution(event: RunEvent, source: readonly RunEvent[]): boolean {
  const refs = event.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
  return source.some((candidate) => {
    if (candidate.sequence < event.sequence) return false;
    if (candidate.type !== "tool.completed" && candidate.type !== "tool.failed") return false;
    if (refs.length === 0) {
      return candidate.detail?.action === event.detail?.action || candidate.summary === event.summary;
    }
    return candidate.refs.some((ref) => ref.kind === "tool_call" && refs.includes(ref.id));
  });
}

function liveStreamingAnswer(events: readonly RunEvent[]): string | undefined {
  const deltas = events.filter((event) => event.type === "model.output.delta" && event.delta !== undefined && event.delta.length > 0);
  const latest = deltas.at(-1);
  if (latest === undefined) return undefined;
  const latestModelRef = latest.refs.find((ref) => ref.kind === "model_call")?.id;
  const sameLineage = latestModelRef === undefined
    ? deltas
    : deltas.filter((event) => event.refs.some((ref) => ref.kind === "model_call" && ref.id === latestModelRef));
  const text = sameLineage.map((event) => event.delta ?? "").join("").trim();
  return text.length === 0 ? undefined : text;
}

function activityItemsForRun(
  runId: string | undefined,
  events: readonly RunEvent[],
  workSession: DesktopWorkSession | undefined
): readonly ActivitySummaryItem[] {
  if (runId === undefined) return [];
  const scopedEvents = events.filter((event) => event.runId === runId);
  const scopedWorkSession = workSession?.run.runId === runId ? workSession : undefined;
  return visibleActivityItems(scopedEvents, scopedWorkSession);
}

function visibleActivityItems(events: readonly RunEvent[], workSession: DesktopWorkSession | undefined): readonly ActivitySummaryItem[] {
  const source = events.length > 0 ? events : workSession?.visibleEvents ?? [];
  const terminalRun =
    (workSession?.run.status !== undefined && terminalStatuses.has(workSession.run.status)) ||
    source.some((event) => event.type === "final.result" || event.type === "run.failed" || event.type === "run.cancelled" || event.type === "run.blocked");
  const hasToolResult = source.some((event) => event.type === "tool.completed" || event.type === "tool.failed");
  const lastCompletedToolIndex = lastIndexWhere(source, (event) => event.type === "tool.completed");
  const items = source
    .filter((event) => event.visibility !== "debug")
    .filter((event) => event.type !== "model.output.delta")
    .filter((event) => event.type !== "model.output.completed")
    .filter((event) => !(hasToolResult && event.type === "tool.requested"))
    .filter((event) => event.type !== "run.started")
    .filter((event) => event.type !== "final.result")
    .filter((event, index) =>
      !(
        terminalRun &&
        lastCompletedToolIndex >= 0 &&
        index < lastCompletedToolIndex &&
        (event.type === "tool.failed" || event.type === "context.compaction.failed")
      ) &&
      (
        event.type === "agent.delegation.planned" ||
        event.type === "agent.child.started" ||
        event.type === "agent.child.completed" ||
        event.type === "agent.child.waiting" ||
        event.type === "agent.parent_synthesis.completed" ||
        event.type === "agent.note.delta" ||
        event.type === "agent.note.completed" ||
        event.type === "tool.requested" ||
        event.type === "tool.completed" ||
        event.type === "tool.failed" ||
        event.type === "context.compaction.completed" ||
        event.type === "context.compaction.failed"
      )
    )
    .map((event, index, values) => activityItemForEvent(event, {
      hasEarlierTool: values.slice(0, index).some((candidate) => candidate.type.startsWith("tool.")),
      terminalRun,
    }))
    .filter((item): item is ActivitySummaryItem => item !== undefined);
  return dedupeActivityItems(mergeRepeatedActivityItems(items)).slice(-8);
}

function lastIndexWhere<T>(items: readonly T[], predicate: (item: T, index: number) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T, index)) return index;
  }
  return -1;
}

function activityItemForEvent(
  event: RunEvent,
  context: { readonly hasEarlierTool: boolean; readonly terminalRun: boolean } = { hasEarlierTool: false, terminalRun: false }
): ActivitySummaryItem | undefined {
  if (event.type === "tool.requested") {
    const action = toolActionFromEvent(event);
    return {
      id: event.id,
      type: event.type,
      title: action.active,
      tone: context.terminalRun ? "done" : "active",
      summary: activitySummaryFor(event),
      kind: action.kind,
    };
  }
  if (event.type === "tool.completed") {
    const action = toolActionFromEvent(event);
    return {
      id: event.id,
      type: event.type,
      title: action.done,
      tone: "done",
      summary: activitySummaryFor(event),
      kind: action.kind,
      result: activityResultFor(event),
    };
  }
  if (event.type === "tool.failed") {
    const action = toolActionFromEvent(event);
    return {
      id: event.id,
      type: event.type,
      title: action.failed,
      tone: "danger",
      summary: activitySummaryFor(event),
      kind: action.kind,
      result: activityResultFor(event),
    };
  }
  if (event.type === "confirmation.needed") {
    return {
      id: event.id,
      type: event.type,
      title: "等待确认",
      tone: "warning",
      summary: activitySummaryFor(event),
      kind: "approval",
    };
  }
  if (event.type === "user_approval.received") {
    return {
      id: event.id,
      type: event.type,
      title: "已确认",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "approval",
    };
  }
  if (event.type === "user.guidance") {
    return {
      id: event.id,
      type: event.type,
      title: "收到补充",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "approval",
    };
  }
  if (event.type === "agent.note.delta" || event.type === "agent.note.completed") {
    const summary = activitySummaryFor(event);
    return {
      id: event.id,
      type: event.type,
      title: summary ?? (event.type === "agent.note.delta" ? "模型判断" : "判断完成"),
      tone: event.type === "agent.note.delta" && !context.terminalRun ? "active" : activityToneFor(event.status),
      summary,
      kind: "thinking",
    };
  }
  if (event.type === "context.compaction.completed") {
    return {
      id: event.id,
      type: event.type,
      title: "整理上下文",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "context.compaction.failed") {
    return {
      id: event.id,
      type: event.type,
      title: "上下文整理未完成",
      tone: "warning",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "agent.delegation.planned") {
    return {
      id: event.id,
      type: event.type,
      title: "拆分检查",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "agent.child.started") {
    return {
      id: event.id,
      type: event.type,
      title: "局部检查",
      tone: context.terminalRun ? "done" : "active",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "agent.child.completed") {
    return {
      id: event.id,
      type: event.type,
      title: "局部检查完成",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "agent.child.waiting") {
    return {
      id: event.id,
      type: event.type,
      title: "等待材料",
      tone: context.terminalRun ? "done" : "active",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  if (event.type === "agent.parent_synthesis.completed") {
    return {
      id: event.id,
      type: event.type,
      title: "汇总判断",
      tone: "done",
      summary: activitySummaryFor(event),
      kind: "system",
    };
  }
  return {
    id: event.id,
    type: event.type,
    title: eventTitle(event),
    tone: activityToneFor(event.status),
    summary: activitySummaryFor(event),
  };
}

function activityToneFor(status: RunEvent["status"]): ActivitySummaryItem["tone"] {
  if (status === "failed") return "danger";
  if (status === "approval_needed" || status === "needs_input" || status === "blocked") return "warning";
  if (status === "completed") return "done";
  if (status === "cancelled" || status === "paused") return "muted";
  return "active";
}

type ToolActivityAction = {
  readonly active: string;
  readonly done: string;
  readonly failed: string;
  readonly kind: NonNullable<ActivitySummaryItem["kind"]>;
};

function activitySummaryFor(event: RunEvent): string | undefined {
  const normalized = normalizeActivitySummary(event.summary);
  if (event.type === "tool.completed") {
    return toolDisplaySummary(event) ?? (normalized === undefined ? undefined : summarizeToolResult(normalized));
  }
  if (event.type === "tool.failed") {
    return compact(event.detail?.error ?? normalized ?? "该动作没有完成。", 150);
  }
  if (normalized === undefined) return undefined;
  if (event.type === "tool.requested" && /^目标[:：]\s*\.?$/.test(normalized)) return undefined;
  return compact(normalized, 150);
}

function normalizeActivitySummary(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized;
}

function toolActionFromEvent(event: RunEvent): ToolActivityAction {
  const display = event.detail?.display;
  if (display !== undefined) {
    const action = toolActionFromDisplay(display);
    if (action !== undefined) return action;
  }
  const actionText = normalizeActivitySummary(event.detail?.action);
  const action = toolActionFromActionText(actionText);
  if (action !== undefined) return action;
  return toolActionFromSummary(event.detail?.preview ?? event.summary);
}

function toolActionFromDisplay(display: NonNullable<RunEvent["detail"]>["display"]): ToolActivityAction | undefined {
  if (display === undefined) return undefined;
  if (display.kind === "search_results") return activityAction("搜索资料", "search");
  if (display.kind === "browser_snapshot") return activityAction("查看网页", "web");
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return activityAction("更新文件", "edit");
  if (display.kind === "command_summary") return activityAction("运行命令", "command");
  if (display.kind === "generic_tool_summary") {
    const action = toolActionFromActionText(display.action);
    if (action !== undefined) return action;
    const itemText = display.items?.join("\n");
    if (itemText !== undefined && /^((file|dir)\s+.+)(\n(file|dir)\s+.+)*$/m.test(itemText)) {
      return activityAction("查看目录", "workspace");
    }
  }
  return undefined;
}

function toolActionFromActionText(action: string | undefined): ToolActivityAction | undefined {
  const normalized = normalizeActivitySummary(action)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (normalized.includes("list_dir") || normalized.includes("列出目录") || normalized.includes("目录")) {
    return activityAction("查看目录", "workspace");
  }
  if (normalized.includes("grep_files") || normalized.includes("搜索文件") || normalized.includes("检索文件")) {
    return activityAction("搜索文件", "search");
  }
  if (normalized.includes("read_file") || normalized.includes("读取文件") || normalized === "read" || normalized.includes("查看文件")) {
    return activityAction("读取文件", "file");
  }
  if (normalized.includes("browser") || normalized.includes("网页") || normalized.includes("浏览")) {
    return activityAction("查看网页", "web");
  }
  if (normalized.includes("search") || normalized.includes("搜索") || normalized.includes("查阅")) {
    return activityAction("搜索资料", "search");
  }
  if (normalized.includes("run_command") || normalized.includes("shell_command") || normalized.includes("命令") || normalized.includes("执行")) {
    return activityAction("运行命令", "command");
  }
  if (
    normalized.includes("write_file") ||
    normalized.includes("create_file") ||
    normalized.includes("edit_file") ||
    normalized.includes("delete_file") ||
    normalized.includes("写入") ||
    normalized.includes("编辑") ||
    normalized.includes("删除") ||
    normalized.includes("修改")
  ) {
    return activityAction("更新文件", "edit");
  }
  return undefined;
}

function toolActionFromSummary(summary: string | undefined): ToolActivityAction {
  const normalized = normalizeActivitySummary(summary);
  if (normalized === undefined) return activityAction("处理上下文", "system");
  if (/^(?:目标[:：]\s*)?\.?$/.test(normalized) || /^((file|dir)\s+.+)(\n(file|dir)\s+.+)*$/m.test(normalized)) {
    return activityAction("查看目录", "workspace");
  }
  if (/https?:\/\//i.test(normalized) || normalized.includes("网页")) {
    return activityAction("查看网页", "web");
  }
  if (normalized.includes("搜索") || normalized.includes("Search") || normalized.includes("result")) {
    return activityAction("搜索资料", "search");
  }
  if (normalized.includes("命令") || normalized.includes("exit ") || normalized.includes("command")) {
    return activityAction("运行命令", "command");
  }
  if (normalized.includes("写入") || normalized.includes("编辑") || normalized.includes("删除") || normalized.includes("replacements")) {
    return activityAction("更新文件", "edit");
  }
  if (normalized.includes("文件") || normalized.includes(".md") || normalized.includes(".txt") || normalized.includes(".tsx") || normalized.includes(".ts")) {
    return activityAction("读取文件", "file");
  }
  return activityAction("处理上下文", "system");
}

function activityAction(title: string, kind: ToolActivityAction["kind"]): ToolActivityAction {
  return {
    active: title,
    done: title,
    failed: `${title}未完成`,
    kind,
  };
}

function activityResultFor(event: RunEvent): ActivityResult | undefined {
  const display = event.detail?.display;
  if (display === undefined) {
    if (event.detail?.path !== undefined && toolActionFromEvent(event).kind === "file") {
      return {
        kind: "items",
        label: "1 个文件",
        items: [{ label: event.detail.path, kind: "file" }],
      };
    }
    const text = event.detail?.error ?? event.detail?.preview ?? event.summary;
    return activityResultFromText(text);
  }
  if (display.kind === "search_results") {
    return {
      kind: "search",
      label: `${display.results.length} 条结果`,
      query: display.query,
      items: display.results
        .map((item) => ({ title: item.title, url: item.url }))
        .filter((item) => item.title.length > 0),
      more: display.truncated === true,
    };
  }
  if (display.kind === "browser_snapshot") {
    const text = [display.title, display.url, display.summary ?? display.text]
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("\n");
    return text.length === 0 ? undefined : { kind: "text", text };
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    const meta = [
      display.replacements === undefined ? undefined : `${display.replacements} 处变更`,
      display.bytes === undefined ? undefined : `${display.bytes} bytes`,
    ].filter((item): item is string => item !== undefined).join(" · ");
    return {
      kind: "change",
      path: display.path,
      meta: meta.length === 0 ? undefined : meta,
    };
  }
  if (display.kind === "command_summary") {
    return {
      kind: "command",
      command: display.command,
      exitCode: display.exitCode,
      output: display.errorSummary ?? display.outputSummary,
    };
  }
  if (display.kind === "generic_tool_summary") {
    if (display.items !== undefined && display.items.length > 0) {
      const fileMatches = searchResultFromToolLines(display.items);
      if (fileMatches !== undefined) return fileMatches;
      return itemResultFromToolLines(display.items);
    }
    return activityResultFromText(display.summary);
  }
  return undefined;
}

function activityResultFromText(text: string | undefined): ActivityResult | undefined {
  const normalized = normalizeActivitySummary(text);
  if (normalized === undefined) return undefined;
  return itemResultFromToolText(normalized) ?? { kind: "text", text: normalized };
}

function itemResultFromToolLines(lines: readonly string[]): ActivityResult {
  const search = searchResultFromToolLines(lines);
  if (search !== undefined) return search;
  const parsed = itemResultFromToolText(lines.join("\n"));
  if (parsed !== undefined) return parsed;
  const items = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  return {
    kind: "items",
    label: `${items.length} 项结果`,
    items: items.map((item) => ({ label: item, kind: "item" })),
    more: items.length > 5,
  };
}

function searchResultFromToolLines(lines: readonly string[]): Extract<ActivityResult, { readonly kind: "search" }> | undefined {
  const items = lines
    .map((line) => {
      const trimmed = line.trim();
      const match = /^(.+?):(\d+)(?:\s+(.+))?$/.exec(trimmed);
      if (match === null) return undefined;
      const path = match[1]?.trim();
      const lineNumber = match[2]?.trim();
      if (path === undefined || lineNumber === undefined || path === "unknown") return undefined;
      return { title: `${path}:${lineNumber}` };
    })
    .filter((item): item is { readonly title: string } => item !== undefined);
  if (items.length === 0) return undefined;
  return {
    kind: "search",
    label: `${items.length} 处匹配`,
    items,
    more: lines.length > items.length || items.length > 5,
  };
}

function itemResultFromToolText(value: string): Extract<ActivityResult, { readonly kind: "items" }> | undefined {
  const sanitized = stripToolPreviewBoilerplate(value);
  const entries = parseToolItemEntries(sanitized);
  if (entries.length > 0) {
    const fileCount = entries.filter((entry) => entry.kind === "file").length;
    const label = fileCount === entries.length ? `${entries.length} 个文件` : `${entries.length} 项内容`;
    return {
      kind: "items",
      label,
      items: entries.map((entry) => ({
        label: entry.name,
        kind: entry.kind,
        meta: entry.meta,
      })),
      more: entries.length > 5,
    };
  }
  const filePreview = parseSingleFilePreview(sanitized);
  if (filePreview !== undefined) {
    return {
      kind: "items",
      label: "1 个文件",
      items: [{ label: filePreview, kind: "file" }],
    };
  }
  return undefined;
}

function parseToolItemEntries(value: string): readonly { readonly kind: "file" | "dir"; readonly name: string; readonly meta?: string }[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!/^(file|dir)\s+/i.test(normalized)) return [];
  const entries: { readonly kind: "file" | "dir"; readonly name: string; readonly meta?: string }[] = [];
  const pattern = /\b(file|dir)\s+(.+?)(?:\s+·\s+(.+?))?(?=\s+\b(?:file|dir)\b|$)/gi;
  for (const match of normalized.matchAll(pattern)) {
    const kind = match[1]?.toLowerCase();
    const name = match[2]?.trim();
    const meta = match[3]?.trim();
    if ((kind === "file" || kind === "dir") && name !== undefined && name.length > 0) {
      entries.push({ kind, name, meta: meta === undefined || meta.length === 0 ? undefined : meta });
    }
  }
  return entries;
}

function parseSingleFilePreview(value: string): string | undefined {
  const line = value
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (line === undefined || line.includes("。")) return undefined;
  const match = /^(.+?\.[A-Za-z0-9_-]{1,16})(?:\s+·\s+[\d.]+\s*(?:bytes|chars|KB|MB))?$/i.exec(line);
  const path = match?.[1]?.trim();
  return path === undefined || path.length === 0 ? undefined : path;
}

function stripToolPreviewBoilerplate(value: string): string {
  return value
    .replace(/文件正文只进入本轮工具上下文；普通面板只展示路径、大小和截断状态。?/g, "")
    .replace(/命令输出只进入本轮工具上下文；普通面板只展示安全摘要。?/g, "")
    .replace(/\s+$/g, "")
    .trim();
}

function toolDisplaySummary(event: RunEvent): string | undefined {
  const display = event.detail?.display;
  if (display === undefined) return undefined;
  if (display.kind === "search_results") {
    const query = display.query === undefined ? undefined : compact(display.query, 80);
    return `${display.results.length} 条资料${query === undefined ? "" : `：${query}`}${display.truncated === true ? " 等" : ""}`;
  }
  if (display.kind === "browser_snapshot") {
    return compact([display.title, display.url].filter((item): item is string => item !== undefined).join(" · ") || display.summary || "网页内容已读取。", 150);
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    const parts = [
      display.path,
      display.replacements === undefined ? undefined : `${display.replacements} 处变更`,
      display.bytes === undefined ? undefined : `${display.bytes} bytes`,
    ].filter((item): item is string => item !== undefined);
    return parts.length === 0 ? "文件已更新。" : compact(parts.join(" · "), 150);
  }
  if (display.kind === "command_summary") {
    const command = display.command === undefined ? undefined : compact(display.command, 120);
    const exit = display.exitCode === undefined ? undefined : `退出码 ${display.exitCode}`;
    return [command, exit].filter((item): item is string => item !== undefined).join(" · ") || undefined;
  }
  if (display.kind === "generic_tool_summary") {
    if (display.items !== undefined && display.items.length > 0) {
      return summarizeToolResult(display.items.join("\n"));
    }
    return display.summary === undefined ? undefined : compact(display.summary, 150);
  }
  return undefined;
}

function summarizeToolResult(value: string): string {
  const sanitized = stripToolPreviewBoilerplate(value);
  const parsedEntries = parseToolItemEntries(sanitized);
  if (parsedEntries.length > 0) {
    const names = parsedEntries.slice(0, 3).map((entry) => entry.name).join("、");
    const fileCount = parsedEntries.filter((entry) => entry.kind === "file").length;
    const unit = fileCount === parsedEntries.length ? "个文件" : "项内容";
    return `${parsedEntries.length} ${unit}：${names}${parsedEntries.length > 3 ? " 等" : ""}`;
  }
  const singleFile = parseSingleFilePreview(sanitized);
  if (singleFile !== undefined) {
    return `已读取 ${singleFile}`;
  }
  const lines = sanitized.split("\n").map((line) => line.trim());
  const fileEntries = lines
    .map((line) => /^file\s+(.+?)(?:\s+·\s+.+)?$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined && item.length > 0);
  const directoryEntries = lines
    .map((line) => /^dir\s+(.+?)(?:\s+·\s+.+)?$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined && item.length > 0);
  const entries = [...fileEntries, ...directoryEntries];
  if (entries.length > 0) {
    const names = entries.slice(0, 3).join("、");
    const unit = fileEntries.length === entries.length ? "个文件" : "项内容";
    return `${entries.length} ${unit}：${names}${entries.length > 3 ? " 等" : ""}`;
  }
  const genericItems = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .filter((item): item is string => item !== undefined && item.length > 0);
  if (genericItems.length > 1) {
    return genericItems.join("；");
  }
  return compact(sanitized, 150);
}

function mergeRepeatedActivityItems(items: readonly ActivitySummaryItem[]): readonly ActivitySummaryItem[] {
  const merged: ActivitySummaryItem[] = [];
  for (const item of items) {
    const previous = merged.at(-1);
    if (previous !== undefined && canMergeActivityItem(previous, item)) {
      merged[merged.length - 1] = mergeActivityItem(previous, item);
      continue;
    }
    merged.push(item);
  }
  return merged;
}

function canMergeActivityItem(previous: ActivitySummaryItem, next: ActivitySummaryItem): boolean {
  return previous.type === "tool.completed" &&
    next.type === "tool.completed" &&
    previous.title === next.title &&
    previous.kind === next.kind &&
    previous.tone === next.tone &&
    previous.result?.kind === "items" &&
    next.result?.kind === "items";
}

function mergeActivityItem(previous: ActivitySummaryItem, next: ActivitySummaryItem): ActivitySummaryItem {
  if (previous.result?.kind !== "items" || next.result?.kind !== "items") return next;
  const items = uniqueActivityResultItems([...previous.result.items, ...next.result.items]);
  return {
    ...next,
    id: `${previous.id}:${next.id}`,
    summary: summarizeItemResult(items),
    result: {
      kind: "items",
      label: itemResultLabel(items),
      items,
      more: previous.result.more === true || next.result.more === true || items.length > 5,
    },
  };
}

function uniqueActivityResultItems(items: readonly ActivityResultItem[]): readonly ActivityResultItem[] {
  const seen = new Set<string>();
  const result: ActivityResultItem[] = [];
  for (const item of items) {
    const key = `${item.kind ?? "item"}:${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function itemResultLabel(items: readonly ActivityResultItem[]): string {
  const fileCount = items.filter((item) => item.kind === "file").length;
  const dirCount = items.filter((item) => item.kind === "dir").length;
  if (fileCount === items.length) return `${items.length} 个文件`;
  if (dirCount === items.length) return `${items.length} 个文件夹`;
  return `${items.length} 项内容`;
}

function summarizeItemResult(items: readonly ActivityResultItem[]): string {
  const names = items.slice(0, 3).map((item) => item.label).join("、");
  return `${itemResultLabel(items)}${names.length === 0 ? "" : `：${names}${items.length > 3 ? " 等" : ""}`}`;
}

function dedupeActivityItems(items: readonly ActivitySummaryItem[]): readonly ActivitySummaryItem[] {
  const result: ActivitySummaryItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
    if (previous?.type === item.type && previous.title === item.title && previous.summary === item.summary) {
      continue;
    }
    result.push(item);
  }
  return result;
}

function visibleRunProblem(
  run: BasicAgentRun | undefined,
  workSession: DesktopWorkSession | undefined,
  detail: DesktopRunDetail | undefined,
  error: string | undefined
): { readonly title: string; readonly message: string; readonly tone: "warning" | "error" } | undefined {
  if (error !== undefined) {
    return { title: "系统错误", message: error, tone: "error" };
  }
  if (run?.status === "blocked" || run?.status === "paused") {
    return {
      title: workSession?.headline ?? "任务没有完成",
      message: visibleBlockedMessage(detail?.error?.code, detail?.error?.message) ?? workSession?.currentAction ?? "任务被保护性暂停。你可以继续发送消息让我接着处理。",
      tone: "warning",
    };
  }
  if (run?.status === "failed") {
    return {
      title: "这次没有完成",
      message: detail?.error?.message ?? workSession?.currentAction ?? "模型没有返回可用结果。你可以补充材料或重新发起。",
      tone: "error",
    };
  }
  return undefined;
}

function visibleBlockedMessage(code: string | undefined, message: string | undefined): string | undefined {
  if (code === "out_of_fuel") {
    return "这轮调用次数已到保护上限，任务没有完成。你可以继续发送消息让我接着处理。";
  }
  return message;
}

function visibleResultText(detail: DesktopRunDetail | undefined): string | undefined {
  return (
    detail?.canvas?.agent?.answer?.answer ??
    detail?.canvas?.workSession?.directAnswer?.answer ??
    detail?.canvas?.workSession?.report?.decisionSummary ??
    detail?.restoredResult?.summary
  );
}

function userVisibleAnswer(text: string): string {
  return text
    .replace(/AgentArbor\s*桌面\s*Root Agent/g, "AgentArbor 桌面助手")
    .replace(/Root Agent/g, "助手");
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

function normalizeLooseComparableText(value: string): string {
  return normalizeComparableText(value).replace(/\s+/g, "");
}

function confirmationAction(confirmation: ConfirmationProjection): string {
  const raw = "actionSummary" in confirmation ? confirmation.actionSummary : confirmation.question;
  const sanitized = raw
    .replace(/批准后只允许继续本次对应工具操作；拒绝则不会执行该动作。?/g, "")
    .replace(/执行前需要用户确认。?/g, "")
    .replace(/运行命令请求执行执行操作[。；]*/g, "")
    .replace(/\btool:call[_:A-Za-z0-9-]+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length === 0 ? "需要确认后继续。" : sanitized;
}

function confirmationAffectedResources(confirmation: ConfirmationProjection): readonly string[] {
  return "affectedResources" in confirmation
    ? confirmation.affectedResources.filter((resource) => !isInternalReference(resource))
    : [];
}

function isInternalReference(value: string): boolean {
  return /^(?:tool|tool_call|trace|model|model_call|event|confirmation|goal):/i.test(value.trim()) ||
    /\bcall[_:A-Za-z0-9-]{8,}\b/.test(value);
}

function confirmationRisk(confirmation: ConfirmationProjection): "low" | "medium" | "high" {
  if (confirmation.riskLevel === "high" || confirmation.riskLevel === "medium" || confirmation.riskLevel === "low") {
    return confirmation.riskLevel;
  }
  return "medium";
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}

function isActivityOpenByDefault(item: ActivitySummaryItem): boolean {
  return item.tone === "active" ||
    item.tone === "warning" ||
    item.tone === "danger" ||
    item.kind === "command" ||
    item.kind === "workspace" ||
    item.kind === "file";
}
