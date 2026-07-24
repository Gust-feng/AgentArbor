import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { UsageStatisticsResponse } from "../contracts/statistics";
import { DeveloperToolStatistics, UsageStatisticsSettings } from "./usage-statistics-settings";

test("usage statistics load once and refresh only when requested", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(12)))
    .mockResolvedValueOnce(jsonResponse(statisticsResponse(24)));
  vi.stubGlobal("fetch", fetchMock);
  renderUsageStatistics();

  expect(await screen.findByText("12")).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "工具详情" })).toBeNull();
  expect(screen.getAllByText("25%").length).toBe(1);
  expect(screen.getAllByText("800 ms").length).toBe(1);
  expect(screen.getAllByText("480 ms").length).toBe(1);
  expect(screen.getByText("TTFT")).toBeTruthy();
  expect(screen.getByRole("button", { name: "TTFT 说明" })).toBeTruthy();

  await user.click(screen.getByRole("tab", { name: "模型详情" }));
  expect(screen.getByText("DeepSeek")).toBeTruthy();
  expect(screen.getByText("deepseek-v4")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "模型详情" })).toBeNull();
  expect(screen.queryByText("模型调用")).toBeNull();
  expect(screen.queryByText("总命中率")).toBeNull();
  expect(screen.getByRole("article", { name: "deepseek-v4 模型用量" })).toBeTruthy();
  expect(screen.getByLabelText("Token 构成")).toBeTruthy();
  expect(screen.getAllByText("25%").length).toBe(1);
  expect(screen.getAllByText("640 ms").length).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchSignal(fetchMock, 0)).toBeInstanceOf(AbortSignal);

  await user.click(screen.getByRole("tab", { name: "概览" }));
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

test("heatmap details only appear for days with activity", async () => {
  const user = userEvent.setup();
  const response = statisticsResponse(12);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
    ...response,
    statistics: {
      ...response.statistics,
      dailyActivity: [
        dailyActivity("2026-07-17", 0, 0),
        dailyActivity("2026-07-18", 3, 1),
      ],
    },
  })));
  renderUsageStatistics();

  await screen.findByText("12");
  const tokenMode = screen.getByRole("radio", { name: "Token" });
  expect(tokenMode.getAttribute("aria-checked")).toBe("false");
  await user.click(tokenMode);
  expect(tokenMode.getAttribute("aria-checked")).toBe("true");

  await user.hover(screen.getByLabelText("2026-07-17，0 条消息"));
  expect(screen.queryByRole("status")).toBeNull();

  await user.hover(screen.getByLabelText("2026-07-18，3 条消息"));
  expect(screen.getByRole("status").textContent).toContain("消息 3 · 运行 1");
});

test("developer tool statistics render only aggregate metrics and provide an empty state", async () => {
  const populated = statisticsResponse(12);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
    ...populated,
    statistics: {
      ...populated.statistics,
      metricsDroppedCount: 2,
      toolBreakdown: [toolBreakdown("read")],
    },
  })));
  const populatedView = renderDeveloperToolStatistics();

  await screen.findByText("工具详情");
  expect(screen.getByText("read")).toBeTruthy();
  expect(screen.getByText("5.9K tok")).toBeTruthy();
  expect(screen.getByText("2", { selector: ".usage-v3-details-total strong" })).toBeTruthy();
  expect(screen.queryByText(/README\.md/u)).toBeNull();
  populatedView.unmount();

  const empty = statisticsResponse(0);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(empty)));
  renderDeveloperToolStatistics();
  await screen.findByText("工具详情");
  expect(screen.getByText("暂无工具执行统计")).toBeTruthy();
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

function renderDeveloperToolStatistics(): ReturnType<typeof render> {
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
      <DeveloperToolStatistics />
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
        requestCount: 2,
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        cacheSavedTokens: 250,
        cacheHitRate: 0.25,
        firstTokenLatency: {
          p50: 480,
          p75: 640,
          p95: 800,
          p99: 960,
        },
      },
      modelBreakdown: [{
        providerId: "deepseek",
        providerLabel: "DeepSeek",
        model: "deepseek-v4",
        requestCount: 2,
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        cacheSavedTokens: 250,
        cacheHitRate: 0.25,
        averageFirstTokenLatencyMs: 640,
      }],
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

function dailyActivity(date: string, messageCount: number, runCount: number): UsageStatisticsResponse["statistics"]["dailyActivity"][number] {
  return {
    date,
    messageCount,
    conversationCount: messageCount > 0 ? 1 : 0,
    runCount,
    inputTokens: messageCount * 100,
    outputTokens: messageCount * 50,
    cacheSavedTokens: 0,
    level: messageCount > 0 ? 3 : 0,
  };
}

function toolBreakdown(toolName: string): NonNullable<UsageStatisticsResponse["statistics"]["toolBreakdown"]>[number] {
  return {
    toolName,
    operationType: "read-only",
    calls: 4,
    errorRate: 0.25,
    retainedRate: 0.5,
    continuationRate: 0.5,
    rawBodyTokens: { p50: 1_024, p95: 8_192, p99: 8_192 },
    rawEnvelopeTokens: { p50: 2_048, p95: 8_192, p99: 8_192 },
    finalEnvelopeTokens: { p50: 4_096, p95: 5_900, p99: 6_000 },
    continuationPages: { p50: 2, p95: 4, p99: 4 },
    queueWaitMs: { p50: 1, p95: 25, p99: 25 },
    outputChars: 42_000,
    outputBytes: 42_000,
    maxActive: 3,
    retentionReasons: { envelope_limit: 2 },
  };
}

function fetchSignal(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): AbortSignal | undefined {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return init?.signal ?? undefined;
}
