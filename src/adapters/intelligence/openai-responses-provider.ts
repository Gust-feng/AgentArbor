import OpenAI from "openai";
import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
import type {
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
} from "./openai-fetch-bridge.js";
import { configuredOpenAIStream } from "./openai-request-settings.js";
import { buildResponsesRequestBody } from "./openai-responses-request.js";
import {
  normalizeOpenAIResponsesResponse,
  normalizeOpenAIResponsesStreamResponse,
} from "./openai-responses-response.js";
import { providerErrorMessage } from "./provider-error-message.js";
import { OpenAIModelInputError } from "./openai-model-input-error.js";
import {
  classifyProviderFailureKind,
  isContextWindowExceededMessage,
  isRetryableProviderFailureStatus,
  isTimeoutLikeError,
  type ProviderContextWindowExceededHandler,
} from "./provider-failure-classification.js";
import { asRecord } from "./provider-value-utils.js";

export type OpenAIResponsesProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly stream?: boolean;
  readonly forceStreaming?: boolean;
  readonly requestSettings?: OpenAIModelRequestSettings;
  readonly enableWebSearch?: boolean;
  readonly onContextWindowExceeded?: ProviderContextWindowExceededHandler;
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
};

export class OpenAIResponsesProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "openai_compatible" as const;
  readonly protocolKind = "openai_responses" as const;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: FetchLike;
  private readonly stream: boolean;
  private readonly forceStreaming: boolean;
  private readonly requestSettings?: OpenAIModelRequestSettings;
  private readonly enableWebSearch: boolean;
  private readonly onContextWindowExceeded?: ProviderContextWindowExceededHandler;
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.providerId = options.providerId ?? "openai-responses";
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
    this.stream = options.stream ?? false;
    this.forceStreaming = options.forceStreaming === true;
    this.requestSettings = options.requestSettings;
    this.enableWebSearch = options.enableWebSearch === true;
    this.onContextWindowExceeded = options.onContextWindowExceeded;
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
      const requestBody = buildResponsesRequestBody(request, this.model, stream, this.requestSettings, {
        enableWebSearch: this.enableWebSearch,
      });

      if (stream) {
        const stream = await client.responses.create(requestBody, { signal: options.abortSignal });
        return await normalizeOpenAIResponsesStreamResponse({
          request,
          stream: stream as unknown as AsyncIterable<unknown>,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          startedAtMs: startedAt,
          emitDelta: this.onOutputDelta,
        });
      }

      const raw = await client.responses.create(requestBody, { signal: options.abortSignal });
      return normalizeOpenAIResponsesResponse({
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

      if (error instanceof OpenAIModelInputError) {
        return createFailedModelResponse({
          requestId: request.requestId,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          outputKind: request.outputContract.outputKind,
          failureKind: "request_validation",
          message: error.message,
        });
      }

      const status = statusFromError(error);
      if (status !== undefined) {
        const message = providerErrorMessage(error, `HTTP ${status}`);
        await notifyContextWindowExceeded(this.onContextWindowExceeded, { message, status });
        return createFailedModelResponse({
          requestId: request.requestId,
          providerId: this.providerId,
          providerKind: this.providerKind,
          protocolKind: this.protocolKind,
          model: this.model,
          outputKind: request.outputContract.outputKind,
          failureKind: classifyProviderFailureKind(status),
          retryable: isRetryableProviderFailureStatus(status),
          message,
        });
      }

      const timeoutLike = isTimeoutLikeError(lastTransportError ?? error);
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: timeoutLike ? "provider_timeout" : "provider_network",
        retryable: true,
        message: providerErrorMessage(
          lastTransportError ?? error,
          timeoutLike ? "Request timed out." : "Network request failed."
        ),
      });
    }
  }
}

async function notifyContextWindowExceeded(
  handler: ProviderContextWindowExceededHandler | undefined,
  input: {
    readonly message: string;
    readonly status?: number;
  }
): Promise<void> {
  if (handler === undefined || !isContextWindowExceededMessage(input.message)) {
    return;
  }
  await handler(input);
}

function cancelledResponse(input: {
  request: ModelRequest;
  providerId: string;
  providerKind: "openai_compatible";
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

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function statusFromError(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}
