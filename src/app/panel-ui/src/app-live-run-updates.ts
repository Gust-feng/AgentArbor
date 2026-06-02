import type React from "react";
import { createRunReadModelPatch, detailForRun } from "./app-run-projection";
import { shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import {
  appendLiveRunEvent,
  appendLiveRunEvents,
  isLiveAppendOnlyEvent,
} from "../../panel-ui-live-run-buffer";
import {
  mergeEvents,
  openBasicRunStream,
  safeBasicEvents,
  safeBasicRun,
  safeConversation,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";
import type { BasicAgentRun, RunEvent } from "./contracts/run";
import { terminalStatuses } from "./ui-state";

export type LiveRunUpdateController = {
  readonly startLiveUpdates: (runId: string, cursor: number) => void;
  readonly startPolling: (runId: string, cursor: number) => void;
};

export type LiveRunUpdateControllerOptions = {
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly refreshConversations: () => Promise<void>;
};

export function createLiveRunUpdateController(
  options: LiveRunUpdateControllerOptions
): LiveRunUpdateController {
  function startPolling(runId: string, cursor: number): void {
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
    let lastSequence = cursor;
    const tick = async (): Promise<void> => {
      if (options.activeRunIdRef.current !== runId) return;
      try {
        const [runResponse, eventsResponse, workSessionResponse] = await Promise.all([
          fetchBasicRun(runId),
          fetchBasicEvents(runId, lastSequence),
          safeWorkSession(runId),
        ]);
        lastSequence = eventsResponse.cursor.lastSequence;
        if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
          options.setApp((previous) => {
            const readModel = createRunReadModelPatch(previous, {
              runId,
              workSession: workSessionResponse,
              detail: detailForRun(runId, previous.detail),
            });
            return {
              ...previous,
              run: runResponse.run,
              live: appendLiveRunEvents(runId, previous.live, eventsResponse.events),
              events: mergeEvents(previous.events, eventsResponse.events),
              ...readModel,
            };
          });
        }
        if (terminalStatuses.has(runResponse.run.status) || runResponse.run.status === "approval_needed" || runResponse.run.status === "needs_input") {
          const [detail, conversation] = await Promise.all([
            safeDesktopDetail(runId),
            runResponse.run.conversationId === undefined ? undefined : safeConversation(runResponse.run.conversationId),
          ]);
          options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => {
            const readModel = createRunReadModelPatch(previous, { runId, workSession: workSessionResponse, detail });
            return {
              ...previous,
              conversation: conversation ?? previous.conversation,
              live: undefined,
              ...readModel,
            };
          });
          if (!shouldKeepRefreshing(runResponse.run.status)) {
            stopPolling(options.pollTimer);
            void options.refreshConversations();
          }
        }
      } catch (error) {
        options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "刷新运行状态失败。"}`,
        }));
      }
    };
    void tick();
    options.pollTimer.current = window.setInterval(() => void tick(), 1_200);
  }

  function startLiveUpdates(runId: string, cursor: number): void {
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = runId;
    let lastSequence = cursor;
    const refreshAfterEvent = async (event: RunEvent): Promise<void> => {
      if (options.activeRunIdRef.current !== runId) return;
      lastSequence = Math.max(lastSequence, event.sequence);
      if (isLiveAppendOnlyEvent(event)) {
        if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
          options.setApp((previous) => ({
            ...previous,
            live: appendLiveRunEvent(runId, previous.live, event),
            events: mergeEvents(previous.events, [event]),
          }));
        }
        return;
      }
      const [run, workSession] = await Promise.all([
        safeBasicRun(runId),
        safeWorkSession(runId),
      ]);
      if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
        options.setApp((previous) => {
          const readModel = createRunReadModelPatch(previous, {
            runId,
            workSession,
            detail: detailForRun(runId, previous.detail),
          });
          return {
            ...previous,
            run: run ?? previous.run,
            live: appendLiveRunEvent(runId, previous.live, event),
            events: mergeEvents(previous.events, [event]),
            ...readModel,
          };
        });
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        stopStream(options.streamRef);
        const [detail, conversation] = await Promise.all([
          safeDesktopDetail(runId),
          run.conversationId === undefined ? undefined : safeConversation(run.conversationId),
        ]);
        options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => {
          const readModel = createRunReadModelPatch(previous, { runId, workSession, detail });
          return {
            ...previous,
            conversation: conversation ?? previous.conversation,
            live: undefined,
            ...readModel,
          };
        });
        void options.refreshConversations();
      }
    };
    const fallback = (): void => {
      if (options.pollTimer.current === undefined) {
        startPolling(runId, lastSequence);
      }
    };
    const stream = openBasicRunStream({
      runId,
      cursor,
      onEvent: (event) => void refreshAfterEvent(event),
      onError: fallback,
    });
    if (stream === undefined) {
      startPolling(runId, cursor);
      return;
    }
    options.streamRef.current = stream;
  }

  return { startLiveUpdates, startPolling };
}

async function fetchBasicRun(runId: string): Promise<{ readonly run: BasicAgentRun }> {
  const run = await safeBasicRun(runId);
  if (run === undefined) {
    throw new Error("读取运行状态失败。");
  }
  return { run };
}

async function fetchBasicEvents(
  runId: string,
  cursor: number
): Promise<{ readonly events: readonly RunEvent[]; readonly cursor: { readonly lastSequence: number } }> {
  const response = await safeBasicEvents(runId, cursor);
  if (response === undefined) {
    throw new Error("读取运行事件失败。");
  }
  return response;
}
