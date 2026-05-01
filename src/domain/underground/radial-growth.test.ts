import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCandidateConvergenceDecisions,
  assertHandoffSourceCandidates,
  createCandidatePool,
  createUndergroundConvergenceReport,
  resolveConvergenceOutcome,
  UndergroundConvergenceError,
  type CandidateConvergenceDecision,
  type ExplorationBudget,
  type ExplorationCandidateRef,
  type RootletOutput,
} from "./index.js";

const BASE_BUDGET: ExplorationBudget = {
  maxRootletClusters: 4,
  maxCandidateOutputs: 4,
  spentRootletClusters: 4,
  spentCandidateOutputs: 4,
  exhausted: false,
};

test("rootlet output cannot directly enter handoff source candidates", () => {
  const output = makeRootletOutput("output-direct", "rootlet-option");
  const report = createReport(["candidate-a"], []);

  assert.throws(
    () => assertHandoffSourceCandidates([output], report),
    UndergroundConvergenceError
  );
});

test("convergence decisions preserve accepted, merged, rejected, and unknown source refs", () => {
  const outputs = [
    makeRootletOutput("output-a", "rootlet-option"),
    makeRootletOutput("output-b", "rootlet-asset-fit"),
    makeRootletOutput("output-c", "rootlet-risk"),
    makeRootletOutput("output-d", "rootlet-counterfactual"),
  ];
  const candidates = outputs.map((output, index) => makeCandidate(`candidate-${index + 1}`, output));
  const pool = createCandidatePool({
    poolId: "pool-test",
    goalId: "goal-test",
    rootletOutputs: outputs,
    candidates,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const decisions: CandidateConvergenceDecision[] = [
    makeDecision("decision-a", "candidate-1", "accepted"),
    makeDecision("decision-b", "candidate-2", "merged"),
    makeDecision("decision-c", "candidate-3", "rejected"),
    makeDecision("decision-d", "candidate-4", "unknown"),
  ];
  const convergedPool = applyCandidateConvergenceDecisions(pool, decisions, "2026-05-01T00:00:01.000Z");
  const report = createUndergroundConvergenceReport({
    reviewId: "review-test",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    candidatePool: convergedPool,
    decisions,
    provenanceRefs: ["candidate_pool.updated"],
    budget: BASE_BUDGET,
    summary: "test convergence",
  });

  assert.deepEqual(convergedPool.counts, {
    total: 4,
    candidate: 0,
    accepted: 1,
    merged: 1,
    rejected: 1,
    unknown: 1,
  });
  assert.deepEqual(report.acceptedCandidateRefs, ["candidate-1"]);
  assert.deepEqual(report.mergedCandidateRefs, ["candidate-2"]);
  assert.deepEqual(report.rejectedCandidateRefs, ["candidate-3"]);
  assert.deepEqual(report.unknownCandidateRefs, ["candidate-4"]);
  assert.equal(report.decisions.every((decision) => decision.sourceCandidateRefs.includes(decision.candidateId)), true);
});

test("budget exhaustion resolves to approved, awaiting_user, or stopped with a reason", () => {
  const exhausted = { ...BASE_BUDGET, exhausted: true };

  assert.deepEqual(
    resolveConvergenceOutcome({
      acceptedCandidateRefs: ["candidate-a"],
      mergedCandidateRefs: [],
      unknownCandidateRefs: [],
      budget: exhausted,
    }),
    { outcome: "approved" }
  );
  assert.deepEqual(
    resolveConvergenceOutcome({
      acceptedCandidateRefs: [],
      mergedCandidateRefs: [],
      unknownCandidateRefs: ["candidate-needs-user"],
      budget: exhausted,
    }),
    { outcome: "awaiting_user", stopReason: "requires_user_clarification" }
  );
  assert.deepEqual(
    resolveConvergenceOutcome({
      acceptedCandidateRefs: [],
      mergedCandidateRefs: [],
      unknownCandidateRefs: [],
      budget: exhausted,
    }),
    { outcome: "stopped", stopReason: "budget_exhausted_without_converged_candidates" }
  );
});

function makeRootletOutput(outputId: string, clusterId: string): RootletOutput {
  return {
    outputId,
    clusterId,
    kind: clusterId.includes("asset") ? "asset_fit" : clusterId.includes("risk") ? "risk" : "option",
    producedByAgentId: "underground-analyzer",
    summary: "test output",
    sourceRefs: ["goal.received"],
    evidenceRefs: [],
    soilAssetFitRefs: [],
    constraintRefs: [],
    riskRefs: [],
    status: "produced",
  };
}

function makeCandidate(id: string, output: RootletOutput): ExplorationCandidateRef {
  return {
    id,
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: output.clusterId,
    sourceRefs: [output.outputId],
    status: "candidate",
  };
}

function makeDecision(
  decisionId: string,
  candidateId: string,
  status: CandidateConvergenceDecision["status"]
): CandidateConvergenceDecision {
  return {
    decisionId,
    candidateId,
    sourceCandidateRefs: [candidateId],
    status,
    decidedByRole: "convergence_judge",
    reason: "test decision",
    provenanceRefs: ["candidate_pool.updated"],
  };
}

function createReport(accepted: string[], merged: string[]) {
  return {
    reviewId: "review-test",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: [...accepted, ...merged],
    deduplicatedCandidateRefs: [...accepted, ...merged],
    acceptedCandidateRefs: accepted,
    mergedCandidateRefs: merged,
    rejectedCandidateRefs: [],
    unknownCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: [],
    decisions: [],
    summary: "test report",
    outcome: "approved" as const,
    userEscalationRequired: false,
    budgetExhausted: false,
    handoffCandidateRefs: [...accepted, ...merged],
  };
}
