import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  Sparkles,
} from "lucide-react";
import { compact } from "../text";
import { resolveModelIconSvg } from "../model-icons";
import { modelProviderDisplayName, resolveModelProviderIdentity, type ModelProviderIdentity } from "../model-provider-logos";
import type {
  AgentDeliverable,
  BasicAgentRun,
  Conversation,
  ConversationTurn,
  DesktopRunDetail,
  DesktopWorkSession,
  ObservationRef,
  PendingConfirmation,
  ToolDisplayProjection,
  TranscriptConfirmation,
  TranscriptNode,
} from "../types";
import { terminalStatuses } from "../ui-state";
import { LiveStreamBox } from "./live-stream-text";
import { RichText } from "./rich-text";
import { ChatInputBar, type ChatInputProps, type ChatModelOption } from "./chat-empty";

type ConfirmationProjection = PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]> | TranscriptConfirmation;

type AssistantModelBadge = {
  readonly modelName: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly iconSvg?: string;
};

type ChatActiveLiveBuffer = {
  readonly runId: string;
  readonly turns: readonly ChatActiveLiveModelTurn[];
};

type ChatActiveLiveModelTurn = {
  readonly requestId: string;
  readonly outputText: string;
  readonly sideText: string;
  readonly reasoningText: string;
  readonly reasoningCompleted: boolean;
  readonly modelRefs: readonly string[];
  readonly updatedAtSequence: number;
};

type LiveAnswerTone = "formal" | "process";

type LiveAnswerProjection = {
  readonly text: string;
  readonly tone: LiveAnswerTone;
  readonly streaming: boolean;
};

export function ChatActive(props: ChatInputProps & {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly detail?: DesktopRunDetail;
  readonly live?: ChatActiveLiveBuffer;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<DesktopWorkSession["pendingConfirmation"]>;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentRunId = props.run?.runId ?? props.live?.runId ?? props.conversation?.activeRunId;
  const turns = useMemo(() => visibleTurns(props.conversation?.turns ?? [], currentRunId), [props.conversation?.turns, currentRunId]);
  const transcriptNodes = useMemo(() => visibleTranscriptNodes(props.transcriptNodes), [props.transcriptNodes]);
  const currentRunTranscriptNodes = useMemo(
    () => withLiveTranscriptNodes(nodesForRun(transcriptNodes, currentRunId), props.live),
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
  const liveAnswer = liveStreamingAnswer(props.live, currentRunTranscriptNodes);
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
                    transcriptNodes={currentRunTranscriptNodes}
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
  readonly live?: ChatActiveLiveBuffer;
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
        const runNodes = withLiveTranscriptNodes(nodesForRun(props.transcriptNodes, turn.runId), live);
        const liveAnswer = liveStreamingAnswer(live, runNodes);
        const pending = pendingForTurn(props.pending, turn.runId);
        return turn.status === "failed"
          ? <AssistantFailureMessage key={turn.turnId} content={turn.content} model={model} />
          : (
            <AssistantMessage
              key={turn.turnId}
              content={liveAnswer?.text ?? turn.content}
              live={liveAnswer?.streaming === true}
              liveTone={liveAnswer?.tone}
              model={model}
              transcriptNodes={runNodes}
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
  const showLiveText = live;
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
          showLiveText
            ? (
                <LiveStreamBox
                  text={visible}
                  live={true}
                  tone={props.liveTone ?? "formal"}
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

function AgentWorkTimeline(props: {
  readonly nodes: readonly TranscriptNode[];
  readonly pending?: ConfirmationProjection;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement | null {
  const nodes = timelineVisibleNodes(props.nodes);
  if (nodes.length === 0) return null;

  return (
    <section className="agent-work-timeline" aria-label="工作进度">
      <div className="agent-timeline-track">
        {nodes.map((node, index) => (
          <AgentTimelineRow
            key={timelineRowIdentity(node)}
            node={node}
            isLast={index === nodes.length - 1}
            pending={props.pending}
            onDecision={props.onDecision}
            confirmationBusy={props.confirmationBusy}
          />
        ))}
      </div>
    </section>
  );
}

function AgentTimelineRow(props: {
  readonly node: TranscriptNode;
  readonly isLast: boolean;
  readonly pending?: ConfirmationProjection;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const detail = transcriptNodeDetail(props.node, props.pending, props.onDecision, props.confirmationBusy);
  const expandable = detail !== undefined && timelineRowCanExpand(props.node);
  const rowIdentity = timelineRowIdentity(props.node);
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const eventLayout = timelineRowUsesEventLayout(props.node);
  const category = timelineRowCategory(props.node);
  const automaticOpen = defaultOpenForNode(props.node);
  const open = manualOpen ?? automaticOpen;

  useEffect(() => {
    setManualOpen(undefined);
  }, [rowIdentity]);

  const header = eventLayout
    ? renderTimelineEventHeader(props.node, expandable, open, () => setManualOpen((value) => !(value ?? automaticOpen)))
    : <p className="agent-timeline-thought">{timelineNarration(props.node)}</p>;

  return (
    <article
      className={`agent-timeline-row ${nodeTone(props.node)} ${eventLayout ? "event" : "thought"}`}
      data-open={open ? "true" : "false"}
      data-kind={props.node.kind}
      data-category={category}
      data-last={props.isLast ? "true" : "false"}
    >
      <div className="agent-timeline-row-body">
        {header}
        {eventLayout && open && detail !== undefined && (
          <div className="agent-timeline-row-detail">
            {detail}
          </div>
        )}
      </div>
    </article>
  );
}

function timelineRowIdentity(node: TranscriptNode): string {
  if (node.kind === "thinking") {
    const modelRefs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id).join("|");
    return `${node.runId}:thinking:${modelRefs || node.nodeId}`;
  }
  if (isModelSideOutputNode(node)) {
    const modelRefs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id).join("|");
    return `${node.runId}:model-output:${modelRefs || node.nodeId}`;
  }
  return node.nodeId;
}

function renderTimelineEventHeader(
  node: TranscriptNode,
  expandable: boolean,
  open: boolean,
  toggleOpen: () => void
): React.ReactElement {
  if (node.kind === "thinking") {
    return renderThinkingHeader(node);
  }
  if (isModelSideOutputNode(node)) {
    return renderModelSideOutputHeader(node);
  }
  if (node.kind === "tool") {
    return renderToolHeader(node, expandable, open, toggleOpen);
  }
  const body = (
    <>
      <span className="agent-timeline-event-main">
        <strong>{timelineRowPrimary(node)}</strong>
        {timelineRowSecondary(node) !== undefined && <span>{timelineRowSecondary(node)}</span>}
      </span>
      {timelineRowMeta(node) !== undefined && <small>{timelineRowMeta(node)}</small>}
      {expandable && <ChevronDown size={15} aria-hidden="true" />}
    </>
  );
  if (!expandable) {
    return <div className="agent-timeline-event static">{body}</div>;
  }
  return (
    <button
      type="button"
      className="agent-timeline-event"
      aria-expanded={open}
      onClick={toggleOpen}
    >
      {body}
    </button>
  );
}

function renderThinkingHeader(node: TranscriptNode): React.ReactElement {
  const rawText = (node.text ?? node.summary ?? "").trim();
  const live = node.eventType === "model.reasoning.delta" && node.phase !== "completed";
  const text = live ? rawText : compact(rawText, 360);
  return (
    <div className="agent-thinking-line" data-live={live ? "true" : "false"}>
      <span className="agent-stream-dot" aria-hidden="true" />
      <LiveStreamBox text={text} live={live} tone="thinking" />
    </div>
  );
}

function renderModelSideOutputHeader(node: TranscriptNode): React.ReactElement {
  const rawText = (node.text ?? node.summary ?? "").trim();
  const live = node.eventType === "model.output.side";
  const text = live ? rawText : compact(rawText, 260);
  return (
    <div className="agent-model-output-line" data-live={live ? "true" : "false"}>
      <span className="agent-stream-dot" aria-hidden="true" />
      <LiveStreamBox text={text} live={live} tone="process" />
    </div>
  );
}

function renderToolHeader(
  node: TranscriptNode,
  expandable: boolean,
  open: boolean,
  toggleOpen: () => void
): React.ReactElement {
  const target = timelineToolTarget(node);
  const body = (
    <>
      <span className="agent-tool-line-main">
        <span className="agent-tool-action">{timelineToolVerb(node)}</span>
        {target !== undefined && <span className="agent-tool-target">{target}</span>}
      </span>
      {timelineRowMeta(node) !== undefined && <small>{timelineRowMeta(node)}</small>}
      {expandable && <ChevronDown size={14} aria-hidden="true" />}
    </>
  );
  if (!expandable) {
    return <div className="agent-timeline-event agent-tool-line static">{body}</div>;
  }
  return (
    <button
      type="button"
      className="agent-timeline-event agent-tool-line"
      aria-expanded={open}
      onClick={toggleOpen}
    >
      {body}
    </button>
  );
}

function timelineRowUsesEventLayout(node: TranscriptNode): boolean {
  if (isModelSideOutputNode(node)) return true;
  if (isInlineSystemNote(node)) return false;
  return node.kind === "tool" || node.kind === "confirmation" || node.kind === "thinking" || node.kind === "user_decision" || node.kind === "system";
}

function isInlineSystemNote(node: TranscriptNode): boolean {
  return node.kind === "system" && (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

function isModelSideOutputNode(node: TranscriptNode): boolean {
  return node.kind === "system" && (node.eventType === "model.side.completed" || node.eventType === "model.output.side");
}

function timelineRowCategory(node: TranscriptNode): "thought" | "context" | "web" | "change" | "command" | "approval" | "danger" {
  if (nodeTone(node) === "danger") return "danger";
  if (node.kind === "confirmation") return "approval";
  if (node.kind !== "tool") return "thought";
  if (isCommandTool(node)) return "command";
  if (isChangeTool(node)) return "change";
  if (isWebTool(node)) return "web";
  return "context";
}

function timelineNarration(node: TranscriptNode): string {
  if (node.kind === "thinking") {
    return (node.text ?? node.summary ?? "").trim();
  }
  if (node.kind === "user_decision") {
    return node.summary ?? (node.phase === "denied" ? "用户拒绝了这一步操作。" : node.phase === "guidance" ? "用户补充了新的要求。" : "用户确认继续执行。");
  }
  if (node.kind === "system") {
    return node.summary ?? node.title;
  }
  return node.summary ?? node.title;
}

function timelineRowPrimary(node: TranscriptNode): string {
  if (node.kind === "confirmation") {
    return confirmationDisplayTitle(node.confirmation, node.summary ?? "");
  }
  if (node.kind === "thinking") {
    return compact((node.text ?? node.summary ?? "").trim(), 180);
  }
  if (node.kind === "user_decision") {
    return node.phase === "denied" ? "你已拒绝" : node.phase === "guidance" ? "你补充了要求" : "你已确认";
  }
  if (node.kind === "system") {
    if (node.phase === "failed" || node.phase === "blocked") return "任务未完成";
    if (node.phase === "cancelled") return "任务已取消";
    return node.title;
  }
  if (node.kind !== "tool") return nodeTitle(node);
  return timelineToolVerb(node);
}

function timelineRowSecondary(node: TranscriptNode): string | undefined {
  if (node.kind === "confirmation") {
    const action = cleanConfirmationSummary(node.summary ?? node.confirmation?.actionSummary ?? "");
    return action.length === 0 ? undefined : compact(confirmationActionPreview(action), 140) || undefined;
  }
  if (node.kind === "thinking") {
    return undefined;
  }
  if (node.kind === "user_decision" || node.kind === "system") {
    return compact(node.summary ?? "", 160) || undefined;
  }
  return undefined;
}

function timelineRowMeta(node: TranscriptNode): string | undefined {
  if (node.kind === "confirmation") return undefined;
  if (node.kind !== "tool") return undefined;
  const display = node.display;
  if (display?.kind === "command_summary" && display.exitCode !== undefined && display.exitCode !== 0) {
    return `exit ${display.exitCode}`;
  }
  return undefined;
}

function timelineRowCanExpand(node: TranscriptNode): boolean {
  if (node.kind === "confirmation") return true;
  if (node.kind === "thinking") return false;
  if (isInlineSystemNote(node)) return false;
  if (node.kind === "system" || node.kind === "user_decision") return (node.summary?.length ?? 0) > 160;
  if (node.kind !== "tool") return false;
  const display = node.display;
  if (display === undefined) return false;
  if (display.kind === "command_summary") return true;
  if (display.kind === "search_results" || display.kind === "browser_snapshot") return true;
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return true;
  return display.kind === "generic_tool_summary" && (display.items?.length ?? 0) > 0;
}

function timelineToolVerb(node: TranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  if (isCommandTool(node)) return "运行命令";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search" || toolName.includes("grep")) return "搜索资料";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "读取网页";
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) return "编辑文件";
  if (display?.kind === "file_change_summary") {
    if (toolName === "create_file" || toolName.includes("create")) return "创建文件";
    if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return "删除文件";
    return "写入文件";
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) return "浏览目录";
  if (toolName === "read" || toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) return "读取文件";
  if (toolName.includes("generate") || action.includes("生成")) return "生成内容";
  return sentenceCaseLabel(display?.kind === "generic_tool_summary" ? display.action ?? node.title : node.title);
}

function timelineToolTarget(node: TranscriptNode): string | undefined {
  const display = node.display;
  if (display?.kind === "command_summary") {
    return compact(commandText(display) ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "search_results") {
    return compact(display.query ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "browser_snapshot") {
    return compact(display.title ?? display.url ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return compact(display.path ?? node.summary ?? "", 180) || undefined;
  }
  if (display?.kind === "generic_tool_summary") {
    const items = display.items?.map(genericItemLabel).filter((value) => value.length > 0) ?? [];
    if (items.length === 1) return compact(items[0], 180) || undefined;
    if (items.length > 1) return isFileReadNode(node) ? `${items.length} 个文件` : `${items.length} 项`;
    return compact(display.summary ?? node.summary ?? "", 180) || undefined;
  }
  return compact(node.summary ?? "", 180) || undefined;
}

function sentenceCaseLabel(value: string | undefined): string {
  const normalized = (value ?? "").replace(/[_-]+/g, " ").trim();
  if (normalized.length === 0) return "Tool";
  if (!/[A-Za-z]/.test(normalized)) return normalized;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isCommandTool(node: TranscriptNode): boolean {
  const toolName = normalizedToolName(node.toolName);
  return node.kind === "tool" &&
    (node.display?.kind === "command_summary" || toolName === "run_command" || toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd"));
}

function isChangeTool(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  const action = display?.kind === "generic_tool_summary" ? display.action?.toLowerCase() ?? "" : "";
  return display?.kind === "file_change_summary" ||
    display?.kind === "file_diff_preview" ||
    toolName === "edit_file" ||
    toolName === "write_file" ||
    toolName === "create_file" ||
    toolName === "delete_file" ||
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("create") ||
    toolName.includes("delete") ||
    toolName.includes("remove") ||
    action.includes("编辑") ||
    action.includes("写入") ||
    action.includes("创建") ||
    action.includes("删除");
}

function isWebTool(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  return display?.kind === "search_results" ||
    display?.kind === "browser_snapshot" ||
    toolName === "search" ||
    toolName === "web_search" ||
    toolName === "browser_snapshot" ||
    toolName.includes("browser") ||
    toolName.includes("grep");
}

function transcriptNodeDetail(
  node: TranscriptNode,
  pending: ConfirmationProjection | undefined,
  onDecision: ((decision: "approve_once" | "deny" | "guidance", guidance?: string) => void) | undefined,
  confirmationBusy: boolean
): React.ReactElement | undefined {
  if (node.kind === "thinking") {
    return undefined;
  }
  if (node.kind === "confirmation") {
    const confirmation = confirmationForNode(node, pending);
    return (
      <ConfirmationNode
        confirmation={confirmation}
        busy={confirmationBusy}
        onDecision={onDecision}
      />
    );
  }
  if (node.kind === "tool") {
    return <ToolNodeDetail node={node} />;
  }
  if (node.kind === "user_decision" && node.summary !== undefined) {
    return <p className="transcript-node-summary">{node.summary}</p>;
  }
  if (node.kind === "system" && node.summary !== undefined) {
    return <p className="transcript-node-summary">{node.summary}</p>;
  }
  return undefined;
}

function ToolNodeDetail({ node }: { readonly node: TranscriptNode }): React.ReactElement | undefined {
  const display = node.display;
  if (display === undefined) {
    return node.summary === undefined ? undefined : <p className="transcript-node-summary">{node.summary}</p>;
  }
  if (display.kind === "command_summary") {
    return <CommandDetail display={display} />;
  }
  if (display.kind === "search_results") {
    return <SearchDetail display={display} />;
  }
  if (display.kind === "browser_snapshot") {
    return <BrowserDetail display={display} />;
  }
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") {
    return <FileChangeDetail display={display} />;
  }
  if (display.kind === "generic_tool_summary") {
    return <GenericToolDetail display={display} fallback={node.summary} />;
  }
  return undefined;
}

function CommandDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "command_summary" }> }): React.ReactElement {
  const command = commandText(display);
  const output = [display.outputSummary, display.errorSummary]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n");
  return (
    <div className="transcript-tool-detail" data-display="command">
      {command !== undefined && (
        <div className="transcript-command-block">
          <button type="button" className="activity-copy-btn" onClick={() => copyToClipboard(command)} aria-label="复制命令">
            <Copy size={12} />
          </button>
          <pre>{command}</pre>
        </div>
      )}
      {(output.length > 0 || (display.exitCode !== undefined && display.exitCode !== 0)) && (
        <div className="transcript-output-panel">
          <pre>{[
            output,
            display.exitCode !== undefined && display.exitCode !== 0 ? `exit ${display.exitCode}` : undefined,
          ].filter((value): value is string => value !== undefined && value.length > 0).join("\n")}</pre>
        </div>
      )}
    </div>
  );
}

function SearchDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "search_results" }> }): React.ReactElement {
  return (
    <div className="transcript-tool-detail" data-display="search">
      <div className="transcript-detail-list">
        {display.results.slice(0, 6).map((item, index) => (
          <div className="transcript-detail-row" key={`${item.title}:${item.url ?? index}`}>
            <strong>{item.title}</strong>
            {item.url !== undefined && <em>{item.url}</em>}
            {(item.summary ?? item.snippet) !== undefined && <span>{compact(item.summary ?? item.snippet ?? "", 160)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrowserDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "browser_snapshot" }> }): React.ReactElement {
  return (
    <div className="transcript-tool-detail" data-display="browser">
      <div className="transcript-detail-list">
        <div className="transcript-detail-row">
          <strong>{display.title ?? "网页"}</strong>
          {display.url !== undefined && <em>{display.url}</em>}
          {(display.summary ?? display.text) !== undefined && <span>{compact(display.summary ?? display.text ?? "", 220)}</span>}
        </div>
      </div>
    </div>
  );
}

function GenericToolDetail(props: {
  readonly display: Extract<ToolDisplayProjection, { readonly kind: "generic_tool_summary" }>;
  readonly fallback?: string;
}): React.ReactElement | undefined {
  const items = props.display.items ?? [];
  const summary = props.display.summary ?? props.fallback;
  if (items.length === 0 && (summary === undefined || summary.trim().length === 0)) {
    return undefined;
  }
  return (
    <div className="transcript-tool-detail" data-display="generic">
      {items.length > 0 ? (
        <div className="transcript-detail-list">
          {items.slice(0, 10).map((item) => (
            <div className="transcript-detail-row" key={item}>
              <strong>{genericItemLabel(item)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="transcript-node-summary">{summary}</p>
      )}
    </div>
  );
}

function FileChangeDetail({ display }: { readonly display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }> }): React.ReactElement {
  const stats = fileChangeStats(display);
  const preview = display.preview?.trim();
  const label = display.path ?? "文件";
  return (
    <div className="file-change-review" data-display="file-change">
      <div className="file-change-review-header">
        <div>
          <strong>{label}</strong>
        </div>
        {stats.length > 0 && (
          <div className="file-change-stats">
            {stats.map((stat) => <span key={stat}>{stat}</span>)}
          </div>
        )}
      </div>
      {preview !== undefined && preview.length > 0 ? (
        <div className="file-diff-panel">
          {diffLines(preview).map((line, index) => (
            <div className={`file-diff-line ${line.kind}`} key={`${index}:${line.text}`}>
              <span>{line.sign}</span>
              <p>{line.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="file-diff-preview">{display.summary ?? "已更新"}</p>
      )}
    </div>
  );
}

function ConfirmationNode(props: {
  readonly confirmation?: ConfirmationProjection;
  readonly busy: boolean;
  readonly onDecision?: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
}): React.ReactElement {
  const resumeLost = props.confirmation?.resumeAvailability === "lost_after_restart";
  const action = props.confirmation === undefined ? "" : confirmationAction(props.confirmation);
  const title = confirmationDisplayTitle(props.confirmation, action);
  const resources = props.confirmation === undefined ? [] : confirmationAffectedResources(props.confirmation);
  return (
    <div className="confirmation-node-body" data-risk={props.confirmation === undefined ? "medium" : confirmationRiskLevel(props.confirmation)}>
      <div className="confirmation-node-header">
        <strong>{title}</strong>
      </div>
      {action.length > 0 && (
        <div className="confirmation-command-row">
          <pre>{confirmationActionPreview(action)}</pre>
        </div>
      )}
      {resources.length > 0 && (
        <div className="confirmation-node-meta">
          {resources.slice(0, 6).map((resource) => <span key={resource}>{resource}</span>)}
        </div>
      )}
      {resumeLost && <p className="transcript-node-summary">需重新发起。</p>}
      {props.onDecision !== undefined && (
        <div className="confirmation-actions">
          <button
            type="button"
            className="primary"
            onClick={() => props.onDecision?.("approve_once")}
            disabled={props.busy || resumeLost}
          >
            {props.busy ? "处理中" : "允许"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => props.onDecision?.("deny")}
            disabled={props.busy}
          >
            拒绝
          </button>
        </div>
      )}
    </div>
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

function visibleTranscriptNodes(nodes: readonly TranscriptNode[]): readonly TranscriptNode[] {
  const sorted = [...nodes]
    .filter((node) => node.kind !== "answer")
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const terminalToolCallIds = new Set(
    sorted
      .filter((node) => node.eventType === "tool.completed" || node.eventType === "tool.failed")
      .flatMap(toolCallIdsForNode)
  );
  const source = sorted.filter((node) => {
    if (node.eventType !== "tool.requested" || node.phase === "preparing") return true;
    const ids = toolCallIdsForNode(node);
    return ids.length === 0 || !ids.some((id) => terminalToolCallIds.has(id));
  });
  const result: TranscriptNode[] = [];
  for (const node of source) {
    const previous = result.at(-1);
    if (previous !== undefined && canAggregateFileRead(previous, node)) {
      result[result.length - 1] = aggregateFileReadNodes(previous, node);
      continue;
    }
    if (isBoringSuccessfulToolResult(node)) {
      continue;
    }
    result.push(node);
  }
  return result;
}

function timelineVisibleNodes(nodes: readonly TranscriptNode[]): readonly TranscriptNode[] {
  const sorted = [...nodes]
    .filter((node) => node.kind !== "answer")
    .filter((node) => !isLowValueNode(node))
    .sort(compareNodeOrder);
  const hasWorkActivity = sorted.some((node) => node.kind !== "thinking");
  const terminalToolCallIds = new Set(
    sorted
      .filter((node) => node.eventType === "tool.completed" || node.eventType === "tool.failed")
      .flatMap(toolCallIdsForNode)
  );
  const visible = sorted.filter((node) => {
    if (node.kind === "thinking") {
      const text = (node.summary ?? node.text ?? "").trim();
      if (text.length === 0) return false;
      if (node.eventType === "model.reasoning.delta" || node.eventType === "model.reasoning.completed") return true;
      return hasWorkActivity || node.phase !== "completed";
    }
    if (isModelSideOutputNode(node)) {
      return (node.text ?? node.summary ?? "").trim().length > 0;
    }
    if (node.eventType !== "tool.requested" || node.phase === "preparing") return true;
    const ids = toolCallIdsForNode(node);
    return ids.length === 0 || !ids.some((id) => terminalToolCallIds.has(id));
  });
  return visible;
}

function toolCallIdsForNode(node: TranscriptNode): readonly string[] {
  return node.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function compareNodeOrder(left: TranscriptNode, right: TranscriptNode): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const rank = transcriptNodeOrderRank(left) - transcriptNodeOrderRank(right);
  if (rank !== 0) return rank;
  if (left.nodeId === right.nodeId) return 0;
  return left.nodeId.localeCompare(right.nodeId);
}

function transcriptNodeOrderRank(node: TranscriptNode): number {
  if (node.kind === "thinking") return 0;
  if (isModelSideOutputNode(node)) return 1;
  if (node.kind === "tool") return 2;
  if (node.kind === "confirmation") return 3;
  if (node.kind === "user_decision") return 4;
  if (node.kind === "system") return 5;
  return 6;
}

function nodesForRun(nodes: readonly TranscriptNode[], runId: string | undefined): readonly TranscriptNode[] {
  if (runId === undefined) return [];
  return nodes.filter((node) => node.runId === runId);
}

function pendingForTurn(pending: ConfirmationProjection | undefined, runId: string | undefined): ConfirmationProjection | undefined {
  if (pending === undefined || runId === undefined) return undefined;
  const pendingRunId = confirmationRunId(pending);
  return pendingRunId === undefined || pendingRunId === runId ? pending : undefined;
}

function showStandaloneRun(input: {
  readonly turns: readonly ConversationTurn[];
  readonly run?: BasicAgentRun;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly answer?: string;
  readonly liveAnswer?: LiveAnswerProjection;
  readonly pending?: ConfirmationProjection;
  readonly deliverable?: AgentDeliverable;
  readonly statusNotice?: { readonly title: string; readonly message: string; readonly tone: "warning" | "error" };
}): boolean {
  const runId = input.run?.runId;
  if (runId === undefined) return false;
  const hasAssistantTurnForRun = input.turns.some((turn) => turn.role === "assistant" && turn.runId === runId);
  if (hasAssistantTurnForRun) return false;
  return nodesForRun(input.transcriptNodes, runId).length > 0 ||
    input.liveAnswer !== undefined ||
    input.pending !== undefined ||
    input.deliverable !== undefined ||
    input.answer !== undefined ||
    (input.run !== undefined && !terminalStatuses.has(input.run.status) && input.statusNotice === undefined);
}

function withLiveTranscriptNodes(
  nodes: readonly TranscriptNode[],
  live: ChatActiveLiveBuffer | undefined
): readonly TranscriptNode[] {
  if (live === undefined) return nodes;
  let next = nodes;

  // 只处理最新的 turn（最后一个）
  const latestTurn = live.turns[live.turns.length - 1];
  if (latestTurn === undefined) return next;

  if (latestTurn.reasoningText.trim().length > 0) {
    const existing = findLiveThinkingNode(next, latestTurn);
    const liveNode = liveThinkingNode(live.runId, latestTurn, existing);
    next = existing === undefined ? [...next, liveNode] : next.map((node) => node === existing ? liveNode : node);
  }
  if (latestTurn.sideText.trim().length > 0) {
    const existing = next.find((node) =>
      node.kind === "system" &&
      (node.eventType === "model.side.completed" || node.eventType === "model.output.side") &&
      sameModelRefs(node, latestTurn.modelRefs)
    );
    const liveNode = liveSideTextNode(live.runId, latestTurn, existing);
    next = existing === undefined ? [...next, liveNode] : next.map((node) => node === existing ? liveNode : node);
  }

  return next;
}

function findLiveThinkingNode(nodes: readonly TranscriptNode[], turn: ChatActiveLiveModelTurn): TranscriptNode | undefined {
  return nodes.find((node) => node.kind === "thinking" && sameModelRefs(node, turn.modelRefs)) ??
    nodes.find((node) => node.kind === "thinking" && isModelReasoningNode(node) && sameReasoningText(node, turn));
}

function sameModelRefs(node: TranscriptNode, modelRefs: readonly string[]): boolean {
  if (modelRefs.length === 0) return false;
  const refs = node.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
  return refs.some((ref) => modelRefs.includes(ref));
}

function isModelReasoningNode(node: TranscriptNode): boolean {
  return node.eventType === "model.reasoning.delta" || node.eventType === "model.reasoning.completed";
}

function sameReasoningText(node: TranscriptNode, turn: ChatActiveLiveModelTurn): boolean {
  const nodeText = normalizeComparableText(node.text ?? node.summary ?? "");
  const liveText = normalizeComparableText(turn.reasoningText);
  if (nodeText.length === 0 || liveText.length === 0) return false;
  if (nodeText === liveText) return true;
  return !turn.reasoningCompleted && (nodeText.startsWith(liveText) || liveText.startsWith(nodeText));
}

function liveThinkingNode(runId: string, turn: ChatActiveLiveModelTurn, existing: TranscriptNode | undefined): TranscriptNode {
  const text = turn.reasoningText.trim();
  const completed = turn.reasoningCompleted || existing?.eventType === "model.reasoning.completed" || existing?.phase === "completed";
  const modelRefs = turn.modelRefs.map((id): ObservationRef => ({ kind: "model_call", id }));
  return {
    nodeId: `${runId}:live:${turn.requestId}:thinking`,
    runId,
    sequence: existing?.sequence ?? turn.updatedAtSequence,
    eventType: completed ? "model.reasoning.completed" : "model.reasoning.delta",
    kind: "thinking",
    phase: completed ? "completed" : "noted",
    title: "思考",
    summary: compact(text, 180),
    text,
    timestamp: existing?.timestamp ?? "",
    refs: existing === undefined ? modelRefs : mergeRefs(existing.refs, modelRefs),
  };
}

function liveSideTextNode(runId: string, turn: ChatActiveLiveModelTurn, existing: TranscriptNode | undefined): TranscriptNode {
  const text = turn.sideText.trim();
  const modelRefs = turn.modelRefs.map((id): ObservationRef => ({ kind: "model_call", id }));
  return {
    nodeId: `${runId}:live:${turn.requestId}:side-text`,
    runId,
    sequence: existing?.sequence ?? Math.max(0, turn.updatedAtSequence - 0.1),
    eventType: "model.output.side",
    kind: "system",
    phase: "completed",
    title: "",
    summary: compact(text, 220),
    text,
    timestamp: existing?.timestamp ?? "",
    refs: existing === undefined ? modelRefs : mergeRefs(existing.refs, modelRefs),
  };
}

function liveStreamingAnswer(
  live: ChatActiveLiveBuffer | undefined,
  nodes: readonly TranscriptNode[]
): LiveAnswerProjection | undefined {
  const liveTurn = live === undefined
    ? undefined
    : [...live.turns].reverse().find((turn) => turn.outputText.trim().length > 0);
  if (liveTurn !== undefined) {
    return {
      text: liveTurn.outputText,
      tone: liveOutputFollowsToolResult(liveTurn, nodes) ? "formal" : "process",
      streaming: true,
    };
  }
  const answerNode = [...nodes].reverse().find((node) => node.kind === "answer" && (node.text?.trim().length ?? 0) > 0);
  return answerNode?.text === undefined ? undefined : { text: answerNode.text.trim(), tone: "formal", streaming: false };
}

function liveOutputFollowsToolResult(turn: ChatActiveLiveModelTurn, nodes: readonly TranscriptNode[]): boolean {
  const latestToolResultSequence = nodes.reduce((latest, node) => (
    node.kind === "tool" && (node.eventType === "tool.completed" || node.eventType === "tool.failed")
      ? Math.max(latest, node.sequence)
      : latest
  ), 0);
  return latestToolResultSequence > 0 && turn.updatedAtSequence > latestToolResultSequence;
}

function nodeTitle(node: TranscriptNode): string {
  if (node.kind === "thinking") return "思考";
  if (node.kind === "confirmation") return "待确认";
  if (node.kind === "user_decision") return node.phase === "denied" ? "已拒绝" : node.phase === "guidance" ? "补充要求" : "已确认";
  if (node.kind === "tool") return toolNodeTitle(node);
  if (node.kind === "system") return node.title;
  return node.title;
}

function toolNodeTitle(node: TranscriptNode): string {
  const display = node.display;
  const action = toolActionLabel(node);
  if (node.phase === "preparing") return `准备${action}`;
  if (node.phase === "executing") return action;
  if (node.phase === "failed") return `${action}未完成`;
  if (display?.kind === "command_summary") return action;
  if (display?.kind === "search_results") return "搜索资料";
  if (display?.kind === "browser_snapshot") return "读取网页";
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") return action;
  if (isFileReadNode(node)) return "读取文件";
  return action;
}

function toolActionLabel(node: TranscriptNode): string {
  const display = node.display;
  const toolName = normalizedToolName(node.toolName);
  if (display?.kind === "command_summary" || toolName === "run_command") return "运行命令";
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) return "执行 Shell";
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search") return "搜索资料";
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) return "读取网页";
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) return "编辑文件";
  if (display?.kind === "file_change_summary") {
    if (toolName === "create_file" || toolName.includes("create")) return "创建文件";
    if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return "删除文件";
    return "写入文件";
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) return "浏览目录";
  if (toolName === "grep_files" || toolName.includes("grep")) return "搜索文件";
  if (toolName === "read") return "读取资料";
  if (toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) return "读取文件";
  if (toolName.includes("generate")) return "生成内容";
  if (display?.kind === "generic_tool_summary" && display.action !== undefined) return display.action;
  return node.title || "使用工具";
}

function nodeTone(node: TranscriptNode): "active" | "warning" | "danger" | "done" {
  if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") return "danger";
  if (node.phase === "waiting_approval") return "warning";
  if (node.phase === "preparing" || node.phase === "executing" || node.phase === "noted") return "active";
  return "done";
}

function defaultOpenForNode(node: TranscriptNode): boolean {
  if (node.kind === "thinking") return node.phase !== "completed";
  if (node.kind === "confirmation") return true;
  if (node.phase === "waiting_approval") return true;
  if (node.phase === "failed" || node.phase === "blocked" || node.phase === "cancelled") return true;
  if (node.display?.kind === "command_summary" && (node.display.exitCode ?? 0) !== 0) return true;
  return false;
}

function canAggregateFileRead(previous: TranscriptNode, next: TranscriptNode): boolean {
  return isFileReadNode(previous) &&
    isFileReadNode(next) &&
    previous.phase === "completed" &&
    next.phase === "completed";
}

function aggregateFileReadNodes(previous: TranscriptNode, next: TranscriptNode): TranscriptNode {
  const items = uniqueStrings([...fileReadLabels(previous), ...fileReadLabels(next)]);
  return {
    ...next,
    nodeId: previous.nodeId,
    sequence: previous.sequence,
    timestamp: previous.timestamp,
    refs: mergeRefs(previous.refs, next.refs),
    title: "读取文件",
    summary: `${items.length} 个文件`,
    display: {
      kind: "generic_tool_summary",
      action: "读取文件",
      summary: `${items.length} 个文件`,
      items,
    },
  };
}

function isFileReadNode(node: TranscriptNode): boolean {
  if (node.kind !== "tool") return false;
  const toolName = normalizedToolName(node.toolName);
  const action = node.display?.kind === "generic_tool_summary" ? node.display.action?.toLowerCase() ?? "" : "";
  return toolName === "read" ||
    toolName === "read_file" ||
    toolName.startsWith("read_") ||
    action === "read_file" ||
    action.includes("读取文件") ||
    node.title.includes("读取文件");
}

function fileReadLabels(node: TranscriptNode): readonly string[] {
  const display = node.display;
  if (display?.kind === "generic_tool_summary" && display.items !== undefined && display.items.length > 0) {
    return display.items.map(genericItemLabel);
  }
  const summary = display?.kind === "generic_tool_summary" ? display.summary : undefined;
  return [summary, node.summary].filter((value): value is string => value !== undefined && value.trim().length > 0);
}

function isBoringSuccessfulToolResult(node: TranscriptNode): boolean {
  if (node.kind !== "tool" || node.phase !== "completed" || node.eventType !== "tool.completed") return false;
  const display = node.display;
  if (display === undefined) return lowValueCopy(node.summary);
  if (display.kind === "command_summary") {
    return display.exitCode === 0 &&
      display.outputSummary === undefined &&
      display.errorSummary === undefined;
  }
  return false;
}

function isLowValueNode(node: TranscriptNode): boolean {
  return [node.title, node.summary, node.text].some(lowValueCopy);
}

function lowValueCopy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeCopy(value);
  return normalized === "等待模型输出" ||
    normalized === "正在组织直接回答" ||
    normalized === "等待模型路由结果" ||
    (normalized.includes("助手已选择使用工具") && normalized.includes("工具结果") && normalized.includes("进入后续处理")) ||
    (normalized.includes("模型调用完成") && normalized.includes("可见输出")) ||
    normalized === "内容已整理并已进入报告或详情";
}

function normalizeCopy(value: string | undefined): string {
  return userVisibleAnswer(value ?? "")
    .replace(/[。.!！?？；;:：、，,\s]/g, "")
    .trim();
}

function normalizedToolName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function confirmationForNode(node: TranscriptNode, pending: ConfirmationProjection | undefined): ConfirmationProjection | undefined {
  if (node.kind !== "confirmation") return undefined;
  const nodeConfirmation = node.confirmation;
  const pendingRunId = pending === undefined ? undefined : confirmationRunId(pending);
  if (pending !== undefined && (nodeConfirmation === undefined || pending.confirmationId === nodeConfirmation.confirmationId || pendingRunId === node.runId)) {
    return pending;
  }
  return nodeConfirmation;
}

function confirmationRunId(confirmation: ConfirmationProjection): string | undefined {
  return "runId" in confirmation ? confirmation.runId : undefined;
}

function confirmationAction(confirmation: ConfirmationProjection): string {
  const raw = "actionSummary" in confirmation ? confirmation.actionSummary : confirmation.question;
  const sanitized = cleanConfirmationSummary(raw);
  return sanitized;
}

function confirmationDisplayTitle(confirmation: ConfirmationProjection | undefined, action: string): string {
  const rawTitle = confirmation?.title === undefined ? "" : cleanConfirmationSummary(confirmation.title);
  const title = isGenericConfirmationTitle(rawTitle) ? "" : rawTitle;
  const combined = [title, action].filter((value) => value.length > 0).join(" ").trim();
  return combined.length > 0 ? combined : "确认";
}

function isGenericConfirmationTitle(value: string): boolean {
  return /^(?:需要确认|待确认|确认继续|确认执行命令)$/i.test(value.trim());
}

function confirmationActionPreview(action: string): string {
  return action
    .replace(/^(?:运行|执行)?\s*命令[:：]?\s*/i, "")
    .replace(/^command[:：]?\s*/i, "")
    .trim() || action;
}

function confirmationRiskLevel(confirmation: ConfirmationProjection): "low" | "medium" | "high" {
  return confirmation.riskLevel === "low" || confirmation.riskLevel === "medium" || confirmation.riskLevel === "high"
    ? confirmation.riskLevel
    : "medium";
}

function cleanConfirmationSummary(value: string): string {
  return value
    .replace(/^(?:需要确认|待确认|继续前需要确认)[。.!！?？]?$/g, "")
    .replace(/批准后只允许继续本次对应工具操作；拒绝则不会执行该动作。?/g, "")
    .replace(/继续前需要确认。?/g, "")
    .replace(/执行前需要用户确认。?/g, "")
    .replace(/运行命令请求执行执行操作[。；]*/g, "")
    .replace(/\btool:call[_:A-Za-z0-9-]+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function commandText(display: Extract<ToolDisplayProjection, { readonly kind: "command_summary" }>): string | undefined {
  const parts = [display.command, ...(display.args ?? [])].filter((value): value is string => value !== undefined && value.trim().length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function fileChangeStats(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): readonly string[] {
  if (display.kind === "file_diff_preview") {
    return [
      display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
      display.previousLength === undefined || display.nextLength === undefined ? undefined : `${display.previousLength} -> ${display.nextLength} chars`,
      display.truncated === true ? "已截取" : undefined,
    ].filter((value): value is string => value !== undefined);
  }
  return [
    display.bytes === undefined ? undefined : `${display.bytes} bytes`,
    display.append === true ? "追加" : undefined,
    display.truncated === true ? "已截取" : undefined,
  ].filter((value): value is string => value !== undefined);
}

function diffLines(preview: string): readonly { readonly sign: string; readonly text: string; readonly kind: "add" | "remove" | "neutral" }[] {
  return preview.split(/\r?\n/).filter((line) => line.length > 0).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return { sign: "+", text: line.slice(1), kind: "add" };
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return { sign: "-", text: line.slice(1), kind: "remove" };
    }
    return { sign: " ", text: line, kind: "neutral" };
  });
}

function genericItemLabel(value: string): string {
  return value.replace(/^(?:file|dir|directory|item)\s+/i, "").trim() || value;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mergeRefs(left: readonly ObservationRef[], right: readonly ObservationRef[]): readonly ObservationRef[] {
  const seen = new Set<string>();
  const result: ObservationRef[] = [];
  for (const ref of [...left, ...right]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function visibleTurns(turns: readonly ConversationTurn[], activeRunId: string | undefined): readonly ConversationTurn[] {
  return turns.filter((turn) =>
    turn.role === "user" ||
    turn.content.trim().length > 0 ||
    (activeRunId !== undefined && turn.role === "assistant" && turn.runId === activeRunId)
  );
}

function assistantModelForTurn(
  turn: ConversationTurn,
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  if (turn.responseModel !== undefined) {
    if (isSyntheticResponseModel(turn)) {
      return undefined;
    }
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
      iconSvg: identity === "unknown" ? undefined : resolveModelIconSvg(identity),
    };
  }
  return selectedComposerModel(models, selectedModelId);
}

function isSyntheticResponseModel(turn: ConversationTurn): boolean {
  const profileId = turn.responseModel?.profileId?.trim().toLowerCase() ?? "";
  const model = turn.responseModel?.model?.trim().toLowerCase() ?? "";
  const providerKind = turn.responseModel?.providerKind?.trim().toLowerCase() ?? "";
  return profileId === "default" && model.length === 0 ||
    profileId === "fake" ||
    profileId === "none" ||
    model === "fake" ||
    model === "none" ||
    providerKind === "fake" ||
    providerKind === "none";
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

function isDuplicateAnswerDeliverable(deliverable: AgentDeliverable, answer: string | undefined): boolean {
  if (answer === undefined || answer.trim().length === 0) return false;
  const normalizedAnswer = normalizeComparableText(answer);
  if (normalizeComparableText(deliverable.summary) === normalizedAnswer) return true;
  return deliverable.sections.some((section) => normalizeComparableText(section.content) === normalizedAnswer);
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
      message: visibleBlockedMessage(detail?.error?.code, detail?.error?.message) ?? workSession?.currentAction ?? "任务暂停了。你可以继续发送消息让我接着处理。",
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
    return "这轮调用次数已到上限，任务没有完成。你可以继续发送消息让我接着处理。";
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

function sanitizeFailureCopy(value: string): string {
  const text = userVisibleAnswer(value).trim();
  const sdkNoBody = /^(\d{3})\s+status code \(no body\)$/i.exec(text);
  const message = sdkNoBody === null ? text : `HTTP ${sdkNoBody[1]}`;
  return message.length <= 1_000 ? message : `${message.slice(0, 999)}…`;
}

function userVisibleAnswer(text: string): string {
  return stripInternalAssistantText(text)
    .replace(/AgentArbor\s*桌面\s*Root Agent/g, "AgentArbor 桌面助手")
    .replace(/Root Agent/g, "助手");
}

function stripInternalAssistantText(text: string): string {
  return text
    .replace(/<\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>[\s\S]*?<\s*\/\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\s*>/gi, "")
    .replace(/<\s*\/?\s*(?:tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\b[^>]*>/gi, "");
}

function normalizeComparableText(value: string): string {
  return userVisibleAnswer(value).replace(/\s+/g, " ").trim();
}

function copyToClipboard(value: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
}
