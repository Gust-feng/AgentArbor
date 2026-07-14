import type { ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";

export function createOpenAIModelRefusalResponse(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly providerKind: "openai_compatible";
  readonly protocolKind: "openai_compatible_chat_completions" | "openai_responses";
  readonly model: string;
  readonly refusal: string;
  readonly responseId?: string;
}): ModelResponse {
  const refusal = input.refusal.trim();
  return createFailedModelResponse({
    requestId: input.request.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: input.model,
    outputKind: input.request.outputContract.outputKind,
    failureKind: "provider_response",
    retryable: false,
    message: refusal.length === 0
      ? "The model refused the request without an explanation."
      : `The model refused the request: ${refusal}`,
    responseId: input.responseId,
  });
}
