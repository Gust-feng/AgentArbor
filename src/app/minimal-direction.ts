import {
  createApprovedDirectionHandoff,
} from "../domain/agentarbor/direction-handoff.js";
import { createDirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package.js";
import type {
  CandidatePool,
  Constraint,
  ConvergenceReview,
  DirectionHandoff,
  DirectionHandoffPackage,
  DirectionRiskRecord,
  ExplorationCandidateRef,
  UndergroundConvergenceReport,
  UserClarificationRequest,
} from "../domain/contracts.js";
import { selectHandoffSourceCandidates } from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

export type MinimalDirectionMaterial = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
};

export type AwaitingUserDirectionMaterial = MinimalDirectionMaterial & {
  clarificationRequest: UserClarificationRequest;
};

export function createMinimalDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): MinimalDirectionMaterial {
  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createMinimalDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage };
}

export function createAwaitingUserDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): AwaitingUserDirectionMaterial {
  const clarificationRequest = input.convergenceReport.userClarificationRequest;
  if (clarificationRequest === undefined) {
    throw new Error("Awaiting-user DirectionHandoff requires a UserClarificationRequest.");
  }

  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createAwaitingUserDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
    clarificationRequest,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage, clarificationRequest };
}

function createMinimalDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
}): DirectionHandoff {
  return createApprovedDirectionHandoff(createMinimalDirectionHandoffDraft(input), input.convergenceReview);
}

function createAwaitingUserDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  clarificationRequest: UserClarificationRequest;
}): DirectionHandoff {
  return {
    ...createMinimalDirectionHandoffDraft(input),
    status: "awaiting_user",
  };
}

function createMinimalDirectionHandoffDraft(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  clarificationRequest?: UserClarificationRequest;
}): Omit<DirectionHandoff, "status"> {
  const selectedOptionId = createId("direction-option");
  const clarificationQuestions = input.clarificationRequest?.questions.map((question) => question.prompt) ?? [];
  const userDecisionRequired =
    input.clarificationRequest?.questions.map((question) => question.questionId) ?? [];

  return {
    id: createId("direction-handoff"),
    version: 1,
    sourceGoalId: input.goalId,
    rawUserInputRef: "goal.received",
    clarifiedGoal: input.goal,
    nonGoals: ["real_llm", "real_agentarbor_assets", "ui", "database", "external_adapters"],
    assumptions: [
      "The user-confirmed plan is sufficient for deterministic minimal radial exploration.",
      ...(input.clarificationRequest === undefined
        ? []
        : ["Blocking user clarification is required before Aboveground planning."]),
    ],
    missingInformation: clarificationQuestions,
    soilRefs: ["soil:minimal-constraints"],
    evidenceRefs: [
      "docs/开发指南/06-工程实现/06-最小实现边界.md",
      "docs/开发指南/04-模型与契约/04-最小运行契约.md",
    ],
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    candidateConstraintRefs: [],
    risks: [
      "First implementation proves deterministic loop only; external adapters remain out of scope.",
      ...(input.clarificationRequest === undefined
        ? []
        : ["Aboveground planning is blocked until user clarification is answered."]),
    ],
    options: [
      {
        optionId: selectedOptionId,
        directionSummary: "Run an in-memory deterministic AgentArbor loop with minimal Underground radial exploration.",
        supportingEvidenceRefs: ["minimal-runtime-contract"],
        soilAssetFitRefs: ["soil:minimal-constraints"],
        constraintImpact: input.constraints.map((constraint) => constraint.id),
        riskProfile: ["limited_to_fake_agents"],
        costProfile: ["local_node_test_only"],
        unknowns: clarificationQuestions,
        whyNot: [],
        recommendationScore: input.clarificationRequest === undefined ? 1 : 0.5,
        doNotChooseWhen: [
          "A real adapter, UI, database, or model call is required.",
          ...(input.clarificationRequest === undefined
            ? []
            : ["The blocking user clarification request remains unanswered."]),
        ],
      },
    ],
    decisionRecord: {
      retainedOptionId: selectedOptionId,
      mergedOptionIds: [],
      rejectedOptionIds: [],
      userDecisionRequired,
      abovegroundReferenceOptionIds: [selectedOptionId],
      rationaleEvidenceRefs: ["user-confirmed-minimal-loop-plan"],
      rationaleConstraintRefs: input.constraints.map((constraint) => constraint.id),
      rationaleRiskRefs: [
        "limited_to_fake_agents",
        ...(input.clarificationRequest === undefined ? [] : [input.clarificationRequest.requestId]),
      ],
    },
    riskRegister: createRiskRegister(input.clarificationRequest),
    sourceCandidateRefs: input.sourceCandidates,
    convergenceReviewRef: input.convergenceReview.reviewId,
    recommendedOptionId: selectedOptionId,
    growthEntry: {
      allowedRuntimeShapes: ["single_agent"],
      suggestedFirstWorkflowNodes: ["generate", "verify", "memory", "govern"],
      escalationRules: [
        "Request a NutrientRequest instead of aboveground direction exploration.",
        ...(input.clarificationRequest === undefined
          ? []
          : [`Resolve user clarification request ${input.clarificationRequest.requestId} before planning.`]),
      ],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function createRiskRegister(clarificationRequest?: UserClarificationRequest): DirectionRiskRecord[] {
  const risks: DirectionRiskRecord[] = [
    {
      riskId: "risk-fake-agent-overreach",
      name: "Fake agents must not become product facts.",
      source: "AGENTS.md",
      impactScope: ["adapters", "governance", "soil"],
      blockingLevel: "watch",
      evidenceRefs: ["AGENTS.md"],
      mitigation: ["Keep fake agents in app demo layer and under deterministic tests."],
    },
  ];

  if (clarificationRequest !== undefined) {
    risks.push({
      riskId: `risk-${clarificationRequest.requestId}`,
      name: "Blocking user clarification required.",
      source: clarificationRequest.requestId,
      impactScope: ["underground_center", "agentarbor_handoff", "aboveground_center"],
      blockingLevel: "ask_user",
      evidenceRefs: clarificationRequest.relatedCandidateRefs,
      mitigation: clarificationRequest.questions.map((question) => question.prompt),
    });
  }

  return risks;
}
