import React, { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { ChatInputProps } from "../components/chat-empty";
import { PersonalWorkbench, type PersonalWorkbenchProps } from "./personal-workbench";
import { resetPersonalKnowledgeForTesting } from "./redesign/app/components/personalKnowledgeClient";
import { resolvePage } from "./redesign/app/components/brainStore";

beforeEach(() => resetPersonalKnowledgeForTesting());

test("submits a real Ordinary task from the redesign home", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<ControlledWorkbench onSubmit={onSubmit} />);

  const composer = await screen.findByRole("textbox", undefined, { timeout: 5_000 });
  await user.type(composer, "整理当前设计改造");
  await user.keyboard("{Enter}");

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("region", { name: "对话工作台" })).toBeTruthy();
}, 10_000);

test("projects real Space references instead of substituting the demo library", async () => {
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

  expect(await screen.findByText("阅读摘要.md")).toBeTruthy();
  expect(screen.queryByText("PyTorch 入门笔记.pdf")).toBeNull();
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

test("switches the projected material tree with the active Space", async () => {
  const user = userEvent.setup();
  renderWorkbench({
    spaces: [
      { spaceId: "space-a", title: "空间甲", items: [{ itemId: "ref-a", title: "甲资料.md", kind: "local_file" }] },
      { spaceId: "space-b", title: "空间乙", items: [{ itemId: "ref-b", title: "乙资料.pdf", kind: "local_file" }] },
    ],
  });

  await user.click(screen.getByRole("button", { name: "空间甲" }));
  expect(await screen.findByText("甲资料.md")).toBeTruthy();
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

test("shows Space projection failures in the Redesign sidebar and retries them", async () => {
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

test("keeps bootstrap failures inside the Redesign workbench and retries in place", async () => {
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
  await user.click(within(await screen.findByRole("tree", { name: "记忆空间甲资料" })).getByText("甲文件夹"));
  expect(screen.getByText("甲材料.md")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "记忆空间乙" }));
  await user.click(within(await screen.findByRole("tree", { name: "记忆空间乙资料" })).getByText("乙文件夹"));
  expect(screen.getByText("乙材料.md")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "记忆空间甲" }));
  expect(await screen.findByText("甲材料.md")).toBeTruthy();
  expect(screen.queryByText("乙材料.md")).toBeNull();
});

test("routes real Space reference rename and removal through backend actions", async () => {
  const user = userEvent.setup();
  const rename = vi.fn().mockResolvedValue(undefined);
  const removeReference = vi.fn().mockResolvedValue(undefined);
  renderWorkbench({
    spaces: [{
      spaceId: "space-reading",
      title: "阅读资料",
      items: [{ itemId: "reference-material", title: "阅读摘要.md", kind: "local_file" }],
    }],
    spaceActions: { rename, removeReference },
  });

  await user.click(screen.getByRole("button", { name: "阅读资料" }));
  await user.click(await screen.findByRole("button", { name: "阅读摘要.md操作" }));
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const input = screen.getByDisplayValue("阅读摘要.md");
  await user.clear(input);
  await user.type(input, "阅读摘录.md{Enter}");
  expect(rename).toHaveBeenCalledWith({ kind: "reference", id: "reference-material" }, "阅读摘录.md");

  await user.click(screen.getByRole("button", { name: "阅读摘要.md操作" }));
  await user.click(screen.getByRole("button", { name: "移除" }));
  expect(removeReference).toHaveBeenCalledWith("reference-material");
});

test("routes the Redesign material add menu through Space actions", async () => {
  const user = userEvent.setup();
  const createFolder = vi.fn().mockResolvedValue(undefined);
  const addLocalFile = vi.fn().mockResolvedValue(undefined);
  const addWorkspaceFolder = vi.fn().mockResolvedValue(undefined);
  const addConversation = vi.fn().mockResolvedValue(undefined);
  renderWorkbench({
    conversation: { conversationId: "conversation-current", title: "当前对话", turns: [] },
    spaces: [{ spaceId: "space-reading", title: "阅读资料", items: [] }],
    spaceActions: { createFolder, addLocalFile, addWorkspaceFolder, addConversation },
  });

  await user.click(screen.getByRole("button", { name: "阅读资料" }));
  await user.click(await screen.findByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "新建文件夹" }));
  await user.type(screen.getByRole("textbox", { name: "文件夹名称" }), "研究资料{Enter}");
  expect(createFolder).toHaveBeenCalledWith("space-reading", "研究资料");

  await user.click(screen.getByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "添加本地文件" }));
  expect(addLocalFile).toHaveBeenCalledWith("space-reading");

  await user.click(screen.getByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "添加工作区文件夹" }));
  expect(addWorkspaceFolder).toHaveBeenCalledWith("space-reading");

  await user.click(screen.getByRole("button", { name: "添加资料" }));
  await user.click(screen.getByRole("button", { name: "加入当前对话" }));
  expect(addConversation).toHaveBeenCalledWith("space-reading", "conversation-current", "当前对话");
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

test("resolves a persisted Brain Space reference from the current Space projection", () => {
  expect(resolvePage(
    { refId: "reference-brain", kind: "space_reference", collectedAt: 1 },
    [{
      spaceId: "space-reading",
      title: "阅读资料",
      items: [{ itemId: "reference-brain", title: "研究资料.pdf", kind: "local_file", detail: "C:/资料/研究资料.pdf" }],
    }],
  )).toMatchObject({
    refId: "reference-brain",
    kind: "space_reference",
    title: "研究资料.pdf",
    spaceId: "space-reading",
    detail: "C:/资料/研究资料.pdf",
    exists: true,
  });
});

test("uses file-specific SVG icons for Space materials", async () => {
  const user = userEvent.setup();
  renderWorkbench();

  await user.click(screen.getByRole("button", { name: "学习空间" }));

  const tree = await screen.findByRole("tree", { name: "学习空间资料" });
  const imageRow = within(tree).getByText("神经网络结构图.png").parentElement;
  const videoRow = within(tree).getByText("梯度下降讲解.mp4").parentElement;
  const pdfRow = within(tree).getByText("PyTorch 入门笔记.pdf").parentElement;
  expect(imageRow?.querySelector(".lucide-file-image")).not.toBeNull();
  expect(videoRow?.querySelector(".lucide-file-video")).not.toBeNull();
  expect(pdfRow?.querySelector(".lucide-file-text")).not.toBeNull();
});

test("creates the first Space note directly without entering inline naming", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("aa.notes", "[]");

  try {
    renderWorkbench();
    await user.click(screen.getByRole("button", { name: "学习空间" }));
    await user.click(await screen.findByRole("button", { name: "写下第一篇笔记" }));

    const row = document.querySelector<HTMLElement>("[data-note-row]");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("写下第一篇笔记")).toBeTruthy();
    expect(within(row!).queryByRole("textbox")).toBeNull();
    expect(screen.getByDisplayValue("写下第一篇笔记")).toBeTruthy();
  } finally {
    window.localStorage.removeItem("aa.notes");
  }
});

test("requires later Space notes to name inline and defaults an empty name to untitled", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("aa.notes", JSON.stringify([{
    id: "note-first",
    title: "第一篇笔记",
    body: "",
    createdAt: 1,
    updatedAt: 1,
  }]));

  try {
    renderWorkbench();
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
  } finally {
    window.localStorage.removeItem("aa.notes");
  }
});

test("creates a second Space note from the store order without moving the existing selection first", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("aa.notes", JSON.stringify([{
    id: "note-first",
    title: "第一篇笔记",
    body: "",
    createdAt: 1,
    updatedAt: 1,
  }]));

  try {
    renderWorkbench();
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
  } finally {
    window.localStorage.removeItem("aa.notes");
  }
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

test("keeps a long conversation history inside the redesign scroll section", () => {
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

test("routes sidebar conversation actions to backend commands", async () => {
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

test("exposes model, context usage, and reasoning controls in the redesign composer", async () => {
  const user = userEvent.setup();
  const onModelSelect = vi.fn();
  const onReasoningEffortChange = vi.fn();
  renderWorkbench({
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

  await user.click(screen.getByRole("button", { name: "新对话" }));
  expect(await screen.findByRole("progressbar", { name: "上下文已用 85%" })).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "模型" }), "model-2");
  await user.selectOptions(screen.getByRole("combobox", { name: "推理力度" }), "high");

  expect(onModelSelect).toHaveBeenCalledWith("model-2");
  expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
});

function ControlledWorkbench(props: { readonly onSubmit: () => void }) {
  const [value, setValue] = useState("");
  return <PersonalWorkbench {...baseProps({
    inputProps: inputProps({ value, onChange: setValue, onSubmit: props.onSubmit }),
  })} />;
}

function renderWorkbench(overrides: Partial<PersonalWorkbenchProps> = {}) {
  resetPersonalKnowledgeForTesting();
  return render(<PersonalWorkbench {...baseProps(overrides)} />);
}

function baseProps(overrides: Partial<PersonalWorkbenchProps> = {}): PersonalWorkbenchProps {
  return {
    bootstrapState: { status: "ready", onRetry: vi.fn() },
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    conversations: [],
    spaces: [{ spaceId: "space-study", title: "学习空间", color: "#a8c4b4", demoDataset: "learning-workspace", items: [] }],
    currentRun: { events: [], transcriptNodes: [] },
    inputProps: inputProps(),
    showModelUsage: false,
    confirmationBusy: false,
    onDecision: vi.fn(),
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
    text: async () => JSON.stringify(body),
  } as Response;
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
