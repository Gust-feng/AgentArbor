import type {
  IntelligenceChannel,
  ModelProvider,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type { InMemoryMessageBus } from "../messages/in-memory-message-bus.js";
import { nowIso } from "../id.js";
import { createFailedModelResponse, createFailedModelResponseFromError } from "./failures.js";
import {
  createModelCompletedMessage,
  createModelFailedMessage,
  createModelRequestedMessage,
} from "./events.js";
import { validateModelRequest, validateModelResponse } from "./validation.js";

export type NativeIntelligenceChannelOptions = {
  readonly provider: ModelProvider;
  readonly bus: InMemoryMessageBus;
};

export class NativeIntelligenceChannel implements IntelligenceChannel {
  constructor(private readonly options: NativeIntelligenceChannelOptions) {}

  async request(request: ModelRequest, options: ModelRequestOptions = {}): Promise<ModelResponse> {
    const requestValidation = validateModelRequest(request);
    if (!requestValidation.passed) {
      const response = createFailedModelResponse({
        requestId: request.requestId ?? "invalid-model-request",
        providerId: this.options.provider.providerId,
        providerKind: this.options.provider.providerKind,
        protocolKind: this.options.provider.protocolKind,
        model: this.options.provider.model,
        outputKind: request.outputContract?.outputKind ?? "candidate",
        failureKind: "request_validation",
        message: "ModelRequest failed intelligence channel validation.",
        validation: {
          status: "failed",
          checkedAt: nowIso(),
          issues: requestValidation.issues,
        },
      });
      this.options.bus.publish(createModelFailedMessage({ request: minimalRequestRef(request), response }));
      return response;
    }

    this.options.bus.publish(createModelRequestedMessage({ request, provider: this.options.provider }));

    const providerResponse = await requestProviderWithRetry(this.options.provider, request, options);

    const validation = this.validateResponse(request, providerResponse);
    const response = normalizeValidatedResponse(providerResponse, validation);

    this.options.bus.publish(
      response.status === "completed"
        ? createModelCompletedMessage({ request, response })
        : createModelFailedMessage({ request, response })
    );

    return response;
  }

  validateResponse(request: ModelRequest, response: ModelResponse) {
    return validateModelResponse(request, response);
  }
}

async function requestProviderWithRetry(
  provider: ModelProvider,
  request: ModelRequest,
  options: ModelRequestOptions
): Promise<ModelResponse> {
  let attempt = 0;
  for (;;) {
    try {
      const response = await provider.complete(request, options);
      if (!shouldRetryFailedResponse(response, attempt, options)) {
        return response;
      }
    } catch (error) {
      const response = createFailedModelResponseFromError({
        requestId: request.requestId,
        providerId: provider.providerId,
        providerKind: provider.providerKind,
        protocolKind: provider.protocolKind,
        model: provider.model,
        outputKind: request.outputContract.outputKind,
        error,
        fallbackMessage: "Model provider request failed.",
      });
      if (!shouldRetryFailedResponse(response, attempt, options)) {
        return response;
      }
    }
    attempt += 1;
  }
}

function shouldRetryFailedResponse(
  response: ModelResponse,
  attempt: number,
  options: ModelRequestOptions
): boolean {
  return options.abortSignal?.aborted !== true &&
    response.status === "failed" &&
    response.failure?.retryable === true &&
    attempt < MODEL_REQUEST_RETRY_LIMIT;
}

const MODEL_REQUEST_RETRY_LIMIT = 1;

function normalizeValidatedResponse(
  response: ModelResponse,
  validation: ModelResponse["validation"]
): ModelResponse {
  if (response.status === "completed" && validation.status === "passed") {
    return { ...response, validation };
  }

  if (response.status !== "completed") {
    return {
      ...response,
      validation: response.validation.status === "pending" ? validation : response.validation,
    };
  }

  return {
    ...response,
    status: "failed",
    finishReason: "error",
    validation,
    failure: {
      kind: "output_validation",
      retryable: false,
      message: "Model output failed the requested output contract.",
      sanitizedErrorRef: "model-error:output_validation",
    },
  };
}

function minimalRequestRef(request: Partial<ModelRequest>): Pick<ModelRequest, "requestId" | "traceId"> {
  return {
    requestId: typeof request.requestId === "string" ? request.requestId : "invalid-model-request",
    traceId: typeof request.traceId === "string" ? request.traceId : "invalid-model-trace",
  };
}
