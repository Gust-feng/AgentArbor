import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest, ModelResponse, IntelligenceChannel } from "../../domain/intelligence/index.js";
import type { ConfigCenter } from "../config-center/index.js";
import type { OpenAIAuxiliaryModelChannelInput } from "../model-runtime/factory.js";
import { ordinaryRunBirth } from "../ordinary-agent/test-support.js";
import { createOrdinaryConversationTitleGenerator } from "./ordinary-conversation-title.js";

test("conversation title generator extracts the JSON title field from the model text", async () => {
  const received = await generate({
    textOutput: '{"title": "项目结构梳理"}',
  });
  assert.equal(received.title, "项目结构梳理");
});

test("conversation title generator falls back to plain text when the model skips JSON", async () => {
  const received = await generate({
    textOutput: "项目结构梳理",
  });
  assert.equal(received.title, "项目结构梳理");
  const quoted = await generate({
    textOutput: "「优化设置页」",
  });
  assert.equal(quoted.title, "「优化设置页」");
});

test("conversation title generator strips surrounding quotes from a plain text title", async () => {
  const received = await generate({
    textOutput: '"优化设置页"',
  });
  assert.equal(received.title, "优化设置页");
});

test("conversation title generator returns undefined for empty or failed model output", async () => {
  assert.equal((await generate({ textOutput: "" })).title, undefined);
  assert.equal((await generate({ textOutput: '{"title": ""}' })).title, undefined);
  assert.equal((await generate({ textOutput: "   " })).title, undefined);
  assert.equal((await generate({ failed: true })).title, undefined);
});

test("conversation title generator sends one no-tool title request with reasoning off", async () => {
  const captured: {
    channelRequest: ModelRequest | undefined;
    channelInput: OpenAIAuxiliaryModelChannelInput | undefined;
  } = {
    channelRequest: undefined,
    channelInput: undefined,
  };
  const generator = createOrdinaryConversationTitleGenerator({
    configCenter: stubConfigCenter(),
    createModelChannel: (input) => {
      captured.channelInput = input;
      return {
        async request(request: ModelRequest) {
          captured.channelRequest = request;
          return completedResponse('{"title": "测试标题"}');
        },
      } as unknown as IntelligenceChannel;
    },
  });
  const birth = ordinaryRunBirth();
  const title = await generator({ conversationId: "conversation-1", userMessage: "测试一下", birth });
  assert.equal(title, "测试标题");
  assert.deepEqual(captured.channelInput?.supportedPurposes, ["conversation_title"]);
  assert.equal(captured.channelRequest?.purpose, "conversation_title");
  assert.equal(captured.channelRequest?.toolChoice, "none");
  assert.deepEqual(captured.channelRequest?.tools, []);
  assert.equal(captured.channelRequest?.budget.maxOutputTokens, 64);
  assert.equal(captured.channelRequest?.sanitizedMessages[0]?.role, "system");
  assert.match(String(captured.channelRequest?.sanitizedMessages[0]?.content), /JSON/u);
  assert.equal(captured.channelRequest?.sanitizedMessages[1]?.content, "测试一下");
  assert.equal(captured.channelInput?.resolved.model, "gpt-5");
});

test("conversation title generator skips fake mode and unconfigured secrets without any model call", async () => {
  const calls: string[] = [];
  const generator = createOrdinaryConversationTitleGenerator({
    configCenter: stubConfigCenter(),
    createModelChannel: () => { calls.push("channel"); throw new Error("must not be created"); },
  });
  const fakeModeBirth = { ...ordinaryRunBirth(), aiMode: "fake" as const };
  assert.equal(await generator({ conversationId: "conversation-1", userMessage: "hi", birth: fakeModeBirth }), undefined);

  const unconfiguredBirth = {
    ...ordinaryRunBirth(),
    config: { ...ordinaryRunBirth().config, secretConfigured: false },
  };
  assert.equal(await generator({ conversationId: "conversation-2", userMessage: "hi", birth: unconfiguredBirth }), undefined);
  assert.deepEqual(calls, []);
});

async function generate(options: {
  readonly textOutput?: string;
  readonly failed?: boolean;
}): Promise<{ readonly title: string | undefined; readonly requestText: string }> {
  const generator = createOrdinaryConversationTitleGenerator({
    configCenter: stubConfigCenter(),
    createModelChannel: () => ({
      async request(_request: ModelRequest) {
        if (options.failed === true) return failedResponse();
        return completedResponse(options.textOutput ?? "");
      },
    }) as unknown as IntelligenceChannel,
  });
  const birth = ordinaryRunBirth();
  const title = await generator({ conversationId: "conversation-1", userMessage: "测试一下", birth });
  return { title, requestText: options.textOutput ?? "" };
}

function stubConfigCenter(): ConfigCenter {
  return {
    async createModelRuntimeEnvironment() {
      return {
        AGENTARBOR_MODEL_API_KEY: "test-key",
        AGENTARBOR_MODEL_NAME: "gpt-test",
        AGENTARBOR_MODEL_BASE_URL: "https://api.example.test/v1",
      };
    },
  } as unknown as ConfigCenter;
}

function completedResponse(textOutput: string): ModelResponse {
  return {
    responseId: "response-1",
    requestId: "request-1",
    providerId: "agentarbor-test",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    model: "gpt-test",
    status: "completed",
    outputKind: "explanation",
    textOutput,
    assistantMessage: { role: "assistant", content: textOutput },
    usage: {},
    finishReason: "stop",
    validation: { status: "passed", checkedAt: "2026-01-01T00:00:00.000Z", issues: [] },
    completedAt: "2026-01-01T00:00:00.000Z",
  };
}

function failedResponse(): ModelResponse {
  return {
    ...completedResponse(""),
    status: "failed",
    failure: {
      kind: "provider_network",
      retryable: true,
      message: "network unavailable",
      sanitizedErrorRef: "model-error:network",
    },
  };
}
