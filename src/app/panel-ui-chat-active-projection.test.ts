import assert from "node:assert/strict";
import test from "node:test";
import {
  projectChatActive,
  type ChatActiveRun,
  type ChatActiveConversationTurn,
  type ChatActiveTranscriptNode,
} from "./panel-ui-chat-active-projection.js";
import type { LiveRunBuffer } from "./panel-ui-live-run-buffer.js";
import { textStreamAssemblyFromText } from "./readable-text-fragments.js";

test("active chat projection claims the optimistic assistant shell for live run material", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "检查项目"),
        assistantTurn("assistant-shell", "", "running"),
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running", 2),
    transcriptNodes: [node("run-1", 2, "tool", "tool.completed")],
    live: live("run-1", "正在回答"),
  });

  assert.equal(projection.running, true);
  assert.equal(projection.workline.standaloneRun, false);
  assert.equal(projection.workline.turns[1]?.displayRunId, "run-1");
  assert.equal(projection.liveAnswer?.text, "正在回答");
  assert.equal(projection.hasVisibleContent, true);
  assert.equal(projection.scrollKey.includes("assistant-shell"), true);
});

test("active chat projection uses standalone run when restored output has no assistant turn", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [userTurn("user-1", "继续")],
      latestRunId: "run-1",
    },
    run: run("run-1", "completed", 5),
    transcriptNodes: [node("run-1", 5, "answer", "final.result", "完成")],
    detailAnswer: "恢复后的回答",
  });

  assert.equal(projection.running, false);
  assert.equal(projection.answer, "恢复后的回答");
  assert.equal(projection.workline.standaloneRun, true);
  assert.equal(projection.hasVisibleContent, true);
});

test("active chat projection ignores stale live answer after a run settles", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "继续"),
        { ...assistantTurn("assistant-1", "回合答案", "completed"), runId: "run-1" },
      ],
      latestRunId: "run-1",
    },
    run: run("run-1", "completed", 8),
    transcriptNodes: [],
    live: live("run-1", "不应重播的旧直播文本"),
    workViewAnswer: "最终答案",
  });

  assert.equal(projection.answer, "最终答案");
  assert.equal(projection.liveAnswer, undefined);
});

test("active chat projection prefers conversation run ownership over stale live buffers", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "继续"),
        { ...assistantTurn("assistant-2", "新的回答", "completed"), runId: "run-2" },
      ],
      latestRunId: "run-2",
    },
    transcriptNodes: [node("run-2", 7, "answer", "final.result", "新的回答")],
    live: live("run-1", "旧运行直播"),
  });

  assert.equal(projection.currentRunId, "run-2");
  assert.deepEqual(projection.liveAnswer, {
    text: "新的回答",
    tone: "formal",
    streaming: false,
  });
});

test("active chat projection ignores empty work view answers", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "继续"),
        { ...assistantTurn("assistant-1", "真实回答", "completed"), runId: "run-1" },
      ],
      latestRunId: "run-1",
    },
    run: run("run-1", "completed", 5),
    transcriptNodes: [],
    workViewAnswer: "",
    detailAnswer: "详情回答",
  });

  assert.equal(projection.answer, "详情回答");
});

test("active chat projection can show direct running reply previews before tool boundaries", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "解释一下"),
        { ...assistantTurn("assistant-1", "这是一个普通回答预览。", "running"), runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running", 2),
    transcriptNodes: [],
  });

  assert.equal(projection.answer, "这是一个普通回答预览。");
});

test("active chat projection does not use running conversation preview as an answer", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "运行 dir"),
        { ...assistantTurn("assistant-1", "继续执行。", "running"), runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running", 5),
    transcriptNodes: [node("run-1", 5, "tool", "tool.completed", "dir · exit 0")],
  });

  assert.equal(projection.answer, undefined);
  assert.equal(projection.hasVisibleContent, true);
});

test("active chat projection accepts running reply after the latest tool boundary", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "运行 dir"),
        { ...assistantTurn("assistant-1", "命令结果显示当前目录可以读取。", "running"), runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running", 6),
    transcriptNodes: [node("run-1", 5, "tool", "tool.completed", "dir · exit 0")],
  });

  assert.equal(projection.answer, "命令结果显示当前目录可以读取。");
});

test("active chat projection hides stale conversation preview while confirmation is pending", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "运行 dir"),
        { ...assistantTurn("assistant-1", "很好，探索已经开始！", "running"), runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running", 3),
    transcriptNodes: [node("run-1", 3, "confirmation", "confirmation.needed", "运行命令：dir")],
    pending: { confirmationId: "confirmation-call-dir", runId: "run-1" },
  });

  assert.equal(projection.answer, undefined);
  assert.equal(projection.pending?.confirmationId, "confirmation-call-dir");
  assert.equal(projection.hasVisibleContent, true);
});

test("active chat projection treats blocked runs as non-running and shows the problem", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "继续"),
        { ...assistantTurn("assistant-1", "已有回答", "completed"), runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "blocked", 8),
    transcriptNodes: [],
    problem: {
      title: "需要补充信息",
      message: "任务暂停了。",
      tone: "warning",
    },
  });

  assert.equal(projection.running, false);
  assert.deepEqual(projection.statusNotice, {
    title: "需要补充信息",
    message: "任务暂停了。",
    tone: "warning",
  });
});

test("active chat projection hides completed problem when assistant turn already failed visibly", () => {
  const projection = projectChatActive({
    conversation: {
      turns: [
        userTurn("user-1", "继续"),
        { ...assistantTurn("assistant-1", "错误信息：模型失败", "failed"), runId: "run-1" },
      ],
      latestRunId: "run-1",
    },
    run: run("run-1", "failed", 9),
    transcriptNodes: [],
    problem: {
      title: "运行失败",
      message: "模型失败",
      tone: "error",
    },
  });

  assert.equal(projection.running, false);
  assert.equal(projection.statusNotice, undefined);
  assert.equal(projection.hasVisibleContent, true);
});

function userTurn(turnId: string, content: string): ChatActiveConversationTurn {
  return {
    turnId,
    role: "user",
    content,
    status: "completed",
  };
}

function assistantTurn(turnId: string, content: string, status: string): ChatActiveConversationTurn {
  return {
    turnId,
    role: "assistant",
    title: "",
    content,
    status,
  };
}

function run(runId: string, status: ChatActiveRun["status"], cursor: number): ChatActiveRun {
  return {
    runId,
    status,
    eventCursor: { lastSequence: cursor },
  };
}

function node(
  runId: string,
  sequence: number,
  kind: ChatActiveTranscriptNode["kind"],
  eventType: string,
  text?: string
): ChatActiveTranscriptNode {
  return {
    nodeId: `node-${sequence}`,
    runId,
    sequence,
    eventType,
    kind,
    phase: "completed",
    title: kind,
    summary: text,
    text,
    timestamp: "2026-01-01T00:00:00.000Z",
    refs: [],
  };
}

function live(runId: string, outputText: string): LiveRunBuffer {
  return {
    runId,
    appliedEventKeys: [],
    turns: [
      {
        requestId: "model-1",
        output: textStreamAssemblyFromText(outputText),
        sideText: "",
        reasoning: textStreamAssemblyFromText(""),
        reasoningCompleted: false,
        modelRefs: ["model-1"],
        updatedAtSequence: 3,
      },
    ],
  };
}
