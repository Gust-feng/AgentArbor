import type { Constraint } from "../domain/contracts.js";
import {
  evidenceId,
  ROOTLET_CLUSTER_KINDS,
  selectRootletClusterKindsForGoalIntent,
  UNDERGROUND_CENTER_ROLES,
  type ExplorationBudget,
  type GoalIntentProfile,
  type UndergroundAgentInvocation,
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

const ROOTLET_MAX_OUTPUTS: Record<RootletClusterKind, number> = {
  option: 3,
  risk: 3,
  asset_fit: 2,
  evidence: 3,
  constraint: 3,
  counterfactual: 2,
};

const ROOTLET_DETERMINISTIC_OUTPUTS: Record<RootletClusterKind, number> = {
  option: 2,
  risk: 2,
  asset_fit: 1,
  evidence: 2,
  constraint: 2,
  counterfactual: 1,
};

export function createMinimalUndergroundExplorationPlan(
  goalId: string,
  goalIntentProfile?: GoalIntentProfile
): UndergroundExplorationPlan {
  const selectedKinds =
    goalIntentProfile === undefined ? ROOTLET_CLUSTER_KINDS : selectRootletClusterKindsForGoalIntent(goalIntentProfile);
  const rootletClusters = selectedKinds.map((kind) => createRootletClusterPlan(kind, goalIntentProfile));
  const budget: ExplorationBudget = {
    maxRootletClusters: selectedKinds.length,
    maxCandidateOutputs: rootletClusters.reduce((total, cluster) => total + cluster.budget.maxCandidateOutputs, 0),
    spentRootletClusters: 0,
    spentCandidateOutputs: 0,
    exhausted: false,
  };

  return {
    planId: createId("underground-plan"),
    goalId,
    centerRoles: UNDERGROUND_CENTER_ROLES,
    budget,
    rootletClusters,
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
  rootletInvocations: readonly UndergroundAgentInvocation[];
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
}): RootletOutput[] {
  const invocationByRootletKind = new Map(
    input.rootletInvocations
      .filter((invocation) => invocation.role === "rootlet_agent")
      .map((invocation) => [rootletKindFromAgentId(invocation.agentId), invocation])
  );
  return input.plan.rootletClusters.flatMap((cluster) => {
    const invocation = invocationByRootletKind.get(cluster.kind);
    if (invocation === undefined) {
      throw new Error(`Missing rootlet agent invocation for cluster kind: ${cluster.kind}`);
    }
    return createRootletOutputsForInvocation({
      goalId: input.plan.goalId,
      cluster,
      invocation,
      constraints: input.constraints,
      goalIntentProfile: input.goalIntentProfile,
    });
  });
}

export function createRootletOutputsForInvocation(input: {
  goalId: string;
  cluster: RootletClusterPlan;
  invocation: UndergroundAgentInvocation;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  sourceRefs?: readonly string[];
}): RootletOutput[] {
  const maxOutputs = Math.max(0, input.cluster.budget.maxCandidateOutputs);
  return rootletSummaries(input.cluster.kind, input.goalIntentProfile)
    .slice(0, maxOutputs)
    .map((summary, index) =>
      createRootletOutputForInvocation({
        ...input,
        summary,
        sourceRefs: [...(input.sourceRefs ?? []), `rootlet-variant:${input.cluster.kind}:${index + 1}`],
        evidenceRefs: [evidenceId(input.goalId, `rootlet:${input.cluster.kind}:${index + 1}`)],
      })
    );
}

export function createRootletOutputForInvocation(input: {
  goalId: string;
  cluster: RootletClusterPlan;
  invocation: UndergroundAgentInvocation;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  summary?: string;
  sourceRefs?: readonly string[];
  evidenceRefs?: readonly string[];
}): RootletOutput {
  return {
    outputId: createId("rootlet-output"),
    invocationId: input.invocation.invocationId,
    clusterId: input.cluster.clusterId,
    kind: input.cluster.kind,
    producedByAgentId: input.invocation.agentId,
    summary: input.summary ?? rootletSummary(input.cluster.kind, input.goalIntentProfile),
    sourceRefs: [
      evidenceId(input.goalId, "goal-intent"),
      "goal.received",
      input.cluster.clusterId,
      input.invocation.invocationId,
      ...(input.sourceRefs ?? []),
    ],
    evidenceRefs: [...rootletEvidenceRefs(input.goalId, input.cluster.kind), ...(input.evidenceRefs ?? [])],
    soilAssetFitRefs: input.cluster.kind === "asset_fit" ? ["soil:minimal-constraints"] : [],
    constraintRefs:
      input.cluster.kind === "constraint"
        ? input.constraints.map((constraint) => ({
            constraintId: constraint.id,
            requiredLevel: constraint.level,
            enforcementGate: constraint.enforcementGate,
          }))
        : [],
    riskRefs: input.cluster.kind === "risk" ? ["risk-fake-agent-overreach"] : [],
    status: "produced",
  };
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
    budget: { maxCandidateOutputs: ROOTLET_MAX_OUTPUTS[kind] },
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
  return rootletSummaries(kind, goalIntentProfile)[0] ?? ROOTLET_OBJECTIVES[kind];
}

function rootletSummaries(kind: RootletClusterKind, goalIntentProfile?: GoalIntentProfile): string[] {
  if (goalIntentProfile === undefined) {
    return [ROOTLET_OBJECTIVES[kind]];
  }
  const targetCount = ROOTLET_DETERMINISTIC_OUTPUTS[kind];
  const goal = goalIntentProfile.goalStatement;
  switch (kind) {
    case "option":
      return [
        `Primary in-memory direction for ${goal}`,
        `Modular verification-first direction for ${goal}`,
        `Deferred persistence direction for ${goal}`,
      ].slice(0, targetCount);
    case "risk":
      return [
        `Risk source and impact for ${goalIntentProfile.riskHints[0] ?? goal}`,
        `Risk blocking assessment for ${goalIntentProfile.riskHints[1] ?? goal}`,
        `Risk mitigation boundary for ${goal}`,
      ].slice(0, targetCount);
    case "asset_fit":
      return [
        `Soil asset fit refs for ${goal}`,
        `Soil asset non-fit boundaries for ${goal}`,
      ].slice(0, targetCount);
    case "evidence":
      return [
        `Evidence candidate for ${goalIntentProfile.acceptanceCriteria[0] ?? goal}`,
        `Verification evidence candidate for ${goalIntentProfile.acceptanceCriteria[1] ?? goal}`,
        `Monitoring evidence candidate for ${goal}`,
      ].slice(0, targetCount);
    case "constraint":
      return [
        `Constraint mapping for ${goalIntentProfile.constraintHints[0] ?? goal}`,
        `Enforcement gate mapping for ${goalIntentProfile.constraintHints[1] ?? goal}`,
        `Constraint non-weakening check for ${goal}`,
      ].slice(0, targetCount);
    case "counterfactual":
      return [
        `Counterfactual why-not alternative for ${goal}`,
        `Counterfactual fallback direction for ${goal}`,
      ].slice(0, targetCount);
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

function rootletKindFromAgentId(agentId: string): RootletClusterKind | undefined {
  const prefix = "underground-rootlet-";
  if (!agentId.startsWith(prefix)) {
    return undefined;
  }
  const kind = agentId.slice(prefix.length).replace("-", "_");
  return ROOTLET_CLUSTER_KINDS.find((rootletKind) => rootletKind === kind);
}
