/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ② 确定性编排主线（线性函数式编排）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { Constraint } from "../../../domain/constraints.js";
import type {
  CandidateComparison,
  ConvergenceReview,
  DirectionHandoff,
  DirectionOption,
  DirectionRiskRecord,
  ExplorationCandidateRef,
  GoalIntentProfile,
  UndergroundConvergenceAiAdvisory,
  UndergroundConvergenceReport,
  UserClarificationRequest,
} from "../../../domain/underground/index.js";
import { evidenceId } from "../../../domain/underground/index.js";
import { createId, nowIso } from "../../../kernel/id.js";

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
  const convergenceReport = input.convergenceReview as UndergroundConvergenceReport;
  const profile = input.goalIntentProfile;
  const clarificationQuestions = input.clarificationRequest?.questions.map((question) => question.prompt) ?? [];
  const userDecisionRequired = unique([
    ...(convergenceReport.userDecisionRequired ?? []),
    ...(input.clarificationRequest?.questions.map((question) => question.questionId) ?? []),
  ]);
  const candidateConstraintRefs = createCandidateConstraintRefs({
    goalId: input.goalId,
    constraints: input.constraints,
    goalIntentProfile: profile,
  });
  const sourceEvidenceRefs = unique([
    ...(profile === undefined ? [] : [evidenceId(profile.goalId, "goal-intent")]),
    ...input.sourceCandidates.flatMap((candidate) => candidate.sourceRefs),
    ...input.convergenceReview.provenanceRefs,
    ...collectConvergenceAttributionEvidenceRefs(convergenceReport),
  ]);
  const rejectedDecisionReasons = convergenceReport.decisions
    ?.filter((decision) => decision.status === "rejected")
    .map((decision) => decision.reason) ?? [];
  const unknownDecisionReasons = convergenceReport.decisions
    ?.filter((decision) => decision.status === "unknown")
    .map((decision) => decision.reason) ?? [];
  const aiAdvisory =
    convergenceReport.aiAdvisory?.status === "completed" ? convergenceReport.aiAdvisory : undefined;
  const directionOptions = createDirectionOptions({
    goal: input.goal,
    goalIntentProfile: profile,
    convergenceReview: input.convergenceReview,
    sourceEvidenceRefs,
    candidateConstraintRefs,
    clarificationQuestions,
    constraints: input.constraints,
    aiAdvisory,
  });
  const directionOptionIds = new Set(directionOptions.map((option) => option.optionId));
  const deterministicRecommendedOptionId =
    convergenceReport.recommendedOptionId !== undefined &&
    directionOptionIds.has(convergenceReport.recommendedOptionId)
      ? convergenceReport.recommendedOptionId
      : undefined;
  const selectedOptionId =
    deterministicRecommendedOptionId ??
    directionOptions.find((option) => option.recommendationScore === 1)?.optionId ??
    directionOptions[0]?.optionId ??
    createId("direction-option");

  return {
    id: createId("direction-handoff"),
    version: 1,
    sourceGoalId: input.goalId,
    rawUserInputRef: "goal.received",
    clarifiedGoal: createClarifiedGoal(input.goal, profile),
    nonGoals: createHandoffNonGoals(profile, input.constraints),
    assumptions: [
      ...createHandoffAssumptions(profile),
      `Convergence review ${input.convergenceReview.reviewId} is the source of handoff candidate selection.`,
      ...(aiAdvisory !== undefined && aiAdvisory.status === "completed"
        ? ["AI-assisted convergence advisory enriched candidate analysis and direction recommendation."]
        : []),
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
      ...(aiAdvisory?.conflictsNeedingUserInput.map((conflict) => `AI-identified conflict: ${conflict}`) ?? []),
      ...(aiAdvisory?.constraintViolations.map((violation) => `AI-identified constraint risk: ${violation}`) ?? []),
      ...(input.clarificationRequest === undefined
        ? []
        : ["Aboveground planning is blocked until user clarification is answered."]),
    ]),
    options: directionOptions,
    decisionRecord: {
      retainedOptionId: selectedOptionId,
      mergedOptionIds: optionCandidateIdsByConclusion(input.convergenceReview, ["merge"]),
      rejectedOptionIds: optionCandidateIdsByConclusion(input.convergenceReview, ["reject"]),
      userDecisionRequired,
      abovegroundReferenceOptionIds:
        convergenceReport.abovegroundReferenceOptionIds?.length === 0
          ? directionOptions.map((option) => option.optionId).filter((optionId) => optionId !== selectedOptionId)
          : convergenceReport.abovegroundReferenceOptionIds ?? [],
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
      convergenceReview: input.convergenceReview,
      clarificationRequest: input.clarificationRequest,
    }),
    sourceCandidateRefs: input.sourceCandidates,
    convergenceReviewRef: input.convergenceReview.reviewId,
    recommendedOptionId: selectedOptionId,
    growthEntry: {
      allowedRuntimeShapes: deriveAllowedRuntimeShapes(profile),
      suggestedFirstWorkflowNodes: deriveSuggestedFirstWorkflowNodes(profile, directionOptions),
      escalationRules: createGrowthEntryEscalationRules({
        goalIntentProfile: profile,
        clarificationRequest: input.clarificationRequest,
        convergenceReport,
      }),
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function createClarifiedGoal(goal: string, profile?: GoalIntentProfile): string {
  if (profile === undefined) {
    return goal;
  }
  const domain = profile.domainConcepts.slice(0, 5).join(", ");
  if (domain.length === 0) {
    return profile.goalStatement;
  }
  return `${profile.goalStatement} Target domain concepts: ${domain}.`;
}

function createHandoffAssumptions(profile?: GoalIntentProfile): string[] {
  if (profile === undefined) {
    return ["The deterministic Underground profile is sufficient for this handoff."];
  }
  return unique([
    ...profile.assumptions,
    ...profile.unknowns.map((unknown) => `Non-blocking assumption pending Aboveground validation: ${unknown}`),
  ]);
}

function collectConvergenceAttributionEvidenceRefs(
  convergenceReport: UndergroundConvergenceReport
): string[] {
  return unique([
    ...(convergenceReport.evidenceLedgerRef === undefined ? [] : [convergenceReport.evidenceLedgerRef]),
    ...(convergenceReport.candidateComparisons ?? []).flatMap((comparison) => [
      comparison.comparisonId,
      ...comparison.evidenceRefs,
    ]),
    ...(convergenceReport.decisions ?? []).flatMap((decision) => [
      decision.decisionId,
      ...decision.evidenceRefs,
      ...decision.provenanceRefs,
    ]),
    ...convergenceReport.openQuestions.flatMap((question) => question.evidenceRefs),
    ...(convergenceReport.userClarificationRequest === undefined
      ? []
      : [
          convergenceReport.userClarificationRequest.requestId,
          ...convergenceReport.userClarificationRequest.relatedCandidateRefs,
          ...convergenceReport.userClarificationRequest.questions.map((question) => question.questionId),
        ]),
  ]);
}

function createRiskRegister(input: {
  goalIntentProfile?: GoalIntentProfile;
  rejectedDecisionReasons: readonly string[];
  convergenceReview: ConvergenceReview;
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
      mitigation: ["Keep the risk visible in the Plan Package and convergence evidence."],
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

  const riskComparisons =
    input.convergenceReview.candidateComparisons?.filter((comparison) => comparison.rootletKind === "risk") ?? [];
  for (const [index, comparison] of riskComparisons.entries()) {
    risks.push({
      riskId: `risk-candidate-${index + 1}`,
      name: comparison.candidateSummary,
      source: comparison.rootletOutputRef,
      impactScope: ["underground_center", "agentarbor_handoff", "aboveground_center"],
      blockingLevel:
        comparison.conclusion === "needs_user" ? "ask_user" : comparison.riskLevel === "blocking" ? "block" : "watch",
      evidenceRefs: comparison.evidenceRefs,
      mitigation:
        comparison.whyNot.length > 0
          ? comparison.whyNot
          : ["Keep this risk visible while evaluating the retained option."],
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

function createDirectionOptions(input: {
  goal: string;
  goalIntentProfile?: GoalIntentProfile;
  convergenceReview: ConvergenceReview;
  sourceEvidenceRefs: readonly string[];
  candidateConstraintRefs: ReturnType<typeof createCandidateConstraintRefs>;
  clarificationQuestions: readonly string[];
  constraints: readonly Constraint[];
  aiAdvisory?: UndergroundConvergenceAiAdvisory;
}): DirectionOption[] {
  const optionComparisons =
    input.convergenceReview.candidateComparisons?.filter((comparison) => comparison.rootletKind === "option") ?? [];
  const convergenceReport = input.convergenceReview as UndergroundConvergenceReport;
  const recommendedOptionId = convergenceReport.recommendedOptionId;
  const rejectedReasonByCandidateId = new Map(
    (convergenceReport.rejectedCandidateRefsWithReasons ?? []).map((item) => [item.candidateId, item.reason])
  );
  const fallbackOptionId = createId("direction-option");
  const comparisons =
    optionComparisons.length > 0
      ? optionComparisons
      : [
          {
            candidateId: fallbackOptionId,
            candidateSummary: input.goalIntentProfile?.goalStatement ?? input.goal,
            evidenceRefs: [...input.sourceEvidenceRefs],
            unknowns: [...input.clarificationQuestions],
            whyNot: [],
            conclusion: "accept" as const,
          },
        ];

  const advisoryAnalysisByCandidateId = new Map(
    (input.aiAdvisory?.candidateAnalyses ?? []).map((analysis) => [analysis.candidateId, analysis])
  );

  return comparisons.map((comparison) => {
    const isRecommended = comparison.candidateId === recommendedOptionId || recommendedOptionId === undefined;
    const rejectedReason = rejectedReasonByCandidateId.get(comparison.candidateId);
    const advisoryAnalysis = advisoryAnalysisByCandidateId.get(comparison.candidateId);
    const enrichedSummary = buildEnrichedDirectionSummary(comparison, advisoryAnalysis, input.goalIntentProfile);
    return {
      optionId: comparison.candidateId,
      directionSummary: enrichedSummary,
      supportingEvidenceRefs: unique([...input.sourceEvidenceRefs, ...comparison.evidenceRefs]),
      soilAssetFitRefs: ["soil:minimal-constraints"],
      constraintImpact: input.candidateConstraintRefs.map((constraint) => constraint.constraintId),
      riskProfile: unique([...(input.goalIntentProfile?.riskHints ?? []), rejectedReason ?? ""]),
      costProfile:
        input.goalIntentProfile?.keyConcepts.includes("cost") === true
          ? ["cost-sensitive"]
          : deriveCostProfile(input.goalIntentProfile),
      unknowns: [...input.clarificationQuestions],
      whyNot: unique([...(comparison.whyNot ?? []), rejectedReason ?? ""]),
      recommendationScore:
        comparison.conclusion === "reject" ? 0 : isRecommended ? 1 : comparison.conclusion === "merge" ? 0.75 : 0.5,
      doNotChooseWhen: unique([
        ...createDoNotChooseWhen(input.goalIntentProfile, input.constraints),
        ...(input.clarificationQuestions.length === 0
          ? []
          : ["The blocking user clarification request remains unanswered."]),
      ]),
    };
  });
}

function deriveAllowedRuntimeShapes(profile?: GoalIntentProfile): DirectionHandoff["growthEntry"]["allowedRuntimeShapes"] {
  if (profile === undefined) {
    return ["single_agent"];
  }
  const concepts = new Set([...profile.domainConcepts, ...profile.keyConcepts]);
  const complexAgentApp =
    concepts.has("agent") ||
    concepts.has("agent_app") ||
    profile.acceptanceCriteria.length >= 4 ||
    profile.rawGoal.includes("，") ||
    profile.rawGoal.includes("、");
  if (concepts.has("quality_review") || concepts.has("customer_service_quality_review")) {
    return ["shared_team_cluster", "sub_agent_tree", "single_agent"];
  }
  if (complexAgentApp) {
    return ["sub_agent_tree", "shared_team_cluster", "single_agent"];
  }
  return ["single_agent"];
}

function deriveSuggestedFirstWorkflowNodes(
  profile: GoalIntentProfile | undefined,
  options: readonly DirectionOption[]
): string[] {
  const nodes = new Set<string>([
    "confirm_direction_handoff",
    "define_input_contract",
    "derive_execution_plan",
    "verify_with_evidence",
  ]);
  const concepts = new Set([...(profile?.domainConcepts ?? []), ...(profile?.keyConcepts ?? [])]);
  if (concepts.has("input_reading") || concepts.has("meeting_transcript") || concepts.has("text_processing")) {
    nodes.add("map_source_materials");
  }
  if (concepts.has("structured_extraction") || concepts.has("action_items") || concepts.has("todo_items")) {
    nodes.add("define_structured_outputs");
  }
  if (concepts.has("quality_review") || concepts.has("customer_service_quality_review") || concepts.has("scoring")) {
    nodes.add("define_review_rubric");
    nodes.add("human_escalation_gate");
  }
  if (options.some((option) => option.supportingEvidenceRefs.length > 0)) {
    nodes.add("preserve_evidence_refs");
  }
  nodes.add("prepare_nutrient_request_triggers");
  return [...nodes];
}

function createGrowthEntryEscalationRules(input: {
  goalIntentProfile?: GoalIntentProfile;
  clarificationRequest?: UserClarificationRequest;
  convergenceReport: UndergroundConvergenceReport;
}): string[] {
  return unique([
    "Do not let Aboveground create a parallel direction exploration path.",
    "Trigger Nutrient Request when source evidence, Soil asset fit, permission boundary, or validation criteria are insufficient.",
    "Stop or ask the user before executing if the generated execution plan would weaken hard constraints or evidence retention.",
    ...(input.goalIntentProfile?.unknowns.map((unknown) => `Treat unresolved question as a planning assumption until verified: ${unknown}`) ?? []),
    ...(input.convergenceReport.openQuestions ?? []).map(
      (question) => `Carry open question ${question.candidateId} into planning review: ${question.question}`
    ),
    ...(input.clarificationRequest === undefined
      ? []
      : [`Resolve user clarification request ${input.clarificationRequest.requestId} before planning.`]),
  ]);
}

function deriveCostProfile(profile?: GoalIntentProfile): string[] {
  const profileConcepts = new Set([...(profile?.domainConcepts ?? []), ...(profile?.keyConcepts ?? [])]);
  if (profileConcepts.has("evidence_traceability") || profileConcepts.has("meeting_minutes_evidence")) {
    return ["evidence-retention-cost", "review-workflow-cost"];
  }
  if (profileConcepts.has("customer_service_quality_review")) {
    return ["sampling-and-review-cost", "human-escalation-cost"];
  }
  return ["bounded-local-runtime", "aboveground-validation-cost"];
}

function optionCandidateIdsByConclusion(
  convergenceReview: ConvergenceReview,
  conclusions: readonly CandidateComparison["conclusion"][]
): string[] {
  return (
    convergenceReview.candidateComparisons
      ?.filter((comparison) => comparison.rootletKind === "option" && conclusions.includes(comparison.conclusion))
      .map((comparison) => comparison.candidateId) ?? []
  );
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

function buildEnrichedDirectionSummary(
  comparison: { readonly candidateSummary: string; readonly contentDifference?: string },
  advisoryAnalysis?: { readonly contentDifference: string; readonly whyPreferred: string },
  profile?: GoalIntentProfile
): string {
  const base = addGoalContextToSummary(comparison.candidateSummary, profile);
  if (advisoryAnalysis === undefined) {
    if (comparison.contentDifference !== undefined && comparison.contentDifference.length > 0) {
      return `${base}\n\nKey differentiator: ${comparison.contentDifference}`;
    }
    return base;
  }
  const parts = [base];
  if (advisoryAnalysis.contentDifference.length > 0) {
    parts.push(`\n\nKey differentiator: ${advisoryAnalysis.contentDifference}`);
  }
  if (advisoryAnalysis.whyPreferred.length > 0) {
    parts.push(`\nWhy this direction: ${advisoryAnalysis.whyPreferred}`);
  }
  return parts.join("");
}

function addGoalContextToSummary(summary: string, profile?: GoalIntentProfile): string {
  if (profile === undefined || summarySharesGoalTerm(summary, profile)) {
    return summary;
  }
  return `For ${profile.goalStatement}: ${summary}`;
}

function summarySharesGoalTerm(summary: string, profile: GoalIntentProfile): boolean {
  const haystack = summary.toLowerCase();
  const englishTerms = profile.goalStatement.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const chineseTerms = profile.goalStatement.match(/[\u4e00-\u9fff]{2,8}/gu) ?? [];
  const terms = unique([
    ...profile.domainConcepts,
    ...profile.keyConcepts,
    ...englishTerms,
    ...chineseTerms,
  ]);
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}
