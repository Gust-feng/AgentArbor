import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { SubAgentDefinition } from "../contracts/sub-agents";
import { SubAgentSettings } from "./sub-agent-settings";

const subAgent: SubAgentDefinition = {
  id: "code-expert",
  name: "code-expert",
  description: "负责代码编写、重构与调试。",
  category: "development",
  sourceKind: "builtin",
  sourceRootId: "builtin",
  enabled: true,
  version: "1.0.0",
  whenToUse: ["需要修改大量代码时", "需要解决复杂编程问题时"],
  whenNotToUse: ["只需要调整文档措辞时"],
};

test("Sub Agent panel keeps details collapsed until requested", async () => {
  const user = userEvent.setup();
  render(<SubAgentSettings subAgents={[subAgent]} onRefresh={vi.fn()} />);

  expect(screen.getByText("1 个专家助手")).toBeTruthy();
  expect(screen.getByText("1 / 1 启用")).toBeTruthy();
  const panel = screen.getByText("code-expert").closest("details");
  expect(panel?.open).toBe(false);

  await user.click(screen.getByText("code-expert"));

  expect(panel?.open).toBe(true);
  expect(screen.getByText("适用场景")).toBeTruthy();
  expect(screen.getByText("需要修改大量代码时")).toBeTruthy();
  expect(screen.getByText("避免使用")).toBeTruthy();
  expect(screen.getByText("只需要调整文档措辞时")).toBeTruthy();
});

test("Sub Agent refresh remains available from the panel toolbar", async () => {
  const user = userEvent.setup();
  const onRefresh = vi.fn();
  render(<SubAgentSettings subAgents={[subAgent]} onRefresh={onRefresh} />);

  await user.click(screen.getByRole("button", { name: "刷新" }));

  expect(onRefresh).toHaveBeenCalledOnce();
});
