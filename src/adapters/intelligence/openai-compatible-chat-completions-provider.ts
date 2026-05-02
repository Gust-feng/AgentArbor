import type {
  ModelFailureKind,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
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
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
};

export type OpenAICompatibleChatCompletionsProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: FetchLike;
};

export class OpenAICompatibleChatCompletionsProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "openai_compatible" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: FetchLike;

  constructor(options: OpenAICompatibleChatCompletionsProviderOptions) {
    this.providerId = options.providerId ?? "openai-compatible-chat-completions";
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
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
      const response = await fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.sanitizedMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          response_format:
            request.outputContract.format === "json_object" ? { type: "json_object" } : undefined,
        }),
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
    structuredOutput: input.request.outputContract.format === "json_object" ? parsedOutput : undefined,
    textOutput: content,
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

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
