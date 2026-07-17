import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { AssistantMessage } from "./chat-transcript-chain";

test("assistant message renders one live indicator across multiple open activity segments", () => {
  const first = activityItem("tool-1", "README.md");
  const second = activityItem("tool-2", "package.json");
  const workflow: NonNullable<React.ComponentProps<typeof AssistantMessage>["workflow"]> = {
    hasTimeline: true,
    awaitingFirstVisibleOutput: false,
    showCopyActions: false,
    copyText: "",
    segments: [activitySegment("segment-1", first), activitySegment("segment-2", second)],
  };

  render(<AssistantMessage workflow={workflow} showModelUsage={false} />);

  expect(document.querySelectorAll(".agent-live-work-status")).toHaveLength(1);
  expect(document.querySelectorAll(".agent-live-work-status .typing-dots > span")).toHaveLength(3);
});

test("assistant pending state uses dots without visible status copy", () => {
  render(<AssistantMessage showModelUsage={false} />);

  const status = screen.getByRole("status", { name: "正在处理" });
  expect(status.querySelectorAll(".typing-dots > span")).toHaveLength(3);
  expect(screen.queryByText("正在处理")).toBeNull();
  expect(screen.queryByText("思考中")).toBeNull();
});

function activitySegment(key: string, item: ActivityItem) {
  return {
    kind: "activity" as const,
    segmentKey: key,
    lifecycle: "open" as const,
    collapsed: false,
    collapseReason: "active_or_pending" as const,
    timeline: {
      nodes: [],
      items: [item],
      confirmation: {},
      hasContent: true,
    },
  };
}

function activityItem(key: string, subject: string): ActivityItem {
  return {
    nodeId: key,
    key,
    copy: { label: "读取", detail: subject },
    tone: "tool",
    phase: "executing",
    toolKind: "read",
    lead: { action: "读取", subject, monospace: true },
  };
}
