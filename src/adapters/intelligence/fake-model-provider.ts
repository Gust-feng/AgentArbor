import type { ModelProvider, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createFailedModelResponse } from "../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import type {
  FakeModelProviderOptions,
  FakeModelProviderResponse,
} from "./fake-model-provider-contracts.js";
import { defaultFakeOutput, defaultFakeStep } from "./fake-model-provider-output.js";
import { emitFakeOutputDeltas } from "./fake-model-provider-stream.js";

export type { FakeModelProviderOptions, FakeModelProviderResponse } from "./fake-model-provider-contracts.js";

export class FakeModelProvider implements ModelProvider {
  readonly providerId: string;
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model: string;
  private callCount = 0;

  constructor(private readonly options: FakeModelProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-model-provider";
    this.model = options.model ?? "fake-deterministic-model";
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const step = this.nextStep();
    if (step.fail) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: step.failureMessage ?? "Fake provider was configured to fail.",
      });
    }

    const defaultStep =
      step.output === undefined && step.textOutput === undefined && step.toolCalls === undefined
        ? defaultFakeStep(request)
        : {};
    const toolCalls = step.toolCalls ?? defaultStep.toolCalls;
    const rawOutput =
      step.output ??
      defaultStep.output ??
      (toolCalls === undefined || toolCalls.length === 0 ? defaultFakeOutput(request) : undefined);
    const textOutput =
      step.textOutput ??
      defaultStep.textOutput ??
      (request.outputContract.format === "text" && typeof rawOutput === "string" ? rawOutput : undefined);
    const output = request.outputContract.format === "text" && textOutput !== undefined ? undefined : rawOutput;

    emitFakeOutputDeltas({
      request,
      providerId: this.providerId,
      model: this.model,
      output,
      textOutput,
      emit: this.options.onOutputDelta,
    });

    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: output,
      textOutput,
      toolCalls: toolCalls?.map((toolCall) => ({
        callId: toolCall.callId,
        toolName: toolCall.toolName,
        input: globalThis.structuredClone(toolCall.input),
      })),
      finishReason: toolCalls === undefined || toolCalls.length === 0 ? "stop" : "tool_call",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }

  private nextStep(): FakeModelProviderResponse {
    const step = this.options.responses?.[this.callCount];
    this.callCount += 1;
    return (
      step ?? {
        output: this.options.output,
        textOutput: this.options.textOutput,
        toolCalls: this.options.toolCalls,
        fail: this.options.fail,
        failureMessage: this.options.failureMessage,
      }
    );
  }
}
