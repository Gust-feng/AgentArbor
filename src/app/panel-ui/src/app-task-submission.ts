import type React from "react";
import { postJson } from "./api";
import { taskSoilInputFromAttachments } from "./app-attachments";
import { runReasoningSettings, type ComposerReasoningEffort, type VisibleAiMode } from "./app-config-projection";
import {
  createRunReadModelPatch,
  loadConversationTranscriptNodesByRunId,
  transcriptNodesFrom,
} from "./app-run-projection";
import { shouldKeepRefreshing, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";
import type { Conversation } from "./contracts/conversation";
import {
  immediateRunForStartedConversation,
  liveRunForObservedReplay,
  mergeObservedRunEvents,
  optimisticConversationForSubmit,
  runIdToObserveAfterStart,
  type StartedConversationRun,
} from "../../panel-ui-submit-flow";
import { emptyLiveRun } from "../../panel-ui-live-run-buffer";
import { mergeTranscriptNodesByRunId } from "../../panel-ui-transcript-cache";
import {
  safeBasicEvents,
  safeBasicRun,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";

export type PanelTaskSubmissionOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setGoal: (goal: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (runId: string, cursor: number) => void;
};

export async function submitPanelTask(
  options: PanelTaskSubmissionOptions,
  explicitGoal?: string
): Promise<void> {
  const trimmed = (explicitGoal ?? options.goal).trim();
  if (trimmed.length === 0 || options.app.busy) return;
  const epoch = options.viewEpochRef.current + 1;
  const previousObservedRunId = options.activeRunIdRef.current ?? options.app.run?.runId;
  const appBeforeSubmit = options.app;
  const attachmentsBeforeSubmit = options.attachments;
  const conversationBeforeSubmit = options.app.conversation;
  const likelyQueuesBehindActiveRun = options.app.conversation !== undefined &&
    previousObservedRunId !== undefined &&
    options.app.run !== undefined &&
    shouldKeepRefreshing(options.app.run.status);
  options.viewEpochRef.current = epoch;
  if (!likelyQueuesBehindActiveRun) {
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
  }
  options.activeRunIdRef.current = previousObservedRunId;
  options.setScreen("chat-active");
  options.setGoal("");
  options.setAttachments([]);
  options.setApp((previous) => ({
    ...previous,
    busy: true,
    conversation: optimisticConversationForSubmit(previous.conversation, trimmed),
    error: undefined,
    run: likelyQueuesBehindActiveRun ? previous.run : undefined,
    events: likelyQueuesBehindActiveRun ? previous.events : [],
    transcriptNodes: likelyQueuesBehindActiveRun ? previous.transcriptNodes : [],
    live: likelyQueuesBehindActiveRun ? previous.live : undefined,
    detail: likelyQueuesBehindActiveRun ? previous.detail : undefined,
    workSession: likelyQueuesBehindActiveRun ? previous.workSession : undefined,
  }));
  try {
    const path =
      options.app.conversation?.conversationId === undefined
        ? "/api/conversations"
        : `/api/conversations/${encodeURIComponent(options.app.conversation.conversationId)}/messages`;
    const response = await postJson<{
      readonly conversation: Conversation;
      readonly run: StartedConversationRun;
    }>(path, {
      goal: trimmed,
      runMode: "agent",
      aiMode: options.aiMode,
      taskSoilInput: taskSoilInputFromAttachments(options.attachments),
      ...runReasoningSettings(options.composerReasoningEffort, options.selectedModelSupportsReasoningEffort),
    });
    const immediateObservedRunId = runIdToObserveAfterStart({
      conversation: response.conversation,
      responseRunId: response.run.runId,
      responseStatus: response.run.status,
      fetchedStatus: undefined,
      previousObservedRunId,
    });
    const immediateRun = immediateRunForStartedConversation({
      previousRun: options.app.run,
      responseRun: response.run,
      observedRunId: immediateObservedRunId,
      goal: trimmed,
    });
    const immediateLiveRunId = immediateRun !== undefined && shouldKeepRefreshing(immediateRun.status)
      ? immediateRun.runId
      : undefined;
    const shouldSwitchLiveStream = immediateLiveRunId !== undefined &&
      (!likelyQueuesBehindActiveRun || immediateLiveRunId !== previousObservedRunId);
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.activeRunIdRef.current = immediateObservedRunId;
    options.setApp((previous) => ({
      ...previous,
      busy: true,
      conversation: response.conversation,
      run: immediateRun ?? previous.run,
      events: immediateRun?.runId === previous.run?.runId ? previous.events : [],
      live: immediateLiveRunId === undefined
        ? previous.live
        : previous.live?.runId === immediateLiveRunId
          ? previous.live
          : emptyLiveRun(immediateLiveRunId),
      error: undefined,
    }));
    if (shouldSwitchLiveStream) {
      options.startLiveUpdates(immediateLiveRunId, 0);
    }
    const run = await safeBasicRun(response.run.runId);
    const observedRunId = runIdToObserveAfterStart({
      conversation: response.conversation,
      responseRunId: response.run.runId,
      responseStatus: response.run.status,
      fetchedStatus: run?.status,
      previousObservedRunId,
    });
    const observedRun = observedRunId === response.run.runId
      ? run
      : observedRunId === undefined
        ? undefined
        : await safeBasicRun(observedRunId);
    const [workSession, detail, replay] = observedRunId === undefined
      ? [undefined, undefined, undefined] as const
      : await Promise.all([
          safeWorkSession(observedRunId),
          safeDesktopDetail(observedRunId),
          safeBasicEvents(observedRunId, 0),
        ]);
    const historicalTranscriptNodesByRunId = await loadConversationTranscriptNodesByRunId(response.conversation, observedRunId);
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.activeRunIdRef.current = observedRunId;
    options.setApp((previous) => ({
      ...previous,
      busy: false,
      conversation: response.conversation,
      run: observedRun ?? previous.run,
      events: mergeObservedRunEvents({
        previousRunId: previous.run?.runId,
        observedRunId,
        previousEvents: previous.events,
        replayEvents: replay?.events ?? [],
      }),
      live: liveRunForObservedReplay({
        observedRunId,
        observedRun,
        previousLive: previous.live,
        replayEvents: replay?.events ?? [],
      }),
      ...createRunReadModelPatch(previous, {
        runId: observedRunId ?? response.run.runId,
        workSession,
        detail,
      }),
      transcriptNodesByRunId: mergeTranscriptNodesByRunId(
        historicalTranscriptNodesByRunId,
        observedRunId,
        transcriptNodesFrom(workSession, detail)
      ),
    }));
    if (
      observedRunId !== undefined &&
      observedRun !== undefined &&
      shouldKeepRefreshing(observedRun.status) &&
      observedRunId !== immediateLiveRunId &&
      (!likelyQueuesBehindActiveRun || observedRunId !== previousObservedRunId)
    ) {
      options.startLiveUpdates(observedRunId, replay?.cursor.lastSequence ?? 0);
    }
    void options.refreshConversations();
  } catch (error) {
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.setGoal(trimmed);
    options.setAttachments(attachmentsBeforeSubmit);
    options.setApp((previous) => ({
      ...previous,
      busy: false,
      conversation: conversationBeforeSubmit,
      run: appBeforeSubmit.run,
      events: appBeforeSubmit.events,
      transcriptNodes: appBeforeSubmit.transcriptNodes,
      transcriptNodesByRunId: appBeforeSubmit.transcriptNodesByRunId,
      live: appBeforeSubmit.live,
      detail: appBeforeSubmit.detail,
      workSession: appBeforeSubmit.workSession,
      error: `系统错误：${error instanceof Error ? error.message : "任务启动失败。"}`,
    }));
  }
}
