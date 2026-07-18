import assert from "node:assert/strict";
import test from "node:test";
import { projectAssistantMessageStructure } from "./panel-assistant-message-structure.js";
import type { ProjectableTranscriptNode } from "../transcript/panel-transcript-node-projection.js";

test("assistant message structure keeps reasoning and tool activity around the first visible body", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第一段正文。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 3,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.equal(body?.kind === "body" ? body.text : undefined, "第一段正文。");
  assert.deepEqual(activityNodeIds(structure), ["thinking-1", "tool-1"]);
});

test("assistant message structure deduplicates live and settled reasoning without merging it into the answer", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "The user is asking me to demonstrate capabilities.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities.",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate capabilities and inspect the workspace.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.deepEqual(activityNodeIds(structure), ["thinking-live"]);
});

test("assistant message structure keeps tool activity after body alongside reasoning", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.deepEqual(activityNodeIds(structure), ["thinking-live", "tool-1"]);
});

test("assistant message structure keeps post-body reasoning and deduplicates identical snapshots", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "thinking-live",
        sequence: 2,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-live" }],
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["body", "activity"]);
  const activity = structure.segments[1]?.kind === "activity" ? structure.segments[1] : undefined;
  assert.deepEqual(activity?.timeline.items.map((item) => item.nodeId), ["thinking-live", "tool-1"]);
  assert.equal(activity?.timeline.items.some((item) => item.copy.expandedDetail?.includes("demonstrate")), true);
});

test("assistant message structure deduplicates provider side narration already represented by reasoning", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-live" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "side-settled",
        sequence: 3,
        kind: "system",
        eventType: "model.side.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        summary: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.deepEqual(activityNodeIds(structure), ["thinking-live", "tool-1"]);
});

test("assistant message structure exposes segment lifecycle", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-open",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "正在判断下一步。",
      }),
      node({
        nodeId: "body-live",
        sequence: 2,
        kind: "body",
        eventType: "model.output.delta",
        phase: "noted",
        text: "正在输出正文",
      }),
      node({
        nodeId: "tool-failed",
        sequence: 3,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "pnpm test",
      }),
    ],
  });

  assert.deepEqual(
    structure.segments.map((segment) => segment.kind === "activity" ? segment.lifecycle : segment.lifecycle),
    ["open", "open", "attention"],
  );
});

test("assistant message structure keeps model usage on the matching answer body", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "最终回答。",
        modelUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
          latencyMs: 1_500,
          firstTokenLatencyMs: 300,
          outputDurationMs: 1_200,
          outputTokensPerSecond: 20.83,
        },
      }),
    ],
  });

  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.deepEqual(body?.kind === "body" ? body.modelUsage : undefined, {
    inputTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    latencyMs: 1_500,
    firstTokenLatencyMs: 300,
    outputDurationMs: 1_200,
    outputTokensPerSecond: 20.83,
  });
});

test("assistant message structure applies final-result model usage to fallback answer bodies", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "直接回答。",
    transcriptNodes: [
      node({
        nodeId: "answer-1",
        sequence: 1,
        kind: "answer",
        eventType: "final.result",
        phase: "completed",
        summary: "直接回答。",
        modelUsage: {
          inputTokens: 12,
          outputTokens: 6,
          totalTokens: 18,
          latencyMs: 800,
        },
      }),
    ],
  });

  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.deepEqual(body?.kind === "body" ? body.modelUsage : undefined, {
    inputTokens: 12,
    outputTokens: 6,
    totalTokens: 18,
    latencyMs: 800,
  });
});

test("assistant message structure merges fallback answer into the latest body when the copy overlaps", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "最终回答",
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "最终",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body"]);
  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.equal(body?.kind === "body" ? body.text : undefined, "最终回答");
  assert.equal(structure.copyText, "最终回答");
});

test("assistant message structure suppresses speculative fallback body while a live turn has not emitted a body node", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "这是预览正文",
    keepStreamMounted: true,
    transcriptNodes: [],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["awaiting"]);
  assert.equal(structure.awaitingFirstVisibleOutput, true);
});

test("assistant message structure keeps waiting while only the internal model request is visible", () => {
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [node({
      nodeId: "model-request",
      sequence: 1,
      kind: "system",
      eventType: "model.requested",
      phase: "executing",
      summary: "准备模型请求",
    })],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["awaiting"]);
  assert.equal(structure.awaitingFirstVisibleOutput, true);
});

test("assistant message structure keeps waiting through successful prefatory context compaction", () => {
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [
      node({
        nodeId: "compaction-requested",
        sequence: 1,
        kind: "system",
        eventType: "context.compaction.requested",
        phase: "executing",
        summary: "正在上下文压缩",
      }),
      node({
        nodeId: "compaction-completed",
        sequence: 2,
        kind: "system",
        eventType: "context.compaction.completed",
        phase: "completed",
        summary: "上下文压缩完成",
      }),
      node({
        nodeId: "model-request",
        sequence: 3,
        kind: "system",
        eventType: "model.requested",
        phase: "executing",
        summary: "准备模型请求",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["awaiting"]);
  assert.equal(structure.awaitingFirstVisibleOutput, true);
});

test("assistant message structure removes waiting on reasoning and side narration", () => {
  const cases = [
    node({
      nodeId: "reasoning",
      sequence: 1,
      kind: "thinking",
      eventType: "model.reasoning.delta",
      phase: "noted",
      text: "正在分析当前问题。",
    }),
    node({
      nodeId: "side-output",
      sequence: 1,
      kind: "system",
      eventType: "model.side.completed",
      phase: "completed",
      text: "我先检查相关文件。",
    }),
  ];

  for (const activity of cases) {
    const structure = projectAssistantMessageStructure({
      keepStreamMounted: true,
      transcriptNodes: [activity],
    });
    assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
    assert.equal(structure.awaitingFirstVisibleOutput, false);
  }
});

test("assistant message structure removes waiting on failure or cancellation", () => {
  const cases = [
    node({
      nodeId: "compaction-failed",
      sequence: 1,
      kind: "system",
      eventType: "context.compaction.failed",
      phase: "failed",
      summary: "上下文压缩失败",
    }),
    node({
      nodeId: "run-cancelled",
      sequence: 1,
      kind: "system",
      eventType: "run.cancelled",
      phase: "cancelled",
      summary: "任务已取消",
    }),
  ];

  for (const activity of cases) {
    const structure = projectAssistantMessageStructure({
      keepStreamMounted: true,
      transcriptNodes: [activity],
    });
    assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
    assert.equal(structure.awaitingFirstVisibleOutput, false);
  }
});

test("assistant message structure never hides pending confirmation behind waiting", () => {
  const pending = { confirmationId: "confirmation-1", ownerRunId: "run-1" };
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [node({
      nodeId: "model-request",
      sequence: 1,
      kind: "system",
      eventType: "model.requested",
      phase: "executing",
      summary: "准备模型请求",
    })],
    pending,
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
  assert.equal(structure.awaitingFirstVisibleOutput, false);
  assert.equal(structure.segments[0]?.kind === "activity"
    ? structure.segments[0].timeline.confirmation.current
    : undefined, pending);
});

test("assistant message structure removes the waiting indicator on the first live body", () => {
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [node({
      nodeId: "live-body",
      sequence: 1,
      kind: "body",
      eventType: "model.output.delta",
      phase: "noted",
      text: "我先检查当前问题。",
    })],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["body"]);
  assert.equal(structure.awaitingFirstVisibleOutput, false);
});

test("assistant message structure keeps post-tool continuation inside the workflow activity", () => {
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [
      node({
        nodeId: "tool-completed",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "当前目录",
      }),
      node({
        nodeId: "model-request",
        sequence: 2,
        kind: "system",
        eventType: "model.requested",
        phase: "executing",
        summary: "分析工具结果",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
  assert.deepEqual(
    structure.segments[0]?.kind === "activity"
      ? structure.segments[0].timeline.items.map((item) => item.copy.detail)
      : [],
    ["当前目录", "分析工具结果"],
  );
  assert.equal(structure.awaitingFirstVisibleOutput, false);
});

test("assistant message structure does not duplicate waiting state while a tool is executing", () => {
  const structure = projectAssistantMessageStructure({
    keepStreamMounted: true,
    transcriptNodes: [
      node({
        nodeId: "tool-executing",
        sequence: 1,
        kind: "tool",
        eventType: "tool.requested",
        phase: "executing",
        summary: "当前目录",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
});

function node(input: {
  readonly nodeId: string;
  readonly sequence: number;
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly refs?: ProjectableTranscriptNode["refs"];
  readonly modelUsage?: ProjectableTranscriptNode["modelUsage"];
}): ProjectableTranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    timestamp: "2026-06-18T00:00:00.000Z",
    modelUsage: input.modelUsage,
    refs: input.refs ?? [],
  };
}

function activityNodeIds(
  structure: ReturnType<typeof projectAssistantMessageStructure<ProjectableTranscriptNode>>,
): readonly string[] {
  return structure.segments.flatMap((segment) =>
    segment.kind === "activity" ? segment.timeline.items.map((item) => item.nodeId) : []);
}
