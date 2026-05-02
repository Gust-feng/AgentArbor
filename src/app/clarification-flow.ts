import type { ArborMessageType } from "../domain/common.js";
import type { DirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import type {
  DirectionHandoff,
  UndergroundConvergenceReport,
  UndergroundExplorationReport,
  UserClarificationRequest,
  UserClarificationResponse,
} from "../domain/underground/index.js";
import type { MinimalRuntime } from "./runtime.js";
import { recoverUndergroundDirectionSession } from "./underground-direction-recovery.js";
import {
  runUndergroundDirectionSession,
  type UndergroundDirectionSessionResult,
} from "./underground-direction-session.js";

export const EXPECTED_CLARIFICATION_REQUIRED_EVENTS: ArborMessageType[] = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "convergence_review.completed",
  "user_approval.requested",
];

export const EXPECTED_CLARIFICATION_RECOVERY_EVENTS: ArborMessageType[] = [
  ...EXPECTED_CLARIFICATION_REQUIRED_EVENTS,
  "user_approval.received",
  "direction_handoff.revision_requested",
  "convergence_review.completed",
  "direction_handoff.completed",
];

export type ClarificationRequiredUndergroundFlowResult = {
  runtime: MinimalRuntime;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
  loadedDirectionHandoffPackage: DirectionHandoffPackage;
  undergroundReport: UndergroundExplorationReport;
  clarificationRequest: UserClarificationRequest;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
};

export type ClarificationRecoveryFlowResult = {
  runtime: MinimalRuntime;
  awaitingUserDirectionHandoffPackage: DirectionHandoffPackage;
  approvedDirectionHandoffPackage: DirectionHandoffPackage;
  loadedApprovedDirectionHandoffPackage: DirectionHandoffPackage;
  undergroundReport: UndergroundExplorationReport;
  recoveredUndergroundReport: UndergroundExplorationReport;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
  approvedConvergenceReport: UndergroundConvergenceReport;
  directionHandoff: DirectionHandoff;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
};

export function runClarificationRequiredUndergroundFlow(
  goal = "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
): ClarificationRequiredUndergroundFlowResult {
  const session = requireAwaitingUserSession(runUndergroundDirectionSession(goal));

  return {
    runtime: session.runtime,
    directionHandoff: session.directionHandoff,
    directionHandoffPackage: session.directionHandoffPackage,
    loadedDirectionHandoffPackage: session.loadedDirectionHandoffPackage,
    undergroundReport: session.undergroundReport,
    clarificationRequest: session.undergroundReport.convergenceReport.userClarificationRequest,
    observationSnapshot: session.observationSnapshot,
    eventTypes: session.eventTypes,
  };
}

export function runClarificationRecoveryFlow(
  goal = "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."
): ClarificationRecoveryFlowResult {
  const awaitingSession = requireAwaitingUserSession(runUndergroundDirectionSession(goal));
  const recovery = recoverUndergroundDirectionSession(awaitingSession);

  return {
    runtime: recovery.runtime,
    awaitingUserDirectionHandoffPackage: recovery.awaitingUserDirectionHandoffPackage,
    approvedDirectionHandoffPackage: recovery.approvedDirectionHandoffPackage,
    loadedApprovedDirectionHandoffPackage: recovery.loadedApprovedDirectionHandoffPackage,
    undergroundReport: recovery.undergroundReport,
    recoveredUndergroundReport: recovery.recoveredUndergroundReport,
    clarificationRequest: recovery.clarificationRequest,
    clarificationResponse: recovery.clarificationResponse,
    approvedConvergenceReport: recovery.approvedConvergenceReport,
    directionHandoff: recovery.directionHandoff,
    observationSnapshot: recovery.observationSnapshot,
    eventTypes: recovery.eventTypes,
  };
}

function requireAwaitingUserSession(
  session: UndergroundDirectionSessionResult
): UndergroundDirectionSessionResult & {
  directionHandoff: DirectionHandoff;
  undergroundReport: UndergroundExplorationReport & {
    convergenceReport: UndergroundConvergenceReport & {
      userClarificationRequest: UserClarificationRequest;
    };
  };
} {
  const request = session.undergroundReport.convergenceReport.userClarificationRequest;
  if (session.terminalStatus !== "awaiting_user" || session.directionHandoff === undefined || request === undefined) {
    throw new Error("Expected the underground session to stop at awaiting_user with a clarification request.");
  }
  return session as UndergroundDirectionSessionResult & {
    directionHandoff: DirectionHandoff;
    undergroundReport: UndergroundExplorationReport & {
      convergenceReport: UndergroundConvergenceReport & {
        userClarificationRequest: UserClarificationRequest;
      };
    };
  };
}
