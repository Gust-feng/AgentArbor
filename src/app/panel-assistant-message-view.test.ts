import assert from "node:assert/strict";
import test from "node:test";
import {
  projectAssistantMessageView,
} from "./panel-assistant-message-view.js";
import type { ProjectableTranscriptNode } from "./panel-transcript-node-projection.js";

test("assistant message view keeps the stream placeholder only before first visible output", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [],
    keepStreamMounted: true,
  });

  assert.equal(view.awaitingFirstVisibleOutput, true);
  assert.equal(view.answer, undefined);
});

test("assistant message view suppresses the placeholder once workflow activity is visible", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "正在判断下一步",
      }),
    ],
    keepStreamMounted: true,
  });

  assert.equal(view.hasTimeline, true);
  assert.equal(view.awaitingFirstVisibleOutput, false);
});

test("assistant message view projects answer rendering state outside React", () => {
  const view = projectAssistantMessageView({
    content: "最终回答",
    live: true,
    liveTone: "process",
  });

  assert.deepEqual(view.answer, {
    text: "最终回答",
    copyText: "最终回答",
    showActions: false,
    live: true,
    animateOnMount: false,
    tone: "process",
  });
});

test("assistant message view segments body nodes before the fallback answer", () => {
  const view = projectAssistantMessageView({
    content: "最终回答",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "先说明。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "读取文件",
      }),
    ],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["body", "activity", "body"]);
  assert.equal(view.segments[0]?.kind, "body");
  assert.equal(view.segments[0]?.kind === "body" ? view.segments[0].text : undefined, "先说明。");
  assert.equal(view.segments[1]?.kind, "activity");
  assert.deepEqual(view.segments[1]?.kind === "activity" ? view.segments[1].timeline.items.map((item) => item.nodeId) : [], ["tool-1"]);
  assert.equal(view.segments[2]?.kind, "body");
  assert.equal(view.segments[2]?.kind === "body" ? view.segments[2].text : undefined, "最终回答");
  assert.equal(view.copyText, "先说明。\n\n最终回答");
});

test("assistant message view keeps later reasoning activity after body content arrives", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我先展示文件读取。",
      }),
      node({
        nodeId: "thinking-1",
        sequence: 2,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user wants me to showcase capabilities.",
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

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["body", "activity"]);
  const activity = view.segments[1];
  assert.equal(activity?.kind, "activity");
  assert.deepEqual(activity?.timeline.items.map((item) => item.nodeId), ["thinking-1", "tool-1"]);
  assert.equal(activity?.defaultCollapsed, false);
});

test("assistant message view keeps leading activity before the first visible body", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user wants me to showcase capabilities.",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我先展示文件读取。",
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

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.equal(view.segments[0]?.kind, "activity");
  assert.deepEqual(view.segments[0]?.kind === "activity" ? view.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(view.segments[0]?.kind === "activity" ? view.segments[0].defaultCollapsed : undefined, false);
  assert.equal(view.segments[1]?.kind, "body");
  assert.equal(view.segments[1]?.kind === "body" ? view.segments[1].text : undefined, "我先展示文件读取。");
  assert.equal(view.segments[2]?.kind, "activity");
  assert.deepEqual(view.segments[2]?.kind === "activity" ? view.segments[2].timeline.items.map((item) => item.nodeId) : [], ["tool-1"]);
});

test("assistant message view keeps activity segment keys stable while a stage grows", () => {
  const initial = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "先说明。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.requested",
        phase: "executing",
        summary: "README.md",
      }),
    ],
  });
  const grown = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "先说明。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.requested",
        phase: "executing",
        summary: "README.md",
      }),
      node({
        nodeId: "tool-2",
        sequence: 3,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "package.json",
      }),
    ],
  });

  assert.equal(initial.segments[1]?.kind, "activity");
  assert.equal(grown.segments[1]?.kind, "activity");
  assert.equal(initial.segments[1]?.segmentKey, grown.segments[1]?.segmentKey);
});

test("assistant message view keeps body ordering when an empty body node is present", () => {
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-empty",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "   ",
      }),
      node({
        nodeId: "body-2",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "后续正文。",
      }),
    ],
  });

  assert.equal(view.segments.length, 1);
  const onlySegment = view.segments[0];
  assert.equal(onlySegment?.kind, "body");
  assert.equal(onlySegment?.kind === "body" ? onlySegment.text : undefined, "后续正文。");
});

test("assistant message view keeps body-later activity in chronological order", () => {
  const view = projectAssistantMessageView({
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
        nodeId: "thinking-1",
        sequence: 2,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "Let me think about the next step.",
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第二段正文。",
      }),
    ],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["body", "activity", "body"]);
  assert.equal(view.segments[1]?.kind, "activity");
  assert.deepEqual(view.segments[1]?.kind === "activity" ? view.segments[1].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(view.segments[2]?.kind, "body");
  assert.equal(view.segments[2]?.kind === "body" ? view.segments[2].text : undefined, "第二段正文。");
});

test("assistant message view keeps leading activity before body while collapsing later closed activity", () => {
  const view = projectAssistantMessageView({
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
      node({
        nodeId: "body-2",
        sequence: 4,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第二段正文。",
      }),
    ],
  });

  const activitySegments = view.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 2);
  assert.deepEqual(activitySegments[0]?.timeline.items.map((item) => item.nodeId), ["thinking-1"]);
  assert.equal(activitySegments[0]?.defaultCollapsed, false);
  assert.deepEqual(activitySegments[1]?.timeline.items.map((item) => item.nodeId), ["tool-1"]);
  assert.equal(activitySegments[1]?.defaultCollapsed, true);
});

test("assistant message view keeps failed activity expanded by default even with later content", () => {
  const view = projectAssistantMessageView({
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
        summary: "README.md",
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第二段正文。",
      }),
    ],
  });

  const activitySegments = view.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 1);
  assert.equal(activitySegments[0]?.defaultCollapsed, false);
});

test("assistant message view keeps pending confirmation activity expanded by default", () => {
  const pending = { confirmationId: "confirmation-1", runId: "run-1" };
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我需要确认权限。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "继续执行前需要确认。",
      }),
      node({
        nodeId: "confirmation-node",
        sequence: 4,
        kind: "confirmation",
        eventType: "confirmation.needed",
        phase: "waiting_approval",
        summary: "确认执行命令",
        confirmation: pending,
      }),
    ],
    pending,
  });

  const activitySegments = view.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 2);
  assert.equal(activitySegments[0]?.defaultCollapsed, true);
  assert.equal(activitySegments[1]?.defaultCollapsed, false);
  assert.equal(activitySegments[1]?.timeline.confirmation.current, pending);
});

test("assistant message view keeps visible narration activity between body blocks", () => {
  const view = projectAssistantMessageView({
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
        nodeId: "narration-1",
        sequence: 2,
        kind: "system",
        eventType: "model.side.completed",
        phase: "completed",
        text: "已整理上下文。",
        summary: "已整理上下文。",
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第二段正文。",
      }),
    ],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["body", "activity", "body"]);
  assert.equal(view.segments[1]?.kind, "activity");
  assert.deepEqual(view.segments[1]?.kind === "activity" ? view.segments[1].timeline.items.map((item) => item.nodeId) : [], ["narration-1"]);
});

test("assistant message view keeps leading activity ahead of fallback body once answer copy exists", () => {
  const view = projectAssistantMessageView({
    content: "最终回答",
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
      }),
    ],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.equal(view.segments[0]?.kind, "activity");
  assert.deepEqual(view.segments[0]?.kind === "activity" ? view.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(view.segments[1]?.kind, "body");
  assert.equal(view.segments[1]?.kind === "body" ? view.segments[1].text : undefined, "最终回答");
});

test("assistant message view merges fallback answer into the latest body when the copy overlaps", () => {
  const view = projectAssistantMessageView({
    content: "最终回答",
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

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.equal(view.segments[0]?.kind, "activity");
  assert.deepEqual(view.segments[0]?.kind === "activity" ? view.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(view.segments[1]?.kind, "body");
  assert.equal(view.segments[1]?.kind === "body" ? view.segments[1].text : undefined, "最终回答");
  assert.equal(view.copyText, "最终回答");
});

test("assistant message view suppresses speculative fallback body while a live turn has not emitted a body node", () => {
  const view = projectAssistantMessageView({
    content: "这是预览正文",
    keepStreamMounted: true,
    transcriptNodes: [],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["awaiting"]);
});

test("assistant message view keeps leading activity without speculative fallback body during live work", () => {
  const view = projectAssistantMessageView({
    content: "这是预览正文",
    keepStreamMounted: true,
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先检查下一步。",
      }),
    ],
  });

  assert.deepEqual(view.segments.map((segment) => segment.kind), ["activity"]);
  assert.equal(view.segments[0]?.kind, "activity");
  assert.deepEqual(view.segments[0]?.kind === "activity" ? view.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
});

test("assistant message view keeps live state on the latest body only", () => {
  const view = projectAssistantMessageView({
    content: "",
    live: true,
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "已完成正文。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 2,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.delta",
        phase: "noted",
        text: "正在继续输出",
      }),
    ],
  });

  const bodySegments = view.segments.filter((segment) => segment.kind === "body");

  assert.equal(bodySegments.length, 2);
  assert.equal(bodySegments[0]?.live, false);
  assert.equal(bodySegments[0]?.animateOnMount, false);
  assert.equal(bodySegments[1]?.live, true);
  assert.equal(bodySegments[1]?.animateOnMount, false);
});

test("assistant message view treats pending confirmation as workflow content", () => {
  const pending = { confirmationId: "confirmation-1", runId: "run-1" };
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [],
    pending,
  });

  assert.equal(view.timeline.hasContent, true);
  assert.equal(view.timeline.confirmation.current, pending);
});

test("assistant message view renders a pending confirmation once around body segments", () => {
  const pending = { confirmationId: "confirmation-1", runId: "run-1" };
  const view = projectAssistantMessageView({
    content: "",
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我需要确认权限。",
      }),
      node({
        nodeId: "confirmation-node",
        sequence: 2,
        kind: "confirmation",
        eventType: "confirmation.needed",
        phase: "waiting_approval",
        summary: "确认执行命令",
        confirmation: pending,
      }),
      node({
        nodeId: "body-2",
        sequence: 3,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "确认后继续。",
      }),
    ],
    pending,
  });

  const activitySegments = view.segments.filter((segment) => segment.kind === "activity");

  assert.equal(activitySegments.length, 1);
  assert.equal(activitySegments[0]?.timeline.confirmation.current, pending);
});

function node(input: {
  readonly nodeId?: string;
  readonly sequence?: number;
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly toolName?: string;
  readonly confirmation?: ProjectableTranscriptNode["confirmation"];
}): ProjectableTranscriptNode {
  return {
    nodeId: input.nodeId ?? "node-1",
    runId: "run-1",
    sequence: input.sequence ?? 1,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    toolName: input.toolName,
    confirmation: input.confirmation,
    timestamp: "2026-06-04T00:00:00.000Z",
    refs: [],
  };
}
