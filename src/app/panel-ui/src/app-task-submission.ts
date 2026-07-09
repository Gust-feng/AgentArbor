import type React from "react";
import { postJson } from "./api";
import { conversationTurnAttachmentsFromContextAttachments, taskSoilInputFromAttachments } from "./app-attachments";
import {
  runReasoningSettings,
  type ComposerReasoningEffort,
  type ComposerToolConfirmationPolicy,
  type VisibleAiMode,
} from "./app-config-projection";
import { loadObservedRunReadModel } from "./app-observed-run-read-model";
import {
  createRunReadModelPatch,
} from "./app-run-projection";
import { runIdsForConversation } from "../../panel-read-model/transcript/panel-transcript-cache";
import { updateTranscriptNodesCache } from "./panel-ui-transcript-store";
import { shouldKeepRefreshing, stopPolling, stopStream } from "./app-runtime-controls";
import { parseModelOptionId } from "./model-options";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";
import type { Conversation } from "./contracts/conversation";
import type { TranscriptNode } from "./contracts/run";
import {
  immediateRunForStartedConversation,
  liveRunForObservedReplay,
  mergeObservedRunEvents,
  optimisticConversationForSubmit,
  runIdToObserveAfterStart,
  type StartedConversationRun,
} from "./app-task-submit-flow";
import { nextRunCapabilityState } from "./run-capability-state";
import { emptyLiveRun } from "../../panel-read-model/run/panel-run-live-buffer";
import {
  safeConversation,
} from "./runtime";
import { loadHistoricalTranscriptNodeEntries } from "./app-conversation-session";
import type { LiveRunSubscription } from "./app-live-run-updates";

export type PanelTaskSubmissionOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setGoal: (goal: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly selectedWorkspaceDirectory?: string;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly selectedModelId: string;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly conversationLoadAbortRef: React.MutableRefObject<AbortController | undefined>;
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (input: LiveRunSubscription) => void;
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
  options.conversationLoadAbortRef.current?.abort();
  options.conversationLoadAbortRef.current = undefined;
  options.viewEpochRef.current = epoch;
  if (!likelyQueuesBehindActiveRun) {
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
  }
  options.activeRunIdRef.current = previousObservedRunId;
  options.setScreen("chat-active");
  options.setGoal("");
  options.setAttachments([]);
  options.setApp((previous) => {
    const capabilityState = likelyQueuesBehindActiveRun && previous.run !== undefined
      ? nextRunCapabilityState(previous, { runId: previous.run.runId })
      : { capabilityResolution: undefined, capabilityResolutionRunId: undefined };
    return {
      ...previous,
      ...capabilityState,
      busy: true,
      conversation: optimisticConversationForSubmit(
        previous.conversation,
        trimmed,
        undefined,
        conversationTurnAttachmentsFromContextAttachments(attachmentsBeforeSubmit)
      ),
      error: undefined,
      run: likelyQueuesBehindActiveRun ? previous.run : undefined,
      events: likelyQueuesBehindActiveRun ? previous.events : [],
      transcriptNodes: likelyQueuesBehindActiveRun ? previous.transcriptNodes : [],
      live: likelyQueuesBehindActiveRun ? previous.live : undefined,
      detail: likelyQueuesBehindActiveRun ? previous.detail : undefined,
      workView: likelyQueuesBehindActiveRun ? previous.workView : undefined,
    };
  });
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
      toolConfirmationPolicy: options.toolConfirmationPolicy,
      modelOverride: modelOverrideFromSelectedOption(options.selectedModelId),
      workspaceDirectory: options.selectedWorkspaceDirectory,
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
    options.setApp((previous) => {
      const capabilityState = immediateRun === undefined
        ? { capabilityResolution: undefined, capabilityResolutionRunId: undefined }
        : nextRunCapabilityState(previous, { runId: immediateRun.runId });
      return {
        ...previous,
        ...capabilityState,
        busy: false,
        conversation: response.conversation,
        run: immediateRun ?? previous.run,
        events: immediateRun?.runId === previous.run?.runId ? previous.events : [],
        live: immediateLiveRunId === undefined
          ? previous.live
          : previous.live?.runId === immediateLiveRunId
            ? previous.live
            : emptyLiveRun(immediateLiveRunId),
        error: undefined,
      };
    });
    if (shouldSwitchLiveStream) {
      options.startLiveUpdates({
        runId: immediateLiveRunId,
        cursor: 0,
        conversationId: response.conversation.conversationId,
        epoch,
      });
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
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.activeRunIdRef.current = observedRunId;
    options.setApp((previous) => {
      const capabilityState =
        observed?.capabilityResolution !== undefined && observedRunId !== undefined
          ? nextRunCapabilityState(previous, {
              runId: observedRunId,
              capabilityResolution: observed.capabilityResolution,
            })
          : observedRun !== undefined
            ? nextRunCapabilityState(previous, { runId: observedRun.runId })
            : { capabilityResolution: undefined, capabilityResolutionRunId: undefined };
      return {
        ...previous,
        ...capabilityState,
        busy: false,
        conversation: observed?.conversation ?? effectiveConversation,
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
          workView,
          detail,
        }),
      };
    });
    const shouldStartObservedLive =
      observedRunId !== undefined &&
      observedRun !== undefined &&
      shouldKeepRefreshing(observedRun.status) &&
      observedRunId !== immediateLiveRunId &&
      (!likelyQueuesBehindActiveRun || observedRunId !== previousObservedRunId);
    if (shouldStartObservedLive) {
      options.startLiveUpdates({
        runId: observedRunId,
        cursor: replay?.cursor.lastSequence ?? 0,
        conversationId: effectiveConversation.conversationId,
        epoch,
      });
    }
    void options.refreshConversations();
    try {
      // Parallel-load historical run transcript nodes into the external cache
      // (same pattern as loadConversationSession — no onPartial setApp calls).
      const historicalRunIds = runIdsForConversation(effectiveConversation.turns)
        .filter((id) => id !== observedRunId);
      if (historicalRunIds.length > 0) {
        const entries = await loadHistoricalTranscriptNodeEntries(historicalRunIds);
        if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
        const patch: Record<string, readonly TranscriptNode[]> = {};
        for (const [runId, nodes] of entries) {
          patch[runId] = nodes;
        }
        updateTranscriptNodesCache(effectiveConversation.conversationId, patch);
      }
    } catch (error) {
      if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
      options.setApp((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "历史会话记录加载失败。",
      }));
    }
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
      error: error instanceof Error ? error.message : "任务启动失败。",
    }));
  }
}

function modelOverrideFromSelectedOption(
  selectedModelId: string
): { readonly profileId: string; readonly model: string } | undefined {
  const parsed = parseModelOptionId(selectedModelId);
  return parsed === undefined
    ? undefined
    : { profileId: parsed.profileId, model: parsed.modelId };
}
