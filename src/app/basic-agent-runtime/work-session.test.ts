import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
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

test("work session read model keeps tool evidence out of ordinary message deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "tool.completed", "搜索已完成", "completed")],
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "soil-tool-evidence",
        goalSummary: "查找资料",
        contextRefs: [],
        permissionBoundaryRefs: ["read:web"],
      },
      agent: {
        status: "completed",
        answer: {
          answer: "已根据搜索证据回答。",
          modelCallRefs: ["model-call-1"],
          toolCallRefs: ["call-search"],
          evidenceRefs: ["tool:call-search"],
          resultBlocks: [],
        },
        modelCallRefs: ["model-call-1"],
        toolCallRefs: ["call-search"],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "safe",
        observationPanelRole: "safe",
      },
    },
    toolEvidence: [searchEnvelope()],
  });

  assert.equal(workSession.toolEvidence.length, 1);
  assert.equal(workSession.toolEvidence[0]?.uiDisplay?.kind, "search_results");
  assert.equal(workSession.answer?.content, "已根据搜索证据回答。");
  assert.equal(workSession.deliverable, undefined);
  const toolEntry = workSession.contextLedger.entries.find((entry) => entry.kind === "tool_evidence");
  assert.equal(toolEntry?.status, "used");
  assert.equal(toolEntry?.refs.some((ref) => ref.kind === "tool_call" && ref.id === "call-search"), true);
  const json = JSON.stringify(workSession);
  assert.equal(json.includes("RAW_TOOL_OUTPUT_SENTINEL"), false);
  assert.equal(json.includes("sk-tool-secret"), false);
});

test("work session visible events preserve product activity instead of tail model deltas", () => {
  const run = basicRun("completed");
  const events: RunEvent[] = [
    { ...event(run.runId, "run.started", "开始处理", "running"), sequence: 1 },
    { ...event(run.runId, "tool.completed", "file notes.md · 12 bytes", "completed"), sequence: 2 },
    ...Array.from({ length: 24 }, (_, index) => ({
      ...event(run.runId, "model.output.delta", `片段 ${index}`, "running"),
      id: `${run.runId}:delta:${index}`,
      sequence: index + 3,
      delta: `片段 ${index}`,
    })),
    { ...event(run.runId, "model.output.completed", "内容已整理。", "completed"), sequence: 27 },
    { ...event(run.runId, "final.result", "已回答：很长的最终回答", "completed"), sequence: 28 },
  ];

  const workSession = createDesktopWorkSessionReadModel({
    run,
    events,
  });

  assert.equal(workSession.visibleEvents.some((item) => item.type === "tool.completed"), true);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "model.output.delta"), false);
  assert.equal(workSession.visibleEvents.some((item) => item.type === "final.result"), false);
  assert.equal(workSession.currentAction, "内容已整理。");
});

test("work session read model does not promote restored summaries into chat deliverables", () => {
  const run = basicRun("completed");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [event(run.runId, "final.result", "已恢复结果", "completed")],
    restoredResult: {
      title: "恢复结果",
      summary: "这是恢复后的摘要。",
    },
  });

  assert.equal(workSession.stage, "completed");
  assert.equal(workSession.deliverable, undefined);
});

test("work session context ledger distinguishes blocked context refs", () => {
  const run = basicRun("running");
  const workSession = createDesktopWorkSessionReadModel({
    run,
    events: [],
    taskSoilInput: {
      contextRefs: [{
        kind: "file",
        ref: "file:notes.md",
        summary: "Denied file context",
      }],
      permissionBoundaryRefs: ["deny:file:notes.md"],
    },
  });

  assert.equal(workSession.contextAttachments[0]?.status, "blocked");
  assert.equal(workSession.contextLedger.entries.some((entry) => entry.status === "blocked"), true);
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

function searchEnvelope(): ToolResultEnvelope {
  return {
    agentSummary: "Search found one relevant source. sk-tool-secret",
    evidenceRefs: ["tool:call-search", "web:https://example.test/agentarbor"],
    uiDisplay: {
      kind: "search_results",
      query: "AgentArbor",
      results: [{
        title: "AgentArbor docs",
        url: "https://example.test/agentarbor",
        snippet: "safe snippet",
      }],
    },
    tokenEstimate: 16,
    truncated: false,
    redacted: true,
    diagnosticRef: "tool:call-search",
    rawRetention: "diagnostic_ref_only",
  };
}
