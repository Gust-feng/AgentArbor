import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import { OrdinaryRuntimeSnapshotContractError } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import { PanelRunJobStore } from "./run-jobs.js";
import {
  buildConversationHistoryMessages,
  buildConversationInterruptedRunContexts,
  buildConversationPriorToolCallContexts,
} from "./conversation-history.js";

test("conversation history excludes the current user turn and running assistant turns", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "completed-run",
    title: "助手",
    content: "第一轮回答",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "第二轮当前消息",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(
    history.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: "user", content: "第一轮用户消息" },
      { role: "assistant", content: "第一轮回答" },
    ],
  );
});

test("conversation history waits for live assistant jobs before using their output", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  const liveJob = runJobs.create({
    runKind: "desktop",
    goal: "第一轮用户消息",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: agentDefinitionRef(),
  });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: liveJob.runId,
    title: "助手",
    content: "这个回答还对应一个未终止 live job",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "第二轮当前消息",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(history.map((message) => message.content), ["第一轮用户消息"]);
});

test("conversation history does not feed blocked assistant turns as completed answers", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "blocked-run",
    title: "需要处理",
    content: "任务没有完成，需要补充方向后继续。",
    status: "blocked",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "第二轮当前消息",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(history.map((message) => message.content), ["第一轮用户消息"]);
  assert.equal(JSON.stringify(history).includes("任务没有完成"), false);
});

test("conversation history does not feed needs-input assistant turns as completed answers", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "needs-input-run",
    title: "需要补充",
    content: "任务等待补充材料，不能当作已完成回答。",
    status: "needs_input",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "第二轮当前消息",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(history.map((message) => message.content), ["第一轮用户消息"]);
  assert.equal(JSON.stringify(history).includes("等待补充材料"), false);
});

test("conversation history rejects invalid persisted Ordinary snapshots before reusing completed answers", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const runId = "invalid-history-run";
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId,
    title: "助手",
    content: "旧快照中的完成回答不能进入模型历史。",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续上一轮",
  });

  await assert.rejects(
    buildConversationHistoryMessages({
      source: {
        conversations,
        runJobs,
        runtimeDatabase: {
          getRun: async () => invalidOrdinarySnapshot(runId, "completed"),
        },
      },
      conversationId: first.conversation.conversationId,
      assistantTurnId: second.assistantTurn.turnId,
    }),
    (error: unknown) => error instanceof OrdinaryRuntimeSnapshotContractError
  );
});

test("conversation interruption context rejects invalid persisted Ordinary stop facts", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const runId = "invalid-interrupted-run";
  const first = conversations.startDesktopMessage({ goal: "第一轮用户消息" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId,
    title: "需要处理",
    content: "旧快照声称本轮可以继续。",
    status: "blocked",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续上一轮",
  });

  await assert.rejects(
    buildConversationInterruptedRunContexts({
      source: {
        conversations,
        runJobs,
        runtimeDatabase: {
          getRun: async () => invalidOrdinarySnapshot(runId, "blocked"),
        },
      },
      conversationId: first.conversation.conversationId,
      assistantTurnId: second.assistantTurn.turnId,
    }),
    (error: unknown) => error instanceof OrdinaryRuntimeSnapshotContractError
  );
});

test("conversation history sanitizes internal fragments and secrets", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "请继续" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "completed-run",
    title: "助手",
    content: "可见回答 raw prompt sk-secret-token hidden reasoning raw provider response",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "第二轮当前消息",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const serialized = JSON.stringify(history);

  assert.equal(serialized.includes("sk-secret-token"), true);
  assert.equal(serialized.includes("raw prompt"), true);
  assert.equal(serialized.includes("hidden reasoning"), true);
  assert.equal(serialized.includes("raw provider response"), true);
});

test("conversation history preserves model-facing code and output structure", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "给出 JSON 和命令输出" });
  const structuredAnswer = [
    "结果如下：",
    "",
    "```json",
    "{",
    "  \"ok\": true,",
    "  \"items\": [",
    "    \"alpha\",",
    "    \"beta\"",
    "  ]",
    "}",
    "```",
    "",
    "stdout:",
    "  line one",
    "  line two",
  ].join("\n");
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "completed-structured-run",
    title: "助手",
    content: structuredAnswer,
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续解释上一轮输出",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const assistantHistory = history.find((message) => message.role === "assistant")?.content ?? "";

  assert.equal(assistantHistory.includes("```json\n{\n  \"ok\": true,"), true);
  assert.equal(assistantHistory.includes("  \"items\": [\n    \"alpha\","), true);
  assert.equal(assistantHistory.includes("stdout:\n  line one\n  line two"), true);
});

test("conversation history exposes blocked run facts as interruption context", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "运行测试" });
  const liveJob = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "运行测试",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: agentDefinitionRef(),
  });
  runJobs.block(liveJob.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    reason: {
      code: "out_of_fuel",
      message: "达到轮次边界，需要用户决定是否继续。",
    },
  });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: liveJob.runId,
    title: "受阻",
    content: "已经定位到失败测试，但还没有修改完成。",
    status: "blocked",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续修复",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const interruptions = await buildConversationInterruptedRunContexts({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(history.some((message) => message.role === "assistant"), false);
  assert.equal(interruptions.length, 1);
  assert.equal(interruptions[0]?.runId, liveJob.runId);
  assert.equal(interruptions[0]?.turnStatus, "blocked");
  assert.equal(interruptions[0]?.stopReason, "out_of_fuel");
  assert.equal(interruptions[0]?.continuationAvailability, "new_turn");
  assert.equal(interruptions[0]?.partialOutput?.includes("已经定位到失败测试"), true);
  assert.equal(interruptions[0]?.message?.includes("达到轮次边界"), true);
});

test("conversation history exposes failed run facts as interruption context", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "修改并验证项目" });
  const failedJob = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "修改并验证项目",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: agentDefinitionRef(),
  });
  runJobs.fail(failedJob.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    error: {
      code: "provider_network",
      message: "模型连接在测试完成前中断。",
    },
  });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: failedJob.runId,
    title: "运行失败",
    content: "已经修改两个文件，测试尚未完成。",
    status: "failed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续验证",
  });

  const interruptions = await buildConversationInterruptedRunContexts({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(interruptions.length, 1);
  assert.equal(interruptions[0]?.turnStatus, "failed");
  assert.equal(interruptions[0]?.stopReason, "provider_network");
  assert.equal(interruptions[0]?.continuationAvailability, "none");
  assert.equal(interruptions[0]?.partialOutput, "已经修改两个文件，测试尚未完成。");
  assert.equal(interruptions[0]?.message, "模型连接在测试完成前中断。");
});

test("conversation history exposes cancelled run progress as interruption context", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "检查多个文件" });
  const cancelledJob = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "检查多个文件",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: agentDefinitionRef(),
  });
  runJobs.cancel(cancelledJob.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    reason: {
      code: "user_cancelled",
      message: "用户中止了上一轮运行。",
    },
  });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: cancelledJob.runId,
    title: "已取消",
    content: "已经检查到 src/config.ts，其他文件尚未检查。",
    status: "cancelled",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续检查剩余文件",
  });

  const interruptions = await buildConversationInterruptedRunContexts({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(interruptions.length, 1);
  assert.equal(interruptions[0]?.turnStatus, "cancelled");
  assert.equal(interruptions[0]?.stopReason, "user_cancelled");
  assert.equal(interruptions[0]?.partialOutput?.includes("src/config.ts"), true);
});

test("conversation history restores the latest run tool facts for the next turn", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const runId = "completed-tool-context-run";
  const first = conversations.startDesktopMessage({ goal: "读取配置" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId,
    title: "助手",
    content: "配置已经读取。",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "根据刚才的内容继续修改",
  });
  const baseSnapshot = validOrdinarySnapshot(runId, "completed");
  const snapshot: RuntimeRunSnapshot = {
    ...baseSnapshot,
    events: [
      runtimeToolEvent(runId, 1, "tool.requested", {
        callId: "call-read-config",
        toolName: "read_file",
        input: { path: "config.json" },
      }),
      runtimeToolEvent(runId, 2, "tool.completed", {
        callId: "call-read-config",
        toolName: "read_file",
        output: { path: "config.json", content: "{\"enabled\":true}" },
        durationMs: 12,
      }),
    ],
  };

  const toolContexts = await buildConversationPriorToolCallContexts({
    source: {
      conversations,
      runJobs,
      runtimeDatabase: { getRun: async () => snapshot },
    },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(toolContexts.length, 1);
  assert.equal(toolContexts[0]?.runId, runId);
  assert.equal(toolContexts[0]?.callId, "call-read-config");
  assert.equal(toolContexts[0]?.toolName, "read_file");
  assert.equal(toolContexts[0]?.status, "completed");
  assert.deepEqual(toolContexts[0]?.input, { path: "config.json" });
  assert.deepEqual(toolContexts[0]?.output, { path: "config.json", content: "{\"enabled\":true}" });
  assert.deepEqual(toolContexts[0]?.refs, [
    `${runId}:event:1`,
    `${runId}:event:2`,
  ]);
});

test("conversation history preserves prior tool failure and truncation facts", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const runId = "failed-tool-context-run";
  const first = conversations.startDesktopMessage({ goal: "运行测试" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId,
    title: "运行失败",
    content: "测试命令失败。",
    status: "failed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "根据错误继续修复",
  });
  const baseSnapshot = validOrdinarySnapshot(runId, "failed");
  const snapshot: RuntimeRunSnapshot = {
    ...baseSnapshot,
    events: [
      runtimeToolEvent(runId, 1, "tool.requested", {
        callId: "call-test",
        toolName: "shell_command",
        input: { command: "pnpm test" },
      }),
      runtimeToolEvent(runId, 2, "tool.failed", {
        callId: "call-test",
        toolName: "shell_command",
        output: { stdout: "partial output" },
        error: "Process exited with code 1.",
        errorDomain: "process_error",
        errorFacts: { exitCode: 1 },
        factTruncation: { output: true },
        durationMs: 20,
      }),
    ],
  };

  const toolContexts = await buildConversationPriorToolCallContexts({
    source: {
      conversations,
      runJobs,
      runtimeDatabase: { getRun: async () => snapshot },
    },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(toolContexts[0]?.status, "failed");
  assert.equal(toolContexts[0]?.error, "Process exited with code 1.");
  assert.equal(toolContexts[0]?.errorDomain, "process_error");
  assert.deepEqual(toolContexts[0]?.errorFacts, { exitCode: 1 });
  assert.deepEqual(toolContexts[0]?.factTruncation, { input: undefined, output: true, errorFacts: undefined });
});

test("conversation history leaves long completed answers untruncated for Context Ledger ownership", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "生成长回答" });
  const sentinel = "SENTINEL_AFTER_HISTORY_PREVIEW_LIMIT";
  const longAnswer = `${"A".repeat(1_450)}\n${sentinel}`;
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "completed-long-run",
    title: "助手",
    content: longAnswer,
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续上一轮长回答",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const assistantHistory = history.find((message) => message.role === "assistant")?.content ?? "";

  assert.equal(assistantHistory.includes(sentinel), true);
  assert.equal(assistantHistory.length > 1_200, true);
  assert.equal(assistantHistory.endsWith("…"), false);
});

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    defaultAiMode: "fake" as const,
    providerKind: "openai_compatible" as const,
    protocolKind: "openai_compatible_chat_completions" as const,
    baseUrl: "https://api.example.test/v1",
    model: "fake-model",
    secretRef: "model-provider-api-key",
    secretConfigured: true,
    updatedAt: "2026-05-07T00:00:00.000Z",
    openAI: {},
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web"] as const,
    web: {
      provider: "tavily" as const,
      providerKind: "tavily" as const,
      maxResults: 5,
      secretRef: "tavily-api-key",
      secretConfigured: false,
      status: "disabled" as const,
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub" as const,
      packages: "readonly_stub" as const,
      github: "readonly_stub" as const,
      run_memory: "readonly_stub" as const,
    },
  };
}

function agentDefinitionRef(): RunAgentDefinitionRef {
  return {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    definitionHash: "sha256:conversation-history-test",
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-conversation-history",
    createdAt: "2026-05-07T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
    toolCatalog: {
      scope: "desktop-basic",
      allowedTools: [],
      tools: [],
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function invalidOrdinarySnapshot(
  runId: string,
  status: RuntimeRunSnapshot["run"]["status"]
): RuntimeRunSnapshot {
  return {
    run: {
      runId,
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status,
      goalSummary: "旧运行",
      aiMode: "fake",
      appHome: "C:/AgentArbor",
      runHome: `C:/AgentArbor/runs/${runId}`,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:02.000Z",
      stopReason: status === "blocked" ? "out_of_fuel" : undefined,
      continuationAvailability: status === "blocked" ? "new_turn" : "none",
    },
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
  };
}

function validOrdinarySnapshot(
  runId: string,
  status: RuntimeRunSnapshot["run"]["status"],
): RuntimeRunSnapshot {
  const snapshot = invalidOrdinarySnapshot(runId, status);
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      agentDefinitionRef: agentDefinitionRef(),
    },
  };
}

function runtimeToolEvent(
  runId: string,
  sequence: number,
  type: "tool.requested" | "tool.completed" | "tool.failed" | "tool.cancelled",
  payload: NonNullable<RuntimeRunSnapshot["events"][number]["payload"]>,
): RuntimeRunSnapshot["events"][number] {
  return {
    eventId: `${runId}:event:${sequence}`,
    runId,
    sequence,
    type,
    summary: type,
    scope: "runtime",
    severity: type === "tool.failed" ? "error" : "info",
    progress: {
      status: type === "tool.requested" ? "in_progress" : type === "tool.failed" ? "failed" : "completed",
      label: type,
    },
    refs: [],
    traceId: `trace-${runId}`,
    intent: type,
    payload,
    createdAt: "2026-07-12T00:00:01.000Z",
    recordedAt: "2026-07-12T00:00:01.000Z",
  };
}
