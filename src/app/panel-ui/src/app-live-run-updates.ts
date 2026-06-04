import type React from "react";
import { shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import {
  isLiveAppendOnlyEvent,
} from "../../panel-ui-live-run-buffer";
import {
  appStateWithAppendOnlyRunEvent,
  appStateWithObservedRunEvent,
  appStateWithObservedRunProjection,
} from "./app-run-observation-state";
import {
  appStateWithSettledRunProjection,
  loadSettledRunProjection,
  refreshingFollowUpRun,
} from "./app-run-observation-settlement";
import {
  openBasicRunStream,
  safeBasicEvents,
  safeBasicRun,
  safeWorkSession,
} from "./runtime";
import type { BasicAgentRun, RunEvent } from "./contracts/run";
import { terminalStatuses } from "./ui-state";

const FALLBACK_POLL_INTERVAL_MS = 1_200;
const STREAM_BOOTSTRAP_POLL_INTERVAL_MS = 160;
const STREAM_BOOTSTRAP_POLL_LIMIT = 75;

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
          options.setApp((previous) =>
            appStateWithObservedRunProjection(previous, {
              runId,
              run: runResponse.run,
              events: eventsResponse.events,
              workSession: workSessionResponse,
            })
          );
        }
        if (isObservedRunSettled(runResponse.run)) {
          const settled = await loadSettledRunProjection({
            runId,
            run: runResponse.run,
            workSession: workSessionResponse,
          });
          options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => {
            return appStateWithSettledRunProjection(previous, settled);
          });
          const followUp = refreshingFollowUpRun(settled);
          if (followUp !== undefined) {
            options.activeRunIdRef.current = followUp.runId;
            startLiveUpdates(followUp.runId, followUp.cursor);
          } else if (!shouldKeepRefreshing(runResponse.run.status)) {
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
    options.pollTimer.current = window.setInterval(() => void tick(), FALLBACK_POLL_INTERVAL_MS);
  }

  function startLiveUpdates(runId: string, cursor: number): void {
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = runId;
    let lastSequence = cursor;
    let streamDeliveredEvent = false;
    let liveRunSettled = false;
    const refreshAfterEvent = async (event: RunEvent): Promise<void> => {
      if (options.activeRunIdRef.current !== runId) return;
      lastSequence = Math.max(lastSequence, event.sequence);
      if (isLiveAppendOnlyEvent(event)) {
        if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
          options.setApp((previous) => appStateWithAppendOnlyRunEvent(previous, { runId, event }));
        }
        return;
      }
      const [run, workSession] = await Promise.all([
        safeBasicRun(runId),
        safeWorkSession(runId),
      ]);
      if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
        options.setApp((previous) =>
          appStateWithObservedRunEvent(previous, {
            runId,
            run,
            event,
            workSession,
          })
        );
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        liveRunSettled = true;
        stopPolling(options.pollTimer);
        stopStream(options.streamRef);
        const settled = await loadSettledRunProjection({ runId, run, workSession });
        options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => {
          return appStateWithSettledRunProjection(previous, settled);
        });
        const followUp = refreshingFollowUpRun(settled);
        if (followUp !== undefined) {
          options.activeRunIdRef.current = followUp.runId;
          startLiveUpdates(followUp.runId, followUp.cursor);
        } else {
          void options.refreshConversations();
        }
      }
    };
    const stopBootstrapPolling = (): void => stopPolling(options.pollTimer);
    const startBootstrapPolling = (): void => {
      let attempts = 0;
      let inFlight = false;
      const poll = async (): Promise<void> => {
        if (streamDeliveredEvent || inFlight || options.activeRunIdRef.current !== runId) {
          return;
        }
        attempts += 1;
        inFlight = true;
        try {
          const eventsResponse = await safeBasicEvents(runId, lastSequence);
          const events = eventsResponse?.events ?? [];
          for (const event of events) {
            await refreshAfterEvent(event);
          }
          if (events.length > 0 && !streamDeliveredEvent) {
            attempts = 0;
          }
        } finally {
          inFlight = false;
          if (streamDeliveredEvent || attempts >= STREAM_BOOTSTRAP_POLL_LIMIT) {
            stopBootstrapPolling();
          }
        }
      };
      void poll();
      options.pollTimer.current = window.setInterval(() => void poll(), STREAM_BOOTSTRAP_POLL_INTERVAL_MS);
    };
    const fallback = (): void => {
      if (liveRunSettled) return;
      startPolling(runId, lastSequence);
    };
    const stream = openBasicRunStream({
      runId,
      cursor,
      onEvent: (event) => {
        streamDeliveredEvent = true;
        stopBootstrapPolling();
        void refreshAfterEvent(event);
      },
      onError: fallback,
    });
    if (stream === undefined) {
      startPolling(runId, cursor);
      return;
    }
    options.streamRef.current = stream;
    startBootstrapPolling();
  }

  return { startLiveUpdates, startPolling };
}

function isObservedRunSettled(run: BasicAgentRun): boolean {
  return terminalStatuses.has(run.status) || run.status === "approval_needed" || run.status === "needs_input";
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
