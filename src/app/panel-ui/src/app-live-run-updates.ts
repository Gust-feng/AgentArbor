import type React from "react";
import { isObservedRunSettled, shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import {
  isLiveAppendOnlyEvent,
} from "../../panel-ui-live-run-buffer";
import {
  appStateWithSettledConversationGuard,
  appStateWithAppendOnlyRunEvents,
  appStateWithObservedRunEvent,
  appStateWithObservedRunProjection,
  canApplyRunSubscriptionToAppState,
  createAppendOnlyRunEventBatcher,
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
const APPEND_ONLY_FLUSH_INTERVAL_MS = 16;

export type LiveRunUpdateController = {
  readonly startLiveUpdates: (input: LiveRunSubscription) => void;
  readonly startPolling: (input: LiveRunSubscription) => void;
};

export type LiveRunUpdateControllerOptions = {
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly refreshConversations: () => Promise<void>;
};

export type LiveRunSubscription = {
  readonly runId: string;
  readonly cursor: number;
  readonly conversationId?: string;
  readonly epoch: number;
};

export function createLiveRunUpdateController(
  options: LiveRunUpdateControllerOptions
): LiveRunUpdateController {
  const appendOnlyBatcher = createAppendOnlyRunEventBatcher<{
    readonly subscription: LiveRunSubscription;
    readonly event: RunEvent;
  }>({
    schedule: scheduleAppendOnlyFlush,
    apply: (items) => {
      if (!options.mountedRef.current) {
        return;
      }
      options.setApp((previous) => {
        const applicable = items.filter((item) => canApplyAppendOnlyToState(previous, item.subscription));
        const latest = applicable.at(-1);
        if (latest === undefined) {
          return previous;
        }
        const events = applicable
          .filter((item) => item.subscription.runId === latest.subscription.runId)
          .map((item) => item.event);
        return events.length === 0
          ? previous
          : appStateWithAppendOnlyRunEvents(previous, {
              runId: latest.subscription.runId,
              events,
            });
      });
    },
  });

  function startPolling(subscription: LiveRunSubscription): void {
    appendOnlyBatcher.clear();
    const { runId } = subscription;
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
    let lastSequence = subscription.cursor;
    const tick = async (): Promise<void> => {
      if (!subscriptionIsCurrent(subscription)) return;
      try {
        const runView = await fetchBasicRunView(runId, lastSequence);
        lastSequence = runView.replay.cursor.lastSequence;
        await applyRunViewProjection(subscription, runView);
      } catch (error) {
        if (!subscriptionIsCurrent(subscription)) return;
        options.setApp((previous) =>
          canApplyToState(previous, subscription)
            ? {
                ...previous,
                error: error instanceof Error ? error.message : "刷新运行状态失败。",
              }
            : previous
        );
      }
    };
    void tick();
    options.pollTimer.current = window.setInterval(() => void tick(), FALLBACK_POLL_INTERVAL_MS);
  }

  function startLiveUpdates(subscription: LiveRunSubscription): void {
    appendOnlyBatcher.clear();
    const { runId } = subscription;
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = runId;
    let lastSequence = subscription.cursor;
    let streamDeliveredEvent = false;
    let liveRunSettled = false;
    const refreshAfterEvent = async (event: RunEvent): Promise<void> => {
      if (!subscriptionIsCurrent(subscription)) return;
      lastSequence = Math.max(lastSequence, event.sequence);
      if (isLiveAppendOnlyEvent(event)) {
        if (subscriptionIsCurrent(subscription)) {
          appendOnlyBatcher.enqueue({ subscription, event });
        }
        return;
      }
      appendOnlyBatcher.flush();
      const runView = await fetchBasicRunView(runId, 0);
      const run = runView.run;
      const workView = ordinaryWorkViewFromRunView(runView);
      const capabilityResolution = runView.capabilityResolution;
      const detail = runView.detail;
      if (subscriptionIsCurrent(subscription)) {
        options.setApp((previous) =>
          canApplyToState(previous, subscription)
            ? appStateWithObservedRunEvent(previous, {
                runId,
                run,
                event,
                workView,
                capabilityResolution,
                detail,
              })
            : previous
        );
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        liveRunSettled = true;
        stopPolling(options.pollTimer);
        stopStream(options.streamRef);
        const settled = await loadSettledRunProjection({ runId, run, workView, capabilityResolution });
        if (subscriptionIsCurrent(subscription)) {
          options.setApp((previous) =>
            canApplyToState(previous, subscription)
              ? appStateWithSettledConversationGuard(previous, {
                  expectedConversationId: subscription.conversationId,
                  next: appStateWithSettledRunProjection(previous, settled),
                })
              : previous
          );
        }
        const followUp = refreshingFollowUpRun(settled);
        if (followUp !== undefined) {
          options.activeRunIdRef.current = followUp.runId;
          startLiveUpdates({
            ...subscription,
            runId: followUp.runId,
            cursor: followUp.cursor,
          });
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
        if (streamDeliveredEvent || inFlight || !subscriptionIsCurrent(subscription)) {
          return;
        }
        attempts += 1;
        inFlight = true;
        try {
          const runView = await fetchBasicRunView(runId, lastSequence);
          lastSequence = runView.replay.cursor.lastSequence;
          await applyRunViewProjection(subscription, runView);
          if (runView.replay.events.length > 0 && !streamDeliveredEvent) {
            attempts = 0;
          }
        } finally {
          inFlight = false;
          if (
            subscriptionIsCurrent(subscription) &&
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
      appendOnlyBatcher.flush();
      startPolling({ ...subscription, cursor: lastSequence });
    };
    const stream = openBasicRunStream({
      runId,
      cursor: subscription.cursor,
      onEvent: (event) => {
        streamDeliveredEvent = true;
        stopBootstrapPolling();
        void refreshAfterEvent(event);
      },
      onError: fallback,
    });
    if (stream === undefined) {
      startPolling(subscription);
      return;
    }
    options.streamRef.current = stream;
    startBootstrapPolling();
  }

  async function applyRunViewProjection(
    subscription: LiveRunSubscription,
    runView: Awaited<ReturnType<typeof fetchBasicRunView>>
  ): Promise<void> {
    appendOnlyBatcher.flush();
    const { runId } = subscription;
    if (subscriptionIsCurrent(subscription)) {
      options.setApp((previous) =>
        canApplyToState(previous, subscription)
          ? appStateWithObservedRunProjection(previous, {
              runId,
              run: runView.run,
              events: runView.replay.events,
              workView: ordinaryWorkViewFromRunView(runView),
              capabilityResolution: runView.capabilityResolution,
              detail: runView.detail,
            })
          : previous
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
    if (subscriptionIsCurrent(subscription)) {
      options.setApp((previous) =>
        canApplyToState(previous, subscription)
          ? appStateWithSettledConversationGuard(previous, {
              expectedConversationId: subscription.conversationId,
              next: appStateWithSettledRunProjection(previous, settled),
            })
          : previous
      );
    }
    const followUp = refreshingFollowUpRun(settled);
    if (followUp !== undefined) {
      options.activeRunIdRef.current = followUp.runId;
      startLiveUpdates({
        ...subscription,
        runId: followUp.runId,
        cursor: followUp.cursor,
      });
    } else if (!shouldKeepRefreshing(runView.run.status)) {
      stopPolling(options.pollTimer);
      void options.refreshConversations();
    }
  }

  return { startLiveUpdates, startPolling };

  function subscriptionIsCurrent(subscription: LiveRunSubscription): boolean {
    return options.mountedRef.current &&
      options.activeRunIdRef.current === subscription.runId &&
      options.viewEpochRef.current === subscription.epoch;
  }

  function canApplyToState(previous: AppState, subscription: LiveRunSubscription): boolean {
    return canApplyRunSubscriptionToAppState({
      previous,
      activeRunId: options.activeRunIdRef.current,
      currentEpoch: options.viewEpochRef.current,
      runId: subscription.runId,
      conversationId: subscription.conversationId,
      epoch: subscription.epoch,
    });
  }

  function canApplyAppendOnlyToState(previous: AppState, subscription: LiveRunSubscription): boolean {
    return canApplyToState(previous, subscription) &&
      previous.run?.runId === subscription.runId &&
      previous.run !== undefined &&
      shouldKeepRefreshing(previous.run.status);
  }
}

function scheduleAppendOnlyFlush(flush: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(() => flush());
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(() => flush(), APPEND_ONLY_FLUSH_INTERVAL_MS);
  return () => window.clearTimeout(timer);
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
