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
import type { FetchLike } from "./openai-compatible-chat-completions-provider.js";

export type OpenAIResponsesProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly stream?: boolean;
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export class OpenAIResponsesProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "openai" as const;
  readonly protocolKind = "openai_responses" as const;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: FetchLike;
  private readonly stream: boolean;
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.providerId = options.providerId ?? "openai-responses";
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
        message: "OpenAI Responses provider requires global fetch or an injected fetch implementation.",
      });
    }

    const startedAt = Date.now();
    try {
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: responsesBaseUrl(this.baseUrl),
        fetch: toOpenAIFetch(fetchImpl),
        maxRetries: 0,
      });
      const requestBody = buildResponsesRequestBody(request, this.model, this.stream);

      if (this.stream) {
        const stream = await client.responses.create(requestBody, { signal: options.abortSignal });
        return await normalizeStreamResponse({
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

      const raw = await client.responses.create(requestBody, { signal: options.abortSignal });
      return normalizeResponse({
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
        return cancelledResponse({ request, providerId: this.providerId, providerKind: this.providerKind, protocolKind: this.protocolKind, model: this.model });
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
          message: `OpenAI Responses provider returned HTTP ${status}.`,
        });
      }

      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: timeoutLikeError(error) ? "provider_timeout" : "provider_network",
        retryable: true,
        message: timeoutLikeError(error)
          ? "OpenAI Responses provider request timed out."
          : "OpenAI Responses provider network request failed.",
      });
    }
  }
}

function buildResponsesRequestBody(
  request: ModelRequest,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const { instructions, input } = buildInput(request.sanitizedMessages);
  return removeUndefinedValues({
    model,
    input,
    instructions,
    tools: request.tools === undefined || request.tools.length === 0 ? undefined : request.tools.map(toResponsesTool),
    tool_choice: request.toolChoice === undefined ? undefined : toResponsesToolChoice(request.toolChoice),
    max_output_tokens: request.budget.maxOutputTokens,
    stream: stream ? true : undefined,
  });
}

function buildInput(messages: readonly ModelMessage[]): {
  instructions: string | undefined;
  input: unknown[];
} {
  let instructions: string | undefined;
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      instructions = instructions === undefined ? msg.content : `${instructions}\n\n${msg.content}`;
      continue;
    }

    if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        for (const call of msg.toolCalls) {
          input.push({
            type: "function_call",
            call_id: call.callId,
            name: call.toolName,
            arguments: JSON.stringify(call.input),
          });
        }
      }
      if (msg.content.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: msg.content }],
        });
      }
      continue;
    }

    input.push({
      type: "message",
      role: msg.role,
      content: [{ type: "input_text", text: msg.content }],
    });
  }

  return { instructions, input };
}

function toResponsesTool(definition: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema,
    strict: false,
  };
}

function toResponsesToolChoice(choice: ModelToolChoice): unknown {
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  return {
    type: "function",
    name: choice.function.name,
  };
}

function normalizeResponse(input: {
  request: ModelRequest;
  raw: unknown;
  providerId: string;
  providerKind: "openai";
  protocolKind: "openai_responses";
  model: string;
  latencyMs: number;
}): ModelResponse {
  const raw = asRecord(input.raw);
  const output = Array.isArray(raw.output) ? raw.output : [];
  const { textOutput, toolCalls } = parseOutputItems(output);
  const parsedOutput = parseStructuredOutput(textOutput);
  const responseId = typeof raw.id === "string" ? raw.id : createId("model-response");
  const usage = asRecord(raw.usage);

  return {
    responseId,
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: typeof raw.model === "string" ? raw.model : input.model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput,
    assistantMessage: assistantMessageFromOutput({ textOutput, toolCalls, responseId }),
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: {
      inputTokens: numberOrUndefined(usage.input_tokens),
      outputTokens: numberOrUndefined(usage.output_tokens),
      totalTokens: numberOrUndefined(usage.total_tokens),
      latencyMs: input.latencyMs,
    },
    finishReason: finishReasonFromStatus(raw.status, toolCalls),
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

async function normalizeStreamResponse(input: {
  request: ModelRequest;
  stream: AsyncIterable<unknown>;
  providerId: string;
  providerKind: "openai";
  protocolKind: "openai_responses";
  model: string;
  latencyMs: number;
  emitDelta?: (delta: ModelOutputDelta) => void;
}): Promise<ModelResponse> {
  let textContent = "";
  let responseId = createId("model-response");
  let responseStatus: string | undefined;
  let model = input.model;
  let deltaIndex = 0;
  const toolCallBuilders = new Map<number, { callId?: string; name?: string; arguments: string }>();

  try {
    for await (const rawEvent of input.stream) {
      const event = asRecord(rawEvent);
      const eventType = typeof event.type === "string" ? event.type : "";

      if (eventType === "response.created") {
        const response = asRecord(event.response);
        if (typeof response.id === "string") {
          responseId = response.id;
        }
        if (typeof response.model === "string") {
          model = response.model;
        }
        continue;
      }

      if (eventType === "response.output_item.added") {
        const item = asRecord(event.item);
        if (item.type === "function_call") {
          const outputIndex = typeof event.output_index === "number" ? event.output_index : toolCallBuilders.size;
          toolCallBuilders.set(outputIndex, {
            callId: typeof item.call_id === "string" ? item.call_id : undefined,
            name: typeof item.name === "string" ? item.name : undefined,
            arguments: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
        continue;
      }

      if (eventType === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta.length > 0) {
          textContent += delta;
          deltaIndex += 1;
          input.emitDelta?.({
            requestId: input.request.requestId,
            purpose: input.request.purpose,
            providerId: input.providerId,
            model,
            delta,
            index: deltaIndex,
            createdAt: nowIso(),
          });
        }
        continue;
      }

      if (eventType === "response.function_call_arguments.delta") {
        const outputIndex = typeof event.output_index === "number" ? event.output_index : 0;
        const builder = toolCallBuilders.get(outputIndex) ?? { arguments: "" };
        builder.arguments += typeof event.delta === "string" ? event.delta : "";
        toolCallBuilders.set(outputIndex, builder);
        continue;
      }

      if (eventType === "response.output_item.done") {
        const item = asRecord(event.item);
        if (item.type === "function_call") {
          const outputIndex = typeof event.output_index === "number" ? event.output_index : toolCallBuilders.size;
          const builder = toolCallBuilders.get(outputIndex) ?? { arguments: "" };
          toolCallBuilders.set(outputIndex, {
            callId: typeof item.call_id === "string" ? item.call_id : builder.callId,
            name: typeof item.name === "string" ? item.name : builder.name,
            arguments: typeof item.arguments === "string" && builder.arguments.length === 0 ? item.arguments : builder.arguments,
          });
        }
        continue;
      }

      if (eventType === "response.completed") {
        const response = asRecord(event.response);
        responseStatus = typeof response.status === "string" ? response.status : "completed";
        if (typeof response.id === "string") {
          responseId = response.id;
        }
        if (typeof response.model === "string") {
          model = response.model;
        }
        continue;
      }

      if (eventType === "response.incomplete") {
        responseStatus = "incomplete";
        continue;
      }

      if (eventType === "response.failed") {
        return createFailedModelResponse({
          requestId: input.request.requestId,
          providerId: input.providerId,
          providerKind: input.providerKind,
          protocolKind: input.protocolKind,
          model,
          outputKind: input.request.outputContract.outputKind,
          failureKind: "provider_response",
          retryable: true,
          message: "OpenAI Responses provider stream reported failure.",
        });
      }
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
      message: "OpenAI Responses provider stream response could not be parsed.",
    });
  }

  const toolCalls: ToolCallRequest[] = [...toolCallBuilders.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, builder]) => {
      if (typeof builder.name !== "string" || builder.name.length === 0) {
        return [];
      }
      return [
        {
          callId: builder.callId ?? createId("tool-call"),
          toolName: builder.name,
          input: parseToolArguments(builder.arguments),
        },
      ];
    });
  const parsedOutput = parseStructuredOutput(textContent);

  return {
    responseId,
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput:
      toolCalls.length > 0 ? undefined : input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: textContent,
    assistantMessage: assistantMessageFromOutput({ textOutput: textContent, toolCalls, responseId }),
    toolCalls: toolCalls.length === 0 ? undefined : toolCalls,
    usage: {
      latencyMs: input.latencyMs,
    },
    finishReason: toolCalls.length > 0 ? "tool_call" : finishReasonFromStatus(responseStatus, toolCalls),
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function parseOutputItems(output: unknown[]): {
  textOutput: string;
  toolCalls: ToolCallRequest[];
} {
  let textOutput = "";
  const toolCalls: ToolCallRequest[] = [];

  for (const item of output) {
    const record = asRecord(item);
    if (record.type === "message") {
      const content = Array.isArray(record.content) ? record.content : [];
      for (const part of content) {
        const partRecord = asRecord(part);
        if (partRecord.type === "output_text" && typeof partRecord.text === "string") {
          textOutput += partRecord.text;
        }
      }
    }

    if (record.type === "function_call") {
      const name = typeof record.name === "string" ? record.name : undefined;
      if (name !== undefined) {
        toolCalls.push({
          callId: typeof record.call_id === "string" ? record.call_id : createId("tool-call"),
          toolName: name,
          input: parseToolArguments(record.arguments),
        });
      }
    }
  }

  return { textOutput, toolCalls };
}

function assistantMessageFromOutput(input: {
  textOutput: string;
  toolCalls: readonly ToolCallRequest[];
  responseId: string;
}): ModelMessage | undefined {
  if (input.toolCalls.length === 0) {
    return undefined;
  }
  return {
    role: "assistant",
    content: input.textOutput,
    toolCalls: input.toolCalls,
    protocolExtensions: { response_id: input.responseId },
  };
}

function finishReasonFromStatus(
  status: unknown,
  toolCalls: readonly ToolCallRequest[]
): ModelResponse["finishReason"] {
  if (toolCalls.length > 0) {
    return "tool_call";
  }
  if (status === "completed") {
    return "stop";
  }
  if (status === "incomplete") {
    return "length";
  }
  return undefined;
}

function cancelledResponse(input: {
  request: ModelRequest;
  providerId: string;
  providerKind: "openai";
  protocolKind: "openai_responses";
  model: string;
}): ModelResponse {
  return {
    responseId: createId("model-response"),
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: input.model,
    status: "cancelled",
    outputKind: input.request.outputContract.outputKind,
    finishReason: "error",
    validation: pendingModelOutputValidation(),
    failure: {
      kind: "provider_network",
      message: "OpenAI Responses provider request was cancelled.",
      retryable: false,
      sanitizedErrorRef: "model-error:cancelled",
    },
    completedAt: nowIso(),
  };
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

    if (response.body !== undefined) {
      return new Response(toReadableStream(response.body), {
        status: response.status,
        headers: { "content-type": "text/event-stream" },
      });
    }

    const json = await response.json();
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
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

function resolveGlobalFetch(): FetchLike | undefined {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  return typeof fetchImpl === "function" ? fetchImpl : undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function responsesBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
}

function failureKindForStatus(status: number): ModelFailureKind {
  if (status === 401 || status === 403) {
    return "provider_auth";
  }
  if (status === 429) {
    return "provider_rate_limit";
  }
  if (status === 408 || status === 504) {
    return "provider_timeout";
  }
  return "provider_response";
}

function statusFromError(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

function timeoutLikeError(error: unknown): boolean {
  const record = asRecord(error);
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return name.includes("timeout") || message.includes("timeout") || message.includes("timed out");
}

function removeUndefinedValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function parseStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
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
