import type {
  ModelMessage,
  ModelFailureKind,
  ModelOutputDelta,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolChoice,
} from "../../domain/intelligence/index.js";
import type { ToolCallRequest, ToolDefinition } from "../../domain/tools/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";

export type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
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

  async complete(request: ModelRequest): Promise<ModelResponse> {
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
      const requestBody: Record<string, unknown> = {
        model: this.model,
        messages: request.sanitizedMessages.map(toOpenAIMessage),
        tools: request.tools === undefined || request.tools.length === 0 ? undefined : request.tools.map(toOpenAITool),
        tool_choice: toOpenAIToolChoice(request.toolChoice),
        response_format:
          request.outputContract.format === "json_object" ? { type: "json_object" } : undefined,
        stream: this.stream ? true : undefined,
      };
      const response = await fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(removeUndefinedValues(requestBody)),
      });

      if (!response.ok) {
        return createFailedModelResponse({
          requestId: request.requestId,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          outputKind: request.outputContract.outputKind,
          failureKind: failureKindForStatus(response.status),
          retryable: response.status === 429 || response.status >= 500,
          message: `OpenAI-compatible provider returned HTTP ${response.status}.`,
        });
      }

      if (this.stream && response.body !== undefined) {
        return await normalizeOpenAICompatibleStreamResponse({
          request,
          body: response.body,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          latencyMs: Date.now() - startedAt,
          emitDelta: this.onOutputDelta,
        });
      }

      const raw = await response.json();
      return normalizeOpenAICompatibleResponse({
        request,
        raw,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        latencyMs: Date.now() - startedAt,
      });
    } catch {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_network",
        retryable: true,
        message: "OpenAI-compatible provider network request failed.",
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
  body: unknown;
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

  try {
    for await (const data of iterateSseData(input.body)) {
      if (data === "[DONE]") {
        break;
      }
      const raw = asRecord(JSON.parse(data) as unknown);
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
          providerId: input.providerId,
          model,
          delta: contentDelta,
          index: deltaIndex,
          createdAt: nowIso(),
        });
      }
      accumulateStreamingToolCalls(toolCalls, delta.tool_calls);
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

async function* iterateSseData(body: unknown): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of iterateTextChunks(body)) {
    buffer += chunk;
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split(/\r?\n/g)) {
        if (line.startsWith("data:")) {
          yield line.slice("data:".length).trim();
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim().length > 0) {
    for (const line of buffer.split(/\r?\n/g)) {
      if (line.startsWith("data:")) {
        yield line.slice("data:".length).trim();
      }
    }
  }
}

async function* iterateTextChunks(body: unknown): AsyncGenerator<string> {
  if (isAsyncIterable(body)) {
    for await (const chunk of body) {
      yield decodeChunk(chunk);
    }
    return;
  }
  if (isReadableStreamLike(body)) {
    const reader = body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        yield decodeChunk(result.value);
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }
  throw new Error("Unsupported streaming response body.");
}

function decodeChunk(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return String(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isReadableStreamLike(value: unknown): value is {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>;
    releaseLock?: () => void;
  };
} {
  return typeof value === "object" && value !== null && "getReader" in value && typeof (value as { getReader?: unknown }).getReader === "function";
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
      name: message.toolName,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
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
