import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type {
  PathMemoryDiagnosticsResponse,
  PathMemoryListResponse,
  PathMemoryRecord,
} from "../contracts/path-memory";
import { PathMemorySettings } from "./path-memory-settings";

test("列表渲染记录与终态 badge", async () => {
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([
      memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "completed" }),
      memoryRecord({ id: "path-memory:ordinary:run-2", userRequest: "重构支付模块", terminalStatus: "failed" }),
      memoryRecord({ id: "path-memory:ordinary:run-3", userRequest: "清理无用依赖", terminalStatus: "cancelled" }),
      memoryRecord({ id: "path-memory:ordinary:run-4", userRequest: "升级构建工具", terminalStatus: "blocked" }),
    ])),
    diagnostics: () => jsonResponse(diagnosticsResponse()),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  const list = await screen.findByRole("list", { name: "路径记忆记录" });
  expect(within(list).getByText("修复登录页崩溃")).toBeTruthy();
  expect(within(list).getByText("已完成")).toBeTruthy();
  expect(within(list).getByText("失败")).toBeTruthy();
  expect(within(list).getByText("已取消")).toBeTruthy();
  expect(within(list).getByText("受阻")).toBeTruthy();
  expect(within(list).getAllByText("2 步").length).toBe(4);
  const completedBadge = within(list).getByText("已完成");
  expect(completedBadge.className).toContain("success");
  const failedBadge = within(list).getByText("失败");
  expect(failedBadge.className).toContain("danger");
});

test("终态过滤触发带 terminalStatus 参数的请求", async () => {
  const user = userEvent.setup();
  const recordUrls: string[] = [];
  const fetchMock = routeFetch({
    records: (url) => {
      recordUrls.push(url);
      return jsonResponse(listResponse([
        memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "failed" }),
      ]));
    },
    diagnostics: () => jsonResponse(diagnosticsResponse()),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  await screen.findByRole("list", { name: "路径记忆记录" });
  expect(recordUrls[0]).not.toContain("terminalStatus");

  await user.selectOptions(screen.getByRole("combobox", { name: "按终态筛选" }), "failed");

  await waitFor(() => expect(recordUrls.length).toBe(2));
  expect(recordUrls[1]).toContain("terminalStatus=failed");
});

test("删除流程：二次确认后发送 DELETE 并刷新列表", async () => {
  const user = userEvent.setup();
  let deleted = false;
  const deleteUrls: string[] = [];
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse(deleted ? [] : [
      memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "completed" }),
    ])),
    diagnostics: () => jsonResponse(diagnosticsResponse()),
    delete: (url) => {
      deleted = true;
      deleteUrls.push(url);
      return jsonResponse({ ok: true });
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  await screen.findByText("修复登录页崩溃");
  await user.click(screen.getByRole("button", { name: /^删除路径记忆：/u }));

  expect(screen.getByRole("button", { name: "确认删除" })).toBeTruthy();
  expect(deleteUrls.length).toBe(0);

  await user.click(screen.getByRole("button", { name: "确认删除" }));

  await screen.findByText("尚无路径记忆记录。完成一次任务后会自动采集。");
  expect(deleteUrls).toEqual(["/api/path-memory/records/path-memory%3Aordinary%3Arun-1"]);
});

test("删除可以取消，不发送请求", async () => {
  const user = userEvent.setup();
  const deleteUrls: string[] = [];
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([
      memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "completed" }),
    ])),
    diagnostics: () => jsonResponse(diagnosticsResponse()),
    delete: (url) => {
      deleteUrls.push(url);
      return jsonResponse({ ok: true });
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  await screen.findByText("修复登录页崩溃");
  await user.click(screen.getByRole("button", { name: /^删除路径记忆：/u }));
  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
  expect(deleteUrls.length).toBe(0);
});

test("空态提示", async () => {
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([])),
    diagnostics: () => jsonResponse(diagnosticsResponse()),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  expect(await screen.findByText("尚无路径记忆记录。完成一次任务后会自动采集。")).toBeTruthy();
});

test("diagnostics 面板渲染统计与最近失败警示", async () => {
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([])),
    diagnostics: () => jsonResponse(diagnosticsResponse({
      lastFailure: {
        source: "realtime",
        runId: "run-9",
        message: "写入失败",
        occurredAt: "2026-07-20T08:00:00.000Z",
      },
    })),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  const panel = await screen.findByLabelText("采集健康状况");
  expect(within(panel).getByText("记录总数")).toBeTruthy();
  expect(within(panel).getByText("42")).toBeTruthy();
  expect(within(panel).getByText("实时采集")).toBeTruthy();
  expect(within(panel).getByText("已完成")).toBeTruthy();
  expect(within(panel).getByRole("alert").textContent).toContain("写入失败");
});

test("diagnostics 端点失败时降级显示且列表不受影响", async () => {
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([
      memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "completed" }),
    ])),
    diagnostics: () => jsonResponse({ ok: false, code: "not_found" }, 404),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  expect(await screen.findByText("诊断暂不可用")).toBeTruthy();
  expect(await screen.findByText("修复登录页崩溃")).toBeTruthy();
});

test("展开详情显示工具步骤与结果", async () => {
  const user = userEvent.setup();
  const fetchMock = routeFetch({
    records: () => jsonResponse(listResponse([
      memoryRecord({ id: "path-memory:ordinary:run-1", userRequest: "修复登录页崩溃", terminalStatus: "failed" }),
    ])),
    diagnostics: () => jsonResponse(diagnosticsResponse()),
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPathMemorySettings();

  await screen.findByText("修复登录页崩溃");
  await user.click(screen.getByRole("button", { name: /^查看路径记忆详情：/u }));

  const detail = screen.getByLabelText("路径记忆详情");
  expect(within(detail).getByText("read_file")).toBeTruthy();
  expect(within(detail).getByText("edit_file")).toBeTruthy();
  expect(within(detail).getByText("edit rejected")).toBeTruthy();
  expect(within(detail).getByText("错误代码")).toBeTruthy();
  expect(within(detail).getByText("run failed")).toBeTruthy();
  expect(within(detail).getByText("evidence:ref-1")).toBeTruthy();
});

function renderPathMemorySettings(): ReturnType<typeof render> {
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
      <PathMemorySettings />
    </QueryClientProvider>,
  );
}

function routeFetch(handlers: {
  readonly records: (url: string) => Response;
  readonly diagnostics: (url: string) => Response;
  readonly delete?: (url: string) => Response;
}): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      return Promise.resolve(handlers.delete?.(url) ?? jsonResponse({ ok: false }, 500));
    }
    if (url.includes("/api/path-memory/diagnostics")) {
      return Promise.resolve(handlers.diagnostics(url));
    }
    return Promise.resolve(handlers.records(url));
  });
}

function listResponse(memories: readonly PathMemoryRecord[]): PathMemoryListResponse {
  return { ok: true, memories };
}

function diagnosticsResponse(overrides?: Partial<PathMemoryDiagnosticsResponse["diagnostics"]>): PathMemoryDiagnosticsResponse {
  return {
    ok: true,
    diagnostics: {
      realtime: { captured: 5, existing: 1, replaced: 0, skippedUnstable: 0, skippedDeleted: 0, failures: 2 },
      reconciliation: {
        status: "completed",
        scannedTerminalRuns: 10,
        captured: 3,
        existing: 7,
        replaced: 0,
        skippedUnstable: 0,
        skippedDeleted: 0,
        failures: 0,
        durationMs: 120,
      },
      records: { total: 42 },
      ...overrides,
    },
  };
}

function memoryRecord(input: {
  readonly id: string;
  readonly userRequest: string;
  readonly terminalStatus: "completed" | "failed" | "cancelled" | "blocked";
}): PathMemoryRecord {
  return {
    id: input.id,
    source: {
      feature: "ordinary",
      runId: input.id.split(":").at(-1) ?? "run-x",
      sourceRevision: 1,
      conversationId: "conversation-abcdef123456",
      userTurnId: "turn-user-1",
      assistantTurnId: "turn-assistant-1",
      runCreatedAt: "2026-07-20T07:58:00.000Z",
      terminalAt: "2026-07-20T08:00:00.000Z",
    },
    scope: {
      workspaceRoot: "Z:/AgentArbor",
      workspaceSelection: "default",
    },
    goal: {
      userRequest: input.userRequest,
      taskContextRefs: [],
    },
    path: {
      executionStarted: true,
      toolSteps: [
        {
          ordinal: 1,
          toolFactId: `${input.id}:step-1`,
          toolName: "read_file",
          status: "completed",
          durationMs: 320,
          resultRef: "tool-result:step-1",
        },
        {
          ordinal: 2,
          toolFactId: `${input.id}:step-2`,
          toolName: "edit_file",
          status: "failed",
          durationMs: 1_500,
          resultRef: "tool-result:step-2",
          error: { message: "edit rejected" },
        },
      ],
    },
    outcome: outcomeFor(input.terminalStatus),
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: ["evidence:ref-1"],
    capturedAt: "2026-07-20T08:00:01.000Z",
  };
}

function outcomeFor(status: "completed" | "failed" | "cancelled" | "blocked"): PathMemoryRecord["outcome"] {
  switch (status) {
    case "completed":
      return { terminalStatus: "completed", answerRef: "answer:ref-1" };
    case "failed":
      return { terminalStatus: "failed", error: { code: "run_failed", message: "run failed" } };
    case "cancelled":
      return { terminalStatus: "cancelled", reason: "user cancelled" };
    case "blocked":
      return { terminalStatus: "blocked", reason: { code: "confirmation_required", message: "awaiting confirmation" }, continueBy: "new_turn" };
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
