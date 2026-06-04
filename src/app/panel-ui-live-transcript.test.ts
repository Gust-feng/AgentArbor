import assert from "node:assert/strict";
import test from "node:test";
import {
  liveStreamingAnswer,
  projectLiveRunTranscript,
  withLiveTranscriptNodes,
  type LiveTranscriptNode,
} from "./panel-ui-live-transcript.js";
import type { LiveRunBuffer } from "./panel-ui-live-run-buffer.js";
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

test("liveStreamingAnswer uses formal tone after a tool result", () => {
  const answer = liveStreamingAnswer(live({ outputText: "这是最终回答", updatedAtSequence: 5 }), [
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
  readonly sideText?: string;
  readonly reasoningText?: string;
  readonly reasoningCompleted?: boolean;
  readonly modelRefs?: readonly string[];
  readonly updatedAtSequence?: number;
}): LiveRunBuffer {
  return {
    runId: "run-1",
    appliedEventKeys: [],
    turns: [
      {
        requestId: "model-1",
        output: textStreamAssemblyFromText(input.outputText ?? ""),
        sideText: input.sideText ?? "",
        reasoning: textStreamAssemblyFromText(input.reasoningText ?? ""),
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
