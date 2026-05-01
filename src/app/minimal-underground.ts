import type { Constraint } from "../domain/contracts.js";
import {
  applyCandidateConvergenceDecisions,
  createCandidatePool,
  createUndergroundConvergenceReport,
  ROOTLET_CLUSTER_KINDS,
  UNDERGROUND_CENTER_ROLES,
  type CandidateConvergenceDecision,
  type CandidatePool,
  type ExplorationBudget,
  type ExplorationCandidateRef,
  type RootletClusterKind,
  type RootletClusterPlan,
  type RootletOutput,
  type UndergroundConvergenceReport,
  type UndergroundExplorationPlan,
  type UndergroundExplorationReport,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";

const ROOTLET_OBJECTIVES: Record<RootletClusterKind, string> = {
  option: "Find a viable direction option.",
  risk: "Surface risks that should not be hidden in the handoff.",
  asset_fit: "Check fit with existing Soil references without copying Soil content.",
  evidence: "Collect evidence refs for the proposed direction.",
  constraint: "Map hard and soft constraints into handoff refs.",
  counterfactual: "Record a counterfactual that should not drive the first growth path.",
};

const ROOTLET_EXIT_CRITERIA: Record<RootletClusterKind, string[]> = {
  option: ["At least one direction option can be judged."],
  risk: ["At least one bounded risk is known."],
  asset_fit: ["Soil fit is expressed as refs only."],
  evidence: ["Evidence is expressed as refs only."],
  constraint: ["Constraint refs are mapped without weakening hard constraints."],
  counterfactual: ["A non-selected path is recorded for convergence review."],
};

export function createMinimalUndergroundExplorationPlan(goalId: string): UndergroundExplorationPlan {
  const budget: ExplorationBudget = {
    maxRootletClusters: ROOTLET_CLUSTER_KINDS.length,
    maxCandidateOutputs: ROOTLET_CLUSTER_KINDS.length,
    spentRootletClusters: 0,
    spentCandidateOutputs: 0,
    exhausted: false,
  };

  return {
    planId: createId("underground-plan"),
    goalId,
    centerRoles: UNDERGROUND_CENTER_ROLES,
    budget,
    rootletClusters: ROOTLET_CLUSTER_KINDS.map((kind) => createRootletClusterPlan(kind)),
    createdAt: nowIso(),
  };
}

export function startRootletClusters(plan: UndergroundExplorationPlan): UndergroundExplorationPlan {
  const rootletClusters = plan.rootletClusters.map((cluster) => ({
    ...cluster,
    status: "started" as const,
  }));

  return {
    ...plan,
    budget: {
      ...plan.budget,
      spentRootletClusters: rootletClusters.length,
      exhausted: rootletClusters.length >= plan.budget.maxRootletClusters,
    },
    rootletClusters,
  };
}

export function completeRootletClusters(plan: UndergroundExplorationPlan): UndergroundExplorationPlan {
  return {
    ...plan,
    rootletClusters: plan.rootletClusters.map((cluster) => ({
      ...cluster,
      status: "completed" as const,
    })),
  };
}

export function spendCandidateBudget(
  plan: UndergroundExplorationPlan,
  spentCandidateOutputs: number
): UndergroundExplorationPlan {
  return {
    ...plan,
    budget: {
      ...plan.budget,
      spentCandidateOutputs,
      exhausted:
        plan.budget.spentRootletClusters >= plan.budget.maxRootletClusters ||
        spentCandidateOutputs >= plan.budget.maxCandidateOutputs,
    },
  };
}

export function produceMinimalRootletOutputs(input: {
  plan: UndergroundExplorationPlan;
  producedByAgentId: string;
  constraints: Constraint[];
}): RootletOutput[] {
  return input.plan.rootletClusters.map((cluster) => ({
    outputId: createId("rootlet-output"),
    clusterId: cluster.clusterId,
    kind: cluster.kind,
    producedByAgentId: input.producedByAgentId,
    summary: rootletSummary(cluster.kind),
    sourceRefs: ["goal.received", cluster.clusterId],
    evidenceRefs: rootletEvidenceRefs(cluster.kind),
    soilAssetFitRefs: cluster.kind === "asset_fit" ? ["soil:minimal-constraints"] : [],
    constraintRefs:
      cluster.kind === "constraint"
        ? input.constraints.map((constraint) => ({
            constraintId: constraint.id,
            requiredLevel: constraint.level,
            enforcementGate: constraint.enforcementGate,
          }))
        : [],
    riskRefs: cluster.kind === "risk" ? ["risk-fake-agent-overreach"] : [],
    status: "produced",
  }));
}

export function createMinimalCandidatePool(input: {
  goalId: string;
  producedByAgentId: string;
  rootletOutputs: readonly RootletOutput[];
}): CandidatePool {
  const candidates = input.rootletOutputs.map((output) => createCandidateFromRootletOutput(output, input.producedByAgentId));
  return createCandidatePool({
    poolId: createId("candidate-pool"),
    goalId: input.goalId,
    rootletOutputs: input.rootletOutputs,
    candidates,
    updatedAt: nowIso(),
  });
}

export function convergeMinimalCandidatePool(input: {
  pool: CandidatePool;
  plan: UndergroundExplorationPlan;
  leadAgentId: string;
}): { candidatePool: CandidatePool; convergenceReport: UndergroundConvergenceReport } {
  const decisions = input.pool.candidates.map((candidate) => createMinimalConvergenceDecision(candidate));
  const candidatePool = applyCandidateConvergenceDecisions(input.pool, decisions, nowIso());
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: createId("convergence"),
    reviewedByAgentIds: [input.leadAgentId],
    leadAgentId: input.leadAgentId,
    candidatePool,
    decisions,
    provenanceRefs: ["goal.received", "candidate_pool.updated", "soil:minimal-constraints"],
    budget: {
      ...input.plan.budget,
      spentCandidateOutputs: candidatePool.candidates.length,
      exhausted:
        input.plan.budget.exhausted && candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
    },
    summary: "Minimal radial exploration converged option, evidence, asset-fit, and constraint candidates for handoff.",
  });

  return { candidatePool, convergenceReport };
}

export function createUndergroundExplorationReport(input: {
  plan: UndergroundExplorationPlan;
  rootletOutputs: RootletOutput[];
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): UndergroundExplorationReport {
  return {
    plan: input.plan,
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
      })),
    },
  };
}

function createRootletClusterPlan(kind: RootletClusterKind): RootletClusterPlan {
  return {
    clusterId: `rootlet-${kind.replace("_", "-")}`,
    kind,
    stewardRole: roleForRootletKind(kind),
    objective: ROOTLET_OBJECTIVES[kind],
    inputRefs: ["goal.received", "soil:minimal-constraints"],
    exitCriteria: ROOTLET_EXIT_CRITERIA[kind],
    status: "planned",
    budget: { maxCandidateOutputs: 1 },
  };
}

function createCandidateFromRootletOutput(
  output: RootletOutput,
  producedByAgentId: string
): ExplorationCandidateRef {
  return {
    id: createId("candidate"),
    kind: candidateKindForRootlet(output.kind),
    producedByAgentId,
    clusterId: output.clusterId,
    sourceRefs: [output.outputId],
    status: "candidate",
  };
}

function createMinimalConvergenceDecision(candidate: ExplorationCandidateRef): CandidateConvergenceDecision {
  const status = convergenceStatusForCluster(candidate.clusterId);
  return {
    decisionId: createId("convergence-decision"),
    candidateId: candidate.id,
    sourceCandidateRefs: [candidate.id],
    status,
    decidedByRole: "convergence_judge",
    reason: convergenceReason(status, candidate.clusterId),
    provenanceRefs: [...candidate.sourceRefs, "candidate_pool.updated"],
  };
}

function roleForRootletKind(kind: RootletClusterKind) {
  switch (kind) {
    case "option":
      return "intent_core";
    case "risk":
      return "growth_governor";
    case "asset_fit":
      return "handoff_steward";
    case "evidence":
      return "evidence_ledger";
    case "constraint":
      return "constraint_sentinel";
    case "counterfactual":
      return "convergence_judge";
  }
}

function candidateKindForRootlet(kind: RootletClusterKind): ExplorationCandidateRef["kind"] {
  switch (kind) {
    case "option":
    case "constraint":
      return "claim_candidate";
    case "asset_fit":
    case "evidence":
      return "evidence_candidate";
    case "risk":
    case "counterfactual":
      return "observation";
  }
}

function convergenceStatusForCluster(clusterId: string): CandidateConvergenceDecision["status"] {
  if (clusterId.includes("option") || clusterId.includes("evidence")) {
    return "accepted";
  }
  if (clusterId.includes("asset-fit") || clusterId.includes("constraint")) {
    return "merged";
  }
  return "rejected";
}

function convergenceReason(status: CandidateConvergenceDecision["status"], clusterId: string): string {
  if (status === "accepted") {
    return `${clusterId} directly supports the first handoff direction.`;
  }
  if (status === "merged") {
    return `${clusterId} is merged into the retained direction evidence.`;
  }
  if (status === "unknown") {
    return `${clusterId} requires user clarification before it can guide handoff.`;
  }
  return `${clusterId} is retained as review evidence but excluded from handoff input.`;
}

function rootletSummary(kind: RootletClusterKind): string {
  return ROOTLET_OBJECTIVES[kind];
}

function rootletEvidenceRefs(kind: RootletClusterKind): string[] {
  if (kind === "option" || kind === "evidence") {
    return [
      "docs/开发指南/06-工程实现/06-最小实现边界.md",
      "docs/开发指南/04-模型与契约/04-最小运行契约.md",
    ];
  }
  return [];
}
