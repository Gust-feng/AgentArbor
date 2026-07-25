import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { WorklineProjectedTurn } from "../../../panel-read-model/assistant/panel-assistant-workline";
import type { ConversationTurn } from "../contracts/conversation";
import type { BasicAgentRun, TranscriptNode } from "../contracts/run";
import { ChatTranscriptDisplay } from "./chat-transcript-display";

const assistantLabelRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("./assistant-message-label", () => ({
  AssistantMessageLabel: () => {
    assistantLabelRenders.count += 1;
    return null;
  },
}));

test("same-conversation terminal projection matches a cold projection when durable reasoning replaces live narration", () => {
  const reasoning = "先分析用户目标，再核对当前实现的状态所有权。";
  const runningTurns = conversationTurns("running", "");
  const settledTurns = conversationTurns("completed", "最终回答。 ");
  const runningProps = displayProps({
    turns: runningTurns,
    run: run("running"),
    nodes: [node({
      nodeId: "side-live",
      sequence: 1,
      eventType: "model.side.completed",
      kind: "system",
      text: reasoning,
      modelCallId: "model-side",
    })],
  });
  const settledProps = displayProps({
    turns: settledTurns,
    run: run("completed"),
    nodes: [
      node({
        nodeId: "reasoning-durable",
        sequence: 1,
        eventType: "model.reasoning.completed",
        kind: "thinking",
        text: reasoning,
        modelCallId: "model-reasoning",
      }),
      node({
        nodeId: "body-durable",
        sequence: 2,
        eventType: "model.output.completed",
        kind: "body",
        text: "最终回答。",
        modelCallId: "model-reasoning",
      }),
    ],
  });

  const hot = render(<ChatTranscriptDisplay {...runningProps} />);
  hot.rerender(<ChatTranscriptDisplay {...settledProps} />);

  expect(screen.getAllByText(reasoning).length).toBeGreaterThan(0);
  const hotHtml = normalizedTranscriptHtml(hot.container.innerHTML);

  hot.unmount();
  const cold = render(<ChatTranscriptDisplay {...settledProps} />);

  expect(normalizedTranscriptHtml(cold.container.innerHTML)).toBe(hotHtml);
});

test("current-run streaming updates do not rerender unchanged historical assistant messages", () => {
  assistantLabelRenders.count = 0;
  const turns: readonly ConversationTurn[] = [
    { turnId: "user-1", role: "user", content: "第一问", status: "completed" },
    { turnId: "assistant-1", role: "assistant", content: "历史回答。", status: "completed", runId: "run-1" },
    { turnId: "user-2", role: "user", content: "继续", status: "completed" },
    { turnId: "assistant-2", role: "assistant", content: "", status: "running", runId: "run-2" },
  ];
  const projectedTurns = turns.map((turn): WorklineProjectedTurn<ConversationTurn> => ({
    turn,
    displayRunId: turn.runId,
    claimedCurrentRun: false,
  }));
  const props = {
    conversationId: "conversation-render-stability",
    projectedTurns,
    turns,
    currentRunId: "run-2",
    run: run("running", "run-2"),
    showModelUsage: false,
    models: [],
    selectedModelId: "",
    onDecision: () => undefined,
    confirmationBusy: false,
  };
  const rendered = render(
    <ChatTranscriptDisplay
      {...props}
      currentRunNodes={[node({
        nodeId: "body-live",
        runId: "run-2",
        sequence: 1,
        eventType: "model.output.delta",
        kind: "body",
        text: "正在生成",
        modelCallId: "model-2",
      })]}
    />,
  );

  expect(assistantLabelRenders.count).toBe(2);
  rendered.rerender(
    <ChatTranscriptDisplay
      {...props}
      currentRunNodes={[node({
        nodeId: "body-live",
        runId: "run-2",
        sequence: 2,
        eventType: "model.output.delta",
        kind: "body",
        text: "正在生成最终内容",
        modelCallId: "model-2",
      })]}
    />,
  );

  expect(screen.getByText("历史回答。")).toBeTruthy();
  expect(screen.getByText("正在生成最终内容")).toBeTruthy();
  expect(assistantLabelRenders.count).toBe(3);
});

function normalizedTranscriptHtml(value: string): string {
  return value.replace(/id="_r_[^"]+"/g, 'id="react-id"');
}

function displayProps(input: {
  readonly turns: readonly ConversationTurn[];
  readonly run: BasicAgentRun;
  readonly nodes: readonly TranscriptNode[];
}) {
  return {
    conversationId: "conversation-canonical-transcript",
    projectedTurns: input.turns.map((turn): WorklineProjectedTurn<ConversationTurn> => ({
      turn,
      displayRunId: turn.role === "assistant" ? "run-1" : undefined,
      claimedCurrentRun: false,
    })),
    turns: input.turns,
    currentRunId: "run-1",
    currentRunNodes: input.nodes,
    run: input.run,
    showModelUsage: false,
    models: [],
    selectedModelId: "",
    onDecision: () => undefined,
    confirmationBusy: false,
  };
}

function conversationTurns(status: string, assistantContent: string): readonly ConversationTurn[] {
  return [
    {
      turnId: "user-1",
      role: "user",
      content: "检查当前逻辑",
      status: "completed",
    },
    {
      turnId: "assistant-1",
      role: "assistant",
      content: assistantContent,
      status,
      runId: "run-1",
    },
  ];
}

function run(status: BasicAgentRun["status"], runId = "run-1"): BasicAgentRun {
  return {
    runId,
    conversationId: "conversation-canonical-transcript",
    title: "检查当前逻辑",
    goalSummary: "检查当前逻辑",
    status,
    runMode: "agent",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:01.000Z",
    requiresUserAction: false,
    eventCursor: { lastSequence: 2, eventCount: 2 },
  };
}

function node(input: {
  readonly nodeId: string;
  readonly runId?: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: TranscriptNode["kind"];
  readonly text: string;
  readonly modelCallId: string;
}): TranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: input.runId ?? "run-1",
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: "completed",
    title: input.kind === "thinking" ? "思考" : "",
    summary: input.text,
    text: input.text,
    timestamp: "2026-07-26T00:00:01.000Z",
    refs: [{ kind: "model_call", id: input.modelCallId }],
  };
}
