import type {
  CandidatePool,
  RootletOutput,
  UndergroundConvergenceReport,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";
import {
  completeRootletClusters,
  convergeMinimalCandidatePool,
  createMinimalCandidatePool,
  createMinimalUndergroundExplorationPlan,
  createUndergroundExplorationReport,
  produceMinimalRootletOutputs,
  spendCandidateBudget,
  startRootletClusters,
} from "./minimal-underground.js";
import type { MinimalRuntime } from "./runtime.js";
import {
  publishCandidatePoolUpdated,
  publishConvergenceReviewCompleted,
  publishExplorationCandidatesProduced,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "./underground-events.js";

export type UndergroundConvergenceInput = {
  readonly goalId: string;
  readonly agentId: string;
  readonly plan: UndergroundExplorationPlan;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly candidatePool: CandidatePool;
};

export type UndergroundConvergenceResult = {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
};

export type RunUndergroundExplorationInput = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly agentId: string;
  readonly converge?: (input: UndergroundConvergenceInput) => UndergroundConvergenceResult;
};

export type RunUndergroundExplorationResult = {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly undergroundReport: UndergroundExplorationReport;
};

export function runUndergroundExploration(
  input: RunUndergroundExplorationInput
): RunUndergroundExplorationResult {
  const plan = createMinimalUndergroundExplorationPlan(input.goalId);
  publishUndergroundExplorationPlanned({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.agentId,
    plan,
  });

  const startedPlan = startRootletClusters(plan);
  publishRootletClustersStarted({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.agentId,
    plan: startedPlan,
  });

  const rootletOutputs = produceMinimalRootletOutputs({
    plan: startedPlan,
    producedByAgentId: input.agentId,
    constraints: input.runtime.constraints,
  });
  publishExplorationCandidatesProduced({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.agentId,
    rootletOutputs,
  });

  const candidatePool = createMinimalCandidatePool({
    goalId: input.goalId,
    producedByAgentId: input.agentId,
    rootletOutputs,
  });
  publishCandidatePoolUpdated({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.agentId,
    candidatePool,
  });

  const completedPlan = spendCandidateBudget(completeRootletClusters(startedPlan), rootletOutputs.length);
  const convergence = (input.converge ?? convergeDefaultUndergroundCandidatePool)({
    goalId: input.goalId,
    agentId: input.agentId,
    plan: completedPlan,
    rootletOutputs,
    candidatePool,
  });
  const undergroundReport = createUndergroundExplorationReport({
    plan: completedPlan,
    rootletOutputs,
    candidatePool: convergence.candidatePool,
    convergenceReport: convergence.convergenceReport,
  });
  publishConvergenceReviewCompleted({
    runtime: input.runtime,
    traceId: input.traceId,
    agentId: input.agentId,
    convergenceReport: convergence.convergenceReport,
    candidatePool: convergence.candidatePool,
    undergroundReport,
  });

  return {
    candidatePool: convergence.candidatePool,
    convergenceReport: convergence.convergenceReport,
    undergroundReport,
  };
}

function convergeDefaultUndergroundCandidatePool(
  input: UndergroundConvergenceInput
): UndergroundConvergenceResult {
  return convergeMinimalCandidatePool({
    pool: input.candidatePool,
    plan: input.plan,
    leadAgentId: input.agentId,
  });
}
