import assert from "node:assert/strict";
import test from "node:test";
import {
  collapsedTimelineSummary,
  isSettledTimelineStatus,
  shouldAutoCollapseTimelineSegment,
  shouldCollapseStandaloneTimeline,
  shouldCollapseTimelineAfterTurn,
  timelineCollapseDecision,
} from "./panel-ui-timeline-collapse.js";

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
    items: [{ phase: "blocked", copy: { label: "编辑", detail: "src/app/panel-ui-timeline-collapse.ts" } }],
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

test("collapsed timeline summary keeps action and status anchors", () => {
  const summary = collapsedTimelineSummary({
    items: [{ phase: "completed", copy: { label: "编辑", detail: "src/app/panel-ui-timeline-collapse.ts" } }],
    hasCurrentConfirmation: false,
  });

  assert.equal(summary, "已编辑 1 个文件");
  assert.notEqual(summary, "1 步");
});

test("collapsed timeline summary keeps long command detail out of the main workflow line", () => {
  const summary = collapsedTimelineSummary({
    items: [{
      phase: "completed",
      copy: {
        label: "命令",
        detail: "$lines = Get-Content dist/app/panel-ui-chat-structure.test.js; for ($idx=266; $idx -le 278; $idx++) { '{0,4}: {1}' -f $idx, $lines[$idx] }",
      },
    }],
    hasCurrentConfirmation: false,
  });

  assert.equal(summary, "已运行 1 条命令");
  assert.equal(summary.includes("Get-Content"), false);
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
