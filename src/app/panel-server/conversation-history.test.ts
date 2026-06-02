import assert from "node:assert/strict";
import test from "node:test";
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

  assert.equal(serialized.includes("sk-secret-token"), false);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("hidden reasoning"), false);
  assert.equal(serialized.includes("raw provider response"), false);
});

function modelConfig() {
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

function informationAccess() {
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
