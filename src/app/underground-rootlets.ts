/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ② 确定性编排主线（线性函数式编排）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
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

export function createSpawnedRootletClusterPlan(input: {
  kind: RootletClusterKind;
  goalIntentProfile?: GoalIntentProfile;
  objective?: string;
  inputRefs?: readonly string[];
  exitCriteria?: readonly string[];
}): RootletClusterPlan {
  const base = createRootletClusterPlan(input.kind, input.goalIntentProfile);
  return {
    ...base,
    clusterId: createId(`rootlet-${input.kind.replace("_", "-")}-cycle`),
    objective: input.objective ?? rootletObjective(input.kind, input.goalIntentProfile),
    inputRefs: [...(input.inputRefs ?? base.inputRefs)],
    exitCriteria:
      input.exitCriteria === undefined || input.exitCriteria.length === 0
        ? ROOTLET_EXIT_CRITERIA[input.kind]
        : [...input.exitCriteria],
  };
}

export function createRootletOutputForInvocation(input: {
  goalId: string;
  cluster: RootletClusterPlan;
  invocation: UndergroundAgentInvocation;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  summary?: string;
  source?: RootletOutput["source"];
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
    evidenceRefs: unique([...(input.evidenceRefs ?? []), ...rootletEvidenceRefs(input.goalId, input.cluster.kind)]),
    soilAssetFitRefs: input.cluster.kind === "asset_fit" ? ["soil:minimal-constraints"] : [],
    constraintRefs:
      input.cluster.kind === "constraint"
        ? input.constraints.map((constraint) => ({
            constraintId: constraint.id,
            requiredLevel: constraint.level,
            enforcementGate: constraint.enforcementGate,
          }))
        : [],
    riskRefs: input.cluster.kind === "risk" ? rootletRiskRefs(input.goalId, input.goalIntentProfile) : [],
    status: "produced",
    source: input.source ?? "deterministic_fallback",
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
  const domain = goalDomainSummary(goalIntentProfile);
  const acceptance = goalIntentProfile.acceptanceCriteria[0] ?? "the stated user goal can be verified";
  const unknowns = goalIntentProfile.unknowns.length > 0
    ? goalIntentProfile.unknowns.join("; ")
    : "no blocking unknown has been identified yet";
  switch (kind) {
    case "option":
      return [
        `Direction option for ${goal}: shape the ${domain} desktop agent around explicit input intake, structured output, evidence refs, and Plan assumptions.`,
        `Verification-first option for ${goal}: keep the first growth path narrow, prove ${acceptance}, and defer unresolved integration choices to open questions.`,
        `Scoped handoff option for ${goal}: document target users, accepted inputs, generated outputs, validation gates, and Nutrient Request triggers before execution planning.`,
      ].slice(0, targetCount);
    case "risk":
      return [
        `Risk source for ${goal}: ${goalIntentProfile.riskHints[0] ?? domain} can distort the handoff if source data, authority, or review boundary is not explicit.`,
        `Risk blocking assessment for ${goal}: unresolved details (${unknowns}) must stay visible instead of being hidden inside an approved package.`,
        `Risk mitigation for ${goal}: require evidence refs, human escalation rules, and Aboveground validation gates before any generated agent is treated as reliable.`,
      ].slice(0, targetCount);
    case "asset_fit":
      return [
        `Soil asset fit for ${goal}: reuse only stable Soil refs and prior constraints that match ${domain}; do not copy asset body content into the handoff.`,
        `Soil asset non-fit boundary for ${goal}: if no governed asset covers ${domain}, mark the gap and let Aboveground request nutrients instead of inventing reusable capability.`,
      ].slice(0, targetCount);
    case "evidence":
      return [
        `Evidence candidate for ${goal}: cite source material, rootlet outputs, model/tool refs, and comparison evidence needed to prove ${acceptance}.`,
        `Verification evidence for ${goal}: the package must show how each key output maps back to the original goal concepts (${goalIntentProfile.keyConcepts.slice(0, 6).join(", ") || domain}).`,
        `Monitoring evidence for ${goal}: track unresolved assumptions, fallback material, and handoff validation results so Aboveground can decide whether to continue or request nutrients.`,
      ].slice(0, targetCount);
    case "constraint":
      return [
        `Constraint mapping for ${goal}: preserve user-stated boundaries and Soil constraints across direction_handoff, growth_plan, task_assignment, tool_execution, verification, fruit_governance, and soil_promotion gates.`,
        `Enforcement gate mapping for ${goal}: unresolved permission, data, evidence, or review constraints must remain candidate constraints until confirmed.`,
        `Constraint non-weakening check for ${goal}: no option may turn hard boundaries, evidence retention, or data authority requirements into optional preferences.`,
      ].slice(0, targetCount);
    case "counterfactual":
      return [
        `Counterfactual why-not for ${goal}: do not start by generating a generic agent scaffold before the ${domain} inputs, outputs, evidence boundaries, and validation gates are settled.`,
        `Counterfactual fallback for ${goal}: if core evidence or authority is missing, stop or request user clarification instead of approving an unrelated direction.`,
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

function rootletRiskRefs(goalId: string, goalIntentProfile?: GoalIntentProfile): string[] {
  const hints = goalIntentProfile?.riskHints ?? [];
  const refs = hints.length > 0 ? hints.map((hint) => `risk:${goalId}:${hint}`) : [`risk:${goalId}:handoff-quality`];
  return unique(refs);
}

function goalDomainSummary(goalIntentProfile: GoalIntentProfile): string {
  const genericConcepts = new Set([
    "agent",
    "agent_app",
    "application",
    "feature",
    "requirement",
    "system",
  ]);
  const domainConcepts = unique([...goalIntentProfile.domainConcepts, ...goalIntentProfile.keyConcepts])
    .filter((concept) => !genericConcepts.has(concept));
  if (domainConcepts.length === 0) {
    return "target-domain";
  }
  return domainConcepts.slice(0, 4).join("/");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function rootletKindFromAgentId(agentId: string): RootletClusterKind | undefined {
  const prefix = "underground-rootlet-";
  if (!agentId.startsWith(prefix)) {
    return undefined;
  }
  const kind = agentId.slice(prefix.length).replace("-", "_");
  return ROOTLET_CLUSTER_KINDS.find((rootletKind) => rootletKind === kind);
}
