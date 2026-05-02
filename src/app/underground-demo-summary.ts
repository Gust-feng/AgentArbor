import type { ArborMessageType } from "../domain/common.js";
import type { DirectionHandoffPackageValidationResult } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { ObservationStatus, RunPhase, RunStage } from "../domain/observation/contracts.js";
import type {
  CandidatePoolCounts,
  ExplorationBudget,
  RootletClusterKind,
  UndergroundConvergenceOutcome,
  UserClarificationReason,
} from "../domain/underground/index.js";
import type {
  UndergroundDirectionSessionResult,
  UndergroundDirectionSessionTerminalStatus,
} from "./underground-direction-session.js";

export type UndergroundDemoSummary = {
  readonly terminalStatus: UndergroundDirectionSessionTerminalStatus;
  readonly directionPackage: {
    readonly id: string;
    readonly directionId: string;
    readonly version: number;
    readonly status: string;
    readonly validation: Pick<DirectionHandoffPackageValidationResult, "passed" | "errors" | "warnings">;
  };
  readonly underground: {
    readonly rootletKinds: readonly RootletClusterKind[];
    readonly budget: ExplorationBudget;
    readonly candidateCounts: CandidatePoolCounts;
    readonly convergence: {
      readonly reviewId: string;
      readonly outcome: UndergroundConvergenceOutcome;
      readonly accepted: number;
      readonly merged: number;
      readonly rejected: number;
      readonly unknown: number;
      readonly userEscalationRequired: boolean;
      readonly stopReason?: string;
    };
  };
  readonly userEscalation?: {
    readonly requestId: string;
    readonly reason: UserClarificationReason;
    readonly questionCount: number;
    readonly relatedCandidateRefs: readonly string[];
  };
  readonly observationSnapshot: {
    readonly phase: RunPhase;
    readonly stage: RunStage;
    readonly eventCursor: UndergroundDirectionSessionResult["observationSnapshot"]["eventCursor"];
    readonly layerStatuses: {
      readonly underground: ObservationStatus;
      readonly handoff: ObservationStatus;
      readonly aboveground: ObservationStatus;
      readonly fruits: ObservationStatus;
      readonly governance: ObservationStatus;
      readonly soilReturnStub: ObservationStatus;
    };
  };
  readonly eventLog: readonly ArborMessageType[];
};

export function createUndergroundDemoSummary(
  result: UndergroundDirectionSessionResult
): UndergroundDemoSummary {
  const pkg = result.loadedDirectionHandoffPackage;
  const convergence = result.undergroundReport.convergenceReport;
  const escalation = convergence.userClarificationRequest;

  return {
    terminalStatus: result.terminalStatus,
    directionPackage: {
      id: pkg.manifest.packageId,
      directionId: pkg.manifest.directionId,
      version: pkg.manifest.directionVersion,
      status: pkg.manifest.status,
      validation: {
        passed: pkg.validation.passed,
        errors: pkg.validation.errors,
        warnings: pkg.validation.warnings,
      },
    },
    underground: {
      rootletKinds: result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind),
      budget: result.undergroundReport.plan.budget,
      candidateCounts: result.undergroundReport.candidatePool.counts,
      convergence: {
        reviewId: convergence.reviewId,
        outcome: convergence.outcome,
        accepted: convergence.acceptedCandidateRefs.length,
        merged: convergence.mergedCandidateRefs.length,
        rejected: convergence.rejectedCandidateRefs.length,
        unknown: convergence.unknownCandidateRefs.length,
        userEscalationRequired: convergence.userEscalationRequired,
        stopReason: convergence.stopReason,
      },
    },
    userEscalation:
      escalation === undefined
        ? undefined
        : {
            requestId: escalation.requestId,
            reason: escalation.primaryReason,
            questionCount: escalation.questions.length,
            relatedCandidateRefs: escalation.relatedCandidateRefs,
          },
    observationSnapshot: {
      phase: result.observationSnapshot.currentPhase,
      stage: result.observationSnapshot.currentStage,
      eventCursor: result.observationSnapshot.eventCursor,
      layerStatuses: {
        underground: result.observationSnapshot.underground.status,
        handoff: result.observationSnapshot.handoff.status,
        aboveground: result.observationSnapshot.aboveground.status,
        fruits: result.observationSnapshot.fruits.status,
        governance: result.observationSnapshot.governance.status,
        soilReturnStub: result.observationSnapshot.soilReturnStub.status,
      },
    },
    eventLog: result.eventTypes,
  };
}
