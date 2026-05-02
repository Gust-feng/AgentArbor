import type { ConstraintRef } from "../constraints.js";
import type { UndergroundAgentClusterRun, UndergroundAgentInvocation } from "./agent-cluster.js";
import type { CandidateComparison } from "./candidate-comparison.js";
import type { ConvergenceReviewOutcome, ConvergenceStopReason } from "./contracts.js";
import type { UndergroundEvidenceLedger } from "./evidence-ledger.js";
import type { GoalIntentProfile } from "./intent-core.js";
import {
  classifyUnknownsForClarification,
  cloneOpenQuestionDisposition,
  cloneUserClarificationRequest,
  type OpenQuestionDisposition,
  type UserClarificationRequest,
} from "./clarification.js";
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
  invocationId: string;
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
  evidenceRefs?: string[];
};

export type UndergroundConvergenceOutcome = ConvergenceReviewOutcome;

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
  candidateComparisons?: CandidateComparison[];
  summary: string;
  outcome: UndergroundConvergenceOutcome;
  userEscalationRequired: boolean;
  userClarificationRequest?: UserClarificationRequest;
  openQuestions: OpenQuestionDisposition[];
  budgetExhausted: boolean;
  stopReason?: ConvergenceStopReason;
  handoffCandidateRefs: string[];
};

export type UndergroundExplorationReport = {
  plan: UndergroundExplorationPlan;
  agentClusterRun?: UndergroundAgentClusterRun;
  goalIntentProfile?: GoalIntentProfile;
  evidenceLedger?: UndergroundEvidenceLedger;
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
  agentInvocations: readonly UndergroundAgentInvocation[];
  candidates: readonly ExplorationCandidateRef[];
  updatedAt: string;
}): CandidatePool {
  assertRootletOutputsComeFromCompletedInvocations(input.rootletOutputs, input.agentInvocations);
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

function assertRootletOutputsComeFromCompletedInvocations(
  rootletOutputs: readonly RootletOutput[],
  agentInvocations: readonly UndergroundAgentInvocation[]
): void {
  const invocationById = new Map(agentInvocations.map((invocation) => [invocation.invocationId, invocation]));
  for (const output of rootletOutputs) {
    if (typeof output.invocationId !== "string" || output.invocationId.trim().length === 0) {
      throw new UndergroundConvergenceError(`Rootlet output ${output.outputId} must reference an agent invocation.`);
    }
    const invocation = invocationById.get(output.invocationId);
    if (invocation === undefined) {
      throw new UndergroundConvergenceError(
        `Rootlet output ${output.outputId} references unknown agent invocation: ${output.invocationId}.`
      );
    }
    if (invocation.role !== "rootlet_agent") {
      throw new UndergroundConvergenceError(
        `Rootlet output ${output.outputId} must come from a rootlet_agent invocation.`
      );
    }
    if (invocation.agentId !== output.producedByAgentId) {
      throw new UndergroundConvergenceError(
        `Rootlet output ${output.outputId} producer does not match invocation ${invocation.invocationId}.`
      );
    }
    if (invocation.status !== "completed" || !invocation.outputRefs.includes(output.outputId)) {
      throw new UndergroundConvergenceError(
        `Rootlet output ${output.outputId} cannot enter the candidate pool before its invocation completes.`
      );
    }
  }
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
  candidateComparisons?: readonly CandidateComparison[];
  provenanceRefs: string[];
  budget: ExplorationBudget;
  summary: string;
  openQuestionDispositions?: readonly OpenQuestionDisposition[];
  userClarificationRequestId?: string;
  createdAt?: string;
}): UndergroundConvergenceReport {
  assertDecisionRefs(input.candidatePool, input.decisions);
  const acceptedCandidateRefs = refsByStatus(input.decisions, "accepted");
  const mergedCandidateRefs = refsByStatus(input.decisions, "merged");
  const rejectedCandidateRefs = refsByStatus(input.decisions, "rejected");
  const unknownCandidateRefs = refsByStatus(input.decisions, "unknown");
  const clarificationClassification = classifyUnknownsForClarification({
    goalId: input.candidatePool.goalId,
    unknownCandidateRefs,
    dispositions: input.openQuestionDispositions,
    requestId: input.userClarificationRequestId ?? `${input.reviewId}:user-clarification`,
    createdAt: input.createdAt ?? input.candidatePool.updatedAt,
  });
  const userClarificationRequest = clarificationClassification.userClarificationRequest;
  const userEscalationRequired = userClarificationRequest !== undefined;
  const outcome = resolveConvergenceOutcome({
    acceptedCandidateRefs,
    mergedCandidateRefs,
    unknownCandidateRefs,
    blockingClarificationRefs: userClarificationRequest?.relatedCandidateRefs ?? [],
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
    decisions: input.decisions.map(cloneCandidateConvergenceDecision),
    candidateComparisons: (input.candidateComparisons ?? []).map(cloneCandidateComparison),
    summary: createConvergenceSummary(input.summary, {
      acceptedCandidateRefs,
      mergedCandidateRefs,
      rejectedCandidateRefs,
      unknownCandidateRefs,
      handoffCandidateRefs: [...acceptedCandidateRefs, ...mergedCandidateRefs],
    }),
    outcome: outcome.outcome,
    userEscalationRequired,
    userClarificationRequest:
      userClarificationRequest === undefined ? undefined : cloneUserClarificationRequest(userClarificationRequest),
    openQuestions: clarificationClassification.openQuestions.map(cloneOpenQuestionDisposition),
    budgetExhausted: input.budget.exhausted,
    stopReason: outcome.stopReason,
    handoffCandidateRefs: [...acceptedCandidateRefs, ...mergedCandidateRefs],
  };
}

export function resolveConvergenceOutcome(input: {
  acceptedCandidateRefs: readonly string[];
  mergedCandidateRefs: readonly string[];
  unknownCandidateRefs: readonly string[];
  blockingClarificationRefs?: readonly string[];
  budget: ExplorationBudget;
}): Pick<UndergroundConvergenceReport, "outcome" | "stopReason"> {
  if ((input.blockingClarificationRefs?.length ?? 0) > 0) {
    return { outcome: "awaiting_user", stopReason: "requires_user_clarification" };
  }

  if (input.acceptedCandidateRefs.length + input.mergedCandidateRefs.length > 0) {
    return { outcome: "approved" };
  }

  if (input.budget.exhausted) {
    return { outcome: "stopped", stopReason: "budget_exhausted_without_converged_candidates" };
  }

  return { outcome: "stopped", stopReason: "no_converged_candidates" };
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

function cloneCandidateConvergenceDecision(decision: CandidateConvergenceDecision): CandidateConvergenceDecision {
  return {
    ...decision,
    sourceCandidateRefs: [...decision.sourceCandidateRefs],
    provenanceRefs: [...decision.provenanceRefs],
    evidenceRefs: [...(decision.evidenceRefs ?? [])],
  };
}

function cloneCandidateComparison(comparison: CandidateComparison): CandidateComparison {
  return {
    ...comparison,
    unknowns: [...comparison.unknowns],
    whyNot: [...comparison.whyNot],
    evidenceRefs: [...comparison.evidenceRefs],
  };
}

function createConvergenceSummary(
  baseSummary: string,
  refs: {
    acceptedCandidateRefs: readonly string[];
    mergedCandidateRefs: readonly string[];
    rejectedCandidateRefs: readonly string[];
    unknownCandidateRefs: readonly string[];
    handoffCandidateRefs: readonly string[];
  }
): string {
  const handoffReason =
    refs.handoffCandidateRefs.length > 0
      ? `handoff candidates ${refs.handoffCandidateRefs.join(", ")} are accepted or merged`
      : "no accepted or merged handoff candidates exist";
  const reviewShape = [
    `accepted=${refs.acceptedCandidateRefs.length}`,
    `merged=${refs.mergedCandidateRefs.length}`,
    `rejected=${refs.rejectedCandidateRefs.length}`,
    `unknown=${refs.unknownCandidateRefs.length}`,
  ].join(", ");
  return `${baseSummary} Current direction is handoff-ready when ${handoffReason}; convergence shape: ${reviewShape}.`;
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
