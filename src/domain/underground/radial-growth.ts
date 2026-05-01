import type { ConstraintRef } from "../constraints.js";
import type { ExplorationCandidateRef } from "./contracts.js";

export const UNDERGROUND_CENTER_ROLES = [
  "intent_core",
  "growth_governor",
  "constraint_sentinel",
  "evidence_ledger",
  "convergence_judge",
  "handoff_steward",
] as const;

export type UndergroundCenterRole = (typeof UNDERGROUND_CENTER_ROLES)[number];

export const ROOTLET_CLUSTER_KINDS = [
  "option",
  "risk",
  "asset_fit",
  "evidence",
  "constraint",
  "counterfactual",
] as const;

export type RootletClusterKind = (typeof ROOTLET_CLUSTER_KINDS)[number];

export type RootletClusterStatus = "planned" | "started" | "completed" | "skipped";

export type ExplorationBudget = {
  maxRootletClusters: number;
  maxCandidateOutputs: number;
  spentRootletClusters: number;
  spentCandidateOutputs: number;
  exhausted: boolean;
};

export type RootletClusterPlan = {
  clusterId: string;
  kind: RootletClusterKind;
  stewardRole: UndergroundCenterRole;
  objective: string;
  inputRefs: string[];
  exitCriteria: string[];
  status: RootletClusterStatus;
  budget: Pick<ExplorationBudget, "maxCandidateOutputs">;
};

export type UndergroundExplorationPlan = {
  planId: string;
  goalId: string;
  centerRoles: readonly UndergroundCenterRole[];
  budget: ExplorationBudget;
  rootletClusters: RootletClusterPlan[];
  createdAt: string;
};

export type RootletOutput = {
  outputId: string;
  clusterId: string;
  kind: RootletClusterKind;
  producedByAgentId: string;
  summary: string;
  sourceRefs: string[];
  evidenceRefs: string[];
  soilAssetFitRefs: string[];
  constraintRefs: ConstraintRef[];
  riskRefs: string[];
  status: "produced";
};

export type CandidatePoolCounts = {
  total: number;
  candidate: number;
  accepted: number;
  merged: number;
  rejected: number;
  unknown: number;
};

export type CandidatePool = {
  poolId: string;
  goalId: string;
  sourceRootletOutputRefs: string[];
  candidates: ExplorationCandidateRef[];
  counts: CandidatePoolCounts;
  updatedAt: string;
};

export type CandidateConvergenceStatus = Extract<
  ExplorationCandidateRef["status"],
  "accepted" | "merged" | "rejected" | "unknown"
>;

export type CandidateConvergenceDecision = {
  decisionId: string;
  candidateId: string;
  sourceCandidateRefs: string[];
  status: CandidateConvergenceStatus;
  decidedByRole: "convergence_judge";
  reason: string;
  provenanceRefs: string[];
};

export type UndergroundConvergenceOutcome = "approved" | "awaiting_user" | "stopped";

export type UndergroundConvergenceReport = {
  reviewId: string;
  reviewedByAgentIds: string[];
  leadAgentId: string;
  crossCheckedCandidateRefs: string[];
  deduplicatedCandidateRefs: string[];
  acceptedCandidateRefs: string[];
  mergedCandidateRefs: string[];
  rejectedCandidateRefs: string[];
  unknownCandidateRefs: string[];
  conflictResolutionRefs: string[];
  provenanceRefs: string[];
  decisions: CandidateConvergenceDecision[];
  summary: string;
  outcome: UndergroundConvergenceOutcome;
  userEscalationRequired: boolean;
  budgetExhausted: boolean;
  stopReason?: "budget_exhausted_without_converged_candidates" | "requires_user_clarification";
  handoffCandidateRefs: string[];
};

export type UndergroundExplorationReport = {
  plan: UndergroundExplorationPlan;
  rootletOutputs: RootletOutput[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
};

export class UndergroundConvergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundConvergenceError";
  }
}

export function countCandidatePool(candidates: readonly ExplorationCandidateRef[]): CandidatePoolCounts {
  const counts: CandidatePoolCounts = {
    total: candidates.length,
    candidate: 0,
    accepted: 0,
    merged: 0,
    rejected: 0,
    unknown: 0,
  };

  for (const candidate of candidates) {
    counts[candidate.status] += 1;
  }

  return counts;
}

export function createCandidatePool(input: {
  poolId: string;
  goalId: string;
  rootletOutputs: readonly RootletOutput[];
  candidates: readonly ExplorationCandidateRef[];
  updatedAt: string;
}): CandidatePool {
  assertRootletOutputsAreOnlyPoolSources(input.rootletOutputs, input.candidates);
  return {
    poolId: input.poolId,
    goalId: input.goalId,
    sourceRootletOutputRefs: input.rootletOutputs.map((output) => output.outputId),
    candidates: input.candidates.map((candidate) => ({ ...candidate })),
    counts: countCandidatePool(input.candidates),
    updatedAt: input.updatedAt,
  };
}

export function applyCandidateConvergenceDecisions(
  pool: CandidatePool,
  decisions: readonly CandidateConvergenceDecision[],
  updatedAt: string
): CandidatePool {
  const decisionByCandidateId = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const candidates = pool.candidates.map((candidate) => {
    const decision = decisionByCandidateId.get(candidate.id);
    return decision === undefined ? candidate : { ...candidate, status: decision.status };
  });

  return {
    ...pool,
    candidates,
    counts: countCandidatePool(candidates),
    updatedAt,
  };
}

export function createUndergroundConvergenceReport(input: {
  reviewId: string;
  reviewedByAgentIds: string[];
  leadAgentId: string;
  candidatePool: CandidatePool;
  decisions: readonly CandidateConvergenceDecision[];
  provenanceRefs: string[];
  budget: ExplorationBudget;
  summary: string;
}): UndergroundConvergenceReport {
  assertDecisionRefs(input.candidatePool, input.decisions);
  const acceptedCandidateRefs = refsByStatus(input.decisions, "accepted");
  const mergedCandidateRefs = refsByStatus(input.decisions, "merged");
  const rejectedCandidateRefs = refsByStatus(input.decisions, "rejected");
  const unknownCandidateRefs = refsByStatus(input.decisions, "unknown");
  const userEscalationRequired = unknownCandidateRefs.length > 0;
  const outcome = resolveConvergenceOutcome({
    acceptedCandidateRefs,
    mergedCandidateRefs,
    unknownCandidateRefs,
    budget: input.budget,
  });

  return {
    reviewId: input.reviewId,
    reviewedByAgentIds: input.reviewedByAgentIds,
    leadAgentId: input.leadAgentId,
    crossCheckedCandidateRefs: input.candidatePool.candidates.map((candidate) => candidate.id),
    deduplicatedCandidateRefs: [...acceptedCandidateRefs, ...mergedCandidateRefs],
    acceptedCandidateRefs,
    mergedCandidateRefs,
    rejectedCandidateRefs,
    unknownCandidateRefs,
    conflictResolutionRefs: mergedCandidateRefs,
    provenanceRefs: input.provenanceRefs,
    decisions: input.decisions.map((decision) => ({ ...decision, sourceCandidateRefs: [...decision.sourceCandidateRefs] })),
    summary: input.summary,
    outcome: outcome.outcome,
    userEscalationRequired,
    budgetExhausted: input.budget.exhausted,
    stopReason: outcome.stopReason,
    handoffCandidateRefs: [...acceptedCandidateRefs, ...mergedCandidateRefs],
  };
}

export function resolveConvergenceOutcome(input: {
  acceptedCandidateRefs: readonly string[];
  mergedCandidateRefs: readonly string[];
  unknownCandidateRefs: readonly string[];
  budget: ExplorationBudget;
}): Pick<UndergroundConvergenceReport, "outcome" | "stopReason"> {
  if (input.acceptedCandidateRefs.length + input.mergedCandidateRefs.length > 0) {
    return { outcome: "approved" };
  }

  if (input.unknownCandidateRefs.length > 0) {
    return { outcome: "awaiting_user", stopReason: "requires_user_clarification" };
  }

  if (input.budget.exhausted) {
    return { outcome: "stopped", stopReason: "budget_exhausted_without_converged_candidates" };
  }

  return { outcome: "awaiting_user", stopReason: "requires_user_clarification" };
}

export function selectHandoffSourceCandidates(
  pool: CandidatePool,
  convergenceReport: UndergroundConvergenceReport
): ExplorationCandidateRef[] {
  const candidateById = new Map(pool.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = convergenceReport.handoffCandidateRefs.map((candidateId) => {
    const candidate = candidateById.get(candidateId);
    if (candidate === undefined) {
      throw new UndergroundConvergenceError(`DirectionHandoffPackage input references missing candidate: ${candidateId}.`);
    }
    return candidate;
  });
  assertHandoffSourceCandidates(selected, convergenceReport);
  return selected.map((candidate) => ({ ...candidate, sourceRefs: [...candidate.sourceRefs] }));
}

export function assertHandoffSourceCandidates(
  candidates: readonly unknown[],
  convergenceReport: UndergroundConvergenceReport
): asserts candidates is ExplorationCandidateRef[] {
  const allowed = new Set(convergenceReport.handoffCandidateRefs);
  for (const candidate of candidates) {
    if (isRootletOutput(candidate)) {
      throw new UndergroundConvergenceError("RootletOutput cannot directly enter DirectionHandoffPackage input.");
    }
    if (!isExplorationCandidateRef(candidate)) {
      throw new UndergroundConvergenceError("DirectionHandoffPackage input must use ExplorationCandidateRef values.");
    }
    if ((candidate.status !== "accepted" && candidate.status !== "merged") || !allowed.has(candidate.id)) {
      throw new UndergroundConvergenceError(
        `DirectionHandoffPackage input contains a non-converged candidate: ${candidate.id}.`
      );
    }
  }
}

function assertRootletOutputsAreOnlyPoolSources(
  rootletOutputs: readonly RootletOutput[],
  candidates: readonly ExplorationCandidateRef[]
): void {
  const rootletOutputRefs = new Set(rootletOutputs.map((output) => output.outputId));
  for (const candidate of candidates) {
    if (!candidate.sourceRefs.some((sourceRef) => rootletOutputRefs.has(sourceRef))) {
      throw new UndergroundConvergenceError(
        `Candidate ${candidate.id} must reference the rootlet output that produced it.`
      );
    }
  }
}

function assertDecisionRefs(pool: CandidatePool, decisions: readonly CandidateConvergenceDecision[]): void {
  const candidateIds = new Set(pool.candidates.map((candidate) => candidate.id));
  for (const decision of decisions) {
    if (!candidateIds.has(decision.candidateId)) {
      throw new UndergroundConvergenceError(`Convergence decision references unknown candidate: ${decision.candidateId}.`);
    }
    if (decision.sourceCandidateRefs.length === 0 || !decision.sourceCandidateRefs.includes(decision.candidateId)) {
      throw new UndergroundConvergenceError(
        `Convergence decision ${decision.decisionId} must include its source candidate ref.`
      );
    }
  }
}

function refsByStatus(
  decisions: readonly CandidateConvergenceDecision[],
  status: CandidateConvergenceStatus
): string[] {
  return decisions.filter((decision) => decision.status === status).map((decision) => decision.candidateId);
}

function isRootletOutput(value: unknown): value is RootletOutput {
  return typeof value === "object" && value !== null && "outputId" in value && "clusterId" in value;
}

function isExplorationCandidateRef(value: unknown): value is ExplorationCandidateRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<Record<keyof ExplorationCandidateRef, unknown>>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    typeof record.producedByAgentId === "string" &&
    typeof record.clusterId === "string" &&
    Array.isArray(record.sourceRefs) &&
    typeof record.status === "string"
  );
}
