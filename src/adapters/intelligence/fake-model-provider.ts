import type {
  ModelToolCall,
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
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
  readonly responses?: readonly FakeModelProviderResponse[];
};

export type FakeModelProviderResponse = {
  readonly output?: unknown;
  readonly textOutput?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly failureMessage?: string;
};

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

    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput:
        step.output ?? (step.toolCalls === undefined || step.toolCalls.length === 0 ? defaultFakeOutput(request) : undefined),
      textOutput: step.textOutput,
      toolCalls: step.toolCalls?.map((toolCall) => ({
        callId: toolCall.callId,
        toolName: toolCall.toolName,
        input: globalThis.structuredClone(toolCall.input),
      })),
      finishReason: step.toolCalls === undefined || step.toolCalls.length === 0 ? "stop" : "tool_call",
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

function defaultFakeOutput(request: ModelRequest): unknown {
  if (request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary:
        "Fake convergence advisory confirms the deterministic convergence judge remains the final decision boundary.",
    };
  }

  if (request.outputContract.requiredFields?.includes("candidates")) {
    const kind = rootletKindFromContractId(request.outputContract.contractId);
    return {
      candidates: [fakeCandidateForKind(kind, 1), fakeCandidateForKind(kind, 2)],
    };
  }

  return {
    summary: "Fake model candidate advice.",
    rationale: "Deterministic fake provider output for tests and demos.",
  };
}

function rootletKindFromContractId(contractId: string): string {
  const marker = "underground.rootlet_candidate_advice.";
  if (!contractId.startsWith(marker)) {
    return "option";
  }
  return contractId.slice(marker.length).split(".")[0] ?? "option";
}

function fakeCandidateForKind(kind: string, index: number): Record<string, unknown> {
  const summary = `Fake ${kind} candidate advice ${index}.`;
  switch (kind) {
    case "risk":
      return {
        summary,
        impactScope: "runtime boundary and user trust",
        severity: index === 1 ? "medium" : "low",
        mitigation: "Keep deterministic convergence and package validation in charge.",
      };
    case "asset_fit":
      return {
        summary,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: ["Only use refs that match the goal profile."],
        doNotApplyWhen: ["The asset would copy Soil body content into the prompt."],
      };
    case "evidence":
      return {
        summary,
        evidenceType: "verification",
        confidence: index === 1 ? "medium" : "low",
      };
    case "constraint":
      return {
        summary,
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary,
        alternativeDirection: "Defer the broader architecture change.",
        whyNotChosen: "It does not satisfy the current underground direction boundary.",
      };
    case "option":
    default:
      return {
        summary,
        tradeoffs: ["more candidate diversity", "requires deterministic convergence"],
        applicability: "Use when the goal profile needs another direction candidate.",
      };
  }
}
