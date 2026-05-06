import type {
  ModelOutputDelta,
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
  readonly onOutputDelta?: (delta: ModelOutputDelta) => void;
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

    const output =
      step.output ?? (step.toolCalls === undefined || step.toolCalls.length === 0 ? defaultFakeOutput(request) : undefined);
    emitFakeOutputDeltas({
      request,
      providerId: this.providerId,
      model: this.model,
      output,
      textOutput: step.textOutput,
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

function emitFakeOutputDeltas(input: {
  readonly request: ModelRequest;
  readonly providerId: string;
  readonly model: string;
  readonly output: unknown;
  readonly textOutput?: string;
  readonly emit?: (delta: ModelOutputDelta) => void;
}): void {
  if (input.emit === undefined) {
    return;
  }
  const text =
    typeof input.textOutput === "string" && input.textOutput.trim().length > 0
      ? input.textOutput
      : typeof input.output === "string"
        ? input.output
        : input.output === undefined
          ? ""
          : JSON.stringify(input.output);
  const chunks = chunkText(text, 80);
  chunks.forEach((delta, index) => {
    input.emit?.({
      requestId: input.request.requestId,
      providerId: input.providerId,
      model: input.model,
      delta,
      index: index + 1,
      createdAt: nowIso(),
    });
  });
}

function chunkText(value: string, maxLength: number): readonly string[] {
  const text = value.trim();
  if (text.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function defaultFakeOutput(request: ModelRequest): unknown {
  if (request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary:
        "Fake convergence advisory keeps CandidatePool, Convergence Judge, and package validation as promotion boundaries.",
    };
  }

  if (request.outputContract.contractId === "underground.autonomy_decision.v1") {
    return {
      action: "request_convergence",
      completionAssessment: "Fake autonomy review found enough candidate material for convergence.",
      informationGaps: [],
      spawnRequests: [],
      rationale: "Fake provider asks Convergence Judge to review candidate material before handoff.",
      sourceRefs: [],
    };
  }

  if (request.outputContract.requiredFields?.includes("candidates")) {
    const kind = rootletKindFromContractId(request.outputContract.contractId);
    const goalAnchor = rootletGoalAnchor(request);
    return {
      candidates: [fakeCandidateForKind(kind, 1, goalAnchor), fakeCandidateForKind(kind, 2, goalAnchor)],
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

function rootletGoalAnchor(request: ModelRequest): string {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const rawGoal = matchLineValue(content, "Raw goal:");
  if (rawGoal !== undefined && rawGoal.length > 0) {
    return truncate(rawGoal, 80);
  }
  const domainConcepts = matchLineValue(content, "- domainConcepts:");
  if (domainConcepts !== undefined && domainConcepts !== "none") {
    return domainConcepts.split(";").map((value) => value.trim()).filter(Boolean).slice(0, 4).join("/");
  }
  return "current goal";
}

function matchLineValue(content: string, prefix: string): string | undefined {
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith(prefix));
  return line?.slice(line.indexOf(prefix) + prefix.length).trim();
}

function fakeCandidateForKind(kind: string, index: number, goalAnchor: string): Record<string, unknown> {
  const goalTerms = goalAnchor
    .split(/[\s.;,，；、/]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  const decomposedGoalTerms = [...goalTerms, ...[...goalTerms].reverse()].join(" ");
  const summary = `Fake ${kind} candidate advice ${index} with goal-specific ${decomposedGoalTerms || "current goal"} material.`;
  switch (kind) {
    case "risk":
      return {
        summary,
        impactScope: `${goalAnchor} runtime boundary and user trust`,
        severity: index === 1 ? "medium" : "low",
        mitigation: "Keep Convergence Judge and package validation in charge.",
      };
    case "asset_fit":
      return {
        summary,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: [`Only use refs that match ${goalAnchor}.`],
        doNotApplyWhen: ["The asset would copy Soil body content into the prompt."],
      };
    case "evidence":
      return {
        summary,
        evidenceType: `${goalAnchor} verification`,
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
        alternativeDirection: `Defer ${goalAnchor} execution until evidence and constraints are clearer.`,
        whyNotChosen: "It does not satisfy the current underground direction boundary.",
      };
    case "option":
    default:
      return {
        summary,
        tradeoffs: ["more candidate diversity", `goal-specific ${goalAnchor}`, "requires convergence validation"],
        applicability: `Use when the ${goalAnchor} goal profile needs another direction candidate.`,
      };
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
