import type {
  CandidatePool,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundAutonomyDecision,
  UndergroundConvergenceReport,
  UndergroundExplorationCycle,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
  AgentRunTree,
  AgentSpec,
  ChildAgentRun,
  DelegationDecision,
  ParentSynthesisResult,
} from "../domain/underground/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import type { MinimalRuntime } from "./runtime.js";

export function publishUndergroundExplorationPlanned(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  plan: UndergroundExplorationPlan;
  cycle?: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "underground.exploration_planned",
      intent: "plan_underground_exploration",
      payload: {
        planId: input.plan.planId,
        goalId: input.plan.goalId,
        budget: input.plan.budget,
        rootletClusters: input.plan.rootletClusters,
        centerRoles: input.plan.centerRoles,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishRootletClustersStarted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  plan: UndergroundExplorationPlan;
  cycle?: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "rootlet_cluster.started",
      intent: "start_rootlet_clusters",
      payload: {
        goalId: input.plan.goalId,
        planId: input.plan.planId,
        rootletClusters: input.plan.rootletClusters,
        budget: input.plan.budget,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishExplorationCandidatesProduced(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  goalId: string;
  planId: string;
  rootletOutputs: readonly RootletOutput[];
  cycle?: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "exploration_candidate.produced",
      intent: "produce_exploration_candidates",
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        rootletOutputs: input.rootletOutputs,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishCandidatePoolUpdated(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  goalId: string;
  planId: string;
  candidatePool: CandidatePool;
  cycle?: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "candidate_pool.updated",
      intent: "update_candidate_pool",
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        candidatePoolId: input.candidatePool.poolId,
        candidatePool: input.candidatePool,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishAutonomyReviewCompleted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  goalId: string;
  planId: string;
  candidatePool: CandidatePool;
  autonomyDecision: UndergroundAutonomyDecision;
  cycle: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "autonomy_review.completed",
      intent: "complete_autonomy_review",
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        candidatePoolId: input.candidatePool.poolId,
        candidatePool: input.candidatePool,
        autonomyDecision: input.autonomyDecision,
        action: input.autonomyDecision.action,
        spawnedRootletCount: input.autonomyDecision.spawnRequests.length,
        stopReason: input.autonomyDecision.stopReason,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishConvergenceReviewRequested(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  goalId: string;
  planId: string;
  candidatePool: CandidatePool;
  autonomyDecision: UndergroundAutonomyDecision;
  cycle: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "convergence_review.requested",
      intent: "request_convergence_review",
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        candidatePoolId: input.candidatePool.poolId,
        candidatePool: input.candidatePool,
        autonomyDecisionId: input.autonomyDecision.decisionId,
        autonomyAction: input.autonomyDecision.action,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishConvergenceReviewCompleted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  goalId: string;
  planId: string;
  convergenceReport: UndergroundConvergenceReport;
  candidatePool: CandidatePool;
  undergroundReport: UndergroundExplorationReport;
  cycle?: UndergroundEventCyclePayload;
  agentCluster?: UndergroundEventAgentClusterPayload;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "convergence_review.completed",
      intent: "complete_convergence_review",
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        candidatePoolId: input.candidatePool.poolId,
        reviewId: input.convergenceReport.reviewId,
        convergenceReport: input.convergenceReport,
        candidatePool: input.candidatePool,
        undergroundReport: input.undergroundReport,
        ...cyclePayload(input.cycle),
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishAgentDelegationPlanned(input: {
  runtime: MinimalRuntime;
  traceId: string;
  parentAgentId: string;
  delegationDecision: DelegationDecision;
  childSpecs: readonly AgentSpec[];
  agentRunTree: AgentRunTree;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.parentAgentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "agent.delegation.planned",
      intent: "plan_agent_delegation",
      payload: {
        decisionId: input.delegationDecision.decisionId,
        delegationDecision: input.delegationDecision,
        childSpecs: input.childSpecs,
        childSpecIds: input.childSpecs.map((spec) => spec.specId),
        agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
      },
    }),
  );
}

export function publishChildAgentRunStarted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  parentAgentId: string;
  childRun: ChildAgentRun;
  agentRunTree: AgentRunTree;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.parentAgentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "agent.child.started",
      intent: "start_child_agent_run",
      payload: {
        childRunId: input.childRun.childRunId,
        specId: input.childRun.spec.specId,
        agentSpec: input.childRun.spec,
        childRun: input.childRun,
        agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
      },
    }),
  );
}

export function publishChildAgentRunCompleted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  parentAgentId: string;
  childRun: ChildAgentRun;
  agentRunTree: AgentRunTree;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.childRun.spec.agentId, role: input.childRun.spec.role },
      to: { group: "underground-center" },
      type: "agent.child.completed",
      intent: "complete_child_agent_run",
      payload: {
        childRunId: input.childRun.childRunId,
        specId: input.childRun.spec.specId,
        childRun: input.childRun,
        outputRefs: input.childRun.outputRefs,
        evidenceRefs: input.childRun.evidenceRefs,
        agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
      },
    }),
  );
}

export function publishChildAgentRunWaiting(input: {
  runtime: MinimalRuntime;
  traceId: string;
  parentAgentId: string;
  childRunIds: readonly string[];
  agentRunTree: AgentRunTree;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.parentAgentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "agent.child.waiting",
      intent: "wait_for_child_agent_runs",
      payload: {
        childRunIds: [...input.childRunIds],
        agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
      },
    }),
  );
}

export function publishParentSynthesisCompleted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  parentAgentId: string;
  parentSynthesis: ParentSynthesisResult;
  childRuns: readonly ChildAgentRun[];
  agentRunTree: AgentRunTree;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.parentAgentId, role: "underground_center" },
      to: { group: "underground-center" },
      type: "agent.parent_synthesis.completed",
      intent: "complete_parent_synthesis",
      payload: {
        synthesisId: input.parentSynthesis.synthesisId,
        parentSynthesis: input.parentSynthesis,
        childRuns: input.childRuns,
        agentRunTree: safeAgentRunTreeRef(input.agentRunTree),
      },
    }),
  );
}

export type UndergroundEventAgentClusterPayload = {
  readonly plan: UndergroundAgentClusterPlan;
  readonly run?: UndergroundAgentClusterRun;
  readonly invocations?: readonly UndergroundAgentInvocation[];
};

export type UndergroundEventCyclePayload = Pick<UndergroundExplorationCycle, "explorationCycleId" | "cycleIndex">;

function cyclePayload(cycle: UndergroundEventCyclePayload | undefined): UndergroundEventCyclePayload | Record<string, never> {
  return cycle === undefined
    ? {}
    : {
        explorationCycleId: cycle.explorationCycleId,
        cycleIndex: cycle.cycleIndex,
      };
}

export function safeAgentRunTreeRef(tree: AgentRunTree): {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly status: AgentRunTree["status"];
  readonly childRunCount: number;
  readonly delegationDecisionCount: number;
  readonly parentSynthesisCount: number;
} {
  return {
    treeId: tree.treeId,
    rootRunId: tree.rootRunId,
    rootAgentId: tree.rootAgentId,
    status: tree.status,
    childRunCount: tree.childRuns.length,
    delegationDecisionCount: tree.delegationDecisions.length,
    parentSynthesisCount: tree.parentSyntheses.length,
  };
}
