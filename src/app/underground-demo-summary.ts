import type { ArborMessageType } from "../domain/common.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageLineage,
  DirectionHandoffPackageValidationResult,
} from "../domain/agentarbor/direction-handoff-package/contracts.js";
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
import type { UndergroundDirectionSessionRecoveryResult } from "./underground-direction-recovery.js";

type DirectionPackageSummary = {
  readonly id: string;
  readonly directionId: string;
  readonly version: number;
  readonly status: string;
  readonly validation: Pick<DirectionHandoffPackageValidationResult, "passed" | "errors" | "warnings">;
};

export type UndergroundDemoSummary = {
  readonly terminalStatus: UndergroundDirectionSessionTerminalStatus;
  readonly directionPackage: DirectionPackageSummary;
  readonly recoveredPackage?: DirectionPackageSummary;
  readonly lineage: DirectionHandoffPackageLineage;
  readonly versions: readonly number[];
  readonly writtenPackagePath?: string;
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
  result: UndergroundDirectionSessionResult,
  recovery?: UndergroundDirectionSessionRecoveryResult
): UndergroundDemoSummary {
  const pkg = recovery?.loadedApprovedDirectionHandoffPackage ?? result.loadedDirectionHandoffPackage;
  const convergence = (recovery?.recoveredUndergroundReport ?? result.undergroundReport).convergenceReport;
  const escalation = convergence.userClarificationRequest;
  const observationSnapshot = recovery?.observationSnapshot ?? result.observationSnapshot;

  return {
    terminalStatus: recovery?.terminalStatus ?? result.terminalStatus,
    directionPackage: summarizeDirectionPackage(pkg),
    recoveredPackage:
      recovery === undefined ? undefined : summarizeDirectionPackage(recovery.loadedApprovedDirectionHandoffPackage),
    lineage: pkg.lineage,
    versions: recovery?.packageVersions ?? result.packageVersions,
    writtenPackagePath: recovery?.writtenPackagePath ?? result.writtenPackagePath,
    underground: {
      rootletKinds: (recovery?.recoveredUndergroundReport ?? result.undergroundReport).plan.rootletClusters.map(
        (cluster) => cluster.kind
      ),
      budget: (recovery?.recoveredUndergroundReport ?? result.undergroundReport).plan.budget,
      candidateCounts: (recovery?.recoveredUndergroundReport ?? result.undergroundReport).candidatePool.counts,
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
      phase: observationSnapshot.currentPhase,
      stage: observationSnapshot.currentStage,
      eventCursor: observationSnapshot.eventCursor,
      layerStatuses: {
        underground: observationSnapshot.underground.status,
        handoff: observationSnapshot.handoff.status,
        aboveground: observationSnapshot.aboveground.status,
        fruits: observationSnapshot.fruits.status,
        governance: observationSnapshot.governance.status,
        soilReturnStub: observationSnapshot.soilReturnStub.status,
      },
    },
    eventLog: recovery?.eventTypes ?? result.eventTypes,
  };
}

function summarizeDirectionPackage(pkg: DirectionHandoffPackage): DirectionPackageSummary {
  return {
    id: pkg.manifest.packageId,
    directionId: pkg.manifest.directionId,
    version: pkg.manifest.directionVersion,
    status: pkg.manifest.status,
    validation: {
      passed: pkg.validation.passed,
      errors: pkg.validation.errors,
      warnings: pkg.validation.warnings,
    },
  };
}
