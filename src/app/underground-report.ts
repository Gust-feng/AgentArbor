import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundAgentClusterRun,
  UndergroundAutonomyReview,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";

export function createUndergroundExplorationReport(input: {
  plan: UndergroundExplorationPlan;
  agentClusterRun?: UndergroundAgentClusterRun;
  goalIntentProfile?: GoalIntentProfile;
  autonomy?: UndergroundAutonomyReview;
  evidenceLedger?: UndergroundEvidenceLedger;
  rootletOutputs: RootletOutput[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): UndergroundExplorationReport {
  return {
    plan: input.plan,
    agentClusterRun: input.agentClusterRun === undefined ? undefined : cloneAgentClusterRun(input.agentClusterRun),
    goalIntentProfile: input.goalIntentProfile === undefined ? undefined : cloneGoalIntentProfile(input.goalIntentProfile),
    autonomy: input.autonomy === undefined ? undefined : cloneAutonomyReview(input.autonomy),
    evidenceLedger: input.evidenceLedger === undefined ? undefined : cloneEvidenceLedger(input.evidenceLedger),
    rootletOutputs: input.rootletOutputs.map((output) => ({ ...output })),
    candidatePool: {
      ...input.candidatePool,
      sourceRootletOutputRefs: [...input.candidatePool.sourceRootletOutputRefs],
      candidates: input.candidatePool.candidates.map((candidate) => ({ ...candidate })),
      candidatesByKind: {
        option: input.candidatePool.candidatesByKind.option.map((candidate) => ({ ...candidate })),
        risk: input.candidatePool.candidatesByKind.risk.map((candidate) => ({ ...candidate })),
        asset_fit: input.candidatePool.candidatesByKind.asset_fit.map((candidate) => ({ ...candidate })),
        evidence: input.candidatePool.candidatesByKind.evidence.map((candidate) => ({ ...candidate })),
        constraint: input.candidatePool.candidatesByKind.constraint.map((candidate) => ({ ...candidate })),
        counterfactual: input.candidatePool.candidatesByKind.counterfactual.map((candidate) => ({ ...candidate })),
      },
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
        evidenceGaps: [...comparison.evidenceGaps],
        hardConstraintConflictRefs: [...comparison.hardConstraintConflictRefs],
        riskCoverage: [...comparison.riskCoverage],
        unknowns: [...comparison.unknowns],
        whyNot: [...comparison.whyNot],
        evidenceRefs: [...comparison.evidenceRefs],
      })),
    },
  };
}

function cloneAutonomyReview(review: UndergroundAutonomyReview): UndergroundAutonomyReview {
  return {
    enabled: review.enabled,
    latestDecision: review.latestDecision === undefined ? undefined : cloneAutonomyDecision(review.latestDecision),
    decisions: review.decisions.map(cloneAutonomyDecision),
    cycles: review.cycles.map((cycle) => ({
      ...cycle,
      rootletKinds: [...cycle.rootletKinds],
    })),
    stopReason: review.stopReason,
  };
}

function cloneAutonomyDecision(
  decision: NonNullable<UndergroundAutonomyReview["latestDecision"]>
): NonNullable<UndergroundAutonomyReview["latestDecision"]> {
  return {
    ...decision,
    informationGaps: [...decision.informationGaps],
    spawnRequests: decision.spawnRequests.map((request) => ({
      ...request,
      informationNeeds: [...request.informationNeeds],
      sourceHints: [...request.sourceHints],
      expectedEvidence: [...request.expectedEvidence],
    })),
    sourceRefs: [...decision.sourceRefs],
    modelCallRefs: decision.modelCallRefs.map((ref) => ({
      ...ref,
      eventRefs: [...ref.eventRefs],
    })),
  };
}

function cloneAgentClusterRun(run: UndergroundAgentClusterRun): UndergroundAgentClusterRun {
  return {
    ...run,
    plan: {
      ...run.plan,
      budget: { ...run.plan.budget },
      agents: run.plan.agents.map((agent) => ({
        ...agent,
        inputRefs: [...agent.inputRefs],
      })),
      rootletKinds: [...run.plan.rootletKinds],
      schedulingReasons: [...run.plan.schedulingReasons],
    },
    invocations: run.invocations.map((invocation) => ({
      ...invocation,
      inputRefs: [...invocation.inputRefs],
      outputRefs: [...invocation.outputRefs],
    })),
    candidateRefs: [...run.candidateRefs],
    packageRef: run.packageRef === undefined ? undefined : { ...run.packageRef },
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
