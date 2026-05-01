import type {
  ArborMessage,
  ArborMessageType,
  ArtifactRef,
  DirectionHandoffPackage,
  ExperienceCandidate,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunMemory,
  TaskSpec,
  VerificationReport,
  WorkflowIR,
} from "../contracts.js";
import type { UndergroundExplorationReport } from "../underground/index.js";

export type RunObservationEventView = {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly traceId: string;
  readonly taskId?: string;
  readonly intent: string;
  readonly from: Readonly<ArborMessage["from"]>;
  readonly to?: Readonly<NonNullable<ArborMessage["to"]>>;
  readonly createdAt: string;
  readonly recordedAt: string;
};

export type RunObservationSnapshot = {
  readonly traceId: string;
  readonly goalId: string;
  readonly currentPhase: string;
  readonly eventCursor: {
    readonly eventCount: number;
    readonly lastSequence: number;
    readonly lastEventType?: ArborMessageType;
  };
  readonly events: readonly RunObservationEventView[];
  readonly underground: RunObservationUndergroundView;
  readonly directionPackageRef: {
    readonly packageId: string;
    readonly directionId: string;
    readonly version: number;
    readonly status: DirectionHandoffPackage["manifest"]["status"];
    readonly validationPassed: boolean;
  };
  readonly aboveground: {
    readonly growthPlanId?: string;
    readonly workflowId?: string;
    readonly taskId?: string;
    readonly taskStatus?: TaskSpec["status"];
    readonly verificationGates: readonly string[];
  };
  readonly artifactRefs: readonly ArtifactRef[];
  readonly verification: {
    readonly reportId?: string;
    readonly status?: VerificationReport["status"];
    readonly passedChecks: number;
    readonly totalChecks: number;
  };
  readonly governance: {
    readonly fruitId?: string;
    readonly fruitStatus?: FruitCandidate["governanceStatus"];
    readonly runMemoryId?: string;
    readonly experienceCandidateId?: string;
    readonly pathBiasId?: string;
  };
};

export type RunObservationUndergroundView = {
  readonly planId: string;
  readonly budget: UndergroundExplorationReport["plan"]["budget"];
  readonly rootletClusters: readonly {
    readonly clusterId: string;
    readonly kind: string;
    readonly status: string;
    readonly objective: string;
  }[];
  readonly candidatePool: {
    readonly poolId: string;
    readonly total: number;
    readonly candidate: number;
    readonly accepted: number;
    readonly merged: number;
    readonly rejected: number;
    readonly unknown: number;
    readonly sourceRootletOutputRefs: readonly string[];
  };
  readonly convergence: {
    readonly reviewId: string;
    readonly outcome: string;
    readonly summary: string;
    readonly acceptedCandidateRefs: readonly string[];
    readonly mergedCandidateRefs: readonly string[];
    readonly rejectedCandidateRefs: readonly string[];
    readonly unknownCandidateRefs: readonly string[];
    readonly stopReason?: string;
  };
  readonly userEscalationRequired: boolean;
};

export type RunObservationSnapshotInput = {
  traceId: string;
  goalId: string;
  eventEntries: readonly {
    sequence: number;
    type: ArborMessageType;
    message: ArborMessage;
    recordedAt: string;
  }[];
  undergroundReport: UndergroundExplorationReport;
  directionHandoffPackage: DirectionHandoffPackage;
  growthPlan?: GrowthPlan;
  workflow?: WorkflowIR;
  task?: TaskSpec;
  artifactRefs?: readonly ArtifactRef[];
  verification?: VerificationReport;
  fruit?: FruitCandidate;
  runMemory?: RunMemory;
  experienceCandidate?: ExperienceCandidate;
  pathBias?: PathBias;
};
