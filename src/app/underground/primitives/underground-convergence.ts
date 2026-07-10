import type { Constraint } from "../../../domain/contracts.js";
import {
  applyCandidateConvergenceDecisions,
  compareCandidatesForGoal,
  createDefaultGoalIntentProfile,
  createUndergroundEvidenceEntry,
  createOpenQuestionDisposition,
  createUndergroundConvergenceReport,
  evidenceId,
  sanitizeUndergroundConvergenceAiAdvisoryText,
  sanitizeUndergroundConvergenceAiAdvisoryTexts,
  type CandidateComparison,
  type CandidateComparisonConclusion,
  type CandidateComparisonLevel,
  type CandidateConvergenceStatus,
  type CandidatePool,
  type ExplorationCandidateRef,
  type GoalIntentProfile,
  type RootletOutput,
  type CandidateConvergenceDecision,
  type UndergroundAutonomyDecision,
  type UndergroundConvergenceAiAdvisory,
  type UndergroundConvergenceReport,
  type UndergroundConvergenceReasoningTraceEntry,
  type UndergroundConvergenceSource,
  type UndergroundEvidenceEntry,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationPlan,
  type UserClarificationReason,
} from "../../../domain/underground/index.js";
import { createId, nowIso } from "../../../kernel/id.js";
import {
  appendUndergroundConvergenceOutcomeEvidence,
  createMinimalUndergroundEvidenceLedger,
} from "./underground-evidence.js";

export type ConvergenceJudgmentNextAction =
  | "approve_handoff"
  | "continue_exploration"
  | "request_user_clarification"
  | "stop";

export type ConvergenceJudgmentCandidateDecision = {
  readonly candidateId: string;
  readonly status: CandidateConvergenceStatus;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly clarificationReason?: UserClarificationReason;
  readonly contentDifference?: string;
  readonly whyPreferred?: string;
  readonly conflictWith?: readonly string[];
  readonly openQuestion?: string;
  readonly blockingLevel?: "blocking" | "non_blocking";
};

export type ConvergenceJudgment = {
  readonly judgmentId: string;
  readonly nextAction: ConvergenceJudgmentNextAction;
  readonly recommendedOptionId?: string;
  readonly candidateDecisions: readonly ConvergenceJudgmentCandidateDecision[];
  readonly conflictsNeedingUserInput: readonly string[];
  readonly constraintViolations: readonly string[];
  readonly overallDirectionSummary: string;
  readonly decisionSummary: string;
  readonly uncertainty: string;
};

export function convergeMinimalCandidatePool(input: {
  pool: CandidatePool;
  plan: UndergroundExplorationPlan;
  leadAgentId: string;
  rootletOutputs: readonly RootletOutput[];
  goalIntentProfile?: GoalIntentProfile;
  constraints?: readonly Constraint[];
  evidenceLedger?: UndergroundEvidenceLedger;
  aiAdvisory?: UndergroundConvergenceAiAdvisory;
}): {
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
  evidenceLedger: UndergroundEvidenceLedger;
  candidateComparisons: CandidateComparison[];
} {
  const createdAt = nowIso();
  const goalIntentProfile = input.goalIntentProfile ?? createDefaultGoalIntentProfile(input.pool.goalId, createdAt);
  const comparisonResult = compareCandidatesForGoal({
    goalProfile: goalIntentProfile,
    candidates: input.pool.candidates,
    rootletOutputs: input.rootletOutputs,
    createdAt,
  });
  const aiAdvisory = sanitizeConvergenceAdvisoryForComparison(input.aiAdvisory);
  const enrichedComparisons = enrichComparisonsWithAdvisory(comparisonResult.comparisons, aiAdvisory);
  const decisions = comparisonResult.decisions;
  const candidatePool = applyCandidateConvergenceDecisions(input.pool, decisions, createdAt);
  const unknownCandidateIds = new Set(decisions
    .filter((decision) => decision.status === "unknown")
    .map((decision) => decision.candidateId));
  let evidenceLedger = createMinimalUndergroundEvidenceLedger({
    existingLedger: input.evidenceLedger,
    goalIntentProfile,
    constraints: input.constraints ?? [],
    rootletOutputs: input.rootletOutputs,
    extraEntries: comparisonResult.evidenceEntries,
    createdAt,
  });
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: createId("convergence"),
    reviewedByAgentIds: [input.leadAgentId],
    leadAgentId: input.leadAgentId,
    candidatePool,
    decisions,
    candidateComparisons: enrichedComparisons,
    evidenceLedgerRef: evidenceLedger.ledgerId,
    provenanceRefs: [evidenceId(input.pool.goalId, "goal-intent"), "goal.received", "candidate_pool.updated"],
    budget: {
      ...input.plan.budget,
      spentCandidateOutputs: candidatePool.candidates.length,
      exhausted:
        input.plan.budget.exhausted || candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
    },
    summary: `Underground compared ${candidatePool.candidates.length} candidates against the goal intent profile.`,
    aiAdvisory,
    openQuestionDispositions: comparisonResult.comparisons
      .filter((comparison) => unknownCandidateIds.has(comparison.candidateId))
      .sort((left, right) => Number(right.conclusion === "needs_user") - Number(left.conclusion === "needs_user"))
      .map((comparison) =>
        createOpenQuestionDisposition({
          candidateId: comparison.candidateId,
          reason:
            comparison.conclusion === "needs_user"
              ? "permission_boundary_unclear"
              : "critical_fact_missing",
          question:
            comparison.conclusion === "needs_user"
              ? "Can Aboveground execution proceed within the current permission boundary?"
              : "Keep this non-blocking uncertainty visible for later review.",
          blockingLevel: comparison.conclusion === "needs_user" ? "blocking" : "non_blocking",
          evidenceRefs: comparison.evidenceRefs,
        })
      ),
    userClarificationRequestId: createId("user-clarification"),
    createdAt,
  });
  evidenceLedger = appendUndergroundConvergenceOutcomeEvidence({
    ledger: evidenceLedger,
    convergenceReport,
    createdAt,
  });

  return { candidatePool, convergenceReport, evidenceLedger, candidateComparisons: enrichedComparisons };
}

export function convergeCandidatePoolFromJudgment(input: {
  pool: CandidatePool;
  plan: UndergroundExplorationPlan;
  leadAgentId: string;
  rootletOutputs: readonly RootletOutput[];
  judgment: ConvergenceJudgment;
  goalIntentProfile?: GoalIntentProfile;
  constraints?: readonly Constraint[];
  evidenceLedger?: UndergroundEvidenceLedger;
  source: UndergroundConvergenceSource;
  confidence: number;
  reasoningTrace: readonly UndergroundConvergenceReasoningTraceEntry[];
  forcedStopReason?: UndergroundConvergenceReport["stopReason"];
}): {
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
  evidenceLedger: UndergroundEvidenceLedger;
  candidateComparisons: CandidateComparison[];
} {
  const createdAt = nowIso();
  const goalIntentProfile = input.goalIntentProfile ?? createDefaultGoalIntentProfile(input.pool.goalId, createdAt);
  const comparisonResult = createComparisonsFromJudgment({
    goalIntentProfile,
    pool: input.pool,
    rootletOutputs: input.rootletOutputs,
    judgment: input.judgment,
    leadAgentId: input.leadAgentId,
    source: input.source,
    createdAt,
  });
  const candidatePool = applyCandidateConvergenceDecisions(input.pool, comparisonResult.decisions, createdAt);
  let evidenceLedger = createMinimalUndergroundEvidenceLedger({
    existingLedger: input.evidenceLedger,
    goalIntentProfile,
    constraints: input.constraints ?? [],
    rootletOutputs: input.rootletOutputs,
    extraEntries: comparisonResult.evidenceEntries,
    createdAt,
  });
  const aiAdvisory = convergenceJudgmentToAdvisory({
    judgment: input.judgment,
    source: input.source,
    pool: input.pool,
    rootletOutputs: input.rootletOutputs,
  });
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: createId("convergence"),
    reviewedByAgentIds: [input.leadAgentId],
    leadAgentId: input.leadAgentId,
    candidatePool,
    decisions: comparisonResult.decisions,
    candidateComparisons: comparisonResult.comparisons,
    evidenceLedgerRef: evidenceLedger.ledgerId,
    provenanceRefs: unique([
      evidenceId(input.pool.goalId, "goal-intent"),
      "goal.received",
      "candidate_pool.updated",
      input.judgment.judgmentId,
      `source:${input.source}`,
      ...input.reasoningTrace.flatMap((entry) => [
        ...entry.modelCallRefs,
        ...entry.toolCallRefs,
        ...entry.fallbackRefs,
      ]),
    ]),
    budget: {
      ...input.plan.budget,
      spentCandidateOutputs: candidatePool.candidates.length,
      exhausted:
        input.plan.budget.exhausted ||
        input.judgment.nextAction === "stop" ||
        candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
    },
    summary: input.judgment.overallDirectionSummary,
    aiAdvisory,
    openQuestionDispositions: createJudgmentOpenQuestionDispositions({
      judgment: input.judgment,
      decisions: comparisonResult.decisions,
      nextAction: input.judgment.nextAction,
    }),
    userClarificationRequestId: createId("user-clarification"),
    forcedStopReason: input.forcedStopReason,
    source: input.source,
    confidence: input.confidence,
    reasoningTrace: input.reasoningTrace,
    createdAt,
  });
  evidenceLedger = appendUndergroundConvergenceOutcomeEvidence({
    ledger: evidenceLedger,
    convergenceReport,
    createdAt,
  });

  return { candidatePool, convergenceReport, evidenceLedger, candidateComparisons: comparisonResult.comparisons };
}

export function convergeAutonomyTerminalCandidatePool(input: {
  pool: CandidatePool;
  plan: UndergroundExplorationPlan;
  leadAgentId: string;
  rootletOutputs: readonly RootletOutput[];
  goalIntentProfile?: GoalIntentProfile;
  constraints?: readonly Constraint[];
  evidenceLedger?: UndergroundEvidenceLedger;
  autonomyDecision: UndergroundAutonomyDecision;
}): {
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
  evidenceLedger: UndergroundEvidenceLedger;
  candidateComparisons: CandidateComparison[];
} {
  const createdAt = nowIso();
  const goalIntentProfile = input.goalIntentProfile ?? createDefaultGoalIntentProfile(input.pool.goalId, createdAt);
  const comparisonResult = compareCandidatesForGoal({
    goalProfile: goalIntentProfile,
    candidates: input.pool.candidates,
    rootletOutputs: input.rootletOutputs,
    createdAt,
  });
  const terminal = autonomyTerminalShape(input.autonomyDecision, input.pool);
  const decisions = comparisonResult.decisions.map((decision) =>
    createAutonomyTerminalDecision({
      decision,
      autonomyDecision: input.autonomyDecision,
      terminalStatus: terminal.decisionStatusByCandidateId.get(decision.candidateId) ?? decision.status,
      forceTerminalReason: terminal.forceTerminalReason,
    })
  );
  const candidatePool = applyCandidateConvergenceDecisions(input.pool, decisions, createdAt);
  let evidenceLedger = createMinimalUndergroundEvidenceLedger({
    existingLedger: input.evidenceLedger,
    goalIntentProfile,
    constraints: input.constraints ?? [],
    rootletOutputs: input.rootletOutputs,
    extraEntries: comparisonResult.evidenceEntries,
    createdAt,
  });
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: createId("convergence"),
    reviewedByAgentIds: [input.leadAgentId],
    leadAgentId: input.leadAgentId,
    candidatePool,
    decisions,
    candidateComparisons: comparisonResult.comparisons,
    evidenceLedgerRef: evidenceLedger.ledgerId,
    provenanceRefs: [
      evidenceId(input.pool.goalId, "goal-intent"),
      "goal.received",
      "candidate_pool.updated",
      "autonomy_review.completed",
      input.autonomyDecision.decisionId,
      ...(input.autonomyDecision.stopReason === undefined ? [] : [input.autonomyDecision.stopReason]),
      ...input.autonomyDecision.sourceRefs,
      ...input.autonomyDecision.modelCallRefs.map((ref) => ref.requestId),
    ],
    budget: {
      ...input.plan.budget,
      spentCandidateOutputs: candidatePool.candidates.length,
      exhausted: true,
    },
    summary: terminal.summary,
    openQuestionDispositions: terminal.clarificationCandidateIds.map((candidateId) =>
      createOpenQuestionDisposition({
        candidateId,
        reason: "critical_fact_missing",
        question: `Autonomy core requested user clarification before convergence can promote candidate ${candidateId}.`,
        blockingLevel: "blocking",
        evidenceRefs: [
          input.autonomyDecision.decisionId,
          ...input.autonomyDecision.sourceRefs,
          ...input.autonomyDecision.modelCallRefs.map((ref) => ref.requestId),
        ],
      })
    ),
    userClarificationRequestId: createId("user-clarification"),
    forcedStopReason: terminal.stopReason,
    source: "terminal_autonomy",
    confidence: 0.24,
    createdAt,
  });
  evidenceLedger = appendUndergroundConvergenceOutcomeEvidence({
    ledger: evidenceLedger,
    convergenceReport,
    createdAt,
  });

  return { candidatePool, convergenceReport, evidenceLedger, candidateComparisons: comparisonResult.comparisons };
}

function sanitizeConvergenceAdvisoryForComparison(
  advisory?: UndergroundConvergenceAiAdvisory
): UndergroundConvergenceAiAdvisory | undefined {
  if (advisory === undefined) {
    return undefined;
  }
  return {
    advisoryId: advisory.advisoryId,
    recommendedOptionId: advisory.recommendedOptionId,
    candidateAnalyses: advisory.candidateAnalyses.map((analysis) => ({
      candidateId: analysis.candidateId,
      kind: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.kind),
      contentDifference: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.contentDifference),
      whyPreferred: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.whyPreferred),
      conflictWith: sanitizeUndergroundConvergenceAiAdvisoryTexts(analysis.conflictWith),
    })),
    conflictsNeedingUserInput: sanitizeUndergroundConvergenceAiAdvisoryTexts(advisory.conflictsNeedingUserInput),
    constraintViolations: sanitizeUndergroundConvergenceAiAdvisoryTexts(advisory.constraintViolations),
    overallDirectionSummary: sanitizeUndergroundConvergenceAiAdvisoryText(advisory.overallDirectionSummary),
    status: advisory.status,
  };
}

function createComparisonsFromJudgment(input: {
  goalIntentProfile: GoalIntentProfile;
  pool: CandidatePool;
  rootletOutputs: readonly RootletOutput[];
  judgment: ConvergenceJudgment;
  leadAgentId: string;
  source: UndergroundConvergenceSource;
  createdAt: string;
}): {
  readonly comparisons: CandidateComparison[];
  readonly decisions: CandidateConvergenceDecision[];
  readonly evidenceEntries: UndergroundEvidenceEntry[];
} {
  const outputById = new Map(input.rootletOutputs.map((output) => [output.outputId, output]));
  const judgmentByCandidateId = new Map(input.judgment.candidateDecisions.map((decision) => [decision.candidateId, decision]));
  const comparisons = input.pool.candidates.map((candidate) => {
    const rootletOutput = findRootletOutputForCandidate(candidate, outputById);
    const judgmentDecision = judgmentByCandidateId.get(candidate.id);
    if (judgmentDecision === undefined) {
      throw new Error(`Convergence judgment omitted candidate ${candidate.id}.`);
    }
    return createComparisonFromJudgmentDecision({
      goalIntentProfile: input.goalIntentProfile,
      candidate,
      rootletOutput,
      decision: judgmentDecision,
      source: input.source,
      createdAt: input.createdAt,
    });
  });
  const comparisonByCandidateId = new Map(comparisons.map((comparison) => [comparison.candidateId, comparison]));
  const decisions = input.pool.candidates.map((candidate) => {
    const comparison = comparisonByCandidateId.get(candidate.id);
    const judgmentDecision = judgmentByCandidateId.get(candidate.id);
    if (comparison === undefined || judgmentDecision === undefined) {
      throw new Error(`Convergence judgment cannot create a decision for candidate ${candidate.id}.`);
    }
    return createDecisionFromJudgment({
      candidate,
      comparison,
      decision: judgmentDecision,
      leadAgentId: input.leadAgentId,
      source: input.source,
    });
  });
  const decisionByCandidateId = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const evidenceEntries = comparisons.flatMap((comparison) => {
    const decision = decisionByCandidateId.get(comparison.candidateId);
    return [
      createUndergroundEvidenceEntry({
        evidenceId: comparison.comparisonId,
        goalId: input.goalIntentProfile.goalId,
        kind: "candidate_comparison",
        summary: [
          `AI Convergence Judge compared candidate ${comparison.candidateId} and concluded ${comparison.conclusion}.`,
          `goal=${comparison.goalMatch}: ${comparison.goalMatchBasis}`,
          `evidence=${comparison.evidenceSupport}: ${comparison.evidenceSupportBasis}`,
          `constraint=${comparison.constraintImpact}: ${comparison.constraintImpactBasis}`,
          `risk=${comparison.riskLevel}: ${comparison.riskCoverage.join("; ") || "no dedicated risk signal"}`,
        ].join(" "),
        sourceRefs: unique([comparison.rootletOutputRef, ...comparison.evidenceRefs.slice(1)]),
        createdAt: input.createdAt,
      }),
      createUndergroundEvidenceEntry({
        evidenceId: decision?.evidenceRefs[0] ?? evidenceId(input.goalIntentProfile.goalId, `decision:${comparison.candidateId}`),
        goalId: input.goalIntentProfile.goalId,
        kind: "convergence_decision",
        summary: `Candidate ${comparison.candidateId} is ${decision?.status ?? "unknown"} because ${decision?.reason ?? "no judgment reason was available"}.`,
        sourceRefs: unique([comparison.comparisonId, ...comparison.evidenceRefs, ...(decision?.provenanceRefs ?? [])]),
        createdAt: input.createdAt,
      }),
    ];
  });

  return { comparisons, decisions, evidenceEntries };
}

function createComparisonFromJudgmentDecision(input: {
  goalIntentProfile: GoalIntentProfile;
  candidate: ExplorationCandidateRef;
  rootletOutput: RootletOutput;
  decision: ConvergenceJudgmentCandidateDecision;
  source: UndergroundConvergenceSource;
  createdAt: string;
}): CandidateComparison {
  const comparisonId = evidenceId(input.goalIntentProfile.goalId, `comparison:${input.candidate.id}`);
  const levels = levelsForJudgmentStatus(input.decision.status, input.rootletOutput.kind, input.source);
  const safeReason = sanitizeUndergroundConvergenceAiAdvisoryText(input.decision.reason);
  const evidenceRefs = unique([
    comparisonId,
    ...filterAllowedEvidenceRefs(input.decision.evidenceRefs, input.candidate, input.rootletOutput),
  ]);
  return {
    comparisonId,
    candidateId: input.candidate.id,
    goalId: input.goalIntentProfile.goalId,
    rootletOutputRef: input.rootletOutput.outputId,
    rootletKind: input.rootletOutput.kind,
    candidateSummary: input.candidate.summary ?? input.rootletOutput.summary,
    goalMatch: levels.goalMatch,
    goalMatchBasis: safeReason || `Convergence Judge marked candidate ${input.candidate.id} as ${input.decision.status}.`,
    evidenceSupport: levels.evidenceSupport,
    evidenceSupportBasis:
      evidenceRefs.length > 1
        ? `Judgment cites refs ${evidenceRefs.slice(1).join(", ")}.`
        : "Judgment falls back to rootlet source refs because no additional evidence refs were provided.",
    evidenceGaps: input.decision.status === "unknown" ? [input.decision.openQuestion ?? input.decision.reason] : [],
    constraintImpact: levels.constraintImpact,
    constraintImpactBasis: levels.constraintImpactBasis,
    hardConstraintConflictRefs:
      input.decision.status === "rejected"
        ? input.rootletOutput.constraintRefs
            .filter((constraint) => constraint.requiredLevel === "hard")
            .map((constraint) => constraint.constraintId)
        : [],
    riskLevel: levels.riskLevel,
    riskCoverage: input.rootletOutput.riskRefs.length > 0
      ? [...input.rootletOutput.riskRefs]
      : [...levels.riskCoverage],
    unknowns: input.decision.status === "unknown" ? [input.decision.openQuestion ?? input.decision.reason] : [],
    whyNot: input.decision.status === "rejected" ? [safeReason] : [],
    conclusion: conclusionForJudgmentStatus(input.decision.status),
    evidenceRefs,
    createdAt: input.createdAt,
    contentDifference: sanitizeUndergroundConvergenceAiAdvisoryText(input.decision.contentDifference ?? safeReason),
    whyPreferred: sanitizeUndergroundConvergenceAiAdvisoryText(input.decision.whyPreferred ?? safeReason),
    conflictWith: sanitizeUndergroundConvergenceAiAdvisoryTexts(input.decision.conflictWith ?? []),
  };
}

function createDecisionFromJudgment(input: {
  candidate: ExplorationCandidateRef;
  comparison: CandidateComparison;
  decision: ConvergenceJudgmentCandidateDecision;
  leadAgentId: string;
  source: UndergroundConvergenceSource;
}): CandidateConvergenceDecision {
  const decisionEvidenceRef = evidenceId(input.comparison.goalId, `decision:${input.candidate.id}`);
  const reason = sanitizeUndergroundConvergenceAiAdvisoryText(input.decision.reason);
  return {
    decisionId: decisionEvidenceRef,
    candidateId: input.candidate.id,
    sourceCandidateRefs: [input.candidate.id],
    status: input.decision.status,
    decidedByRole: "convergence_judge",
    reason: reason || `Convergence Judge marked candidate ${input.candidate.id} as ${input.decision.status}.`,
    provenanceRefs: unique([
      ...input.candidate.sourceRefs,
      input.comparison.comparisonId,
      ...input.comparison.evidenceRefs,
      `agent:${input.leadAgentId}`,
      `source:${input.source}`,
    ]),
    evidenceRefs: unique([decisionEvidenceRef, input.comparison.comparisonId, ...input.comparison.evidenceRefs]),
  };
}

function createJudgmentOpenQuestionDispositions(input: {
  judgment: ConvergenceJudgment;
  decisions: readonly CandidateConvergenceDecision[];
  nextAction: ConvergenceJudgmentNextAction;
}) {
  const decisionByCandidateId = new Map(input.judgment.candidateDecisions.map((decision) => [decision.candidateId, decision]));
  return input.decisions
    .filter((decision) => decision.status === "unknown")
    .map((decision) => {
      const judgmentDecision = decisionByCandidateId.get(decision.candidateId);
      const blockingLevel =
        input.nextAction === "request_user_clarification" || judgmentDecision?.blockingLevel === "blocking"
          ? "blocking"
          : "non_blocking";
      return createOpenQuestionDisposition({
        candidateId: decision.candidateId,
        reason: judgmentDecision?.clarificationReason ??
          (blockingLevel === "blocking" ? "critical_fact_missing" : "value_tradeoff_required"),
        question:
          judgmentDecision?.openQuestion ??
          (blockingLevel === "blocking"
            ? `Convergence Judge requires user clarification before candidate ${decision.candidateId} can be promoted.`
            : `Keep candidate ${decision.candidateId} as a non-blocking open question for Aboveground review.`),
        blockingLevel,
        evidenceRefs: decision.evidenceRefs,
      });
    });
}

function convergenceJudgmentToAdvisory(input: {
  readonly judgment: ConvergenceJudgment;
  readonly source: UndergroundConvergenceSource;
  readonly pool: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
}): UndergroundConvergenceAiAdvisory | undefined {
  const { judgment, source } = input;
  if (source !== "ai") {
    return {
      advisoryId: judgment.judgmentId,
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary: "",
      status: "failed",
    };
  }
  const outputById = new Map(input.rootletOutputs.map((output) => [output.outputId, output]));
  const kindByCandidateId = new Map(
    input.pool.candidates.map((candidate) => [
      candidate.id,
      candidate.sourceRefs.map((sourceRef) => outputById.get(sourceRef)?.kind).find((kind) => kind !== undefined) ?? "",
    ])
  );
  return {
    advisoryId: judgment.judgmentId,
    recommendedOptionId: judgment.recommendedOptionId,
    candidateAnalyses: judgment.candidateDecisions.map((decision) => ({
      candidateId: decision.candidateId,
      kind: kindByCandidateId.get(decision.candidateId) ?? "",
      contentDifference: sanitizeUndergroundConvergenceAiAdvisoryText(decision.contentDifference ?? decision.reason),
      whyPreferred: sanitizeUndergroundConvergenceAiAdvisoryText(decision.whyPreferred ?? decision.reason),
      conflictWith: sanitizeUndergroundConvergenceAiAdvisoryTexts(decision.conflictWith ?? []),
    })),
    conflictsNeedingUserInput: sanitizeUndergroundConvergenceAiAdvisoryTexts(judgment.conflictsNeedingUserInput),
    constraintViolations: sanitizeUndergroundConvergenceAiAdvisoryTexts(judgment.constraintViolations),
    overallDirectionSummary: sanitizeUndergroundConvergenceAiAdvisoryText(judgment.overallDirectionSummary),
    status: "completed",
  };
}

function findRootletOutputForCandidate(
  candidate: ExplorationCandidateRef,
  outputById: ReadonlyMap<string, RootletOutput>
): RootletOutput {
  for (const sourceRef of candidate.sourceRefs) {
    const output = outputById.get(sourceRef);
    if (output !== undefined) {
      return output;
    }
  }
  throw new Error(`Candidate ${candidate.id} does not reference a known rootlet output.`);
}

function filterAllowedEvidenceRefs(
  refs: readonly string[],
  candidate: ExplorationCandidateRef,
  rootletOutput: RootletOutput
): string[] {
  const allowed = new Set([
    candidate.id,
    ...candidate.sourceRefs,
    rootletOutput.outputId,
    ...rootletOutput.evidenceRefs,
    ...rootletOutput.sourceRefs,
    ...rootletOutput.constraintRefs.map((constraint) => constraint.constraintId),
    ...rootletOutput.constraintRefs.map((constraint) => `constraint:${constraint.constraintId}`),
    ...rootletOutput.riskRefs,
    ...rootletOutput.soilAssetFitRefs,
  ]);
  const filtered = refs.filter((ref) => allowed.has(ref));
  return filtered.length > 0 ? filtered : unique([...candidate.sourceRefs, ...rootletOutput.evidenceRefs]);
}

function levelsForJudgmentStatus(
  status: CandidateConvergenceStatus,
  kind: RootletOutput["kind"],
  source: UndergroundConvergenceSource
): {
  readonly goalMatch: CandidateComparisonLevel;
  readonly evidenceSupport: CandidateComparisonLevel;
  readonly constraintImpact: CandidateComparisonLevel;
  readonly constraintImpactBasis: string;
  readonly riskLevel: CandidateComparisonLevel;
  readonly riskCoverage: readonly string[];
} {
  if (source === "deterministic_fallback") {
    return {
      goalMatch: "weak",
      evidenceSupport: "weak",
      constraintImpact: "partial",
      constraintImpactBasis: "Deterministic fallback cannot perform semantic convergence judgment.",
      riskLevel: "blocking",
      riskCoverage: ["Fallback convergence cannot approve a direction without AgentTurnRuntime."],
    };
  }
  switch (status) {
    case "accepted":
      return {
        goalMatch: "strong",
        evidenceSupport: "strong",
        constraintImpact: "partial",
        constraintImpactBasis: `AI judgment found ${kind} candidate structurally compatible with current hard guards.`,
        riskLevel: "partial",
        riskCoverage: ["No blocking risk was identified by the convergence judgment."],
      };
    case "merged":
      return {
        goalMatch: "partial",
        evidenceSupport: "partial",
        constraintImpact: "partial",
        constraintImpactBasis: `AI judgment kept ${kind} candidate as supporting material.`,
        riskLevel: "partial",
        riskCoverage: ["Supporting material remains visible for handoff review."],
      };
    case "unknown":
      return {
        goalMatch: "partial",
        evidenceSupport: "partial",
        constraintImpact: "blocking",
        constraintImpactBasis: `AI judgment found unresolved ${kind} candidate uncertainty.`,
        riskLevel: "blocking",
        riskCoverage: ["Unresolved candidate uncertainty requires follow-up."],
      };
    case "rejected":
      return {
        goalMatch: "weak",
        evidenceSupport: "weak",
        constraintImpact: "partial",
        constraintImpactBasis: `AI judgment rejected ${kind} candidate for this convergence round.`,
        riskLevel: "partial",
        riskCoverage: ["Rejected candidate remains as why-not evidence."],
      };
  }
}

function conclusionForJudgmentStatus(status: CandidateConvergenceStatus): CandidateComparisonConclusion {
  switch (status) {
    case "accepted":
      return "accept";
    case "merged":
      return "merge";
    case "unknown":
      return "keep_unknown";
    case "rejected":
      return "reject";
  }
}

function enrichComparisonsWithAdvisory(
  comparisons: CandidateComparison[],
  advisory?: UndergroundConvergenceAiAdvisory
): CandidateComparison[] {
  if (advisory === undefined || advisory.status !== "completed") {
    return comparisons;
  }
  const analysisByCandidateId = new Map(
    advisory.candidateAnalyses.map((analysis) => [analysis.candidateId, analysis])
  );
  return comparisons.map((comparison) => {
    const analysis = analysisByCandidateId.get(comparison.candidateId);
    if (analysis === undefined) {
      return comparison;
    }
    return {
      ...comparison,
      contentDifference: analysis.contentDifference || comparison.contentDifference,
      whyPreferred: analysis.whyPreferred || comparison.whyPreferred,
      conflictWith: analysis.conflictWith.length > 0 ? [...analysis.conflictWith] : comparison.conflictWith,
    };
  });
}

function autonomyTerminalShape(
  decision: UndergroundAutonomyDecision,
  pool: CandidatePool
): {
  readonly decisionStatusByCandidateId: ReadonlyMap<string, CandidateConvergenceDecision["status"]>;
  readonly clarificationCandidateIds: readonly string[];
  readonly forceTerminalReason?: NonNullable<UndergroundConvergenceReport["stopReason"]>;
  readonly stopReason?: NonNullable<UndergroundConvergenceReport["stopReason"]>;
  readonly summary: string;
} {
  const candidateIds = pool.candidates.map((candidate) => candidate.id);
  if (decision.status === "completed" && decision.action === "request_user_clarification") {
    const clarificationCandidateIds = candidateIdsFromAutonomyRefs(decision, pool);
    return {
      decisionStatusByCandidateId: new Map(
        clarificationCandidateIds.map((candidateId) => [candidateId, "unknown" as const])
      ),
      clarificationCandidateIds,
      summary: "Autonomy core requested user clarification before Convergence Judge could approve a handoff.",
    };
  }

  const stopReason = decision.stopReason ?? (decision.status === "failed" ? "autonomy_decision_failed" : "autonomy_stopped");
  return {
    decisionStatusByCandidateId: new Map(candidateIds.map((candidateId) => [candidateId, "rejected" as const])),
    clarificationCandidateIds: [],
    forceTerminalReason: stopReason,
    stopReason,
    summary:
      decision.status === "failed"
        ? `Autonomy core failed before requesting convergence; terminal stop reason ${stopReason}.`
        : `Autonomy core stopped exploration before requesting convergence; terminal stop reason ${stopReason}.`,
  };
}

function createAutonomyTerminalDecision(input: {
  decision: CandidateConvergenceDecision;
  autonomyDecision: UndergroundAutonomyDecision;
  terminalStatus: CandidateConvergenceDecision["status"];
  forceTerminalReason?: NonNullable<UndergroundConvergenceReport["stopReason"]>;
}): CandidateConvergenceDecision {
  const terminalReason =
    input.forceTerminalReason === undefined
      ? "Autonomy requested user clarification before this candidate could be promoted."
      : `Autonomy terminal decision ${input.autonomyDecision.decisionId} stopped promotion with reason ${input.forceTerminalReason}.`;

  return {
    ...input.decision,
    status: input.terminalStatus,
    reason: input.terminalStatus === input.decision.status ? input.decision.reason : terminalReason,
    provenanceRefs: unique([
      ...input.decision.provenanceRefs,
      input.autonomyDecision.decisionId,
      ...input.autonomyDecision.sourceRefs,
      ...input.autonomyDecision.modelCallRefs.map((ref) => ref.requestId),
    ]),
    evidenceRefs: unique([
      ...input.decision.evidenceRefs,
      input.autonomyDecision.decisionId,
      ...input.autonomyDecision.sourceRefs,
      ...input.autonomyDecision.modelCallRefs.map((ref) => ref.requestId),
    ]),
  };
}

function candidateIdsFromAutonomyRefs(
  decision: UndergroundAutonomyDecision,
  pool: CandidatePool
): string[] {
  const candidateIds = new Set(pool.candidates.map((candidate) => candidate.id));
  const referenced = decision.sourceRefs.filter((ref) => candidateIds.has(ref));
  if (referenced.length > 0) {
    return [...new Set(referenced)];
  }
  return pool.candidates[0] === undefined ? [] : [pool.candidates[0].id];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
