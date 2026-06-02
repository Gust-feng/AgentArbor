import OpenAI from "openai";
import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";
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
} from "./openai-fetch-bridge.js";
import { configuredOpenAIStream } from "./openai-request-settings.js";
import { buildResponsesRequestBody } from "./openai-responses-request.js";
import {
  normalizeOpenAIResponsesResponse,
  normalizeOpenAIResponsesStreamResponse,
} from "./openai-responses-response.js";
import { providerErrorMessage } from "./provider-error-message.js";
import { asRecord } from "./provider-value-utils.js";

export type OpenAIResponsesProviderOptions = {
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: FetchLike;
  readonly stream?: boolean;
  readonly requestSettings?: OpenAIModelRequestSettings;
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
  private readonly requestSettings?: OpenAIModelRequestSettings;
  private readonly onOutputDelta?: (delta: ModelOutputDelta) => void;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.providerId = options.providerId ?? "openai-responses";
    this.baseUrl = trimTrailingSlashes(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
    this.stream = options.stream ?? false;
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
        message: "OpenAI Responses provider requires global fetch or an injected fetch implementation.",
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
      const stream = configuredOpenAIStream(this.stream, this.requestSettings);
      const requestBody = buildResponsesRequestBody(request, this.model, stream, this.requestSettings);

      if (stream) {
        const stream = await client.responses.create(requestBody, { signal: options.abortSignal });
        return await normalizeOpenAIResponsesStreamResponse({
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
        failureKind: timeoutLikeError(error) ? "provider_timeout" : "provider_network",
        retryable: true,
        message: providerErrorMessage(
          error,
          timeoutLikeError(error) ? "Request timed out." : "Network request failed."
        ),
      });
    }
  }
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
