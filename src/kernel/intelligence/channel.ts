import type {
  IntelligenceChannel,
  ModelProvider,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type { InMemoryMessageBus } from "../messages/in-memory-message-bus.js";
import { nowIso } from "../id.js";
import { createFailedModelResponse } from "./failures.js";
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

    const providerResponse = await this.options.provider.complete(request, options);
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
