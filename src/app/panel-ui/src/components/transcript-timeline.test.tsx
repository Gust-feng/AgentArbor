import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { AgentWorkTimeline } from "./transcript-timeline";

test("tool activity keeps mechanical labels and raw commands out of the default layer", () => {
  const item: ActivityItem = {
    nodeId: "node-1",
    key: "tool-1",
    copy: { label: "命令", detail: "命令已执行" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
    expandedSections: [{ title: "执行信息", content: "命令：pnpm test", format: "list" }],
  };

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items: [item],
        confirmation: {},
        hasContent: true,
      }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  expect(screen.getByText("命令已执行")).toBeTruthy();
  expect(screen.queryByText("命令")).toBeNull();
  const rawCommand = screen.getByText("命令：pnpm test");
  const disclosure = rawCommand.closest("details");
  expect(disclosure?.open).toBe(false);

  fireEvent.click(screen.getByText("命令已执行").closest("summary")!);
  expect(disclosure?.open).toBe(true);
});

test("collapsed activity uses one readable summary instead of metric icons", () => {
  const items: ActivityItem[] = ["tool-1", "tool-2"].map((key, index) => ({
    nodeId: `node-${index + 1}`,
    key,
    copy: { label: "命令", detail: "命令已执行" },
    tone: "tool",
    phase: "completed",
    toolKind: "command",
  }));

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items,
        confirmation: {},
        hasContent: true,
      }}
      collapsed
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const summaryText = screen.getByText("已运行 2 条命令");
  const summary = summaryText.closest("summary");
  expect(summary?.firstElementChild?.classList.contains("agent-workline-summary-chevron")).toBe(true);
  expect(summary?.querySelector(".agent-workline-summary-metrics")).toBeNull();
});

test("expandable tool rows keep the disclosure affordance beside the action", () => {
  const item: ActivityItem = {
    nodeId: "node-read",
    key: "tool-read",
    copy: { label: "查看", detail: "当前目录" },
    tone: "tool",
    phase: "completed",
    toolKind: "read",
    expandedSections: [{ title: "条目", content: "README.md", format: "path_list" }],
  };

  render(
    <AgentWorkTimeline
      view={{
        nodes: [],
        items: [item],
        confirmation: {},
        hasContent: true,
      }}
      lifecycle="settled"
      confirmationBusy={false}
    />,
  );

  const line = screen.getByText("当前目录").closest("summary");
  const children = Array.from(line?.children ?? []);
  expect(children[0]?.classList.contains("agent-activity-chevron")).toBe(true);
  expect(children[1]?.classList.contains("agent-activity-line-prefix")).toBe(true);
  expect(children[2]?.classList.contains("agent-activity-body")).toBe(true);
  expect(line?.textContent).toBe("查看当前目录");
});
