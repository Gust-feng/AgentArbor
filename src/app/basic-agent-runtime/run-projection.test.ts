import assert from "node:assert/strict";
import test from "node:test";
import {
  basicConfirmationDecisionSummary,
  projectRunJobToBasicRun,
  projectRunStreamEventToRunEvent,
} from "./run-projection.js";
import type { BasicAgentCompatRunStatus } from "./run-projection.js";

test("basic run projection derives BasicAgentRun state and preserves ordinary goal text", () => {
  const run = projectRunJobToBasicRun({
    runId: "run-1",
    goal: "请处理这个任务，api_key=sk-test-secret-value-1234567890",
    status: "running",
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
    streamEvents: [
      {
        eventId: "event-1",
        runId: "run-1",
        sequence: 1,
        type: "confirmation.needed",
        createdAt: "2026-05-12T00:00:01.000Z",
        summary: "需要确认删除操作。",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      },
    ],
    confirmationDecisions: [],
  });

  assert.equal(run.status, "approval_needed");
  assert.equal(run.title, "待处理");
  assert.equal(run.currentStep, "删除操作。");
  assert.equal(run.nextStep, undefined);
  assert.equal(run.goalSummary.includes("sk-test-secret"), true);
});

test("basic stream event projection maps refs and preserves summaries into RunEvent", () => {
  const event = projectRunStreamEventToRunEvent({
    eventId: "event-1",
    runId: "run-1",
    sequence: 3,
    type: "tool.completed",
    createdAt: "2026-05-12T00:00:03.000Z",
    detail: {
      preview: "命令完成，Authorization: Bearer sk-test-token-1234567890",
    },
    sourceRefs: ["trace:trace-1", "model:model-1", "tool:tool-1", "artifact:artifact-1", "plain-ref"],
    modelCallRefs: ["model-1"],
    toolCallRefs: ["tool-1"],
  });

  assert.equal(event.title, "动作");
  assert.equal(event.status, "running");
  assert.equal(event.visibility, "expanded");
  assert.equal(event.summary?.includes("sk-test-token"), true);
  assert.equal(event.detail?.preview?.includes("sk-test-token"), true);
  assert.deepEqual(event.refs, [
    { kind: "event", id: "event-1" },
    { kind: "model_call", id: "model-1" },
    { kind: "tool_call", id: "tool-1" },
    { kind: "trace", id: "trace-1" },
    { kind: "artifact", id: "artifact-1" },
    { kind: "event", id: "plain-ref" },
  ]);
});

test("basic stream event projection keeps model output delta for live assistant rendering", () => {
  const event = projectRunStreamEventToRunEvent({
    eventId: "event-delta-1",
    runId: "run-1",
    sequence: 4,
    type: "model.output.delta",
    createdAt: "2026-05-12T00:00:04.000Z",
    agentLabel: "助手",
    delta: "正在生成结果，token=sk-test-token-1234567890",
    status: "running",
    sourceRefs: [],
    modelCallRefs: ["model-1"],
    toolCallRefs: [],
  });

  assert.equal(event.type, "model.output.delta");
  assert.equal(event.delta?.includes("正在生成结果"), true);
  assert.equal(event.delta?.includes("sk-test-token"), true);
  assert.equal(event.summary, event.delta);
});

test("basic stream event projection keeps long model output deltas for live rendering", () => {
  const longDelta = `开头\n${"模型输出片段".repeat(220)}\n结尾`;
  const event = projectRunStreamEventToRunEvent({
    eventId: "event-delta-long",
    runId: "run-1",
    sequence: 5,
    type: "model.output.delta",
    createdAt: "2026-05-12T00:00:05.000Z",
    agentLabel: "助手",
    delta: longDelta,
    status: "running",
    sourceRefs: [],
    modelCallRefs: ["model-1"],
    toolCallRefs: [],
  });

  assert.equal(event.delta, longDelta);
});

test("basic run projection keeps the run status matrix explicit", () => {
  type ExpectedStatus = ReturnType<typeof projectRunJobToBasicRun>["status"];
  const cases: readonly {
    readonly name: string;
    readonly jobStatus: BasicAgentCompatRunStatus;
    readonly eventType?: string;
    readonly eventStatus?: BasicAgentCompatRunStatus;
    readonly eventSummary?: string;
    readonly expectedStatus: ExpectedStatus;
    readonly expectedTitle: string;
    readonly requiresUserAction: boolean;
    readonly stalePendingConfirmation?: boolean;
  }[] = [
    {
      name: "completed-no-tool-calls",
      jobStatus: "completed",
      expectedStatus: "completed",
      expectedTitle: "已完成",
      requiresUserAction: false,
    },
    {
      name: "approval-required",
      jobStatus: "running",
      eventType: "confirmation.needed",
      eventStatus: "approval_needed",
      eventSummary: "运行命令：pnpm test",
      expectedStatus: "approval_needed",
      expectedTitle: "待处理",
      requiresUserAction: true,
      stalePendingConfirmation: true,
    },
    {
      name: "out-of-fuel",
      jobStatus: "blocked",
      eventType: "run.blocked",
      eventStatus: "blocked",
      eventSummary: "当前轮次已到上限，任务没有完成。",
      expectedStatus: "blocked",
      expectedTitle: "需要处理",
      requiresUserAction: true,
      stalePendingConfirmation: true,
    },
    {
      name: "context-overflow",
      jobStatus: "blocked",
      eventType: "run.blocked",
      eventStatus: "blocked",
      eventSummary: "上下文整理没有成功，任务没有完成。",
      expectedStatus: "blocked",
      expectedTitle: "需要处理",
      requiresUserAction: true,
      stalePendingConfirmation: true,
    },
    {
      name: "model-failed",
      jobStatus: "failed",
      eventType: "model.failed",
      eventStatus: "failed",
      eventSummary: "模型调用失败。",
      expectedStatus: "failed",
      expectedTitle: "未完成",
      requiresUserAction: false,
      stalePendingConfirmation: true,
    },
    {
      name: "cancelled",
      jobStatus: "cancelled",
      eventType: "run.cancelled",
      eventStatus: "cancelled",
      eventSummary: "运行已取消。",
      expectedStatus: "cancelled",
      expectedTitle: "已取消",
      requiresUserAction: false,
      stalePendingConfirmation: true,
    },
  ];

  for (const item of cases) {
    const run = projectRunJobToBasicRun({
      runId: `run-${item.name}`,
      goal: "执行一个普通 Agent 回归任务",
      status: item.jobStatus,
      runMode: "agent",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:03.000Z",
      streamEvents: item.eventType === undefined
        ? []
        : [{
            eventId: `event-${item.name}`,
            runId: `run-${item.name}`,
            sequence: 1,
            type: item.eventType,
            createdAt: "2026-05-12T00:00:01.000Z",
            summary: item.eventSummary,
            status: item.eventStatus,
            sourceRefs: [],
            modelCallRefs: [],
            toolCallRefs: [],
          }],
      confirmationDecisions: [],
      completed: item.stalePendingConfirmation === true
        ? {
            canvas: {
              kind: "desktop_agent_canvas",
              agent: {
                pendingConfirmation: {
                  confirmationId: "confirmation-stale",
                },
              },
            },
          }
        : undefined,
    });

    assert.equal(run.status, item.expectedStatus, item.name);
    assert.equal(run.title, item.expectedTitle, item.name);
    assert.equal(run.requiresUserAction, item.requiresUserAction, item.name);
    assert.equal(JSON.stringify(run).includes("正在处理"), false, item.name);
    if (item.expectedStatus !== "completed") {
      assert.notEqual(run.status, "completed", item.name);
    }
    if (item.expectedStatus !== "approval_needed") {
      assert.notEqual(run.status, "approval_needed", item.name);
    }
  }
});

test("basic run projection does not complete a run with a pending confirmation payload", () => {
  const run = projectRunJobToBasicRun({
    runId: "run-completed-stale-pending-confirmation",
    goal: "等待用户确认",
    status: "completed",
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
    streamEvents: [],
    confirmationDecisions: [],
    completed: {
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {
          pendingConfirmation: {
            confirmationId: "confirmation-still-pending",
          },
        },
      },
    },
  });

  assert.equal(run.status, "approval_needed");
  assert.equal(run.requiresUserAction, true);
  assert.notEqual(run.status, "completed");
});

test("basic run projection skips generic approval resume events for current step", () => {
  const run = projectRunJobToBasicRun({
    runId: "run-approval-step",
    goal: "运行需要确认的命令",
    status: "running",
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:03.000Z",
    streamEvents: [
      {
        eventId: "event-tool",
        runId: "run-approval-step",
        sequence: 1,
        type: "tool.completed",
        createdAt: "2026-05-12T00:00:01.000Z",
        summary: "pnpm test · 通过",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: ["tool-1"],
      },
      {
        eventId: "event-approved",
        runId: "run-approval-step",
        sequence: 2,
        type: "user_approval.received",
        createdAt: "2026-05-12T00:00:02.000Z",
        summary: "已继续。",
        status: "running",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      },
      {
        eventId: "event-resumed",
        runId: "run-approval-step",
        sequence: 3,
        type: "run.resumed",
        createdAt: "2026-05-12T00:00:03.000Z",
        summary: "继续处理。",
        status: "running",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      },
    ],
    confirmationDecisions: [],
  });

  assert.equal(run.currentStep, "pnpm test · 通过");
});

test("basic run projection clears stale approval state after a recorded current confirmation decision", () => {
  const run = projectRunJobToBasicRun({
    runId: "run-approved-stale-confirmation",
    goal: "运行需要确认的命令",
    status: "running",
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:03.000Z",
    streamEvents: [
      {
        eventId: "event-confirmation",
        runId: "run-approved-stale-confirmation",
        sequence: 1,
        type: "confirmation.needed",
        createdAt: "2026-05-12T00:00:01.000Z",
        summary: "运行命令：pnpm test",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: ["tool-command"],
      },
    ],
    confirmationDecisions: [{
      confirmationId: "confirmation-command",
      decision: "approve_once",
    }],
    completed: {
      canvas: {
        kind: "desktop_agent_canvas",
        agent: {
          pendingConfirmation: {
            confirmationId: "confirmation-command",
          },
        },
      },
    },
  });

  assert.equal(run.status, "running");
  assert.equal(run.requiresUserAction, false);
});

test("basic run projection keeps denied decisions visible as current step", () => {
  const run = projectRunJobToBasicRun({
    runId: "run-denied-step",
    goal: "删除文件",
    status: "running",
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:02.000Z",
    streamEvents: [
      {
        eventId: "event-denied",
        runId: "run-denied-step",
        sequence: 1,
        type: "user_approval.received",
        createdAt: "2026-05-12T00:00:02.000Z",
        summary: "已不执行。",
        status: "running",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      },
    ],
    confirmationDecisions: [],
  });

  assert.equal(run.currentStep, "已不执行。");
});

test("basic projection summarizes confirmation decisions", () => {
  assert.equal(basicConfirmationDecisionSummary({ decision: "approve_once" }), "已允许。");
  assert.equal(basicConfirmationDecisionSummary({ decision: "deny" }), "已不执行。");
  assert.match(
    basicConfirmationDecisionSummary({ decision: "guidance", guidance: "继续，但不要暴露 token=sk-test-token-1234567890" }),
    /^继续/
  );
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要暴露 token=sk-test-token-1234567890",
    }).includes("sk-test-token"),
    true
  );
});
