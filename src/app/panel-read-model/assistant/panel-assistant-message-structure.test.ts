import assert from "node:assert/strict";
import test from "node:test";
import { projectAssistantMessageStructure } from "./panel-assistant-message-structure.js";
import type { ProjectableTranscriptNode } from "../transcript/panel-transcript-node-projection.js";

test("assistant message structure keeps leading activity before the first visible body", () => {
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
  assert.equal(structure.segments[0]?.kind, "activity");
  assert.deepEqual(structure.segments[0]?.kind === "activity" ? structure.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(structure.segments[1]?.kind, "body");
  assert.equal(structure.segments[1]?.kind === "body" ? structure.segments[1].text : undefined, "第一段正文。");
});

test("assistant message structure uses merged activity nodes instead of stale raw duplicates", () => {
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
  assert.equal(structure.segments[0]?.kind, "activity");
  const activity = structure.segments[0]?.kind === "activity" ? structure.segments[0] : undefined;
  assert.equal(activity?.timeline.items.length, 1);
  assert.equal(activity?.timeline.items[0]?.nodeId, "thinking-live");
  assert.equal(
    activity?.timeline.items[0]?.copy.detail,
    "思考中",
  );
  assert.equal(
    activity?.timeline.items[0]?.copy.expandedDetail,
    "The user is asking me to demonstrate capabilities and inspect the workspace.",
  );
});

test("assistant message structure keeps repeated thinking from splitting the workflow after body", () => {
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
  assert.deepEqual(
    structure.segments[0]?.kind === "activity"
      ? structure.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-live"],
  );
  assert.deepEqual(
    structure.segments[2]?.kind === "activity"
      ? structure.segments[2].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("assistant message structure removes repeated thinking inside one post-body activity segment", () => {
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
  assert.deepEqual(activity?.timeline.items.map((item) => item.copy.detail), [
    "思考中",
    "latest AI agent development trends 2025",
  ]);
  assert.equal(
    activity?.timeline.items[0]?.copy.expandedDetail,
    "The user is asking me to demonstrate my capabilities.",
  );
});

test("assistant message structure removes repeated narration from the same cold projection", () => {
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
  assert.deepEqual(
    structure.segments[0]?.kind === "activity"
      ? structure.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-live"],
  );
  assert.deepEqual(
    structure.segments[2]?.kind === "activity"
      ? structure.segments[2].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
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
  assert.equal(structure.segments[1]?.kind, "body");
  assert.equal(structure.segments[1]?.kind === "body" ? structure.segments[1].text : undefined, "最终回答");
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
