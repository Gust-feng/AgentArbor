import type { ModelRequest } from "../../domain/intelligence/index.js";
import {
  fakeConversationCompactionOutput,
  fakeDesktopAgentStep,
  fakeWorkSessionChildMaterialOutput,
  fakeWorkSessionDecisionOutput,
  fakeWorkSessionDirectAnswerOutput,
  fakeWorkSessionSynthesisOutput,
} from "./fake-model-provider-desktop.js";
import type { FakeModelProviderStep } from "./fake-model-provider-contracts.js";
import {
  fakeCandidateForKind,
  fakeConvergenceJudgmentOutput,
  fakeGrowthGovernorOutput,
  fakeHandoffNarrativeOutput,
  fakeIntentProfileOutput,
  fakeRootletKindFromContractId,
} from "./fake-model-provider-underground.js";
import {
  fakeDeepChildMaterialOutput,
  fakeDeepDecisionOutput,
  fakeDeepDirectAnswerOutput,
  fakeDeepSynthesisOutput,
} from "./fake-model-provider-deep.js";
import { fakeGoalAnchorFromRequest } from "./fake-model-provider-common.js";

export function defaultFakeStep(request: ModelRequest): FakeModelProviderStep {
  if (request.outputContract.contractId === "desktop.agent_response.v1" || request.outputContract.contractId === "desktop.chat_response.v1") {
    return fakeDesktopAgentStep(request);
  }
  if (request.outputContract.contractId === "desktop.context_compaction.v1") {
    return { textOutput: fakeConversationCompactionOutput(request) };
  }
  return {};
}

export function defaultFakeOutput(request: ModelRequest): unknown {
  if (request.outputContract.contractId === "underground.intent_profile.v1") {
    return fakeIntentProfileOutput(request);
  }

  if (request.outputContract.contractId === "underground.growth_governor.v1") {
    return fakeGrowthGovernorOutput(request);
  }

  if (request.outputContract.contractId === "underground.convergence_judgment.v1") {
    return fakeConvergenceJudgmentOutput(request);
  }

  if (request.outputContract.contractId === "underground.handoff_narrative.v1") {
    return fakeHandoffNarrativeOutput(request);
  }

  if (request.outputContract.contractId === "underground.candidate_aggregation.v1") {
    return {
      aggregationRationale: "Fake Candidate Collector aggregated rootlet outputs into a unified candidate pool.",
      deduplicationNotes: ["No duplicates detected in fake output."],
      implicitRelations: [],
      decisionSummary: "Fake candidate aggregation completed.",
      uncertainty: "Fake aggregation is deterministic fixture output.",
      confidence: 0.74,
    };
  }

  if (request.outputContract.contractId === "work_session.decision.v1") {
    return fakeWorkSessionDecisionOutput(request);
  }

  if (request.outputContract.contractId === "work_session.direct_answer.v1") {
    return fakeWorkSessionDirectAnswerOutput(request);
  }

  if (request.outputContract.contractId === "work_session.child_material.v1") {
    return fakeWorkSessionChildMaterialOutput(request);
  }

  if (request.outputContract.contractId === "work_session.synthesis.v1") {
    return fakeWorkSessionSynthesisOutput(request);
  }

  if (request.outputContract.contractId === "deep.decision.v1") {
    return fakeDeepDecisionOutput(request);
  }

  if (request.outputContract.contractId === "deep.direct_answer.v1") {
    return fakeDeepDirectAnswerOutput(request);
  }

  if (request.outputContract.contractId === "deep.child_material.v1") {
    return fakeDeepChildMaterialOutput(request);
  }

  if (request.outputContract.contractId === "deep.synthesis.v1") {
    return fakeDeepSynthesisOutput(request);
  }

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
      decisionSummary: "Fake autonomy recommends convergence after reviewing candidate pool.",
      uncertainty: "Fake autonomy output is deterministic fixture, not real judgment.",
      confidence: 0.74,
    };
  }

  if (request.outputContract.requiredFields?.includes("candidates")) {
    const kind = fakeRootletKindFromContractId(request.outputContract.contractId);
    const goalAnchor = fakeGoalAnchorFromRequest(request);
    return {
      candidates: [fakeCandidateForKind(kind, 1, goalAnchor), fakeCandidateForKind(kind, 2, goalAnchor)],
    };
  }

  return {
    summary: "Fake model candidate advice.",
    rationale: "Deterministic fake provider output for tests and demos.",
  };
}
