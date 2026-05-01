import type {
  ArborMessageType,
  ConvergenceReview,
  DirectionHandoff,
  DirectionHandoffPackage,
  ExperienceCandidate,
  ExplorationCandidateRef,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunMemory,
  TaskSpec,
  WorkflowIR,
} from "../../domain/contracts.js";

export type DirectionOutput = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
};

export type PlanOutput = {
  directionHandoffPackage: DirectionHandoffPackage;
  growthPlan: GrowthPlan;
  workflow: WorkflowIR;
  task: TaskSpec;
};

export type GovernanceOutput = {
  fruit: FruitCandidate;
  runMemory: RunMemory;
  experienceCandidate: ExperienceCandidate;
  pathBias: PathBias;
};

export type GovernanceReviewOptions = {
  finalEventTypes?: ArborMessageType[];
};
