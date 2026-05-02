import {
  createApprovedDirectionHandoff,
} from "../domain/agentarbor/direction-handoff.js";
import { createDirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package.js";
import type { DirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { Constraint } from "../domain/constraints.js";
import type {
  CandidatePool,
  ConvergenceReview,
  DirectionHandoff,
  ExplorationCandidateRef,
  GoalIntentProfile,
  UndergroundConvergenceReport,
  UserClarificationRequest,
} from "../domain/underground/index.js";
import { selectHandoffSourceCandidates } from "../domain/underground/index.js";
import { deriveDirectionHandoffDraft } from "./direction-handoff-derivation.js";

export type MinimalDirectionMaterial = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
};

export type AwaitingUserDirectionMaterial = MinimalDirectionMaterial & {
  clarificationRequest: UserClarificationRequest;
};

export type StoppedDirectionMaterial = MinimalDirectionMaterial;

export function createMinimalDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): MinimalDirectionMaterial {
  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createMinimalDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
    goalIntentProfile: input.goalIntentProfile,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage };
}

export function createAwaitingUserDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): AwaitingUserDirectionMaterial {
  const clarificationRequest = input.convergenceReport.userClarificationRequest;
  if (clarificationRequest === undefined) {
    throw new Error("Awaiting-user DirectionHandoff requires a UserClarificationRequest.");
  }

  const sourceCandidates = selectHandoffSourceCandidates(input.candidatePool, input.convergenceReport);
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = createAwaitingUserDirectionHandoff({
    goalId: input.goalId,
    goal: input.goal,
    sourceCandidates,
    convergenceReview,
    constraints: input.constraints,
    goalIntentProfile: input.goalIntentProfile,
    clarificationRequest,
  });
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates, convergenceReview, directionHandoff, directionHandoffPackage, clarificationRequest };
}

export function createStoppedDirectionMaterial(input: {
  goalId: string;
  goal: string;
  producedByAgentId: string;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  candidatePool: CandidatePool;
  convergenceReport: UndergroundConvergenceReport;
}): StoppedDirectionMaterial {
  const convergenceReview: ConvergenceReview = input.convergenceReport;
  const directionHandoff = {
    ...deriveDirectionHandoffDraft({
      goalId: input.goalId,
      goal: input.goal,
      sourceCandidates: [],
      convergenceReview,
      constraints: input.constraints,
      goalIntentProfile: input.goalIntentProfile,
    }),
    status: "draft" as const,
  };
  const directionHandoffPackage = createDirectionHandoffPackage({ directionHandoff, convergenceReview });

  return { sourceCandidates: [], convergenceReview, directionHandoff, directionHandoffPackage };
}

function createMinimalDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
}): DirectionHandoff {
  return createApprovedDirectionHandoff(deriveDirectionHandoffDraft(input), input.convergenceReview);
}

function createAwaitingUserDirectionHandoff(input: {
  goalId: string;
  goal: string;
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  constraints: Constraint[];
  goalIntentProfile?: GoalIntentProfile;
  clarificationRequest: UserClarificationRequest;
}): DirectionHandoff {
  return {
    ...deriveDirectionHandoffDraft(input),
    status: "awaiting_user",
  };
}
