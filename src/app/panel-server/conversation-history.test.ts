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
  buildConversationSkillRoutingHistory,
  buildConversationPriorModelContext,
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

  const history = await buildConversationSkillRoutingHistory({
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

  const history = await buildConversationSkillRoutingHistory({
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

  const history = await buildConversationSkillRoutingHistory({
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

  const history = await buildConversationSkillRoutingHistory({
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
    buildConversationSkillRoutingHistory({
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

  const history = await buildConversationSkillRoutingHistory({
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

  const history = await buildConversationSkillRoutingHistory({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const assistantHistory = history.find((message) => message.role === "assistant")?.content ?? "";

  assert.equal(assistantHistory.includes("```json\n{\n  \"ok\": true,"), true);
  assert.equal(assistantHistory.includes("  \"items\": [\n    \"alpha\","), true);
  assert.equal(assistantHistory.includes("stdout:\n  line one\n  line two"), true);
});

test("conversation history restores the previous completed run's canonical model context", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const runId = "completed-model-context-run";
  const first = conversations.startDesktopMessage({ goal: "读取并分析配置" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId,
    title: "助手",
    content: "配置已经分析完成。",
    status: "completed",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续修改",
  });
  const snapshot: RuntimeRunSnapshot = {
    ...validOrdinarySnapshot(runId, "completed"),
    ordinaryModelContext: {
      runId,
      messages: [
        { role: "system", content: "root prompt", ref: "context:system:desktop-agent" },
        { role: "user", content: "读取并分析配置", ref: "context:goal:first" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: "call-config", toolName: "read_file", input: { path: "config.json" } }],
          protocolExtensions: {
            openai_responses_output_items: [{
              type: "function_call",
              call_id: "call-config",
              name: "read_file",
              arguments: "{\"path\":\"config.json\"}",
            }],
          },
        },
        {
          role: "tool",
          content: "{\"enabled\":true}",
          toolCallId: "call-config",
          toolName: "read_file",
        },
        {
          role: "assistant",
          content: "配置已经分析完成。",
          protocolExtensions: {
            openai_responses_output_items: [{
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "配置已经分析完成。" }],
            }],
          },
        },
      ],
    },
  };

  const context = await buildConversationPriorModelContext({
    source: {
      conversations,
      runJobs,
      runtimeDatabase: { getRun: async () => snapshot },
    },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(context.map((message) => message.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(context.some((message) => message.content === "root prompt"), false);
  assert.equal(context[1]?.toolCalls?.[0]?.callId, "call-config");
  assert.equal(
    Array.isArray(context[3]?.protocolExtensions?.openai_responses_output_items),
    true,
  );
});

test("conversation context skips a later pre-model failure and restores the newest canonical context", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const canonicalRunId = "run-with-canonical-context";
  const failedRunId = "run-failed-before-model-context";
  const first = conversations.startDesktopMessage({ goal: "读取配置" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: canonicalRunId,
    title: "助手",
    content: "配置读取完成。",
    status: "completed",
  });
  const failed = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "执行一个在调用模型前失败的操作",
  });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: failed.assistantTurn.turnId,
    runId: failedRunId,
    title: "助手",
    content: "运行前检查失败。",
    status: "failed",
  });
  const current = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续处理配置",
  });
  const canonicalSnapshot: RuntimeRunSnapshot = {
    ...validOrdinarySnapshot(canonicalRunId, "completed"),
    ordinaryModelContext: {
      runId: canonicalRunId,
      messages: [
        { role: "system", content: "root", ref: "context:system:desktop-agent" },
        { role: "user", content: "读取配置" },
        { role: "assistant", content: "配置读取完成。" },
      ],
    },
  };

  const context = await buildConversationPriorModelContext({
    source: {
      conversations,
      runJobs,
      runtimeDatabase: {
        getRun: async (runId) => runId === canonicalRunId
          ? canonicalSnapshot
          : validOrdinarySnapshot(failedRunId, "failed"),
      },
    },
    conversationId: first.conversation.conversationId,
    assistantTurnId: current.assistantTurn.turnId,
  });

  assert.deepEqual(context.map((message) => message.content), ["读取配置", "配置读取完成。"]);
});

test("skill routing history leaves long completed answers untruncated", async () => {
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

  const history = await buildConversationSkillRoutingHistory({
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
