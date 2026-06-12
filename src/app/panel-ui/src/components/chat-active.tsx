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
