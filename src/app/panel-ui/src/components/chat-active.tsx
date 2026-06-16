import React, { useLayoutEffect, useMemo, useRef } from "react";
import type { Conversation } from "../contracts/conversation";
import type {
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  PendingConfirmation,
  TranscriptNode,
} from "../contracts/run";
import type { LiveRunBuffer } from "../../../panel-ui-live-run-buffer";
import { RichText } from "./rich-text";
import { ChatInputBar, type ChatInputProps } from "./chat-empty";
import {
  selectedComposerModel,
} from "./chat-session-projection";
import { projectChatActiveView, type ChatStatusNotice } from "../../../panel-ui-chat-active-view";
import {
  AssistantAvatar,
  AssistantMessage,
  TranscriptChain,
  TypingDots,
} from "./chat-transcript-chain";

export function ChatActive(props: ChatInputProps & {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]>;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoStickToBottomRef = useRef(true);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const view = useMemo(
    () => projectChatActiveView({
      conversation: props.conversation,
      run: props.run,
      workView: props.workView,
      transcriptNodes: props.transcriptNodes,
      detail: props.detail,
      live: props.live,
      error: props.error,
      pendingConfirmation: props.pendingConfirmation,
    }),
    [props.conversation, props.run, props.workView, props.transcriptNodes, props.detail, props.live, props.error, props.pendingConfirmation]
  );

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const scrollToBottom = (): void => {
      const nextTop = Math.max(0, node.scrollHeight - node.clientHeight);
      if (Math.abs(node.scrollTop - nextTop) <= 1) return;
      node.scrollTop = nextTop;
    };
    const scheduleBottomStick = (): void => {
      if (!autoStickToBottomRef.current || resizeFrameRef.current !== undefined) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = undefined;
        if (autoStickToBottomRef.current) {
          scrollToBottom();
        }
      });
    };
    const syncAutoStick = (): void => {
      autoStickToBottomRef.current = isNearBottom(node);
    };
    syncAutoStick();
    node.addEventListener("scroll", syncAutoStick, { passive: true });
    const ResizeObserverCtor = window.ResizeObserver;
    const observedContent = node.firstElementChild;
    const resizeObserver = ResizeObserverCtor === undefined
      ? undefined
      : new ResizeObserverCtor(scheduleBottomStick);
    resizeObserver?.observe(node);
    if (observedContent !== null) {
      resizeObserver?.observe(observedContent);
    }
    return () => {
      node.removeEventListener("scroll", syncAutoStick);
      resizeObserver?.disconnect();
      if (resizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = undefined;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    if (!autoStickToBottomRef.current) return;
    const nextTop = Math.max(0, node.scrollHeight - node.clientHeight);
    if (Math.abs(node.scrollTop - nextTop) <= 1) return;
    node.scrollTop = nextTop;
  }, [view.scrollKey]);

  const guidanceInputProps = view.pending === undefined
    ? props
    : confirmationResumeLost(view.pending)
      ? {
          ...props,
          placeholder: "基于当前上下文继续...",
        }
    : {
        ...props,
        placeholder: "补充要求...",
        onSubmit: () => {
          const guidance = props.value.trim();
          if (guidance.length === 0 || props.confirmationBusy) return;
          props.onDecision("guidance", guidance);
          props.onChange("");
        },
      };
  return (
    <div className="chat-active-screen">
      <div className="chat-active-scroll" ref={scrollRef}>
        <div className="chat-active-grid">
          <main className="session-stream" aria-label="任务会话">
            {view.hasVisibleContent ? (
              <>
                <TranscriptChain
                  turns={view.workline.turns}
                  models={props.models}
                  selectedModelId={props.selectedModelId}
                  run={props.run}
                  transcriptNodes={view.transcriptNodes}
                  live={props.live}
                  workView={props.workView}
                  pending={view.pending}
                  onDecision={props.onDecision}
                  confirmationBusy={props.confirmationBusy}
                />
                {view.standaloneAssistant !== undefined && (
                  <AssistantMessage
                    key={view.currentRunId ?? "standalone-assistant"}
                    content={view.standaloneAssistant.content}
                    live={view.standaloneAssistant.live}
                    keepStreamMounted={view.standaloneAssistant.keepStreamMounted}
                    animateOnMount={view.standaloneAssistant.animateOnMount}
                    liveTone={view.standaloneAssistant.liveTone}
                    model={selectedComposerModel(props.models, props.selectedModelId)}
                    transcriptNodes={view.currentRunProjection.nodes}
                    collapseTimeline={shouldCollapseStandaloneTimeline(props.run, view.pending !== undefined)}
                    pending={view.pending}
                    deliverable={view.deliverable}
                    onDecision={props.onDecision}
                    confirmationBusy={props.confirmationBusy}
                  />
                )}
                {view.statusNotice !== undefined && <StatusNotice {...view.statusNotice} />}
                {props.detail?.runtimeSummary !== undefined && (
                  <RuntimeSummaryPanel summary={props.detail.runtimeSummary} />
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
        {...guidanceInputProps}
        running={view.running}
        placeholder={guidanceInputProps.placeholder ?? "继续输入..."}
        variant="floating"
      />
    </div>
  );
}

function StatusNotice(props: ChatStatusNotice): React.ReactElement {
  return (
    <article className={`status-notice ${props.tone}`}>
      <h2>{props.title}</h2>
      <RichText text={props.message} />
    </article>
  );
}

type RuntimeSummary = NonNullable<DesktopRunDetail["runtimeSummary"]>;
type RuntimeProcess = RuntimeSummary["processes"][number];
type RuntimePortFact = RuntimeProcess["ports"][number];

function RuntimeSummaryPanel(props: { readonly summary: RuntimeSummary }): React.ReactElement | null {
  if (props.summary.processes.length === 0) return null;
  return (
    <aside className="runtime-summary-panel" aria-label="运行时事实摘要">
      <div className="runtime-summary-heading">
        <span>运行时事实</span>
        <span>{runtimeSummaryCountText(props.summary)}</span>
      </div>
      <div className="runtime-process-list">
        {props.summary.processes.map((process) => (
          <RuntimeProcessRow key={process.processId} process={process} />
        ))}
      </div>
    </aside>
  );
}

function RuntimeProcessRow(props: { readonly process: RuntimeProcess }): React.ReactElement {
  const process = props.process;
  const portText = runtimePortsText(process.ports);
  const latestFact = runtimeLatestFactText(process);
  return (
    <article className="runtime-process-row" data-status={process.status}>
      <div className="runtime-process-main">
        <span className="runtime-status">{runtimeStatusText(process.status)}</span>
        {process.pid !== undefined && <span>pid {process.pid}</span>}
        <span>{process.kind === "background" ? "后台" : "前台"}</span>
        <span>{process.owned ? "自有" : "非自有"}</span>
      </div>
      <code className="runtime-command-line">{process.commandLine}</code>
      <div className="runtime-process-facts">
        {portText !== undefined && <span>{portText}</span>}
        {process.logRef !== undefined && <span>logRef {process.logRef}</span>}
        {process.logPath !== undefined && <span>logPath {process.logPath}</span>}
        {latestFact !== undefined && <span>{latestFact}</span>}
      </div>
    </article>
  );
}

function runtimeSummaryCountText(summary: RuntimeSummary): string {
  if (summary.residualCount > 0) {
    return `${summary.residualCount}/${summary.totalCount} 未终态`;
  }
  return `${summary.totalCount} 个进程事实`;
}

function runtimeStatusText(status: RuntimeProcess["status"]): string {
  switch (status) {
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "exited":
      return "已退出";
    case "killing":
      return "停止中";
    case "killed":
      return "已停止";
    case "unknown":
      return "未知";
  }
}

function runtimePortsText(ports: readonly RuntimePortFact[]): string | undefined {
  if (ports.length === 0) return undefined;
  return ports.map(runtimePortText).join(" / ");
}

function runtimePortText(port: RuntimePortFact): string {
  const readiness = port.ready === true
    ? "ready"
    : port.ready === false
      ? "not_ready"
      : port.status;
  const occupant = port.externalOccupant?.pid === undefined
    ? undefined
    : `external pid ${port.externalOccupant.pid}`;
  return [
    `port ${port.port}`,
    port.host,
    readiness,
    port.timedOut === true ? "timeout" : undefined,
    port.cancelled === true ? "cancelled" : undefined,
    occupant,
  ].filter((item): item is string => item !== undefined && item.length > 0).join(" ");
}

function runtimeLatestFactText(process: RuntimeProcess): string | undefined {
  const fact = process.latestFact;
  if (fact === undefined) return undefined;
  if (fact.kind === "kill_tree") {
    return [
      "kill_tree",
      fact.resultStatus,
      fact.message,
      fact.errorMessage,
    ].filter((item): item is string => item !== undefined && item.length > 0).join(" ");
  }
  return undefined;
}

function isNearBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - (node.scrollTop + node.clientHeight) <= 64;
}

function shouldCollapseStandaloneTimeline(run: BasicAgentRun | undefined, hasPendingConfirmation: boolean): boolean {
  if (run === undefined || hasPendingConfirmation) return false;
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "blocked";
}

function confirmationResumeLost(
  confirmation: PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]>
): boolean {
  return confirmation.resumeAvailability === "lost_after_restart";
}
