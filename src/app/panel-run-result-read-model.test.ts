import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopWorkViewReadModel, TranscriptNode } from "../domain/basic-agent/index.js";
import { createPanelRunResultReadModel } from "./panel-run-result-read-model.js";

test("panel run result projects main UI fields from work view evidence", () => {
  const workView = workViewFixture();
  const result = createPanelRunResultReadModel({ workView });

  assert.equal(result.runId, "run-result");
  assert.equal(result.conversationId, "conversation-result");
  assert.equal(result.status, "completed");
  assert.equal(result.answer?.markdown, "完成回答。\n\n- 已创建文件\n- 已验证服务");
  assert.equal(result.answer?.copyText.includes("已验证服务"), true);
  assert.equal(result.answer?.tone, "final");
  assert.deepEqual(result.actions.map((action) => [action.kind, action.label, action.status]), [
    ["next", "运行回归测试", "available"],
  ]);
  assert.deepEqual(result.evidence.files.map((file) => ({ path: file.path, kind: file.kind })), [
    { path: "src/demo.ts", kind: "created" },
  ]);
  assert.equal(result.evidence.files[0]?.preview?.includes("console.log"), true);
  assert.deepEqual(result.evidence.commands.map((command) => ({ command: command.command, exitCode: command.exitCode })).sort(compareCommandEvidence), [
    { command: "GET http://127.0.0.1:5173/health", exitCode: 200 },
    { command: "pnpm test", exitCode: 0 },
  ]);
  assert.equal(result.evidence.commands.find((command) => command.command === "pnpm test")?.summary?.includes("tests passed"), true);
  assert.deepEqual(result.evidence.sources.map((source) => source.label), ["README.md"]);
  assert.equal(result.process.defaultCollapsed, true);
  assert.equal(result.process.summary, "任务已完成，记录 2 个关键步骤。");
  assert.deepEqual(result.process.items.map((item) => [item.kind, item.status]), [
    ["edit", "completed"],
    ["command", "completed"],
  ]);
});

test("panel run result exposes pending confirmation without raw replay", () => {
  const workView = {
    ...workViewFixture(),
    stage: "awaiting_approval" as const,
    currentAction: "准备运行 pnpm test。",
    run: {
      ...workViewFixture().run,
      status: "approval_needed" as const,
      requiresUserAction: true,
    },
    pendingConfirmation: {
      confirmationId: "confirmation-1",
      runId: "run-result",
      conversationId: "conversation-result",
      title: "运行命令",
      actionSummary: "执行 pnpm test 以验证改动。",
      affectedResources: ["pnpm test"],
      riskLevel: "low" as const,
      resumeAvailability: "live" as const,
      requestedAt: "2026-06-20T00:00:05.000Z",
      sourceRefs: ["tool:command-1"],
    },
  } satisfies DesktopWorkViewReadModel;

  const result = createPanelRunResultReadModel({ workView });

  assert.equal(result.status, "waiting_confirmation");
  assert.equal(result.confirmation?.confirmationId, "confirmation-1");
  assert.equal(result.confirmation?.body, "执行 pnpm test 以验证改动。");
  assert.deepEqual(result.actions.map((action) => action.kind), ["confirm", "next"]);
  assert.equal(JSON.stringify(result).includes("sourceRefs"), false);
  assert.equal(JSON.stringify(result).includes("replay"), false);
});

test("panel run result projects safe tool evidence display without raw tool output", () => {
  const workView = {
    ...workViewFixture(),
    toolEvidence: [{
      agentSummary: "读取 demo.txt 成功，raw secret sk-result-model-secret 不应出现在 result。",
      evidenceRefs: ["tool:read-demo"],
      tokenEstimate: 1,
      truncated: false,
      redacted: true,
      rawRetention: "diagnostic_ref_only" as const,
      uiDisplay: {
        kind: "read_result" as const,
        ref: "file:demo.txt",
        source: "workspace" as const,
        title: "demo.txt",
        contentPreview: "hello result model",
      },
    }],
  } satisfies DesktopWorkViewReadModel;

  const result = createPanelRunResultReadModel({ workView });

  assert.equal(result.evidence.sources.some((source) => source.label === "demo.txt" && source.ref === "file:demo.txt"), true);
  assert.equal(JSON.stringify(result).includes("sk-result-model-secret"), false);
  assert.equal(JSON.stringify(result).includes("agentSummary"), false);
});

test("panel run result uses normalized file operation instead of length guesses", () => {
  const workView = {
    ...workViewFixture(),
    transcriptNodes: [
      {
        nodeId: "node-delete",
        runId: "run-result",
        sequence: 1,
        eventType: "tool.completed",
        kind: "tool" as const,
        phase: "completed" as const,
        title: "删除完成",
        summary: "src/remove.ts",
        timestamp: "2026-06-20T00:00:01.000Z",
        toolName: "workspace__remove",
        display: {
          kind: "file_change_summary" as const,
          path: "src/remove.ts",
          operation: "delete" as const,
          bytes: 128,
          nextLength: 128,
        },
        refs: [{ kind: "tool_call" as const, id: "tool-delete" }],
      },
      {
        nodeId: "node-unknown",
        runId: "run-result",
        sequence: 2,
        eventType: "tool.completed",
        kind: "tool" as const,
        phase: "completed" as const,
        title: "文件变化",
        summary: "src/unknown.ts",
        timestamp: "2026-06-20T00:00:02.000Z",
        toolName: "workspace__mutate",
        display: {
          kind: "file_change_summary" as const,
          path: "src/unknown.ts",
          previousLength: 0,
          nextLength: 12,
        },
        refs: [{ kind: "tool_call" as const, id: "tool-unknown" }],
      },
    ],
  } satisfies DesktopWorkViewReadModel;

  const result = createPanelRunResultReadModel({ workView });

  assert.deepEqual(result.evidence.files.map((file) => ({ path: file.path, kind: file.kind, summary: file.summary })), [
    { path: "src/remove.ts", kind: "deleted", summary: "删除" },
    { path: "src/unknown.ts", kind: "changed", summary: undefined },
  ]);
});

test("panel run result restores persisted result summary as the answer fallback", () => {
  const workView = {
    ...workViewFixture(),
    answer: undefined,
    deliverable: undefined,
    run: {
      ...workViewFixture().run,
      runId: "run-restored",
      status: "completed" as const,
    },
  } satisfies DesktopWorkViewReadModel;

  const result = createPanelRunResultReadModel({
    workView,
    restoredResult: {
      title: "已完成",
      summary: "历史运行摘要",
    },
  });

  assert.equal(result.runId, "run-restored");
  assert.equal(result.status, "completed");
  assert.equal(result.answer?.markdown, "历史运行摘要");
  assert.equal(result.answer?.tone, "final");
});


function compareCommandEvidence(
  left: { readonly command?: string; readonly exitCode?: number },
  right: { readonly command?: string; readonly exitCode?: number }
): number {
  return (left.command ?? "").localeCompare(right.command ?? "");
}

function workViewFixture(): DesktopWorkViewReadModel {
  const run = {
    runId: "run-result",
    conversationId: "conversation-result",
    title: "实现 result model",
    goalSummary: "实现 result model",
    status: "completed" as const,
    runMode: "agent" as const,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:10.000Z",
    eventCursor: {
      lastSequence: 3,
      eventCount: 3,
    },
  };
  const transcriptNodes: readonly TranscriptNode[] = [
    {
      nodeId: "node-file",
      runId: run.runId,
      sequence: 1,
      eventType: "tool.completed",
      kind: "tool",
      phase: "completed",
      title: "创建完成",
      summary: "src/demo.ts",
      timestamp: "2026-06-20T00:00:01.000Z",
      toolName: "create_file",
      display: {
        kind: "file_change_summary",
        path: "src/demo.ts",
        operation: "create",
        previousLength: 0,
        nextLength: 21,
        preview: "console.log('ok');",
      },
      refs: [{ kind: "tool_call", id: "tool-file" }],
    },
    {
      nodeId: "node-command",
      runId: run.runId,
      sequence: 2,
      eventType: "tool.completed",
      kind: "tool",
      phase: "completed",
      title: "命令完成",
      summary: "pnpm test",
      timestamp: "2026-06-20T00:00:02.000Z",
      toolName: "shell_command",
      display: {
        kind: "command_summary",
        command: "pnpm",
        args: ["test"],
        exitCode: 0,
        outputSummary: "tests passed",
        logRef: "log:pnpm-test",
      },
      refs: [{ kind: "tool_call", id: "tool-command" }],
    },
  ];
  return {
    run,
    stage: "completed",
    headline: "已完成",
    currentAction: "",
    contextAttachments: [],
    contextLedger: {
      runId: run.runId,
      summary: "本轮没有额外上下文。",
      entries: [],
      truncation: {
        truncated: false,
        omittedItemCount: 0,
        truncatedItemIds: [],
      },
    },
    triggeredSkills: [],
    answer: {
      title: "已回答",
      content: "完成回答。\n\n- 已创建文件\n- 已验证服务",
      evidenceRefs: [],
      nextActions: ["运行回归测试"],
    },
    deliverable: undefined,
    toolEvidence: [],
    visibleEvents: [
      {
        id: "event-http",
        runId: run.runId,
        sequence: 3,
        type: "tool.completed",
        title: "HTTP 请求完成",
        summary: "GET /health",
        status: "completed",
        timestamp: "2026-06-20T00:00:03.000Z",
        toolName: "http_request",
        refs: [{ kind: "tool_call", id: "tool-http" }],
        visibility: "compact",
        detail: {
          display: {
            kind: "http_response",
            method: "GET",
            url: "http://127.0.0.1:5173/health",
            statusCode: 200,
            statusText: "OK",
            bodyPreview: "healthy",
          },
        },
      },
      {
        id: "event-read",
        runId: run.runId,
        sequence: 4,
        type: "tool.completed",
        title: "读取完成",
        summary: "README.md",
        status: "completed",
        timestamp: "2026-06-20T00:00:04.000Z",
        toolName: "read_file",
        refs: [{ kind: "tool_call", id: "tool-read" }],
        visibility: "compact",
        detail: {
          display: {
            kind: "read_result",
            title: "README.md",
            uri: "README.md",
            summary: "项目说明",
          },
        },
      },
    ],
    transcriptNodes,
    safetySummary: {
      summary: "证据 2",
      pendingActionCount: 0,
      toolResultCount: 2,
      contextAttachmentCount: 0,
    },
  };
}
