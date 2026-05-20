import type { ArborMessage } from "../../domain/common.js";
import type {
  ModelFailure,
  ModelOutputContract,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  ModelVisibleOutputProjection,
} from "../../domain/intelligence/index.js";
import { createMessage } from "../messages/create-message.js";
import { createModelVisibleOutputProjection } from "./safe-visible-output.js";

export type ModelRequestedEventPayload = {
  readonly requestId: string;
  readonly traceId: string;
  readonly purpose: ModelRequest["purpose"];
  readonly callerRef: ModelRequest["callerRef"];
  readonly providerId: string;
  readonly providerKind: ModelProvider["providerKind"];
  readonly protocolKind: ModelProvider["protocolKind"];
  readonly model: string;
  readonly budget: ModelRequest["budget"];
  readonly inputRefs: ModelRequest["inputRefs"];
  readonly outputContract: ModelOutputContract;
  readonly sensitivity: ModelRequest["sensitivity"];
};

export type ModelCompletedEventPayload = {
  readonly requestId: string;
  readonly responseId: string;
  readonly providerId: string;
  readonly providerKind: ModelProvider["providerKind"];
  readonly protocolKind: ModelProvider["protocolKind"];
  readonly model: string;
  readonly usage?: ModelUsage;
  readonly finishReason?: ModelResponse["finishReason"];
  readonly outputKind: ModelResponse["outputKind"];
  readonly validationStatus: ModelResponse["validation"]["status"];
  readonly visibleOutput?: ModelVisibleOutputProjection;
};

export type ModelFailedEventPayload = {
  readonly requestId: string;
  readonly responseId?: string;
  readonly providerId: string;
  readonly providerKind: ModelProvider["providerKind"];
  readonly protocolKind: ModelProvider["protocolKind"];
  readonly model: string;
  readonly failureKind: ModelFailure["kind"];
  readonly retryable: boolean;
  readonly fallback: "deterministic_path" | "caller_handles_failure";
  readonly sanitizedErrorRef?: string;
  readonly failureMessage?: string;
  readonly validationStatus: ModelResponse["validation"]["status"];
};

export function createModelRequestedMessage(input: {
  request: ModelRequest;
  provider: ModelProvider;
}): ArborMessage<ModelRequestedEventPayload> {
  return createMessage({
    traceId: input.request.traceId,
    from: { id: "intelligence-channel", role: "runtime" },
    to: { role: "runtime" },
    type: "model.requested",
    intent: "request_model_completion",
    payload: {
      requestId: input.request.requestId,
      traceId: input.request.traceId,
      purpose: input.request.purpose,
      callerRef: input.request.callerRef,
      providerId: input.provider.providerId,
      providerKind: input.provider.providerKind,
      protocolKind: input.provider.protocolKind,
      model: input.provider.model,
      budget: input.request.budget,
      inputRefs: input.request.inputRefs.map((ref) => ({ ...ref })),
      outputContract: cloneOutputContract(input.request.outputContract),
      sensitivity: input.request.sensitivity,
    },
  });
}

export function createModelCompletedMessage(input: {
  request: ModelRequest;
  response: ModelResponse;
}): ArborMessage<ModelCompletedEventPayload> {
  return createMessage({
    traceId: input.request.traceId,
    from: { id: "intelligence-channel", role: "runtime" },
    to: { role: "runtime" },
    type: "model.completed",
    intent: "complete_model_request",
    payload: {
      requestId: input.request.requestId,
      responseId: input.response.responseId,
      providerId: input.response.providerId,
      providerKind: input.response.providerKind,
      protocolKind: input.response.protocolKind,
      model: input.response.model,
      usage: input.response.usage === undefined ? undefined : { ...input.response.usage },
      finishReason: input.response.finishReason,
      outputKind: input.response.outputKind,
      validationStatus: input.response.validation.status,
      visibleOutput: createModelVisibleOutputProjection({
        outputContract: input.request.outputContract,
        response: input.response,
      }),
    },
  });
}

export function createModelFailedMessage(input: {
  request: Pick<ModelRequest, "requestId" | "traceId">;
  response: ModelResponse;
}): ArborMessage<ModelFailedEventPayload> {
  return createMessage({
    traceId: input.request.traceId,
    from: { id: "intelligence-channel", role: "runtime" },
    to: { role: "runtime" },
    type: "model.failed",
    intent: "fail_model_request",
    payload: {
      requestId: input.request.requestId,
      responseId: input.response.responseId,
      providerId: input.response.providerId,
      providerKind: input.response.providerKind,
      protocolKind: input.response.protocolKind,
      model: input.response.model,
      failureKind: input.response.failure?.kind ?? "provider_response",
      retryable: input.response.failure?.retryable ?? false,
      fallback: "caller_handles_failure",
      sanitizedErrorRef: input.response.failure?.sanitizedErrorRef,
      failureMessage: safeModelFailureMessage(input.response.failure?.message),
      validationStatus: input.response.validation.status,
    },
  });
}

function safeModelFailureMessage(message: string | undefined): string | undefined {
  const text = String(message ?? "").trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= 1_000 ? text : `${text.slice(0, 999)}…`;
}

function cloneOutputContract(contract: ModelOutputContract): ModelOutputContract {
  return {
    ...contract,
    requiredFields: [...(contract.requiredFields ?? [])],
    requiredStringFields: [...(contract.requiredStringFields ?? [])],
    visibleOutput:
      contract.visibleOutput === undefined
        ? undefined
        : {
            ...contract.visibleOutput,
            fields: [...contract.visibleOutput.fields],
            fieldTypes:
              contract.visibleOutput.fieldTypes === undefined
                ? undefined
                : { ...contract.visibleOutput.fieldTypes },
          },
  };
}
