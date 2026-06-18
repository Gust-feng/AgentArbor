import assert from "node:assert/strict";
import test from "node:test";
import { projectChatActiveView } from "./panel-ui-chat-active-view.js";
import type {
  ChatActiveRun,
  ChatActiveTranscriptNode,
} from "./panel-ui-chat-active-projection.js";
import type { LiveRunBuffer } from "./panel-ui-live-run-buffer.js";
import { textStreamAssemblyFromText } from "./readable-text-fragments.js";

test("chat active view filters transcript nodes before building the workline", () => {
  const view = projectChatActiveView({
    conversation: {
      turns: [
        { turnId: "user-1", role: "user", content: "继续", status: "completed" },
        { turnId: "assistant-1", role: "assistant", content: "", status: "running", runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running"),
    transcriptNodes: [
      node({
        nodeId: "low-value-new",
        kind: "system",
        eventType: "agent.note.completed",
        phase: "completed",
        summary: "内容已整理。",
      }),
      node({
        nodeId: "low-value-legacy",
        kind: "system",
        eventType: "agent.note.completed",
        phase: "completed",
        summary: "内容已整理并已进入报告或详情",
      }),
      node({
        nodeId: "thinking",
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "正在判断",
      }),
    ],
  });

  assert.deepEqual(view.transcriptNodes.map((item) => item.nodeId), ["thinking"]);
  assert.equal(view.workline.turns[1]?.displayRunId, "run-1");
});

test("chat active view marks standalone runs and keeps live answer in the current run projection", () => {
  const view = projectChatActiveView({
    conversation: {
      turns: [
        { turnId: "user-1", role: "user", content: "直接回答", status: "completed" },
      ],
      latestRunId: "run-1",
    },
    run: run("run-1", "running"),
    transcriptNodes: [],
    live: live("run-1", "正在回答"),
  });

  assert.equal(view.workline.standaloneRun, true);
  assert.equal(view.answer, undefined);
  assert.deepEqual(view.liveAnswer, {
    text: "正在回答",
    tone: "process",
    streaming: true,
  });
});

test("chat active view keeps an empty assistant shell while a run has no transcript yet", () => {
  const view = projectChatActiveView({
    conversation: {
      turns: [
        { turnId: "user-1", role: "user", content: "检查一下", status: "completed" },
        { turnId: "assistant-1", role: "assistant", content: "", status: "running", runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "running"),
    transcriptNodes: [],
  });

  assert.equal(view.workline.turns[1]?.displayRunId, "run-1");
  assert.equal(view.currentRunProjection.nodes.length, 0);
});

test("chat active view keeps pending runs in the live activity view", () => {
  const view = projectChatActiveView({
    conversation: {
      turns: [
        { turnId: "user-1", role: "user", content: "检查一下", status: "completed" },
        { turnId: "assistant-1", role: "assistant", content: "", status: "pending", runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "pending"),
    transcriptNodes: [],
  });

  assert.equal(view.running, true);
  assert.equal(view.currentRunProjection.nodes.length, 0);
  assert.equal(view.workline.turns[1]?.displayRunId, "run-1");
});

test("chat active view keeps previous assistant output visible when the run fails", () => {
  const view = projectChatActiveView({
    conversation: {
      turns: [
        { turnId: "user-1", role: "user", content: "继续", status: "completed" },
        { turnId: "assistant-1", role: "assistant", content: "已经输出的内容。", status: "running", runId: "run-1" },
      ],
      activeRunId: "run-1",
    },
    run: run("run-1", "failed"),
    transcriptNodes: [],
    detail: {
      runId: "run-1",
      error: {
        code: "model_error",
        message: "上游模型连接中断。",
      },
    },
  });

  assert.equal(view.workline.turns[1]?.turn.content, "已经输出的内容。");
  assert.deepEqual(view.statusNotice, {
    title: "未完成",
    message: "上游模型连接中断。",
    tone: "error",
  });
});

function run(runId: string, status: ChatActiveRun["status"]): ChatActiveRun {
  return {
    runId,
    status,
    eventCursor: {
      lastSequence: 1,
    },
  };
}

function node(input: {
  readonly nodeId: string;
  readonly kind: ChatActiveTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ChatActiveTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
}): ChatActiveTranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.nodeId === "thinking" ? 2 : 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    timestamp: "2026-06-04T00:00:00.000Z",
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
        updatedAtSequence: 2,
      },
    ],
  };
}
