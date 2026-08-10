import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { MemoryPage } from "./MemoryPage";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    globalNote: {
      scope: { kind: "global" },
      content: "偏好简洁、保留真实错误信息。",
      version: "sha256:global-version",
      updatedAt: "2026-08-10T00:00:00.000Z",
    },
    owner: null,
    pathDependencies: [],
    ...overrides,
  };
}

test("在没有对话上下文时只显示全局记忆，不伪造 owner 或统计", async () => {
  fetchMock.mockResolvedValueOnce(json(snapshot({
    pathDependencies: [{
      id: "memory-global-1",
      owner: { kind: "global" },
      title: "先验证再扩展",
      excerpt: "先跑最小验证，再决定是否扩大改动。",
      revision: 2,
      sourceRunRefs: [],
    }],
  })));

  render(<MemoryPage />);

  expect(await screen.findByRole("heading", { name: "记忆" })).toBeTruthy();
  expect(screen.getByText("全局记忆")).toBeTruthy();
  expect(screen.queryByText("当前空间")).toBeNull();
  expect(screen.getByText("暂无来源记录")).toBeTruthy();
  expect(screen.queryByText(/读取 0/u)).toBeNull();
  expect(screen.queryByText(/采用 0/u)).toBeNull();
});

test("删除路径依赖后仍显示不可用的历史读取与采用事实", async () => {
  fetchMock.mockResolvedValueOnce(json(snapshot({
    history: [{
      id: "memory-deleted",
      kind: "path_dependency",
      owner: { kind: "global" },
      title: "已删除的方法",
      revision: 2,
      available: false,
      readCount: 3,
      useCount: 1,
      references: [],
    }],
  })));

  render(<MemoryPage />);

  expect(await screen.findByText("已删除的方法")).toBeTruthy();
  expect(screen.getByText("正文不可用")).toBeTruthy();
  expect(screen.getByText("读取 3")).toBeTruthy();
  expect(screen.getByText("采用 1")).toBeTruthy();
});

test("owner 选择器只使用后端登记范围，并把所选 owner 带入查询和写入", async () => {
  fetchMock
    .mockResolvedValueOnce(json(snapshot({
      owners: [
        { kind: "global" },
        { kind: "space", id: "space-1", title: "开发空间" },
        { kind: "workspace", id: "workspace-1", title: "AgentArbor" },
      ],
    })))
    .mockResolvedValueOnce(json(snapshot({
      owner: { kind: "space", id: "space-1", title: "开发空间" },
      ownerNote: {
        scope: { kind: "space", id: "space-1" },
        content: "开发空间约定",
        version: "sha256:owner-version",
      },
      owners: [
        { kind: "global" },
        { kind: "space", id: "space-1", title: "开发空间" },
        { kind: "workspace", id: "workspace-1", title: "AgentArbor" },
      ],
    })))
    .mockResolvedValueOnce(json({
      ok: true,
      notebook: {
        scope: { kind: "space", id: "space-1" },
        content: "更新后的开发约定",
        version: "sha256:owner-version-2",
      },
    }));

  render(<MemoryPage />);
  const selector = await screen.findByRole("combobox", { name: "记忆范围" });
  expect(within(selector).getByRole("option", { name: "空间 · 开发空间" })).toBeTruthy();
  expect(within(selector).getByRole("option", { name: "工作区 · AgentArbor" })).toBeTruthy();
  fireEvent.change(selector, { target: { value: "space:space-1" } });

  await waitFor(() => expect(screen.getByText("开发空间约定")).toBeTruthy());
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/memory?ownerKind=space&ownerId=space-1");

  const ownerNote = screen.getByText("开发空间约定").closest("article");
  expect(ownerNote).not.toBeNull();
  fireEvent.click(within(ownerNote!).getByRole("button", { name: "编辑笔记" }));
  fireEvent.change(within(ownerNote!).getByRole("textbox", { name: "开发空间正文" }), { target: { value: "更新后的开发约定" } });
  fireEvent.click(within(ownerNote!).getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(screen.getByText("更新后的开发约定")).toBeTruthy());
  expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
    body: JSON.stringify({
      ownerKind: "space",
      ownerId: "space-1",
      content: "更新后的开发约定",
      expectedVersion: "sha256:owner-version",
    }),
  }));
});

test("笔记保存携带版本，CAS 冲突会保留编辑并提示合并", async () => {
  fetchMock
    .mockResolvedValueOnce(json(snapshot()))
    .mockResolvedValueOnce(json({ code: "memory_note_revision_conflict", message: "冲突" }, 409));

  render(<MemoryPage />);
  await screen.findByRole("heading", { name: "记忆" });
  fireEvent.click(screen.getByRole("button", { name: "编辑笔记" }));
  fireEvent.change(screen.getByRole("textbox", { name: "全局记忆正文" }), { target: { value: "新正文" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("已被其他操作更新"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/memory/notes/global", expect.objectContaining({
    method: "PUT",
    body: JSON.stringify({ content: "新正文", expectedVersion: "sha256:global-version" }),
  }));
  expect(screen.getByDisplayValue("新正文")).toBeTruthy();
});

test("笔记删除经过明确确认并以当前版本直接删除正文", async () => {
  fetchMock
    .mockResolvedValueOnce(json(snapshot()))
    .mockResolvedValueOnce(json({
      ok: true,
      deleted: true,
      notebook: {
        scope: { kind: "global" },
        content: "",
        version: "sha256:empty-version",
      },
    }));

  render(<MemoryPage />);
  await screen.findByRole("heading", { name: "记忆" });
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(screen.getByRole("button", { name: "确认永久删除" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));

  await waitFor(() => expect(screen.getByText("尚未记录")).toBeTruthy());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/memory/notes/global", expect.objectContaining({
    method: "DELETE",
    body: JSON.stringify({ expectedVersion: "sha256:global-version" }),
  }));
});

test("路径依赖详情允许修订并在冲突时保留草稿，删除先展示不可逆警告", async () => {
  const dependency = {
    id: "memory-1",
    owner: { kind: "global" },
    title: "类型检查顺序",
    methodology: "先跑类型检查，再跑窄范围测试。",
    excerpt: "先跑类型检查，再跑窄范围测试。",
    revision: 3,
    verification: { status: "observed", evidenceRefs: ["run-1"] },
    sourceRunRefs: [{ runId: "run-1", title: "修复构建" }],
    tags: ["typescript"],
    readCount: 2,
    useCount: 1,
  };
  fetchMock
    .mockResolvedValueOnce(json(snapshot({ pathDependencies: [dependency] })))
    .mockResolvedValueOnce(json({ ok: true, dependency }))
    .mockResolvedValueOnce(json({ code: "path_dependency_revision_conflict", message: "冲突" }, 409));

  render(<MemoryPage />);
  await screen.findByRole("button", { name: /类型检查顺序/u });
  fireEvent.click(screen.getByRole("button", { name: /类型检查顺序/u }));
  await screen.findByRole("dialog");
  expect(screen.getByText("来源 Run")).toBeTruthy();
  expect(screen.getAllByText("修订 3").length).toBeGreaterThan(0);
  expect(screen.getByText("读取 2")).toBeTruthy();

  fireEvent.change(screen.getByRole("textbox", { name: "方法论" }), { target: { value: "改过的方法论" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("已被其他操作更新"));
  expect(screen.getByDisplayValue("改过的方法论")).toBeTruthy();

  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
  expect(screen.getByText(/删除后不可撤销/u)).toBeTruthy();
  expect(screen.getByRole("button", { name: "确认永久删除" })).toBeTruthy();
});
