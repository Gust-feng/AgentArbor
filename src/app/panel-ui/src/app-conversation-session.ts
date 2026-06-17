import type React from "react";
import { ApiError, getJson } from "./api";
import { loadConversationTranscriptNodesByRunId, transcriptNodesFrom } from "./app-run-projection";
import { shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import { liveRunForObservedReplay } from "../../panel-ui-submit-flow";
import { mergeTranscriptNodesByRunId } from "../../panel-ui-transcript-cache";
import type { Conversation } from "./contracts/conversation";
import { ordinaryWorkViewFromRunView } from "./runtime";

export type ConversationSessionControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setGoal: (goal: string) => void;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly import("./contracts/context").ContextAttachment[]>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (runId: string, cursor: number) => void;
};

export async function loadConversationSession(
  options: ConversationSessionControllerOptions,
  conversationId: string
): Promise<void> {
  const epoch = options.viewEpochRef.current + 1;
  options.viewEpochRef.current = epoch;
  stopPolling(options.pollTimer);
  stopStream(options.streamRef);
  options.setScreen("chat-active");
  options.setAttachments([]);
  let response: { readonly conversation: Conversation };
  try {
    response = await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`);
  } catch (error) {
    if (isMissingConversationError(error)) {
      resetConversationSession(options);
      options.setApp((previous) => ({
        ...previous,
        conversations: previous.conversations.filter((conversation) => conversation.conversationId !== conversationId),
        error: undefined,
      }));
      try {
        await options.refreshConversations();
      } catch {
        // The main screen is already valid; a later refresh can reconcile the list.
      }
      return;
    }
    throw error;
  }
  const currentRun = response.conversation.currentRun;
  const latestRunId = currentRun?.run.runId ?? response.conversation.activeRunId ?? response.conversation.latestRunId;
  options.activeRunIdRef.current = latestRunId;
  const detail = currentRun?.detail;
  const run = currentRun?.run;
  const replay = currentRun?.replay;
  const workView = ordinaryWorkViewFromRunView(currentRun);
  const capabilityResolution = currentRun?.capabilityResolution;
  const transcriptNodes = transcriptNodesFrom(workView, detail);
  if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
  options.setApp((previous) => ({
    ...previous,
    conversation: response.conversation,
    run,
    workView,
    capabilityResolution,
    capabilityResolutionRunId: capabilityResolution === undefined ? undefined : run?.runId,
    detail,
    transcriptNodes,
    transcriptNodesByRunId: mergeTranscriptNodesByRunId({}, latestRunId, transcriptNodes),
    events: replay?.events ?? [],
    live: run !== undefined && latestRunId !== undefined && shouldKeepRefreshing(run.status)
      ? liveRunForObservedReplay({
          observedRunId: latestRunId,
          observedRun: run,
          previousLive: undefined,
          replayEvents: replay?.events ?? [],
        })
      : undefined,
    error: undefined,
  }));
  if (run !== undefined && shouldKeepRefreshing(run.status)) {
    options.startLiveUpdates(run.runId, replay?.cursor.lastSequence ?? run.eventCursor.lastSequence);
  }
  const historicalTranscriptNodesByRunId = await loadConversationTranscriptNodesByRunId(
    response.conversation,
    latestRunId,
    (partial) => {
      if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
      options.setApp((previous) => ({
        ...previous,
        transcriptNodesByRunId: {
          ...previous.transcriptNodesByRunId,
          ...partial,
        },
      }));
    }
  );
  if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
  options.setApp((previous) => ({
    ...previous,
    transcriptNodesByRunId: {
      ...previous.transcriptNodesByRunId,
      ...historicalTranscriptNodesByRunId,
    },
  }));
}

function isMissingConversationError(error: unknown): boolean {
  return error instanceof ApiError
    && error.status === 404
    && (error.code === "conversation_not_found" || error.code === "not_found");
}

export function resetConversationSession(options: ConversationSessionControllerOptions): void {
  options.viewEpochRef.current += 1;
  stopLiveUpdates(options.pollTimer, options.streamRef);
  options.activeRunIdRef.current = undefined;
  options.setScreen("chat-empty");
  options.setGoal("");
  options.setAttachments([]);
  options.setApp((previous) => ({
    ...previous,
    conversation: undefined,
    run: undefined,
    workView: undefined,
    capabilityResolution: undefined,
    capabilityResolutionRunId: undefined,
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
    live: undefined,
    detail: undefined,
    error: undefined,
  }));
}
