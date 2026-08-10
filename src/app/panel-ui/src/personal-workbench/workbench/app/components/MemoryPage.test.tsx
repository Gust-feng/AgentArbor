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

test("空范围只显示一个统一入口，不把记忆写入责任推给用户", async () => {
  fetchMock.mockResolvedValueOnce(json(snapshot({ globalNote: { scope: { kind: "global" }, content: "", version: "sha256:empty" } })));

  render(<MemoryPage />);

  expect(await screen.findByText("当前范围暂无记忆")).toBeTruthy();
  expect(screen.queryByText("声明性记忆")).toBeNull();
  expect(screen.queryByText("程序性记忆")).toBeNull();
  expect(screen.queryByRole("button", { name: /开始记录|新建路径依赖/u })).toBeNull();
});

test("有内容时首屏只展示正文、摘要和需要判断的状态", async () => {
  fetchMock.mockResolvedValueOnce(json(snapshot({
    pathDependencies: [{
      id: "memory-global-1",
      owner: { kind: "global" },
      title: "先验证再扩展",
      excerpt: "先跑最小验证，再决定是否扩大改动。",
      revision: 2,
      verification: { status: "observed" },
      sourceRunRefs: [{ runId: "run-1", title: "修复构建" }],
      evidenceRefs: ["run-1"],
      readCount: 2,
      useCount: 1,
    }],
  })));

  render(<MemoryPage />);

  expect(await screen.findByRole("button", { name: /先验证再扩展/u })).toBeTruthy();
  expect(screen.getByText("偏好简洁、保留真实错误信息。")).toBeTruthy();
  expect(screen.getByText("先验证再扩展")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
  expect(screen.queryByRole("button", { name: "新建路径依赖" })).toBeNull();
  expect(screen.queryByText("读取 2")).toBeNull();
});

test("owner 选择器只使用后端登记范围，并把所选 owner 带入查询", async () => {
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
    })));

  render(<MemoryPage />);
  const selector = await screen.findByRole("combobox", { name: "记忆范围" });
  expect(within(selector).getByRole("option", { name: "空间 · 开发空间" })).toBeTruthy();
  expect(within(selector).getByRole("option", { name: "工作区 · AgentArbor" })).toBeTruthy();
  fireEvent.change(selector, { target: { value: "space:space-1" } });

  await waitFor(() => expect(screen.getByText("开发空间约定")).toBeTruthy());
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/memory?ownerKind=space&ownerId=space-1");
  expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
});

test("笔记只能在面板删除，并携带当前版本", async () => {
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
  await screen.findByText("偏好简洁、保留真实错误信息。");
  const note = screen.getByText("偏好简洁、保留真实错误信息。").closest("article");
  expect(note).not.toBeNull();
  fireEvent.click(within(note!).getByRole("button", { name: "删除" }));
  expect(within(note!).getByRole("button", { name: "确认删除" })).toBeTruthy();
  fireEvent.click(within(note!).getByRole("button", { name: "确认删除" }));

  await waitFor(() => expect(screen.getByText("当前范围暂无记忆")).toBeTruthy());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/memory/notes/global", expect.objectContaining({
    method: "DELETE",
    body: JSON.stringify({ expectedVersion: "sha256:global-version" }),
  }));
});

test("路径依赖详情是阅读视图，来源、证据和使用事实进入详情，删除直接移除正文", async () => {
  const dependency = {
    id: "memory-1",
    owner: { kind: "global" },
    title: "类型检查顺序",
    methodology: "先跑类型检查，再跑窄范围测试。",
    excerpt: "先跑类型检查，再跑窄范围测试。",
    revision: 3,
    verification: { status: "observed" },
    evidenceRefs: ["run-1"],
    sourceRunRefs: [{ runId: "run-1", title: "修复构建" }],
    sourceRunCount: 1,
    evidenceCount: 1,
    readCount: 2,
    useCount: 1,
    tags: ["typescript"],
  };
  fetchMock
    .mockResolvedValueOnce(json(snapshot({ pathDependencies: [dependency] })))
    .mockResolvedValueOnce(json({ ok: true, dependency }))
    .mockResolvedValueOnce(json({ ok: true }));

  render(<MemoryPage />);
  fireEvent.click(await screen.findByRole("button", { name: /类型检查顺序/u }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("先跑类型检查，再跑窄范围测试。")).toBeTruthy();
  expect(within(dialog).getByText("来源 Run")).toBeTruthy();
  expect(within(dialog).getByText("读取").nextElementSibling?.textContent).toBe("2");
  expect(within(dialog).queryByRole("textbox")).toBeNull();

  fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
  expect(within(dialog).getByText(/删除后不可恢复/u)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/memory/path-dependencies/memory-1", expect.objectContaining({
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: 3 }),
  }));
});

test("详情请求返回较晚时不能覆盖用户刚打开的另一条记忆", async () => {
  const first = { id: "memory-first", owner: { kind: "global" }, title: "第一条", excerpt: "第一条方法", revision: 1 };
  const second = { id: "memory-second", owner: { kind: "global" }, title: "第二条", excerpt: "第二条方法", revision: 1 };
  let resolveFirst: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  fetchMock
    .mockResolvedValueOnce(json(snapshot({ pathDependencies: [first, second] })))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve; }));

  render(<MemoryPage />);
  fireEvent.click(await screen.findByRole("button", { name: /第一条/u }));
  fireEvent.click(screen.getByRole("button", { name: /第二条/u }));
  resolveFirst?.(json({ ok: true, dependency: { ...first, methodology: "第一条完整正文" } }));
  resolveSecond?.(json({ ok: true, dependency: { ...second, methodology: "第二条完整正文" } }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "第二条" })).toBeTruthy());
  expect(screen.queryByText("第一条完整正文")).toBeNull();
});
