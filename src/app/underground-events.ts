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
