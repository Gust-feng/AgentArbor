import assert from "node:assert/strict";
import test from "node:test";
import {
  basicConfirmationDecisionSummary,
  projectRunJobToBasicRun,
  projectRunStreamEventToRunEvent,
} from "./run-projection.js";

test("basic run projection derives BasicAgentRun state and redacts ordinary goal text", () => {
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
  assert.equal(run.title, "需要确认");
  assert.equal(run.currentStep, "需要确认删除操作。");
  assert.equal(run.goalSummary.includes("sk-test-secret"), false);
});

test("basic stream event projection maps refs and safe summaries into RunEvent", () => {
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
  assert.equal(event.summary?.includes("sk-test-token"), false);
  assert.equal(event.detail?.preview?.includes("sk-test-token"), false);
  assert.deepEqual(event.refs, [
    { kind: "event", id: "event-1" },
    { kind: "model_call", id: "model-1" },
    { kind: "tool_call", id: "tool-1" },
    { kind: "trace", id: "trace-1" },
    { kind: "artifact", id: "artifact-1" },
    { kind: "event", id: "plain-ref" },
  ]);
});

test("basic stream event projection keeps safe model output delta for live assistant rendering", () => {
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
  assert.equal(event.delta?.includes("sk-test-token"), false);
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

test("basic projection summarizes confirmation decisions safely", () => {
  assert.equal(basicConfirmationDecisionSummary({ decision: "approve_once" }), "已继续。");
  assert.equal(basicConfirmationDecisionSummary({ decision: "deny" }), "已拒绝。");
  assert.match(
    basicConfirmationDecisionSummary({ decision: "guidance", guidance: "继续，但不要暴露 token=sk-test-token-1234567890" }),
    /^继续/
  );
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要暴露 token=sk-test-token-1234567890",
    }).includes("sk-test-token"),
    false
  );
});
