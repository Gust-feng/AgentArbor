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
import type {
  AgentSpec,
  CandidatePool,
  ChildAgentRun,
  DelegationDecision,
  ParentSynthesisResult,
  RootletClusterKind,
  UndergroundAgentInvocation,
  UndergroundAutonomyDecision,
  UndergroundAutonomyReview,
  UndergroundExplorationCycle,
  UndergroundExplorationPlan,
} from "../../domain/underground/index.js";
import { createId } from "../../kernel/id.js";

export const UNDERGROUND_CENTER_MANAGER_AGENT_ID = "underground-center-manager";

export function createManagerAgentSpec(createdAt: string): AgentSpec {
  return {
    specId: "underground-center-manager",
    agentId: UNDERGROUND_CENTER_MANAGER_AGENT_ID,
    displayName: "Underground Cognitive Runtime Manager",
    agentKind: "manager",
    role: "underground_center_manager",
    protocol: {
      inputs: [{ source: "mailbox", key: "goal.received", required: true }],
      outputs: [{ type: "AgentRunTree", payloadSchema: "underground.agent_run_tree.v1" }],
    },
    promptRef: "underground.center_manager.dynamic_delegation.v1",
    outputContractRef: "underground.agent_fabric.parent_control.v1",
    permissions: {
      allowModel: true,
      allowedTools: ["search", "read"],
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 3,
      maxToolRounds: 2,
      maxChildRuns: 12,
    },
    inputRefs: ["goal.received"],
    createdAt,
  };
}

export function createRootletChildRuns(input: {
  readonly parentAgentId: string;
  readonly startedPlan: UndergroundExplorationPlan;
  readonly runningInvocations: readonly UndergroundAgentInvocation[];
  readonly createdAt: string;
}): ChildAgentRun[] {
  return input.runningInvocations.flatMap((invocation) => {
    const cluster = input.startedPlan.rootletClusters.find((item) => rootletExplorerAgentId(item.kind) === invocation.agentId);
    if (cluster === undefined) {
      return [];
    }
    return [
      {
        childRunId: createId("child-agent-run"),
        parentAgentId: input.parentAgentId,
        spec: createRootletAgentSpec({
          agentId: invocation.agentId,
          kind: cluster.kind,
          clusterId: cluster.clusterId,
          inputRefs: invocation.inputRefs,
          createdAt: input.createdAt,
        }),
        status: "planned" as const,
        inputRefs: [...invocation.inputRefs],
        outputRefs: [],
        evidenceRefs: [],
        startedAt: input.createdAt,
      },
    ];
  });
}

export function createDelegationDecisionFromGrowth(input: {
  readonly parentAgentId: string;
  readonly startedPlan: UndergroundExplorationPlan;
  readonly runningInvocations: readonly UndergroundAgentInvocation[];
  readonly growthResult: {
    readonly dispatchDecision: string;
    readonly source: "ai" | "deterministic_fallback";
    readonly confidence: number;
    readonly reasoningTrace: readonly {
      readonly modelCallRefs: readonly string[];
      readonly toolCallRefs: readonly string[];
      readonly fallbackRefs: readonly string[];
      readonly uncertainty: string;
    }[];
  };
}): DelegationDecision {
  return {
    decisionId: createId("delegation-decision"),
    parentAgentId: input.parentAgentId,
    action: input.runningInvocations.length > 0 ? "spawn_children" : "stop",
    childSpecIds: input.startedPlan.rootletClusters.map((cluster) => `underground-rootlet-${cluster.kind}-${cluster.clusterId}`),
    childRunIds: [],
    inputRefs: [input.startedPlan.planId, ...input.startedPlan.rootletClusters.map((cluster) => cluster.clusterId)],
    rationale: input.growthResult.dispatchDecision,
    uncertainty:
      input.growthResult.reasoningTrace.at(-1)?.uncertainty ??
      "Delegation is bounded by rootlet cluster budget and parent synthesis.",
    source: input.growthResult.source,
    confidence: input.growthResult.confidence,
    reasoningTraceRefs: input.growthResult.reasoningTrace.flatMap((entry) => [
      ...entry.modelCallRefs,
      ...entry.toolCallRefs,
      ...entry.fallbackRefs,
    ]),
    createdAt: new Date().toISOString(),
  };
}

export function createParentSynthesisFromCandidatePool(input: {
  readonly parentAgentId: string;
  readonly childRuns: readonly ChildAgentRun[];
  readonly candidatePool: CandidatePool;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTraceRefs: readonly string[];
}): ParentSynthesisResult {
  const synthesisId = createId("parent-synthesis");
  const candidateRefs = input.candidatePool.candidates.map((candidate) => candidate.id);
  return {
    synthesisId,
    parentAgentId: input.parentAgentId,
    childRunIds: input.childRuns.map((run) => run.childRunId),
    inputRefs: [input.candidatePool.poolId, ...input.childRuns.flatMap((run) => run.outputRefs)],
    retainedMaterialRefs: candidateRefs,
    rejectedMaterialRefs: input.candidatePool.candidates
      .filter((candidate) => candidate.status === "rejected")
      .map((candidate) => candidate.id),
    conflictRefs: input.candidatePool.candidates
      .filter((candidate) => candidate.status === "unknown")
      .map((candidate) => candidate.id),
    outputRefs: [synthesisId, input.candidatePool.poolId],
    nextAction: candidateRefs.length > 0 ? "request_convergence" : "stop",
    decisionSummary:
      `Parent synthesis collected ${candidateRefs.length} candidate material item(s) from ${input.childRuns.length} child agent run(s).`,
    uncertainty:
      "Child outputs remain local material; Convergence Judge must still decide retain, merge, reject, clarify, continue, or stop before Plan creation.",
    source: input.source,
    confidence: input.confidence,
    reasoningTraceRefs: [...input.reasoningTraceRefs],
    createdAt: new Date().toISOString(),
  };
}

export function createExplorationPlanFromAutonomyDecision(input: {
  readonly previousPlan: UndergroundExplorationPlan;
  readonly decision: UndergroundAutonomyDecision;
  readonly goalId: string;
}): UndergroundExplorationPlan {
  const requests = input.decision.spawnRequests;
  if (requests.length === 0) {
    return input.previousPlan;
  }
  const maxCandidateOutputs = input.previousPlan.budget.maxCandidateOutputs;
  return {
    planId: createId("underground-exploration-plan"),
    goalId: input.goalId,
    centerRoles: input.previousPlan.centerRoles,
    budget: {
      maxRootletClusters: requests.length,
      maxCandidateOutputs,
      spentRootletClusters: 0,
      spentCandidateOutputs: 0,
      exhausted: false,
    },
    rootletClusters: requests.map((request) => ({
      clusterId: createId(`rootlet-cluster-${request.rootletKind}`),
      kind: request.rootletKind,
      stewardRole: "autonomy_core",
      objective: request.objective,
      inputRefs: [input.previousPlan.planId, input.decision.decisionId, request.requestId],
      exitCriteria:
        request.expectedEvidence.length > 0
          ? [...request.expectedEvidence]
          : ["Produce local material for parent synthesis; do not approve Plan."],
      status: "planned",
      budget: { maxCandidateOutputs },
    })),
    createdAt: new Date().toISOString(),
  };
}

export function createExplorationCycle(
  cycleIndex: number,
  startedPlan: UndergroundExplorationPlan,
  candidatePool?: CandidatePool,
): UndergroundExplorationCycle {
  return {
    explorationCycleId: createId("exploration-cycle"),
    cycleIndex,
    rootletKinds: startedPlan.rootletClusters.map((c) => c.kind),
    candidatePoolId: candidatePool?.poolId,
    spawnedRootletCount: startedPlan.rootletClusters.length,
    status: "running",
  };
}

export function createAutonomyReview(
  decisions: readonly UndergroundAutonomyDecision[] | undefined,
  cycles: readonly UndergroundExplorationCycle[] | undefined,
): UndergroundAutonomyReview | undefined {
  if (decisions === undefined || decisions.length === 0) {
    return undefined;
  }
  const latestDecision = decisions.at(-1);
  return {
    enabled: true,
    latestDecision,
    decisions: [...decisions],
    cycles: [...(cycles ?? [])],
    stopReason: latestDecision?.stopReason,
  };
}

function createRootletAgentSpec(input: {
  readonly agentId: string;
  readonly kind: RootletClusterKind;
  readonly clusterId: string;
  readonly inputRefs: readonly string[];
  readonly createdAt: string;
}): AgentSpec {
  return {
    specId: `underground-rootlet-${input.kind}-${input.clusterId}`,
    agentId: input.agentId,
    displayName: `Rootlet ${input.kind}`,
    agentKind: "rootlet",
    role: "rootlet_agent",
    rootletKind: input.kind,
    protocol: {
      inputs: [
        { source: "workspace", key: "startedPlan", required: true },
        { source: "workspace", key: "rootletClusters", required: true },
        { source: "workspace", key: "runningRootletInvocations", required: true },
      ],
      outputs: [{ type: "rootlet_output", payloadSchema: "underground.rootlet_explorer.output.v1" }],
    },
    promptRef: `underground.rootlet.${input.kind}.v1`,
    outputContractRef: `underground.rootlet_candidate.${input.kind}.v1`,
    permissions: {
      allowModel: true,
      allowedTools: ["search", "read"],
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "deterministic",
    },
    budget: {
      maxModelRounds: 3,
      maxToolRounds: 2,
      maxOutputRefs: 3,
    },
    inputRefs: [...input.inputRefs],
    createdAt: input.createdAt,
  };
}

function rootletExplorerAgentId(kind: RootletClusterKind): string {
  return `rootlet-explorer-${kind.replace("_", "-")}`;
}
