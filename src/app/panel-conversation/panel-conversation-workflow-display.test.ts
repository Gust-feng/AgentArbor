import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationWorkflowDisplayState,
  projectConversationWorkflowDisplay,
  projectStandaloneAssistantWorkflowDisplay,
} from "./panel-conversation-workflow-display.js";
import type { WorklineProjectedTurn } from "../panel-read-model/assistant/panel-assistant-workline.js";

test("conversation workflow display restores late reasoning before the rendered body", () => {
  const initialState = createConversationWorkflowDisplayState<
    ReturnType<typeof turn>,
    ReturnType<typeof transcriptNode>,
    { readonly title: string; readonly summary: string; readonly sections: readonly [] },
    never
  >();
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
  ];

  const first = projectConversationWorkflowDisplay({
    previous: initialState,
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 2,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
      ],
    },
    currentRunNodes: [],
  });

  const second = projectConversationWorkflowDisplay({
    previous: first.state,
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {},
    currentRunNodes: [
      transcriptNode({
        nodeId: "thinking-1",
        runId: "run-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        text: "先分析目标",
      }),
      transcriptNode({
        nodeId: "body-1",
        runId: "run-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        text: "第一段正文。",
      }),
    ],
  });

  const display = second.assistantDisplays.get("assistant-1");
  assert.ok(display !== undefined);
  assert.deepEqual(display.workflow?.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.deepEqual(
    display.workflow?.segments
      .filter((segment) => segment.kind === "activity")
      .flatMap((segment) => segment.timeline.items.map((item) => item.nodeId)),
    ["thinking-1"],
  );
});

test("conversation workflow display resets continuity when the conversation changes", () => {
  const previous = projectConversationWorkflowDisplay({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns: [projected({ ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" }, "run-1")],
    turns: [{ ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" }],
    cachedNodesByRunId: {
      "run-1": [transcriptNode({ nodeId: "body-1", runId: "run-1", sequence: 1, kind: "body", eventType: "model.output.completed", text: "旧会话正文" })],
    },
    currentRunNodes: [],
  });

  const next = projectConversationWorkflowDisplay({
    previous: previous.state,
    conversationId: "conversation-2",
    projectedTurns: [],
    turns: [],
    cachedNodesByRunId: {},
    currentRunNodes: [],
  });

  assert.deepEqual([...next.state.transcriptNodesByRunId.keys()], []);
});

test("standalone assistant workflow display restores late reasoning before the stable body", () => {
  const previousState = createConversationWorkflowDisplayState<
    ReturnType<typeof turn>,
    ReturnType<typeof transcriptNode>,
    { readonly title: string; readonly summary: string; readonly sections: readonly [] },
    never
  >();
  const first = projectStandaloneAssistantWorkflowDisplay({
    previous: previousState,
    conversationId: "conversation-1",
    key: "conversation-1:run-1",
    content: "好的！让我来展示一下我的各项能力。",
    collapseTimeline: false,
  });
  const second = projectStandaloneAssistantWorkflowDisplay({
    previous: {
      ...previousState,
      conversationId: "conversation-1",
      standaloneAssistant: first.nextStandalone,
    },
    conversationId: "conversation-1",
    key: "conversation-1:run-1",
    content: "好的！让我来展示一下我的各项能力。",
    transcriptNodes: [
      transcriptNode({
        nodeId: "thinking-1",
        runId: "run-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        text: "先分析目标",
      }),
      transcriptNode({
        nodeId: "body-1",
        runId: "run-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        text: "好的！让我来展示一下我的各项能力。",
      }),
    ],
    collapseTimeline: false,
  });

  assert.deepEqual(second.workflow.segments.map((segment) => segment.kind), ["activity", "body"]);
});

test("conversation workflow display reprojects earlier turns without changing their semantic output", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
    turn("user-2", "user", "然后继续", "completed"),
    { ...turn("assistant-2", "assistant", "第二段正文。", "running"), runId: "run-2" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
    projected(turns[2]!),
    projected(turns[3]!, "run-2"),
  ];
  const first = projectConversationWorkflowDisplay({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
      ],
      "run-2": [
        transcriptNode({
          nodeId: "body-2",
          runId: "run-2",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第二段正文。",
        }),
      ],
    },
    currentRunId: "run-2",
    currentRunNodes: [],
  });

  const previousAssistantOne = first.assistantDisplays.get("assistant-1");
  const second = projectConversationWorkflowDisplay({
    previous: first.state,
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
      ],
    },
    currentRunId: "run-2",
    currentRunNodes: [
      transcriptNode({
        nodeId: "thinking-2",
        runId: "run-2",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        text: "先分析第二轮。",
      }),
      transcriptNode({
        nodeId: "body-2",
        runId: "run-2",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        text: "第二段正文。",
      }),
    ],
  });

  const nextAssistantOne = second.assistantDisplays.get("assistant-1");
  const nextAssistantTwo = second.assistantDisplays.get("assistant-2");

  assert.deepEqual(nextAssistantOne, previousAssistantOne);
  assert.deepEqual(nextAssistantTwo?.workflow?.segments.map((segment) => segment.kind), ["activity", "body"]);
});

test("conversation workflow display inserts older reasoning without rewriting closed tool activity", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
  ];
  const first = projectConversationWorkflowDisplay({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
        transcriptNode({
          nodeId: "tool-1",
          runId: "run-1",
          sequence: 2,
          kind: "tool",
          eventType: "tool.completed",
          summary: "README.md",
        }),
      ],
    },
    currentRunNodes: [],
  });
  const second = projectConversationWorkflowDisplay({
    previous: first.state,
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "thinking-1",
          runId: "run-1",
          sequence: 0,
          kind: "thinking",
          eventType: "model.reasoning.completed",
          text: "先判断下一步。",
        }),
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 1,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
        transcriptNode({
          nodeId: "tool-1",
          runId: "run-1",
          sequence: 2,
          kind: "tool",
          eventType: "tool.completed",
          summary: "README.md",
        }),
      ],
    },
    currentRunNodes: [],
  });

  const firstActivity = first.assistantDisplays.get("assistant-1")?.workflow?.segments
    .find((segment) => segment.kind === "activity");
  const secondActivities = second.assistantDisplays.get("assistant-1")?.workflow?.segments
    .filter((segment) => segment.kind === "activity") ?? [];

  assert.deepEqual(
    firstActivity?.kind === "activity" ? firstActivity.timeline.items.map((item) => item.nodeId) : [],
    ["tool-1"],
  );
  assert.deepEqual(
    secondActivities.flatMap((segment) => segment.timeline.items.map((item) => item.nodeId)),
    ["thinking-1", "tool-1"],
  );
});

test("standalone failed assistant workflow uses previous output for workflow copy", () => {
  const previousState = createConversationWorkflowDisplayState<
    ReturnType<typeof turn>,
    ReturnType<typeof transcriptNode>,
    { readonly title: string; readonly summary: string; readonly sections: readonly [] },
    never
  >();
  const failed = projectStandaloneAssistantWorkflowDisplay({
    previous: previousState,
    conversationId: "conversation-1",
    key: "conversation-1:run-1",
    content: "已完成前半段。\n\n错误信息：provider failed",
    terminalStatus: "failed",
    transcriptNodes: [
      transcriptNode({
        nodeId: "body-1",
        runId: "run-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        text: "已完成前半段。",
      }),
      transcriptNode({
        nodeId: "tool-1",
        runId: "run-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "读取 README.md 失败",
      }),
    ],
    collapseTimeline: false,
  });

  const activity = failed.workflow.segments.find((segment) => segment.kind === "activity");

  assert.deepEqual(failed.failure, {
    previous: "已完成前半段。",
    error: "错误信息：provider failed",
  });
  assert.equal(failed.workflow.copyText, "已完成前半段。");
  assert.equal(failed.workflow.showCopyActions, true);
  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.lifecycle : undefined, "attention");
});

function projected<TTurn extends ReturnType<typeof turn>>(
  turn: TTurn,
  displayRunId?: string,
): WorklineProjectedTurn<TTurn> {
  return {
    turn,
    displayRunId,
    claimedCurrentRun: false,
  };
}

function turn(
  turnId: string,
  role: "user" | "assistant",
  content: string,
  status: string,
) {
  return {
    turnId,
    role,
    content,
    status,
  };
}

function transcriptNode(input: {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "body" | "system";
  readonly eventType: string;
  readonly phase?: "noted" | "preparing" | "waiting_approval" | "approved" | "denied" | "guidance" | "executing" | "completed" | "failed" | "blocked" | "cancelled";
  readonly text?: string;
  readonly summary?: string;
}) {
  return {
    nodeId: input.nodeId,
    runId: input.runId,
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase ?? "completed" as const,
    title: "",
    summary: input.summary ?? input.text,
    text: input.text,
    timestamp: "",
    refs: [],
  };
}
