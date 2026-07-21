import assert from "node:assert/strict";
import test from "node:test";
import {
  liveStreamingAnswer,
  projectLiveRunTranscript,
  withLiveTranscriptNodes,
  type LiveTranscriptNode,
} from "./panel-live-transcript.js";
import { appendLiveRunEvents, emptyLiveRun, type LiveRunBuffer } from "../run/panel-run-live-buffer.js";
import { textStreamAssemblyFromText } from "./readable-text-fragments.js";

test("withLiveTranscriptNodes replaces existing reasoning node instead of appending duplicate", () => {
  const existing = node({
    nodeId: "reasoning-existing",
    sequence: 1,
    eventType: "model.reasoning.delta",
    kind: "thinking",
    phase: "noted",
    text: "先分析目标",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    reasoningText: "先分析目标，再检查约束",
    reasoningCompleted: true,
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "reasoning-existing");
  assert.equal(merged[0]?.text, "先分析目标，再检查约束");
  assert.equal(merged[0]?.eventType, "model.reasoning.completed");
});

test("withLiveTranscriptNodes exposes the latest live tool progress without waiting for a full view refresh", () => {
  const live = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [{
    id: "tool-live:call-1",
    runId: "run-1",
    sequence: 3,
    type: "tool.progress",
    summary: "正在运行命令。",
    timestamp: "2026-01-01T00:00:01.000Z",
    toolName: "shell_command",
    parentToolCallFactId: "delegate-fact",
    refs: [{ kind: "tool_call", id: "call-1" }],
    detail: {
      display: {
        kind: "command_summary",
        commandLine: "pnpm test",
        stdoutPreview: "running\n",
      },
    },
  }]);

  const projected = withLiveTranscriptNodes([], live);

  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.eventType, "tool.requested");
  assert.equal(projected[0]?.phase, "executing");
  assert.equal(projected[0]?.toolName, "shell_command");
  assert.equal(projected[0]?.parentToolCallFactId, "delegate-fact");
  assert.equal(projected[0]?.display?.kind, "command_summary");
});

test("withLiveTranscriptNodes can match live reasoning by comparable text during streaming", () => {
  const existing = node({
    nodeId: "reasoning-existing",
    sequence: 1,
    eventType: "model.reasoning.delta",
    kind: "thinking",
    phase: "noted",
    text: "先分析目标",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    reasoningText: "先分析目标，再检查约束",
    modelRefs: [],
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "先分析目标，再检查约束");
});

test("withLiveTranscriptNodes adds side text as a stable system node", () => {
  const merged = withLiveTranscriptNodes([], live({
    sideText: "准备读取文件",
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.kind, "system");
  assert.equal(merged[0]?.eventType, "model.output.side");
  assert.equal(merged[0]?.text, "准备读取文件");
});

test("withLiveTranscriptNodes adds live model output as a body node", () => {
  const merged = withLiveTranscriptNodes([], live({
    outputText: "我先解释当前判断。",
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.kind, "body");
  assert.equal(merged[0]?.eventType, "model.output.delta");
  assert.equal(merged[0]?.text, "我先解释当前判断。");
});

test("withLiveTranscriptNodes marks live body as completed after output completion settles", () => {
  const merged = withLiveTranscriptNodes([], live({
    outputText: "我先解释当前判断。",
    outputCompleted: true,
    outputSequence: 5,
    updatedAtSequence: 5,
  }));

  assert.equal(merged[0]?.kind, "body");
  assert.equal(merged[0]?.eventType, "model.output.completed");
  assert.equal(merged[0]?.phase, "completed");
  assert.equal(merged[0]?.text, "我先解释当前判断。");
});

test("withLiveTranscriptNodes keeps live body ordered before later tool activity", () => {
  const merged = withLiveTranscriptNodes([
    node({
      nodeId: "tool-requested",
      sequence: 2,
      eventType: "tool.requested",
      kind: "tool",
      phase: "executing",
      summary: "读取 README.md",
    }),
  ], live({
    outputText: "好的！让我来展示一下我的各项能力。",
    outputSequence: 1,
    updatedAtSequence: 3,
  }));

  assert.deepEqual(
    merged
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((item) => `${item.kind}:${item.sequence}`),
    ["body:1", "tool:2"],
  );
});

test("withLiveTranscriptNodes keeps output after a tool in a later body node", () => {
  const live = appendLiveRunEvents("run-1", emptyLiveRun("run-1"), [
    {
      id: "output-before-tool",
      runId: "run-1",
      sequence: 1,
      type: "model.output.delta",
      delta: "我先读取文件。",
      refs: [{ kind: "model_call", id: "model-1" }],
    },
    {
      id: "output-after-tool",
      runId: "run-1",
      sequence: 4,
      type: "model.output.delta",
      delta: "文件已经读取完成。",
      refs: [{ kind: "model_call", id: "model-2" }],
    },
  ]);
  const merged = withLiveTranscriptNodes([
    node({
      nodeId: "tool-completed",
      sequence: 3,
      eventType: "tool.completed",
      kind: "tool",
      phase: "completed",
    }),
  ], live);

  assert.deepEqual(
    merged
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((item) => `${item.kind}:${item.text ?? ""}`),
    ["body:我先读取文件。", "tool:", "body:文件已经读取完成。"],
  );
});

test("withLiveTranscriptNodes replaces existing side text node instead of duplicating it", () => {
  const existing = node({
    nodeId: "side-existing",
    sequence: 1,
    eventType: "model.side.completed",
    kind: "system",
    phase: "completed",
    text: "准备读取文件",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    sideText: "准备读取文件",
    modelRefs: [],
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "side-existing");
  assert.equal(merged[0]?.eventType, "model.output.side");
  assert.equal(merged[0]?.text, "准备读取文件");
});

test("withLiveTranscriptNodes keeps completed body text stable across live to settled handoff", () => {
  const existing = node({
    nodeId: "body-existing",
    sequence: 9,
    eventType: "model.output.completed",
    kind: "body",
    phase: "completed",
    text: "The user is asking",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    outputText: "Theuserisasking",
    outputCompleted: true,
    outputSequence: 8,
    updatedAtSequence: 8,
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "body-existing");
  assert.equal(merged[0]?.eventType, "model.output.completed");
  assert.equal(merged[0]?.phase, "completed");
  assert.equal(merged[0]?.text, "The user is asking");
});

test("withLiveTranscriptNodes does not rewrite a completed body by comparable text alone", () => {
  const existing = node({
    nodeId: "body-existing",
    sequence: 9,
    eventType: "model.output.completed",
    kind: "body",
    phase: "completed",
    text: "先说明当前步骤",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    outputText: "先说明当前步骤，然后继续处理",
    modelRefs: [],
    updatedAtSequence: 10,
  }));

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.nodeId, "body-existing");
  assert.equal(merged[1]?.kind, "body");
  assert.notEqual(merged[1]?.nodeId, "body-existing");
});

test("withLiveTranscriptNodes does not rewrite completed reasoning by comparable text alone", () => {
  const existing = node({
    nodeId: "reasoning-existing",
    sequence: 4,
    eventType: "model.reasoning.completed",
    kind: "thinking",
    phase: "completed",
    text: "先分析目标",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    reasoningText: "先分析目标，再检查约束",
    modelRefs: [],
    updatedAtSequence: 5,
  }));

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.nodeId, "reasoning-existing");
  assert.equal(merged[1]?.kind, "thinking");
  assert.notEqual(merged[1]?.nodeId, "reasoning-existing");
});

test("withLiveTranscriptNodes reuses completed reasoning when the live text is exactly the same", () => {
  const existing = node({
    nodeId: "reasoning-existing",
    sequence: 4,
    eventType: "model.reasoning.completed",
    kind: "thinking",
    phase: "completed",
    text: "先分析目标",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    reasoningText: "先分析目标",
    modelRefs: [],
    updatedAtSequence: 5,
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "reasoning-existing");
});

test("withLiveTranscriptNodes reuses completed body when the live text is exactly the same", () => {
  const existing = node({
    nodeId: "body-existing",
    sequence: 9,
    eventType: "model.output.completed",
    kind: "body",
    phase: "completed",
    text: "先说明当前步骤",
    refs: [],
  });
  const merged = withLiveTranscriptNodes([existing], live({
    outputText: "先说明当前步骤",
    modelRefs: [],
    updatedAtSequence: 10,
  }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.nodeId, "body-existing");
});

test("liveStreamingAnswer uses formal tone after a tool result", () => {
  const answer = liveStreamingAnswer(live({ outputText: "这是最终回答", outputSequence: 5, updatedAtSequence: 5 }), [
    node({
      nodeId: "tool-completed",
      sequence: 4,
      eventType: "tool.completed",
      kind: "tool",
      phase: "completed",
    }),
  ]);

  assert.deepEqual(answer, {
    text: "这是最终回答",
    tone: "formal",
    streaming: true,
  });
});

test("liveStreamingAnswer keeps process tone when later tool events arrive after early output", () => {
  const answer = liveStreamingAnswer(live({
    outputText: "先说明一下接下来会做什么。",
    outputSequence: 1,
    updatedAtSequence: 4,
  }), [
    node({
      nodeId: "tool-completed",
      sequence: 3,
      eventType: "tool.completed",
      kind: "tool",
      phase: "completed",
    }),
  ]);

  assert.deepEqual(answer, {
    text: "先说明一下接下来会做什么。",
    tone: "process",
    streaming: true,
  });
});

test("liveStreamingAnswer falls back to answer node summary", () => {
  const answer = liveStreamingAnswer(undefined, [
    node({
      nodeId: "answer",
      sequence: 6,
      eventType: "final.result",
      kind: "answer",
      phase: "completed",
      summary: "历史结果摘要",
    }),
  ]);

  assert.deepEqual(answer, {
    text: "历史结果摘要",
    tone: "formal",
    streaming: false,
  });
});

test("liveStreamingAnswer strips generated final-result labels from fallback summary", () => {
  const answer = liveStreamingAnswer(undefined, [
    node({
      nodeId: "answer",
      sequence: 6,
      eventType: "final.result",
      kind: "answer",
      phase: "completed",
      summary: "已回答：Hello World",
    }),
  ]);

  assert.deepEqual(answer, {
    text: "Hello World",
    tone: "formal",
    streaming: false,
  });
});

test("projectLiveRunTranscript derives nodes and answer from the same live projection", () => {
  const existingThinking = node({
    nodeId: "reasoning-existing",
    sequence: 1,
    eventType: "model.reasoning.delta",
    kind: "thinking",
    phase: "noted",
    text: "先分析目标",
    refs: [{ kind: "model_call", id: "model-1" }],
  });
  const tool = node({
    nodeId: "tool-completed",
    sequence: 4,
    eventType: "tool.completed",
    kind: "tool",
    phase: "completed",
  });
  const projected = projectLiveRunTranscript([existingThinking, tool], live({
    reasoningText: "先分析目标，再检查约束",
    reasoningCompleted: true,
    outputText: "这是最终回答",
    updatedAtSequence: 5,
  }));

  assert.equal(projected.nodes.filter((item) => item.kind === "thinking").length, 1);
  assert.equal(projected.nodes.find((item) => item.kind === "thinking")?.text, "先分析目标，再检查约束");
  assert.deepEqual(projected.answer, {
    text: "这是最终回答",
    tone: "formal",
    streaming: true,
  });
});

function live(input: {
  readonly outputText?: string;
  readonly outputSequence?: number;
  readonly outputCompleted?: boolean;
  readonly sideText?: string;
  readonly sideTextSequence?: number;
  readonly reasoningText?: string;
  readonly reasoningSequence?: number;
  readonly reasoningCompleted?: boolean;
  readonly modelRefs?: readonly string[];
  readonly updatedAtSequence?: number;
}): LiveRunBuffer {
  return {
    runId: "run-1",
    appliedEventKeys: [],
    tools: [],
    turns: [
      {
        requestId: "model-1",
        output: textStreamAssemblyFromText(input.outputText ?? ""),
        outputSequence: input.outputSequence ?? (input.outputText === undefined ? 0 : input.updatedAtSequence ?? 2),
        outputCompleted: input.outputCompleted ?? false,
        sideText: input.sideText ?? "",
        sideTextSequence: input.sideTextSequence ?? (input.sideText === undefined ? 0 : input.updatedAtSequence ?? 2),
        reasoning: textStreamAssemblyFromText(input.reasoningText ?? ""),
        reasoningSequence: input.reasoningSequence ?? (input.reasoningText === undefined ? 0 : input.updatedAtSequence ?? 2),
        reasoningCompleted: input.reasoningCompleted ?? false,
        modelRefs: input.modelRefs ?? ["model-1"],
        updatedAtSequence: input.updatedAtSequence ?? 2,
      },
    ],
  };
}

function node(input: {
  readonly nodeId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly kind: LiveTranscriptNode["kind"];
  readonly phase: LiveTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly refs?: LiveTranscriptNode["refs"];
}): LiveTranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    summary: input.summary,
    text: input.text,
    timestamp: "2026-01-01T00:00:00.000Z",
    refs: input.refs ?? [],
  };
}
