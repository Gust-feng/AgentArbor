import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ChatEmpty, type ChatInputProps } from "./chat-empty";

beforeEach(() => {
  window.localStorage.removeItem("agentarbor.panel.notice.ordinary-run-v3");
});

test("empty workbench places the first-task composer in the reading flow", () => {
  render(<ChatEmpty {...inputProps()} />);

  const main = document.querySelector(".chat-empty-main");
  expect(main?.querySelector(".chat-empty-composer .chat-input-card")).not.toBeNull();
  expect(document.querySelector(".chat-empty-screen > .chat-input-floating")).toBeNull();
  expect(screen.getByPlaceholderText("输入任务...")).toBeTruthy();
});

test("data compatibility notice can be dismissed for the next empty state", async () => {
  const user = userEvent.setup();
  const first = render(<ChatEmpty {...inputProps()} />);

  expect(screen.getByRole("note", { name: "数据更新说明" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "关闭数据更新说明" }));
  expect(screen.queryByRole("note", { name: "数据更新说明" })).toBeNull();
  first.unmount();

  render(<ChatEmpty {...inputProps()} />);
  expect(screen.queryByRole("note", { name: "数据更新说明" })).toBeNull();
});

function inputProps(): ChatInputProps {
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
  };
}
