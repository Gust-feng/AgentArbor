import type {
  CandidatePool,
  RootletOutput,
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
      },
    })
  );
}

export function publishRootletClustersStarted(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  plan: UndergroundExplorationPlan;
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
      },
    })
  );
}

export function publishExplorationCandidatesProduced(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  rootletOutputs: readonly RootletOutput[];
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
      },
    })
  );
}

export function publishCandidatePoolUpdated(input: {
  runtime: MinimalRuntime;
  traceId: string;
  agentId: string;
  candidatePool: CandidatePool;
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
      },
    })
  );
}
