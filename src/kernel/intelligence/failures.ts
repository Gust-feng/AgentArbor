import type {
  ModelFailure,
  ModelFailureKind,
  ModelOutputKind,
  ModelOutputValidationResult,
  ModelProtocolKind,
  ModelProviderKind,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../id.js";
import { failedModelOutputValidation } from "./validation.js";

export function createFailedModelResponse(input: {
  requestId: string;
  providerId: string;
  providerKind: ModelProviderKind;
  protocolKind: ModelProtocolKind;
  model: string;
  outputKind: ModelOutputKind;
  failureKind: ModelFailureKind;
  message: string;
  retryable?: boolean;
  validation?: ModelOutputValidationResult;
  responseId?: string;
}): ModelResponse {
  const failure: ModelFailure = {
    kind: input.failureKind,
    retryable: input.retryable ?? false,
    message: input.message,
    sanitizedErrorRef: `model-error:${input.failureKind}`,
  };

  return {
    responseId: input.responseId ?? createId("model-response"),
    requestId: input.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: input.model,
    status: "failed",
    outputKind: input.outputKind,
    finishReason: "error",
    validation:
      input.validation ??
      failedModelOutputValidation(
        `MODEL_${input.failureKind.toUpperCase()}`,
        input.message,
        "failure"
      ),
    failure,
    completedAt: nowIso(),
  };
}
