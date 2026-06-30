import type React from "react";
import { ApiError, getJson } from "./api";
import {
  deepConversationSummaryFromView,
  deepRunSummaryFromView,
  shouldKeepDeepRunBusy,
  shouldPollDeepRun,
  upsertDeepConversationSummary,
  upsertDeepRunSummary,
} from "./app-deep-history";
import type { AppState } from "./app-state";
import type { GetDeepRunViewResponse } from "./contracts/deep";
import { openDeepRunStream } from "./runtime";

/**
 * Deep 运行投影实时更新模块（T3-4e）。
 *
 * deep run 在后台执行（202 不阻塞）。前端使用 SSE 订阅 `/events` 获得即时推进信号，
 * 每次事件到达后再拉取 `GET /api/deep/runs/:runId/view` 获取权威安全投影。
 *
 * 与普通 Agent 的 [`app-live-run-updates`](./app-live-run-updates.ts) 区别：
 *   - 普通 Agent 会把 append-only 模型增量直接并入 transcript；
 *   - deep run 不在前端重建事实，SSE 只触发刷新，`liveProjection` 仍以 `/view` 为准。
 *
 * 轮询策略：
 *   - 提交成功后立即首轮拉取，同时开启 SSE；兜底每 1s 拉取 `/view`；
 *   - runtimeHealth 进入 terminal/orphaned 时停止高频轮询并释放 deepBusy；
 *   - 404（record 尚未写入）：静默重试，不报错（后台 run 刚启动的竞态）；
 *   - 其他错误：写入 app.error 但保持轮询（瞬态网络抖动不应终止观察）；
 */

const DEEP_POLL_INTERVAL_MS = 1_000;

export type DeepRunUpdateControllerOptions = {
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimerRef: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
};

export type DeepRunUpdateController = {
  /** 启动指定 run 的 view 轮询；会先停止已有轮询。 */
  readonly startPolling: (runId: string) => void;
  /** 停止当前轮询并清除定时器。 */
  readonly stopPolling: () => void;
};

/**
 * 创建 deep run view 轮询控制器。
 *
 * 控制器持有的 setApp / mountedRef / pollTimerRef 均为稳定引用，
 * 可在组件中用 `useMemo(..., [])` 创建一次。
 */
export function createDeepRunUpdateController(
  options: DeepRunUpdateControllerOptions,
): DeepRunUpdateController {
  let pollToken = 0;

  function stopPolling(): void {
    pollToken += 1;
    if (options.pollTimerRef.current !== undefined) {
      window.clearInterval(options.pollTimerRef.current);
      options.pollTimerRef.current = undefined;
    }
    if (options.streamRef.current !== undefined) {
      options.streamRef.current.close();
      options.streamRef.current = undefined;
    }
  }

  function startPolling(runId: string): void {
    stopPolling();
    const currentPollToken = pollToken;
    const path = `/api/deep/runs/${encodeURIComponent(runId)}/view`;
    let lastSequence = 0;
    let inFlight = false;
    let refreshQueued = false;

    async function tick(): Promise<void> {
      if (!options.mountedRef.current) {
        stopPolling();
        return;
      }
      if (currentPollToken !== pollToken) return;
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      inFlight = true;
      try {
        const response = await getJson<GetDeepRunViewResponse>(path);
        if (!options.mountedRef.current || currentPollToken !== pollToken) return;
        const view = response.view;
        const lastEvent = view.eventSequence.at(-1);
        if (lastEvent !== undefined) {
          lastSequence = Math.max(lastSequence, lastEvent.sequence);
        }
        const keepBusy = shouldKeepDeepRunBusy(view.run);
        const keepPolling = shouldPollDeepRun(view.run);
        const summary = deepRunSummaryFromView(view);
        const conversationSummary = view.conversation === undefined
          ? undefined
          : deepConversationSummaryFromView(view.conversation, summary);
        const intakeStatus = conversationSummary?.intakeStatus;
        options.setApp((previous) => ({
          ...previous,
          deep: view,
          deepConversation: view.conversation ?? previous.deepConversation,
          deepConversations: conversationSummary === undefined
            ? previous.deepConversations
            : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
          deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
          deepPendingGoal: undefined,
          deepActiveRunId: view.run.runId,
          deepSelectedRunId: view.run.runId,
          deepIntakeStatus: intakeStatus,
          deepBusy: keepBusy,
          error: undefined,
        }));
        if (!keepPolling) {
          stopPolling();
        }
      } catch (error) {
        if (!options.mountedRef.current || currentPollToken !== pollToken) return;
        // 404：run record 尚未写入（后台 run 刚启动竞态），静默重试。
        if (error instanceof ApiError && error.status === 404) return;
        // 其他错误：写入 error 但保持轮询（瞬态网络抖动不应终止观察）。
        options.setApp((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "刷新 Agent 集群运行状态失败。",
        }));
      } finally {
        inFlight = false;
        if (refreshQueued && options.mountedRef.current) {
          refreshQueued = false;
          void tick();
        }
      }
    }

    void tick();
    const stream = openDeepRunStream({
      runId,
      cursor: lastSequence,
      onEvent: (event) => {
        lastSequence = Math.max(lastSequence, event.sequence);
        void tick();
      },
      onError: () => {
        if (options.streamRef.current !== undefined) {
          options.streamRef.current.close();
          options.streamRef.current = undefined;
        }
      },
    });
    options.streamRef.current = stream;
    options.pollTimerRef.current = window.setInterval(
      () => void tick(),
      DEEP_POLL_INTERVAL_MS,
    );
  }

  return { startPolling, stopPolling };
}
