import type React from "react";
import { postJson } from "./api";
import { taskSoilInputFromAttachments } from "./app-attachments";
import { runReasoningSettings, type ComposerReasoningEffort, type VisibleAiMode } from "./app-config-projection";
import { loadObservedRunReadModel } from "./app-observed-run-read-model";
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
  safeConversation,
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
    capabilityResolution:
      likelyQueuesBehindActiveRun && previous.capabilityResolutionRunId === previous.run?.runId
        ? previous.capabilityResolution
        : undefined,
    capabilityResolutionRunId:
      likelyQueuesBehindActiveRun && previous.capabilityResolutionRunId === previous.run?.runId
        ? previous.capabilityResolutionRunId
        : undefined,
    events: likelyQueuesBehindActiveRun ? previous.events : [],
    transcriptNodes: likelyQueuesBehindActiveRun ? previous.transcriptNodes : [],
    live: likelyQueuesBehindActiveRun ? previous.live : undefined,
    detail: likelyQueuesBehindActiveRun ? previous.detail : undefined,
    workView: likelyQueuesBehindActiveRun ? previous.workView : undefined,
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
      capabilityResolution:
        immediateRun?.runId === previous.run?.runId
          ? previous.capabilityResolution
          : undefined,
      capabilityResolutionRunId:
        immediateRun?.runId === previous.run?.runId
          ? previous.capabilityResolutionRunId
          : undefined,
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
    const refreshedConversation = response.conversation.conversationId === undefined
      ? undefined
      : await safeConversation(response.conversation.conversationId);
    const effectiveConversation = refreshedConversation ?? response.conversation;
    const observedRunId = effectiveConversation.currentRun?.run.runId ?? runIdToObserveAfterStart({
      conversation: effectiveConversation,
      responseRunId: response.run.runId,
      responseStatus: response.run.status,
      fetchedStatus: undefined,
      previousObservedRunId,
    });
    const observed = observedRunId === undefined
      ? undefined
      : await loadObservedRunReadModel({
          runId: observedRunId,
          conversationId: effectiveConversation.conversationId,
          preferredConversation: effectiveConversation,
        });
    const observedRun = observed?.run ??
      (observedRunId === undefined
        ? undefined
        : observedRunId === response.run.runId
          ? immediateRun
          : options.app.run?.runId === observedRunId
            ? options.app.run
            : undefined);
    const workView = observed?.workView;
    const detail = observed?.detail;
    const replay = observed?.replay;
    const historicalTranscriptNodesByRunId = await loadConversationTranscriptNodesByRunId(effectiveConversation, observedRunId);
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.activeRunIdRef.current = observedRunId;
    options.setApp((previous) => ({
      ...previous,
      busy: false,
      conversation: observed?.conversation ?? effectiveConversation,
      run: observedRun ?? previous.run,
      capabilityResolution: observed?.capabilityResolution ?? (
        observedRun?.runId === previous.capabilityResolutionRunId ? previous.capabilityResolution : undefined
      ),
      capabilityResolutionRunId:
        observed?.capabilityResolution !== undefined
          ? observedRunId
          : observedRun?.runId === previous.capabilityResolutionRunId
            ? previous.capabilityResolutionRunId
            : undefined,
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
        workView,
        detail,
      }),
      transcriptNodesByRunId: mergeTranscriptNodesByRunId(
        historicalTranscriptNodesByRunId,
        observedRunId,
        transcriptNodesFrom(workView, detail)
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
      workView: appBeforeSubmit.workView,
      capabilityResolution: appBeforeSubmit.capabilityResolution,
      capabilityResolutionRunId: appBeforeSubmit.capabilityResolutionRunId,
      error: `系统错误：${error instanceof Error ? error.message : "任务启动失败。"}`,
    }));
  }
}
