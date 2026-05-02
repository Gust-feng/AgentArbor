import type {
  CandidatePool,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundConvergenceReport,
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
        planId: input.plan.planId,
        rootletClusters: input.plan.rootletClusters,
        budget: input.plan.budget,
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishExplorationCandidatesProduced(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  rootletOutputs: readonly RootletOutput[];
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
        rootletOutputs: input.rootletOutputs,
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishCandidatePoolUpdated(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  candidatePool: CandidatePool;
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
        candidatePool: input.candidatePool,
        agentCluster: input.agentCluster,
      },
    })
  );
}

export function publishConvergenceReviewCompleted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  convergenceReport: UndergroundConvergenceReport;
  candidatePool: CandidatePool;
  undergroundReport: UndergroundExplorationReport;
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
        convergenceReport: input.convergenceReport,
        candidatePool: input.candidatePool,
        undergroundReport: input.undergroundReport,
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
