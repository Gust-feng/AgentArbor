import type { DirectionHandoffPackageRef } from "../domain/agentarbor/direction-handoff-package.js";
import type { Constraint } from "../domain/contracts.js";
import type { IntelligenceChannel } from "../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentClusterTerminalStatus,
  UndergroundAgentInvocation,
  UndergroundAgentRole,
  UndergroundConvergenceAiAdvisory,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";
import { evidenceId } from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createUndergroundAgentClusterManifests, undergroundRootletAgentId } from "./agents/manifests.js";
import {
  completeRootletClusters,
  convergeMinimalCandidatePool,
  createGoalIntentProfileForMinimalUnderground,
  createMinimalCandidatePool,
  createMinimalUndergroundExplorationPlan,
  createUndergroundExplorationReport,
  produceMinimalRootletOutputs,
  spendCandidateBudget,
  startRootletClusters,
} from "./minimal-underground.js";
import { createRootletOutputsForInvocation } from "./underground-rootlets.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  createUndergroundRootletAgentTurnPolicy,
  requestUndergroundRootletCandidateAdvice,
} from "./underground-intelligence.js";
import { AgentTurnRuntime } from "../kernel/intelligence/index.js";
import {
  publishCandidatePoolUpdated,
  publishConvergenceReviewCompleted,
  publishExplorationCandidatesProduced,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "./underground-events.js";
import {
  requestConvergenceAiAdvisoryForCandidatePool,
  type ConvergenceAiAdvisory,
} from "./underground/convergence-intelligence.js";

type PreparedUndergroundAgentCluster = {
  readonly goalIntentProfile: GoalIntentProfile;
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly startedPlan: UndergroundExplorationPlan;
  readonly agentClusterPlan: UndergroundAgentClusterPlan;
  readonly centerInvocations: readonly UndergroundAgentInvocation[];
  readonly runningRootletInvocations: readonly UndergroundAgentInvocation[];
  readonly runningHandoffInvocation: UndergroundAgentInvocation;
};

export type RunUndergroundAgentClusterExplorationInput = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly rawGoal: string;
  readonly coordinatorAgentId?: string;
};

export type RunUndergroundAgentClusterExplorationWithIntelligenceInput =
  RunUndergroundAgentClusterExplorationInput & {
    readonly intelligenceChannel: IntelligenceChannel;
    readonly toolCenter?: ToolExecutionBroker;
  };

export type RunUndergroundAgentClusterExplorationResult = {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly undergroundReport: UndergroundExplorationReport;
  readonly agentClusterRun: UndergroundAgentClusterRun;
};

export function runUndergroundAgentClusterExploration(
  input: RunUndergroundAgentClusterExplorationInput
): RunUndergroundAgentClusterExplorationResult {
  const prepared = prepareUndergroundAgentCluster(input);
  const deterministicRootletOutputs = produceMinimalRootletOutputs({
    plan: prepared.startedPlan,
    rootletInvocations: prepared.runningRootletInvocations,
    constraints: input.runtime.constraints,
    goalIntentProfile: prepared.goalIntentProfile,
  });
  const completedRootletInvocations = completeUndergroundRootletInvocations(
    prepared.runningRootletInvocations,
    deterministicRootletOutputs
  );

  return completeUndergroundAgentClusterExploration({
    ...input,
    prepared,
    rootletOutputs: deterministicRootletOutputs,
    completedRootletInvocations,
  });
}

export async function runUndergroundAgentClusterExplorationWithIntelligence(
  input: RunUndergroundAgentClusterExplorationWithIntelligenceInput
): Promise<RunUndergroundAgentClusterExplorationResult> {
  const prepared = prepareUndergroundAgentCluster(input);
  const agentTurnRuntime = createClusterAgentTurnRuntime(input);
  const modelRootletOutputs = await requestModelRootletOutputs({
    ...input,
    prepared,
    agentTurnRuntime,
  });
  const completedRootletInvocations = completeUndergroundRootletInvocations(
    prepared.runningRootletInvocations,
    modelRootletOutputs
  );
  const candidatePool = createCandidatePoolForCompletedRootlets({
    goalId: input.goalId,
    rootletOutputs: modelRootletOutputs,
    invocations: [
      ...prepared.centerInvocations,
      ...completedRootletInvocations,
    ],
  });
  const aiAdvisory = await callConvergenceAdvisoryIfAvailable({
    ...input,
    prepared,
    agentTurnRuntime,
    rootletOutputs: modelRootletOutputs,
    candidatePool,
  });

  return completeUndergroundAgentClusterExploration({
    ...input,
    prepared,
    rootletOutputs: modelRootletOutputs,
    completedRootletInvocations,
    candidatePool,
    aiAdvisory,
  });
}

export function finalizeUndergroundAgentClusterRun(input: {
  readonly run: UndergroundAgentClusterRun;
  readonly terminalStatus: UndergroundAgentClusterTerminalStatus;
  readonly candidateRefs: readonly string[];
  readonly packageRef: DirectionHandoffPackageRef;
  readonly stopReason?: string;
}): UndergroundAgentClusterRun {
  const completedAt = nowIso();
  return {
    ...input.run,
    invocations: input.run.invocations.map((invocation) =>
      invocation.role === "handoff_steward" && invocation.status === "running"
        ? completeUndergroundAgentInvocation(invocation, [input.packageRef.packageId], completedAt)
        : cloneUndergroundAgentInvocation(invocation)
    ),
    terminalStatus: input.terminalStatus,
    candidateRefs: [...input.candidateRefs],
    packageRef: input.packageRef,
    completedAt,
    stopReason: input.stopReason,
  };
}

function prepareUndergroundAgentCluster(
  input: RunUndergroundAgentClusterExplorationInput
): PreparedUndergroundAgentCluster {
  ensureUndergroundAgentClusterManifests(input.runtime);
  const intentInvocation = startUndergroundAgentInvocation({
    agentId: "underground-intent-core",
    role: "intent_core",
    inputRefs: [input.goalId, "goal.received"],
  });
  const goalIntentProfile = createGoalIntentProfileForMinimalUnderground({
    goalId: input.goalId,
    rawGoal: input.rawGoal,
    constraints: input.runtime.constraints,
  });
  const completedIntentInvocation = completeUndergroundAgentInvocation(intentInvocation, [
    evidenceId(input.goalId, "goal-intent"),
  ]);
  const explorationPlan = createMinimalUndergroundExplorationPlan(input.goalId, goalIntentProfile);
  const agentClusterPlan = createUndergroundAgentClusterPlan({
    rawGoal: input.rawGoal,
    explorationPlan,
    goalIntentProfile,
  });
  publishUndergroundExplorationPlanned({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.coordinatorAgentId ?? "underground-analyzer",
    plan: explorationPlan,
    agentCluster: {
      plan: agentClusterPlan,
      invocations: [completedIntentInvocation],
    },
  });

  const growthInvocation = startUndergroundAgentInvocation({
    agentId: "underground-growth-governor",
    role: "growth_governor",
    inputRefs: [explorationPlan.planId, agentClusterPlan.planId],
  });
  const startedPlan = startRootletClusters(explorationPlan);
  const completedGrowthInvocation = completeUndergroundAgentInvocation(growthInvocation, [
    startedPlan.planId,
    ...startedPlan.rootletClusters.map((cluster) => cluster.clusterId),
  ]);
  const runningRootletInvocations = startedPlan.rootletClusters.map((cluster) =>
    startUndergroundAgentInvocation({
      agentId: undergroundRootletAgentId(cluster.kind),
      role: "rootlet_agent",
      inputRefs: [input.goalId, explorationPlan.planId, cluster.clusterId],
    })
  );
  publishRootletClustersStarted({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: "underground-growth-governor",
    plan: startedPlan,
    agentCluster: {
      plan: agentClusterPlan,
      invocations: [completedIntentInvocation, completedGrowthInvocation, ...runningRootletInvocations],
    },
  });

  return {
    goalIntentProfile,
    explorationPlan,
    startedPlan,
    agentClusterPlan,
    centerInvocations: [completedIntentInvocation, completedGrowthInvocation],
    runningRootletInvocations,
    runningHandoffInvocation: startUndergroundAgentInvocation({
      agentId: "underground-handoff-steward",
      role: "handoff_steward",
      inputRefs: [input.goalId, explorationPlan.planId],
    }),
  };
}

function completeUndergroundAgentClusterExploration(input: RunUndergroundAgentClusterExplorationInput & {
  readonly prepared: PreparedUndergroundAgentCluster;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly completedRootletInvocations: readonly UndergroundAgentInvocation[];
  readonly candidatePool?: CandidatePool;
  readonly aiAdvisory?: ConvergenceAiAdvisory;
}): RunUndergroundAgentClusterExplorationResult {
  const invocationsBeforeConvergence = [
    ...input.prepared.centerInvocations,
    ...input.completedRootletInvocations,
  ];
  publishExplorationCandidatesProduced({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: "underground-growth-governor",
    goalId: input.goalId,
    planId: input.prepared.startedPlan.planId,
    rootletOutputs: input.rootletOutputs,
    agentCluster: {
      plan: input.prepared.agentClusterPlan,
      invocations: invocationsBeforeConvergence,
    },
  });

  const candidatePool =
    input.candidatePool ??
    createCandidatePoolForCompletedRootlets({
      goalId: input.goalId,
      rootletOutputs: input.rootletOutputs,
      invocations: invocationsBeforeConvergence,
    });
  publishCandidatePoolUpdated({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: "underground-growth-governor",
    goalId: input.goalId,
    planId: input.prepared.startedPlan.planId,
    candidatePool,
    agentCluster: {
      plan: input.prepared.agentClusterPlan,
      invocations: invocationsBeforeConvergence,
    },
  });

  const convergenceInvocation = startUndergroundAgentInvocation({
    agentId: "underground-convergence-judge",
    role: "convergence_judge",
    inputRefs: [candidatePool.poolId],
  });
  const completedPlan = spendCandidateBudget(
    completeRootletClusters(input.prepared.startedPlan),
    input.rootletOutputs.length
  );
  const convergence = convergeDefaultUndergroundCandidatePool({
    goalId: input.goalId,
    agentId: convergenceInvocation.agentId,
    plan: completedPlan,
    goalIntentProfile: input.prepared.goalIntentProfile,
    constraints: input.runtime.constraints,
    rootletOutputs: input.rootletOutputs,
    candidatePool,
    aiAdvisory: input.aiAdvisory,
  });
  const completedConvergenceInvocation = completeUndergroundAgentInvocation(convergenceInvocation, [
    convergence.convergenceReport.reviewId,
  ]);
  const agentClusterRun: UndergroundAgentClusterRun = {
    runId: createId("underground-agent-cluster-run"),
    plan: input.prepared.agentClusterPlan,
    invocations: [
      ...invocationsBeforeConvergence,
      completedConvergenceInvocation,
      input.prepared.runningHandoffInvocation,
    ],
    terminalStatus: "running",
    candidateRefs: [...convergence.convergenceReport.handoffCandidateRefs],
    startedAt: input.prepared.centerInvocations[0]?.startedAt ?? nowIso(),
  };
  const undergroundReport = createUndergroundExplorationReport({
    plan: completedPlan,
    agentClusterRun,
    goalIntentProfile: input.prepared.goalIntentProfile,
    evidenceLedger: convergence.evidenceLedger,
    rootletOutputs: [...input.rootletOutputs],
    candidatePool: convergence.candidatePool,
    convergenceReport: convergence.convergenceReport,
  });
  publishConvergenceReviewCompleted({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: completedConvergenceInvocation.agentId,
    goalId: input.goalId,
    planId: completedPlan.planId,
    convergenceReport: convergence.convergenceReport,
    candidatePool: convergence.candidatePool,
    undergroundReport,
    agentCluster: {
      plan: input.prepared.agentClusterPlan,
      run: agentClusterRun,
      invocations: agentClusterRun.invocations,
    },
  });

  return {
    candidatePool: convergence.candidatePool,
    convergenceReport: convergence.convergenceReport,
    undergroundReport,
    agentClusterRun,
  };
}

export function convergeDefaultUndergroundCandidatePool(input: {
  readonly goalId: string;
  readonly agentId: string;
  readonly plan: UndergroundExplorationPlan;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly constraints: readonly Constraint[];
  readonly rootletOutputs: readonly RootletOutput[];
  readonly candidatePool: CandidatePool;
  readonly aiAdvisory?: UndergroundConvergenceAiAdvisory;
}): {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
} {
  return convergeMinimalCandidatePool({
    pool: input.candidatePool,
    plan: input.plan,
    leadAgentId: input.agentId,
    rootletOutputs: input.rootletOutputs,
    goalIntentProfile: input.goalIntentProfile,
    constraints: input.constraints,
    aiAdvisory: input.aiAdvisory,
  });
}

async function requestModelRootletOutputs(input: RunUndergroundAgentClusterExplorationWithIntelligenceInput & {
  readonly prepared: PreparedUndergroundAgentCluster;
  readonly agentTurnRuntime: AgentTurnRuntime;
}): Promise<RootletOutput[]> {
  const outputs: RootletOutput[] = [];
  for (const cluster of input.prepared.startedPlan.rootletClusters) {
    const invocation = input.prepared.runningRootletInvocations.find(
      (candidate) => candidate.agentId === undergroundRootletAgentId(cluster.kind)
    );
    if (invocation === undefined) {
      continue;
    }
    const manifest = input.runtime.registry.get(invocation.agentId);
    const modelAdvice = await requestUndergroundRootletCandidateAdvice({
      agentTurnRuntime: input.agentTurnRuntime,
      turnPolicy: createUndergroundRootletAgentTurnPolicy({
        basePolicy: manifest.turnPolicy,
        callerAgentId: invocation.agentId,
        traceId: input.traceId,
        goalId: input.goalId,
        kind: cluster.kind,
      }),
      traceId: input.traceId,
      goalId: input.goalId,
      goal: input.rawGoal,
      goalIntentProfile: input.prepared.goalIntentProfile,
      cluster,
      invocation,
      constraints: input.runtime.constraints,
    });
    if (modelAdvice.rootletOutputs.length > 0) {
      outputs.push(...modelAdvice.rootletOutputs.slice(0, cluster.budget.maxCandidateOutputs));
      continue;
    }
    outputs.push(
      ...createRootletOutputsForInvocation({
        goalId: input.goalId,
        cluster,
        invocation,
        constraints: input.runtime.constraints,
        goalIntentProfile: input.prepared.goalIntentProfile,
        sourceRefs: modelAdvice.fallbackSourceRefs,
      })
    );
  }
  return outputs;
}

export function createUndergroundAgentClusterPlan(input: {
  readonly rawGoal: string;
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly goalIntentProfile: GoalIntentProfile;
}): UndergroundAgentClusterPlan {
  const rootletKinds = input.explorationPlan.rootletClusters.map((cluster) => cluster.kind);
  const agents = [
    clusterPlanAgent({
      agentId: "underground-intent-core",
      role: "intent_core",
      inputRefs: [input.explorationPlan.goalId, "goal.received"],
      schedulingReason: "Shape the raw goal into a deterministic intent profile before rootlet scheduling.",
    }),
    clusterPlanAgent({
      agentId: "underground-growth-governor",
      role: "growth_governor",
      inputRefs: [input.explorationPlan.planId, evidenceId(input.explorationPlan.goalId, "goal-intent")],
      schedulingReason: "Bound underground growth budget and selected rootlet startup.",
    }),
    ...input.explorationPlan.rootletClusters.map((cluster) =>
      clusterPlanAgent({
        agentId: undergroundRootletAgentId(cluster.kind),
        role: "rootlet_agent",
        rootletKind: cluster.kind,
        inputRefs: [input.explorationPlan.planId, cluster.clusterId],
        schedulingReason: `Run ${cluster.kind} rootlet because goal intent selected it for this run.`,
      })
    ),
    clusterPlanAgent({
      agentId: "underground-candidate-pool",
      role: "candidate_pool",
      inputRefs: [input.explorationPlan.planId],
      schedulingReason: "Collect completed rootlet outputs into the only formal candidate pool before convergence.",
    }),
    clusterPlanAgent({
      agentId: "underground-autonomy-core",
      role: "autonomy_core",
      inputRefs: [input.explorationPlan.planId],
      schedulingReason: "Review the candidate pool and decide whether to continue exploration or request convergence.",
    }),
    clusterPlanAgent({
      agentId: "underground-convergence-judge",
      role: "convergence_judge",
      inputRefs: [input.explorationPlan.planId],
      schedulingReason: "Converge the candidate pool only after the autonomy core requests convergence.",
    }),
    clusterPlanAgent({
      agentId: "underground-handoff-steward",
      role: "handoff_steward",
      inputRefs: [input.explorationPlan.planId],
      schedulingReason: "Package only converged direction material at the .agentarbor handoff boundary.",
    }),
  ];

  return {
    planId: createId("underground-agent-cluster-plan"),
    goalId: input.explorationPlan.goalId,
    rawGoal: input.rawGoal,
    budget: { ...input.explorationPlan.budget },
    agents,
    rootletKinds,
    schedulingReasons: agents.map((agent) => agent.schedulingReason),
    createdAt: input.goalIntentProfile.createdAt,
  };
}

function clusterPlanAgent(input: {
  readonly agentId: string;
  readonly role: UndergroundAgentRole;
  readonly rootletKind?: string;
  readonly inputRefs: readonly string[];
  readonly schedulingReason: string;
}): UndergroundAgentClusterPlan["agents"][number] {
  return {
    agentId: input.agentId,
    role: input.role,
    rootletKind: input.rootletKind,
    inputRefs: [...input.inputRefs],
    schedulingReason: input.schedulingReason,
  };
}

export function ensureUndergroundAgentClusterManifests(runtime: MinimalRuntime): void {
  const existingIds = new Set(runtime.registry.list().map((manifest) => manifest.id));
  for (const manifest of createUndergroundAgentClusterManifests()) {
    if (!existingIds.has(manifest.id)) {
      runtime.registry.register(manifest);
      existingIds.add(manifest.id);
    }
  }
}

export function startUndergroundAgentInvocation(input: {
  readonly agentId: string;
  readonly role: UndergroundAgentRole;
  readonly inputRefs: readonly string[];
}): UndergroundAgentInvocation {
  return {
    invocationId: createId("underground-invocation"),
    agentId: input.agentId,
    role: input.role,
    inputRefs: [...input.inputRefs],
    outputRefs: [],
    status: "running",
    startedAt: nowIso(),
  };
}

export function completeUndergroundAgentInvocation(
  invocation: UndergroundAgentInvocation,
  outputRefs: readonly string[],
  completedAt = nowIso()
): UndergroundAgentInvocation {
  return {
    ...invocation,
    outputRefs: [...outputRefs],
    status: "completed",
    completedAt,
  };
}

export function completeUndergroundRootletInvocations(
  invocations: readonly UndergroundAgentInvocation[],
  rootletOutputs: readonly RootletOutput[]
): UndergroundAgentInvocation[] {
  return invocations.map((invocation) =>
    completeUndergroundAgentInvocation(
      invocation,
      rootletOutputs
        .filter((output) => output.invocationId === invocation.invocationId)
        .map((output) => output.outputId)
    )
  );
}

export function cloneUndergroundAgentInvocation(invocation: UndergroundAgentInvocation): UndergroundAgentInvocation {
  return {
    ...invocation,
    inputRefs: [...invocation.inputRefs],
    outputRefs: [...invocation.outputRefs],
  };
}

async function callConvergenceAdvisoryIfAvailable(input: RunUndergroundAgentClusterExplorationWithIntelligenceInput & {
  readonly prepared: PreparedUndergroundAgentCluster;
  readonly agentTurnRuntime: AgentTurnRuntime;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly candidatePool: CandidatePool;
}): Promise<ConvergenceAiAdvisory | undefined> {
  return requestConvergenceAiAdvisoryForCandidatePool({
    agentTurnRuntime: input.agentTurnRuntime,
    traceId: input.traceId,
    goalId: input.goalId,
    goal: input.rawGoal,
    goalIntentProfile: input.prepared.goalIntentProfile,
    candidatePool: input.candidatePool,
    rootletOutputs: input.rootletOutputs,
    constraints: input.runtime.constraints,
  });
}

function createClusterAgentTurnRuntime(input: RunUndergroundAgentClusterExplorationWithIntelligenceInput): AgentTurnRuntime {
  return new AgentTurnRuntime({
    intelligenceChannel: input.intelligenceChannel,
    toolCenter: input.toolCenter,
    publishToolEvent: (event) => input.runtime.bus.publish(event),
  });
}

function createCandidatePoolForCompletedRootlets(input: {
  readonly goalId: string;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly invocations: readonly UndergroundAgentInvocation[];
}): CandidatePool {
  return createMinimalCandidatePool({
    goalId: input.goalId,
    rootletOutputs: input.rootletOutputs,
    agentInvocations: input.invocations,
  });
}
