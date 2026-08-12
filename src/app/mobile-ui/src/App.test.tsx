import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { App } from "./App";
import { dispatchMobileBackButton } from "./mobile-back-navigation";
import type { MobileRemoteState, RemoteMobileClient } from "./remote-client";

afterEach(() => {
  cleanup();
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.removeAttribute("data-theme");
  localStorage.removeItem("agentarbor:mobile-selected-space");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function openQuickMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "打开快捷菜单" }));
  return screen.getByRole("menu", { name: "快捷操作" });
}

function openSpace(title: string): void {
  fireEvent.click(screen.getByRole("button", { name: title }));
}

function openDeferredKnowledgeSurface(): void {
  // There is no knowledge entry point in the current conversation-only shell.
}

function openProfile(): void {
  const menu = openQuickMenu();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "设置" }));
}

/**
 * Content surfaces are intentionally deferred for the current mobile release.
 * Keep this seam in the future-content specs below so those workflows remain
 * executable documentation when the surface is brought back.
 */
function openDeferredContentSurface(): void {
  // There is no content entry point in the current conversation-only shell.
}

function deferredContentTest(name: string, callback: () => void | Promise<void>): void {
  test.skip(`[deferred content UI] ${name}`, callback);
}

function startNewConversation(): void {
  openSpace("产品空间");
}

describe("formal mobile workbench", () => {
  test("transitions from pairing to the workbench without changing Hook order", async () => {
    let current = {
      ...state(),
      connection: "unpaired",
      binding: undefined,
    } as MobileRemoteState;
    const listeners = new Set<() => void>();
    render(<App client={client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    })} />);
    expect(screen.getByRole("heading", { name: "连接电脑" })).toBeTruthy();

    current = state();
    await act(async () => listeners.forEach((listener) => listener()));
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "产品空间" })).toBeTruthy();
  });

  test("keeps the home layer focused on spaces before starting a conversation", () => {
    render(<App client={client(state())} />);

    expect(screen.getByRole("button", { name: "打开快捷菜单" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    const spaceRow = screen.getByRole("button", { name: "产品空间" });
    expect(screen.queryByRole("textbox", { name: "输入消息" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建空间" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "主要导航" })).toBeNull();
    expect(screen.queryByText("AgentArbor")).toBeNull();
    expect(screen.queryByText("工作台")).toBeNull();
    expect(screen.queryByRole("heading", { name: "空间" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "你的空间" })).toBeNull();
    expect(screen.queryByText("选择一个空间，开始或继续你的会话。")).toBeNull();
    expect(screen.queryByText(/移动端结构调整/u)).toBeNull();
    expect(screen.getByRole("banner", { name: "工作台" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认" })).toBeNull();
    const topbar = screen.getByRole("button", { name: "打开快捷菜单" }).closest("header");
    expect(topbar).not.toBeNull();
    expect(within(topbar!).getAllByRole("button")).toHaveLength(1);
    expect(within(topbar!).getByRole("status", { name: "已连接" }).textContent).toBe("已连接");

    const quickMenuTrigger = screen.getByRole("button", { name: "打开快捷菜单" });
    expect(quickMenuTrigger.getAttribute("aria-expanded")).toBe("false");
    const quickMenu = openQuickMenu();
    expect(quickMenuTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(quickMenu).getAllByRole("menuitem")).toHaveLength(2);
    expect(within(quickMenu).getByRole("menuitem", { name: "新建空间" })).toBeTruthy();
    expect(within(quickMenu).getByRole("menuitem", { name: "设置" })).toBeTruthy();
    expect(within(quickMenu).queryByRole("menuitem", { name: "产品空间" })).toBeNull();
    expect(screen.queryByText("移动端结构调整")).toBeNull();
    expect(within(quickMenu).queryByRole("menuitem", { name: "知识库" })).toBeNull();
    expect(spaceRow).toBeTruthy();
  });

  test("keeps the current connection state visible in the top bar", () => {
    const cases = [
      { connection: "connected", peerOnline: true, label: "已连接" },
      { connection: "connecting", peerOnline: false, label: "连接中" },
      { connection: "connected", peerOnline: false, label: "电脑离线" },
      { connection: "offline", peerOnline: false, label: "服务离线" },
    ] as const;

    for (const item of cases) {
      const view = render(<App client={client({ ...state(), connection: item.connection, peerOnline: item.peerOnline })} />);
      const status = screen.getByRole("status", { name: item.label });
      expect(status.textContent).toBe(item.label);
      view.unmount();
    }
  });

  test("keeps a new-conversation draft scoped to its Space", () => {
    const current = state();
    render(<App client={client({
      ...current,
      vaultResources: [
        ...current.vaultResources,
        resource("space", "space-2", {
          title: "灵感收集",
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:00.000Z",
        }),
      ],
    } as MobileRemoteState)} />);

    openSpace("产品空间");
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "产品空间草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    openSpace("灵感收集");
    expect((screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "灵感收集草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    openSpace("产品空间");
    expect((screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement).value).toBe("产品空间草稿");
  });

  test("keeps the Space detail focused on conversations while content UI is deferred", () => {
    const current = state();
    const note = current.vaultResources.find((resource) => resource.kind === "personal_note")!;
    const deferredContent = {
      ...current,
      vaultResources: [
        ...current.vaultResources,
        resource("managed_root", "root-deferred", { spaceId: "space-1", title: "软件文件" }),
        resource("managed_file", "file-deferred", { managedRootId: "root-deferred", relativePath: "docs/plan.md", text: "计划" }),
      ],
      vaultConflicts: [{
        mutationId: "deferred-content-conflict",
        mutation: {
          protocolVersion: "content-vault/v1" as const,
          mutationId: "deferred-content-conflict",
          kind: "personal_note" as const,
          resourceId: note.resourceId,
          baseRevision: 1,
          operation: "upsert" as const,
          payloadSchemaVersion: 1 as const,
          payload: { ...note.payload, bodyMarkdown: "手机版本" },
          contentHash: `sha256:${"c".repeat(64)}`,
        },
        reason: "revision_mismatch" as const,
        current: note,
        detectedAt: "2026-08-04T08:15:00.000Z",
      }],
    } as MobileRemoteState;
    render(<App client={client(deferredContent)} />);

    openSpace("产品空间");

    expect(screen.getByRole("heading", { name: "对话" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "输入消息" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /移动端结构调整/u })).toBeTruthy();
    expect(screen.queryByText("移动端方向")).toBeNull();
    expect(screen.queryByText("软件文件")).toBeNull();
    expect(screen.queryByText("plan.md")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建笔记" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建资料" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在此空间写下第一篇笔记" })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加第一份资料" })).toBeNull();
    expect(screen.queryByRole("button", { name: /同步冲突/u })).toBeNull();
  });

  test("closes the quick menu before changing the current route", () => {
    render(<App client={client(state())} />);

    const trigger = screen.getByRole("button", { name: "打开快捷菜单" });
    const menu = openQuickMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "快捷操作" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();

    openQuickMenu();
    act(() => expect(dispatchMobileBackButton()).toBe(true));
    expect(screen.queryByRole("menu", { name: "快捷操作" })).toBeNull();
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
  });

  test("replaces the quick menu with the new-space dialog instead of stacking layers", () => {
    render(<App client={client(state())} />);

    const quickMenu = openQuickMenu();
    const routeSurface = document.querySelector<HTMLElement>(".aa-mobile-route-surface");
    expect(routeSurface).not.toBeNull();
    expect(routeSurface!.getAttribute("aria-hidden")).toBeNull();
    expect(routeSurface!.hasAttribute("inert")).toBe(false);
    fireEvent.click(within(quickMenu).getByRole("menuitem", { name: "新建空间" }));

    expect(screen.queryByRole("menu", { name: "快捷操作" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "新建空间" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "新建空间" }).getAttribute("aria-modal")).toBe("true");
    expect(routeSurface!.getAttribute("aria-hidden")).toBe("true");
    expect(routeSurface!.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "新建空间" })).toBeNull();
    expect(routeSurface!.getAttribute("aria-hidden")).toBeNull();
    expect(routeSurface!.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "产品空间" })).toBeTruthy();
  });

  test("keeps a busy dialog mounted when Android back is pressed", async () => {
    let release: (() => void) | undefined;
    const submitVaultMutation = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("space-mutation");
    }));
    render(<App client={client(state(), { submitVaultMutation })} />);
    fireEvent.click(within(openQuickMenu()).getByRole("menuitem", { name: "新建空间" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "新空间" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    act(() => expect(dispatchMobileBackButton()).toBe(true));
    expect(screen.getByRole("dialog", { name: "新建空间" })).toBeTruthy();

    await act(async () => release?.());
    expect(screen.queryByRole("dialog", { name: "新建空间" })).toBeNull();
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
  });

  test("does not surface a conversation without an owning Space", () => {
    const current = state();
    render(<App client={client({
      ...current,
      conversations: [...current.conversations, {
        conversationId: "legacy-unowned",
        title: "历史遗留对话",
        updatedAt: "2026-08-04T00:00:01.000Z",
        status: "completed",
      }],
    })} />);

    expect(screen.queryByText("历史遗留对话")).toBeNull();
    expect(within(openQuickMenu()).queryByText("历史遗留对话")).toBeNull();
  });

  test("explains why a Space is required before sending the first conversation", () => {
    const current = state();
    render(<App client={client({
      ...current,
      conversations: [],
      vaultResources: current.vaultResources.filter((resource) => resource.kind !== "space"),
    })} />);

    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /还没有空间/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /新建空间/u })).toBeTruthy();
  });

  deferredContentTest("projects Vault content into the ordered space detail", () => {
    render(<App client={client(state())} />);

    openSpace("产品空间");
    openDeferredContentSurface();

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings[0]).toMatch(/^产品空间/u);
    expect(headings.slice(1)).toEqual(["对话", "我的笔记", "资料"]);
    expect(screen.getByText("移动端方向")).toBeTruthy();
    expect(screen.getByText("移动端结构调整")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建笔记" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建资料" })).toBeTruthy();
    expect(openQuickMenu()).toBeTruthy();
  });

  deferredContentTest("projects an offline edit in place and opens its local draft", () => {
    const current = state();
    const note = current.vaultResources.find((resource) => resource.kind === "personal_note");
    const mutation = {
      protocolVersion: "content-vault/v1" as const,
      mutationId: "mutation-note-offline",
      kind: "personal_note" as const,
      resourceId: note?.resourceId ?? "note-1",
      baseRevision: 1,
      operation: "upsert" as const,
      payloadSchemaVersion: 1 as const,
      payload: {
        spaceId: "space-1",
        title: "本地草稿",
        bodyMarkdown: "这是尚未同步的本地内容。",
      },
      contentHash: `sha256:${"b".repeat(64)}`,
    };
    render(<App client={client({
      ...current,
      vaultOutbox: [{ mutationId: mutation.mutationId, mutation, createdAt: "2026-08-04T00:00:01.000Z" }],
    } as MobileRemoteState)} />);

    openSpace("产品空间");
    const pendingNote = screen.getByRole("button", { name: /本地草稿.*等待同步/u });
    expect(pendingNote).toBeTruthy();
    expect(screen.getAllByText("等待同步")).toHaveLength(1);

    fireEvent.click(pendingNote);
    expect((screen.getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("这是尚未同步的本地内容。");
  });

  deferredContentTest("renders managed files as a collapsible Space tree", () => {
    const current = state();
    const nested = {
      ...current,
      vaultResources: [
        ...current.vaultResources,
        resource("managed_root", "root-1", { spaceId: "space-1", title: "软件文件" }),
        resource("managed_file", "file-1", { managedRootId: "root-1", relativePath: "docs/plan.md", text: "计划" }),
        resource("managed_file", "file-2", { managedRootId: "root-1", relativePath: "docs/research/notes.md", text: "笔记" }),
      ],
    } as MobileRemoteState;
    render(<App client={client(nested)} />);

    openSpace("产品空间");
    expect(screen.getByRole("button", { name: /docs.*2 项/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /plan\.md/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /research/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /docs.*2 项/u }));
    expect(screen.queryByRole("button", { name: /plan\.md/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /research/ })).toBeNull();
  });

  deferredContentTest("keeps the Space tree collapsed after returning from a Conversation", () => {
    const current = state();
    const nested = {
      ...current,
      vaultResources: [
        ...current.vaultResources,
        resource("managed_root", "root-2", { spaceId: "space-1", title: "软件文件" }),
        resource("managed_file", "file-3", { managedRootId: "root-2", relativePath: "docs/plan.md", text: "计划" }),
      ],
    } as MobileRemoteState;
    render(<App client={client(nested)} />);

    openSpace("产品空间");
    const docs = screen.getByRole("button", { name: /docs.*1 项/u });
    fireEvent.click(docs);
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("heading", { name: /产品空间/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plan\.md/u })).toBeNull();
  });

  test("keeps the last visited Space as the home conversation owner across remounts", () => {
    const current = state();
    const withTwoSpaces = {
      ...current,
      vaultResources: [
        ...current.vaultResources,
        resource("space", "space-2", { title: "研究空间" }),
      ],
    } as MobileRemoteState;
    const first = render(<App client={client(withTwoSpaces)} />);

    openSpace("研究空间");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "研究空间" })).toBeTruthy();

    first.unmount();
    render(<App client={client(withTwoSpaces)} />);
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "研究空间" })).toBeTruthy();
  });

  test("keeps a restored pending conversation inside its owning Space", () => {
    const current = {
      ...state(),
      pendingConversations: [{
        commandId: "command-pending",
        spaceId: "space-1",
        message: "整理移动协同的下一步",
        createdAt: "2026-08-04T00:00:00.000Z",
      }],
    } satisfies MobileRemoteState;
    render(<App client={client(current)} />);

    openSpace("产品空间");
    const pending = screen.getByRole("button", { name: /整理移动协同的下一步.*待发送/u });
    expect(pending).toBeTruthy();

    fireEvent.click(pending);
    expect((screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement).value).toBe("整理移动协同的下一步");
    expect(screen.queryByText("等待电脑")).toBeNull();
    expect(screen.getByRole("button", { name: /当前模型/u })).toBeTruthy();
  });

  deferredContentTest("routes empty Space groups directly into their matching creation flow", () => {
    const current = state();
    render(<App client={client({
      ...current,
      vaultResources: current.vaultResources.filter((resource) => resource.kind === "space"),
    })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: "在此空间写下第一篇笔记" }));
    const noteDialog = screen.getByRole("dialog", { name: "新建笔记" });
    expect(noteDialog).toBeTruthy();
    expect(within(noteDialog).getByText("产品空间")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "内容类型" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "添加第一份资料" }));
    expect(screen.getByRole("dialog", { name: "新建文件" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "文件名" })).toBeTruthy();
  });

  deferredContentTest("creates a material entry as a managed file without a second type choice", async () => {
    const current = state();
    const submitVaultMutation = vi.fn(async (_mutation: Parameters<RemoteMobileClient["submitVaultMutation"]>[0]) => "mutation-create-file");
    render(<App client={client({
      ...current,
      vaultResources: current.vaultResources.filter((resource) => resource.kind === "space"),
    }, { submitVaultMutation })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: "添加第一份资料" }));
    fireEvent.change(screen.getByRole("textbox", { name: "文件名" }), { target: { value: "计划.md" } });
    fireEvent.change(screen.getByRole("textbox", { name: "内容" }), { target: { value: "下一步安排" } });
    fireEvent.click(screen.getByRole("button", { name: "创建文件" }));

    await waitFor(() => expect(submitVaultMutation).toHaveBeenCalledTimes(2));
    expect(submitVaultMutation.mock.calls.map(([mutation]) => mutation.kind)).toEqual(["managed_root", "managed_file"]);
    expect(submitVaultMutation).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "managed_file",
      operation: "upsert",
      payload: expect.objectContaining({ relativePath: "计划.md", text: "下一步安排" }),
    }));
  });

  deferredContentTest("continues from a created note into the synchronized editor", async () => {
    const initial = state();
    let current = {
      ...initial,
      vaultResources: initial.vaultResources.filter((resource) => resource.kind === "space"),
    } as MobileRemoteState;
    const listeners = new Set<() => void>();
    const submitVaultMutation = vi.fn(async (mutation: Parameters<RemoteMobileClient["submitVaultMutation"]>[0]) => {
      if (mutation.operation === "upsert" && mutation.kind === "personal_note") {
        current = {
          ...current,
          vaultResources: [...current.vaultResources, resource("personal_note", mutation.resourceId, mutation.payload)],
        } as MobileRemoteState;
        listeners.forEach((listener) => listener());
      }
      return "mutation-create-note";
    });
    render(<App client={client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submitVaultMutation,
    })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: "在此空间写下第一篇笔记" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "移动端方案" } });
    fireEvent.change(screen.getByRole("textbox", { name: "正文" }), { target: { value: "继续完善信息架构" } });
    fireEvent.click(screen.getByRole("button", { name: "创建笔记" }));

    const editor = await screen.findByRole("dialog", { name: "移动端方案" });
    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("继续完善信息架构");
    expect(screen.queryByRole("dialog", { name: "新建笔记" })).toBeNull();
  });

  test("keeps Conversation navigation attached to its owning Space", () => {
    render(<App client={client(state())} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    expect(screen.queryByText("未指定空间")).toBeNull();
    expect(document.querySelector(".aa-mobile-conversation-owner-mark")).not.toBeNull();

    const quickMenu = openQuickMenu();
    expect(within(quickMenu).queryByRole("menuitem", { name: "产品空间" })).toBeNull();
    act(() => expect(dispatchMobileBackButton()).toBe(true));
    expect(screen.queryByRole("menu", { name: "快捷操作" })).toBeNull();
    expect(screen.getByRole("button", { name: "产品空间" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "产品空间" }));
    expect(screen.getByRole("heading", { name: "对话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /移动端结构调整/u })).toBeTruthy();
  });

  test("returns to the owning Space when an open conversation disappears", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));

    current = {
      ...current,
      conversations: current.conversations.filter((conversation) => conversation.conversationId !== "conversation-1"),
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByRole("heading", { name: /产品空间/u })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "对话" })).toBeTruthy();
  });

  test("keeps the system status surface aligned with dark mode", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(<App client={client(state())} />);

    expect(meta.content).toBe("#181916");
  });

  test("keeps settings as a focused secondary surface", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(<App client={client(state())} />);
    openProfile();
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByText("这台手机")).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "深色外观" })).toBeNull();
    expect(meta.content).toBe("#f4f2ef");
  });

  test("keeps device revocation inside the mobile overlay contract", async () => {
    const forgetDevice = vi.fn(async () => undefined);
    render(<App client={client(state(), { forgetDevice })} />);
    openProfile();

    fireEvent.click(screen.getByRole("button", { name: "撤销这台手机的权限" }));
    expect(screen.getByRole("dialog", { name: "撤销手机权限" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "撤销手机权限" })).toBeNull();
    expect(forgetDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "撤销这台手机的权限" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "撤销手机权限" })).getByRole("button", { name: "撤销权限" }));
    await waitFor(() => expect(forgetDevice).toHaveBeenCalledTimes(1));
  });

  test("keeps offline state in the top bar instead of repeating it in the composer", () => {
    render(<App client={client({ ...state(), peerOnline: false })} />);

    startNewConversation();
    expect(screen.getByRole("status", { name: "电脑离线" }).textContent).toBe("电脑离线");
    const composer = screen.getByRole("textbox", { name: "输入消息" }).closest("form");
    expect(composer).not.toBeNull();
    expect(within(composer!).queryByText(/离线|恢复后发送/u)).toBeNull();
    expect(within(composer!).getByRole("button", { name: /当前模型/u })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "恢复后继续" } });
    expect(screen.getByRole("button", { name: "发送" }).hasAttribute("disabled")).toBe(false);
  });

  test("selects a safe desktop model and submits only its opaque selection id", async () => {
    const sendCommand = vi.fn(async () => "command-model");
    render(<App client={client({
      ...state(),
      modelOptions: [
        { id: '["profile-a","model-a"]', label: "Model A", providerLabel: "Provider A", supportsTools: true, supportsVision: false, isDefault: true },
        { id: '["profile-b","model-b"]', label: "Model B", providerLabel: "Provider B", supportsTools: true, supportsVision: true, isDefault: false },
      ],
    }, { sendCommand })} />);

    startNewConversation();
    fireEvent.click(screen.getByRole("button", { name: /Model A/u }));
    const picker = screen.getByRole("dialog", { name: "选择模型" });
    expect(within(picker).queryByText(/api|基础地址|密钥/iu)).toBeNull();
    fireEvent.click(within(picker).getByRole("option", { name: /Model B/u }));
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "使用选择的模型" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await act(async () => undefined);
    expect(sendCommand).toHaveBeenCalledWith({
      kind: "conversation.submit",
      message: "使用选择的模型",
      spaceId: "space-1",
      modelSelectionId: '["profile-b","model-b"]',
    });
    expect(JSON.stringify(sendCommand.mock.calls)).not.toMatch(/baseUrl|apiKey|secretRef/u);
  });

  test("restores a conversation draft when the desktop rejects the submission", async () => {
    let current = {
      ...state(),
      conversationPages: {
        "conversation-1": {
          kind: "conversation.page" as const,
          eventId: "page-1",
          conversationId: "conversation-1",
          turns: [],
          hasMore: false,
        },
      },
    } as MobileRemoteState;
    const listeners = new Set<() => void>();
    const sendCommand = vi.fn(async () => "submit-command-1");
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      sendCommand,
    });
    render(<App client={liveClient} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const composer = screen.getByRole("textbox", { name: "输入消息" });
    fireEvent.change(composer, { target: { value: "继续处理这项工作" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(sendCommand).toHaveBeenCalledWith({
      kind: "conversation.submit",
      conversationId: "conversation-1",
      message: "继续处理这项工作",
    }));
    expect(screen.getByRole("button", { name: "正在发送" })).toBeTruthy();
    expect(screen.queryByText("等待电脑确认")).toBeNull();

    current = {
      ...current,
      commandResults: [{
        kind: "command.result",
        eventId: "submit-result-1",
        commandId: "submit-command-1",
        status: "failed",
        error: { code: "desktop_rejected", message: "电脑拒绝了这条消息" },
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    await waitFor(() => expect((screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement).value).toBe("继续处理这项工作"));
    expect(screen.getByText("电脑拒绝了这条消息")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
  });

  test("uses bundled provider marks in both the composer and model picker", () => {
    render(<App client={client({
      ...state(),
      modelOptions: [
        { id: "deepseek-model", label: "DeepSeek-V4", providerLabel: "DeepSeek", supportsTools: true, supportsVision: false, isDefault: true },
        { id: "claude-model", label: "Claude Sonnet", providerLabel: "Anthropic", supportsTools: true, supportsVision: true, isDefault: false },
        { id: "openai-model", label: "GPT-5", providerLabel: "OpenAI", supportsTools: true, supportsVision: true, isDefault: false },
        { id: "kimi-model", label: "Kimi K2", providerLabel: "Moonshot", supportsTools: true, supportsVision: false, isDefault: false },
        { id: "glm-model", label: "GLM-5", providerLabel: "智谱", supportsTools: true, supportsVision: false, isDefault: false },
        { id: "minimax-model", label: "MiniMax M2", providerLabel: "MiniMax", supportsTools: true, supportsVision: false, isDefault: false },
      ],
    })} />);

    startNewConversation();
    const selectedModel = screen.getByRole("button", { name: "当前模型：DeepSeek-V4" });
    expect(selectedModel.querySelector("[data-family='deepseek']")).not.toBeNull();
    fireEvent.click(selectedModel);
    const picker = screen.getByRole("dialog", { name: "选择模型" });
    const options = within(picker).getAllByRole("option");
    expect(options).toHaveLength(6);
    expect(options.filter((option) => option.getAttribute("aria-selected") === "true")).toHaveLength(1);
    for (const family of ["deepseek", "claude", "openai", "kimi", "glm", "minimax"]) {
      expect(picker.querySelector(`[data-family='${family}']`)).not.toBeNull();
    }
  });

  test("supports roving keyboard navigation in the model picker without changing selection", () => {
    const modelOptions = [
      { id: "model-a", label: "Model A", providerLabel: "Provider A", supportsTools: true, supportsVision: false, isDefault: true },
      { id: "model-b", label: "Model B", providerLabel: "Provider B", supportsTools: true, supportsVision: false, isDefault: false },
      { id: "model-c", label: "Model C", providerLabel: "Provider C", supportsTools: true, supportsVision: false, isDefault: false },
    ];
    render(<App client={client({ ...state(), modelOptions })} />);

    startNewConversation();
    fireEvent.click(screen.getByRole("button", { name: /Model A/u }));
    const picker = screen.getByRole("dialog", { name: "选择模型" });
    const options = within(picker).getAllByRole("option");

    expect(options[0]?.getAttribute("tabindex")).toBe("0");
    expect(options.slice(1).every((option) => option.getAttribute("tabindex") === "-1")).toBe(true);
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "End" });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
    expect(options.filter((option) => option.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  test("adds model search only for a long model list", () => {
    const modelOptions = Array.from({ length: 13 }, (_, index) => ({
      id: `model-${index + 1}`,
      label: `Model ${index + 1}`,
      providerLabel: "Provider",
      supportsTools: true,
      supportsVision: false,
      isDefault: index === 0,
    }));
    render(<App client={client({ ...state(), modelOptions })} />);

    startNewConversation();
    fireEvent.click(screen.getByRole("button", { name: /Model 1/u }));
    const picker = screen.getByRole("dialog", { name: "选择模型" });
    fireEvent.change(within(picker).getByRole("textbox", { name: "搜索模型" }), { target: { value: "Model 13" } });
    expect(within(picker).getAllByRole("option")).toHaveLength(1);
    expect(within(picker).getByRole("option", { name: /Model 13/u })).toBeTruthy();
  });

  test("resets the composer height after a long message is submitted", async () => {
    render(<App client={client(state())} />);
    startNewConversation();
    const composer = screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement;
    Object.defineProperty(composer, "scrollHeight", { configurable: true, value: 132 });
    fireEvent.input(composer, { target: { value: "一段较长的消息" } });
    expect(composer.style.height).toBe("132px");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => undefined);
    expect(composer.style.height).toBe("");
  });

  test("keeps model selection available inside a Space and an existing conversation", () => {
    const current = {
      ...state(),
      modelOptions: [{ id: '["profile-a","model-a"]', label: "Model A", supportsTools: true, supportsVision: false, isDefault: true }],
    };
    render(<App client={client(current)} />);
    openSpace("产品空间");
    expect(screen.getByRole("button", { name: /Model A/u })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const conversationComposer = screen.getByRole("textbox", { name: "输入消息" }).closest("form");
    expect(conversationComposer).not.toBeNull();
    expect(within(conversationComposer!).getByRole("button", { name: /Model A/u })).toBeTruthy();
  });

  test("keeps a conversation model override separate from the new-conversation default", () => {
    const current = {
      ...state(),
      modelOptions: [
        { id: '["profile-a","model-a"]', label: "Model A", supportsTools: true, supportsVision: false, isDefault: true },
        { id: '["profile-b","model-b"]', label: "Model B", supportsTools: true, supportsVision: false, isDefault: false },
      ],
    } as MobileRemoteState;
    render(<App client={client(current)} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    fireEvent.click(screen.getByRole("button", { name: /Model A/u }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "选择模型" })).getByRole("option", { name: /Model B/u }));
    expect(screen.getByRole("button", { name: /Model B/u })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("button", { name: /Model A/u })).toBeTruthy();
  });

  test("keeps a failed continuation message and its error beside the conversation composer", async () => {
    const sendCommand = vi.fn(async () => {
      throw new Error("本地存储不可用");
    });
    render(<App client={client(state(), { sendCommand })} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));

    const field = screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "继续完善移动端" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(field.value).toBe("继续完善移动端"));
    const composer = field.closest<HTMLElement>(".aa-mobile-conversation-composer-wrap");
    expect(composer).not.toBeNull();
    expect(within(composer!).getByText("本地存储不可用")).toBeTruthy();
  });

  test("submits an approval decision only once while the command is in flight", async () => {
    let release!: () => void;
    const sendCommand = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("command-1");
    }));
    render(<App client={client(approvalState(), { sendCommand })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const approve = screen.getByRole("button", { name: "执行" });
    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("等待电脑确认")).toBeTruthy();

    await act(async () => release());
    expect(screen.getByText("等待电脑确认")).toBeTruthy();
  });

  test("re-enables an approval after the desktop rejects the command", async () => {
    let current = approvalState();
    const listeners = new Set<() => void>();
    const sendCommand = vi.fn(async () => "approval-command-1");
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      sendCommand,
    });
    render(<App client={liveClient} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    await act(async () => undefined);
    expect(screen.getByText("等待电脑确认")).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行" }).hasAttribute("disabled")).toBe(true);

    current = {
      ...current,
      commandResults: [{
        kind: "command.result",
        eventId: "approval-result-1",
        commandId: "approval-command-1",
        status: "failed",
        error: { code: "run_not_found", message: "电脑端已结束这次运行" },
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByText("电脑端已结束这次运行")).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  test("never queues an approval while the desktop is offline", () => {
    const sendCommand = vi.fn(async () => "command-1");
    render(<App client={client({ ...approvalState(), peerOnline: false }, { sendCommand })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));

    expect(screen.getByText("电脑离线，重新连接后再处理")).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(sendCommand).not.toHaveBeenCalled();
  });

  test("does not offer to resume an approval lost after restart", () => {
    const sendCommand = vi.fn(async () => "command-1");
    const current = approvalState();
    const lostAfterRestart: MobileRemoteState = {
      ...current,
      runs: current.runs.map((run) => ({
        ...run,
        pendingConfirmations: run.pendingConfirmations.map((confirmation) => ({
          ...confirmation,
          resumeAvailability: "lost_after_restart" as const,
        })),
      })),
    };
    render(<App client={client(lostAfterRestart, { sendCommand })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));

    expect(screen.getByText("电脑已重启，这次操作无法原地继续。请先不执行，再重新发起任务。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(sendCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "不执行" }));
    expect(sendCommand).toHaveBeenCalledWith(expect.objectContaining({ decision: "deny" }));
  });

  test("opens the conversation identified by the matching command result", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const sendCommand = vi.fn(async () => "mobile-command-1");
    const liveClient = client(current, {
      sendCommand,
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    startNewConversation();
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "创建我的任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => undefined);

    current = {
      ...current,
      conversations: [
        ...current.conversations,
        { conversationId: "desktop-created", title: "桌面端同时创建", updatedAt: "2026-08-04T00:00:01.000Z", status: "running" },
        { conversationId: "mobile-created", title: "创建我的任务", updatedAt: "2026-08-04T00:00:02.000Z", status: "running", spaceId: "space-1" },
      ],
      commandResults: [{
        kind: "command.result",
        eventId: "result-1",
        commandId: "mobile-command-1",
        status: "applied",
        entity: { conversationId: "mobile-created" },
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByText("创建我的任务")).toBeTruthy();
    expect(screen.getByRole("button", { name: "产品空间" })).toBeTruthy();
    expect(screen.queryByText("桌面端同时创建")).toBeNull();
  });

  test("does not enter an unrelated conversation before the matching result arrives", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      sendCommand: vi.fn(async () => "mobile-command-1"),
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    startNewConversation();
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "创建我的任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => undefined);

    current = {
      ...current,
      conversations: [...current.conversations, {
        conversationId: "desktop-created",
        title: "桌面端同时创建",
        updatedAt: "2026-08-04T00:00:01.000Z",
        status: "running",
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByRole("textbox", { name: "输入消息" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /桌面端同时创建/u })).toBeNull();
  });

  test("does not use a conversation from another Space when an applied result omits its id", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      sendCommand: vi.fn(async () => "mobile-command-1"),
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    startNewConversation();
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "只属于产品空间" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => undefined);

    current = {
      ...current,
      conversations: [...current.conversations, {
        conversationId: "other-space-created",
        title: "另一个空间的新对话",
        updatedAt: "2026-08-04T00:00:01.000Z",
        status: "running",
        spaceId: "space-2",
      }],
      commandResults: [{
        kind: "command.result",
        eventId: "result-without-entity",
        commandId: "mobile-command-1",
        status: "applied",
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(screen.getByRole("textbox", { name: "输入消息" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /另一个空间的新对话/u })).toBeNull();
  });

  test("restores a failed new-conversation message in place", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      sendCommand: vi.fn(async () => "mobile-command-1"),
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    startNewConversation();
    fireEvent.change(screen.getByRole("textbox", { name: "输入消息" }), { target: { value: "不能丢失的内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => undefined);

    current = {
      ...current,
      commandResults: [{
        kind: "command.result",
        eventId: "result-failed",
        commandId: "mobile-command-1",
        status: "failed",
        error: { code: "desktop_unavailable", message: "电脑暂时无法处理" },
      }],
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect((screen.getByRole("textbox", { name: "输入消息" }) as HTMLTextAreaElement).value).toBe("不能丢失的内容");
    expect(screen.getByText("电脑暂时无法处理")).toBeTruthy();
  });

  deferredContentTest("autosaves one note draft with title and body after the 500ms quiet window", async () => {
    vi.useFakeTimers();
    let resolveMutation: ((mutationId: string) => void) | undefined;
    const submitVaultMutation = vi.fn(() => new Promise<string>((resolve) => {
      resolveMutation = resolve;
    }));
    render(<App client={client(state(), { submitVaultMutation })} />);

    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "笔记名称" }), { target: { value: "移动端信息架构" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "正文" }), { target: { value: "新的移动端方向" } });

    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(submitVaultMutation).not.toHaveBeenCalled();
    expect(within(editor).queryByText("正在保存")).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(submitVaultMutation).toHaveBeenCalledTimes(1);
    expect(within(editor).getByText("正在保存")).toBeTruthy();
    expect(submitVaultMutation).toHaveBeenCalledWith(expect.objectContaining({
      kind: "personal_note",
      resourceId: "note-1",
      baseRevision: 1,
      operation: "upsert",
      payload: expect.objectContaining({ title: "移动端信息架构", bodyMarkdown: "新的移动端方向" }),
    }));

    await act(async () => resolveMutation?.("mutation-1"));
    expect(within(editor).getByText("已保存")).toBeTruthy();
  });

  deferredContentTest("updates an open editor when a newer Vault revision arrives", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    expect((within(editor).getByRole("textbox", { name: "笔记名称" }) as HTMLInputElement).value).toBe("移动端方向");
    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("保持移动端与桌面端一致。");

    current = {
      ...current,
      vaultResources: current.vaultResources.map((resource) => resource.resourceId === "note-1"
        ? { ...resource, revision: 2, payload: { ...resource.payload, title: "电脑端方向", bodyMarkdown: "电脑端刚刚保存的内容" } }
        : resource),
    };
    await act(async () => {
      listeners.forEach((listener) => listener());
    });

    expect((within(editor).getByRole("textbox", { name: "笔记名称" }) as HTMLInputElement).value).toBe("电脑端方向");
    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("电脑端刚刚保存的内容");
    expect(within(editor).getByText("已同步")).toBeTruthy();
  });

  deferredContentTest("does not overwrite a dirty open editor when a newer Vault revision arrives", async () => {
    vi.useFakeTimers();
    let current = state();
    const listeners = new Set<() => void>();
    const submitVaultMutation = vi.fn(async () => "mutation-1");
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submitVaultMutation,
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "正文" }), { target: { value: "手机端未保存的草稿" } });

    current = {
      ...current,
      vaultResources: current.vaultResources.map((resource) => resource.resourceId === "note-1"
        ? { ...resource, revision: 2, payload: { ...resource.payload, bodyMarkdown: "电脑端的新版本" } }
        : resource),
    };
    await act(async () => {
      listeners.forEach((listener) => listener());
    });

    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("手机端未保存的草稿");
    expect(within(editor).getByText("另一台设备有更新，已保留当前编辑")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(submitVaultMutation).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: "note-1",
      baseRevision: 1,
      payload: expect.objectContaining({ bodyMarkdown: "手机端未保存的草稿" }),
    }));
  });

  deferredContentTest("keeps conflict evidence out of the editor until the user compares versions", () => {
    const current = state();
    const submitVaultMutation = vi.fn(async () => "unexpected-save");
    const note = current.vaultResources.find((item) => item.resourceId === "note-1")!;
    const conflicted = {
      ...current,
      vaultConflicts: [{
        mutationId: "mutation-editor-conflict",
        mutation: {
          protocolVersion: "content-vault/v1",
          mutationId: "mutation-editor-conflict",
          kind: "personal_note",
          resourceId: "note-1",
          baseRevision: 1,
          operation: "upsert",
          payloadSchemaVersion: 1,
          payload: { ...note.payload, bodyMarkdown: "手机端保留的完整内容" },
          contentHash: `sha256:${"c".repeat(64)}`,
        },
        reason: "revision_mismatch",
        current: { ...note, payload: { ...note.payload, bodyMarkdown: "电脑端保存的完整内容" } },
        detectedAt: "2026-08-04T08:15:00.000Z",
      }],
    } as MobileRemoteState;
    render(<App client={client(conflicted, { submitVaultMutation })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("手机端保留的完整内容");

    fireEvent.change(within(editor).getByRole("textbox", { name: "正文" }), { target: { value: "手机刚写下但尚未解决冲突的内容" } });
    fireEvent.click(within(editor).getByRole("button", { name: "返回" }));
    const comparison = screen.getByRole("dialog", { name: "比较同步版本" });
    expect(within(comparison).getByText("手机刚写下但尚未解决冲突的内容")).toBeTruthy();
    expect(within(comparison).getByText("电脑端保存的完整内容")).toBeTruthy();
    expect(within(comparison).getByRole("button", { name: "保留手机版本" })).toBeTruthy();
    expect(submitVaultMutation).not.toHaveBeenCalled();
  });

  deferredContentTest("offers to copy a dirty draft before closing after a remote deletion", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const submitVaultMutation = vi.fn(async () => "mutation-1");
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submitVaultMutation,
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    const textbox = within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "尚未保存的手机草稿" } });

    current = {
      ...current,
      vaultResources: current.vaultResources.map((resource) => resource.resourceId === "note-1"
        ? { ...resource, revision: 2, deleted: true }
        : resource),
    };
    await act(async () => {
      listeners.forEach((listener) => listener());
    });

    expect(textbox.value).toBe("尚未保存的手机草稿");
    expect(textbox.readOnly).toBe(true);
    expect(within(editor).getByText("此内容已在另一台设备删除，当前编辑未上传")).toBeTruthy();
    expect(within(editor).queryByRole("button", { name: "删除" })).toBeNull();
    expect(submitVaultMutation).not.toHaveBeenCalled();

    fireEvent.click(within(editor).getByRole("button", { name: "返回" }));
    const recovery = screen.getByRole("dialog", { name: "保留本地草稿" });
    expect(within(recovery).getByRole("button", { name: "复制草稿" })).toBeTruthy();
    expect(within(recovery).getByRole("button", { name: "放弃草稿" })).toBeTruthy();

    fireEvent.click(within(recovery).getByRole("button", { name: "复制草稿" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("移动端方向\n\n尚未保存的手机草稿"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移动端方向" })).toBeNull());
  });

  deferredContentTest("keeps a remotely deleted draft recoverable when clipboard copying fails", async () => {
    let current = state();
    const listeners = new Set<() => void>();
    const writeText = vi.fn(async () => {
      throw new Error("剪贴板权限被拒绝");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "正文" }), { target: { value: "不能丢失的手机草稿" } });

    current = {
      ...current,
      vaultResources: current.vaultResources.map((resource) => resource.resourceId === "note-1"
        ? { ...resource, revision: 2, deleted: true }
        : resource),
    };
    await act(async () => listeners.forEach((listener) => listener()));

    fireEvent.click(within(editor).getByRole("button", { name: "返回" }));
    const recovery = screen.getByRole("dialog", { name: "保留本地草稿" });
    fireEvent.click(within(recovery).getByRole("button", { name: "复制草稿" }));

    expect(await within(recovery).findByText("剪贴板权限被拒绝")).toBeTruthy();
    expect((within(editor).getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("不能丢失的手机草稿");
    expect(screen.getByRole("dialog", { name: "移动端方向" })).toBeTruthy();

    fireEvent.click(within(recovery).getByRole("button", { name: "放弃草稿" }));
    expect(screen.queryByRole("dialog", { name: "移动端方向" })).toBeNull();
  });

  deferredContentTest("keeps a failed autosave visible without entering a retry loop", async () => {
    vi.useFakeTimers();
    const submitVaultMutation = vi.fn(async () => {
      throw new Error("同步暂时不可用");
    });
    render(<App client={client(state(), { submitVaultMutation })} />);

    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "正文" }), { target: { value: "等待恢复后再保存" } });

    await act(async () => vi.advanceTimersByTimeAsync(2_500));

    expect(submitVaultMutation).toHaveBeenCalledTimes(1);
    expect(within(editor).getAllByText("保存失败").length).toBeGreaterThan(0);
    expect(within(editor).getByText("同步暂时不可用")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "重试" })).toBeTruthy();
  });

  deferredContentTest("opens Vault content for reading without forcing the software keyboard", () => {
    render(<App client={client(state())} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));

    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    expect(within(editor).getByRole("textbox", { name: "正文" })).not.toBe(document.activeElement);
    expect(within(editor).getByRole("button", { name: "返回" })).toBe(document.activeElement);
  });

  deferredContentTest("keeps destructive editor actions behind an explicit more menu", () => {
    render(<App client={client(state())} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));

    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    expect(within(editor).queryByRole("button", { name: "删除" })).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "更多" }));
    expect(screen.getByRole("dialog", { name: "内容操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });

  deferredContentTest("keeps a failed delete in its decision layer and clears the error before retrying", async () => {
    let rejectDelete!: () => void;
    const submitVaultMutation = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => {
        rejectDelete = () => reject(new Error("电脑暂时无法删除"));
      }))
      .mockResolvedValueOnce("mutation-delete-retry");
    render(<App client={client(state(), { submitVaultMutation })} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));

    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.click(within(editor).getByRole("button", { name: "更多" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "内容操作" })).getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认删除" })).getByRole("button", { name: "删除" }));
    expect(within(editor).getByText("正在删除")).toBeTruthy();

    await act(async () => rejectDelete());
    const failedDelete = screen.getByRole("dialog", { name: "确认删除" });
    expect(within(failedDelete).getByText("电脑暂时无法删除")).toBeTruthy();
    expect(within(editor).getAllByText("删除失败").length).toBeGreaterThan(0);

    fireEvent.click(within(failedDelete).getByRole("button", { name: "返回" }));
    const actions = screen.getByRole("dialog", { name: "内容操作" });
    expect(within(editor).queryByText("删除失败")).toBeNull();
    fireEvent.click(within(actions).getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认删除" })).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移动端方向" })).toBeNull());
    expect(submitVaultMutation).toHaveBeenCalledTimes(2);
  });

  deferredContentTest("routes Escape through delete confirmation, editor actions, and the editor", () => {
    render(<App client={client(state())} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));

    const editor = screen.getByRole("dialog", { name: "移动端方向" });
    fireEvent.click(within(editor).getByRole("button", { name: "更多" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "内容操作" })).getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "确认删除" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认删除" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "内容操作" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "内容操作" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "移动端方向" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "移动端方向" })).toBeNull();
    expect(screen.getByRole("heading", { name: /产品空间/u })).toBeTruthy();
  });

  deferredContentTest("consumes Android back from the topmost editor layer before leaving the Space", async () => {
    const submitVaultMutation = vi.fn(async () => "mutation-back");
    render(<App client={client(state(), { submitVaultMutation })} />);
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "移动端方向" })).getByRole("button", { name: "更多" }));

    act(() => expect(dispatchMobileBackButton()).toBe(true));
    expect(screen.queryByRole("dialog", { name: "内容操作" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "移动端方向" })).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "正文" }), { target: { value: "返回前保存的最新内容" } });
    act(() => expect(dispatchMobileBackButton()).toBe(true));
    act(() => expect(dispatchMobileBackButton()).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移动端方向" })).toBeNull());
    expect(submitVaultMutation).toHaveBeenCalledTimes(1);
    expect(submitVaultMutation).toHaveBeenCalledWith(expect.objectContaining({
      kind: "personal_note",
      payload: expect.objectContaining({ bodyMarkdown: "返回前保存的最新内容" }),
    }));
    act(() => expect(dispatchMobileBackButton()).toBe(true));
    expect(screen.getByRole("region", { name: "空间列表" })).toBeTruthy();
  });

  deferredContentTest("does not offer deletion when the desktop owner cannot apply that tombstone", () => {
    const current = state();
    render(<App client={client({
      ...current,
      vaultResources: [...current.vaultResources, resource("workbench_asset", "asset-1", {
        title: "只支持编辑.md",
        kind: "markdown",
        text: "内容",
        language: "markdown",
      })],
    })} />);

    openDeferredKnowledgeSurface();
    fireEvent.click(screen.getByRole("button", { name: /只支持编辑\.md/u }));

    const editor = screen.getByRole("dialog", { name: "只支持编辑.md" });
    expect(within(editor).queryByRole("button", { name: "删除" })).toBeNull();
  });

  deferredContentTest("finds knowledge by body text while retaining its Space owner", () => {
    render(<App client={client(state())} />);

    openDeferredKnowledgeSurface();
    expect(screen.queryByRole("navigation", { name: "主要导航" })).toBeNull();
    expect(screen.getByText("产品空间")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索知识库" }), { target: { value: "保持移动端" } });
    expect(screen.getByRole("button", { name: /移动端方向/u })).toBeTruthy();
  });

  deferredContentTest("opens Space-owned conflicts in a focused content workflow", () => {
    const current = state();
    const note = current.vaultResources.find((item) => item.resourceId === "note-1")!;
    const conflicted = {
      ...current,
      vaultConflicts: [{
        mutationId: "mutation-space-row",
        mutation: {
          protocolVersion: "content-vault/v1",
          mutationId: "mutation-space-row",
          kind: "personal_note",
          resourceId: "note-1",
          baseRevision: 1,
          operation: "upsert",
          payloadSchemaVersion: 1,
          payload: { ...note.payload, bodyMarkdown: "手机版本" },
          contentHash: `sha256:${"c".repeat(64)}`,
        },
        reason: "revision_mismatch",
        current: note,
        detectedAt: "2026-08-04T08:15:00.000Z",
      }],
    } as MobileRemoteState;
    render(<App client={client(conflicted)} />);

    openSpace("产品空间");
    const attention = screen.getByRole("button", { name: /1 项内容需要处理.*同步冲突/u });
    expect(attention).toBeTruthy();
    fireEvent.click(attention);
    expect(screen.getByRole("heading", { name: "同步问题" })).toBeTruthy();
    expect(screen.getByText("产品空间")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "设置" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("heading", { name: /产品空间/u })).toBeTruthy();
  });

  deferredContentTest("presents conflicts with user content and marks the profile destination", async () => {
    const current = state();
    const note = current.vaultResources.find((item) => item.resourceId === "note-1")!;
    const conflicted = {
      ...current,
      vaultConflicts: [{
        mutationId: "mutation-1",
        mutation: {
          protocolVersion: "content-vault/v1",
          mutationId: "mutation-1",
          kind: "personal_note",
          resourceId: "note-1",
          baseRevision: 1,
          operation: "upsert",
          payloadSchemaVersion: 1,
          payload: { ...note.payload, title: "手机标题", bodyMarkdown: "手机正在编辑的版本" },
          contentHash: `sha256:${"b".repeat(64)}`,
        },
        reason: "revision_mismatch",
        current: { ...note, payload: { ...note.payload, title: "电脑标题", bodyMarkdown: "电脑刚保存的版本" } },
        detectedAt: "2026-08-04T08:15:00.000Z",
      }],
    } as MobileRemoteState;
    const resolveVaultConflict = vi.fn(async () => undefined);
    render(<App client={client(conflicted, { resolveVaultConflict })} />);

    openProfile();
    expect(screen.getByText("手机标题")).toBeTruthy();
    expect(screen.getByText("手机正在编辑的版本")).toBeTruthy();
    expect(screen.getByText("电脑刚保存的版本")).toBeTruthy();
    expect(screen.getByRole("button", { name: "使用电脑版本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保留手机版本" })).toBeTruthy();
    expect(screen.queryByText("note-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    openSpace("产品空间");
    openDeferredContentSurface();
    fireEvent.click(screen.getByRole("button", { name: /移动端方向/u }));
    fireEvent.click(screen.getByRole("button", { name: /比较.*同步版本/u }));
    expect(screen.getByRole("dialog", { name: "比较同步版本" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "使用电脑版本" }));
    expect(resolveVaultConflict).toHaveBeenCalledWith("mutation-1", "accept_remote");
    await waitFor(() => expect((screen.getByRole("textbox", { name: "笔记名称" }) as HTMLInputElement).value).toBe("电脑标题"));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).value).toBe("电脑刚保存的版本"));
  });

  test("submits one stop command and locks the conversation control while it is in flight", async () => {
    let release!: () => void;
    const sendCommand = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("cancel-command-1");
    }));
    render(<App client={client(runState(), { sendCommand })} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const conversationComposer = screen.getByRole("textbox", { name: "输入消息" }).closest("form");
    expect(conversationComposer).not.toBeNull();
    const stop = within(conversationComposer!).getByRole("button", { name: "停止运行" });
    fireEvent.click(stop);
    fireEvent.click(stop);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith({ kind: "run.cancel", runId: "run-1" });
    expect(screen.getByRole("button", { name: "正在停止" }).hasAttribute("disabled")).toBe(true);
    await act(async () => release());
  });

  test("projects an active run lifecycle once without fabricating assistant content", () => {
    const current = runState();
    const running = {
      ...current,
      vaultError: "知识库同步暂时失败",
      conversationPages: {
        "conversation-1": {
          kind: "conversation.page",
          eventId: "running-page",
          conversationId: "conversation-1",
          turns: [{
            turnId: "running-user",
            runId: "run-1",
            role: "user",
            content: "继续优化正文区",
            status: "completed",
            createdAt: "2026-08-04T00:00:00.000Z",
            updatedAt: "2026-08-04T00:00:00.000Z",
          }, {
            turnId: "running-assistant",
            runId: "run-1",
            role: "assistant",
            content: "",
            status: "running",
            createdAt: "2026-08-04T00:00:00.000Z",
            updatedAt: "2026-08-04T00:00:00.000Z",
          }],
          hasMore: false,
        },
      },
    } as MobileRemoteState;
    render(<App client={client(running)} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    expect(screen.getAllByText("正在处理")).toHaveLength(1);
    expect(screen.queryByText("没有返回内容")).toBeNull();
    expect(screen.queryByText("知识库同步暂时失败")).toBeNull();
    openProfile();
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.queryByText("知识库同步暂时失败")).toBeNull();
  });

  test("uses the approval object as the only awaiting-approval projection", () => {
    render(<App client={client(approvalState())} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    expect(screen.getByText("运行移动端定向测试")).toBeTruthy();
    expect(screen.getByText(/需留意.*测试进程会读取当前工作树/u)).toBeTruthy();
    expect(screen.queryByText("等待确认")).toBeNull();
    expect(screen.queryByText("待确认")).toBeNull();
  });

  test("does not present a cancelled assistant turn as still thinking", () => {
    const current = state();
    const cancelled: MobileRemoteState = {
      ...current,
      conversations: current.conversations.map((conversation) => ({ ...conversation, status: "cancelled" as const })),
      conversationPages: {
        "conversation-1": {
          kind: "conversation.page",
          eventId: "cancelled-page",
          conversationId: "conversation-1",
          turns: [{
            turnId: "cancelled-user",
            runId: "cancelled-run",
            role: "user",
            content: "停止这个任务",
            status: "completed",
            createdAt: "2026-08-04T00:00:00.000Z",
            updatedAt: "2026-08-04T00:00:00.000Z",
          }, {
            turnId: "cancelled-assistant",
            runId: "cancelled-run",
            role: "assistant",
            content: "",
            status: "cancelled",
            createdAt: "2026-08-04T00:00:00.000Z",
            updatedAt: "2026-08-04T00:00:00.000Z",
          }],
          hasMore: false,
        },
      },
      runs: [],
    };
    render(<App client={client(cancelled)} />);

    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    expect(screen.getByText("已停止")).toBeTruthy();
    expect(screen.queryByText("正在思考…")).toBeNull();
    expect(screen.queryByText("没有返回内容")).toBeNull();
  });

  test("disables stopping while the desktop is offline and hides it after completion", () => {
    render(<App client={client(runState({ peerOnline: false }))} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const offlineComposer = screen.getByRole("textbox", { name: "输入消息" }).closest("form");
    expect(offlineComposer).not.toBeNull();
    expect(offlineComposer!.querySelector(".aa-mobile-composer-meta")).toBeNull();
    expect(screen.getByRole("status", { name: "电脑离线" }).textContent).toBe("电脑离线");
    expect(within(offlineComposer!).queryByText(/离线|恢复后发送/u)).toBeNull();
    expect(within(offlineComposer!).getByRole("button", { name: /选择模型/u })).toBeTruthy();
    expect(within(offlineComposer!).getByRole("button", { name: "停止运行" }).hasAttribute("disabled")).toBe(true);

    cleanup();
    render(<App client={client(runState({ status: "completed" }))} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    expect(screen.queryByRole("button", { name: "停止运行" })).toBeNull();
  });

  test("keeps the reading position stable while live output arrives", async () => {
    let current = runState();
    const listeners = new Set<() => void>();
    const liveClient = client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    render(<App client={liveClient} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const transcript = document.querySelector<HTMLElement>(".aa-mobile-transcript")!;
    expect(transcript.getAttribute("role")).toBe("log");
    expect(transcript.getAttribute("aria-label")).toBe("对话内容");
    expect(transcript.getAttribute("aria-relevant")).toBe("additions text");
    expect(transcript.getAttribute("aria-live")).toBe("off");
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 500 },
    });
    transcript.scrollTop = 200;
    fireEvent.scroll(transcript);

    current = {
      ...current,
      runs: current.runs.map((run) => ({ ...run, eventId: "run-event-status-only" })),
    };
    await act(async () => listeners.forEach((listener) => listener()));
    expect(screen.queryByRole("button", { name: "查看新内容" })).toBeNull();

    current = {
      ...current,
      runs: current.runs.map((run) => ({ ...run, visibleAssistantText: "电脑端刚刚产生的新内容" })),
    };
    await act(async () => listeners.forEach((listener) => listener()));

    expect(transcript.scrollTop).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "查看新内容" }));
    expect(transcript.scrollTop).toBe(1_200);
    expect(screen.queryByRole("button", { name: "查看新内容" })).toBeNull();
  });

  test("preserves the reading anchor when older conversation turns are prepended", async () => {
    let height = 1_000;
    let current = {
      ...state(),
      conversationPages: {
        "conversation-1": {
          kind: "conversation.page",
          eventId: "latest-page",
          conversationId: "conversation-1",
          turns: [conversationTurn("turn-2"), conversationTurn("turn-3")],
          hasMore: true,
          nextBeforeTurnId: "turn-2",
        },
      },
    } as MobileRemoteState;
    const listeners = new Set<() => void>();
    const requestConversationPage = vi.fn(async (_conversationId: string, beforeTurnId?: string) => {
      if (beforeTurnId === "turn-2") {
        current = {
          ...current,
          conversationPages: {
            "conversation-1": {
              kind: "conversation.page",
              eventId: "older-page",
              conversationId: "conversation-1",
              beforeTurnId,
              turns: [conversationTurn("turn-1"), conversationTurn("turn-2"), conversationTurn("turn-3")],
              hasMore: false,
            },
          },
        } as MobileRemoteState;
        height = 1_400;
        listeners.forEach((listener) => listener());
      }
      return "page-command";
    });
    render(<App client={client(current, {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      requestConversationPage,
    })} />);
    openSpace("产品空间");
    fireEvent.click(screen.getByRole("button", { name: /移动端结构调整/u }));
    const transcript = document.querySelector<HTMLElement>(".aa-mobile-transcript")!;
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 500 },
    });
    transcript.scrollTop = 200;

    fireEvent.click(screen.getByRole("button", { name: "更早内容" }));

    await waitFor(() => expect(transcript.scrollTop).toBe(600));
    expect(screen.getByText("turn-1")).toBeTruthy();
  });
});

function conversationTurn(turnId: string) {
  return {
    turnId,
    runId: `run-${turnId}`,
    role: "assistant" as const,
    content: turnId,
    status: "completed" as const,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

function client(
  value: MobileRemoteState,
  overrides: Partial<RemoteMobileClient> = {},
): RemoteMobileClient {
  return {
    snapshot: () => value,
    subscribe: () => () => undefined,
    start: vi.fn(async () => undefined),
    release: vi.fn(),
    requestConversationPage: vi.fn(async () => undefined),
    sendCommand: vi.fn(async () => "command-1"),
    submitVaultMutation: vi.fn(async () => "mutation-1"),
    resolveVaultConflict: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as RemoteMobileClient;
}

function approvalState(): MobileRemoteState {
  return {
    ...state(),
    conversationPages: {
      "conversation-1": {
        kind: "conversation.page",
        eventId: "page-1",
        conversationId: "conversation-1",
        turns: [],
        hasMore: false,
      },
    },
    conversations: [{
      ...state().conversations[0],
      status: "awaiting_approval",
    }],
    runs: [{
      kind: "run.snapshot",
      eventId: "run-event-1",
      runId: "run-1",
      conversationId: "conversation-1",
      status: "awaiting_approval",
      pendingConfirmations: [{
        confirmationId: "confirmation-1",
        title: "执行本地命令",
        actionSummary: "运行移动端定向测试",
        consequence: "测试进程会读取当前工作树。",
        affectedResources: ["Z:/AgentArbor-worktrees/remote-collaboration"],
        riskLevel: "medium",
        requestedAt: "2026-08-04T00:00:00.000Z",
      }],
      updatedAt: "2026-08-04T00:00:00.000Z",
    }],
  } as MobileRemoteState;
}

function runState(options: {
  readonly peerOnline?: boolean;
  readonly status?: "running" | "queued" | "awaiting_approval" | "completed";
} = {}): MobileRemoteState {
  const current = approvalState();
  const status = options.status ?? "running";
  return {
    ...current,
    peerOnline: options.peerOnline ?? true,
    conversations: current.conversations.map((conversation) => ({ ...conversation, status })),
    runs: current.runs.map((run) => ({
      ...run,
      status,
      pendingConfirmations: [],
    })),
  } as MobileRemoteState;
}

function state(): MobileRemoteState {
  return {
    connection: "connected",
    peerOnline: true,
    binding: {
      relayUrl: "https://configured-at-build.invalid",
      accountId: "account-1",
      accountHandle: "feng",
      displayName: "feng",
      deviceId: "mobile-1",
      peerDeviceId: "desktop-1",
      peerDeviceName: "feng 的电脑",
    },
    conversations: [{
      conversationId: "conversation-1",
      title: "移动端结构调整",
      updatedAt: "2026-08-04T00:00:00.000Z",
      status: "running",
      activeRunId: "run-1",
      spaceId: "space-1",
    }],
    conversationPages: {},
    runs: [],
    vaultResources: [
      resource("space", "space-1", {
        title: "产品空间",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      }),
      resource("personal_note", "note-1", {
        spaceId: "space-1",
        title: "移动端方向",
        bodyMarkdown: "保持移动端与桌面端一致。",
        materialRefs: [],
        createdAt: 1,
        updatedAt: 1,
        sourceRevision: 1,
      }),
    ],
    vaultCursor: 2,
    vaultConflicts: [],
    pendingCommandIds: [],
    pendingConversations: [],
    commandResults: [],
  } as unknown as MobileRemoteState;
}

function resource(kind: "space" | "personal_note" | "workbench_asset" | "managed_root" | "managed_file", resourceId: string, payload: Readonly<Record<string, unknown>>) {
  return {
    kind,
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1 as const,
    payload,
    contentHash: `sha256:${"a".repeat(64)}`,
    contentBytes: 64,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "desktop-1",
  };
}
