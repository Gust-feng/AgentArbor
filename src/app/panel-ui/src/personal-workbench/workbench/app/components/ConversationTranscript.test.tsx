import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { WorklineProjectedTurn } from "../../../../../../panel-read-model/assistant/panel-assistant-workline";
import type { ConversationTurn } from "../../../../contracts/conversation";
import type { TranscriptNode } from "../../../../contracts/run";
import { resetTranscriptCache } from "../../../../panel-ui-transcript-store";
import { ConfirmationCard } from "./ConfirmationCard";
import { ConversationTranscript } from "./ConversationTranscript";

beforeEach(() => resetTranscriptCache());

test("conversation transcript expands structured activity into its canonical tool result", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "运行检查",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-1"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[{
      callId: "provider-call-1",
      factId: "tool-fact-1",
      toolName: "Shell",
      input: { command: "pnpm test" },
      output: { stdout: "29 tests passed", stderr: "" },
      status: "completed",
      durationMs: 90,
    }]}
    showModelUsage={false}
    developerModeEnabled
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  fireEvent.click(screen.getByRole("button", { name: /运行 终端/ }));

  expect(screen.getByText("完整工具结果")).toBeTruthy();
  expect(screen.getAllByText(/29 tests passed/)).toHaveLength(2);
  expect(screen.getByText("tool-fact-1")).toBeTruthy();
});

test("conversation transcript keeps normal tool evidence while hiding the canonical result", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "运行检查",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-normal"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[{
      callId: "provider-call-1",
      factId: "tool-fact-1",
      toolName: "Shell",
      input: { command: "pnpm test" },
      output: { stdout: "29 tests passed", stderr: "" },
      status: "completed",
      durationMs: 90,
    }]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(screen.getByText("完成 1 项操作")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  fireEvent.click(screen.getByRole("button", { name: /运行 终端/ }));

  expect(screen.getByText("运行 终端")).toBeTruthy();
  expect(screen.getByText("pnpm test")).toBeTruthy();
  expect(screen.getByText("29 tests passed")).toBeTruthy();
  expect(screen.queryByText("完整工具结果")).toBeNull();
  expect(screen.queryByText("tool-fact-1")).toBeNull();
});

test("conversation transcript renders thinking separately from the tool workflow", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "读取 README",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const thinkingNode: TranscriptNode = {
    nodeId: "thinking-node-1",
    runId: "run-1",
    sequence: 1,
    eventType: "model.reasoning.completed",
    kind: "thinking",
    phase: "completed",
    title: "思考",
    text: "先确认用户意图，再读取文件。",
    summary: "先确认用户意图，再读取文件。",
    timestamp: "2026-07-31T00:00:00.000Z",
    refs: [{ kind: "model_call", id: "model-1" }],
  };
  const nodes = [thinkingNode, toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-thinking"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  // 思考拥有独立展示块；思考完成后默认收起，点击可展开。
  const toggle = screen.getByRole("button", { name: "展开思考" });
  expect(toggle).toBeTruthy();
  expect(screen.queryByText("先确认用户意图，再读取文件。")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("先确认用户意图，再读取文件。")).toBeTruthy();

  // 工具工作流只统计工具条目，思考不再计入“操作”。
  expect(screen.getByText("完成 1 项操作")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /完成 1 项操作/ }));
  const timeline = document.querySelector(".aa-activity-timeline");
  expect(timeline?.textContent).not.toContain("先确认用户意图");
  expect(timeline?.textContent).toContain("运行 终端");
});

test("conversation transcript keeps thinking open while the model is still reasoning", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "读取 README",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const thinkingNode: TranscriptNode = {
    nodeId: "thinking-node-live",
    runId: "run-1",
    sequence: 1,
    eventType: "model.reasoning.delta",
    kind: "thinking",
    phase: "noted",
    title: "思考",
    text: "正在分析目标…",
    summary: "正在分析目标…",
    timestamp: "2026-07-31T00:00:00.000Z",
    refs: [{ kind: "model_call", id: "model-1" }],
  };

  render(<ConversationTranscript
    conversationId="conversation-thinking-live"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={[thinkingNode]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "running",
      runProjection: { nodes: [thinkingNode] },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  // 思考进行中：块默认展开，推理内容直接可见。
  expect(screen.getByRole("button", { name: "收起思考" })).toBeTruthy();
  expect(screen.getByText("正在分析目标…")).toBeTruthy();
});

test("conversation transcript uses the shared markdown renderer without hover layout shifts", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "整理工具", status: "completed" },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: "| 工具 | 用途 |\n| --- | --- |\n| `Read` | 读取文件 |\n\n第一段   不应保留多余空格。",
      status: "completed",
    },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = turns.map((turn) => ({
    turn,
    claimedCurrentRun: false,
  }));

  render(<ConversationTranscript
    conversationId="conversation-markdown"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunNodes={[]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(document.querySelector(".rich-table")).not.toBeNull();
  const answer = document.querySelector(".aa-answer-block");
  expect(answer).not.toBeNull();
  expect(screen.getByRole("button", { name: "复制回答" })).toBeTruthy();
  const before = answer?.querySelectorAll(".aa-answer-copy").length;
  fireEvent.mouseEnter(answer!);
  expect(answer?.querySelectorAll(".aa-answer-copy").length).toBe(before);
});

test("conversation transcript renders one copy action for multiple assistant body segments", () => {
  const turns: readonly ConversationTurn[] = [{
    turnId: "user-1",
    role: "user",
    content: "继续",
    status: "completed",
  }];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [
    bodyNode("body-1", 1, "第一段回答。"),
    bodyNode("body-2", 2, "第二段回答。"),
  ];

  render(<ConversationTranscript
    conversationId="conversation-copy"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-copy"
    currentRunNodes={nodes}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-copy",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(screen.getAllByRole("button", { name: "复制回答" })).toHaveLength(1);
});

test("confirmation keeps approval and denial behavior without legacy transcript styling", () => {
  const onDecision = vi.fn();
  render(<ConfirmationCard
    confirmation={{
      confirmationId: "confirmation-1",
      title: "允许修改文件",
      question: "写入 README.md",
      consequence: "文件内容会更新",
      affectedResources: ["README.md"],
      riskLevel: "medium",
    }}
    busy={false}
    onDecision={onDecision}
  />);

  fireEvent.click(screen.getByRole("button", { name: "执行" }));
  fireEvent.click(screen.getByRole("button", { name: "不执行" }));

  expect(onDecision).toHaveBeenNthCalledWith(1, "approve_once");
  expect(onDecision).toHaveBeenNthCalledWith(2, "deny");
  expect(document.querySelector(".confirmation-node-body")).toBeNull();
});

test("conversation transcript shows the answering model logo and name from the turn", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "总结", status: "completed" },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: "总结如下。",
      status: "completed",
      responseModel: { profileId: "deepseek", label: "DeepSeek", model: "deepseek-chat" },
    },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = turns.map((turn) => ({
    turn,
    claimedCurrentRun: false,
  }));

  render(<ConversationTranscript
    conversationId="conversation-model-badge-turn"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunNodes={[]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    models={[modelOption({
      id: "matched-option",
      profileId: "deepseek",
      modelId: "deepseek-chat",
      name: "DeepSeek Chat",
      iconSvg: "<svg>deepseek-icon</svg>",
    })]}
    selectedModelId="other"
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  const badge = document.querySelector(".aa-model-badge");
  expect(badge).not.toBeNull();
  expect(badge?.querySelector(".aa-model-badge__icon")?.innerHTML).toContain("deepseek-icon");
  expect(badge?.querySelector(".aa-model-badge__name")?.textContent).toBe("DeepSeek Chat");
});

test("conversation transcript resolves model logo identity when the turn model is unknown to the catalog", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "总结", status: "completed" },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: "总结如下。",
      status: "completed",
      responseModel: { profileId: "deepseek", label: "DeepSeek", model: "deepseek-r1" },
    },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = turns.map((turn) => ({
    turn,
    claimedCurrentRun: false,
  }));

  render(<ConversationTranscript
    conversationId="conversation-model-badge-unmatched"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunNodes={[]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  const badge = document.querySelector(".aa-model-badge");
  expect(badge).not.toBeNull();
  expect(badge?.querySelector(".aa-model-badge__name")?.textContent).toBe("deepseek-r1");
  expect(badge?.querySelector(".aa-model-badge__icon svg")?.innerHTML.length).toBeGreaterThan(0);
});

test("conversation transcript hides the model badge for synthetic response models", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "总结", status: "completed" },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: "总结如下。",
      status: "completed",
      responseModel: { profileId: "fake", label: "演示", model: "fake" },
    },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = turns.map((turn) => ({
    turn,
    claimedCurrentRun: false,
  }));

  render(<ConversationTranscript
    conversationId="conversation-model-badge-synthetic"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunNodes={[]}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    models={[]}
    selectedModelId=""
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  expect(screen.queryByText("总结如下。")).toBeTruthy();
  expect(document.querySelector(".aa-model-badge")).toBeNull();
});

test("conversation transcript shows the composer model badge for the live standalone run", () => {
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "运行检查", status: "completed" },
  ];
  const projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[] = [{
    turn: turns[0]!,
    claimedCurrentRun: false,
  }];
  const nodes = [toolNode()];

  render(<ConversationTranscript
    conversationId="conversation-model-badge-standalone"
    projectedTurns={projectedTurns}
    turns={turns}
    currentRunId="run-1"
    currentRunNodes={nodes}
    currentRunToolResults={[]}
    showModelUsage={false}
    developerModeEnabled={false}
    standaloneRun={{
      currentRunId: "run-1",
      runStatus: "completed",
      runProjection: { nodes },
    }}
    models={[modelOption({
      id: "selected-option",
      profileId: "deepseek",
      modelId: "deepseek-chat",
      name: "DeepSeek Chat",
      iconSvg: "<svg>deepseek-icon</svg>",
    })]}
    selectedModelId="selected-option"
    onDecision={() => undefined}
    confirmationBusy={false}
  />);

  const badge = document.querySelector(".aa-model-badge");
  expect(badge).not.toBeNull();
  expect(badge?.querySelector(".aa-model-badge__icon")?.innerHTML).toContain("deepseek-icon");
  expect(badge?.querySelector(".aa-model-badge__name")?.textContent).toBe("DeepSeek Chat");
});

function toolNode(): TranscriptNode {
  return {
    nodeId: "tool-node-1",
    runId: "run-1",
    sequence: 1,
    eventType: "tool.completed",
    kind: "tool",
    phase: "completed",
    title: "Shell",
    toolName: "Shell",
    timestamp: "2026-07-31T00:00:00.000Z",
    display: {
      kind: "command_summary",
      command: "pnpm test",
      exitCode: 0,
      stdoutPreview: "29 tests passed",
    },
    refs: [{ kind: "tool_call", id: "tool-fact-1" }],
  };
}

function bodyNode(nodeId: string, sequence: number, text: string): TranscriptNode {
  return {
    nodeId,
    runId: "run-copy",
    sequence,
    eventType: "model.output.completed",
    kind: "body",
    phase: "completed",
    title: "回答",
    text,
    timestamp: "2026-07-31T00:00:00.000Z",
    refs: [{ kind: "model_call", id: `model-${nodeId}` }],
  };
}

function modelOption(input: {
  readonly id: string;
  readonly profileId: string;
  readonly modelId: string;
  readonly name: string;
  readonly iconSvg?: string;
}) {
  return {
    id: input.id,
    name: input.name,
    label: "DeepSeek",
    providerLabel: "DeepSeek",
    providerIdentity: "deepseek" as const,
    profileId: input.profileId,
    modelId: input.modelId,
    iconSvg: input.iconSvg,
  };
}
