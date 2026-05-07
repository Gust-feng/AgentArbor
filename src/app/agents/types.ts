import type {
  ArborMessageType,
  ConvergenceReview,
  DirectionHandoff,
  ExperienceCandidate,
  ExplorationCandidateRef,
  FruitCandidate,
  GrowthPlan,
  PlanPackage,
  PathBias,
  RunMemory,
  TaskSpec,
  UndergroundExplorationReport,
  WorkflowIR,
} from "../../domain/contracts.js";

export type DirectionOutput = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: PlanPackage;
  undergroundReport: UndergroundExplorationReport;
};

export type PlanOutput = {
  directionHandoffPackage: PlanPackage;
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
