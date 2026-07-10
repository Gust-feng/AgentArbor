/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { Constraint } from "../../../domain/contracts.js";
import type {
  AgentActionOutput,
  AgentDecision,
  AgentLoop,
  AgentPercept,
  AgentProtocol,
  AgentRunContext,
  GoalIntentProfile,
  GuardedActionOutput,
  RootletClusterKind,
  RootletClusterPlan,
  UndergroundAgentInvocation,
  UndergroundExplorationPlan,
  WorkspaceSnapshot,
} from "../../../domain/underground/index.js";
import {
  acceptGuardedAction,
  createGuardViolation,
  rejectGuardedAction,
  ROOTLET_CLUSTER_KINDS,
  sanitizeUndergroundConvergenceAiAdvisoryText,
} from "../../../domain/underground/index.js";
import type { ModelMessage, ModelOutputContract } from "../../../domain/intelligence/index.js";
import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import {
  completeUndergroundAgentInvocation,
  startUndergroundAgentInvocation,
} from "../compat/underground-agent-cluster-runtime.js";
import { startRootletClusters } from "../primitives/underground-rootlets.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

export type GrowthGovernorWorkspaceData = Readonly<{
  explorationPlan?: UndergroundExplorationPlan;
  goalId?: string;
  rawGoal?: string;
  goalIntentProfile?: GoalIntentProfile;
}>;

export type GrowthGovernorWorkspaceSnapshot = WorkspaceSnapshot<GrowthGovernorWorkspaceData>;

export type GrowthGovernorCapabilities = {
  readonly constraints: readonly Constraint[];
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

export type GrowthGovernorPercept = AgentPercept & {
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly constraints: readonly Constraint[];
};

export type GrowthGovernorDecision = AgentDecision & {
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly goalId: string;
  readonly dispatchDecision: string;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type GrowthGovernorActionOutput = AgentActionOutput & {
  readonly startedPlan: UndergroundExplorationPlan;
  readonly runningRootletInvocations: UndergroundAgentInvocation[];
  readonly centerInvocations: UndergroundAgentInvocation[];
  readonly dispatchDecision: string;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

const GROWTH_GOVERNOR_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "explorationPlan", required: true },
    { source: "workspace", key: "goalId", required: true },
  ],
  outputs: [
    { type: "startedPlan", payloadSchema: "underground.growth_governor.started_plan.v1" },
    { type: "rootlet_invocations", payloadSchema: "underground.growth_governor.rootlet_invocations.v1" },
  ],
};

export class GrowthGovernorAgent
  implements
    AgentLoop<
      GrowthGovernorPercept,
      GrowthGovernorDecision,
      GrowthGovernorActionOutput,
      GrowthGovernorWorkspaceSnapshot,
      GrowthGovernorCapabilities
    >
{
  readonly agentId = "underground-growth-governor-loop";
  readonly protocol = GROWTH_GOVERNOR_PROTOCOL;

  observe(
    ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>
  ): GrowthGovernorPercept {
    const snapshot = ctx.workspace.snapshot();
    const explorationPlan = snapshot.data.explorationPlan;
    if (explorationPlan === undefined) {
      throw new Error("GrowthGovernorAgent requires an explorationPlan in the workspace.");
    }
    return {
      observedAt: new Date().toISOString(),
      inputRefs: [explorationPlan.planId],
      explorationPlan,
      goalId: snapshot.data.goalId ?? "",
      rawGoal: snapshot.data.rawGoal ?? "",
      goalIntentProfile: snapshot.data.goalIntentProfile,
      constraints: ctx.capabilities?.constraints ?? [],
    };
  }

  async reason(
    ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    percept: GrowthGovernorPercept
  ): Promise<GrowthGovernorDecision> {
    const fallback = createFallbackGrowthGovernorDecision(percept);
    const ai = await reasonWithAgentTurn({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: ctx.workspace.snapshot().traceId,
      goalId: percept.goalId,
      purpose: "growth_governance",
      outputContract: GROWTH_GOVERNOR_CONTRACT,
      callerRef: { kind: "goal", id: percept.goalId, label: "growth_governance" },
      inputRefs: [{ kind: "goal", id: percept.goalId }],
      inputRefIds: percept.inputRefs,
      messages: buildGrowthGovernorMessages(percept),
      constraints: percept.constraints,
      parse: (output) => parseGrowthGovernorOutput(output, percept.explorationPlan),
    });

    const value = ai.value ?? fallback;
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: fallback.dispatchDecision,
            inputRefs: percept.inputRefs,
            fallbackRefs: ["deterministic_fallback"],
          });
    return {
      decidedAt: new Date().toISOString(),
      rationaleRefs: [value.explorationPlan.planId, ...reasoningTraceRefs(reasoningTrace)],
      explorationPlan: value.explorationPlan,
      goalId: percept.goalId,
      dispatchDecision: value.dispatchDecision,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    _ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    decision: GrowthGovernorDecision
  ): GrowthGovernorActionOutput {
    const startedPlan = startRootletClusters(decision.explorationPlan);
    const growthInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "growth_governor",
      inputRefs: [decision.explorationPlan.planId],
    });
    const completedGrowthInvocation = completeUndergroundAgentInvocation(growthInvocation, [
      startedPlan.planId,
      ...startedPlan.rootletClusters.map((cluster) => cluster.clusterId),
    ]);
    const runningRootletInvocations = startedPlan.rootletClusters.map((cluster) =>
      startUndergroundAgentInvocation({
        agentId: rootletExplorerAgentId(cluster.kind),
        role: "rootlet_agent",
        inputRefs: [decision.goalId, startedPlan.planId, cluster.clusterId],
      })
    );
    return {
      outputRefs: [startedPlan.planId, ...startedPlan.rootletClusters.map((c) => c.clusterId)],
      startedPlan,
      runningRootletInvocations,
      centerInvocations: [completedGrowthInvocation],
      dispatchDecision: decision.dispatchDecision,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }

  guard(
    _ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    output: GrowthGovernorActionOutput
  ): GuardedActionOutput<GrowthGovernorActionOutput> {
    const violations = [];
    if (output.startedPlan.rootletClusters.length === 0) {
      violations.push(
        createGuardViolation({
          code: "GROWTH_GOVERNOR_NO_ROOTLET_CLUSTERS",
          message: "Started plan must have at least one rootlet cluster.",
          severity: "error",
        })
      );
    }
    if (output.runningRootletInvocations.length !== output.startedPlan.rootletClusters.length) {
      violations.push(
        createGuardViolation({
          code: "GROWTH_GOVERNOR_INVOCATION_MISMATCH",
          message: "Running rootlet invocations must match rootlet cluster count.",
          severity: "error",
        })
      );
    }
    if (output.startedPlan.budget.maxRootletClusters < output.startedPlan.rootletClusters.length) {
      violations.push(
        createGuardViolation({
          code: "GROWTH_GOVERNOR_CLUSTER_BUDGET_EXCEEDED",
          message: "Started plan rootlet clusters must not exceed maxRootletClusters.",
          severity: "error",
        })
      );
    }
    const validKinds = new Set<RootletClusterKind>(ROOTLET_CLUSTER_KINDS);
    for (const cluster of output.startedPlan.rootletClusters) {
      if (!validKinds.has(cluster.kind)) {
        violations.push(
          createGuardViolation({
            code: "GROWTH_GOVERNOR_INVALID_ROOTLET_KIND",
            message: `Started plan contains invalid rootlet kind ${cluster.kind}.`,
            severity: "error",
          })
        );
      }
      if (cluster.budget.maxCandidateOutputs <= 0) {
        violations.push(
          createGuardViolation({
            code: "GROWTH_GOVERNOR_INVALID_CLUSTER_CANDIDATE_BUDGET",
            message: `Rootlet cluster ${cluster.clusterId} must allow at least one candidate output.`,
            severity: "error",
          })
        );
      }
    }
    if (violations.length > 0) {
      return rejectGuardedAction({ output, violations });
    }
    return acceptGuardedAction(output);
  }
}

function rootletExplorerAgentId(kind: RootletClusterKind): string {
  return `rootlet-explorer-${kind.replace("_", "-")}`;
}

const GROWTH_GOVERNOR_CONTRACT: ModelOutputContract = {
  contractId: "underground.growth_governor.v1",
  outputKind: "explanation",
  format: "json_object",
  requiredFields: [
    "rootletKinds",
    "budget",
    "dispatchDecision",
    "decisionSummary",
    "uncertainty",
    "confidence",
  ],
  requiredStringFields: ["dispatchDecision", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["dispatchDecision", "decisionSummary", "uncertainty"],
    fieldTypes: {
      dispatchDecision: "string",
      decisionSummary: "string",
      uncertainty: "string",
    },
    maxFieldLength: 240,
  },
};

type GrowthGovernorReasonedPlan = {
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly dispatchDecision: string;
};

function createFallbackGrowthGovernorDecision(percept: GrowthGovernorPercept): GrowthGovernorReasonedPlan {
  return {
    explorationPlan: cloneExplorationPlan(percept.explorationPlan),
    dispatchDecision:
      "Growth Governor used deterministic fallback dispatch; rootlet outputs remain low-confidence material for parent convergence.",
  };
}

function buildGrowthGovernorMessages(percept: GrowthGovernorPercept): readonly ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor Underground Growth Governor.",
        "Decide which existing rootlet clusters should start, the bounded dispatch budget, and a short displayable dispatch decision.",
        "Return JSON only. Do not include chain-of-thought. Rootlet outputs are lower-layer material and cannot approve handoff.",
        "Engineering guards enforce schema, budget, rootlet kind validity, and hard boundaries.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal id: ${percept.goalId}`,
        `Raw goal: ${percept.rawGoal}`,
        `Goal statement: ${percept.goalIntentProfile?.goalStatement ?? "unknown"}`,
        `Available rootlet kinds: ${percept.explorationPlan.rootletClusters.map((cluster) => cluster.kind).join(", ")}`,
        `Current max rootlet clusters: ${percept.explorationPlan.budget.maxRootletClusters}`,
        `Current max candidate outputs: ${percept.explorationPlan.budget.maxCandidateOutputs}`,
        "Return fields: rootletKinds, budget { maxRootletClusters, maxCandidateOutputs }, dispatchDecision, decisionSummary, uncertainty, confidence.",
      ].join("\n"),
    },
  ];
}

function parseGrowthGovernorOutput(
  output: unknown,
  fallbackPlan: UndergroundExplorationPlan
): import("./reasoning.js").UndergroundReasoningParseResult<GrowthGovernorReasonedPlan> {
  const record = asRecord(output);
  const selectedKinds = normalizeRootletKinds(record.rootletKinds, fallbackPlan.rootletClusters);
  const budget = asRecord(record.budget);
  const maxRootletClusters = positiveIntegerOrUndefined(budget.maxRootletClusters);
  const limitedKinds = selectedKinds.slice(0, maxRootletClusters ?? selectedKinds.length);
  if (limitedKinds.length === 0) {
    return {
      ok: false,
      reason: "growth_governor:no_valid_rootlet_kinds",
      decisionSummary: "Growth Governor model output did not select any legal rootlet kind.",
      uncertainty: "No legal dispatch can be made from the model output.",
      confidence: 0.2,
    };
  }

  const explorationPlan = planWithSelectedRootletKinds(fallbackPlan, limitedKinds);
  return {
    ok: true,
    value: {
      explorationPlan,
      dispatchDecision:
        stringOrUndefined(record.dispatchDecision) ??
        `Dispatch ${limitedKinds.join(", ")} rootlet cluster(s) under existing budget guards.`,
    },
    decisionSummary:
      stringOrUndefined(record.decisionSummary) ??
      `Growth Governor selected ${limitedKinds.length} rootlet cluster(s).`,
    uncertainty: stringOrUndefined(record.uncertainty),
    confidence: numberOrUndefined(record.confidence),
  };
}

function planWithSelectedRootletKinds(
  plan: UndergroundExplorationPlan,
  selectedKinds: readonly RootletClusterKind[]
): UndergroundExplorationPlan {
  const selected = selectedKinds.flatMap((kind) => {
    const cluster = plan.rootletClusters.find((candidate) => candidate.kind === kind);
    return cluster === undefined ? [] : [cloneRootletCluster(cluster)];
  });
  const maxCandidateOutputs = selected.reduce((total, cluster) => total + cluster.budget.maxCandidateOutputs, 0);
  return {
    ...cloneExplorationPlan(plan),
    budget: {
      maxRootletClusters: selected.length,
      maxCandidateOutputs,
      spentRootletClusters: 0,
      spentCandidateOutputs: 0,
      exhausted: false,
    },
    rootletClusters: selected,
  };
}

function cloneExplorationPlan(plan: UndergroundExplorationPlan): UndergroundExplorationPlan {
  return {
    ...plan,
    centerRoles: [...plan.centerRoles],
    budget: { ...plan.budget },
    rootletClusters: plan.rootletClusters.map(cloneRootletCluster),
  };
}

function cloneRootletCluster(cluster: RootletClusterPlan): RootletClusterPlan {
  return {
    ...cluster,
    inputRefs: [...cluster.inputRefs],
    exitCriteria: [...cluster.exitCriteria],
    budget: { ...cluster.budget },
  };
}

function normalizeRootletKinds(value: unknown, availableClusters: readonly RootletClusterPlan[]): RootletClusterKind[] {
  const available = new Set(availableClusters.map((cluster) => cluster.kind));
  const valid = new Set<RootletClusterKind>(ROOTLET_CLUSTER_KINDS);
  if (!Array.isArray(value)) {
    return availableClusters.map((cluster) => cluster.kind);
  }
  return [...new Set(
    value.filter((item): item is RootletClusterKind =>
      typeof item === "string" && valid.has(item as RootletClusterKind) && available.has(item as RootletClusterKind)
    )
  )];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeUndergroundConvergenceAiAdvisoryText(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}
