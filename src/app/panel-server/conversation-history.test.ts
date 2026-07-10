import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { RuntimeDatabase } from "../../domain/runtime-database/index.js";
import { PanelConversationStore } from "../panel-conversation/panel-conversations.js";
import { PanelRunJobStore } from "./run-jobs.js";
import {
  buildConversationHistoryMessages,
  buildConversationInterruptedRunContexts,
  buildConversationToolEvidence,
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

test("conversation tool evidence rehydrates completed run envelopes for follow-up context", async () => {
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
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: liveJob.runId,
    title: "助手",
    content: "测试失败，见工具证据。",
    status: "completed",
  });
  runJobs.appendStreamEvent(liveJob.runId, {
    eventId: "event-tool-evidence",
    runId: liveJob.runId,
    type: "tool.completed",
    createdAt: "2026-05-07T00:00:01.000Z",
    summary: "pnpm test · exit 1",
    status: "completed",
    detail: {
      kind: "tool",
      action: "运行命令",
      preview: "pnpm test · exit 1",
      envelope: toolEnvelope(),
    },
    sourceRefs: ["tool:call-test"],
    modelCallRefs: [],
    toolCallRefs: ["call-test"],
  });
  runJobs.complete(liveJob.runId, {
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "根据刚才测试失败继续修复",
  });

  const evidence = await buildConversationToolEvidence({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.agentSummary.includes("pnpm test failed"), true);
  assert.deepEqual(evidence[0]?.evidenceRefs, ["tool:call-test"]);
});

test("conversation tool evidence preserves blocked live run envelopes without treating the answer as completed", async () => {
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
  runJobs.appendStreamEvent(liveJob.runId, {
    eventId: "event-tool-evidence-blocked",
    runId: liveJob.runId,
    type: "tool.completed",
    createdAt: "2026-05-07T00:00:01.000Z",
    summary: "pnpm test · exit 1",
    status: "completed",
    detail: {
      kind: "tool",
      action: "运行命令",
      preview: "pnpm test · exit 1",
      envelope: toolEnvelope("tool:call-blocked"),
    },
    sourceRefs: ["tool:call-blocked"],
    modelCallRefs: [],
    toolCallRefs: ["call-blocked"],
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
    content: "测试失败，但本轮没有完成。",
    status: "blocked",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "继续修复刚才的测试失败",
  });

  const history = await buildConversationHistoryMessages({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });
  const evidence = await buildConversationToolEvidence({
    source: { conversations, runJobs },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.deepEqual(history.map((message) => message.content), ["运行测试"]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.diagnosticRef, "tool:call-blocked");
  assert.equal(evidence[0]?.agentSummary.includes("pnpm test failed"), true);
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

test("conversation tool evidence rehydrates persisted blocked run envelopes", async () => {
  const conversations = new PanelConversationStore();
  const runJobs = new PanelRunJobStore();
  const first = conversations.startDesktopMessage({ goal: "读取文件后继续" });
  conversations.completeAssistantTurn({
    conversationId: first.conversation.conversationId,
    assistantTurnId: first.assistantTurn.turnId,
    runId: "persisted-blocked-run",
    title: "受阻",
    content: "已经读取文件，但缺少继续方向。",
    status: "blocked",
  });
  const second = conversations.startDesktopMessage({
    conversationId: first.conversation.conversationId,
    goal: "用刚才读到的文件继续",
  });
  const runtimeDatabase = runtimeDatabaseWithToolSnapshot({
    runId: "persisted-blocked-run",
    status: "blocked",
    envelope: toolEnvelope("tool:call-persisted-blocked"),
  });

  const evidence = await buildConversationToolEvidence({
    source: { conversations, runJobs, runtimeDatabase },
    conversationId: first.conversation.conversationId,
    assistantTurnId: second.assistantTurn.turnId,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.diagnosticRef, "tool:call-persisted-blocked");
  assert.deepEqual(evidence[0]?.evidenceRefs, ["tool:call-persisted-blocked"]);
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

function toolEnvelope(diagnosticRef = "tool:call-test") {
  return {
    agentSummary: "pnpm test failed with exit code 1. stderr includes AssertionError.",
    evidenceRefs: [diagnosticRef],
    tokenEstimate: 32,
    truncated: false,
    redacted: false,
    diagnosticRef,
    rawRetention: "diagnostic_ref_only" as const,
  };
}

function runtimeDatabaseWithToolSnapshot(input: {
  readonly runId: string;
  readonly status: "completed" | "failed" | "cancelled" | "blocked" | "needs_input" | "stopped";
  readonly envelope: ReturnType<typeof toolEnvelope>;
}): RuntimeDatabase {
  return {
    getRun: async (runId: string) =>
      runId === input.runId
        ? {
            run: {
              runId,
              status: input.status,
            },
            toolCalls: [
              {
                callId: input.envelope.diagnosticRef,
                runId,
                status: "completed",
                envelope: input.envelope,
                eventRefs: [],
              },
            ],
          }
        : undefined,
  } as unknown as RuntimeDatabase;
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
