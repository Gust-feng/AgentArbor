import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCandidateConvergenceDecisions,
  assertHandoffSourceCandidates,
  createCandidatePool,
  createOpenQuestionDisposition,
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
      blockingClarificationRefs: ["candidate-needs-user"],
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

test("non-blocking unknown without handoff candidates stops when budget is exhausted", () => {
  const output = makeRootletOutput("output-risk", "rootlet-risk");
  const candidate = makeCandidate("candidate-open-only", output);
  const pool = createCandidatePool({
    poolId: "pool-open-only",
    goalId: "goal-open-only",
    rootletOutputs: [output],
    candidates: [candidate],
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const decisions: CandidateConvergenceDecision[] = [
    makeDecision("decision-open-only", candidate.id, "unknown"),
  ];
  const convergedPool = applyCandidateConvergenceDecisions(pool, decisions, "2026-05-01T00:00:01.000Z");
  const report = createUndergroundConvergenceReport({
    reviewId: "review-open-only",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    candidatePool: convergedPool,
    decisions,
    provenanceRefs: ["candidate_pool.updated"],
    budget: { ...BASE_BUDGET, exhausted: true },
    summary: "non-blocking unknown without handoff candidates",
    openQuestionDispositions: [
      createOpenQuestionDisposition({
        candidateId: candidate.id,
        reason: "critical_fact_missing",
        question: "This question remains open and cannot approve a handoff candidate.",
        blockingLevel: "non_blocking",
      }),
    ],
    createdAt: "2026-05-01T00:00:02.000Z",
  });

  assert.equal(report.outcome, "stopped");
  assert.equal(report.stopReason, "budget_exhausted_without_converged_candidates");
  assert.equal(report.userEscalationRequired, false);
  assert.equal(report.userClarificationRequest, undefined);
  assert.equal(report.openQuestions[0]?.disposition, "remain_open");
  assert.deepEqual(report.handoffCandidateRefs, []);
});

test("blocking unknown candidate creates a user clarification request", () => {
  const outputs = [
    makeRootletOutput("output-a", "rootlet-option"),
    makeRootletOutput("output-b", "rootlet-constraint"),
  ];
  const candidates = outputs.map((output, index) => makeCandidate(`candidate-${index + 1}`, output));
  const pool = createCandidatePool({
    poolId: "pool-blocking",
    goalId: "goal-blocking",
    rootletOutputs: outputs,
    candidates,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const decisions: CandidateConvergenceDecision[] = [
    makeDecision("decision-a", "candidate-1", "accepted"),
    makeDecision("decision-b", "candidate-2", "unknown"),
  ];
  const convergedPool = applyCandidateConvergenceDecisions(pool, decisions, "2026-05-01T00:00:01.000Z");
  const report = createUndergroundConvergenceReport({
    reviewId: "review-blocking",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    candidatePool: convergedPool,
    decisions,
    provenanceRefs: ["candidate_pool.updated"],
    budget: BASE_BUDGET,
    summary: "blocking unknown test",
    openQuestionDispositions: [
      createOpenQuestionDisposition({
        candidateId: "candidate-2",
        reason: "hard_constraint_unclear",
        question: "Which hard constraint applies before this direction can be approved?",
        blockingLevel: "blocking",
      }),
    ],
    userClarificationRequestId: "clarification-blocking",
    createdAt: "2026-05-01T00:00:02.000Z",
  });

  assert.equal(report.outcome, "awaiting_user");
  assert.equal(report.userEscalationRequired, true);
  assert.equal(report.userClarificationRequest?.requestId, "clarification-blocking");
  assert.equal(report.userClarificationRequest?.primaryReason, "hard_constraint_unclear");
  assert.deepEqual(report.userClarificationRequest?.relatedCandidateRefs, ["candidate-2"]);
  assert.equal(report.userClarificationRequest?.questions[0]?.blocking, true);
  assert.deepEqual(report.handoffCandidateRefs, ["candidate-1"]);
});

test("non-blocking unknown remains an open question without entering handoff candidates", () => {
  const outputs = [
    makeRootletOutput("output-a", "rootlet-option"),
    makeRootletOutput("output-b", "rootlet-risk"),
  ];
  const candidates = outputs.map((output, index) => makeCandidate(`candidate-${index + 1}`, output));
  const pool = createCandidatePool({
    poolId: "pool-open-question",
    goalId: "goal-open-question",
    rootletOutputs: outputs,
    candidates,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  const decisions: CandidateConvergenceDecision[] = [
    makeDecision("decision-a", "candidate-1", "accepted"),
    makeDecision("decision-b", "candidate-2", "unknown"),
  ];
  const convergedPool = applyCandidateConvergenceDecisions(pool, decisions, "2026-05-01T00:00:01.000Z");
  const report = createUndergroundConvergenceReport({
    reviewId: "review-open-question",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    candidatePool: convergedPool,
    decisions,
    provenanceRefs: ["candidate_pool.updated"],
    budget: BASE_BUDGET,
    summary: "non-blocking unknown test",
    openQuestionDispositions: [
      createOpenQuestionDisposition({
        candidateId: "candidate-2",
        reason: "critical_fact_missing",
        question: "This fact can remain open for later evidence enrichment.",
        blockingLevel: "non_blocking",
      }),
    ],
    userClarificationRequestId: "clarification-non-blocking",
    createdAt: "2026-05-01T00:00:02.000Z",
  });

  assert.equal(report.outcome, "approved");
  assert.equal(report.userEscalationRequired, false);
  assert.equal(report.userClarificationRequest, undefined);
  assert.equal(report.openQuestions[0]?.disposition, "remain_open");
  assert.equal(report.openQuestions[0]?.blockingLevel, "non_blocking");
  assert.deepEqual(report.handoffCandidateRefs, ["candidate-1"]);
  assert.equal(report.handoffCandidateRefs.includes("candidate-2"), false);
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
    openQuestions: [],
    budgetExhausted: false,
    handoffCandidateRefs: [...accepted, ...merged],
  };
}
