import type React from "react";
import { ApiError, getJson } from "./api";
import type { AppState } from "./app-state";
import type { DeepRunStatus, GetDeepRunViewResponse } from "./contracts/deep";

/**
 * Deep 运行投影轮询模块（T3-4e）。
 *
 * deep run 在后台执行（202 不阻塞），前端通过轮询 `GET /api/deep/runs/:runId/view`
 * 获取完整安全投影（[`DeepRunView`](./contracts/deep.ts)：run + agentRunTree 计数 +
 * report 全树 + eventSequence 事件序列）。
 *
 * 与普通 Agent 的 [`app-live-run-updates`](./app-live-run-updates.ts) 区别：
 *   - 普通 Agent 用 SSE 流式 + 轮询混合（transcript 增量流 + 状态轮询）；
 *   - deep run 的 view 已包含完整 tree + report + 事件序列快照，轮询即可获取全量投影，
 *     无需 SSE 增量重建。SSE 仅提供事件时间线的边际实时性，view 轮询已覆盖（design §6.2）。
 *
 * 轮询策略：
 *   - 提交成功后立即首轮拉取，随后每 1.5s 轮询；
 *   - run 到达终态（completed/failed/interrupted/stopped/corrected）时停止轮询并 deepBusy=false；
 *   - 404（record 尚未写入）：静默重试，不报错（后台 run 刚启动的竞态）；
 *   - 其他错误：写入 app.error 但保持轮询（瞬态网络抖动不应终止观察）；
 *   - 超时保护：超过 5 分钟强制停止（防止后台 run 挂死导致无限轮询）。
 */

const DEEP_POLL_INTERVAL_MS = 1_500;
const DEEP_POLL_TIMEOUT_MS = 5 * 60 * 1_000;

const TERMINAL_DEEP_RUN_STATUSES: readonly DeepRunStatus[] = [
  "completed",
  "failed",
  "interrupted",
  "stopped",
  "corrected",
];

export type DeepRunUpdateControllerOptions = {
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimerRef: React.MutableRefObject<number | undefined>;
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
  function stopPolling(): void {
    if (options.pollTimerRef.current !== undefined) {
      window.clearInterval(options.pollTimerRef.current);
      options.pollTimerRef.current = undefined;
    }
  }

  function startPolling(runId: string): void {
    stopPolling();
    const path = `/api/deep/runs/${encodeURIComponent(runId)}/view`;
    const startedAt = Date.now();

    async function tick(): Promise<void> {
      if (!options.mountedRef.current) {
        stopPolling();
        return;
      }
      if (Date.now() - startedAt > DEEP_POLL_TIMEOUT_MS) {
        stopPolling();
        options.setApp((previous) => ({
          ...previous,
          deepBusy: false,
          error: "deep 运行超时，已停止刷新。请检查后台运行状态。",
        }));
        return;
      }

      try {
        const response = await getJson<GetDeepRunViewResponse>(path);
        if (!options.mountedRef.current) return;
        const view = response.view;
        const isTerminal = TERMINAL_DEEP_RUN_STATUSES.includes(view.run.status);
        options.setApp((previous) => ({
          ...previous,
          deep: view,
          deepBusy: !isTerminal,
          error: undefined,
        }));
        if (isTerminal) {
          stopPolling();
        }
      } catch (error) {
        if (!options.mountedRef.current) return;
        // 404：run record 尚未写入（后台 run 刚启动竞态），静默重试。
        if (error instanceof ApiError && error.status === 404) return;
        // 其他错误：写入 error 但保持轮询（瞬态网络抖动不应终止观察）。
        options.setApp((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "刷新 deep 运行状态失败。",
        }));
      }
    }

    void tick();
    options.pollTimerRef.current = window.setInterval(
      () => void tick(),
      DEEP_POLL_INTERVAL_MS,
    );
  }

  return { startPolling, stopPolling };
}
