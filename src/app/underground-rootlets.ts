import type { Constraint } from "../domain/contracts.js";
import {
  evidenceId,
  ROOTLET_CLUSTER_KINDS,
  selectRootletClusterKindsForGoalIntent,
  UNDERGROUND_CENTER_ROLES,
  type ExplorationBudget,
  type GoalIntentProfile,
  type RootletClusterKind,
  type RootletClusterPlan,
  type RootletOutput,
  type UndergroundExplorationPlan,
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

export function createMinimalUndergroundExplorationPlan(
  goalId: string,
  goalIntentProfile?: GoalIntentProfile
): UndergroundExplorationPlan {
  const selectedKinds =
    goalIntentProfile === undefined ? ROOTLET_CLUSTER_KINDS : selectRootletClusterKindsForGoalIntent(goalIntentProfile);
  const budget: ExplorationBudget = {
    maxRootletClusters: selectedKinds.length,
    maxCandidateOutputs: selectedKinds.length,
    spentRootletClusters: 0,
    spentCandidateOutputs: 0,
    exhausted: false,
  };

  return {
    planId: createId("underground-plan"),
    goalId,
    centerRoles: UNDERGROUND_CENTER_ROLES,
    budget,
    rootletClusters: selectedKinds.map((kind) => createRootletClusterPlan(kind, goalIntentProfile)),
    createdAt: goalIntentProfile?.createdAt ?? nowIso(),
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
  goalIntentProfile?: GoalIntentProfile;
}): RootletOutput[] {
  return input.plan.rootletClusters.map((cluster) => ({
    outputId: createId("rootlet-output"),
    clusterId: cluster.clusterId,
    kind: cluster.kind,
    producedByAgentId: input.producedByAgentId,
    summary: rootletSummary(cluster.kind, input.goalIntentProfile),
    sourceRefs: [evidenceId(input.plan.goalId, "goal-intent"), "goal.received", cluster.clusterId],
    evidenceRefs: rootletEvidenceRefs(input.plan.goalId, cluster.kind),
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

function createRootletClusterPlan(kind: RootletClusterKind, goalIntentProfile?: GoalIntentProfile): RootletClusterPlan {
  return {
    clusterId: `rootlet-${kind.replace("_", "-")}`,
    kind,
    stewardRole: roleForRootletKind(kind),
    objective: rootletObjective(kind, goalIntentProfile),
    inputRefs: [
      evidenceId(goalIntentProfile?.goalId ?? "compatibility-goal", "goal-intent"),
      "goal.received",
      "soil:minimal-constraints",
    ],
    exitCriteria: ROOTLET_EXIT_CRITERIA[kind],
    status: "planned",
    budget: { maxCandidateOutputs: 1 },
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

function rootletObjective(kind: RootletClusterKind, goalIntentProfile?: GoalIntentProfile): string {
  if (goalIntentProfile === undefined) {
    return ROOTLET_OBJECTIVES[kind];
  }
  return `${ROOTLET_OBJECTIVES[kind]} Goal: ${goalIntentProfile.goalStatement}`;
}

function rootletSummary(kind: RootletClusterKind, goalIntentProfile?: GoalIntentProfile): string {
  if (goalIntentProfile === undefined) {
    return ROOTLET_OBJECTIVES[kind];
  }
  switch (kind) {
    case "option":
      return `Direction option for ${goalIntentProfile.goalStatement}`;
    case "risk":
      return `Risk hints for ${goalIntentProfile.riskHints.join(", ") || goalIntentProfile.goalStatement}`;
    case "asset_fit":
      return `Soil asset fit refs for ${goalIntentProfile.goalStatement}`;
    case "evidence":
      return `Evidence needs for ${goalIntentProfile.acceptanceCriteria.join("; ")}`;
    case "constraint":
      return `Constraint hints for ${goalIntentProfile.constraintHints.join(", ") || goalIntentProfile.goalStatement}`;
    case "counterfactual":
      return `Why-not alternatives for ${goalIntentProfile.goalStatement}`;
  }
}

function rootletEvidenceRefs(goalId: string, kind: RootletClusterKind): string[] {
  const refs = [evidenceId(goalId, `rootlet:${kind}`)];
  if (kind === "option" || kind === "evidence") {
    refs.push(
      "docs/开发指南/06-工程实现/06-最小实现边界.md",
      "docs/开发指南/04-模型与契约/04-最小运行契约.md"
    );
  }
  return refs;
}
