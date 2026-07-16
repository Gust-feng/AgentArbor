import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { ActivityEvidencePanel } from "./activity-evidence";

test("activity evidence renders structured sources as links with context", () => {
  render(<ActivityEvidencePanel item={item({
    title: "命中结果",
    content: "Official guide · developers.openai.com",
    format: "source_list",
    items: [{
      title: "Official guide",
      detail: "Tool calling reference",
      href: "https://developers.openai.com/",
      meta: [{ value: "developers.openai.com" }],
    }],
  })} />);

  expect(screen.getByRole("link", { name: "Official guide" }).getAttribute("href"))
    .toBe("https://developers.openai.com/");
  expect(screen.getByText("Tool calling reference")).toBeTruthy();
  expect(screen.getByText("developers.openai.com")).toBeTruthy();
});

test("activity evidence keeps file locations scannable without parsing display text", () => {
  render(<ActivityEvidencePanel item={item({
    title: "命中",
    content: "src/index.ts:4 - needle",
    format: "path_list",
    items: [{ title: "src/index.ts:4", detail: "needle", monospace: true }],
  })} />);

  expect(screen.getByText("src/index.ts:4").getAttribute("data-monospace")).toBe("true");
  expect(screen.getByText("needle")).toBeTruthy();
});

function item(section: NonNullable<ActivityItem["expandedSections"]>[number]): ActivityItem {
  return {
    nodeId: "node-1",
    key: "item-1",
    copy: { label: "搜索", detail: "AgentArbor" },
    tone: "tool",
    phase: "completed",
    toolKind: "search",
    expandedSections: [section],
  };
}
