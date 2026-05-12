import assert from "node:assert/strict";
import test from "node:test";
import {
  basicConfirmationDecisionSummary,
  projectPanelJobToBasicRun,
  projectPanelStreamEventToRunEvent,
} from "./panel-projection.js";

test("panel projection derives BasicAgentRun state and redacts ordinary goal text", () => {
  const run = projectPanelJobToBasicRun({
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
        summary: "需要确认写入操作。",
        sourceRefs: [],
        modelCallRefs: [],
        toolCallRefs: [],
      },
    ],
    confirmationDecisions: [],
  });

  assert.equal(run.status, "approval_needed");
  assert.equal(run.title, "需要确认");
  assert.equal(run.currentStep, "需要确认写入操作。");
  assert.equal(run.goalSummary.includes("sk-test-secret"), false);
});

test("panel stream event projection maps refs and safe summaries into RunEvent", () => {
  const event = projectPanelStreamEventToRunEvent({
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

  assert.equal(event.title, "工具已完成");
  assert.equal(event.status, "running");
  assert.equal(event.visibility, "expanded");
  assert.equal(event.summary?.includes("sk-test-token"), false);
  assert.deepEqual(event.refs, [
    { kind: "event", id: "event-1" },
    { kind: "model_call", id: "model-1" },
    { kind: "tool_call", id: "tool-1" },
    { kind: "trace", id: "trace-1" },
    { kind: "artifact", id: "artifact-1" },
    { kind: "event", id: "plain-ref" },
  ]);
});

test("panel projection summarizes confirmation decisions safely", () => {
  assert.equal(basicConfirmationDecisionSummary({ decision: "approve_once" }), "已批准本次操作。");
  assert.equal(basicConfirmationDecisionSummary({ decision: "deny" }), "已拒绝本次操作，运行不会继续执行该动作。");
  assert.match(
    basicConfirmationDecisionSummary({ decision: "guidance", guidance: "继续，但不要暴露 token=sk-test-token-1234567890" }),
    /^已收到补充指导：/
  );
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要暴露 token=sk-test-token-1234567890",
    }).includes("sk-test-token"),
    false
  );
});
