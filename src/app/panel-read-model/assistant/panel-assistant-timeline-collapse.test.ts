import assert from "node:assert/strict";
import test from "node:test";
import {
  activeTimelineStatus,
  collapsedTimelineSummary,
  isSettledTimelineStatus,
  shouldAutoCollapseTimelineSegment,
  shouldCollapseStandaloneTimeline,
  shouldCollapseTimelineAfterTurn,
  timelineCollapseDecision,
} from "./panel-assistant-timeline-collapse.js";

test("historical settled turn stays collapsed while another run is active", () => {
  assert.equal(shouldCollapseTimelineAfterTurn({
    displayRunId: "run-settled",
    live: false,
    run: { runId: "run-active", status: "running" },
    turnStatus: "completed",
  }), true);

  assert.equal(shouldCollapseTimelineAfterTurn({
    displayRunId: "run-active",
    live: false,
    run: { runId: "run-active", status: "running" },
    turnStatus: "completed",
  }), false);
});

test("failed blocked and waiting approval activity stay expanded during auto collapse", () => {
  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "failed", copy: { label: "命令", detail: "pnpm test" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: false,
  }), false);

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "blocked", copy: { label: "编辑", detail: "src/app/panel-read-model/assistant/panel-assistant-timeline-collapse.ts" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: false,
  }), false);

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "waiting_approval", copy: { label: "命令", detail: "git push" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: false,
  }), false);

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "读取", detail: "README.md" } }],
    hasCurrentConfirmation: true,
    hasBodySegments: false,
  }), false);

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "读取", detail: "README.md" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: false,
  }), true);
});

test("settled segmented activity collapses even when the turn has body content", () => {
  assert.equal(timelineCollapseDecision({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "思考", detail: "先判断下一步" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }).collapsed, true);
  assert.equal(timelineCollapseDecision({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "思考", detail: "先判断下一步" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }).reason, "turn_settled");

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: true,
    items: [{ phase: "completed", copy: { label: "读取", detail: "README.md" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }), true);

  assert.equal(shouldAutoCollapseTimelineSegment({
    collapseTimeline: true,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "读取", detail: "README.md" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: false,
  }), true);
});

test("completed segmented activity collapses structurally once body content exists", () => {
  const decision = timelineCollapseDecision({
    collapseTimeline: false,
    defaultCollapsed: false,
    items: [{ phase: "completed", copy: { label: "读取", detail: "README.md" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  });

  assert.deepEqual(decision, { collapsed: true, reason: "structure" });
});

test("context compaction timeline stays expanded as a visible status row", () => {
  assert.deepEqual(timelineCollapseDecision({
    collapseTimeline: true,
    defaultCollapsed: true,
    items: [{
      variant: "context_compaction",
      phase: "completed",
      copy: { detail: "上下文压缩完成" },
    }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }), { collapsed: false, reason: "expanded" });
});

test("segment lifecycle keeps open and attention timelines expanded", () => {
  assert.deepEqual(timelineCollapseDecision({
    collapseTimeline: true,
    defaultCollapsed: true,
    lifecycle: "open",
    items: [{ phase: "executing", copy: { label: "命令", detail: "pnpm test" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }), { collapsed: false, reason: "active_or_pending" });

  assert.deepEqual(timelineCollapseDecision({
    collapseTimeline: true,
    defaultCollapsed: true,
    lifecycle: "attention",
    items: [{ phase: "failed", copy: { label: "命令", detail: "pnpm test" } }],
    hasCurrentConfirmation: false,
    hasBodySegments: true,
  }), { collapsed: false, reason: "needs_attention" });
});

test("collapsed timeline summary uses a quiet work-record label", () => {
  const summary = collapsedTimelineSummary({
    items: [{ phase: "completed", copy: { label: "编辑", detail: "src/app/panel-read-model/assistant/panel-assistant-timeline-collapse.ts" } }],
    hasCurrentConfirmation: false,
  });

  assert.equal(summary, "过程 · 1");
});

test("collapsed timeline summary keeps long command detail out of the main workflow line", () => {
  const summary = collapsedTimelineSummary({
    items: [{
      phase: "completed",
      copy: {
        label: "命令",
        detail: "$lines = Get-Content dist/app/panel-structure-tests/panel-ui-chat-structure.test.js; for ($idx=266; $idx -le 278; $idx++) { '{0,4}: {1}' -f $idx, $lines[$idx] }",
      },
    }],
    hasCurrentConfirmation: false,
  });

  assert.equal(summary, "过程 · 1");
  assert.equal(summary.includes("Get-Content"), false);
});

test("collapsed timeline summary counts mixed technical records without naming them", () => {
  const summary = collapsedTimelineSummary({
    items: [
      { phase: "completed", copy: { label: "命令", detail: "命令已执行" } },
      { phase: "completed", copy: { label: "请求", detail: "GET http://127.0.0.1:4173/" } },
      { phase: "completed", copy: { label: "命令", detail: "命令已执行" } },
    ],
    hasCurrentConfirmation: false,
  });

  assert.equal(summary, "过程 · 3");
});

test("active timeline status keeps command execution concrete without exposing command text", () => {
  const status = activeTimelineStatus({
    items: [{
      phase: "executing",
      tone: "tool",
      toolKind: "command",
      copy: { label: "命令", detail: "pnpm test -- --runInBand" },
    }],
  });

  assert.deepEqual(status, { label: "正在运行命令" });
  assert.equal(status.label.includes("pnpm"), false);
});

test("active timeline status does not promote model narration into product status", () => {
  const status = activeTimelineStatus({
    items: [
      {
        phase: "completed",
        tone: "tool",
        toolKind: "read",
        copy: { label: "读取", detail: "README.md" },
      },
      {
        phase: "executing",
        tone: "narration",
        copy: { detail: "我在核对界面层级与真实工具事实。" },
      },
    ],
  });

  assert.deepEqual(status, { label: "正在处理" });
});

test("active timeline status names a verifiable tool target when available", () => {
  const status = activeTimelineStatus({
    items: [{
      phase: "executing",
      tone: "tool",
      toolKind: "read",
      lead: { subject: "README.md" },
      copy: { label: "读取", detail: "README.md" },
    }],
  });

  assert.deepEqual(status, { label: "正在读取 README.md" });
});

test("active timeline status distinguishes file reading from directory browsing", () => {
  const file = activeTimelineStatus({
    items: [{
      phase: "executing",
      tone: "tool",
      toolKind: "read",
      lead: { subject: "src/app.ts" },
      copy: { label: "读取", detail: "src/app.ts" },
    }],
  });
  const directory = activeTimelineStatus({
    items: [{
      phase: "executing",
      tone: "tool",
      toolKind: "directory",
      lead: { subject: "src/components" },
      copy: { label: "查看", detail: "src/components" },
    }],
  });

  assert.deepEqual(file, { label: "正在读取 src/app.ts" });
  assert.deepEqual(directory, { label: "正在查看 src/components" });
});

test("standalone timeline keeps blocked and pending approval runs expanded", () => {
  assert.equal(shouldCollapseStandaloneTimeline({
    runStatus: "running",
    hasPendingConfirmation: false,
  }), false);
  assert.equal(shouldCollapseStandaloneTimeline({
    runStatus: "completed",
    hasPendingConfirmation: true,
  }), false);
  assert.equal(shouldCollapseStandaloneTimeline({
    runStatus: "blocked",
    hasPendingConfirmation: false,
  }), false);
  assert.equal(shouldCollapseStandaloneTimeline({
    runStatus: "completed",
    hasPendingConfirmation: false,
  }), true);
});

test("settled timeline status matches terminal run states", () => {
  assert.equal(isSettledTimelineStatus("completed"), true);
  assert.equal(isSettledTimelineStatus("failed"), true);
  assert.equal(isSettledTimelineStatus("blocked"), true);
  assert.equal(isSettledTimelineStatus("cancelled"), true);
  assert.equal(isSettledTimelineStatus("running"), false);
  assert.equal(isSettledTimelineStatus(undefined), false);
});
