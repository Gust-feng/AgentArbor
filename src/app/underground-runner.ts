import type {
  CandidatePool,
  RootletOutput,
  UndergroundConvergenceReport,
  GoalIntentProfile,
  UndergroundEvidenceLedger,
  UndergroundExplorationPlan,
  UndergroundExplorationReport,
} from "../domain/underground/index.js";
import type { Constraint } from "../domain/contracts.js";
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
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly constraints: readonly Constraint[];
  readonly rootletOutputs: readonly RootletOutput[];
  readonly candidatePool: CandidatePool;
};

export type UndergroundConvergenceResult = {
  readonly candidatePool: CandidatePool;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
};

export type RunUndergroundExplorationInput = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly rawGoal?: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly agentId: string;
  readonly extraRootletOutputs?: readonly RootletOutput[];
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
  const goalIntentProfile =
    input.goalIntentProfile ??
    (input.rawGoal === undefined
      ? undefined
      : createGoalIntentProfileForMinimalUnderground({
          goalId: input.goalId,
          rawGoal: input.rawGoal,
          constraints: input.runtime.constraints,
        }));
  const plan = createMinimalUndergroundExplorationPlan(input.goalId, goalIntentProfile);
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

  const rootletOutputs = [
    ...produceMinimalRootletOutputs({
      plan: startedPlan,
      producedByAgentId: input.agentId,
      constraints: input.runtime.constraints,
      goalIntentProfile,
    }),
    ...(input.extraRootletOutputs ?? []),
  ];
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
    goalIntentProfile,
    constraints: input.runtime.constraints,
    rootletOutputs,
    candidatePool,
  });
  const undergroundReport = createUndergroundExplorationReport({
    plan: completedPlan,
    goalIntentProfile,
    evidenceLedger: convergence.evidenceLedger,
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
    rootletOutputs: input.rootletOutputs,
    goalIntentProfile: input.goalIntentProfile,
    constraints: input.constraints,
  });
}
