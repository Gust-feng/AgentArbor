import assert from "node:assert/strict";
import test from "node:test";
import { projectStableAssistantWorkflowDisplay } from "./panel-assistant-workflow-display.js";

test("assistant workflow display keeps collapsed activity stable once the segment has settled", () => {
  const first = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: true,
  });
  const second = projectStableAssistantWorkflowDisplay({
    previous: first,
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: false,
  });

  assert.equal(first.workflow.segments[0]?.kind, "activity");
  assert.equal(first.workflow.segments[0]?.kind === "activity" ? first.workflow.segments[0].collapsed : undefined, true);
  assert.equal(first.workflow.segments[0]?.kind === "activity" ? first.workflow.segments[0].collapseReason : undefined, "turn_settled");
  assert.equal(second.workflow.segments[0]?.kind, "activity");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapsed : undefined, true);
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapseReason : undefined, "turn_settled");
});

test("assistant workflow display does not reopen a collapsed segment for ordinary later progress", () => {
  const first = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "pnpm test",
      }),
    ],
    collapseTimeline: true,
  });
  const second = projectStableAssistantWorkflowDisplay({
    previous: first,
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.requested",
        phase: "executing",
        summary: "pnpm test",
      }),
    ],
    collapseTimeline: false,
  });

  assert.equal(first.workflow.segments[0]?.kind, "activity");
  assert.equal(first.workflow.segments[0]?.kind === "activity" ? first.workflow.segments[0].collapsed : undefined, true);
  assert.equal(second.workflow.segments[0]?.kind, "activity");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapsed : undefined, true);
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapseReason : undefined, "turn_settled");
});

test("assistant workflow display hides copy actions while the stream stays mounted", () => {
  const display = projectStableAssistantWorkflowDisplay({
    content: "正在输出的正文",
    transcriptNodes: [],
    keepStreamMounted: true,
    collapseTimeline: false,
  });

  assert.equal(display.workflow.showCopyActions, false);
  assert.deepEqual(display.workflow.segments.map((segment) => segment.kind), ["awaiting"]);
});

test("assistant workflow display keeps closed stage content stable when earlier thinking arrives late", () => {
  const first = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: true,
  });
  const second = projectStableAssistantWorkflowDisplay({
    previous: first,
    content: "",
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
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: true,
  });

  assert.equal(first.workflow.segments[0]?.kind, "activity");
  assert.equal(second.workflow.segments[0]?.kind, "activity");
  assert.equal(first.workflow.segments[0]?.kind === "activity" ? first.workflow.segments[0].segmentKey : undefined, "activity:tool-1");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].segmentKey : undefined, "activity:tool-1");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapsed : undefined, true);
  assert.deepEqual(
    second.workflow.segments[0]?.kind === "activity"
      ? second.workflow.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("assistant workflow display auto collapses completed process segments around body content", () => {
  const display = projectStableAssistantWorkflowDisplay({
    content: "",
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
    collapseTimeline: false,
  });

  const activitySegments = display.workflow.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 2);
  assert.deepEqual(activitySegments.map((segment) => segment.collapsed), [true, true]);
  assert.deepEqual(activitySegments.map((segment) => segment.collapseReason), ["structure", "structure"]);
});

test("assistant workflow display keeps context compaction status visible around body content", () => {
  const display = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "主回答正文。",
      }),
      node({
        nodeId: "context-compaction-1",
        sequence: 2,
        kind: "system",
        eventType: "context.compaction.completed",
        phase: "completed",
        summary: "已整理 18 条较早上下文，后续继续当前任务。",
      }),
    ],
    collapseTimeline: true,
  });

  const activity = display.workflow.segments.find((segment) => segment.kind === "activity");

  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.collapsed : undefined, false);
  assert.equal(activity?.kind === "activity" ? activity.collapseReason : undefined, "expanded");
  assert.equal(activity?.kind === "activity" ? activity.timeline.items[0]?.variant : undefined, "context_compaction");
  assert.equal(activity?.kind === "activity" ? activity.timeline.items[0]?.copy.detail : undefined, "上下文压缩完成");
});

test("assistant workflow display keeps attention process segments expanded around body content", () => {
  const display = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第一段正文。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "pnpm test",
      }),
    ],
    collapseTimeline: false,
  });

  const activity = display.workflow.segments.find((segment) => segment.kind === "activity");

  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.collapsed : undefined, false);
  assert.equal(activity?.kind === "activity" ? activity.collapseReason : undefined, "needs_attention");
  assert.equal(activity?.kind === "activity" ? activity.lifecycle : undefined, "attention");
});

test("assistant workflow display closes prefix thinking after body without rewriting it from later replay", () => {
  const first = projectStableAssistantWorkflowDisplay({
    content: "我先检查工作区。",
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "I should inspect the workspace.",
      }),
    ],
    collapseTimeline: false,
  });
  const second = projectStableAssistantWorkflowDisplay({
    previous: first,
    content: "我先检查工作区。",
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "I should inspect the workspace.",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我先检查工作区。",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "I should inspect the workspace before editing files.",
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: false,
  });

  const activitySegments = second.workflow.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 2);
  assert.equal(activitySegments[0]?.collapsed, true);
  assert.equal(activitySegments[0]?.lifecycle, "settled");
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), [
    "I should inspect the workspace.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["README.md"]);
});

test("assistant workflow display reopens a previously collapsed segment when it needs attention", () => {
  const first = projectStableAssistantWorkflowDisplay({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "pnpm test",
      }),
    ],
    collapseTimeline: true,
  });
  const second = projectStableAssistantWorkflowDisplay({
    previous: first,
    content: "",
    transcriptNodes: [
      node({
        nodeId: "tool-1",
        sequence: 1,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "pnpm test",
      }),
    ],
    collapseTimeline: true,
  });

  assert.equal(first.workflow.segments[0]?.kind, "activity");
  assert.equal(first.workflow.segments[0]?.kind === "activity" ? first.workflow.segments[0].collapsed : undefined, true);
  assert.equal(second.workflow.segments[0]?.kind, "activity");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapsed : undefined, false);
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].collapseReason : undefined, "needs_attention");
  assert.equal(second.workflow.segments[0]?.kind === "activity" ? second.workflow.segments[0].lifecycle : undefined, "attention");
});

test("assistant workflow display exposes segment lifecycle for observation", () => {
  const display = projectStableAssistantWorkflowDisplay({
    content: "",
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
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第一段正文。",
      }),
      node({
        nodeId: "tool-settled",
        sequence: 3,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
    collapseTimeline: false,
  });

  const segments = display.workflow.segments;

  assert.equal(segments[0]?.kind, "activity");
  assert.equal(segments[0]?.kind === "activity" ? segments[0].lifecycle : undefined, "open");
  assert.equal(segments[1]?.kind, "body");
  assert.equal(segments[1]?.kind === "body" ? segments[1].lifecycle : undefined, "settled");
  assert.equal(segments[2]?.kind, "activity");
  assert.equal(segments[2]?.kind === "activity" ? segments[2].lifecycle : undefined, "settled");
});

function node(input: {
  readonly nodeId: string;
  readonly sequence: number;
  readonly kind: "thinking" | "tool" | "confirmation" | "user_decision" | "answer" | "body" | "system";
  readonly eventType: string;
  readonly phase: "noted" | "preparing" | "waiting_approval" | "approved" | "denied" | "guidance" | "executing" | "completed" | "failed" | "blocked" | "cancelled";
  readonly text?: string;
  readonly summary?: string;
  readonly display?: {
    readonly kind: "file_change_summary" | "file_diff_preview";
    readonly path?: string;
    readonly replacements?: number;
    readonly preview?: string;
  };
}) {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: "",
    summary: input.summary ?? input.text,
    text: input.text,
    display: input.display,
    timestamp: "",
    refs: [],
  };
}
