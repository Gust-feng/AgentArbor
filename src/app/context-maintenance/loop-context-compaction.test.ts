import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { compactAgentLoopContextIfNeeded } from "./index.js";
import type { AgentLoopTokenCounter } from "./contracts.js";

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
      name: "read_file",
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

test("loop context compaction never preserves only part of a parallel tool interaction", async () => {
  const channel = new TestIntelligenceChannel("## Goal\nContinue after the complete tool batch.");
  const toolCalls = Array.from({ length: 12 }, (_, index) => ({
    callId: `call-${index}`,
    toolName: "read_file",
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
    preserveRecentMessages: 10,
    modelCapabilities: modelCapabilities(1_000),
  });

  assert.equal(result.status, "compacted");
  if (result.status !== "compacted") {
    return;
  }
  assert.equal(result.messages.some((message) => message.role === "tool"), false);
  assert.equal(result.messages.some((message) => (message.toolCalls?.length ?? 0) > 0), false);
  const compactionInput = JSON.stringify(channel.requests[0]?.sanitizedMessages);
  assert.equal(compactionInput.includes("read_file#call-0"), true);
  assert.equal(compactionInput.includes("toolResultFor: read_file#call-11"), true);
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
          toolName: "write_file",
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
        toolName: "write_file",
        ref: "tool-result:call-large-input",
      },
      { role: "user", content: "Current user message: continue", ref: "context:goal:protocol-budget" },
    ],
    tools: [],
    intelligenceChannel: channel,
    tokenCounter: characterTokenCounter(),
    thresholdRatio: 0.1,
    preserveRecentMessages: 2,
    modelCapabilities: modelCapabilities(1_000),
  });

  assert.equal(result.status, "compacted");
  assert.equal(channel.requests.length, 1);
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
