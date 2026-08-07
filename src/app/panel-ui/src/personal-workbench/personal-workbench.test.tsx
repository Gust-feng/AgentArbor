import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { ChatInputProps } from "../contracts/composer";
import { PersonalWorkbench, type PersonalWorkbenchProps } from "./personal-workbench";
import { BrainPage } from "./workbench/app/components/BrainPage";
import {
  collectManagedSpaceReference,
  getPersonalKnowledgeError,
  getPersonalKnowledgeSnapshot,
  resetPersonalKnowledgeForTesting,
  setPersonalKnowledgePersistenceEnabled,
} from "./workbench/app/components/personalKnowledgeClient";
import { fetchDocumentPreview, getCachedReferencePreview } from "./workbench/app/components/referencePreviewClient";
import { resolvePage } from "./workbench/app/components/brainStore";

beforeEach(() => resetPersonalKnowledgeForTesting());

test("submits a real Ordinary task from the workbench home", async () => {
  const user = userEvent.setup();
  const onStartNewConversation = vi.fn(async () => true);
  const onContinueConversation = vi.fn();
  render(<ControlledWorkbench
    onStartNewConversation={onStartNewConversation}
    onContinueConversation={onContinueConversation}
  />);

  const composer = await screen.findByRole("textbox", undefined, { timeout: 5_000 });
  await user.type(composer, "整理当前设计改造");
  await user.keyboard("{Enter}");

  expect(onStartNewConversation).toHaveBeenCalledTimes(1);
  expect(onContinueConversation).not.toHaveBeenCalled();
  expect(await screen.findByRole("region", { name: "对话工作台" })).toBeTruthy();
}, 10_000);

test("keeps the home entry visible when a new conversation cannot start", async () => {
  const user = userEvent.setup();
  const onStartNewConversation = vi.fn(async () => false);
  render(<ControlledWorkbench
    onStartNewConversation={onStartNewConversation}
    onContinueConversation={vi.fn()}
  />);

  const composer = await screen.findByRole("textbox", undefined, { timeout: 5_000 });
  await user.type(composer, "稍后重试");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(onStartNewConversation).toHaveBeenCalledOnce());
  expect(screen.getByRole("main", { name: "个人首页" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "对话工作台" })).toBeNull();
}, 10_000);

test("continues the active conversation through the ordinary submit command", async () => {
  const user = userEvent.setup();
  const onContinueConversation = vi.fn();
  const onStartNewConversation = vi.fn(async () => true);
  render(<ControlledActiveConversationWorkbench
    onStartNewConversation={onStartNewConversation}
    onContinueConversation={onContinueConversation}
  />);

  const composer = await screen.findByPlaceholderText("继续对话...");
  await user.type(composer, "继续完善");
  await user.keyboard("{Enter}");

  expect(onContinueConversation).toHaveBeenCalledOnce();
  expect(onStartNewConversation).not.toHaveBeenCalled();
});

test("projects real Space references without substituting built-in initial assets", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [{
      spaceId: "space-reading",
      title: "阅读资料",
      itemCount: 1,
      items: [{
        itemId: "reference-material",
        title: "阅读摘要.md",
        kind: "local_file",
        detail: "C:/资料/阅读摘要.md",
      }],
    }],
  });

  await user.click(screen.getByRole("button", { name: "阅读资料" }));

  expect((await screen.findAllByText("阅读摘要.md")).length).toBeGreaterThan(0);
  expect(screen.queryByText("PyTorch 入门笔记.pdf")).toBeNull();
});

test("falls back to a valid Space item when the selected reference disappears from the authoritative projection", async () => {
  const user = userEvent.setup();
  const initialSpace = {
    spaceId: "space-study",
    title: "学习空间",
    items: [
      { itemId: "conversation-removed", title: "即将删除的对话", kind: "conversation_reference" as const, conversationId: "conversation-removed" },
      { itemId: "conversation-kept", title: "保留的对话", kind: "conversation_reference" as const, conversationId: "conversation-kept" },
    ],
  };
  const rendered = render(<PersonalWorkbench {...baseProps({ spaces: [initialSpace] })} />);
  await user.click(screen.getByRole("button", { name: "学习空间" }));
  const tree = await screen.findByRole("tree", { name: "学习空间资料" });
  await user.click(within(tree).getByText("即将删除的对话"));
  expect(screen.getAllByText("即将删除的对话").length).toBeGreaterThan(1);

  rendered.rerender(<PersonalWorkbench {...baseProps({
    spaces: [{ ...initialSpace, items: [initialSpace.items[1]!] }],
  })} />);

  await waitFor(() => {
    expect(within(screen.getByRole("tree", { name: "学习空间资料" })).queryByText("即将删除的对话")).toBeNull();
    expect(screen.getAllByText("保留的对话").length).toBeGreaterThan(1);
  });
});

test("renders initialized assets as ordinary persisted Space items", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [{
      spaceId: "space-learning",
      title: "学习空间",
      items: [
        { itemId: "f1", title: "2026年学习资料", kind: "folder", children: [{ itemId: "f1-1", title: "PyTorch 入门笔记.pdf", kind: "workbench_asset", assetId: "f1-1", referenceId: "f1-1" }] },
        { itemId: "created-folder", title: "新建文件夹", kind: "managed_folder" },
      ],
    }],
  });

  await user.click(screen.getByRole("button", { name: "学习空间" }));
  const tree = await screen.findByRole("tree", { name: "学习空间资料" });
  const realItem = within(tree).getByText("新建文件夹");
  expect(realItem).toBeTruthy();
  expect(within(tree).getByText("2026年学习资料")).toBeTruthy();
  expect(within(tree).getByText("PyTorch 入门笔记.pdf")).toBeTruthy();
});

test("collects a Workbench asset by asset identity without copying its Space reference", async () => {
  const user = userEvent.setup();
  const commands: unknown[] = [];
  const fetchMock = vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    const url = String(path);
    if (url === "/api/personal-knowledge") return jsonResponse({ snapshot: emptyKnowledgeSnapshot() });
    if (url === "/api/spaces/references/space-asset/preview") {
      return jsonResponse({ preview: {
        itemId: "space-asset",
        title: "训练脚本.py",
        sourceKind: "workbench_asset",
        source: "workbench-asset:asset-code",
        status: "ready",
        fingerprint: "asset:asset-code",
        presentation: { kind: "code", editable: false, sourceMode: false },
        content: { kind: "text", text: "print('train')", truncated: false, editable: false, language: "python" },
      } });
    }
    if (url === "/api/personal-knowledge/commands") {
      commands.push(JSON.parse(String(init?.body)) as unknown);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkbench({
    personalKnowledgePersistenceEnabled: true,
    spaces: [{
      spaceId: "space-learning",
      title: "学习空间",
      items: [{ itemId: "space-asset", title: "训练脚本.py", kind: "workbench_asset", assetId: "asset-code", referenceId: "space-asset", openable: true }],
    }],
  });

  await user.click(screen.getByRole("button", { name: "学习空间" }));
  await user.click((await screen.findAllByText("训练脚本.py"))[0]);
  await user.click(await screen.findByRole("button", { name: "收藏" }));

  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({ type: "knowledge.collect", page: { refId: "asset-code", kind: "material" } });
  expect(fetchMock.mock.calls.some(([path]) => String(path) === "/api/personal-knowledge/collect-space-reference")).toBe(false);
});

test("renders persisted original knowledge materials without rewriting their presentation", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: {
        ...emptyKnowledgeSnapshot(),
        pages: [{ refId: "m-attn-pdf", kind: "material", collectedAt: Date.UTC(2026, 6, 29, 10, 0) }],
      }, materialPreviews: [{ itemId: "m-attn-pdf", title: "Attention Is All You Need.pdf", sourceKind: "workbench_asset", source: "workbench-asset:m-attn-pdf", status: "ready", fingerprint: "asset:m-attn-pdf", presentation: { kind: "pdf", editable: false, sourceMode: false }, content: { kind: "pages", pages: ["Attention Is All You Need"] } }] });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkbench({ personalKnowledgePersistenceEnabled: true });

  await user.click(screen.getByRole("button", { name: "知识库" }));

  expect(await screen.findByText("Attention Is All You Need.pdf")).toBeTruthy();
  expect(screen.queryByText("知识库还空着。")).toBeNull();
  expect(fetchMock.mock.calls.filter(([path]) => String(path) === "/api/personal-knowledge")).not.toHaveLength(0);
  expect(fetchMock.mock.calls.some(([path]) => String(path) === "/api/workbench-assets/m-attn-pdf/preview")).toBe(false);
});

test("refreshes Personal Knowledge when entering a knowledge surface", async () => {
  const user = userEvent.setup();
  let serverNotes: unknown[] = [];
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: { ...emptyKnowledgeSnapshot(), notes: serverNotes } });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  const rendered = renderWorkbench({ personalKnowledgePersistenceEnabled: true });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/personal-knowledge", expect.anything()));

  serverNotes = [{
    id: "agent-note",
    spaceId: "space-study",
    title: "Agent 新笔记",
    bodyMarkdown: "由 Agent 写入",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }];
  await user.click(screen.getByRole("button", { name: "学习空间" }));

  expect(await screen.findByText("Agent 新笔记")).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([path]) => String(path) === "/api/personal-knowledge")).toHaveLength(2);
  rendered.unmount();
});

test("prewarms managed knowledge assets before the user opens their cards", async () => {
  const assetPath = "/api/personal-knowledge/assets/asset-one/preview";
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: {
        ...emptyKnowledgeSnapshot(),
        pages: [{
          refId: "asset-one",
          kind: "space_reference",
          collectedAt: 1,
          asset: {
            status: "managed",
            title: "托管笔记.md",
            sourceLabel: "C:/source/托管笔记.md",
            contentKind: "file",
            sourceReferenceId: "source-one",
            sourceRelativePath: "托管笔记.md",
          },
        }],
      } });
    }
    if (String(path) === assetPath) {
      return jsonResponse({ preview: {
        itemId: "asset-one",
        title: "托管笔记.md",
        sourceKind: "local_file",
        source: "managed/asset-one/content",
        status: "ready",
        fingerprint: "managed-one",
        presentation: { kind: "markdown", editable: false, sourceMode: false },
        content: { kind: "text", text: "# 已预热", truncated: false, editable: false, language: "md" },
      } });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderWorkbench({ personalKnowledgePersistenceEnabled: true });

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(assetPath, expect.anything()));
});

test("updates a visible knowledge card when its managed preview finishes", async () => {
  const page = {
    refId: "asset-card-live",
    kind: "space_reference" as const,
    collectedAt: 1,
    asset: {
      status: "managed" as const,
      title: "托管笔记.md",
      sourceLabel: "C:/source/托管笔记.md",
      contentKind: "file" as const,
      sourceReferenceId: "source-live",
      sourceRelativePath: "托管笔记.md",
    },
  };
  let finishPreview: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async () => await new Promise<Response>((resolve) => { finishPreview = resolve; })));
  resetPersonalKnowledgeForTesting({ pages: [page] });
  const rendered = render(<BrainPage selectedId={null} onSelect={() => undefined} />);
  expect(screen.getByText("托管笔记.md")).toBeTruthy();

  const previewRequest = fetchDocumentPreview("asset-card-live", "", undefined, "/api/personal-knowledge/assets");
  await waitFor(() => expect(finishPreview).toBeTypeOf("function"));
  finishPreview?.(jsonResponse({ preview: {
    itemId: "asset-card-live",
    title: "托管笔记.md",
    sourceKind: "local_file",
    source: "managed/asset-card-live/content",
    status: "ready",
    fingerprint: "managed-live",
    presentation: { kind: "markdown", editable: false, sourceMode: false },
    content: { kind: "text", text: "# 已预热", truncated: false, editable: false, language: "md" },
  } }));
  await expect(previewRequest).resolves.toBeTruthy();
  expect(await screen.findByText("已预热")).toBeTruthy();
  rendered.unmount();
});

test("updates a visible Workbench asset card when its preview finishes", async () => {
  const page = { refId: "workbench-card-live", kind: "material" as const, collectedAt: 1 };
  let finishPreview: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async () => await new Promise<Response>((resolve) => { finishPreview = resolve; })));
  resetPersonalKnowledgeForTesting({ pages: [page] });
  const rendered = render(<BrainPage selectedId={null} onSelect={() => undefined} />);
  expect(screen.getByText("(材料加载中)")).toBeTruthy();

  const previewRequest = fetchDocumentPreview("workbench-card-live", "", undefined, "/api/workbench-assets");
  await waitFor(() => expect(finishPreview).toBeTypeOf("function"));
  finishPreview?.(jsonResponse({ preview: {
    itemId: "workbench-card-live",
    title: "训练脚本.py",
    sourceKind: "workbench_asset",
    source: "workbench-asset:workbench-card-live",
    status: "ready",
    fingerprint: "asset:workbench-card-live",
    presentation: { kind: "code", editable: false, sourceMode: false },
    content: { kind: "text", text: "print('train')", truncated: false, editable: false, language: "python" },
  } }));
  await expect(previewRequest).resolves.toBeTruthy();
  expect(await screen.findByText("训练脚本.py")).toBeTruthy();
  expect(screen.queryByText("(材料加载中)")).toBeNull();
  rendered.unmount();
});

test("shows a Workbench asset preview failure instead of an endless loading label", async () => {
  const page = { refId: "workbench-card-failed", kind: "material" as const, collectedAt: 1 };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: "预览暂不可用" }),
    text: async () => "预览暂不可用",
  }) as Response));
  resetPersonalKnowledgeForTesting({ pages: [page] });
  const rendered = render(<BrainPage selectedId={null} onSelect={() => undefined} />);
  const request = fetchDocumentPreview(page.refId, '', undefined, '/api/workbench-assets');
  await expect(request).rejects.toThrow();
  expect(await screen.findByText("材料暂不可用")).toBeTruthy();
  expect(screen.queryByText("(材料加载中)")).toBeNull();
  rendered.unmount();
});

test("keeps a managed asset when its non-blocking preview warm-up fails", async () => {
  const page = {
    refId: "asset-preview-unavailable",
    kind: "space_reference" as const,
    collectedAt: 1,
    asset: {
      status: "managed" as const,
      title: "Readme.md",
      sourceLabel: "E:/workspace/Readme.md",
      contentKind: "file" as const,
      sourceReferenceId: "source-readme",
      sourceRelativePath: "Readme.md",
    },
  };
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge/collect-space-reference") return jsonResponse({ page });
    if (String(path) === "/api/personal-knowledge/assets/asset-preview-unavailable/preview") {
      return { ok: false, status: 503, json: async () => ({ message: "预览暂不可用" }) } as Response;
    }
    return jsonResponse({ snapshot: emptyKnowledgeSnapshot() });
  });
  vi.stubGlobal("fetch", fetchMock);
  setPersonalKnowledgePersistenceEnabled(true);

  collectManagedSpaceReference("source-readme", "Readme.md");

  await waitFor(() => expect(getPersonalKnowledgeSnapshot().pages).toEqual([page]));
  expect(getPersonalKnowledgeError()).toBeUndefined();
});

test("shows a managed asset before its preview cache has finished warming", async () => {
  const page = {
    refId: "asset-preview-pending",
    kind: "space_reference" as const,
    collectedAt: 1,
    asset: {
      status: "managed" as const,
      title: "Readme.md",
      sourceLabel: "E:/workspace/Readme.md",
      contentKind: "file" as const,
      sourceReferenceId: "source-readme",
      sourceRelativePath: "Readme.md",
    },
  };
  let finishPreview: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge/collect-space-reference") return jsonResponse({ page });
    if (String(path) === "/api/personal-knowledge/assets/asset-preview-pending/preview") {
      return await new Promise<Response>((resolve) => { finishPreview = resolve; });
    }
    return jsonResponse({ snapshot: emptyKnowledgeSnapshot() });
  });
  vi.stubGlobal("fetch", fetchMock);
  setPersonalKnowledgePersistenceEnabled(true);

  collectManagedSpaceReference("source-readme", "Readme.md");

  await waitFor(() => expect(getPersonalKnowledgeSnapshot().pages).toEqual([page]));
  finishPreview?.(jsonResponse({ preview: {
    itemId: page.refId,
    title: page.asset.title,
    sourceKind: "local_file",
    source: "managed/asset-preview-pending/content",
    status: "ready",
    presentation: { kind: "markdown", editable: false, sourceMode: false },
    content: { kind: "text", text: "# 已预热", truncated: false, editable: false, language: "md" },
  } }));
  await waitFor(() => expect(getCachedReferencePreview(page.refId, "", "/api/personal-knowledge/assets")?.content).toMatchObject({ kind: "text", text: "# 已预热" }));
});

test("projects a managed Markdown asset as a Markdown card with its real summary", async () => {
  const user = userEvent.setup();
  const assetPath = "/api/personal-knowledge/assets/asset-card-markdown/preview";
  const sourcePath = "E:/从记事本开始/Readme.md";
  const markdown = "# 我的知识库\n\n这一段真实 Markdown 正文应当显示在知识库卡片中。";
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: {
        ...emptyKnowledgeSnapshot(),
        pages: [{
          refId: "asset-card-markdown",
          kind: "space_reference",
          collectedAt: 1,
          asset: {
            status: "managed",
            title: "Readme.md",
            sourceLabel: sourcePath,
            contentKind: "file",
            sourceReferenceId: "source-readme",
            sourceRelativePath: "Readme.md",
          },
        }],
      } });
    }
    if (String(path) === assetPath) {
      return jsonResponse({ preview: {
        itemId: "asset-card-markdown",
        title: "Readme.md",
        sourceKind: "local_file",
        source: "managed/asset-card-markdown/content",
        status: "ready",
        fingerprint: "managed-markdown",
        presentation: { kind: "markdown", editable: false, sourceMode: false },
        content: { kind: "text", text: markdown, truncated: false, editable: false, language: "md" },
      } });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkbench({ personalKnowledgePersistenceEnabled: true, spaces: [] });

  await user.click(screen.getByRole("button", { name: "知识库" }));

  expect(await screen.findByText("Readme.md")).toBeTruthy();
  expect(screen.getByText("Markdown")).toBeTruthy();
  expect(screen.getByText(/这一段真实 Markdown 正文应当显示在知识库卡片中/u)).toBeTruthy();
  expect(screen.queryByText(sourcePath)).toBeNull();
});

test("switches the projected material tree with the active Space", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [
      { spaceId: "space-a", title: "空间甲", items: [{ itemId: "ref-a", title: "甲资料.md", kind: "local_file" }] },
      { spaceId: "space-b", title: "空间乙", items: [{ itemId: "ref-b", title: "乙资料.pdf", kind: "local_file" }] },
    ],
  });

  await user.click(screen.getByRole("button", { name: "空间甲" }));
  expect((await screen.findAllByText("甲资料.md")).length).toBeGreaterThan(0);
  expect(screen.queryByText("乙资料.pdf")).toBeNull();

  await user.click(screen.getByRole("button", { name: "空间乙" }));
  expect((await screen.findAllByText("乙资料.pdf")).length).toBeGreaterThan(0);
  expect(screen.queryByText("甲资料.md")).toBeNull();
});

test("starts inline naming only after the created Space returns in the real projection", async () => {
  const user = userEvent.setup();

  function StatefulSpaces() {
    const [spaces, setSpaces] = useState<NonNullable<PersonalWorkbenchProps["spaces"]>>([
      { spaceId: "space-existing", title: "已有空间", items: [] },
    ]);
    return <PersonalWorkbench {...baseProps({
      spaces,
      onCreateSpace: async (title) => {
        setSpaces((current) => [...current, { spaceId: "space-created", title, items: [] }]);
      },
    })} />;
  }

  render(<StatefulSpaces />);
  await user.click(screen.getByRole("button", { name: "新建空间" }));

  const input = await screen.findByDisplayValue("新空间");
  expect(input).toBe(document.activeElement);
  expect((input as HTMLInputElement).selectionStart).toBe(0);
  expect((input as HTMLInputElement).selectionEnd).toBe("新空间".length);
});

test("shows Space projection failures in the workbench sidebar and retries them", async () => {
  const user = userEvent.setup();
  const onRetry = vi.fn().mockResolvedValue(undefined);
  renderWorkbench({
    spaces: [],
    spaceLoadState: {
      loading: false,
      error: "Space API unavailable",
      onRetry,
    },
  });

  expect(screen.getByRole("alert").getAttribute("title")).toBe("Space API unavailable");
  await user.click(screen.getByRole("button", { name: "重新加载空间" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("keeps bootstrap failures inside the personal workbench and retries in place", async () => {
  const onRetry = vi.fn();
  renderWorkbench({
    bootstrapState: {
      status: "error",
      error: "工作台启动数据加载失败。",
      onRetry,
    },
  });

  expect((await screen.findByRole("alert")).textContent).toContain("工作台启动数据加载失败。");
  fireEvent.click(screen.getByRole("button", { name: "重新加载工作台数据" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("新任务")).toBeNull();
});

test("renders the Home surface directly while bootstrap data is pending", () => {
  const { container } = renderWorkbench({
    bootstrapState: {
      status: "loading",
      onRetry: vi.fn(),
    },
  });

  expect(screen.queryByRole("status", { name: "正在准备工作台" })).toBeNull();
  expect(container.querySelector(".workbench-bootstrap-loading__progress")).toBeNull();
  expect(screen.getByPlaceholderText("想从哪里开始？")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "知识库" }));
  expect(screen.getByRole("status", { name: "正在准备工作台" })).toBeTruthy();
});

test("keeps folder expansion isolated per Space when switching projections", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [
      {
        spaceId: "space-memory-a",
        title: "记忆空间甲",
        items: [{
          itemId: "folder-memory-a",
          title: "甲文件夹",
          kind: "folder",
          children: [{ itemId: "reference-memory-a", title: "甲材料.md", kind: "local_file" }],
        }],
      },
      {
        spaceId: "space-memory-b",
        title: "记忆空间乙",
        items: [{
          itemId: "folder-memory-b",
          title: "乙文件夹",
          kind: "folder",
          children: [{ itemId: "reference-memory-b", title: "乙材料.md", kind: "local_file" }],
        }],
      },
    ],
  });

  await user.click(screen.getByRole("button", { name: "记忆空间甲" }));
  const treeA = await screen.findByRole("tree", { name: "记忆空间甲资料" });
  expect(within(treeA).getByText("甲材料.md")).toBeTruthy();
  await user.click(within(treeA).getByText("甲文件夹"));
  expect(within(treeA).queryByText("甲材料.md")).toBeNull();

  await user.click(screen.getByRole("button", { name: "记忆空间乙" }));
  const treeB = await screen.findByRole("tree", { name: "记忆空间乙资料" });
  expect(within(treeB).getByText("乙材料.md")).toBeTruthy();
  await user.click(within(treeB).getByText("乙文件夹"));
  expect(within(treeB).queryByText("乙材料.md")).toBeNull();

  await user.click(screen.getByRole("button", { name: "记忆空间甲" }));
  expect(within(await screen.findByRole("tree", { name: "记忆空间甲资料" })).queryByText("甲材料.md")).toBeNull();
  expect(screen.queryByText("乙材料.md")).toBeNull();
});

test("prefetches nested local folder entries and keeps folders out of the preview pane", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/preview")) return jsonResponse({ preview: directoryPreview("", [{ name: "docs", relativePath: "docs", kind: "directory" }]) });
    if (url.includes("path=docs")) return jsonResponse({ preview: directoryPreview("docs", [{ name: "note.md", relativePath: "docs/note.md", kind: "file" }]) });
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkbench({
    spaces: [{ spaceId: "space-folder", title: "本地项目", itemCount: 1, items: [{ itemId: "folder-reference", title: "项目文件", kind: "workspace_folder", referenceId: "folder-reference" }] }],
  });

  await user.click(screen.getByRole("button", { name: "本地项目" }));
  const tree = await screen.findByRole("tree", { name: "本地项目资料" });
  expect(screen.getByText("1 个对象")).toBeTruthy();
  await user.click(within(tree).getByText("项目文件"));
  await user.click(await within(tree).findByText("docs"));

  expect(await within(tree).findByText("note.md")).toBeTruthy();
  expect(screen.getByText("1 个对象")).toBeTruthy();
  expect(screen.queryByText("返回上一级")).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("path=docs"), expect.anything());

  await user.click(screen.getByRole("button", { name: "首页" }));
  await user.click(screen.getByRole("button", { name: "本地项目" }));
  const restoredTree = await screen.findByRole("tree", { name: "本地项目资料" });
  expect(await within(restoredTree).findByText("note.md")).toBeTruthy();
  expect(screen.getByText("1 个对象")).toBeTruthy();
});

test("routes Space rename, unlink, and physical deletion through distinct actions", async () => {
  const user = userEvent.setup();
  const rename = vi.fn().mockResolvedValue(undefined);
  const unlinkReference = vi.fn().mockResolvedValue(undefined);
  const removeReference = vi.fn().mockResolvedValue(undefined);
  renderWorkbench({
    spaces: [{
      spaceId: "space-reading",
      title: "阅读资料",
      items: [
        { itemId: "reference-material", title: "阅读摘要.md", kind: "local_file" },
        { itemId: "workspace-reference", title: "项目目录", kind: "workspace_folder" },
        {
          itemId: "reference-group",
          title: "资料组",
          kind: "folder",
          children: [{ itemId: "nested-material", title: "原始材料.md", kind: "local_file" }],
        },
      ],
    }],
    spaceActions: { rename, unlinkReference, removeReference },
  });

  await user.click(screen.getByRole("button", { name: "阅读资料" }));
  await user.click(await screen.findByRole("button", { name: "阅读摘要.md操作" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const input = screen.getByDisplayValue("阅读摘要.md");
  await user.clear(input);
  await user.type(input, "阅读摘录.md{Enter}");
  expect(rename).toHaveBeenCalledWith({ kind: "reference", id: "reference-material" }, "阅读摘录.md");

  await user.click(screen.getByRole("button", { name: "阅读摘要.md操作" }));
  await user.click(screen.getByRole("button", { name: "移除引用" }));
  expect(unlinkReference).toHaveBeenCalledWith("reference-material");

  await user.click(screen.getByRole("button", { name: "阅读摘要.md操作" }));
  expect(screen.queryByRole("button", { name: "删除文件" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "项目目录操作" }));
  expect(screen.getByRole("button", { name: "移除引用" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "删除文件夹" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "移除引用" }));
  expect(unlinkReference).toHaveBeenCalledWith("workspace-reference");

  await user.click(screen.getByRole("button", { name: "资料组操作" }));
  await user.click(screen.getByRole("button", { name: "删除文件夹" }));
  expect(screen.getByRole("alertdialog", { name: "删除“资料组”及其所有子项" })).toBeTruthy();
  expect(removeReference).toHaveBeenCalledTimes(0);
  await user.click(screen.getByRole("button", { name: "删除文件夹" }));
  expect(removeReference).toHaveBeenCalledWith("reference-group");
});

test("deletes app-owned folders but keeps linked workspace folders read-only", async () => {
  const user = userEvent.setup();
  const removeReference = vi.fn().mockResolvedValue(undefined);
  const unlinkReference = vi.fn().mockResolvedValue(undefined);
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/references/managed-folder/entry")) {
      expect(JSON.parse(String(init.body))).toEqual({ parentRelativePath: "", name: "internal-note.md", kind: "file" });
      return jsonResponse({ entry: { relativePath: "internal-note.md" } });
    }
    if (url.includes("/references/managed-folder/preview?path=internal-note.md")) {
      return jsonResponse({ preview: {
        itemId: "managed-folder",
        title: "软件资料",
        sourceKind: "managed_folder",
        source: "C:/agentarbor/space-files/internal-note.md",
        status: "ready",
        presentation: { kind: "markdown", editable: true, sourceMode: true },
        content: { kind: "text", text: "", truncated: false, editable: true, language: "md" },
      } });
    }
    if (url.endsWith("/references/managed-folder/preview")) {
      return jsonResponse({ preview: {
        ...directoryPreview("", [{ name: "internal-note.md", relativePath: "internal-note.md", kind: "file" }]),
        itemId: "managed-folder",
        title: "软件资料",
        sourceKind: "managed_folder",
      } });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderWorkbench({
    spaces: [{
      spaceId: "space-files",
      title: "项目空间",
      items: [
        { itemId: "managed-folder", title: "软件资料", kind: "managed_folder", referenceId: "managed-folder" },
        { itemId: "folder-reference", title: "项目文件", kind: "workspace_folder", referenceId: "folder-reference" },
      ],
    }],
    spaceActions: { removeReference, unlinkReference },
  });

  await user.click(screen.getByRole("button", { name: "项目空间" }));
  // 外部 Workspace 是只读数据源：根项只能移除当前 Space 的引用。
  await user.click(await screen.findByRole("button", { name: "项目文件操作" }));
  expect(screen.queryByRole("button", { name: "新建文件" })).toBeNull();
  expect(screen.queryByRole("button", { name: "重命名" })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除文件夹" })).toBeNull();

  await user.click(await screen.findByRole("button", { name: "软件资料操作" }));
  await user.click(screen.getByRole("button", { name: "新建文件" }));
  await user.type(screen.getByRole("textbox", { name: "文件名称" }), "internal-note.md{Enter}");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/spaces/references/managed-folder/entry",
    expect.objectContaining({ method: "POST" }),
  ));

  await user.click(screen.getByRole("button", { name: "软件资料操作" }));
  await user.click(screen.getByRole("button", { name: "删除文件夹" }));
  expect(screen.getByRole("alertdialog", { name: "删除“软件资料”及其中的所有文件" })).toBeTruthy();
  expect(removeReference).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "删除文件夹" }));
  expect(removeReference).toHaveBeenCalledWith("managed-folder");

});

test("routes the workbench material add menu through Space actions", async () => {
  const user = userEvent.setup();
  const createManagedFolder = vi.fn().mockResolvedValue(undefined);
  const addLocalFile = vi.fn().mockResolvedValue(undefined);
  const addWorkspaceFolder = vi.fn().mockResolvedValue(undefined);
  renderWorkbench({
    conversation: { conversationId: "conversation-current", title: "当前对话", turns: [] },
    spaces: [{ spaceId: "space-reading", title: "阅读资料", items: [] }],
    spaceActions: { createManagedFolder, addLocalFile, addWorkspaceFolder },
  });

  await user.click(screen.getByRole("button", { name: "阅读资料" }));
  await user.click(await screen.findByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "新建文件夹" }));
  await user.type(screen.getByRole("textbox", { name: "文件夹名称" }), "研究资料{Enter}");
  expect(createManagedFolder).toHaveBeenCalledWith("space-reading", "研究资料");
  expect(createManagedFolder).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "添加本地文件" }));
  expect(addLocalFile).toHaveBeenCalledWith("space-reading");

  await user.click(screen.getByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "添加工作区文件夹" }));
  expect(addWorkspaceFolder).toHaveBeenCalledWith("space-reading");
  await user.click(screen.getByRole("button", { name: "添加资料" }));
  expect(screen.queryByRole("button", { name: "加入当前对话" })).toBeNull();
});

test("opens a Search result in the Space that owns the reference", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [
      { spaceId: "space-a", title: "空间甲", items: [{ itemId: "ref-a", title: "甲资料.md", kind: "local_file" }] },
      { spaceId: "space-b", title: "空间乙", items: [{ itemId: "ref-b", title: "乙资料.pdf", kind: "local_file" }] },
    ],
  });

  await user.keyboard("{Control>}k{/Control}");
  await user.click(await screen.findByRole("button", { name: /乙资料\.pdf/u }));

  const tree = await screen.findByRole("tree", { name: "空间乙资料" });
  expect(within(tree).getByText("乙资料.pdf")).toBeTruthy();
  expect(screen.queryByRole("tree", { name: "空间甲资料" })).toBeNull();
});

test("clears a Search target when the user switches to another Space", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ preview: {
    itemId: "ref-a",
    title: "甲资料.md",
    sourceKind: "local_file",
    source: "C:/甲资料.md",
    status: "ready",
    presentation: { kind: "markdown", editable: false, sourceMode: false },
    content: { kind: "text", text: "甲正文", truncated: false, editable: false, language: "md" },
  } })));
  renderWorkbench({
    spaces: [
      { spaceId: "space-a", title: "空间甲", items: [{ itemId: "ref-a", title: "甲资料.md", kind: "local_file" }] },
      { spaceId: "space-b", title: "空间乙", items: [{ itemId: "ref-b", title: "乙资料.pdf", kind: "local_file" }] },
    ],
  });

  await user.keyboard("{Control>}k{/Control}");
  await user.click(await screen.findByRole("button", { name: /乙资料\.pdf/u }));
  await user.click(screen.getByRole("button", { name: "空间甲" }));

  expect(await screen.findByText("甲正文")).toBeTruthy();
  expect(screen.queryByText("从左侧选择一篇笔记或材料")).toBeNull();
});

test("opens a real conversation directly from Search", async () => {
  const user = userEvent.setup();
  const onOpenConversation = vi.fn();
  renderWorkbench({
    conversations: [{ conversationId: "conversation-search", title: "搜索中的真实对话", preview: "真实预览" }],
    onOpenConversation,
  });

  await user.keyboard("{Control>}k{/Control}");
  await user.click((await screen.findByText("真实预览")).closest("button")!);
  expect(onOpenConversation).toHaveBeenCalledWith("conversation-search");
  expect(await screen.findByRole("region", { name: "对话工作台" })).toBeTruthy();
});

test("resolves a managed Brain asset without consulting the current Space projection", () => {
  expect(resolvePage(
    {
      refId: "reference-brain",
      kind: "space_reference",
      collectedAt: 1,
      asset: {
        status: "managed",
        title: "研究资料.pdf",
        sourceLabel: "C:/资料/研究资料.pdf",
        contentKind: "file",
        sourceReferenceId: "space-reference-one",
        sourceRelativePath: "研究资料.pdf",
      },
    },
   )).toMatchObject({
    refId: "reference-brain",
    kind: "space_reference",
    title: "研究资料.pdf",
    materialKind: "file",
    detail: "C:/资料/研究资料.pdf",
    exists: true,
  });
});

test("projects managed code content for the same knowledge card cover as initialized code", async () => {
  const page = {
    refId: "managed-python",
    kind: "space_reference" as const,
    collectedAt: 1,
    asset: {
      status: "managed" as const,
      title: "获取网页源码.py",
      sourceLabel: "C:/资料/获取网页源码.py",
      contentKind: "file" as const,
      sourceReferenceId: "source-python",
      sourceRelativePath: "获取网页源码.py",
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ preview: {
    itemId: page.refId,
    title: page.asset.title,
    sourceKind: "local_file",
    source: "managed/managed-python/content",
    status: "ready",
    fingerprint: "python-one",
    presentation: { kind: "code", editable: false, sourceMode: false },
    content: { kind: "text", text: "import requests\nrequests.get('https://example.com')", truncated: false, editable: false, language: "python", encoding: "UTF-8" },
  } })));

  await fetchDocumentPreview(page.refId, "", undefined, "/api/personal-knowledge/assets");

  expect(resolvePage(page)).toMatchObject({
    materialKind: "code",
    language: "python",
    previewText: "import requests\nrequests.get('https://example.com')",
  });
});

test("renders the files supplied by the real Space projection", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [{
      spaceId: "space-learning",
      title: "学习空间",
      items: [{
        itemId: "initial-materials",
        title: "学习资料",
        kind: "managed_folder",
        children: [
          { itemId: "readme", title: "README.md", kind: "local_file" },
          { itemId: "project", title: "project.json", kind: "local_file" },
          { itemId: "ignore", title: ".gitignore", kind: "local_file" },
          { itemId: "python", title: "gradient-descent.py", kind: "local_file" },
        ],
      }],
    }],
  });

  await user.click(screen.getByRole("button", { name: "学习空间" }));
  const tree = await screen.findByRole("tree", { name: "学习空间资料" });
  await user.click(within(tree).getByText("学习资料"));

  expect(within(tree).getByText("README.md")).toBeTruthy();
  expect(within(tree).getByText("project.json")).toBeTruthy();
  expect(within(tree).getByText(".gitignore")).toBeTruthy();
  expect(within(tree).getByText("gradient-descent.py")).toBeTruthy();
});

test("creates the first Space note directly without entering inline naming", async () => {
  const user = userEvent.setup();
  renderWorkbench();
  await user.click(screen.getByRole("button", { name: "学习空间" }));
  await user.click(await screen.findByRole("button", { name: "写下第一篇笔记" }));

  const row = document.querySelector<HTMLElement>("[data-note-row]");
  expect(row).not.toBeNull();
  expect(within(row!).getByText("写下第一篇笔记")).toBeTruthy();
  expect(within(row!).queryByRole("textbox")).toBeNull();
  expect(screen.getByDisplayValue("写下第一篇笔记")).toBeTruthy();
});

test("requires later Space notes to name inline and defaults an empty name to untitled", async () => {
  const user = userEvent.setup();
  resetPersonalKnowledgeForTesting({ notes: [{
    id: "note-first",
    spaceId: "space-study",
    title: "第一篇笔记",
    bodyMarkdown: "",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }] });
  renderWorkbench(undefined, false);
  await user.click(screen.getByRole("button", { name: "学习空间" }));
  await user.click(await screen.findByRole("button", { name: "新建笔记" }));

  const newRow = document.querySelector<HTMLElement>("[data-note-row]");
  expect(newRow).not.toBeNull();
  const namingInput = within(newRow!).getByRole("textbox");
  expect(namingInput.getAttribute("placeholder")).toBeNull();
  await user.click(namingInput);
  await user.keyboard("{Escape}");

  expect(within(newRow!).getByText("无标题")).toBeTruthy();
  expect(screen.getAllByText("第一篇笔记")).toHaveLength(1);
});

test("creates a second Space note from the store order without moving the existing selection first", async () => {
  const user = userEvent.setup();
  resetPersonalKnowledgeForTesting({ notes: [{
    id: "note-first",
    spaceId: "space-study",
    title: "第一篇笔记",
    bodyMarkdown: "",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }] });
  renderWorkbench(undefined, false);
  await user.click(screen.getByRole("button", { name: "学习空间" }));
  await user.click(await screen.findByRole("button", { name: "新建笔记" }));

  const newRow = document.querySelector<HTMLElement>("[data-note-row]");
  expect(newRow).not.toBeNull();
  expect(newRow?.className).not.toContain("transition-colors");
  const namingInput = within(newRow!).getByRole("textbox");
  expect(namingInput.getAttribute("placeholder")).toBeNull();
  expect(screen.getAllByText("第一篇笔记")).toHaveLength(1);

  await user.type(namingInput, "第二篇笔记");
  await user.keyboard("{Enter}");

  const rows = [...document.querySelectorAll<HTMLElement>("[data-note-row]")];
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("第二篇笔记"),
    expect.stringContaining("第一篇笔记"),
  ]);

  await user.click(screen.getByText("第一篇笔记"));
  expect(screen.getByDisplayValue("第一篇笔记")).toBeTruthy();
});

test("keeps a recovered running Ordinary run visible after startup", async () => {
  renderWorkbench({
    conversation: { conversationId: "conversation-running", title: "正在整理面板", turns: [] },
    currentRun: {
      events: [],
      transcriptNodes: [],
      run: {
        runId: "run-1",
        conversationId: "conversation-running",
        title: "正在整理面板",
        goalSummary: "整理面板",
        status: "running",
        runMode: "agent",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requiresUserAction: false,
        eventCursor: { lastSequence: 0, eventCount: 0 },
      },
    },
  });

  expect(await screen.findByText("处理中")).toBeTruthy();
  expect(await screen.findByRole("region", { name: "对话工作台" })).toBeTruthy();
});

test("keeps a failed conversation outside the complete Home empty state", async () => {
  render(<FailedConversationWorkbench />);

  const composer = await screen.findByPlaceholderText("想从哪里开始？");
  expect(composer).toBeTruthy();
  expect(screen.getByRole("main", { name: "个人首页" })).toBeTruthy();
  expect(screen.queryByText("失败的对话")).toBeNull();
});

test("starts from a clean home after a completed conversation was loaded", async () => {
  renderWorkbench({
    conversation: { conversationId: "conversation-completed", title: "已完成的对话", turns: [] },
    currentRun: {
      events: [],
      transcriptNodes: [{
        nodeId: "node-1",
        runId: "run-1",
        sequence: 1,
        eventType: "assistant.completed",
        kind: "answer",
        phase: "completed",
        title: "已完成回答",
        text: "历史内容",
        timestamp: new Date().toISOString(),
        refs: [],
      }],
      run: {
        runId: "run-1",
        conversationId: "conversation-completed",
        title: "已完成的对话",
        goalSummary: "已完成的对话",
        status: "completed",
        runMode: "agent",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requiresUserAction: false,
        eventCursor: { lastSequence: 1, eventCount: 1 },
      },
    },
  });

  expect(await screen.findByPlaceholderText("想从哪里开始？")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "对话工作台" })).toBeNull();
});

test("uses Home as the only non-destructive empty-state entry in the primary sidebar", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    inputProps: inputProps({ value: "尚未提交的想法" }),
  });

  expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "知识库" }));
  await user.click(screen.getByRole("button", { name: "首页" }));

  expect(screen.getByRole("main", { name: "个人首页" })).toBeTruthy();
  expect((screen.getByPlaceholderText("想从哪里开始？") as HTMLTextAreaElement).value).toBe("尚未提交的想法");
});

test("renders and opens backend conversation projections in pinned and updated order", async () => {
  const user = userEvent.setup();
  const onOpenConversation = vi.fn();
  renderWorkbench({
    conversations: [
      { conversationId: "older", title: "较早对话", updatedAt: "2026-07-20T00:00:00.000Z" },
      { conversationId: "pinned", title: "置顶对话", pinnedAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z" },
      { conversationId: "newer", title: "较新对话", updatedAt: "2026-07-28T00:00:00.000Z" },
    ],
    onOpenConversation,
  });

  const sidebar = within(screen.getByRole("complementary"));
  const pinned = sidebar.getByText("置顶对话");
  const newer = sidebar.getByText("较新对话");
  const older = sidebar.getByText("较早对话");
  expect(pinned.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

  await user.click(older);
  expect(onOpenConversation).toHaveBeenCalledWith("older");
});

test("keeps a long conversation history inside the workbench scroll section", () => {
  renderWorkbench({
    conversations: Array.from({ length: 12 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      title: `对话 ${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 6, 29, 0, 0, index)).toISOString(),
    })),
  });

  const scrollArea = document.querySelector<HTMLElement>("[data-conversation-scroll]");
  expect(scrollArea).not.toBeNull();
  expect(scrollArea?.style.maxHeight).toBe("170px");
  expect(scrollArea?.className).toContain("overflow-y-auto");
  expect(within(scrollArea!).getAllByText(/^对话 \d+$/u)).toHaveLength(12);
});

test("routes sidebar conversation pin actions to backend commands", async () => {
  const user = userEvent.setup();
  const onToggleConversationPinned = vi.fn();
  renderWorkbench({
    conversations: [{ conversationId: "conversation-1", title: "真实会话" }],
    onToggleConversationPinned,
  });

  fireEvent.mouseEnter(screen.getByRole("button", { name: "真实会话" }));
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("button", { name: "置顶" }));

  expect(onToggleConversationPinned).toHaveBeenCalledWith("conversation-1", true);
});

test("exposes model, context usage, and reasoning controls in the workbench composer", async () => {
  const user = userEvent.setup();
  const onModelSelect = vi.fn();
  const onReasoningEffortChange = vi.fn();
  renderWorkbench({
    conversation: { conversationId: "conversation-context", title: "上下文测试", turns: [] },
    currentRun: {
      events: [],
      transcriptNodes: [],
      run: {
        runId: "run-context",
        conversationId: "conversation-context",
        title: "上下文测试",
        goalSummary: "上下文测试",
        status: "running",
        runMode: "agent",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requiresUserAction: false,
        eventCursor: { lastSequence: 0, eventCount: 0 },
      },
    },
    inputProps: inputProps({
      models: [
        { id: "model-1", name: "Model 1", label: "模型一", providerLabel: "OpenAI", providerIdentity: "openai", profileId: "profile-1", modelId: "model-1" },
        { id: "model-2", name: "Model 2", label: "模型二", providerLabel: "OpenAI", providerIdentity: "openai", profileId: "profile-1", modelId: "model-2" },
      ],
      selectedModelId: "model-1",
      contextUsage: {
        source: "provider_usage",
        usedTokens: 85,
        maxTokens: 100,
        percent: 85,
        ringPercent: 85,
        tone: "warning",
        label: "上下文已用 85%",
      },
      reasoningEffort: "medium",
      reasoningEffortEnabled: true,
      onModelSelect,
      onReasoningEffortChange,
    }),
  });

  expect(await screen.findByRole("progressbar", { name: "上下文已用 85%" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "选择模型" }));
  await user.click(screen.getByRole("option", { name: /Model 2/u }));
  await user.selectOptions(screen.getByRole("combobox", { name: "推理力度" }), "high");

  expect(onModelSelect).toHaveBeenCalledWith("model-2");
  expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
});

function ControlledWorkbench(props: {
  readonly onStartNewConversation: () => Promise<boolean>;
  readonly onContinueConversation: () => void;
}) {
  const [value, setValue] = useState("");
  return <PersonalWorkbench {...baseProps({
    inputProps: inputProps({ value, onChange: setValue, onSubmit: props.onContinueConversation }),
    onStartNewConversation: props.onStartNewConversation,
  })} />;
}

function ControlledActiveConversationWorkbench(props: {
  readonly onStartNewConversation: () => Promise<boolean>;
  readonly onContinueConversation: () => void;
}) {
  const [value, setValue] = useState("");
  const timestamp = "2026-01-01T00:00:00.000Z";
  return <PersonalWorkbench {...baseProps({
    conversation: {
      conversationId: "conversation-active",
      title: "进行中的对话",
      turns: [],
    },
    currentRun: {
      events: [],
      transcriptNodes: [],
      run: {
        runId: "run-active",
        conversationId: "conversation-active",
        title: "进行中的对话",
        goalSummary: "继续完善",
        status: "running",
        runMode: "agent",
        createdAt: timestamp,
        updatedAt: timestamp,
        requiresUserAction: false,
        eventCursor: { lastSequence: 0, eventCount: 0 },
      },
    },
    inputProps: inputProps({ value, onChange: setValue, onSubmit: props.onContinueConversation }),
    onStartNewConversation: props.onStartNewConversation,
  })} />;
}

function FailedConversationWorkbench() {
  const now = new Date().toISOString();
  return <PersonalWorkbench {...baseProps({
    conversation: { conversationId: "conversation-failed", title: "失败的对话", turns: [] },
    currentRun: {
      events: [],
      transcriptNodes: [],
      run: {
        runId: "run-failed",
        conversationId: "conversation-failed",
        title: "失败的对话",
        goalSummary: "失败的对话",
        status: "failed",
        runMode: "agent",
        createdAt: now,
        updatedAt: now,
        requiresUserAction: false,
        eventCursor: { lastSequence: 0, eventCount: 0 },
      },
    },
  })} />;
}

function renderWorkbench(overrides: Partial<PersonalWorkbenchProps> = {}, reset = true) {
  if (reset) resetPersonalKnowledgeForTesting();
  return render(<PersonalWorkbench {...baseProps(overrides)} />);
}

function baseProps(overrides: Partial<PersonalWorkbenchProps> = {}): PersonalWorkbenchProps {
  return {
    bootstrapState: { status: "ready", onRetry: vi.fn() },
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    conversations: [],
    spaces: [{ spaceId: "space-study", title: "学习空间", color: "#a8c4b4", items: [] }],
    currentRun: { events: [], transcriptNodes: [] },
    inputProps: inputProps(),
    showModelUsage: false,
    developerModeEnabled: false,
    confirmationBusy: false,
    onDecision: vi.fn(),
    onStartNewConversation: vi.fn(async () => true),
    onOpenConversation: vi.fn(),
    onRenameConversation: vi.fn(),
    onToggleConversationPinned: vi.fn(),
    onDeleteConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onInstallAppUpdate: vi.fn(),
    ...overrides,
  };
}

function inputProps(overrides: Partial<ChatInputProps> = {}): ChatInputProps {
  return {
    value: "",
    onChange: vi.fn(),
    busy: false,
    models: [],
    selectedModelId: "",
    reasoningEffort: "",
    reasoningEffortEnabled: false,
    onReasoningEffortChange: vi.fn(),
    toolConfirmationPolicy: "prompt",
    onToolConfirmationPolicyChange: vi.fn(),
    onModelSelect: vi.fn(),
    onOpenSettings: vi.fn(),
    onSubmit: vi.fn(),
    attachments: [],
    onSelectAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function directoryPreview(relativePath: string, entries: readonly { name: string; relativePath: string; kind: "file" | "directory" | "other" }[]) {
  return {
    itemId: "folder-reference",
    title: "项目文件",
    sourceKind: "workspace_folder",
    source: `C:/project/${relativePath}`,
    status: "ready",
    fingerprint: "1:0",
    modifiedAt: 1,
    presentation: { kind: "directory", editable: false, sourceMode: false },
    content: { kind: "directory", relativePath, entries, truncated: false },
  };
}

function emptyKnowledgeSnapshot() {
  return {
    notes: [],
    pages: [],
    links: [],
    themes: [],
    assignments: [],
    recentlyOpened: {},
  };
}
