import type { Constraint } from "../domain/contracts.js";
import {
  applyCandidateConvergenceDecisions,
  compareCandidatesForGoal,
  createDefaultGoalIntentProfile,
  createOpenQuestionDisposition,
  createUndergroundConvergenceReport,
  evidenceId,
  sanitizeUndergroundConvergenceAiAdvisoryText,
  sanitizeUndergroundConvergenceAiAdvisoryTexts,
  type CandidateComparison,
  type CandidatePool,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundConvergenceAiAdvisory,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationPlan,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import {
  appendUndergroundConvergenceOutcomeEvidence,
  createMinimalUndergroundEvidenceLedger,
} from "./underground-evidence.js";

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
