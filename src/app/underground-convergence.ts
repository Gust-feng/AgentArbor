import type { Constraint } from "../domain/contracts.js";
import {
  applyCandidateConvergenceDecisions,
  compareCandidatesForGoal,
  createDefaultGoalIntentProfile,
  createUndergroundConvergenceReport,
  evidenceId,
  type CandidateComparison,
  type CandidatePool,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationPlan,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createMinimalUndergroundEvidenceLedger } from "./underground-evidence.js";

export function convergeMinimalCandidatePool(input: {
  pool: CandidatePool;
  plan: UndergroundExplorationPlan;
  leadAgentId: string;
  rootletOutputs: readonly RootletOutput[];
  goalIntentProfile?: GoalIntentProfile;
  constraints?: readonly Constraint[];
  evidenceLedger?: UndergroundEvidenceLedger;
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
  const decisions = comparisonResult.decisions;
  const candidatePool = applyCandidateConvergenceDecisions(input.pool, decisions, createdAt);
  const evidenceLedger = createMinimalUndergroundEvidenceLedger({
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
    provenanceRefs: [evidenceId(input.pool.goalId, "goal-intent"), "goal.received", "candidate_pool.updated"],
    budget: {
      ...input.plan.budget,
      spentCandidateOutputs: candidatePool.candidates.length,
      exhausted:
        input.plan.budget.exhausted && candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
    },
    summary: `Underground compared ${candidatePool.candidates.length} candidates against the goal intent profile.`,
  });

  return { candidatePool, convergenceReport, evidenceLedger, candidateComparisons: comparisonResult.comparisons };
}
