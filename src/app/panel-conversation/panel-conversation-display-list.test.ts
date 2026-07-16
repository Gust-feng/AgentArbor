import assert from "node:assert/strict";
import test from "node:test";
import {
  projectConversationDisplayList,
} from "./panel-conversation-display-list.js";
import { createConversationWorkflowDisplayState } from "./panel-conversation-workflow-display.js";
import type { WorklineProjectedTurn } from "../panel-read-model/assistant/panel-assistant-workline.js";

test("conversation display list appends standalone assistant after transcript items", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
  ];
  const projectedTurns = [
    projected(turns[0]!),
  ];

  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {},
    currentRunId: "run-1",
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
        text: "好的，我继续处理。",
      }),
    ],
    standaloneRun: {
      currentRunId: "run-1",
      runStatus: "completed",
      answer: "好的，我继续处理。",
      runProjection: {
        nodes: [
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
            text: "好的，我继续处理。",
          }),
        ],
        answer: {
          text: "好的，我继续处理。",
          tone: "formal",
          streaming: false,
        },
      },
      collapseTimeline: false,
    },
  });

  assert.deepEqual(display.items.map((item) => item.kind), ["user", "assistant"]);
  assert.equal(display.items[1]?.kind, "assistant");
  assert.equal(display.items[1]?.kind === "assistant" ? display.items[1].source : undefined, "standalone");
  assert.equal(display.items[1]?.kind === "assistant" ? display.items[1].animateOnMount : undefined, false);
});

test("conversation display list keeps assistant turns in the unified list without adding a standalone duplicate", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "好的，我继续处理。", "running"), runId: "run-1" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
  ];

  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "body-1",
        runId: "run-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        text: "好的，我继续处理。",
      }),
    ],
  });

  assert.deepEqual(display.items.map((item) => item.kind), ["user", "assistant"]);
  assert.equal(display.items[1]?.kind, "assistant");
  assert.equal(display.items[1]?.kind === "assistant" ? display.items[1].source : undefined, "turn");
});

test("conversation display list carries workflow continuity when a standalone run becomes a turn", () => {
  const standaloneDisplay = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns: [projected(turn("user-1", "user", "继续", "completed"))],
    turns: [turn("user-1", "user", "继续", "completed")],
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "thinking-live",
        runId: "run-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "I should inspect the workspace.",
      }),
      transcriptNode({
        nodeId: "body-live",
        runId: "run-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.delta",
        phase: "noted",
        text: "我先检查工作区。",
      }),
    ],
    standaloneRun: {
      currentRunId: "run-1",
      runStatus: "running",
      answer: "我先检查工作区。",
      runProjection: {
        nodes: [
          transcriptNode({
            nodeId: "thinking-live",
            runId: "run-1",
            sequence: 1,
            kind: "thinking",
            eventType: "model.reasoning.delta",
            phase: "noted",
            text: "I should inspect the workspace.",
          }),
          transcriptNode({
            nodeId: "body-live",
            runId: "run-1",
            sequence: 2,
            kind: "body",
            eventType: "model.output.delta",
            phase: "noted",
            text: "我先检查工作区。",
          }),
        ],
        answer: {
          text: "我先检查工作区。",
          tone: "process",
          streaming: true,
        },
      },
      collapseTimeline: false,
    },
  });
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "我先检查工作区。", "running"), runId: "run-1" },
  ];
  const migratedDisplay = projectConversationDisplayList({
    previous: standaloneDisplay.state,
    conversationId: "conversation-1",
    projectedTurns: [
      projected(turns[0]!),
      projected(turns[1]!, "run-1"),
    ],
    turns,
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "thinking-live",
        runId: "run-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "I should inspect the workspace.",
      }),
      transcriptNode({
        nodeId: "body-live",
        runId: "run-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我先检查工作区。",
      }),
      transcriptNode({
        nodeId: "thinking-settled",
        runId: "run-1",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "I should inspect the workspace before editing files.",
      }),
      transcriptNode({
        nodeId: "tool-1",
        runId: "run-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
  });

  const item = migratedDisplay.items[1];
  const activitySegments = item?.kind === "assistant"
    ? item.workflow?.segments.filter((segment) => segment.kind === "activity") ?? []
    : [];

  assert.equal(item?.kind, "assistant");
  assert.equal(item?.kind === "assistant" ? item.source : undefined, "turn");
  assert.equal(migratedDisplay.state.assistantWorkflowsByRunId.has("run-1"), true);
  assert.equal(activitySegments.length, 2);
  assert.deepEqual(activitySegments[0]?.timeline.items.map((timelineItem) => timelineItem.copy.detail), [
    "思考中",
  ]);
  assert.deepEqual(activitySegments[0]?.timeline.items.map((timelineItem) => timelineItem.copy.expandedDetail), [
    "I should inspect the workspace.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((timelineItem) => timelineItem.copy.detail), ["README.md"]);
});

test("conversation display list keeps failed assistant turns on the unified workflow path", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "已完成前半段。\n\n错误信息：provider failed", "failed"), runId: "run-1" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
  ];

  const display = projectConversationDisplayList({
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
    },
    currentRunNodes: [],
  });

  const item = display.items[1];
  assert.equal(item?.kind, "assistant");
  assert.equal(item?.kind === "assistant" ? item.failure?.previous : undefined, "已完成前半段。");
  assert.equal(item?.kind === "assistant" ? item.failure?.error : undefined, "错误信息：provider failed");
  const activity = item?.kind === "assistant"
    ? item.workflow?.segments.find((segment) => segment.kind === "activity")
    : undefined;
  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.lifecycle : undefined, "attention");
  assert.equal(activity?.kind === "activity" ? activity.collapseReason : undefined, "needs_attention");
  assert.deepEqual(
    activity?.kind === "activity" ? activity.timeline.items.map((timelineItem) => timelineItem.nodeId) : [],
    ["tool-1"],
  );
  assert.equal(display.state.assistantWorkflowsByTurnId.has("assistant-1"), true);
});

test("conversation display list gives blocked turns one terminal notice instead of a body and activity echo", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "执行在进程重启后被中断。", "blocked"), runId: "run-1" },
  ];
  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns: [projected(turns[0]!), projected(turns[1]!, "run-1")],
    turns,
    cachedNodesByRunId: {
      "run-1": [
        transcriptNode({
          nodeId: "run-blocked-1",
          runId: "run-1",
          sequence: 1,
          kind: "system",
          eventType: "run.blocked",
          phase: "blocked",
          summary: "执行在进程重启后被中断。",
        }),
      ],
    },
    currentRunNodes: [],
  });

  const item = display.items[1];

  assert.equal(item?.kind, "assistant");
  assert.equal(item?.kind === "assistant" ? item.terminalStatus : undefined, "blocked");
  assert.deepEqual(item?.kind === "assistant" ? item.failure : undefined, {
    previous: "",
    error: "执行在进程重启后被中断。",
  });
  assert.deepEqual(item?.kind === "assistant" ? item.workflow?.segments : undefined, []);
});

test("conversation display list projects standalone failed runs like failed assistant turns", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
  ];
  const projectedTurns = [
    projected(turns[0]!),
  ];

  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns,
    turns,
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [
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
    standaloneRun: {
      currentRunId: "run-1",
      runStatus: "failed",
      answer: "已完成前半段。\n\n错误信息：provider failed",
      runProjection: {
        nodes: [
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
        answer: {
          text: "已完成前半段。\n\n错误信息：provider failed",
          tone: "formal",
          streaming: false,
        },
      },
      collapseTimeline: false,
    },
  });

  const item = display.items[1];
  const activity = item?.kind === "assistant"
    ? item.workflow?.segments.find((segment) => segment.kind === "activity")
    : undefined;

  assert.equal(item?.kind, "assistant");
  assert.equal(item?.kind === "assistant" ? item.source : undefined, "standalone");
  assert.deepEqual(item?.kind === "assistant" ? item.failure : undefined, {
    previous: "已完成前半段。",
    error: "错误信息：provider failed",
  });
  assert.equal(item?.kind === "assistant" ? item.live : undefined, false);
  assert.equal(item?.kind === "assistant" ? item.animateOnMount : undefined, false);
  assert.equal(item?.kind === "assistant" ? item.hasPendingConfirmation : undefined, false);
  assert.equal(item?.kind === "assistant" ? item.workflow?.copyText : undefined, "已完成前半段。");
  assert.equal(item?.kind === "assistant" ? item.workflow?.showCopyActions : undefined, true);
  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.lifecycle : undefined, "attention");
  assert.deepEqual(
    activity?.kind === "activity" ? activity.timeline.items.map((timelineItem) => timelineItem.nodeId) : [],
    ["tool-1"],
  );
});

test("conversation display list keeps standalone plain failed content out of workflow copy", () => {
  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns: [projected(turn("user-1", "user", "继续", "completed"))],
    turns: [turn("user-1", "user", "继续", "completed")],
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [],
    standaloneRun: {
      currentRunId: "run-1",
      runStatus: "failed",
      answer: "模型不可用。",
      runProjection: {
        nodes: [],
        answer: {
          text: "模型不可用。",
          tone: "formal",
          streaming: false,
        },
      },
      collapseTimeline: false,
    },
  });

  const item = display.items[1];

  assert.deepEqual(item?.kind === "assistant" ? item.failure : undefined, {
    previous: "",
    error: "模型不可用。",
  });
  assert.equal(item?.kind === "assistant" ? item.workflow?.copyText : undefined, "");
  assert.deepEqual(item?.kind === "assistant" ? item.workflow?.segments : undefined, []);
});

test("conversation display list omits standalone duplicate system failure activity", () => {
  const display = projectConversationDisplayList({
    previous: createConversationWorkflowDisplayState(),
    conversationId: "conversation-1",
    projectedTurns: [projected(turn("user-1", "user", "继续", "completed"))],
    turns: [turn("user-1", "user", "继续", "completed")],
    cachedNodesByRunId: {},
    currentRunId: "run-1",
    currentRunNodes: [
      transcriptNode({
        nodeId: "tool-1",
        runId: "run-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "读取模型能力信息失败",
      }),
      transcriptNode({
        nodeId: "system-1",
        runId: "run-1",
        sequence: 2,
        kind: "system",
        eventType: "model.failed",
        phase: "failed",
        text: "当前模型不支持调节思考强度。",
      }),
    ],
    standaloneRun: {
      currentRunId: "run-1",
      runStatus: "failed",
      answer: "错误信息：当前模型不支持调节思考强度。",
      runProjection: {
        nodes: [
          transcriptNode({
            nodeId: "tool-1",
            runId: "run-1",
            sequence: 1,
            kind: "tool",
            eventType: "tool.failed",
            phase: "failed",
            summary: "读取模型能力信息失败",
          }),
          transcriptNode({
            nodeId: "system-1",
            runId: "run-1",
            sequence: 2,
            kind: "system",
            eventType: "model.failed",
            phase: "failed",
            text: "当前模型不支持调节思考强度。",
          }),
        ],
        answer: {
          text: "错误信息：当前模型不支持调节思考强度。",
          tone: "formal",
          streaming: false,
        },
      },
      collapseTimeline: false,
    },
  });

  const item = display.items[1];
  const activity = item?.kind === "assistant"
    ? item.workflow?.segments.find((segment) => segment.kind === "activity")
    : undefined;

  assert.equal(item?.kind, "assistant");
  assert.deepEqual(item?.kind === "assistant" ? item.failure : undefined, {
    previous: "",
    error: "错误信息：当前模型不支持调节思考强度。",
  });
  assert.deepEqual(
    activity?.kind === "activity" ? activity.timeline.items.map((timelineItem) => timelineItem.nodeId) : [],
    ["tool-1"],
  );
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
