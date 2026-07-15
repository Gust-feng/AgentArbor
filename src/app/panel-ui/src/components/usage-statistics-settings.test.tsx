import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { UsageStatisticsResponse } from "../contracts/statistics";
import { UsageStatisticsSettings } from "./usage-statistics-settings";

test("usage statistics load once and refresh only when requested", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(12)))
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(24)));
  vi.stubGlobal("fetch", fetchMock);
  renderUsageStatistics();

  expect(await screen.findByText("12")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchSignal(fetchMock, 0)).toBeInstanceOf(AbortSignal);

  await user.click(screen.getByRole("button", { name: "刷新使用统计" }));

  expect(await screen.findByText("24")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("usage statistics do not retry automatically and can recover on explicit retry", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ message: "统计暂不可用" }, 503))
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(7)));
  vi.stubGlobal("fetch", fetchMock);
  renderUsageStatistics();

  expect(await screen.findByText("统计暂不可用")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "重试" }));

  expect(await screen.findByText("7")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a failed refresh keeps the last successful statistics visible", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(12)))
    .mockResolvedValueOnce(jsonResponse({ message: "刷新失败" }, 503));
  vi.stubGlobal("fetch", fetchMock);
  renderUsageStatistics();
  expect(await screen.findByText("12")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "刷新使用统计" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  expect(screen.getByText("12")).toBeTruthy();
  expect(screen.queryByText("刷新失败")).toBeNull();
});

test("unmounting usage statistics aborts its unfinished request", async () => {
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
    });
  }));
  const view = renderUsageStatistics();
  await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

  view.unmount();

  expect(requestSignal?.aborted).toBe(true);
});

function renderUsageStatistics(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsageStatisticsSettings />
    </QueryClientProvider>,
  );
}

function statisticsResponse(conversationCount: number): UsageStatisticsResponse {
  return {
    ok: true,
    status: "completed",
    statistics: {
      generatedAt: "2026-07-15T00:00:00.000Z",
      storageAvailable: true,
      scope: "all_local",
      heatmapWindowDays: 182,
      totals: {
        conversationCount,
        messageCount: 3,
        runCount: 2,
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        cacheSavedTokens: 250,
      },
      dailyActivity: [],
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchSignal(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): AbortSignal | undefined {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return init?.signal ?? undefined;
}
