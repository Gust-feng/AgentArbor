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
import { redactSensitiveText } from "../redaction.js";
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

export function createFailedModelResponseFromError(input: {
  requestId: string;
  providerId: string;
  providerKind: ModelProviderKind;
  protocolKind: ModelProtocolKind;
  model: string;
  outputKind: ModelOutputKind;
  error: unknown;
  fallbackMessage?: string;
  responseId?: string;
}): ModelResponse {
  const failureKind = modelFailureKindFromError(input.error);
  return createFailedModelResponse({
    requestId: input.requestId,
    providerId: input.providerId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    model: input.model,
    outputKind: input.outputKind,
    failureKind,
    retryable: isRetryableModelFailure(failureKind),
    message: safeModelErrorMessage(input.error, input.fallbackMessage),
    responseId: input.responseId,
  });
}

export function modelFailureKindFromError(error: unknown): ModelFailureKind {
  const message = rawModelErrorMessage(error).toLowerCase();
  if (/\b(timeout|timed out|etimedout)\b/.test(message)) {
    return "provider_timeout";
  }
  if (/\b(network|connection error|fetch failed|econnreset|econnrefused|enotfound|eai_again|socket|dns)\b/.test(message)) {
    return "provider_network";
  }
  if (/\b(unauthorized|forbidden|auth|401|403)\b/.test(message)) {
    return "provider_auth";
  }
  if (/\b(rate limit|rate_limit|too many requests|429)\b/.test(message)) {
    return "provider_rate_limit";
  }
  if (/\b(config|configuration|missing model|missing provider|base url|api[_ -]?key)\b/.test(message)) {
    return "provider_config";
  }
  return "provider_response";
}

export function isRetryableModelFailure(kind: ModelFailureKind): boolean {
  return kind === "provider_network" || kind === "provider_timeout" || kind === "provider_rate_limit" || kind === "provider_response";
}

function safeModelErrorMessage(error: unknown, fallbackMessage = "Model request failed."): string {
  const redacted = redactSensitiveText(rawModelErrorMessage(error, fallbackMessage)).replace(/\s+/g, " ").trim();
  if (redacted.length === 0) {
    return fallbackMessage;
  }
  return redacted.length <= 1_000 ? redacted : `${redacted.slice(0, 999)}…`;
}

function rawModelErrorMessage(error: unknown, fallbackMessage = "Model request failed."): string {
  if (error instanceof Error) {
    const cause = rawErrorCauseMessage(error);
    return cause === undefined ? error.message : `${error.message} Cause: ${cause}`;
  }
  if (typeof error === "string") {
    return error;
  }
  return fallbackMessage;
}

function rawErrorCauseMessage(error: Error): string | undefined {
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause === undefined) {
    return undefined;
  }
  const message = rawModelErrorMessage(cause, "");
  return message.length === 0 ? undefined : message;
}
