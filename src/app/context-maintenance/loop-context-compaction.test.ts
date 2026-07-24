import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from "../../domain/intelligence/index.js";
import { compactAgentLoopContextIfNeeded } from "./index.js";
import type { AgentLoopTokenCounter } from "./contracts.js";

test("new tool results crossing the threshold compact old context and remain raw for the main model", async () => {
  const channel = new TestIntelligenceChannel("short summary");
  const result = await compactAgentLoopContextIfNeeded({
    goal: "inspect",
    traceId: "trace-threshold-tool-result",
    goalId: "goal-threshold-tool-result",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "old context ".repeat(70), ref: "old-context" },
      { role: "user", content: "Current user message: inspect", ref: "context:goal:inspect" },
      { role: "assistant", content: "", toolCalls: [{ callId: "call-1", toolName: "read", input: {} }] },
      { role: "tool", content: "x".repeat(200), toolCallId: "call-1", toolName: "read" },
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(2_000),
    thresholdRatio: 0.5,
    preserveRecentTokenBudget: 0,
    preserveLatestToolInteraction: true,
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") return;
  assert.equal(channel.requests.length, 1);
  assert.equal(result.messages.some((message) => message.ref === "old-context"), false);
  assert.equal(result.messages.some((message) => message.toolCalls?.[0]?.callId === "call-1"), true);
  assert.equal(result.messages.some((message) => message.toolCallId === "call-1"), true);
});

test("physical-window pressure compacts old context but preserves the latest unseen tool interaction", async () => {
  const channel = new TestIntelligenceChannel("short summary");
  const toolCalls = Array.from({ length: 12 }, (_, index) => ({
    callId: `latest-${index}`,
    toolName: "read",
    input: {},
  }));
  const result = await compactAgentLoopContextIfNeeded({
    goal: "inspect",
    traceId: "trace-preserve-latest-tool-result",
    goalId: "goal-preserve-latest-tool-result",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "old ".repeat(250), ref: "old-context" },
      { role: "user", content: "Current user message: inspect", ref: "context:goal:latest" },
      { role: "assistant", content: "", toolCalls, ref: "latest-tool-call" },
      ...toolCalls.map((call) => ({ role: "tool" as const, content: "result", toolCallId: call.callId, toolName: call.toolName })),
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(1_000),
    thresholdRatio: 0.5,
    preserveLatestToolInteraction: true,
    preserveRecentTokenBudget: 0,
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") return;
  assert.equal(result.messages.some((message) => message.ref === "old-context"), false);
  assert.equal(result.messages.filter((message) => message.role === "tool").length, 12);
  assert.equal(result.messages.some((message) => message.ref === "latest-tool-call"), true);
});

test("required current and unseen tool messages consume the recent token budget", async () => {
  const channel = new TestIntelligenceChannel("short summary");
  const result = await compactAgentLoopContextIfNeeded({
    goal: "inspect",
    traceId: "trace-required-tail-budget",
    goalId: "goal-required-tail-budget",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "old context ".repeat(70), ref: "old-context" },
      { role: "user", content: `Current user message: ${"inspect ".repeat(10)}`, ref: "context:goal:inspect" },
      { role: "assistant", content: "earlier round that should be compacted", ref: "earlier-round" },
      { role: "assistant", content: "", toolCalls: [{ callId: "call-latest", toolName: "read", input: {} }] },
      { role: "tool", content: "latest result", toolCallId: "call-latest", toolName: "read" },
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(2_000),
    thresholdRatio: 0.5,
    preserveRecentTokenBudget: 100,
    preserveLatestToolInteraction: true,
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") return;
  assert.equal(result.messages.some((message) => message.ref === "earlier-round"), false);
  assert.equal(result.messages.some((message) => message.toolCallId === "call-latest"), true);
});

test("neutral loop context compaction replaces compactible messages with a continuation prompt", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue safely.\n\n## Next Steps\nUse preserved context.");
  const result = await compactAgentLoopContextIfNeeded({
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
      name: "read",
      description: "Read files",
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "workspace",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    }],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(10_000),
    thresholdRatio: 0.1,
    preserveRecentTokenBudget: 200,
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

test("loop context compaction never preserves only part of a parallel tool interaction", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue after the complete tool batch.");
  const toolCalls = Array.from({ length: 12 }, (_, index) => ({
    callId: `call-${index}`,
    toolName: "read",
    input: { path: `src/file-${index}.ts` },
  }));
  const result = await compactAgentLoopContextIfNeeded({
    goal: "inspect the files",
    traceId: "trace-tool-batch-compaction",
    goalId: "goal-tool-batch-compaction",
    messages: [
      { role: "system", content: "system boundary", ref: "prompt:system" },
      { role: "user", content: "Current user message: inspect the files", ref: "context:goal:tool-batch" },
      { role: "assistant", content: "", toolCalls, ref: "model:parallel-tool-call" },
      ...toolCalls.map((call, index) => ({
        role: "tool" as const,
        content: `result-${index}-${"x".repeat(200)}`,
        toolCallId: call.callId,
        toolName: call.toolName,
        ref: `tool-result:${call.callId}`,
      })),
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    thresholdRatio: 0.1,
    preserveRecentTokenBudget: 100,
    modelCapabilities: modelCapabilities(1_000),
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") {
    return;
  }
  assert.equal(result.messages.some((message) => message.role === "tool"), false);
  assert.equal(result.messages.some((message) => (message.toolCalls?.length ?? 0) > 0), false);
  const compactionInput = JSON.stringify(channel.requests[0]?.sanitizedMessages);
  assert.equal(compactionInput.includes("read#call-0"), true);
  assert.equal(compactionInput.includes("toolResultFor: read#call-11"), true);
});

test("recent token budget preserves a complete parallel tool interaction in original order", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue with the recent tool facts.");
  const result = await compactAgentLoopContextIfNeeded({
    goal: "inspect the files",
    traceId: "trace-preserve-complete-tool-round",
    goalId: "goal-preserve-complete-tool-round",
    messages: [
      { role: "system", content: "system boundary", ref: "prompt:system" },
      { role: "user", content: "old context ".repeat(100), ref: "old-context" },
      { role: "user", content: "Current user message: inspect the files", ref: "context:goal:tool-round" },
      {
        role: "assistant",
        content: "",
        ref: "recent-tool-call",
        toolCalls: [
          { callId: "call-a", toolName: "read", input: { path: "a.ts" } },
          { callId: "call-b", toolName: "read", input: { path: "b.ts" } },
        ],
      },
      { role: "tool", content: "result-a", toolCallId: "call-a", toolName: "read", ref: "recent-result-a" },
      { role: "tool", content: "result-b", toolCallId: "call-b", toolName: "read", ref: "recent-result-b" },
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(2_000),
    thresholdRatio: 0.5,
    preserveRecentTokenBudget: 500,
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") return;
  assert.equal(result.messages.some((message) => message.ref === "old-context"), false);
  assert.deepEqual(
    result.messages.flatMap((message) => message.ref?.startsWith("recent-") === true ? [message.ref] : []),
    ["recent-tool-call", "recent-result-a", "recent-result-b"],
  );
});

test("loop context budget includes tool arguments and protocol continuation items", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue with the compacted protocol context.");
  const result = await compactAgentLoopContextIfNeeded({
    goal: "continue",
    traceId: "trace-protocol-budget",
    goalId: "goal-protocol-budget",
    messages: [
      { role: "system", content: "system boundary", ref: "prompt:system" },
      { role: "user", content: "older user message", ref: "conversation:old-user" },
      {
        role: "assistant",
        content: "",
        ref: "model:large-tool-call",
        toolCalls: [{
          callId: "call-large-input",
          toolName: "write",
          input: { content: "x".repeat(1_400) },
        }],
        protocolExtensions: {
          openai_responses_output_items: [{
            type: "reasoning",
            encrypted_content: "y".repeat(1_400),
          }],
        },
      },
      {
        role: "tool",
        content: "written",
        toolCallId: "call-large-input",
        toolName: "write",
        ref: "tool-result:call-large-input",
      },
      { role: "user", content: "Current user message: continue", ref: "context:goal:protocol-budget" },
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    thresholdRatio: 0.1,
    preserveRecentTokenBudget: 100,
    modelCapabilities: modelCapabilities(1_000),
  });

  assert.equal(result.status, "compacted");
  assert.equal(channel.requests.length, 1);
});

test("context maintenance requires the compacted request to fit the frozen model window", async () => {
  const result = await compactAgentLoopContextIfNeeded({
    goal: "continue",
    traceId: "trace-compaction-insufficient",
    goalId: "goal-compaction-insufficient",
    messages: [
      { role: "system", content: "system boundary", ref: "prompt:system" },
      { role: "user", content: "older context ".repeat(180), ref: "conversation:old-user" },
      { role: "assistant", content: "recent context", ref: "conversation:recent-assistant" },
      { role: "user", content: "Current user message: continue", ref: "context:goal:current" },
    ],
    tools: [],
    intelligenceChannel: new TestIntelligenceChannel("summary ".repeat(300)),
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(2_000),
    thresholdRatio: 0.8,
    preserveRecentTokenBudget: 100,
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") {
    return;
  }
  assert.match(result.message, /did not reduce the request below the model window/u);
});

test("context maintenance fails rather than silently using an implicit window", async () => {
  const result = await compactAgentLoopContextIfNeeded({
    goal: "continue",
    traceId: "trace-required-context-window",
    goalId: "goal-required-context-window",
    messages: [{
      role: "user",
      content: `Current user message: ${"continue ".repeat(200)}`,
      ref: "context:goal:current",
    }],
    tools: [],
    intelligenceChannel: new TestIntelligenceChannel("unused"),
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(100),
    thresholdRatio: 0.8,
    preserveRecentTokenBudget: 100,
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") {
    return;
  }
  assert.match(result.message, /only required messages remain/u);
});

test("context threshold never exceeds the frozen model window", async () => {
  const result = await compactAgentLoopContextIfNeeded({
    goal: "continue",
    traceId: "trace-small-context-window",
    goalId: "goal-small-context-window",
    messages: [{
      role: "user",
      content: `Current user message: ${"continue ".repeat(20)}`,
      ref: "context:goal:current",
    }],
    tools: [],
    intelligenceChannel: new TestIntelligenceChannel("unused"),
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(100),
    thresholdRatio: 0.8,
    preserveRecentTokenBudget: 100,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.threshold, 80);
});

test("context compaction returns provider usage without changing its decision", async () => {
  const usage: ModelUsage = {
    requestCount: 1,
    inputTokens: 90,
    outputTokens: 10,
    totalTokens: 100,
  };
  const result = await compactAgentLoopContextIfNeeded({
    goal: "continue",
    traceId: "trace-compaction-usage",
    goalId: "goal-compaction-usage",
    messages: [
      { role: "user", content: "old context ".repeat(80), ref: "context:old" },
      { role: "user", content: "Current user message: continue", ref: "context:current" },
    ],
    tools: [],
    intelligenceChannel: new TestIntelligenceChannel("short summary", usage),
    tokenCounter: characterTokenCounter(),
    modelCapabilities: modelCapabilities(2_000),
    thresholdRatio: 0.2,
    preserveRecentTokenBudget: 100,
  });

  assert.equal(result.status, "compacted");
  assert.deepEqual(result.status === "compacted" ? result.usage : undefined, usage);
});

class TestIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly textOutput: string,
    private readonly usage?: ModelUsage,
  ) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return completedResponse(request.requestId, this.textOutput, this.usage);
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

function completedResponse(requestId: string, textOutput: string, usage?: ModelUsage): ModelResponse {
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
    usage,
    validation: {
      status: "passed",
      checkedAt: "2026-06-02T00:00:00.000Z",
      issues: [],
    },
    completedAt: "2026-06-02T00:00:00.000Z",
  };
}

function characterTokenCounter(): AgentLoopTokenCounter {
  const countMessage = (message: ModelRequest["sanitizedMessages"][number]) =>
    message.content.length + JSON.stringify({
      toolCalls: message.toolCalls,
      protocolExtensions: message.protocolExtensions,
    }).length;
  return {
    source: "openai_tiktoken",
    model: "test-character-counter",
    countText(text) {
      return text.length;
    },
    countMessage(message) {
      return countMessage(message);
    },
    countMessages(messages) {
      return messages.reduce((total, message) => total + countMessage(message), 0);
    },
  };
}

function modelCapabilities(contextWindowTokens: number) {
  return {
    contextWindowTokens,
    maxOutputTokens: 1_000,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    supportsStructuredOutputs: false,
    supportsStreaming: true,
    supportsVisionInput: false,
    supportsReasoningEffort: false,
    preferredApiStyle: "openai_compatible" as const,
    stability: "stable" as const,
  };
}
