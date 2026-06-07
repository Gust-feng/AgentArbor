import OpenAI from "openai";
import type { OpenAIModelRequestSettings, ProviderProtocolProfileId } from "../../domain/config/index.js";
import type {
  ModelFailureKind,
  ModelOutputDelta,
  ModelProvider,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { normalizeOpenAICompatibleSdkBaseUrl } from "./openai-compatible-base-url.js";
import {
  resolveGlobalFetch,
  toOpenAIFetch,
  type FetchLike,
  type FetchLikeResponse,
} from "./openai-fetch-bridge.js";
import { asRecord } from "./provider-value-utils.js";
import { configuredOpenAIStream } from "./openai-request-settings.js";
import {
  resolveOpenAICompatibleChatDialect,
  type OpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";
import { buildOpenAICompatibleChatRequestBody } from "./openai-compatible-chat-request.js";
import { normalizeOpenAICompatibleResponse } from "./openai-compatible-chat-response.js";
import { normalizeOpenAICompatibleStreamResponse } from "./openai-compatible-chat-stream.js";
import { providerErrorMessage } from "./provider-error-message.js";

export type { FetchLike, FetchLikeResponse } from "./openai-fetch-bridge.js";

export type OpenAICompatibleChatCompletionsProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly providerProfileId?: ProviderProtocolProfileId;
  readonly fetch?: FetchLike;
  readonly stream?: boolean;
  readonly forceStreaming?: boolean;
  readonly requestSettings?: OpenAIModelRequestSettings;
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export class OpenAICompatibleChatCompletionsProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "openai_compatible" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly dialect: OpenAICompatibleChatDialect;
  private readonly fetchImpl?: FetchLike;
  private readonly stream: boolean;
  private readonly forceStreaming: boolean;
  private readonly requestSettings?: OpenAIModelRequestSettings;
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;

  constructor(options: OpenAICompatibleChatCompletionsProviderOptions) {
    this.providerId = options.providerId ?? "openai-compatible-chat-completions";
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dialect = resolveOpenAICompatibleChatDialect({
      providerProfileId: options.providerProfileId,
      baseUrl: this.baseUrl,
      model: this.model,
    });
    this.fetchImpl = options.fetch;
    this.forceStreaming = options.forceStreaming === true;
    this.stream = (options.stream ?? false) && (this.dialect.supportsStreaming || this.forceStreaming);
    this.requestSettings = options.requestSettings;
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
    let lastTransportError: unknown;
    const openAIFetch = toOpenAIFetch(fetchImpl);
    try {
      const client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: normalizeOpenAICompatibleSdkBaseUrl(this.baseUrl),
        fetch: async (url, init) => {
          try {
            return await openAIFetch(url, init);
          } catch (error) {
            lastTransportError = error;
            throw error;
          }
        },
        maxRetries: 0,
      });
      const stream = configuredOpenAIStream(this.stream, this.requestSettings, {
        forceStreaming: this.forceStreaming,
      });
      const requestBody = buildOpenAICompatibleChatRequestBody({
        request,
        model: this.model,
        dialect: this.dialect,
        stream,
        requestSettings: this.requestSettings,
      });

      if (stream) {
        const stream = await client.chat.completions.create(requestBody as never, { signal: options.abortSignal });
        const streamed = await normalizeOpenAICompatibleStreamResponse({
          request,
          stream: stream as unknown as AsyncIterable<unknown>,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          dialect: this.dialect,
          latencyMs: Date.now() - startedAt,
          emitDelta: this.onOutputDelta,
        });
        if (shouldRetryWithoutStreaming(streamed, options.abortSignal)) {
          const fallbackBody = buildOpenAICompatibleChatRequestBody({
            request,
            model: this.model,
            dialect: this.dialect,
            stream: false,
            requestSettings: this.requestSettings,
          });
          const fallback = await client.chat.completions.create(fallbackBody as never, { signal: options.abortSignal });
          return normalizeOpenAICompatibleResponse({
            request,
            raw: fallback,
            providerId: this.providerId,
            providerKind: this.providerKind,
            protocolKind: this.protocolKind,
            model: this.model,
            dialect: this.dialect,
            latencyMs: Date.now() - startedAt,
          });
        }
        return streamed;
      }

      const raw = await client.chat.completions.create(requestBody as never, { signal: options.abortSignal });
      return normalizeOpenAICompatibleResponse({
        request,
        raw,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        dialect: this.dialect,
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
        message: providerErrorMessage(lastTransportError ?? error, "Network request failed."),
      });
    }
  }
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

function shouldRetryWithoutStreaming(
  response: ModelResponse,
  abortSignal: AbortSignal | undefined
): boolean {
  return abortSignal?.aborted !== true &&
    response.status === "failed" &&
    response.failure?.kind === "provider_response" &&
    /stream response could not be parsed/i.test(response.failure.message);
}

function statusFromError(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}
