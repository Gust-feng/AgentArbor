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
import { updateTranscriptRunCache } from "./panel-ui-transcript-store";
import type { ToolCallResult } from "../../../domain/tools";
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
import { loadHistoricalTranscriptRunEntries } from "./app-conversation-session";
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

export type PanelTaskConversationBehavior = "continue" | "new";

export async function submitPanelTask(
  options: PanelTaskSubmissionOptions,
  explicitGoal?: string,
  conversationBehavior: PanelTaskConversationBehavior = "continue",
): Promise<boolean> {
  const trimmed = (explicitGoal ?? options.goal).trim();
  if (trimmed.length === 0 || options.app.busy) return false;
  const startsNewConversation = conversationBehavior === "new";
  const conversationForSubmit = startsNewConversation ? undefined : options.app.conversation;
  const runForSubmit = startsNewConversation ? undefined : options.app.run;
  const epoch = options.viewEpochRef.current + 1;
  const previousObservedRunId = startsNewConversation
    ? undefined
    : options.activeRunIdRef.current ?? options.app.run?.runId;
  const appBeforeSubmit = options.app;
  const attachmentsBeforeSubmit = options.attachments;
  const likelyQueuesBehindActiveRun = conversationForSubmit !== undefined &&
    previousObservedRunId !== undefined &&
    runForSubmit !== undefined &&
    shouldKeepRefreshing(runForSubmit.status);
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
        conversationForSubmit,
        trimmed,
        undefined,
        conversationTurnAttachmentsFromContextAttachments(attachmentsBeforeSubmit)
      ),
      error: undefined,
      run: likelyQueuesBehindActiveRun ? previous.run : undefined,
      events: likelyQueuesBehindActiveRun ? previous.events : [],
      transcriptNodes: likelyQueuesBehindActiveRun ? previous.transcriptNodes : [],
      transcriptNodesByRunId: startsNewConversation ? {} : previous.transcriptNodesByRunId,
      live: likelyQueuesBehindActiveRun ? previous.live : undefined,
      detail: likelyQueuesBehindActiveRun ? previous.detail : undefined,
      workView: likelyQueuesBehindActiveRun ? previous.workView : undefined,
    };
  });
  try {
    const path =
      conversationForSubmit?.conversationId === undefined
        ? "/api/conversations"
        : `/api/conversations/${encodeURIComponent(conversationForSubmit.conversationId)}/messages`;
    const response = await postJson<{
      readonly conversation: Conversation;
      readonly run: StartedConversationRun;
    }>(path, {
      goal: trimmed,
      aiMode: options.aiMode,
      toolConfirmationPolicy: options.toolConfirmationPolicy,
      modelOverride: modelOverrideFromSelectedOption(options.selectedModelId),
      workspaceDirectory: options.selectedWorkspaceDirectory,
      taskSoilInput: taskSoilInputFromAttachments(attachmentsBeforeSubmit),
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
      previousRun: runForSubmit,
      responseRun: response.run,
      observedRunId: immediateObservedRunId,
      goal: trimmed,
    });
    const immediateLiveRunId = immediateRun !== undefined && shouldKeepRefreshing(immediateRun.status)
      ? immediateRun.runId
      : undefined;
    const shouldSwitchLiveStream = immediateLiveRunId !== undefined &&
      (!likelyQueuesBehindActiveRun || immediateLiveRunId !== previousObservedRunId);
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return false;
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
        run: immediateRun ?? (startsNewConversation ? undefined : previous.run),
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
          : runForSubmit?.runId === observedRunId
            ? runForSubmit
            : undefined);
    const workView = observed?.workView;
    const detail = observed?.detail;
    const replay = observed?.replay;
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return false;
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
        cursor: replay?.cursor.token,
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
        const entries = await loadHistoricalTranscriptRunEntries(historicalRunIds);
        if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return false;
        const nodesByRunId: Record<string, readonly TranscriptNode[]> = {};
        const toolResultsByRunId: Record<string, readonly ToolCallResult[]> = {};
        for (const entry of entries) {
          nodesByRunId[entry.runId] = entry.nodes;
          toolResultsByRunId[entry.runId] = entry.toolResults;
        }
        updateTranscriptRunCache(effectiveConversation.conversationId, { nodesByRunId, toolResultsByRunId });
      }
    } catch (error) {
      if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return false;
      options.setApp((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "历史会话记录加载失败。",
      }));
    }
    return true;
  } catch (error) {
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return false;
    options.setGoal(trimmed);
    options.setAttachments(attachmentsBeforeSubmit);
    if (startsNewConversation) {
      options.activeRunIdRef.current = undefined;
      options.setScreen("chat-empty");
    }
    options.setApp((previous) => ({
      ...previous,
      busy: false,
      conversation: startsNewConversation ? undefined : appBeforeSubmit.conversation,
      run: startsNewConversation ? undefined : appBeforeSubmit.run,
      events: startsNewConversation ? [] : appBeforeSubmit.events,
      transcriptNodes: startsNewConversation ? [] : appBeforeSubmit.transcriptNodes,
      transcriptNodesByRunId: startsNewConversation ? {} : appBeforeSubmit.transcriptNodesByRunId,
      live: startsNewConversation ? undefined : appBeforeSubmit.live,
      detail: startsNewConversation ? undefined : appBeforeSubmit.detail,
      workView: startsNewConversation ? undefined : appBeforeSubmit.workView,
      capabilityResolution: startsNewConversation ? undefined : appBeforeSubmit.capabilityResolution,
      capabilityResolutionRunId: startsNewConversation ? undefined : appBeforeSubmit.capabilityResolutionRunId,
      error: error instanceof Error ? error.message : "任务启动失败。",
    }));
    return false;
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
