import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { PanelConversationStore } from "../panel-conversations.js";
import { PanelRunJobStore } from "../panel-run-jobs.js";
import { buildConversationHistoryMessages } from "./conversation-history.js";

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
