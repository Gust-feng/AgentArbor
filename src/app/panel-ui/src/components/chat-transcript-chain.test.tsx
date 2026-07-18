import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ActivityItem } from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { AssistantMessage, TranscriptChain } from "./chat-transcript-chain";

test("pending user messages stay static while assistant owns the waiting indicator", () => {
  render(
    <TranscriptChain
      items={[{
        kind: "user",
        key: "user-turn",
        turn: {
          turnId: "user-turn",
          role: "user",
          content: "现在这是什么问题",
          status: "pending",
        },
      }]}
      models={[]}
      selectedModelId=""
      showModelUsage={false}
      onDecision={() => undefined}
      confirmationBusy={false}
    />,
  );

  const userMessage = screen.getByText("现在这是什么问题").closest(".user-message");
  expect(userMessage?.hasAttribute("data-entering")).toBe(false);
  expect(screen.queryByRole("status", { name: "等待当前回复完成" })).toBeNull();
  expect(document.querySelector(".user-message-queued")).toBeNull();
});

test("assistant activity removes the prefatory dots once model work is visible", () => {
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

  expect(document.querySelectorAll(".agent-live-work-status")).toHaveLength(0);
  expect(document.querySelectorAll(".typing-dots > span")).toHaveLength(0);
});

test("assistant pending state uses dots without visible status copy", () => {
  render(<AssistantMessage showModelUsage={false} />);

  const status = screen.getByRole("status", { name: "正在处理" });
  expect(status.querySelectorAll(".typing-dots > span")).toHaveLength(3);
  expect(screen.queryByText("正在处理")).toBeNull();
  expect(screen.queryByText("思考中")).toBeNull();
});

test("assistant workflow keeps dots when it contains only the pre-output waiting segment", () => {
  const workflow: NonNullable<React.ComponentProps<typeof AssistantMessage>["workflow"]> = {
    hasTimeline: true,
    awaitingFirstVisibleOutput: true,
    showCopyActions: false,
    copyText: "",
    segments: [{ kind: "awaiting", lifecycle: "open", reason: "initial" }],
  };

  render(<AssistantMessage workflow={workflow} showModelUsage={false} />);

  const status = screen.getByRole("status", { name: "正在处理" });
  expect(status.querySelectorAll(".typing-dots > span")).toHaveLength(3);
});

test("assistant confirmation replaces prefatory dots and remains actionable", () => {
  const onDecision = vi.fn();
  const workflow: NonNullable<React.ComponentProps<typeof AssistantMessage>["workflow"]> = {
    hasTimeline: true,
    awaitingFirstVisibleOutput: false,
    showCopyActions: false,
    copyText: "",
    segments: [{
      kind: "activity",
      segmentKey: "confirmation-1",
      lifecycle: "attention",
      collapsed: false,
      collapseReason: "needs_attention",
      timeline: {
        nodes: [],
        items: [],
        confirmation: {
          current: {
            confirmationId: "confirmation-1",
            title: "需要你的确认",
            question: "是否执行？",
            consequence: "将运行当前操作",
            riskLevel: "medium",
          },
        },
        hasContent: true,
      },
    }],
  };

  render(
    <AssistantMessage
      workflow={workflow}
      showModelUsage={false}
      onDecision={onDecision}
    />,
  );

  expect(document.querySelectorAll(".typing-dots > span")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "执行" }));
  expect(onDecision).toHaveBeenCalledWith("approve_once");
});

test("streaming assistant output settles without remounting or replaying entry motion", () => {
  const workflow: NonNullable<React.ComponentProps<typeof AssistantMessage>["workflow"]> = {
    hasTimeline: false,
    awaitingFirstVisibleOutput: false,
    showCopyActions: false,
    copyText: "正在输出",
    segments: [{
      kind: "body",
      segmentKey: "body-live",
      lifecycle: "open",
      text: "正在输出",
      copyText: "正在输出",
      live: true,
      animateOnMount: true,
      tone: "formal",
    }],
  };
  const { rerender } = render(
    <AssistantMessage
      workflow={workflow}
      live
      animateOnMount
      showModelUsage={false}
    />,
  );

  expect(document.querySelector(".assistant-message")?.hasAttribute("data-entering")).toBe(false);
  expect(document.querySelector(".rich-text .rich-text")).toBeNull();
  const liveRichText = document.querySelector(".live-stream-box > .rich-text");
  expect(liveRichText).not.toBeNull();

  const settledWorkflow: typeof workflow = {
    ...workflow,
    segments: workflow.segments.map((segment) => segment.kind === "body"
      ? { ...segment, lifecycle: "settled", live: false }
      : segment),
  };
  rerender(
    <AssistantMessage
      workflow={settledWorkflow}
      animateOnMount
      showModelUsage={false}
    />,
  );
  expect(document.querySelector(".assistant-message")?.hasAttribute("data-entering")).toBe(false);
  expect(document.querySelector(".live-stream-box > .rich-text")).toBe(liveRichText);
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
    eventType: "tool.requested",
    copy: { label: "读取", detail: subject },
    tone: "tool",
    phase: "executing",
    toolKind: "read",
    lead: { action: "读取", subject, monospace: true },
  };
}
