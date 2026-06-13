import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import {
  compactBasicAgentConversationIfNeeded,
  compactBasicAgentLoopContextIfNeeded,
} from "./conversation-compaction.js";
import type { BasicAgentTokenCounter } from "./token-counter.js";

const sourceDirectory = path.join(process.cwd(), "src", "app", "basic-agent-runtime");

test("conversation compaction keeps facade, contracts, history, and loop paths split", async () => {
  const [facade, contracts, common, history, loop] = await Promise.all([
    readFile(path.join(sourceDirectory, "conversation-compaction.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "conversation-compaction-contracts.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "conversation-compaction-common.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "conversation-history-compaction.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "loop-context-compaction.ts"), "utf8"),
  ]);

  assert.equal(facade.includes("export * from \"./conversation-compaction-contracts.js\""), true);
  assert.equal(facade.includes("compactBasicAgentConversationIfNeeded"), true);
  assert.equal(facade.includes("compactBasicAgentLoopContextIfNeeded"), true);
  assert.equal(facade.includes("async function compactBasicAgentConversationIfNeeded"), false);
  assert.equal(facade.includes("async function compactBasicAgentLoopContextIfNeeded"), false);
  assert.equal(contracts.includes("export type BasicAgentConversationSummary"), true);
  assert.equal(contracts.includes("export type BasicAgentCompactionAgentIdentity"), true);
  assert.equal(contracts.includes("export type CompactBasicAgentConversationInput"), true);
  assert.equal(contracts.includes("export type CompactBasicAgentLoopContextInput"), true);
  assert.equal(contracts.includes("readonly agentIdentity?: BasicAgentCompactionAgentIdentity"), true);
  assert.equal(common.includes("export function conversationCompactionOutputContract"), true);
  assert.equal(common.includes("export function inputTokenBudgetFor"), true);
  assert.equal(common.includes("export function compactionAgentDisplayName"), true);
  assert.equal(history.includes("export async function compactBasicAgentConversationIfNeeded"), true);
  assert.equal(history.includes("function compactionMessages"), true);
  assert.equal(history.includes("compactionAgentDisplayName(input.agentIdentity)"), true);
  assert.equal(history.includes("function splitLoopMessagesForCompaction"), false);
  assert.equal(loop.includes("export async function compactBasicAgentLoopContextIfNeeded"), true);
  assert.equal(loop.includes("compactionAgentDisplayName(input.agentIdentity)"), true);
  assert.equal(loop.includes("function splitLoopMessagesForCompaction"), true);
  assert.equal(loop.includes("function assembleCompactedLoopMessages"), true);
  assert.equal(loop.includes("function compactionMessages"), false);
});

test("conversation history compaction summarizes older turns and keeps recent turns", async () => {
  const channel = new TestIntelligenceChannel("Older decisions preserved.");
  const result = await compactBasicAgentConversationIfNeeded({
    goal: "continue without raw prompt: hidden",
    traceId: "trace-compaction",
    goalId: "goal-compaction",
    agentIdentity: {
      agentId: "custom-compact-agent",
      displayName: "Custom Compact Agent",
    },
    conversationHistory: [
      {
        role: "user",
        content: `old request ${"x".repeat(700)} api_key=sk-old-secret`,
        ref: "conversation:old-user",
      },
      {
        role: "assistant",
        content: `old answer ${"y".repeat(700)}\nraw provider response: private`,
        ref: "conversation:old-assistant",
      },
      { role: "user", content: "recent user", ref: "conversation:recent-user" },
      { role: "assistant", content: "recent assistant", ref: "conversation:recent-assistant" },
    ],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    thresholdRatio: 0.1,
    recentPairs: 1,
  });

  assert.equal(result.compacted, true);
  assert.deepEqual(result.conversationHistory.map((message) => message.ref), [
    "conversation:recent-user",
    "conversation:recent-assistant",
  ]);
  assert.equal(result.conversationSummary?.summary, "Older decisions preserved.");
  assert.deepEqual(result.conversationSummary?.coveredRefs, [
    "conversation:old-user",
    "conversation:old-assistant",
  ]);
  assert.equal(channel.requests.length, 1);
  const requestText = JSON.stringify(channel.requests[0]?.sanitizedMessages);
  assert.equal(requestText.includes("sk-old-secret"), true);
  assert.equal(requestText.includes("raw provider response: private"), true);
  assert.equal(requestText.includes("Custom Compact Agent"), true);
  assert.equal(requestText.includes("AgentArbor's ordinary desktop agent"), false);
  assert.equal(channel.requests[0]?.purpose, "desktop_context_compaction");
});

test("loop context compaction replaces compactible messages with a continuation prompt", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue safely.\n\n## Next Steps\nUse preserved context.");
  const result = await compactBasicAgentLoopContextIfNeeded({
    goal: "current task",
    traceId: "trace-loop-compaction",
    goalId: "goal-loop-compaction",
    agentIdentity: {
      agentId: "custom-loop-agent",
      displayName: "Custom Loop Agent",
    },
    messages: [
      { role: "system", content: "system boundary", ref: "prompt:system" },
      { role: "user", content: `old user ${"u".repeat(700)} api_key=sk-loop-secret`, ref: "loop:old-user" },
      { role: "assistant", content: `old assistant ${"a".repeat(700)}\nraw tool output: private`, ref: "loop:old-assistant" },
      { role: "assistant", content: "recent assistant", ref: "loop:recent-assistant" },
      { role: "user", content: "Current user message: current task", ref: "context:goal:loop" },
    ],
    tools: [{
      name: "read_file",
      description: "Read files",
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "workspace",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 500,
          omitRawOutput: true,
        },
      },
    }],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    thresholdRatio: 0.1,
    preserveRecentMessages: 2,
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") {
    return;
  }
  assert.equal(result.messages.some((message) => message.ref === result.conversationSummary.summaryId), true);
  assert.equal(result.messages.some((message) => message.ref === "prompt:system"), true);
  assert.equal(result.messages.some((message) => message.ref === "context:goal:loop"), true);
  assert.equal(result.messages.some((message) => message.ref === "loop:old-user"), false);
  assert.equal(result.messages.some((message) => message.content.includes("This summary is background only")), true);
  assert.deepEqual(result.conversationSummary.coveredRefs, ["loop:old-user", "loop:old-assistant"]);
  const requestText = JSON.stringify(channel.requests[0]?.sanitizedMessages);
  assert.equal(requestText.includes("sk-loop-secret"), true);
  assert.equal(requestText.includes("raw tool output: private"), true);
  assert.equal(requestText.includes("Custom Loop Agent"), true);
  assert.equal(requestText.includes("AgentArbor's ordinary desktop agent"), false);
  assert.equal(channel.requests[0]?.toolChoice, "none");
});

class TestIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly textOutput: string) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return completedResponse(request.requestId, this.textOutput);
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

function completedResponse(requestId: string, textOutput: string): ModelResponse {
  return {
    responseId: `model-response-${requestId}`,
    requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: "explanation",
    textOutput,
    validation: {
      status: "passed",
      checkedAt: "2026-06-02T00:00:00.000Z",
      issues: [],
    },
    completedAt: "2026-06-02T00:00:00.000Z",
  };
}

function characterTokenCounter(): BasicAgentTokenCounter {
  return {
    source: "openai_tiktoken",
    model: "test-character-counter",
    countText(text) {
      return text.length;
    },
    countMessage(message) {
      return message.content.length;
    },
    countMessages(messages) {
      return messages.reduce((total, message) => total + message.content.length, 0);
    },
  };
}
