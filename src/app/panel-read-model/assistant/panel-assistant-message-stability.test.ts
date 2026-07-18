import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessageView } from "./panel-assistant-message-view.js";
import type { AssistantMessageSegmentLifecycle } from "./panel-assistant-message-structure.js";
import { stabilizeAssistantMessageView } from "./panel-assistant-message-stability.js";
import type { ProjectableTranscriptNode } from "../transcript/panel-transcript-node-projection.js";

test("assistant message stability does not append late pre-body activity after rendered history", () => {
  const previous = view([
    body("body:fallback", "好的！让我来展示一下我的各项能力。", true),
  ]);
  const next = view([
    activity("activity:thinking-1", ["thinking-1"], false),
    body("body:live-1", "好的！让我来展示一下我的各项能力。", true),
    activity("activity:tool-1", ["tool-1"], false),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["body", "activity"]);
  assert.equal(stabilized.segments[0]?.kind, "body");
  assert.equal(stabilized.segments[0]?.kind === "body" ? stabilized.segments[0].segmentKey : undefined, "body:fallback");
  assert.deepEqual(
    stabilized.segments[1]?.kind === "activity"
      ? stabilized.segments[1].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("assistant message stability preserves already shown thinking when a later projection omits it", () => {
  const previous = view([
    activity("activity:thinking-1", ["thinking-1"], false),
    body("body:1", "第一段正文。", false),
  ]);
  const next = view([
    body("body:1", "第一段正文。", false),
    activity("activity:tool-1", ["tool-1"], true),
    body("body:2", "第二段正文。", true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity", "body"]);
  assert.equal(stabilized.segments[0]?.kind, "activity");
  assert.deepEqual(stabilized.segments[0]?.kind === "activity" ? stabilized.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
});

test("assistant message stability keeps post-tool model progress in the workflow", () => {
  const tool = activity("activity:tool-1", ["tool-1"], false, "tool");
  const progress = activityWithPhases("activity:tool-1", [
    { nodeId: "tool-1", detail: "tool-1", tone: "tool", phase: "completed" },
    { nodeId: "model-request", detail: "分析工具结果", tone: "thinking", phase: "executing" },
  ], false);
  const previous = view([tool]);
  const waitingView = stabilizeAssistantMessageView(previous, view([progress]));

  assert.deepEqual(waitingView.segments.map((segment) => segment.kind), ["activity"]);
  assert.deepEqual(
    waitingView.segments[0]?.kind === "activity"
      ? waitingView.segments[0].timeline.items.map((item) => item.copy.detail)
      : [],
    ["tool-1", "分析工具结果"],
  );

  const continued = stabilizeAssistantMessageView(waitingView, view([
    progress,
    body("body:continued", "继续执行下一步。", true),
  ]));
  assert.deepEqual(continued.segments.map((segment) => segment.kind), ["activity", "body"]);
});

test("assistant message stability closes thinking as soon as the next projection renders body after it", () => {
  const previous = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:live", "I will inspect the workspace first.", true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body"]);
  const activitySegment = stabilized.segments[0];
  assert.equal(activitySegment?.kind, "activity");
  assert.equal(activitySegment?.kind === "activity" ? activitySegment.lifecycle : undefined, "settled");
  assert.equal(
    activitySegment?.kind === "activity"
      ? activitySegment.timeline.items[0]?.phase
      : undefined,
    "completed",
  );
});

test("assistant message stability closes thinking on standalone to turn migration", () => {
  const previous = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:live", "I will inspect the workspace first.", true),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:settled", "I will inspect the workspace first.", false),
    mixedActivity("activity:after-body", [
      {
        nodeId: "thinking-settled",
        detail: "I should inspect the workspace before editing files.",
        tone: "thinking",
      },
      {
        nodeId: "tool-1",
        detail: "README.md",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.equal(activitySegments[0]?.lifecycle, "settled");
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), [
    "I should inspect the workspace.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["README.md"]);
});

test("assistant message stability ignores late pre-body thinking after the body and tool are already rendered", () => {
  const previous = view([
    body("body:live", "Let me showcase my capabilities by exploring the workspace.", true),
    activity("activity:tool-1", ["latest AI agent development trends 2025"], true, "tool"),
  ]);
  const next = view([
    activity("activity:thinking-1", [
      "The user is asking me to demonstrate my capabilities. Let me showcase what I can do by exploring the current workspace and showing various abilities.",
    ], false, "thinking"),
    body("body:settled", "Let me showcase my capabilities by exploring the workspace.", false),
    activity("activity:tool-1", ["latest AI agent development trends 2025"], true, "tool"),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["body", "activity"]);
  assert.equal(stabilized.segments[0]?.kind, "body");
  assert.equal(stabilized.segments[0]?.kind === "body" ? stabilized.segments[0].segmentKey : undefined, "body:live");
  assert.deepEqual(
    stabilized.segments[1]?.kind === "activity"
      ? stabilized.segments[1].timeline.items.map((item) => item.copy.detail)
      : [],
    ["latest AI agent development trends 2025"],
  );
});

test("assistant message stability does not duplicate the same thinking when live and settled activity use different segment keys", () => {
  const previous = view([
    activity("activity:live-thinking", ["The user is asking me to demonstrate my capabilities."], false),
    body("body:fallback", "Let me showcase my capabilities by exploring the workspace.", true),
  ]);
  const next = view([
    body("body:settled", "Let me showcase my capabilities by exploring the workspace.", false),
    activity("activity:settled-thinking", ["The user is asking me to demonstrate my capabilities."], false),
    activity("activity:tool-1", ["tool-1"], true, "tool"),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.equal(activitySegments.length, 2);
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), ["The user is asking me to demonstrate my capabilities."]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["tool-1"]);
});

test("assistant message stability does not duplicate the same model activity when settled narration replaces earlier thinking", () => {
  const previous = view([
    activity("activity:live-thinking", ["The user is asking me to demonstrate my capabilities."], false, "thinking"),
    body("body:fallback", "Let me showcase my capabilities by exploring the workspace.", true),
  ]);
  const next = view([
    body("body:settled", "Let me showcase my capabilities by exploring the workspace.", false),
    activity("activity:settled-side", ["The user is asking me to demonstrate my capabilities."], false, "narration"),
    activity("activity:tool-1", ["tool-1"], true, "tool"),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.equal(activitySegments.length, 2);
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), ["The user is asking me to demonstrate my capabilities."]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["tool-1"]);
});

test("assistant message stability trims repeated thinking from a later activity that also contains new tool work", () => {
  const previous = view([
    activity("activity:live-thinking", ["The user is asking me to demonstrate my capabilities."], false, "thinking"),
    body("body:fallback", "Let me showcase my capabilities by exploring the workspace.", true),
  ]);
  const next = view([
    activity("activity:thinking-live", ["The user is asking me to demonstrate my capabilities."], false, "thinking"),
    body("body:settled", "Let me showcase my capabilities by exploring the workspace.", false),
    mixedActivity("activity:thinking-settled", [
      {
        nodeId: "thinking-settled",
        detail: "The user is asking me to demonstrate my capabilities.",
        tone: "thinking",
      },
      {
        nodeId: "tool-1",
        detail: "latest AI agent development trends 2025",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), [
    "The user is asking me to demonstrate my capabilities.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), [
    "latest AI agent development trends 2025",
  ]);
  assert.equal(activitySegments[1]?.segmentKey, "activity:tool-1");
});

test("assistant message stability removes repeated thinking from later activity after body while preserving tool work", () => {
  const previous = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace before answering.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:live", "I will inspect the workspace first.", true),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace before answering.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:settled", "I will inspect the workspace first.", false),
    mixedActivity("activity:after-body", [
      {
        nodeId: "thinking-settled",
        detail: "I should inspect the workspace before answering.",
        tone: "thinking",
      },
      {
        nodeId: "tool-1",
        detail: "README.md",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), [
    "I should inspect the workspace before answering.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["README.md"]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.tone), ["tool"]);
});

test("assistant message stability closes already-rendered prefix thinking without rewriting its copy", () => {
  const previous = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:live", "I will inspect the workspace first.", true),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:settled", "I will inspect the workspace first.", false),
    mixedActivity("activity:after-body", [
      {
        nodeId: "thinking-settled",
        detail: "I should inspect the workspace before editing files.",
        tone: "narration",
      },
      {
        nodeId: "tool-1",
        detail: "README.md",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.equal(
    activitySegments[0]?.timeline.items[0]?.copy.detail,
    "I should inspect the workspace.",
  );
  assert.equal(activitySegments[0]?.timeline.items[0]?.nodeId, "thinking-live");
  assert.equal(activitySegments[0]?.timeline.items[0]?.phase, "completed");
  assert.equal(activitySegments[0]?.lifecycle, "settled");
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["README.md"]);
});

test("assistant message stability keeps settled narrative unchanged when a late fuller copy repeats it", () => {
  const previous = view([
    activityWithPhases("activity:thinking-settled", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "completed",
      },
    ], false),
    body("body:settled", "I will inspect the workspace first.", false),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-settled", [
      {
        nodeId: "thinking-live",
        detail: "I should inspect the workspace.",
        tone: "thinking",
        phase: "completed",
      },
    ], false),
    body("body:settled", "I will inspect the workspace first.", false),
    mixedActivity("activity:after-body", [
      {
        nodeId: "thinking-late",
        detail: "I should inspect the workspace before editing files.",
        tone: "narration",
      },
      {
        nodeId: "tool-1",
        detail: "README.md",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.equal(activitySegments[0]?.timeline.items[0]?.copy.detail, "I should inspect the workspace.");
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), ["README.md"]);
});

test("assistant message stability removes repeated model narration from a cold settled projection", () => {
  const stabilized = stabilizeAssistantMessageView(undefined, view([
    activity("activity:thinking-1", ["The user is asking me to demonstrate my capabilities."], false),
    body("body:1", "Let me showcase my capabilities by exploring the workspace.", false),
    mixedActivity("activity:after-body", [
      {
        nodeId: "side-settled",
        detail: "The user is asking me to demonstrate my capabilities.",
        tone: "narration",
      },
      {
        nodeId: "tool-1",
        detail: "latest AI agent development trends 2025",
        tone: "tool",
      },
    ], true),
  ]));

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.copy.detail), [
    "The user is asking me to demonstrate my capabilities.",
  ]);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.copy.detail), [
    "latest AI agent development trends 2025",
  ]);
});

test("assistant message stability recomputes lifecycle after trimming represented thinking", () => {
  const previous = view([
    activityWithPhases("activity:live-thinking", [
      {
        nodeId: "thinking-live",
        detail: "The user is asking me to demonstrate my capabilities.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:fallback", "Let me showcase my capabilities by exploring the workspace.", true),
  ]);
  const next = view([
    activityWithPhases("activity:thinking-live", [
      {
        nodeId: "thinking-live",
        detail: "The user is asking me to demonstrate my capabilities.",
        tone: "thinking",
        phase: "noted",
      },
    ], false),
    body("body:settled", "Let me showcase my capabilities by exploring the workspace.", false),
    mixedActivity("activity:thinking-settled", [
      {
        nodeId: "thinking-settled",
        detail: "The user is asking me to demonstrate my capabilities.",
        tone: "thinking",
      },
      {
        nodeId: "tool-1",
        detail: "README.md",
        tone: "tool",
      },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);
  const activitySegments = stabilized.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments[1]?.segmentKey, "activity:tool-1");
  assert.equal(activitySegments[1]?.lifecycle, "settled");
});

test("assistant message stability preserves a single confirmation activity when a pending placeholder becomes a confirmation node", () => {
  const pending = { confirmationId: "confirmation-1", ownerRunId: "run-1" };
  const previous = view([
    body("body:1", "我需要确认权限。", false),
    confirmationActivity("activity:pending:confirmation-1", pending),
  ]);
  const next = view([
    body("body:1", "我需要确认权限。", false),
    confirmationActivity("activity:confirmation-node", pending, "confirmation-node"),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["body", "activity"]);
  assert.equal(stabilized.segments[1]?.kind, "activity");
  assert.equal(
    stabilized.segments[1]?.kind === "activity"
      ? stabilized.segments[1].timeline.confirmation.current?.confirmationId
      : undefined,
    "confirmation-1",
  );
});

test("assistant message stability keeps closed activity content frozen when earlier thinking arrives late", () => {
  const previous = view([
    body("body:1", "第一段正文。", false),
    activity("activity:tool-1", ["tool-1"], false, "tool"),
  ]);
  const next = view([
    body("body:1", "第一段正文。", false),
    mixedActivity("activity:thinking-1", [
      { nodeId: "thinking-1", detail: "Let me think about the next step.", tone: "thinking" },
      { nodeId: "tool-1", detail: "tool-1", tone: "tool" },
    ], false),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["body", "activity"]);
  assert.equal(stabilized.segments[1]?.kind, "activity");
  assert.deepEqual(
    stabilized.segments[1]?.kind === "activity" ? stabilized.segments[1].timeline.items.map((item) => item.copy.detail) : [],
    ["tool-1"],
  );
});

test("assistant message stability keeps rendered body when the next projection temporarily empties", () => {
  const previous = view([
    body("body:1", "稳定正文。", false),
  ]);
  const next = view([]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.deepEqual(stabilized.segments.map((segment) => segment.kind), ["body"]);
  assert.equal(stabilized.copyText, "稳定正文。");
});

test("assistant message stability keeps activity collapse hint stable once the segment has appeared", () => {
  const previous = view([
    activity("activity:tool-1", ["tool-1"], false),
  ]);
  const next = view([
    activity("activity:tool-1", ["tool-1"], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.equal(stabilized.segments[0]?.kind, "activity");
  assert.equal(stabilized.segments[0]?.kind === "activity" ? stabilized.segments[0].defaultCollapsed : undefined, true);
  assert.deepEqual(
    stabilized.segments[0]?.kind === "activity" ? stabilized.segments[0].timeline.items.map((item) => item.nodeId) : [],
    ["tool-1"],
  );
});

test("assistant message stability allows only the open tail activity to grow", () => {
  const previous = view([
    body("body:1", "第一段正文。", false),
    activityWithPhases("activity:tool-1", [
      { nodeId: "tool-1", detail: "tool-1", tone: "tool", phase: "executing" },
    ], false),
  ]);
  const next = view([
    body("body:1", "第一段正文。", false),
    activityWithPhases("activity:tool-1", [
      { nodeId: "tool-1", detail: "tool-1", tone: "tool", phase: "completed" },
      { nodeId: "tool-2", detail: "tool-2", tone: "tool", phase: "completed" },
    ], true),
  ]);

  const stabilized = stabilizeAssistantMessageView(previous, next);

  assert.equal(stabilized.segments[1]?.kind, "activity");
  assert.deepEqual(
    stabilized.segments[1]?.kind === "activity" ? stabilized.segments[1].timeline.items.map((item) => item.nodeId) : [],
    ["tool-1", "tool-2"],
  );
  assert.equal(stabilized.segments[1]?.kind === "activity" ? stabilized.segments[1].defaultCollapsed : undefined, true);
});

function view(
  segments: AssistantMessageView<ProjectableTranscriptNode>["segments"],
): AssistantMessageView<ProjectableTranscriptNode> {
  return {
    timeline: {
      nodes: [],
      items: [],
      confirmation: { current: undefined, currentNodeId: undefined },
      hasContent: segments.some((segment) => segment.kind === "activity"),
    },
    hasTimeline: segments.some((segment) => segment.kind === "activity"),
    awaitingFirstVisibleOutput: segments.some((segment) => segment.kind === "awaiting" && segment.reason === "initial"),
    answer: undefined,
    segments,
    copyText: segments
      .filter((segment): segment is Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "body" }> => segment.kind === "body")
      .map((segment) => segment.copyText)
      .join("\n\n"),
  };
}

function activity(
  segmentKey: string,
  details: readonly string[],
  defaultCollapsed: boolean,
  tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "system" = "thinking",
): Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "activity" }> {
  return mixedActivity(
    segmentKey,
    details.map((detail) => ({ nodeId: detail, detail, tone })),
    defaultCollapsed,
  );
}

function mixedActivity(
  segmentKey: string,
  items: readonly {
    readonly nodeId: string;
    readonly detail: string;
    readonly tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "system";
  }[],
  defaultCollapsed: boolean,
): Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "activity" }> {
  return activityWithPhases(
    segmentKey,
    items.map((item) => ({ ...item, phase: "completed" as const })),
    defaultCollapsed,
  );
}

function activityWithPhases(
  segmentKey: string,
  items: readonly {
    readonly nodeId: string;
    readonly detail: string;
    readonly tone: "thinking" | "narration" | "tool" | "confirmation" | "decision" | "system";
    readonly phase: ProjectableTranscriptNode["phase"];
  }[],
  defaultCollapsed: boolean,
): Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "activity" }> {
  return {
    kind: "activity",
    segmentKey,
    lifecycle: activityLifecycle(items),
    defaultCollapsed,
    timeline: {
      nodes: [],
      items: items.map((item) => ({
        nodeId: item.nodeId,
        key: item.nodeId,
        eventType: item.tone === "thinking"
          ? "model.reasoning.completed"
          : item.tone === "narration" ? "model.side.completed" : "test.activity",
        copy: { detail: item.detail },
        tone: item.tone,
        phase: item.phase,
      })),
      confirmation: { current: undefined, currentNodeId: undefined },
      hasContent: true,
    },
  };
}

function confirmationActivity(
  segmentKey: string,
  pending: { readonly confirmationId: string; readonly ownerRunId: string },
  currentNodeId?: string,
): Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "activity" }> {
  return {
    kind: "activity",
    segmentKey,
    lifecycle: "attention",
    defaultCollapsed: false,
    timeline: {
      nodes: [],
      items: [],
      confirmation: { current: pending, currentNodeId },
      hasContent: true,
    },
  };
}

function body(
  segmentKey: string,
  text: string,
  live: boolean,
): Extract<AssistantMessageView<ProjectableTranscriptNode>["segments"][number], { readonly kind: "body" }> {
  return {
    kind: "body",
    segmentKey,
    lifecycle: live ? "open" : "settled",
    text,
    copyText: text,
    live,
    animateOnMount: live,
    tone: "formal",
  };
}

function activityLifecycle(items: readonly { readonly phase: ProjectableTranscriptNode["phase"] }[]): AssistantMessageSegmentLifecycle {
  if (items.some((item) => item.phase === "failed" || item.phase === "blocked" || item.phase === "waiting_approval")) {
    return "attention";
  }
  if (items.some((item) => item.phase === "noted" || item.phase === "preparing" || item.phase === "executing")) {
    return "open";
  }
  return "settled";
}
