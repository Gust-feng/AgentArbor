import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { AgentLoopInput } from "../../app/model-runtime/agent-loop.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionGateway,
} from "../../domain/tools/index.js";
import { createAgentSessionLoop } from "./agent-session-loop.js";
import { createModelProviderBinding } from "./model-provider-binding.js";

test("model provider round trip completes a non-streaming Chat tool turn", async (t) => {
  const provider = await startJsonProvider(t, [
    chatCompletion({
      content: null,
      tool_calls: [{
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      }],
    }, "tool_calls"),
    chatCompletion({ content: "tool evidence accepted" }, "stop"),
  ]);
  const runtime = await createRuntime(t, "chat-roundtrip");
  const binding = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: `${provider.url}/v1`,
    profileId: "chat-roundtrip",
    apiKey: "test-key",
    model: "chat-model",
    requestSettings: { stream: false },
  });
  const loop = createAgentSessionLoop({
    ...runtime,
    modelRegistry: binding.modelRegistry,
    selectedModel: binding.selectedModel,
    transformProviderPayload: binding.transformProviderPayload,
  });
  let executions = 0;

  const result = await loop.execute(loopInput(readFileGateway(() => { executions += 1; }), "read README"));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "tool evidence accepted");
  assert.equal(executions, 1);
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0]?.path, "/v1/chat/completions");
  assert.equal(provider.requests[0]?.body.stream, false);
  assert.equal("stream_options" in (provider.requests[0]?.body ?? {}), false);
  const secondMessages = provider.requests[1]?.body.messages;
  assert.equal(Array.isArray(secondMessages), true);
  assert.equal((secondMessages as Array<{ role?: string }>).some((message) => message.role === "tool"), true);
  await loop.release();
});

test("model provider round trip replays hosted Responses output on the next Session turn", async (t) => {
  const hostedOutput = {
    type: "web_search_call",
    id: "search-1",
    status: "completed",
    action: { type: "search", query: "AgentArbor" },
  };
  const provider = await startJsonProvider(t, [
    responsesCompletion([
      hostedOutput,
      responseMessage("message-1", "first answer"),
    ], "response-1"),
    responsesCompletion([responseMessage("message-2", "second answer")], "response-2"),
  ]);
  const runtime = await createRuntime(t, "responses-roundtrip");
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: `${provider.url}/v1`,
    profileId: "responses-roundtrip",
    apiKey: "test-key",
    model: "responses-model",
    requestSettings: { stream: false },
    enableWebSearch: true,
  });

  const firstLoop = createAgentSessionLoop({
    ...runtime,
    modelRegistry: binding.modelRegistry,
    selectedModel: binding.selectedModel,
    transformProviderPayload: binding.transformProviderPayload,
  });
  const first = await firstLoop.execute(loopInput(emptyGateway(), "search once"));
  assert.equal(first.status, "completed", first.status === "failed" ? first.error : undefined);
  await firstLoop.release();

  const secondLoop = createAgentSessionLoop({
    ...runtime,
    modelRegistry: binding.modelRegistry,
    selectedModel: binding.selectedModel,
    transformProviderPayload: binding.transformProviderPayload,
  });
  const second = await secondLoop.execute(loopInput(emptyGateway(), "continue"));

  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  assert.equal(provider.requests.length, 2);
  for (const request of provider.requests) {
    assert.equal(request.path, "/v1/responses");
    assert.equal(request.body.stream, false);
    assert.equal(
      Array.isArray(request.body.tools) &&
        request.body.tools.some((tool) => isRecord(tool) && tool.type === "web_search"),
      true,
    );
  }
  const replayInput = provider.requests[1]?.body.input;
  assert.equal(Array.isArray(replayInput), true);
  assert.equal((replayInput as unknown[]).some((item) => isRecord(item) && item.id === "search-1"), true);
  assert.equal((replayInput as unknown[]).indexOf(
    (replayInput as unknown[]).find((item) => isRecord(item) && item.id === "search-1"),
  ) < (replayInput as unknown[]).indexOf(
    (replayInput as unknown[]).find((item) => isRecord(item) && item.id === "message-1"),
  ), true);
  await secondLoop.release();
});

test("model provider round trip normalizes cumulative MiniMax deltas behind a proxy alias", async (t) => {
  const provider = await startJsonProvider(t, [{
    contentType: "text/event-stream",
    body: chatStream([
      { content: "Hel", reasoning_content: "Th" },
      { content: "Hello", reasoning_content: "Think" },
    ]),
  }]);
  const runtime = await createRuntime(t, "minimax-roundtrip");
  const binding = createModelProviderBinding({
    protocol: "openai_compatible_chat_completions",
    baseUrl: `${provider.url}/v1`,
    profileId: "minimax-proxy",
    providerProfileId: "minimax",
    apiKey: "test-key",
    model: "proxy-alias",
    requestSettings: { stream: true },
    supportsReasoningOutput: true,
  });
  const loop = createAgentSessionLoop({
    ...runtime,
    modelRegistry: binding.modelRegistry,
    selectedModel: binding.selectedModel,
    transformProviderPayload: binding.transformProviderPayload,
  });
  const textDeltas: string[] = [];
  const completedReasoning: string[] = [];

  const result = await loop.execute(loopInput(emptyGateway(), "think", {
    onTextDelta: (delta) => { textDeltas.push(delta); },
    onReasoningCompleted: async (reasoning) => { completedReasoning.push(reasoning); },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "Hello");
  assert.deepEqual(textDeltas, ["Hel", "lo"]);
  assert.deepEqual(completedReasoning, ["Think"]);
  assert.deepEqual(provider.requests[0]?.body.stream_options, { include_usage: true });
  assert.equal(result.status === "completed" ? result.usage.inputTokens : undefined, 11);
  assert.equal(result.status === "completed" ? result.usage.outputTokens : undefined, 7);
  assert.equal(result.status === "completed" ? result.usage.totalTokens : undefined, 18);
  await loop.release();
});

test("model provider round trip maps a non-streaming Responses refusal to failure", async (t) => {
  const provider = await startJsonProvider(t, [responsesCompletion([{
    type: "message",
    id: "refusal-message",
    role: "assistant",
    status: "completed",
    content: [{ type: "refusal", refusal: "I cannot complete that request." }],
  }], "refusal-response")]);
  const runtime = await createRuntime(t, "refusal-roundtrip");
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: `${provider.url}/v1`,
    profileId: "refusal-profile",
    apiKey: "test-key",
    model: "responses-model",
    requestSettings: { stream: false },
  });
  const loop = createAgentSessionLoop({
    ...runtime,
    modelRegistry: binding.modelRegistry,
    selectedModel: binding.selectedModel,
    transformProviderPayload: binding.transformProviderPayload,
  });

  const result = await loop.execute(loopInput(emptyGateway(), "refuse"));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "model_refusal");
  assert.equal(
    result.status === "failed" ? result.error : undefined,
    "The model refused the request: I cannot complete that request.",
  );
  await loop.release();
});

type ProviderRequest = {
  readonly path: string;
  readonly body: Record<string, unknown>;
};

async function startJsonProvider(
  t: test.TestContext,
  responses: readonly ProviderResponse[],
): Promise<{ readonly url: string; readonly requests: ProviderRequest[] }> {
  const requests: ProviderRequest[] = [];
  let responseIndex = 0;
  const server = createServer(async (request, response) => {
    await handleJsonRequest(request, response, requests, responses[responseIndex++]);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Provider test server did not expose a TCP port.");
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

async function handleJsonRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: ProviderRequest[],
  providerResponse: ProviderResponse | undefined,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  requests.push({ path: request.url ?? "", body: parsed });
  if (providerResponse === undefined) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Unexpected provider request" } }));
    return;
  }
  if (isRawProviderResponse(providerResponse)) {
    response.writeHead(200, { "content-type": providerResponse.contentType });
    response.end(providerResponse.body);
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(providerResponse));
}

async function createRuntime(t: test.TestContext, sessionId: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-provider-roundtrip-"));
  const executionEnvironment = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await executionEnvironment.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return {
    executionEnvironment,
    agentSession: await new InMemorySessionRepo().create({ id: sessionId }),
  };
}

function loopInput(
  gateway: ToolExecutionGateway,
  userMessage: string,
  overrides: Partial<AgentLoopInput> = {},
): AgentLoopInput {
  return {
    instructions: "You are the Ordinary Agent.",
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: userMessage },
    ],
    tools: {
      definitions: gateway.list(),
      gateway,
      context: { callerAgentId: "ordinary", traceId: "roundtrip", goalId: "roundtrip" },
      permission: { callerAgentId: "ordinary", allowedTools: gateway.list().map((tool) => tool.name) },
    },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function readFileGateway(onExecute: () => void): ToolExecutionGateway {
  const definition: ToolDefinition = {
    name: "read",
    description: "Read a file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    metadata: {
      category: "workspace",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
  return gateway([definition], async (request) => {
    onExecute();
    return {
      ...request,
      output: { content: "README evidence" },
      status: "completed",
      durationMs: 1,
    };
  });
}

function emptyGateway(): ToolExecutionGateway {
  return gateway([], async () => { throw new Error("No tools are available."); });
}

function gateway(
  definitions: ToolDefinition[],
  execute: (request: ToolCallRequest) => Promise<ToolCallResult>,
): ToolExecutionGateway {
  return {
    list: () => globalThis.structuredClone(definitions),
    has: (name) => definitions.some((definition) => definition.name === name),
    preflight: (request) => ({ status: "ready", request }),
    execute,
  };
}

function chatCompletion(
  message: Record<string, unknown>,
  finishReason: "stop" | "tool_calls",
): Record<string, unknown> {
  return {
    id: `chat-${finishReason}`,
    object: "chat.completion",
    created: 1,
    model: "chat-model",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
  };
}

function responsesCompletion(output: readonly unknown[], id: string): Record<string, unknown> {
  return {
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model: "responses-model",
    output,
    output_text: "",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 4,
      output_tokens: 2,
      total_tokens: 6,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function responseMessage(id: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

type ProviderResponse = Record<string, unknown> | {
  readonly contentType: string;
  readonly body: string;
};

function isRawProviderResponse(value: ProviderResponse): value is Extract<ProviderResponse, { readonly body: string }> {
  return typeof value.body === "string" && typeof value.contentType === "string";
}

function chatStream(deltas: readonly Readonly<Record<string, unknown>>[]): string {
  const events: Record<string, unknown>[] = deltas.map((delta) => ({
    id: "chat-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: "proxy-alias",
    choices: [{ index: 0, delta, finish_reason: null }],
  }));
  events.push({
    id: "chat-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: "proxy-alias",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  });
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
