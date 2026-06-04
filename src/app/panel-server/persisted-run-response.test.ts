import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  createPersistedPanelRunResponse,
  panelStatusFromRuntimeStatus,
} from "./persisted-run-response.js";

test("persisted run response restores safe transcript and tracking projections", () => {
  const response = createPersistedPanelRunResponse({
    snapshot: runtimeSnapshot(),
    config: modelConfig(),
    informationAccess: informationAccess(),
    conversation: {
      conversationId: "conversation-1",
      title: "Safe task",
      preview: "Safe task",
      currentAction: "结果已生成。",
      nextStep: "打开查看结果，或继续追问下一步。",
      status: "completed",
      requiresUserAction: false,
      queuedRunIds: [],
      queuedRunCount: 0,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:10.000Z",
      turns: [],
    },
  });

  assert.equal(response.restoredFromSnapshot, true);
  assert.equal(response.status, "completed");
  assert.equal(response.restoredResult?.summary, "安全结果摘要");
  assert.equal(response.tracking.modelTotals.completed, 1);
  assert.equal(response.tracking.toolTotals.completed, 1);
  assert.deepEqual(response.transcript.events.map((event) => event.type), [
    "run.started",
    "tool.requested",
    "tool.completed",
    "user.guidance",
    "final.result",
  ]);
  assert.equal(JSON.stringify(response.transcript.events).includes("正在判断下一步"), false);
  assert.equal(response.transcriptNodes.some((node) => node.kind === "tool"), true);
  assert.equal(response.streamCursor.lastSequence, response.transcript.events.at(-1)?.sequence);
  assert.equal(JSON.stringify(response).includes("RAW_STDOUT_SENTINEL"), false);
});

test("persisted runtime running status restores as blocked ordinary panel state", () => {
  assert.equal(panelStatusFromRuntimeStatus("running"), "blocked");
});

function runtimeSnapshot(): RuntimeRunSnapshot {
  return {
    run: {
      runId: "run-1",
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "Safe task",
      aiMode: "fake",
      conversationId: "conversation-1",
      traceId: "trace-1",
      appHome: "C:\\AgentArbor\\app",
      runHome: "C:\\AgentArbor\\runtime\\runs\\run-1",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:10.000Z",
      completedAt: "2026-05-31T00:00:10.000Z",
      resultTitle: "已完成",
      resultSummary: "安全结果摘要",
    },
    workspace: {
      workspaceId: "workspace:current",
      kind: "local_directory",
      path: "Z:\\AgentArbor",
      label: "AgentArbor",
      selectedAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    basicEvents: [],
    events: [
      runtimeEvent(1, "goal.received", "收到任务", []),
      runtimeEvent(2, "model.requested", "正在判断下一步", [{ kind: "model_call", id: "model-1" }]),
      runtimeEvent(3, "tool.requested", "准备运行命令", [{ kind: "tool_call", id: "tool-1" }]),
      runtimeEvent(4, "tool.completed", "命令已完成", [{ kind: "tool_call", id: "tool-1" }]),
    ],
    modelCalls: [
      {
        requestId: "model-1",
        runId: "run-1",
        responseId: "response-1",
        status: "completed",
        purpose: "desktop_agent",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "fake-model",
        eventRefs: ["run-1:event:2"],
      },
    ],
    toolCalls: [
      {
        callId: "tool-1",
        runId: "run-1",
        toolName: "shell_command",
        status: "completed",
        action: "执行 Shell",
        command: "pnpm test",
        exitCode: 0,
        summary: "命令完成",
        preview: "测试通过",
        display: {
          kind: "command_summary",
          command: "pnpm",
          args: ["test"],
          exitCode: 0,
          outputSummary: "测试通过",
        },
        eventRefs: ["run-1:event:3", "run-1:event:4"],
      },
    ],
    artifacts: [],
    confirmations: [
      {
        confirmationId: "confirmation-1",
        runId: "run-1",
        conversationId: "conversation-1",
        status: "guidance",
        title: "用户指导",
        actionSummary: "用户补充指导",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: "2026-05-31T00:00:04.000Z",
        decidedAt: "2026-05-31T00:00:05.000Z",
        guidance: "继续使用安全摘要",
        eventRefs: ["confirmation:confirmation-1"],
      },
    ],
  };
}

function runtimeEvent(
  sequence: number,
  type: RuntimeRunSnapshot["events"][number]["type"],
  summary: string,
  refs: RuntimeRunSnapshot["events"][number]["refs"]
): RuntimeRunSnapshot["events"][number] {
  return {
    eventId: `run-1:event:${sequence}`,
    runId: "run-1",
    sequence,
    type,
    summary,
    scope: "aboveground",
    severity: "info",
    progress: { status: "completed", label: "Completed" },
    refs,
    traceId: "trace-1",
    intent: type.replaceAll(".", "_"),
    createdAt: "2026-05-31T00:00:00.000Z",
    recordedAt: "2026-05-31T00:00:00.000Z",
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "fake-model",
    secretRef: "secret://test/model",
    secretConfigured: false,
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["docs"],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 0,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}
