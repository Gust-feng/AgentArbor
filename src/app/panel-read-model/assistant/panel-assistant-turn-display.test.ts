import assert from "node:assert/strict";
import test from "node:test";
import { projectStableAssistantWorkflowDisplay } from "./panel-assistant-workflow-display.js";
import { projectStableAssistantTurnDisplays } from "./panel-assistant-turn-display.js";
import {
  assistantShellSnapshot,
  latestAssistantTurnIdForTurns,
  precomputeAssistantTurnSlotKeys,
} from "../transcript/panel-transcript-turn-projection.js";
import type { WorklineProjectedTurn } from "./panel-assistant-workline.js";

test("assistant workflow display projects late reasoning and the canonical body from current facts", () => {
  const previous = projectStableAssistantWorkflowDisplay({
    content: "好的！让我来展示一下我的各项能力。",
    transcriptNodes: [],
    collapseTimeline: false,
  });

  const next = projectStableAssistantWorkflowDisplay({
    previous,
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

  assert.deepEqual(next.workflow.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.deepEqual(
    next.workflow.segments[0]?.kind === "activity"
      ? next.workflow.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-1"],
  );
  assert.equal(next.workflow.segments[1]?.kind, "body");
  assert.equal(next.workflow.segments[1]?.kind === "body" ? next.workflow.segments[1].segmentKey : undefined, "body:body-1");
});

test("stable assistant turn displays carry previous workflows by turn id instead of rematerializing from scratch", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
  ];
  const shells = assistantShellSnapshot([]);
  const slotKeys = precomputeAssistantTurnSlotKeys(turns);
  const first = projectStableAssistantTurnDisplays({
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", [
        transcriptNode({
          nodeId: "body-1",
          runId: "run-1",
          sequence: 2,
          kind: "body",
          eventType: "model.output.completed",
          text: "第一段正文。",
        }),
      ]],
    ]),
  });

  const second = projectStableAssistantTurnDisplays({
    previousWorkflows: first.workflows,
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", [
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
        transcriptNode({
          nodeId: "tool-1",
          runId: "run-1",
          sequence: 3,
          kind: "tool",
          eventType: "tool.completed",
          summary: "读取 README.md",
        }),
      ]],
    ]),
  });

  const display = second.displays.get("assistant-1");
  assert.ok(display !== undefined);
  assert.deepEqual(display.workflow?.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.deepEqual(
    display.workflow?.segments[0]?.kind === "activity"
      ? display.workflow.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-1"],
  );
  assert.equal(display.workflow?.segments[1]?.kind, "body");
  assert.equal(display.workflow?.segments[1]?.kind === "body" ? display.workflow.segments[1].segmentKey : undefined, "body:body-1");
  assert.deepEqual(
    display.workflow?.segments[2]?.kind === "activity"
      ? display.workflow.segments[2].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("stable assistant turn displays reuse unchanged historical assistant workflow references", () => {
  const turns = [
    turn("user-1", "user", "先做一件事", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
    turn("user-2", "user", "继续", "completed"),
    { ...turn("assistant-2", "assistant", "第二段正文。", "running"), runId: "run-2" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
    projected(turns[2]!),
    projected(turns[3]!, "run-2"),
  ];
  const shells = assistantShellSnapshot([]);
  const slotKeys = precomputeAssistantTurnSlotKeys(turns);
  const runOneNodes = [
    transcriptNode({
      nodeId: "body-1",
      runId: "run-1",
      sequence: 1,
      kind: "body",
      eventType: "model.output.completed",
      text: "第一段正文。",
    }),
  ];
  const first = projectStableAssistantTurnDisplays({
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", runOneNodes],
      ["run-2", [
        transcriptNode({
          nodeId: "body-2",
          runId: "run-2",
          sequence: 1,
          kind: "body",
          eventType: "model.output.delta",
          phase: "noted",
          text: "第二段",
        }),
      ]],
    ]),
  });
  const second = projectStableAssistantTurnDisplays({
    previousDisplays: first.displays,
    previousWorkflows: first.workflows,
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", runOneNodes],
      ["run-2", [
        transcriptNode({
          nodeId: "thinking-2",
          runId: "run-2",
          sequence: 1,
          kind: "thinking",
          eventType: "model.reasoning.delta",
          phase: "noted",
          text: "继续分析。",
        }),
        transcriptNode({
          nodeId: "body-2",
          runId: "run-2",
          sequence: 2,
          kind: "body",
          eventType: "model.output.delta",
          phase: "noted",
          text: "第二段正文。",
        }),
      ]],
    ]),
  });

  assert.equal(second.displays.get("assistant-1"), first.displays.get("assistant-1"));
  assert.equal(second.workflows.get("assistant-1"), first.workflows.get("assistant-1"));
  assert.notEqual(second.displays.get("assistant-2"), first.displays.get("assistant-2"));
  assert.notEqual(second.workflows.get("assistant-2"), first.workflows.get("assistant-2"));
});

test("stable assistant turn displays keep historical latest turn stable while another run streams", () => {
  const turns = [
    turn("user-1", "user", "先做一件事", "completed"),
    { ...turn("assistant-1", "assistant", "第一段正文。", "completed"), runId: "run-1" },
    turn("user-2", "user", "继续", "completed"),
    { ...turn("assistant-2", "assistant", "第二段正文。", "completed"), runId: "run-2" },
    turn("user-3", "user", "现在继续", "completed"),
    { ...turn("assistant-3", "assistant", "", "running"), runId: "run-3" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!, "run-1"),
    projected(turns[2]!),
    projected(turns[3]!, "run-2"),
    projected(turns[4]!),
    projected(turns[5]!, "run-3"),
  ];
  const shells = assistantShellSnapshot([]);
  const slotKeys = precomputeAssistantTurnSlotKeys(turns);
  const runTwoNodes = [
    transcriptNode({
      nodeId: "body-2",
      runId: "run-2",
      sequence: 1,
      kind: "body",
      eventType: "model.output.completed",
      text: "第二段正文。",
    }),
  ];
  const first = projectStableAssistantTurnDisplays({
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-2", runTwoNodes],
      ["run-3", [
        transcriptNode({
          nodeId: "body-3",
          runId: "run-3",
          sequence: 1,
          kind: "body",
          eventType: "model.output.delta",
          phase: "noted",
          text: "第三",
        }),
      ]],
    ]),
    run: { runId: "run-3", status: "running" },
  });
  const second = projectStableAssistantTurnDisplays({
    previousDisplays: first.displays,
    previousWorkflows: first.workflows,
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-2", runTwoNodes],
      ["run-3", [
        transcriptNode({
          nodeId: "thinking-3",
          runId: "run-3",
          sequence: 1,
          kind: "thinking",
          eventType: "model.reasoning.delta",
          phase: "noted",
          text: "继续分析。",
        }),
        transcriptNode({
          nodeId: "body-3",
          runId: "run-3",
          sequence: 2,
          kind: "body",
          eventType: "model.output.delta",
          phase: "noted",
          text: "第三段正文。",
        }),
      ]],
    ]),
    run: { runId: "run-3", status: "running" },
  });

  assert.equal(second.displays.get("assistant-2"), first.displays.get("assistant-2"));
  assert.equal(second.workflows.get("assistant-2"), first.workflows.get("assistant-2"));
  assert.notEqual(second.displays.get("assistant-3"), first.displays.get("assistant-3"));
});

test("stable assistant turn displays reuse unchanged historical plain-text assistant references", () => {
  const turns = [
    turn("user-1", "user", "先回答", "completed"),
    turn("assistant-1", "assistant", "纯文本回答。", "completed"),
    turn("user-2", "user", "继续", "completed"),
    { ...turn("assistant-2", "assistant", "第二段正文。", "running"), runId: "run-2" },
  ];
  const projectedTurns = [
    projected(turns[0]!),
    projected(turns[1]!),
    projected(turns[2]!),
    projected(turns[3]!, "run-2"),
  ];
  const shells = assistantShellSnapshot([]);
  const slotKeys = precomputeAssistantTurnSlotKeys(turns);
  const first = projectStableAssistantTurnDisplays({
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map(),
  });
  const second = projectStableAssistantTurnDisplays({
    previousDisplays: first.displays,
    previousWorkflows: first.workflows,
    projectedTurns,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: shells,
    assistantTurnSlotKeys: slotKeys,
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-2", [
        transcriptNode({
          nodeId: "body-2",
          runId: "run-2",
          sequence: 1,
          kind: "body",
          eventType: "model.output.delta",
          phase: "noted",
          text: "第二段正文。",
        }),
      ]],
    ]),
  });

  assert.equal(second.displays.get("assistant-1"), first.displays.get("assistant-1"));
  assert.equal(second.workflows.get("assistant-1"), first.workflows.get("assistant-1"));
});

test("stable assistant turn displays keep failed turns in workflow state", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "已完成前半段。\n\n错误信息：provider failed", "failed"), runId: "run-1" },
  ];
  const result = projectStableAssistantTurnDisplays({
    projectedTurns: [
      projected(turns[0]!),
      projected(turns[1]!, "run-1"),
    ],
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(turns),
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", [
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
      ]],
    ]),
  });

  const display = result.displays.get("assistant-1");
  const activity = display?.workflow?.segments.find((segment) => segment.kind === "activity");

  assert.equal(display?.failure?.previous, "已完成前半段。");
  assert.equal(display?.failure?.error, "错误信息：provider failed");
  assert.equal(result.workflows.has("assistant-1"), true);
  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.lifecycle : undefined, "attention");
  assert.equal(activity?.kind === "activity" ? activity.collapseReason : undefined, "needs_attention");
});

test("stable assistant turn displays treat plain failed content as failure-only copy", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "模型不可用。", "failed"), runId: "run-1" },
  ];
  const result = projectStableAssistantTurnDisplays({
    projectedTurns: [
      projected(turns[0]!),
      projected(turns[1]!, "run-1"),
    ],
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(turns),
    transcriptNodesByRunId: new Map(),
  });

  const display = result.displays.get("assistant-1");

  assert.deepEqual(display?.failure, {
    previous: "",
    error: "模型不可用。",
  });
  assert.equal(display?.workflow?.copyText, "");
  assert.deepEqual(display?.workflow?.segments, []);
});

test("stable assistant turn displays render blocked terminal copy once outside the activity timeline", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "执行在进程重启后被中断。", "blocked"), runId: "run-1" },
  ];
  const result = projectStableAssistantTurnDisplays({
    projectedTurns: [
      projected(turns[0]!),
      projected(turns[1]!, "run-1"),
    ],
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(turns),
    transcriptNodesByRunId: new Map([["run-1", [
      transcriptNode({
        nodeId: "run-blocked-1",
        runId: "run-1",
        sequence: 1,
        kind: "system",
        eventType: "run.blocked",
        phase: "blocked",
        summary: "执行在进程重启后被中断。",
      }),
    ]]]),
  });

  const display = result.displays.get("assistant-1");

  assert.deepEqual(display?.failure, {
    previous: "",
    error: "执行在进程重启后被中断。",
  });
  assert.deepEqual(display?.workflow?.segments, []);
});

test("stable assistant turn displays omit duplicate system failure text from workflow activity", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "错误信息：当前模型不支持调节思考强度。", "failed"), runId: "run-1" },
  ];
  const result = projectStableAssistantTurnDisplays({
    projectedTurns: [
      projected(turns[0]!),
      projected(turns[1]!, "run-1"),
    ],
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(turns),
    transcriptNodesByRunId: new Map<string, readonly ReturnType<typeof transcriptNode>[]>([
      ["run-1", [
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
      ]],
    ]),
  });

  const display = result.displays.get("assistant-1");
  const activity = display?.workflow?.segments.find((segment) => segment.kind === "activity");

  assert.equal(display?.failure?.previous, "");
  assert.equal(display?.failure?.error, "错误信息：当前模型不支持调节思考强度。");
  assert.deepEqual(
    activity?.kind === "activity" ? activity.timeline.items.map((item) => item.nodeId) : [],
    ["tool-1"],
  );
});

test("stable assistant turn displays remove a failure activity cached before the final failure notice", () => {
  const runningTurns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" },
  ];
  const transcriptNodes = [
    transcriptNode({
      nodeId: "tool-1",
      runId: "run-1",
      sequence: 1,
      kind: "tool",
      eventType: "tool.failed",
      phase: "failed",
      summary: "读取 README.md 失败",
    }),
    transcriptNode({
      nodeId: "run-failed-1",
      runId: "run-1",
      sequence: 2,
      kind: "system",
      eventType: "run.failed",
      phase: "failed",
      summary: "provider quota exceeded",
    }),
  ];
  const first = projectStableAssistantTurnDisplays({
    projectedTurns: [
      projected(runningTurns[0]!),
      projected(runningTurns[1]!, "run-1"),
    ],
    turns: runningTurns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(runningTurns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(runningTurns),
    transcriptNodesByRunId: new Map([["run-1", transcriptNodes]]),
  });
  const failedTurns = [
    runningTurns[0]!,
    { ...turn("assistant-1", "assistant", "错误信息：provider quota exceeded", "failed"), runId: "run-1" },
  ];
  const second = projectStableAssistantTurnDisplays({
    previousDisplays: first.displays,
    previousWorkflows: first.workflows,
    projectedTurns: [
      projected(failedTurns[0]!),
      projected(failedTurns[1]!, "run-1"),
    ],
    turns: failedTurns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(failedTurns),
    previousEmptyShells: assistantShellSnapshot([]),
    assistantTurnSlotKeys: precomputeAssistantTurnSlotKeys(failedTurns),
    transcriptNodesByRunId: new Map([["run-1", transcriptNodes]]),
  });

  const display = second.displays.get("assistant-1");
  const activityItems = display?.workflow?.segments.flatMap((segment) =>
    segment.kind === "activity" ? segment.timeline.items : []
  ) ?? [];

  assert.equal(display?.failure?.error, "错误信息：provider quota exceeded");
  assert.deepEqual(activityItems.map((item) => item.nodeId), ["tool-1"]);
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
