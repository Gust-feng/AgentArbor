import type React from "react";
import { isObservedRunSettled, shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
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
  ordinaryWorkViewFromRunView,
  safeBasicRunView,
} from "./runtime";
import type { BasicAgentRun, RunEvent } from "./contracts/run";

const FALLBACK_POLL_INTERVAL_MS = 1_200;
const STREAM_BOOTSTRAP_POLL_INTERVAL_MS = 500;
const STREAM_BOOTSTRAP_POLL_LIMIT = 12;

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
        const runView = await fetchBasicRunView(runId, lastSequence);
        lastSequence = runView.replay.cursor.lastSequence;
        await applyRunViewProjection(runId, runView);
      } catch (error) {
        options.mountedRef.current && options.activeRunIdRef.current === runId && options.setApp((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "刷新运行状态失败。",
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
      const runView = await fetchBasicRunView(runId, 0);
      const run = runView.run;
      const workView = ordinaryWorkViewFromRunView(runView);
      const capabilityResolution = runView.capabilityResolution;
      const detail = runView.detail;
      if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
        options.setApp((previous) =>
          appStateWithObservedRunEvent(previous, {
            runId,
            run,
            event,
            workView,
            capabilityResolution,
            detail,
          })
        );
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        liveRunSettled = true;
        stopPolling(options.pollTimer);
        stopStream(options.streamRef);
        const settled = await loadSettledRunProjection({ runId, run, workView, capabilityResolution });
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
          const runView = await fetchBasicRunView(runId, lastSequence);
          lastSequence = runView.replay.cursor.lastSequence;
          await applyRunViewProjection(runId, runView);
          if (runView.replay.events.length > 0 && !streamDeliveredEvent) {
            attempts = 0;
          }
        } finally {
          inFlight = false;
          if (
            options.activeRunIdRef.current === runId &&
            (streamDeliveredEvent || attempts >= STREAM_BOOTSTRAP_POLL_LIMIT)
          ) {
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

  async function applyRunViewProjection(
    runId: string,
    runView: Awaited<ReturnType<typeof fetchBasicRunView>>
  ): Promise<void> {
    if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
      options.setApp((previous) =>
        appStateWithObservedRunProjection(previous, {
          runId,
          run: runView.run,
          events: runView.replay.events,
          workView: ordinaryWorkViewFromRunView(runView),
          capabilityResolution: runView.capabilityResolution,
          detail: runView.detail,
        })
      );
    }
    if (!isObservedRunSettled(runView.run)) {
      return;
    }
    const settled = await loadSettledRunProjection({
      runId,
      run: runView.run,
      workView: ordinaryWorkViewFromRunView(runView),
      capabilityResolution: runView.capabilityResolution,
    });
    if (options.mountedRef.current && options.activeRunIdRef.current === runId) {
      options.setApp((previous) => appStateWithSettledRunProjection(previous, settled));
    }
    const followUp = refreshingFollowUpRun(settled);
    if (followUp !== undefined) {
      options.activeRunIdRef.current = followUp.runId;
      startLiveUpdates(followUp.runId, followUp.cursor);
    } else if (!shouldKeepRefreshing(runView.run.status)) {
      stopPolling(options.pollTimer);
      void options.refreshConversations();
    }
  }

  return { startLiveUpdates, startPolling };
}

async function fetchBasicRunView(
  runId: string,
  cursor: number
): Promise<{
  readonly run: BasicAgentRun;
  readonly capabilityResolution?: NonNullable<Awaited<ReturnType<typeof safeBasicRunView>>>["capabilityResolution"];
  readonly workView: NonNullable<Awaited<ReturnType<typeof safeBasicRunView>>>["workView"];
  readonly detail: NonNullable<Awaited<ReturnType<typeof safeBasicRunView>>>["detail"];
  readonly replay: NonNullable<Awaited<ReturnType<typeof safeBasicRunView>>>["replay"];
}> {
  const view = await safeBasicRunView(runId, cursor);
  if (view === undefined) {
    throw new Error("读取运行视图失败。");
  }
  return view;
}
