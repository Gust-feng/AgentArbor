import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkView,
  PendingConfirmation,
  TranscriptNode,
} from "../contracts/run";
import type { LiveRunBuffer } from "../../../panel-read-model/run/panel-run-live-buffer";
import { RichText } from "./rich-text";
import { ChatInputBar, type ChatInputProps } from "./chat-empty";
import { projectChatActiveView, type ChatStatusNotice } from "../chat-active-view";
import {
  previousTranscriptVisibleTurnCount,
  reconcileTranscriptVisibilityState,
  runIdsForTurnWindow,
  transcriptVisibleTurnWindow,
  type TranscriptVisibilityState,
} from "../transcript-window";
import {
  getTranscriptNodesCache,
  transcriptNodesCacheForConversation,
  updateTranscriptNodesCache,
} from "../panel-ui-transcript-store";
import { transcriptNodesFrom } from "../app-run-projection";
import { ordinaryWorkViewFromRunView, safeBasicRunView } from "../runtime";
import { ChatTranscriptDisplay } from "./chat-transcript-display";
import type { ConfirmationProjection } from "./transcript-confirmation";
import type { QueuedChatMessage } from "./chat-empty";

export type QueuedMessage = QueuedChatMessage;

const HISTORICAL_TRANSCRIPT_LOAD_CONCURRENCY = 4;

export function ChatActive(props: ChatInputProps & {
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workView?: DesktopWorkView;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly showModelUsage: boolean;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]>;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
  readonly queuedMessages?: readonly QueuedMessage[];
  readonly onRemoveQueuedMessage?: (id: string) => void;
  readonly onUpdateQueuedMessage?: (id: string, content: string) => void;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoStickToBottomRef = useRef(true);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const fullTurnCount = props.conversation?.turns.length ?? 0;
  const [visibilityState, setVisibilityState] = useState<TranscriptVisibilityState>(() => (
    reconcileTranscriptVisibilityState({
      conversationId: props.conversation?.conversationId,
      totalTurns: fullTurnCount,
    })
  ));
  const effectiveVisibilityState = reconcileTranscriptVisibilityState({
    previous: visibilityState,
    conversationId: props.conversation?.conversationId,
    totalTurns: fullTurnCount,
  });
  useLayoutEffect(() => {
    if (effectiveVisibilityState === visibilityState) return;
    setVisibilityState(effectiveVisibilityState);
  }, [effectiveVisibilityState, visibilityState]);
  const visibleWindow = transcriptVisibleTurnWindow(fullTurnCount, effectiveVisibilityState.visibleCount);
  const visibleStartIndex = props.conversation === undefined
    ? 0
    : alignedConversationTurnWindowStart(
        props.conversation.turns,
        visibleWindow.startIndex,
        props.run?.runId ?? props.conversation.activeRunId ?? props.conversation.latestRunId
      );
  const visibleConversation = useMemo(
    () => props.conversation === undefined
      ? undefined
      : visibleWindow.complete
        ? props.conversation
        : {
            ...props.conversation,
            turns: props.conversation.turns.slice(visibleStartIndex),
          },
    [props.conversation, visibleWindow.complete, visibleStartIndex]
  );
  const historicalLoadAbortRef = useRef<AbortController | undefined>(undefined);
  const showEarlierTurns = useCallback(() => {
    if (props.conversation === undefined) return;
    const previousStartIndex = visibleStartIndex;
    const nextVisibleCount = previousTranscriptVisibleTurnCount(
      effectiveVisibilityState.totalTurns,
      effectiveVisibilityState.visibleCount
    );
    const nextWindow = transcriptVisibleTurnWindow(effectiveVisibilityState.totalTurns, nextVisibleCount);
    const nextStartIndex = alignedConversationTurnWindowStart(
      props.conversation.turns,
      nextWindow.startIndex,
      props.run?.runId ?? props.conversation.activeRunId ?? props.conversation.latestRunId
    );
    setVisibilityState((previous) => ({
      ...previous,
      visibleCount: previousTranscriptVisibleTurnCount(previous.totalTurns, previous.visibleCount),
    }));
    void loadVisibleHistoricalRunNodes({
      conversationId: props.conversation.conversationId,
      turns: props.conversation.turns,
      startIndex: nextStartIndex,
      endIndex: previousStartIndex,
      currentRunId: props.run?.runId,
      abortRef: historicalLoadAbortRef,
    });
  }, [effectiveVisibilityState, props.conversation, props.run?.runId, visibleStartIndex]);
  // 静态视图：不依赖 live，在纯文本增量 SSE 事件期间保持缓存
  // （此类事件只更新 live buffer，不更新 conversation/run/workView/transcriptNodes）
  const baseView = useMemo(
    () => projectChatActiveView({
      conversation: visibleConversation,
      run: props.run,
      workView: props.workView,
      transcriptNodes: props.transcriptNodes,
      detail: props.detail,
      error: props.error,
      pendingConfirmation: props.pendingConfirmation,
    }),
    [visibleConversation, props.run, props.workView, props.transcriptNodes, props.detail, props.error, props.pendingConfirmation]
  );
  // 完整视图：无 live 时直接复用 baseView 跳过投影重算；
  // 有 live 时合并 live 数据，仅在此刻重新投影
  const view = useMemo(
    () => props.live === undefined
        ? baseView
        : projectChatActiveView({
          conversation: visibleConversation,
          run: props.run,
          workView: props.workView,
          transcriptNodes: props.transcriptNodes,
          detail: props.detail,
          live: props.live,
          error: props.error,
          pendingConfirmation: props.pendingConfirmation,
        }),
    [baseView, props.live]
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
    return () => {
      historicalLoadAbortRef.current?.abort();
      historicalLoadAbortRef.current = undefined;
    };
  }, [props.conversation?.conversationId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    if (!autoStickToBottomRef.current) return;
    const nextTop = Math.max(0, node.scrollHeight - node.clientHeight);
    if (Math.abs(node.scrollTop - nextTop) <= 1) return;
    node.scrollTop = nextTop;
  }, [view.scrollKey]);

  // Force scroll-to-bottom on conversation switch.
  // The existing auto-stick mechanism only fires when scrollKey changes,
  // but a new conversation may have a different scrollKey or the auto-stick
  // ref might still reflect the old conversation's position.
  useLayoutEffect(() => {
    const conversationId = props.conversation?.conversationId;
    if (conversationId === previousConversationIdRef.current) return;
    previousConversationIdRef.current = conversationId;
    const node = scrollRef.current;
    if (node === null) return;
    autoStickToBottomRef.current = true;
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  });

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
                <ChatTranscriptDisplay
                  conversationId={props.conversation?.conversationId}
                  projectedTurns={view.workline.turns}
                  turns={visibleConversation?.turns ?? []}
                  currentRunId={view.currentRunId}
                  // Historical nodes are owned by the transcript cache. Feeding
                  // only current-run facts avoids rebuilding old turns per delta.
                  currentRunNodes={view.currentRunProjection.nodes}
                  run={props.run}
                  live={props.live}
                  workView={props.workView}
                  pending={view.pending}
                  showModelUsage={props.showModelUsage}
                  standaloneRun={view.workline.standaloneRun !== true
                    ? undefined
                    : {
                        currentRunId: view.currentRunId,
                        runStatus: props.run?.status,
                        answer: view.answer,
                        deliverable: view.deliverable,
                        runProjection: view.currentRunProjection,
                        pending: view.pending,
                      }}
                  models={props.models}
                  selectedModelId={props.selectedModelId}
                  onDecision={props.onDecision}
                  confirmationBusy={props.confirmationBusy}
                  hiddenEarlierTurnCount={visibleStartIndex}
                  onShowEarlierTurns={showEarlierTurns}
                />
                {view.statusNotice !== undefined && <StatusNotice {...view.statusNotice} />}
              </>
            ) : null}
          </main>
        </div>
      </div>

      <ChatInputBar
        {...guidanceInputProps}
        running={props.running ?? view.running}
        placeholder={guidanceInputProps.placeholder ?? "继续输入..."}
        variant="floating"
      />
    </div>
  );
}

function StatusNotice(props: ChatStatusNotice): React.ReactElement {
  return (
    <article className={`status-notice ${props.tone}`}>
      {props.title !== undefined && <h2>{props.title}</h2>}
      <RichText text={props.message} />
    </article>
  );
}

function alignedConversationTurnWindowStart(
  turns: readonly Conversation["turns"][number][],
  startIndex: number,
  currentRunId?: string
): number {
  let alignedStart = startIndex;
  if (currentRunId !== undefined) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role !== "assistant" || turn.runId !== currentRunId) continue;
      alignedStart = Math.min(alignedStart, Math.max(0, index - 1));
      break;
    }
  }
  if (alignedStart <= 0) return 0;
  for (let index = Math.min(alignedStart, turns.length - 1); index >= 0; index -= 1) {
    if (turns[index]?.role === "user") {
      return index;
    }
  }
  return alignedStart;
}

async function loadVisibleHistoricalRunNodes(input: {
  readonly conversationId: string;
  readonly turns: readonly Conversation["turns"][number][];
  readonly startIndex: number;
  readonly endIndex: number;
  readonly currentRunId?: string;
  readonly abortRef: React.MutableRefObject<AbortController | undefined>;
}): Promise<void> {
  const cachedNodes = transcriptNodesCacheForConversation(getTranscriptNodesCache(), input.conversationId);
  const missingRunIds = runIdsForTurnWindow(input.turns, input.startIndex, input.endIndex)
    .filter((runId) => runId !== input.currentRunId)
    .filter((runId) => cachedNodes[runId] === undefined);
  if (missingRunIds.length === 0) return;

  input.abortRef.current?.abort();
  const abortController = new AbortController();
  input.abortRef.current = abortController;
  for (let index = 0; index < missingRunIds.length; index += HISTORICAL_TRANSCRIPT_LOAD_CONCURRENCY) {
    if (abortController.signal.aborted) return;
    const batchRunIds = missingRunIds.slice(index, index + HISTORICAL_TRANSCRIPT_LOAD_CONCURRENCY);
    const batch = await Promise.all(batchRunIds.map(async (runId) => {
      const view = await safeBasicRunView(runId, undefined, { signal: abortController.signal });
      return {
        runId,
        nodes: transcriptNodesFrom(ordinaryWorkViewFromRunView(view))
          .filter((node) => node.runId === runId),
      };
    }));
    if (abortController.signal.aborted) return;
    const patch: Record<string, readonly TranscriptNode[]> = {};
    for (const item of batch) {
      patch[item.runId] = item.nodes;
    }
    updateTranscriptNodesCache(input.conversationId, patch);
  }
}

function isNearBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - (node.scrollTop + node.clientHeight) <= 64;
}

function confirmationResumeLost(
  confirmation: PendingConfirmation | NonNullable<DesktopWorkView["pendingConfirmation"]>
): boolean {
  return confirmation.resumeAvailability === "lost_after_restart";
}
