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
  "autonomy_core",
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

const MAX_AI_ADVISORY_TEXT_LENGTH = 180;

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
  source: "ai" | "deterministic_fallback";
};

export type CandidatePoolCounts = {
  total: number;
  candidate: number;
  accepted: number;
  merged: number;
  rejected: number;
  unknown: number;
};

export type CandidatePoolByKind = Record<RootletClusterKind, ExplorationCandidateRef[]>;

export type CandidatePool = {
  poolId: string;
  goalId: string;
  sourceRootletOutputRefs: string[];
  candidates: ExplorationCandidateRef[];
  candidatesByKind: CandidatePoolByKind;
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
  evidenceRefs: string[];
};

export type RejectedCandidateRefWithReason = {
  candidateId: string;
  reason: string;
  provenanceRefs: string[];
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
  evidenceLedgerRef?: string;
  recommendedOptionId?: string;
  rejectedCandidateRefsWithReasons: RejectedCandidateRefWithReason[];
  userDecisionRequired: string[];
  abovegroundReferenceOptionIds: string[];
  summary: string;
  outcome: UndergroundConvergenceOutcome;
  userEscalationRequired: boolean;
  userClarificationRequest?: UserClarificationRequest;
  openQuestions: OpenQuestionDisposition[];
  budgetExhausted: boolean;
  stopReason?: ConvergenceStopReason;
  handoffCandidateRefs: string[];
  aiAdvisory?: UndergroundConvergenceAiAdvisory;
};

export type UndergroundConvergenceAiAdvisory = {
  readonly advisoryId: string;
  readonly recommendedOptionId?: string;
  readonly candidateAnalyses: readonly {
    readonly candidateId: string;
    readonly kind: string;
    readonly contentDifference: string;
    readonly whyPreferred: string;
    readonly conflictWith: readonly string[];
  }[];
  readonly conflictsNeedingUserInput: readonly string[];
  readonly constraintViolations: readonly string[];
  readonly overallDirectionSummary: string;
  readonly status: "completed" | "failed";
};

export type UndergroundExplorationReport = {
  plan: UndergroundExplorationPlan;
  agentClusterRun?: UndergroundAgentClusterRun;
  goalIntentProfile?: GoalIntentProfile;
  autonomy?: import("./autonomy.js").UndergroundAutonomyReview;
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
  const candidates = input.candidates.map((candidate) => ({ ...candidate }));
  return {
    poolId: input.poolId,
    goalId: input.goalId,
    sourceRootletOutputRefs: input.rootletOutputs.map((output) => output.outputId),
    candidates,
    candidatesByKind: groupCandidatesByRootletKind(candidates, input.rootletOutputs),
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
    candidatesByKind: updateCandidatesByKind(pool.candidatesByKind, candidates),
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
  evidenceLedgerRef?: string;
  provenanceRefs: string[];
  budget: ExplorationBudget;
  summary: string;
  openQuestionDispositions?: readonly OpenQuestionDisposition[];
  userClarificationRequestId?: string;
  aiAdvisory?: UndergroundConvergenceAiAdvisory;
  forcedStopReason?: ConvergenceStopReason;
  createdAt?: string;
}): UndergroundConvergenceReport {
  assertDecisionRefs(input.candidatePool, input.decisions);
  const comparisonByCandidateId = new Map(
    (input.candidateComparisons ?? []).map((comparison) => [comparison.candidateId, comparison])
  );
  const decisionByCandidateId = new Map(input.decisions.map((decision) => [decision.candidateId, decision]));
  const acceptedCandidateRefs = refsByStatus(input.decisions, "accepted");
  const mergedCandidateRefs = refsByStatus(input.decisions, "merged");
  const rejectedCandidateRefs = refsByStatus(input.decisions, "rejected");
  const unknownCandidateRefs = refsByStatus(input.decisions, "unknown");
  const handoffCandidateRefs = [...acceptedCandidateRefs, ...mergedCandidateRefs].filter((candidateId) =>
    isHandoffEligibleCandidate(candidateId, comparisonByCandidateId)
  );
  const recommendedOptionId = resolveRecommendedOptionId(input.decisions, comparisonByCandidateId);
  const abovegroundReferenceOptionIds = resolveAbovegroundReferenceOptionIds(
    input.decisions,
    comparisonByCandidateId,
    recommendedOptionId
  );
  const rejectedCandidateRefsWithReasons = rejectedCandidateRefs.map((candidateId) => {
    const decision = decisionByCandidateId.get(candidateId);
    return {
      candidateId,
      reason: decision?.reason ?? "Candidate was rejected by convergence review.",
      provenanceRefs: [...(decision?.provenanceRefs ?? [])],
    };
  });
  const clarificationClassification = classifyUnknownsForClarification({
    goalId: input.candidatePool.goalId,
    unknownCandidateRefs,
    dispositions: input.openQuestionDispositions,
    requestId: input.userClarificationRequestId ?? `${input.reviewId}:user-clarification`,
    createdAt: input.createdAt ?? input.candidatePool.updatedAt,
  });
  const userClarificationRequest = clarificationClassification.userClarificationRequest;
  const userEscalationRequired = userClarificationRequest !== undefined;
  const handoffAcceptedCandidateRefs = acceptedCandidateRefs.filter((candidateId) =>
    handoffCandidateRefs.includes(candidateId)
  );
  const handoffMergedCandidateRefs = mergedCandidateRefs.filter((candidateId) => handoffCandidateRefs.includes(candidateId));
  const outcome = resolveConvergenceOutcome({
    acceptedCandidateRefs: handoffAcceptedCandidateRefs,
    mergedCandidateRefs: handoffMergedCandidateRefs,
    unknownCandidateRefs,
    blockingClarificationRefs: userClarificationRequest?.relatedCandidateRefs ?? [],
    budget: input.budget,
  });
  const aiAdvisory = sanitizeConvergenceAiAdvisory({
    aiAdvisory: input.aiAdvisory,
    candidatePool: input.candidatePool,
    handoffCandidateRefs,
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
    conflictResolutionRefs: [...mergedCandidateRefs, ...rejectedCandidateRefs],
    provenanceRefs: input.provenanceRefs,
    decisions: input.decisions.map(cloneCandidateConvergenceDecision),
    candidateComparisons: (input.candidateComparisons ?? []).map(cloneCandidateComparison),
    evidenceLedgerRef: input.evidenceLedgerRef,
    recommendedOptionId,
    rejectedCandidateRefsWithReasons,
    userDecisionRequired: [...(userClarificationRequest?.relatedCandidateRefs ?? [])],
    abovegroundReferenceOptionIds,
    summary: createConvergenceSummary(input.summary, {
      acceptedCandidateRefs,
      mergedCandidateRefs,
      rejectedCandidateRefs,
      unknownCandidateRefs,
      handoffCandidateRefs,
    }),
    outcome: outcome.outcome,
    userEscalationRequired,
    userClarificationRequest:
      userClarificationRequest === undefined ? undefined : cloneUserClarificationRequest(userClarificationRequest),
    openQuestions: clarificationClassification.openQuestions.map(cloneOpenQuestionDisposition),
    budgetExhausted: input.budget.exhausted,
    stopReason: outcome.outcome === "stopped" ? input.forcedStopReason ?? outcome.stopReason : outcome.stopReason,
    handoffCandidateRefs,
    aiAdvisory,
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
    if (decision.evidenceRefs.length === 0) {
      throw new UndergroundConvergenceError(
        `Convergence decision ${decision.decisionId} must include evidence refs.`
      );
    }
  }
}

function sanitizeConvergenceAiAdvisory(input: {
  readonly aiAdvisory?: UndergroundConvergenceAiAdvisory;
  readonly candidatePool: CandidatePool;
  readonly handoffCandidateRefs: readonly string[];
}): UndergroundConvergenceAiAdvisory | undefined {
  if (input.aiAdvisory === undefined) {
    return undefined;
  }
  if (input.aiAdvisory.status !== "completed") {
    return {
      advisoryId: input.aiAdvisory.advisoryId,
      candidateAnalyses: [],
      conflictsNeedingUserInput: sanitizeUndergroundConvergenceAiAdvisoryTexts(input.aiAdvisory.conflictsNeedingUserInput),
      constraintViolations: sanitizeUndergroundConvergenceAiAdvisoryTexts(input.aiAdvisory.constraintViolations),
      overallDirectionSummary: "",
      status: "failed",
    };
  }

  const candidateIds = new Set(input.candidatePool.candidates.map((candidate) => candidate.id));
  const handoffCandidateIds = new Set(input.handoffCandidateRefs);
  const recommendedOptionId =
    input.aiAdvisory.recommendedOptionId !== undefined &&
    handoffCandidateIds.has(input.aiAdvisory.recommendedOptionId)
      ? input.aiAdvisory.recommendedOptionId
      : undefined;
  const unsafeRecommendation =
    input.aiAdvisory.recommendedOptionId !== undefined && recommendedOptionId === undefined;

  return {
    advisoryId: input.aiAdvisory.advisoryId,
    recommendedOptionId,
    candidateAnalyses: input.aiAdvisory.candidateAnalyses
      .filter((analysis) => candidateIds.has(analysis.candidateId))
      .map((analysis) => ({
        candidateId: analysis.candidateId,
        kind: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.kind),
        contentDifference: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.contentDifference),
        whyPreferred: sanitizeUndergroundConvergenceAiAdvisoryText(analysis.whyPreferred),
        conflictWith: sanitizeUndergroundConvergenceAiAdvisoryTexts(analysis.conflictWith),
      })),
    conflictsNeedingUserInput: sanitizeUndergroundConvergenceAiAdvisoryTexts(input.aiAdvisory.conflictsNeedingUserInput),
    constraintViolations: sanitizeUndergroundConvergenceAiAdvisoryTexts(input.aiAdvisory.constraintViolations),
    overallDirectionSummary: unsafeRecommendation
      ? ""
      : sanitizeUndergroundConvergenceAiAdvisoryText(input.aiAdvisory.overallDirectionSummary),
    status: "completed",
  };
}

export function sanitizeUndergroundConvergenceAiAdvisoryTexts(values: readonly string[]): string[] {
  return values.map(sanitizeUndergroundConvergenceAiAdvisoryText).filter((value) => value.length > 0);
}

export function sanitizeUndergroundConvergenceAiAdvisoryText(value: string): string {
  const redacted = redactSensitiveText(value.trim());
  if (redacted.length <= MAX_AI_ADVISORY_TEXT_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_AI_ADVISORY_TEXT_LENGTH - 3)}...`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted-secret]")
    .replace(/tvly-[A-Za-z0-9_-]{6,}/g, "[redacted-secret]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_ -]?key\s*[:=]\s*[^;\s]+/gi, "api key=[redacted-secret]")
    .replace(/token\s*[:=]\s*[^;\s]+/gi, "token=[redacted-token]");
}

function refsByStatus(
  decisions: readonly CandidateConvergenceDecision[],
  status: CandidateConvergenceStatus
): string[] {
  return decisions.filter((decision) => decision.status === status).map((decision) => decision.candidateId);
}

function emptyCandidatePoolByKind(): CandidatePoolByKind {
  return ROOTLET_CLUSTER_KINDS.reduce((result, kind) => {
    result[kind] = [];
    return result;
  }, {} as CandidatePoolByKind);
}

function groupCandidatesByRootletKind(
  candidates: readonly ExplorationCandidateRef[],
  rootletOutputs: readonly RootletOutput[]
): CandidatePoolByKind {
  const outputKindById = new Map(rootletOutputs.map((output) => [output.outputId, output.kind]));
  const grouped = emptyCandidatePoolByKind();
  for (const candidate of candidates) {
    const sourceKind = candidate.sourceRefs.map((sourceRef) => outputKindById.get(sourceRef)).find((kind) => kind !== undefined);
    if (sourceKind !== undefined) {
      grouped[sourceKind].push({ ...candidate });
    }
  }
  return grouped;
}

function updateCandidatesByKind(
  candidatesByKind: CandidatePoolByKind,
  candidates: readonly ExplorationCandidateRef[]
): CandidatePoolByKind {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const grouped = emptyCandidatePoolByKind();
  for (const kind of ROOTLET_CLUSTER_KINDS) {
    grouped[kind] = candidatesByKind[kind].flatMap((candidate) => {
      const updated = candidateById.get(candidate.id);
      return updated === undefined ? [] : [{ ...updated }];
    });
  }
  return grouped;
}

function isHandoffEligibleCandidate(
  candidateId: string,
  comparisonByCandidateId: ReadonlyMap<string, CandidateComparison>
): boolean {
  const comparison = comparisonByCandidateId.get(candidateId);
  if (comparison === undefined) {
    return true;
  }
  return comparison.rootletKind !== "risk" && comparison.rootletKind !== "counterfactual";
}

function resolveRecommendedOptionId(
  decisions: readonly CandidateConvergenceDecision[],
  comparisonByCandidateId: ReadonlyMap<string, CandidateComparison>
): string | undefined {
  return (
    findOptionDecision(decisions, comparisonByCandidateId, "accepted") ??
    findOptionDecision(decisions, comparisonByCandidateId, "merged")
  );
}

function findOptionDecision(
  decisions: readonly CandidateConvergenceDecision[],
  comparisonByCandidateId: ReadonlyMap<string, CandidateComparison>,
  status: CandidateConvergenceStatus
): string | undefined {
  return decisions.find((decision) => {
    const comparison = comparisonByCandidateId.get(decision.candidateId);
    return decision.status === status && comparison?.rootletKind === "option";
  })?.candidateId;
}

function resolveAbovegroundReferenceOptionIds(
  decisions: readonly CandidateConvergenceDecision[],
  comparisonByCandidateId: ReadonlyMap<string, CandidateComparison>,
  recommendedOptionId: string | undefined
): string[] {
  return decisions
    .filter((decision) => {
      const comparison = comparisonByCandidateId.get(decision.candidateId);
      return comparison?.rootletKind === "option" && decision.candidateId !== recommendedOptionId;
    })
    .map((decision) => decision.candidateId);
}

function cloneCandidateConvergenceDecision(decision: CandidateConvergenceDecision): CandidateConvergenceDecision {
  return {
    ...decision,
    sourceCandidateRefs: [...decision.sourceCandidateRefs],
    provenanceRefs: [...decision.provenanceRefs],
    evidenceRefs: [...decision.evidenceRefs],
  };
}

function cloneCandidateComparison(comparison: CandidateComparison): CandidateComparison {
  return {
    ...comparison,
    evidenceGaps: [...comparison.evidenceGaps],
    hardConstraintConflictRefs: [...comparison.hardConstraintConflictRefs],
    riskCoverage: [...comparison.riskCoverage],
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
