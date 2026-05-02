import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";

export type FakeModelProviderOptions = {
  readonly providerId?: string;
  readonly model?: string;
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly fail?: boolean;
  readonly failureMessage?: string;
};

export class FakeModelProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;

  constructor(private readonly options: FakeModelProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-model-provider";
    this.model = options.model ?? "fake-deterministic-model";
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (this.options.fail) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: this.options.failureMessage ?? "Fake provider was configured to fail.",
      });
    }

    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: this.options.output ?? {
        summary: "Fake model candidate advice.",
        rationale: "Deterministic fake provider output for tests and demos.",
      },
      textOutput: this.options.textOutput,
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}
