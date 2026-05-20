import OpenAI from "openai";
import type {
  ModelMessage,
  ModelFailureKind,
  ModelOutputDelta,
  ModelProvider,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolDefinition } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { normalizeOpenAICompatibleSdkBaseUrl } from "./openai-compatible-base-url.js";
import { providerErrorMessage } from "./provider-error-message.js";

export type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  }
) => Promise<FetchLikeResponse>;

export type FetchLikeResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
};

export type OpenAICompatibleChatCompletionsProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly stream?: boolean;
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export class OpenAICompatibleChatCompletionsProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "openai_compatible" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: FetchLike;
  private readonly stream: boolean;
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;

  constructor(options: OpenAICompatibleChatCompletionsProviderOptions) {
    this.providerId = options.providerId ?? "openai-compatible-chat-completions";
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
    this.stream = options.stream ?? false;
    this.onOutputDelta = options.onOutputDelta;
  }

  async complete(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const fetchImpl = this.fetchImpl ?? resolveGlobalFetch();
    if (fetchImpl === undefined) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_config",
        message: "OpenAI-compatible provider requires global fetch or an injected fetch implementation.",
      });
    }

    const startedAt = Date.now();
    try {
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: normalizeOpenAICompatibleSdkBaseUrl(this.baseUrl),
        fetch: toOpenAIFetch(fetchImpl),
        maxRetries: 0,
      });
      const requestBody: Record<string, unknown> = {
        model: this.model,
        messages: request.sanitizedMessages.map(toOpenAIMessage),
        tools: request.tools === undefined || request.tools.length === 0 ? undefined : request.tools.map(toOpenAITool),
        tool_choice: toOpenAIToolChoice(request.toolChoice),
        response_format:
          request.outputContract.format === "json_object" ? { type: "json_object" } : undefined,
        max_tokens: request.budget.maxOutputTokens,
        stream: this.stream ? true : undefined,
      };

      if (this.stream) {
        const stream = await client.chat.completions.create(removeUndefinedValues(requestBody) as never, { signal: options.abortSignal });
        return await normalizeOpenAICompatibleStreamResponse({
          request,
          stream: stream as unknown as AsyncIterable<unknown>,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          latencyMs: Date.now() - startedAt,
          emitDelta: this.onOutputDelta,
        });
      }

      const raw = await client.chat.completions.create(removeUndefinedValues(requestBody) as never, { signal: options.abortSignal });
      return normalizeOpenAICompatibleResponse({
        request,
        raw,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (options.abortSignal?.aborted === true) {
        return {
          responseId: createId("model-response"),
          requestId: request.requestId,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          status: "cancelled",
          outputKind: request.outputContract.outputKind,
          finishReason: "error",
          validation: pendingModelOutputValidation(),
          failure: {
            kind: "provider_network",
            message: "OpenAI-compatible provider request was cancelled.",
            retryable: false,
            sanitizedErrorRef: "model-error:cancelled",
          },
          completedAt: nowIso(),
        };
      }
      const status = statusFromError(error);
      if (status !== undefined) {
        return createFailedModelResponse({
          requestId: request.requestId,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          outputKind: request.outputContract.outputKind,
          failureKind: failureKindForStatus(status),
          retryable: status === 429 || status >= 500,
          message: providerErrorMessage(error, `HTTP ${status}`),
        });
      }
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_network",
        retryable: true,
        message: providerErrorMessage(error, "Network request failed."),
      });
    }
  }
}

function normalizeOpenAICompatibleResponse(input: {
  request: ModelRequest;
  raw: unknown;
  providerId: string;
  providerKind: "openai_compatible";
  protocolKind: "openai_compatible_chat_completions";
  model: string;
  latencyMs: number;
}): ModelResponse {
  const raw = asRecord(input.raw);
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const content = typeof message.content === "string" ? message.content : "";
  const parsedOutput = parseStructuredOutput(content);
  const toolCalls = parseToolCalls(message.tool_calls);
  const assistantMessage = assistantContinuationMessage({ message, content, toolCalls });
  const usage = asRecord(raw.usage);

  return {
    responseId: createId("model-response"),
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: typeof raw.model === "string" ? raw.model : input.model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: content,
    assistantMessage,
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: {
      inputTokens: numberOrUndefined(usage.prompt_tokens),
      outputTokens: numberOrUndefined(usage.completion_tokens),
      totalTokens: numberOrUndefined(usage.total_tokens),
      latencyMs: input.latencyMs,
    },
    finishReason: finishReasonForOpenAI(firstChoice.finish_reason),
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function removeUndefinedValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

async function normalizeOpenAICompatibleStreamResponse(input: {
  request: ModelRequest;
  stream: AsyncIterable<unknown>;
  providerId: string;
  providerKind: "openai_compatible";
  protocolKind: "openai_compatible_chat_completions";
  model: string;
  latencyMs: number;
  emitDelta?: (delta: ModelOutputDelta) => void;
}): Promise<ModelResponse> {
  let content = "";
  let model = input.model;
  let finishReason: ModelResponse["finishReason"];
  let deltaIndex = 0;
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  const protocolExtensions = new Map<string, unknown>();

  try {
    for await (const rawEvent of input.stream) {
      const raw = asRecord(rawEvent);
      if (typeof raw.model === "string") {
        model = raw.model;
      }
      const choices = Array.isArray(raw.choices) ? raw.choices : [];
      const firstChoice = asRecord(choices[0]);
      const delta = asRecord(firstChoice.delta);
      const contentDelta = typeof delta.content === "string" ? delta.content : "";
      if (contentDelta.length > 0) {
        content += contentDelta;
        deltaIndex += 1;
        input.emitDelta?.({
          requestId: input.request.requestId,
          purpose: input.request.purpose,
          providerId: input.providerId,
          model,
          delta: contentDelta,
          index: deltaIndex,
          createdAt: nowIso(),
        });
      }
      accumulateStreamingToolCalls(toolCalls, delta.tool_calls);
      accumulateStreamingProtocolExtensions(protocolExtensions, delta);
      finishReason = finishReasonForOpenAI(firstChoice.finish_reason) ?? finishReason;
    }
  } catch {
    return createFailedModelResponse({
      requestId: input.request.requestId,
      providerId: input.providerId,
      providerKind: input.providerKind,
      protocolKind: input.protocolKind,
      model,
      outputKind: input.request.outputContract.outputKind,
      failureKind: "provider_response",
      retryable: true,
      message: "OpenAI-compatible provider stream response could not be parsed.",
    });
  }

  const parsedOutput = parseStructuredOutput(content);
  const completedToolCalls: ToolCallRequest[] = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, call]) => {
      if (typeof call.name !== "string" || call.name.length === 0) {
        return [];
      }
      return [
        {
          callId: call.id ?? createId("tool-call"),
          toolName: call.name,
          input: parseToolArguments(call.arguments),
        },
      ];
    });
  const assistantMessage =
    completedToolCalls.length === 0
      ? undefined
      : {
          role: "assistant" as const,
          content,
          toolCalls: completedToolCalls,
          protocolExtensions: protocolExtensionsFromMap(protocolExtensions),
        };

  return {
    responseId: createId("model-response"),
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      completedToolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: content,
    assistantMessage,
    toolCalls: completedToolCalls.length === 0 ? undefined : completedToolCalls,
    usage: {
      latencyMs: input.latencyMs,
    },
    finishReason: completedToolCalls.length > 0 ? "tool_call" : finishReason,
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function accumulateStreamingToolCalls(
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>,
  value: unknown
): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    const record = asRecord(item);
    const index = typeof record.index === "number" ? record.index : toolCalls.size;
    const fn = asRecord(record.function);
    const current = toolCalls.get(index) ?? { arguments: "" };
    toolCalls.set(index, {
      id: typeof record.id === "string" ? record.id : current.id,
      name: typeof fn.name === "string" ? fn.name : current.name,
      arguments: current.arguments + (typeof fn.arguments === "string" ? fn.arguments : ""),
    });
  }
}

function accumulateStreamingProtocolExtensions(extensions: Map<string, unknown>, delta: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(delta)) {
    if (isStandardOpenAIMessageField(key) || !isProtocolExtensionValue(value)) {
      continue;
    }
    const current = extensions.get(key);
    if (typeof current === "string" && typeof value === "string") {
      extensions.set(key, current + value);
    } else if (current === undefined) {
      extensions.set(key, value);
    }
  }
}

function protocolExtensionsFromMap(extensions: ReadonlyMap<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  if (extensions.size === 0) {
    return undefined;
  }
  return Object.fromEntries(extensions.entries());
}

function resolveGlobalFetch(): FetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function failureKindForStatus(status: number): ModelFailureKind {
  if (status === 401 || status === 403) {
    return "provider_auth";
  }
  if (status === 429) {
    return "provider_rate_limit";
  }
  return "provider_response";
}

function statusFromError(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

function toOpenAIFetch(fetchImpl: FetchLike): typeof fetch {
  return async (url, init = {}) => {
    const method = typeof init.method === "string" ? init.method : "POST";
    const response = await fetchImpl(String(url), {
      method: method as "POST",
      headers: headersToRecord(init.headers),
      body: typeof init.body === "string" ? init.body : init.body === undefined ? "" : String(init.body),
      signal: init.signal === null ? undefined : init.signal,
    });

    if (response.body !== undefined && requestWantsStream(init.body)) {
      return new Response(toReadableStream(response.body), {
        status: response.status,
        headers: { "content-type": "text/event-stream" },
      });
    }

    const body = await fetchLikeResponseText(response);
    return new Response(body, {
      status: response.status,
      headers: { "content-type": looksLikeJson(body) ? "application/json" : "text/plain" },
    });
  };
}

function requestWantsStream(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") {
    return false;
  }
  try {
    return asRecord(JSON.parse(body)).stream === true;
  } catch {
    return false;
  }
}

async function fetchLikeResponseText(response: Awaited<ReturnType<FetchLike>>): Promise<string> {
  if (response.text !== undefined) {
    return response.text();
  }
  return JSON.stringify(await response.json());
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function toReadableStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) {
    return body as ReadableStream<Uint8Array>;
  }
  const iterator = iterateBytes(body);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
  });
}

async function* iterateBytes(body: unknown): AsyncGenerator<Uint8Array> {
  if (isAsyncIterable(body)) {
    for await (const chunk of body) {
      yield encodeChunk(chunk);
    }
    return;
  }
  yield encodeChunk(body);
}

function encodeChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new TextEncoder().encode(String(value));
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function parseStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function finishReasonForOpenAI(value: unknown): ModelResponse["finishReason"] {
  switch (value) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_call";
    case "content_filter":
      return "content_filter";
    default:
      return undefined;
  }
}

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      ...protocolExtensionsForRequest(message.protocolExtensions),
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map(toOpenAIToolCall),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAITool(definition: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

function toOpenAIToolChoice(choice: ModelToolChoice | undefined): unknown {
  if (choice === undefined) {
    return undefined;
  }
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  return {
    type: "function",
    function: {
      name: choice.function.name,
    },
  };
}

function toOpenAIToolCall(toolCall: ToolCallRequest): Record<string, unknown> {
  return {
    id: toolCall.callId,
    type: "function",
    function: {
      name: toolCall.toolName,
      arguments: JSON.stringify(toolCall.input),
    },
  };
}

function parseToolCalls(value: unknown): ToolCallRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: ToolCallRequest[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const fn = asRecord(record.function);
    const name = typeof fn.name === "string" ? fn.name : undefined;
    if (name === undefined) {
      continue;
    }
    calls.push({
      callId: typeof record.id === "string" ? record.id : createId("tool-call"),
      toolName: name,
      input: parseToolArguments(fn.arguments),
    });
  }
  return calls;
}

function assistantContinuationMessage(input: {
  readonly message: Record<string, unknown>;
  readonly content: string;
  readonly toolCalls: readonly ToolCallRequest[];
}): ModelMessage | undefined {
  if (input.toolCalls.length === 0) {
    return undefined;
  }
  return {
    role: "assistant",
    content: input.content,
    toolCalls: input.toolCalls,
    protocolExtensions: protocolExtensionsForResponse(input.message),
  };
}

function protocolExtensionsForResponse(message: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined {
  const entries = Object.entries(message).filter(
    ([key, value]) => !isStandardOpenAIMessageField(key) && isProtocolExtensionValue(value)
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function protocolExtensionsForRequest(
  extensions: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (extensions === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(extensions).filter(
      ([key, value]) => !isStandardOpenAIMessageField(key) && isProtocolExtensionValue(value)
    )
  );
}

function isStandardOpenAIMessageField(key: string): boolean {
  return (
    key === "role" ||
    key === "content" ||
    key === "refusal" ||
    key === "tool_calls" ||
    key === "function_call" ||
    key === "tool_call_id" ||
    key === "name"
  );
}

function isProtocolExtensionValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    default:
      return false;
  }
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { rawArguments: value };
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
