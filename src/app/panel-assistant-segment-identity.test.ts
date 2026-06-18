import assert from "node:assert/strict";
import test from "node:test";
import { projectAssistantMessageStructure } from "./panel-assistant-message-structure.js";
import type { ProjectableTranscriptNode } from "./panel-transcript-node-projection.js";

test("assistant activity segment identity keeps one key as a tool request completes", () => {
  const requested = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "tool-requested-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.requested",
        phase: "executing",
        summary: "README.md",
        refs: [{ kind: "tool_call", id: "tool-call-1" }],
      }),
    ],
  });
  const completed = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "tool-completed-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
        refs: [{ kind: "tool_call", id: "tool-call-1" }],
      }),
    ],
  });

  assert.equal(activitySegmentKey(requested), "activity:tool-call:run-1:tool-call-1");
  assert.equal(activitySegmentKey(completed), activitySegmentKey(requested));
});

test("assistant activity segment identity ignores late earlier thinking before existing tool work", () => {
  const withoutThinking = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "tool-completed-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
        refs: [{ kind: "tool_call", id: "tool-call-1" }],
      }),
    ],
  });
  const withLateEarlierThinking = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
        refs: [{ kind: "model_call", id: "model-call-1" }],
      }),
      node({
        nodeId: "tool-completed-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
        refs: [{ kind: "tool_call", id: "tool-call-1" }],
      }),
    ],
  });

  assert.deepEqual(
    activitySegments(withLateEarlierThinking)[0]?.timeline.items.map((item) => item.nodeId),
    ["thinking-1", "tool-completed-1"],
  );
  assert.equal(activitySegmentKey(withLateEarlierThinking), activitySegmentKey(withoutThinking));
});

test("assistant activity segment identity uses remaining operational work after duplicate model narrative is removed", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "completed",
        text: "The user wants me to inspect the workspace.",
        refs: [{ kind: "model_call", id: "model-call-1" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "I will inspect the workspace.",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user wants me to inspect the workspace.",
        refs: [{ kind: "model_call", id: "model-call-1" }],
      }),
      node({
        nodeId: "tool-completed-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
        refs: [{ kind: "tool_call", id: "tool-call-1" }],
      }),
    ],
  });

  const segments = activitySegments(structure);

  assert.equal(segments.length, 2);
  assert.deepEqual(segments[1]?.timeline.items.map((item) => item.nodeId), ["tool-completed-1"]);
  assert.equal(segments[1]?.segmentKey, "activity:tool-call:run-1:tool-call-1");
});

test("assistant activity segment identity gives pure model narrative a stable narrative key", () => {
  const firstProjection = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-delta-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "I need to inspect the available project context.",
        refs: [{ kind: "model_call", id: "model-call-1" }],
      }),
    ],
  });
  const replayProjection = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-completed-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "I need to inspect the available project context.",
        refs: [{ kind: "model_call", id: "model-call-1" }],
      }),
    ],
  });

  assert.equal(activitySegmentKey(firstProjection), "activity:narrative:run-1:model-call-1");
  assert.equal(activitySegmentKey(replayProjection), activitySegmentKey(firstProjection));
});

function activitySegments(
  structure: ReturnType<typeof projectAssistantMessageStructure<ProjectableTranscriptNode>>,
) {
  return structure.segments.filter((segment) => segment.kind === "activity");
}

function activitySegmentKey(
  structure: ReturnType<typeof projectAssistantMessageStructure<ProjectableTranscriptNode>>,
): string | undefined {
  return activitySegments(structure)[0]?.segmentKey;
}

function node(input: {
  readonly nodeId: string;
  readonly sequence: number;
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly refs?: ProjectableTranscriptNode["refs"];
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
    refs: input.refs ?? [],
  };
}
