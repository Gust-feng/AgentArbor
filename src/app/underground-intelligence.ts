import type { Constraint } from "../domain/contracts.js";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
} from "../domain/intelligence/index.js";
import type {
  GoalIntentProfile,
  RootletClusterPlan,
  RootletOutput,
  UndergroundAgentInvocation,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { getUndergroundRootletCandidateAdviceContract } from "./underground/intelligence-contracts.js";
import {
  formatUndergroundRootletCandidateAdviceSummary,
  parseUndergroundRootletCandidateAdviceOutput,
} from "./underground/intelligence-output.js";
import { buildUndergroundRootletCandidateAdviceMessages } from "./underground/intelligence-prompts.js";
import { createRootletOutputForInvocation } from "./underground-rootlets.js";

export type UndergroundRootletCandidateAdviceRequestResult = {
  readonly rootletOutputs: readonly RootletOutput[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
  readonly status: "completed" | "failed" | "empty";
  readonly validationStatus: ModelOutputValidationResult["status"];
  readonly fallbackSourceRefs: readonly string[];
};

export async function requestUndergroundRootletCandidateAdvice(input: {
  readonly intelligenceChannel: IntelligenceChannel;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly goalIntentProfile: GoalIntentProfile;
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly constraints: readonly Constraint[];
  readonly sourceRefs?: readonly string[];
}): Promise<UndergroundRootletCandidateAdviceRequestResult> {
  const requestId = createId("model-request");
  const adviceContract = getUndergroundRootletCandidateAdviceContract(input.cluster.kind);
  const response = await input.intelligenceChannel.request({
    requestId,
    traceId: input.traceId,
    callerRef: { kind: "rootlet", id: input.cluster.clusterId, label: input.cluster.kind },
    purpose: "rootlet_candidate",
    inputRefs: [
      { kind: "goal", id: input.goalId },
      { kind: "rootlet", id: input.cluster.clusterId, label: input.cluster.kind },
    ],
    sanitizedMessages: buildUndergroundRootletCandidateAdviceMessages({
      goal: input.goal,
      goalIntentProfile: input.goalIntentProfile,
      cluster: input.cluster,
      constraints: input.constraints,
    }),
    outputContract: adviceContract.modelOutputContract,
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    budget: {
      maxOutputTokens: 256,
      maxLatencyMs: 30_000,
    },
    sensitivity: "internal",
    requestedAt: nowIso(),
  });

  if (response.status !== "completed" || response.validation.status !== "passed") {
    return {
      rootletOutputs: [],
      modelRequestId: requestId,
      modelResponseId: response.responseId,
      status: "failed",
      validationStatus: response.validation.status,
      fallbackSourceRefs: modelFallbackSourceRefs({
        kind: input.cluster.kind,
        requestId,
        responseId: response.responseId,
        reason: response.failure?.kind ?? "output_validation",
        terminalEvent: "model.failed",
      }),
    };
  }

  const parsed = parseUndergroundRootletCandidateAdviceOutput({
    kind: input.cluster.kind,
    output: response.structuredOutput,
    maxCandidates: input.cluster.budget.maxCandidateOutputs,
  });
  if (parsed.candidates.length === 0) {
    return {
      rootletOutputs: [],
      modelRequestId: requestId,
      modelResponseId: response.responseId,
      status: "empty",
      validationStatus: response.validation.status,
      fallbackSourceRefs: modelFallbackSourceRefs({
        kind: input.cluster.kind,
        requestId,
        responseId: response.responseId,
        reason: parsed.issues.length > 0 ? "app_output_parse" : "empty_candidates",
        terminalEvent: "model.completed",
      }),
    };
  }

  return {
    rootletOutputs: parsed.candidates.map((candidate) =>
      createRootletOutputForInvocation({
        goalId: input.goalId,
        cluster: input.cluster,
        invocation: input.invocation,
        constraints: [...input.constraints],
        goalIntentProfile: input.goalIntentProfile,
        summary: formatUndergroundRootletCandidateAdviceSummary(candidate),
        sourceRefs: [
          ...(input.sourceRefs ?? []),
          "model.requested",
          "model.completed",
          requestId,
          response.responseId,
          adviceContract.modelOutputContract.contractId,
          `model-candidate:${input.cluster.kind}:${candidate.sourceIndex + 1}`,
        ],
        evidenceRefs: [`model-call:${response.responseId}`],
      })
    ),
    modelRequestId: requestId,
    modelResponseId: response.responseId,
    status: "completed",
    validationStatus: response.validation.status,
    fallbackSourceRefs: [],
  };
}

function modelFallbackSourceRefs(input: {
  readonly kind: RootletClusterPlan["kind"];
  readonly requestId: string;
  readonly responseId?: string;
  readonly reason: string;
  readonly terminalEvent: "model.completed" | "model.failed";
}): string[] {
  return [
    `ai-fallback:${input.kind}`,
    `ai-fallback-reason:${input.reason}`,
    "model.requested",
    input.terminalEvent,
    input.requestId,
    input.responseId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}
