import type React from "react";
import { getJson } from "./api";
import { createRunReadModelPatch, loadConversationTranscriptNodesByRunId, transcriptNodesFrom } from "./app-run-projection";
import { shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import { liveRunForObservedReplay } from "../../panel-ui-submit-flow";
import { mergeTranscriptNodesByRunId } from "../../panel-ui-transcript-cache";
import {
  safeBasicEvents,
  safeBasicRun,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";
import type { Conversation } from "./contracts/conversation";

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
  const response = await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`);
  const latestRunId = response.conversation.activeRunId ?? response.conversation.latestRunId;
  options.activeRunIdRef.current = latestRunId;
  const detail = latestRunId === undefined ? undefined : await safeDesktopDetail(latestRunId);
  const run = latestRunId === undefined ? undefined : await safeBasicRun(latestRunId);
  const replay = latestRunId === undefined ? undefined : await safeBasicEvents(latestRunId, 0);
  const workSession = latestRunId === undefined ? undefined : await safeWorkSession(latestRunId);
  const transcriptNodes = transcriptNodesFrom(workSession, detail);
  const historicalTranscriptNodesByRunId = await loadConversationTranscriptNodesByRunId(response.conversation, latestRunId);
  if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
  options.setApp((previous) => ({
    ...previous,
    conversation: response.conversation,
    run,
    workSession,
    detail,
    transcriptNodes,
    transcriptNodesByRunId: mergeTranscriptNodesByRunId(historicalTranscriptNodesByRunId, latestRunId, transcriptNodes),
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
    workSession: undefined,
    transcriptNodes: [],
    transcriptNodesByRunId: {},
    events: [],
    live: undefined,
    detail: undefined,
    error: undefined,
  }));
}
