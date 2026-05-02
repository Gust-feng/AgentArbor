import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";

export function createUndergroundExplorationReport(input: {
  plan: UndergroundExplorationPlan;
  goalIntentProfile?: GoalIntentProfile;
  evidenceLedger?: UndergroundEvidenceLedger;
  rootletOutputs: RootletOutput[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): UndergroundExplorationReport {
  return {
    plan: input.plan,
    goalIntentProfile: input.goalIntentProfile === undefined ? undefined : cloneGoalIntentProfile(input.goalIntentProfile),
    evidenceLedger: input.evidenceLedger === undefined ? undefined : cloneEvidenceLedger(input.evidenceLedger),
    rootletOutputs: input.rootletOutputs.map((output) => ({ ...output })),
    candidatePool: {
      ...input.candidatePool,
      sourceRootletOutputRefs: [...input.candidatePool.sourceRootletOutputRefs],
      candidates: input.candidatePool.candidates.map((candidate) => ({ ...candidate })),
    },
    convergenceReport: {
      ...input.convergenceReport,
      decisions: input.convergenceReport.decisions.map((decision) => ({
        ...decision,
        sourceCandidateRefs: [...decision.sourceCandidateRefs],
        provenanceRefs: [...decision.provenanceRefs],
        evidenceRefs: [...(decision.evidenceRefs ?? [])],
      })),
      candidateComparisons: (input.convergenceReport.candidateComparisons ?? []).map((comparison) => ({
        ...comparison,
        unknowns: [...comparison.unknowns],
        whyNot: [...comparison.whyNot],
        evidenceRefs: [...comparison.evidenceRefs],
      })),
    },
  };
}

function cloneGoalIntentProfile(profile: GoalIntentProfile): GoalIntentProfile {
  return {
    ...profile,
    keyConcepts: [...profile.keyConcepts],
    nonGoals: [...profile.nonGoals],
    acceptanceCriteria: [...profile.acceptanceCriteria],
    assumptions: [...profile.assumptions],
    riskHints: [...profile.riskHints],
    constraintHints: [...profile.constraintHints],
    unknowns: [...profile.unknowns],
  };
}

function cloneEvidenceLedger(ledger: UndergroundEvidenceLedger): UndergroundEvidenceLedger {
  return {
    ...ledger,
    entries: ledger.entries.map((entry) => ({
      ...entry,
      sourceRefs: [...entry.sourceRefs],
    })),
  };
}
