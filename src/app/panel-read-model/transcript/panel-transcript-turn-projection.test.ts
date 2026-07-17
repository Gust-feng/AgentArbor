import assert from "node:assert/strict";
import test from "node:test";
import type { LiveRunBuffer } from "../run/panel-run-live-buffer.js";
import {
  assistantShellSnapshot,
  assistantTurnSlotKey,
  isRefreshingRunStatus,
  latestAssistantTurnIdForTurns,
  precomputeAssistantTurnSlotKeys,
  projectAssistantTranscriptTurn,
  type AssistantTranscriptNodeLike,
} from "./panel-transcript-turn-projection.js";
import type { WorklineProjectedTurn } from "../assistant/panel-assistant-workline.js";
import { textStreamAssemblyFromText } from "./readable-text-fragments.js";

test("assistant shell snapshot tracks empty running turns by id and stable slot", () => {
  const turns = [
    turn("user-1", "user", "检查项目", "completed"),
    turn("assistant-shell", "assistant", "", "running"),
  ];
  const snapshot = assistantShellSnapshot(turns);

  assert.equal(snapshot.turnIds.has("assistant-shell"), true);
  assert.equal(snapshot.slotKeys.has("1:检查项目"), true);
  assert.equal(assistantTurnSlotKey(turns, 1), "1:检查项目");
});

test("assistant turn slot keys can be precomputed in conversation order", () => {
  const turns = [
    turn("user-1", "user", "第一问", "completed"),
    turn("assistant-1", "assistant", "第一答", "completed"),
    turn("user-2", "user", "第二问", "completed"),
    turn("assistant-2", "assistant", "", "running"),
    turn("assistant-3", "assistant", "补充", "completed"),
  ];

  const slotKeys = precomputeAssistantTurnSlotKeys(turns);

  assert.equal(slotKeys[0], undefined);
  assert.equal(slotKeys[1], "1:第一问");
  assert.equal(slotKeys[3], "2:第二问");
  assert.equal(slotKeys[4], "3:第二问");
  assert.equal(slotKeys[4], assistantTurnSlotKey(turns, 4));
});

test("assistant turn projection animates content that replaces a previous empty shell", () => {
  const previousShells = assistantShellSnapshot([
    turn("user-1", "user", "你好", "completed"),
    turn("assistant-1", "assistant", "", "running"),
  ]);
  const turns = [
    turn("user-1", "user", "你好", "completed"),
    turn("assistant-1", "assistant", "你好，我在。", "completed"),
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: previousShells,
    transcriptNodes: [],
  });

  assert.equal(projection.content, "你好，我在。");
  assert.equal(projection.keepStreamMounted, false);
  assert.equal(projection.animateOnMount, true);
});

test("assistant turn projection prefers live answer while a matching run is refreshing", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [],
    live: live("run-1", "正在输出"),
    workView: {
      run: { runId: "run-1" },
      answer: { content: "最终答案" },
    },
  });

  assert.equal(projection.content, "正在输出");
  assert.equal(projection.live, true);
  assert.equal(projection.keepStreamMounted, true);
  assert.equal(projection.animateOnMount, true);
});

test("assistant turn projection ignores stale live text once the run is completed", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "回合答案", "completed"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "completed" },
    transcriptNodes: [],
    live: live("run-1", "不应重播的旧直播文本"),
    workView: {
      run: { runId: "run-1" },
      answer: { content: "最终答案" },
    },
  });

  assert.equal(projection.content, "最终答案");
  assert.equal(projection.live, false);
  assert.equal(projection.keepStreamMounted, false);
  assert.equal(projection.animateOnMount, false);
});

test("assistant turn projection does not animate settled content on cold-load conversation switch", () => {
  const turns = [
    turn("user-1", "user", "你好", "completed"),
    turn("assistant-1", "assistant", "你好，有什么可以帮你的？", "completed"),
    turn("user-2", "user", "解释一下 React", "completed"),
    turn("assistant-2", "assistant", "React 是一个用于构建用户界面的 JavaScript 库。", "completed"),
  ];
  const coldLoadShells = assistantShellSnapshot([]);

  const firstAssistant = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: coldLoadShells,
  });
  assert.equal(firstAssistant.animateOnMount, false);

  const latestAssistant = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[3]!),
    turnIndex: 3,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: coldLoadShells,
  });
  assert.equal(latestAssistant.animateOnMount, false);
});

test("assistant turn projection uses settled replay answer when turn content is empty", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    { ...turn("assistant-1", "assistant", "", "completed"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    transcriptNodes: [
      node({
        nodeId: "answer",
        runId: "run-1",
        sequence: 2,
        kind: "answer",
        eventType: "final.result",
        summary: "已回答：恢复答案",
      }),
    ],
  });

  assert.equal(projection.content, "恢复答案");
  assert.equal(projection.animateOnMount, false);
});

test("assistant turn projection can show direct running reply previews before tool boundaries", () => {
  const turns = [
    turn("user-1", "user", "解释一下", "completed"),
    { ...turn("assistant-1", "assistant", "这是一个普通回答预览。", "running"), title: "", runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [],
  });

  assert.equal(projection.content, "这是一个普通回答预览。");
});

test("assistant turn projection does not treat running preview content as an answer", () => {
  const turns = [
    turn("user-1", "user", "运行 dir", "completed"),
    { ...turn("assistant-1", "assistant", "继续执行。", "running"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [
      node({
        nodeId: "tool-completed",
        runId: "run-1",
        sequence: 5,
        kind: "tool",
        eventType: "tool.completed",
        summary: "dir · exit 0",
      }),
    ],
  });

  assert.equal(projection.content, "");
  assert.equal(projection.keepStreamMounted, true);
});

test("assistant turn projection does not treat generic approval copy as an answer", () => {
  const turns = [
    turn("user-1", "user", "批准", "completed"),
    { ...turn("assistant-1", "assistant", "继续执行。", "running"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [{
      ...node({
        nodeId: "resume",
        runId: "run-1",
        sequence: 3,
        kind: "user_decision",
        eventType: "run.resumed",
        summary: "继续处理。",
      }),
      phase: "approved",
    }],
  });

  assert.equal(projection.content, "");
  assert.equal(projection.keepStreamMounted, true);
});

test("assistant turn projection hides stale preview while confirmation is pending", () => {
  const turns = [
    turn("user-1", "user", "运行 dir", "completed"),
    { ...turn("assistant-1", "assistant", "很好，探索已经开始！", "running"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [
      node({
        nodeId: "confirmation",
        runId: "run-1",
        sequence: 3,
        kind: "confirmation",
        eventType: "confirmation.needed",
        summary: "运行命令：dir",
      }),
    ],
    pending: { confirmationId: "confirmation-call-dir", ownerRunId: "run-1" },
  });

  assert.equal(projection.content, "");
  assert.equal(projection.pending?.confirmationId, "confirmation-call-dir");
});

test("assistant turn projection scopes pending confirmations to the owning run", () => {
  const turns = [
    turn("user-1", "user", "删除文件", "completed"),
    { ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" },
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!, "run-1"),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: latestAssistantTurnIdForTurns(turns),
    previousEmptyShells: assistantShellSnapshot([]),
    transcriptNodes: [],
    pending: { confirmationId: "confirmation-1", ownerRunId: "run-2" },
  });

  assert.equal(projection.pending, undefined);
  assert.equal(isRefreshingRunStatus({ runId: "run-1", status: "running" }), true);
  assert.equal(isRefreshingRunStatus({ runId: "run-1", status: "completed" }), false);
});

test("assistant turn projection keeps only a stream shell for an empty refreshing run", () => {
  const assistant = { ...turn("assistant-1", "assistant", "", "running"), runId: "run-1" };
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: {
      turn: assistant,
      displayRunId: "run-1",
      claimedCurrentRun: false,
    },
    turnIndex: 0,
    turns: [assistant],
    latestAssistantTurnId: "assistant-1",
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "running" },
    transcriptNodes: [],
  });

  assert.equal(projection.runProjection.nodes.length, 0);
  assert.equal(projection.keepStreamMounted, true);
});

test("assistant turn projection treats pending runs as refreshing", () => {
  const assistant = { ...turn("assistant-1", "assistant", "", "pending"), runId: "run-1" };
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: {
      turn: assistant,
      displayRunId: "run-1",
      claimedCurrentRun: false,
    },
    turnIndex: 0,
    turns: [assistant],
    latestAssistantTurnId: "assistant-1",
    previousEmptyShells: assistantShellSnapshot([]),
    run: { runId: "run-1", status: "pending" },
    transcriptNodes: [],
  });

  assert.equal(isRefreshingRunStatus({ runId: "run-1", status: "pending" }), true);
  assert.equal(projection.runProjection.nodes.length, 0);
  assert.equal(projection.keepStreamMounted, true);
});

test("assistant turn projection shows only a stream shell before a submitted run is attached", () => {
  const turns = [
    turn("user-1", "user", "继续", "completed"),
    turn("assistant-shell", "assistant", "", "running"),
  ];
  const projection = projectAssistantTranscriptTurn({
    projectedTurn: projected(turns[1]!),
    turnIndex: 1,
    turns,
    latestAssistantTurnId: "assistant-shell",
    previousEmptyShells: assistantShellSnapshot([]),
    transcriptNodes: [],
  });

  assert.equal(projection.runProjection.nodes.length, 0);
  assert.equal(projection.keepStreamMounted, true);
});

function projected(
  turnValue: ReturnType<typeof turn>,
  displayRunId?: string
): WorklineProjectedTurn<ReturnType<typeof turn>> {
  return {
    turn: turnValue,
    displayRunId,
    claimedCurrentRun: false,
  };
}

function turn(
  turnId: string,
  role: "user" | "assistant",
  content: string,
  status: string
): {
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: string;
  readonly runId?: string;
} {
  return { turnId, role, content, status };
}

function live(runId: string, outputText: string): LiveRunBuffer {
  return {
    runId,
    appliedEventKeys: [],
    tools: [],
    turns: [
      {
        requestId: "model-1",
        output: textStreamAssemblyFromText(outputText),
        sideText: "",
        reasoning: textStreamAssemblyFromText(""),
        reasoningCompleted: false,
        modelRefs: ["model-1"],
        updatedAtSequence: 1,
      },
    ],
  };
}

function node(input: {
  readonly nodeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: AssistantTranscriptNodeLike["kind"];
  readonly eventType: string;
  readonly summary?: string;
  readonly text?: string;
}): AssistantTranscriptNodeLike {
  return {
    nodeId: input.nodeId,
    runId: input.runId,
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: "completed",
    title: input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-06-04T00:00:00.000Z",
    refs: [],
  };
}
