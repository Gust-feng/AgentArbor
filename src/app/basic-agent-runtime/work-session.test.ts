import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import { createDesktopWorkSessionReadModel } from "./work-session.js";

test("work session read model keeps ordinary completed answers separate from deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "结果已生成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-test",
        goalSummary: "总结 notes.md",
        contextRefs: [{ ref: "file:notes.md", kind: "file", summary: "文件引用" }],
        permissionBoundaryRefs: ["read:file:notes.md"],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "这是总结结果。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          evidenceRefs: ["tool:tool-call-1"],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
    toolDisplays: [{
      kind: "generic_tool_summary",
      summary: "文件已读取。",
      items: ["notes.md"],
    }],
  });

  assert.equal(workSession.stage, "completed");
  assert.equal(workSession.answer?.content, "这是总结结果。");
  assert.equal(workSession.deliverable, undefined);
  assert.equal(workSession.contextAttachments[0]?.ref, "file:notes.md");
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.kind === "attachment"), true);
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.kind === "tool_evidence"), true);
});

test("work session read model surfaces approval as the main stage", () => {
  const run = basicRun("approval_needed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "confirmation.needed", "需要确认", "approval_needed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-test",
        goalSummary: "写文件",
        contextRefs: [],
        permissionBoundaryRefs: ["ask:before-write"],
      },
      agent: {
        status: "confirmation_needed",
        pendingConfirmation: {
          confirmationId: "confirmation-test",
          title: "写入文件",
          question: "准备写入文件。",
          consequence: "批准后只执行本次写入。",
          riskLevel: "high",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["tool-call-1"],
          sourceRefs: ["tool:tool-call-1"],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["tool-call-1"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
  });

  assert.equal(workSession.stage, "awaiting_approval");
  assert.equal(workSession.pendingConfirmation?.confirmationId, "confirmation-test");
  assert.equal(workSession.deliverable, undefined);
});

function basicRun(status: BasicAgentRun["status"]): BasicAgentRun {
  return {
    runId: "basic-run-test",
    title: "正在处理",
    goalSummary: "测试任务",
    status,
    runMode: "agent",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:01.000Z",
    requiresUserAction: status === "approval_needed",
    eventCursor: { lastSequence: 1, eventCount: 1 },
  };
}

function event(runId: string, type: string, summary: string, status: BasicAgentRun["status"]): RunEvent {
  return {
    id: `${runId}:${type}`,
    runId,
    sequence: 1,
    type,
    title: summary,
    summary,
    status,
    timestamp: "2026-05-12T00:00:01.000Z",
    refs: [],
    visibility: "compact",
  };
}
