import React, { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ChatInputProps } from "../components/chat-empty";
import { PersonalWorkbench, type PersonalWorkbenchProps } from "./personal-workbench";

test("submits a real Ordinary task from the redesign home", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<ControlledWorkbench onSubmit={onSubmit} />);

  await user.type(screen.getByRole("textbox"), "整理当前设计改造");
  await user.keyboard("{Enter}");

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region", { name: "对话工作台" })).toBeTruthy();
});

test("keeps the prototype Space library instead of substituting host projections", async () => {
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

  await user.click(screen.getByRole("button", { name: "学习空间" }));

  expect(screen.getByText("PyTorch 入门笔记.pdf")).toBeTruthy();
  expect(screen.queryByText("阅读摘要.md")).toBeNull();
});

test("creates the first Space note directly without entering inline naming", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("aa.notes", "[]");

  try {
    renderWorkbench();
    await user.click(screen.getByRole("button", { name: "学习空间" }));
    await user.click(screen.getByRole("button", { name: "写下第一篇笔记" }));

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
    await user.click(screen.getByRole("button", { name: "新建笔记" }));

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
    await user.click(screen.getByRole("button", { name: "新建笔记" }));

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

test("keeps a recovered running Ordinary run visible after startup", () => {
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

  expect(screen.getByText("处理中")).toBeTruthy();
  expect(screen.getByRole("region", { name: "对话工作台" })).toBeTruthy();
});

function ControlledWorkbench(props: { readonly onSubmit: () => void }) {
  const [value, setValue] = useState("");
  return <PersonalWorkbench {...baseProps({
    inputProps: inputProps({ value, onChange: setValue, onSubmit: props.onSubmit }),
  })} />;
}

function renderWorkbench(overrides: Partial<PersonalWorkbenchProps> = {}) {
  return render(<PersonalWorkbench {...baseProps(overrides)} />);
}

function baseProps(overrides: Partial<PersonalWorkbenchProps> = {}): PersonalWorkbenchProps {
  return {
    isBootstrapping: false,
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    conversations: [],
    currentRun: { events: [], transcriptNodes: [] },
    inputProps: inputProps(),
    showModelUsage: false,
    confirmationBusy: false,
    onDecision: vi.fn(),
    onOpenConversation: vi.fn(),
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
