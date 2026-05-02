import type { Constraint } from "../domain/constraints.js";
import type {
  ConvergenceReview,
  DirectionHandoff,
  DirectionRiskRecord,
  ExplorationCandidateRef,
  GoalIntentProfile,
  UndergroundConvergenceReport,
  UserClarificationRequest,
} from "../domain/underground/index.js";
import { evidenceId } from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

const CONSTRAINT_ENFORCEMENT_GATES: Constraint["enforcementGate"][] = [
  "direction_handoff",
  "growth_plan",
  "task_assignment",
  "tool_execution",
  "verification",
  "fruit_governance",
  "soil_promotion",
];

export function deriveDirectionHandoffDraft(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  clarificationRequest?: UserClarificationRequest;
}): Omit<DirectionHandoff, "status"> {
  const selectedOptionId = createId("direction-option");
  const profile = input.goalIntentProfile;
  const clarificationQuestions = input.clarificationRequest?.questions.map((question) => question.prompt) ?? [];
  const userDecisionRequired = input.clarificationRequest?.questions.map((question) => question.questionId) ?? [];
  const candidateConstraintRefs = createCandidateConstraintRefs({
    goalId: input.goalId,
    constraints: input.constraints,
    goalIntentProfile: profile,
  });
  const sourceEvidenceRefs = unique([
    ...(profile === undefined ? [] : [evidenceId(profile.goalId, "goal-intent")]),
    ...input.sourceCandidates.flatMap((candidate) => candidate.sourceRefs),
    ...input.convergenceReview.provenanceRefs,
  ]);
  const rejectedDecisionReasons = (input.convergenceReview as UndergroundConvergenceReport).decisions
    ?.filter((decision) => decision.status === "rejected")
    .map((decision) => decision.reason) ?? [];
  const unknownDecisionReasons = (input.convergenceReview as UndergroundConvergenceReport).decisions
    ?.filter((decision) => decision.status === "unknown")
    .map((decision) => decision.reason) ?? [];

  return {
    id: createId("direction-handoff"),
    version: 1,
    sourceGoalId: input.goalId,
    rawUserInputRef: "goal.received",
    clarifiedGoal: profile?.goalStatement ?? input.goal,
    nonGoals: createHandoffNonGoals(profile, input.constraints),
    assumptions: [
      ...(profile?.assumptions ?? ["The deterministic Underground profile is sufficient for this handoff."]),
      `Convergence review ${input.convergenceReview.reviewId} is the source of handoff candidate selection.`,
      ...(input.clarificationRequest === undefined
        ? []
        : ["Blocking user clarification is required before Aboveground planning."]),
    ],
    missingInformation: clarificationQuestions,
    soilRefs: ["soil:minimal-constraints"],
    evidenceRefs: sourceEvidenceRefs,
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    candidateConstraintRefs,
    risks: unique([
      ...(profile?.riskHints.map((hint) => `Intent risk hint: ${hint}`) ?? []),
      ...unknownDecisionReasons,
      ...rejectedDecisionReasons,
      ...(input.clarificationRequest === undefined
        ? []
        : ["Aboveground planning is blocked until user clarification is answered."]),
    ]),
    options: [
      {
        optionId: selectedOptionId,
        directionSummary: profile?.goalStatement ?? input.goal,
        supportingEvidenceRefs: sourceEvidenceRefs,
        soilAssetFitRefs: ["soil:minimal-constraints"],
        constraintImpact: candidateConstraintRefs.map((constraint) => constraint.constraintId),
        riskProfile: unique([...(profile?.riskHints ?? []), ...unknownDecisionReasons]),
        costProfile: profile?.keyConcepts.includes("cost") === true ? ["cost-sensitive"] : ["local-deterministic-runtime"],
        unknowns: clarificationQuestions,
        whyNot: rejectedDecisionReasons,
        recommendationScore: input.clarificationRequest === undefined ? 1 : 0.5,
        doNotChooseWhen: unique([
          ...createDoNotChooseWhen(profile, input.constraints),
          ...(input.clarificationRequest === undefined
            ? []
            : ["The blocking user clarification request remains unanswered."]),
        ]),
      },
    ],
    decisionRecord: {
      retainedOptionId: selectedOptionId,
      mergedOptionIds: input.convergenceReview.mergedCandidateRefs ?? [],
      rejectedOptionIds: input.convergenceReview.rejectedCandidateRefs,
      userDecisionRequired,
      abovegroundReferenceOptionIds: [selectedOptionId],
      rationaleEvidenceRefs: sourceEvidenceRefs,
      rationaleConstraintRefs: candidateConstraintRefs.map((constraint) => constraint.constraintId),
      rationaleRiskRefs: [
        ...unknownDecisionReasons,
        ...(input.clarificationRequest === undefined ? [] : [input.clarificationRequest.requestId]),
      ],
    },
    riskRegister: createRiskRegister({
      goalIntentProfile: profile,
      rejectedDecisionReasons,
      clarificationRequest: input.clarificationRequest,
    }),
    sourceCandidateRefs: input.sourceCandidates,
    convergenceReviewRef: input.convergenceReview.reviewId,
    recommendedOptionId: selectedOptionId,
    growthEntry: {
      allowedRuntimeShapes: ["single_agent"],
      suggestedFirstWorkflowNodes: ["generate", "verify", "memory", "govern"],
      escalationRules: [
        "Do not let Aboveground create a parallel direction exploration path.",
        ...(input.clarificationRequest === undefined
          ? []
          : [`Resolve user clarification request ${input.clarificationRequest.requestId} before planning.`]),
      ],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function createRiskRegister(input: {
  goalIntentProfile?: GoalIntentProfile;
  rejectedDecisionReasons: readonly string[];
  clarificationRequest?: UserClarificationRequest;
}): DirectionRiskRecord[] {
  const risks: DirectionRiskRecord[] =
    input.goalIntentProfile?.riskHints.map((hint, index) => ({
      riskId: `risk-intent-${index + 1}`,
      name: `Intent risk hint: ${hint}`,
      source: evidenceId(input.goalIntentProfile?.goalId ?? "goal", "goal-intent"),
      impactScope: ["underground_center", "agentarbor_handoff"],
      blockingLevel: "watch",
      evidenceRefs: [evidenceId(input.goalIntentProfile?.goalId ?? "goal", "goal-intent")],
      mitigation: ["Keep the risk visible in Direction Handoff and convergence evidence."],
    })) ?? [];

  for (const [index, reason] of input.rejectedDecisionReasons.entries()) {
    risks.push({
      riskId: `risk-rejected-candidate-${index + 1}`,
      name: "Rejected candidate retained as why-not evidence.",
      source: "convergence_review.completed",
      impactScope: ["underground_center", "agentarbor_handoff"],
      blockingLevel: "watch",
      evidenceRefs: ["convergence_review.completed"],
      mitigation: [reason],
    });
  }

  if (input.clarificationRequest !== undefined) {
    risks.push({
      riskId: `risk-${input.clarificationRequest.requestId}`,
      name: "Blocking user clarification required.",
      source: input.clarificationRequest.requestId,
      impactScope: ["underground_center", "agentarbor_handoff", "aboveground_center"],
      blockingLevel: "ask_user",
      evidenceRefs: input.clarificationRequest.relatedCandidateRefs,
      mitigation: input.clarificationRequest.questions.map((question) => question.prompt),
    });
  }

  return risks;
}

function createCandidateConstraintRefs(input: {
  goalId: string;
  constraints: readonly Constraint[];
  goalIntentProfile?: GoalIntentProfile;
}) {
  const refs = input.constraints.map((constraint) => ({
    constraintId: constraint.id,
    requiredLevel: constraint.level,
    enforcementGate: constraint.enforcementGate,
  }));
  const gateRefs = CONSTRAINT_ENFORCEMENT_GATES.map((gate) => {
    const existing = refs.find((ref) => ref.enforcementGate === gate);
    if (existing !== undefined) {
      return existing;
    }
    return {
      constraintId: `intent-${input.goalId}-${gate}`,
      requiredLevel: inferredIntentConstraintLevel(input.goalIntentProfile),
      enforcementGate: gate,
    };
  });
  return uniqueConstraintRefs([...refs, ...gateRefs]);
}

function inferredIntentConstraintLevel(profile?: GoalIntentProfile): Constraint["level"] {
  if (profile?.constraintHints.some((hint) => hint.includes("hard_constraint") || hint.includes("硬约束")) === true) {
    return "hard";
  }
  if ((profile?.nonGoals.length ?? 0) > 0 || (profile?.constraintHints.length ?? 0) > 0) {
    return "soft";
  }
  return "preference";
}

function createHandoffNonGoals(profile: GoalIntentProfile | undefined, constraints: readonly Constraint[]): string[] {
  return unique([
    ...(profile?.nonGoals ?? []),
    ...constraints
      .filter((constraint) => constraint.level === "hard" && constraint.type === "scope")
      .map((constraint) => `Do not violate hard scope constraint ${constraint.id}: ${constraint.statement}`),
  ]);
}

function createDoNotChooseWhen(profile: GoalIntentProfile | undefined, constraints: readonly Constraint[]): string[] {
  return unique([
    ...(profile?.nonGoals.map((nonGoal) => `If it requires a non-goal: ${nonGoal}`) ?? []),
    ...constraints
      .filter((constraint) => constraint.level === "hard")
      .map((constraint) => `If it violates hard constraint ${constraint.id}.`),
  ]);
}

function uniqueConstraintRefs<T extends { constraintId: string; enforcementGate: Constraint["enforcementGate"] }>(
  refs: readonly T[]
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const ref of refs) {
    const key = `${ref.constraintId}:${ref.enforcementGate}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
