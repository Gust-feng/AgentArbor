import type { ArborMessageType } from "../domain/common.js";
import {
  createDirectionHandoffPackageRef,
  resolveDirectionHandoffPackageMetaPath,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import type {
  DirectionHandoff,
  UndergroundConvergenceReport,
  UndergroundExplorationReport,
  UserClarificationRequest,
  UserClarificationResponse,
} from "../domain/underground/index.js";
import { applyCandidateConvergenceDecisions } from "../domain/underground/index.js";
import { createMessage } from "../kernel/messages/create-message.js";
import {
  createClarificationRecoveryDirectionMaterial,
  createDefaultClarificationResponse,
} from "./clarification-recovery.js";
import { publishConvergenceReviewCompleted } from "./underground-events.js";
import type {
  UndergroundDirectionSessionResult,
  UndergroundDirectionSessionTerminalStatus,
} from "./underground-direction-session.js";
import type { MinimalRuntime } from "./runtime.js";

export type UndergroundDirectionSessionRecoveryResult = {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  terminalStatus: Extract<UndergroundDirectionSessionTerminalStatus, "approved_package_created">;
  awaitingUserDirectionHandoffPackage: DirectionHandoffPackage;
  approvedDirectionHandoffPackage: DirectionHandoffPackage;
  loadedApprovedDirectionHandoffPackage: DirectionHandoffPackage;
  directionHandoffPackageRef: DirectionHandoffPackageRef;
  undergroundReport: UndergroundExplorationReport;
  recoveredUndergroundReport: UndergroundExplorationReport;
  clarificationRequest: UserClarificationRequest;
  clarificationResponse: UserClarificationResponse;
  approvedConvergenceReport: UndergroundConvergenceReport;
  directionHandoff: DirectionHandoff;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
  packageVersions: number[];
  writtenPackagePath?: string;
};

export function recoverUndergroundDirectionSession(
  awaitingSession: UndergroundDirectionSessionResult,
  clarificationResponse?: UserClarificationResponse
): UndergroundDirectionSessionRecoveryResult {
  const clarificationRequest = requireAwaitingUserClarificationRequest(awaitingSession);
  const response = clarificationResponse ?? createDefaultClarificationResponse(clarificationRequest);
  const previousPackageRef = createDirectionHandoffPackageRef(awaitingSession.loadedDirectionHandoffPackage);
  const agentId = awaitingSession.undergroundReport.convergenceReport.leadAgentId;

  publishUserApprovalReceived({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    clarificationResponse: response,
    directionPackage: previousPackageRef,
  });
  publishDirectionHandoffRevisionRequested({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    agentId,
    clarificationResponse: response,
    previousDirectionPackage: previousPackageRef,
    previousConvergenceReviewId: awaitingSession.loadedDirectionHandoffPackage.convergenceReview.reviewId,
    previousConvergenceOutcome: awaitingSession.loadedDirectionHandoffPackage.convergenceReview.outcome ?? "awaiting_user",
  });

  const material = createClarificationRecoveryDirectionMaterial({
    awaitingUserPackage: awaitingSession.loadedDirectionHandoffPackage,
    clarificationRequest,
    clarificationResponse: response,
  });
  const recoveredCandidatePool = applyCandidateConvergenceDecisions(
    awaitingSession.undergroundReport.candidatePool,
    material.convergenceReview.decisions,
    material.clarificationResponse.answeredAt
  );
  const recoveredUndergroundReport: UndergroundExplorationReport = {
    ...awaitingSession.undergroundReport,
    candidatePool: recoveredCandidatePool,
    convergenceReport: material.convergenceReview,
  };

  publishConvergenceReviewCompleted({
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    agentId,
    convergenceReport: material.convergenceReview,
    candidatePool: recoveredCandidatePool,
    undergroundReport: recoveredUndergroundReport,
  });

  const approvedDirectionHandoffPackage = awaitingSession.runtime.directionHandoffPackageStore.save(
    material.directionHandoffPackage
  );
  const loadedApprovedDirectionHandoffPackage = awaitingSession.runtime.directionHandoffPackageStore.load(
    approvedDirectionHandoffPackage.manifest.directionId,
    approvedDirectionHandoffPackage.manifest.directionVersion
  );
  const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedApprovedDirectionHandoffPackage);

  awaitingSession.runtime.bus.publish(
    createMessage({
      traceId: awaitingSession.traceId,
      from: { id: agentId, role: "underground_center" },
      to: { role: "aboveground_center" },
      type: "direction_handoff.completed",
      intent: "complete_direction_handoff_revision",
      payload: {
        goalId: awaitingSession.goalId,
        directionHandoff: material.directionHandoff,
        clarificationResponse: material.clarificationResponse,
        previousDirectionPackage: previousPackageRef,
        directionPackage: directionHandoffPackageRef,
        lineage: loadedApprovedDirectionHandoffPackage.lineage,
        convergenceReport: {
          reviewId: material.convergenceReview.reviewId,
          outcome: material.convergenceReview.outcome,
        },
      },
    })
  );

  const observationSnapshot = createRunObservationSnapshot({
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    eventEntries: awaitingSession.runtime.eventLog.list(),
    undergroundReport: recoveredUndergroundReport,
    directionHandoffPackage: loadedApprovedDirectionHandoffPackage,
  });
  const packageVersions = awaitingSession.runtime.directionHandoffPackageStore.listVersions(
    loadedApprovedDirectionHandoffPackage.manifest.directionId
  );

  return {
    runtime: awaitingSession.runtime,
    traceId: awaitingSession.traceId,
    goalId: awaitingSession.goalId,
    terminalStatus: "approved_package_created",
    awaitingUserDirectionHandoffPackage: awaitingSession.loadedDirectionHandoffPackage,
    approvedDirectionHandoffPackage,
    loadedApprovedDirectionHandoffPackage,
    directionHandoffPackageRef,
    undergroundReport: awaitingSession.undergroundReport,
    recoveredUndergroundReport,
    clarificationRequest,
    clarificationResponse: material.clarificationResponse,
    approvedConvergenceReport: material.convergenceReview,
    directionHandoff: material.directionHandoff,
    observationSnapshot,
    eventTypes: awaitingSession.runtime.eventLog.types(),
    packageVersions,
    writtenPackagePath:
      awaitingSession.outputDirectory === undefined
        ? undefined
        : resolveDirectionHandoffPackageMetaPath(
            awaitingSession.outputDirectory,
            loadedApprovedDirectionHandoffPackage.manifest.directionId,
            loadedApprovedDirectionHandoffPackage.manifest.directionVersion
          ),
  };
}

function requireAwaitingUserClarificationRequest(
  session: UndergroundDirectionSessionResult
): UserClarificationRequest {
  const request = session.undergroundReport.convergenceReport.userClarificationRequest;
  if (session.terminalStatus !== "awaiting_user" || request === undefined) {
    throw new Error("Underground direction session recovery requires an awaiting_user session.");
  }
  if (session.loadedDirectionHandoffPackage.manifest.status !== "awaiting_user") {
    throw new Error("Underground direction session recovery requires an awaiting_user package.");
  }
  return request;
}

function publishUserApprovalReceived(input: {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  clarificationResponse: UserClarificationResponse;
  directionPackage: DirectionHandoffPackageRef;
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "user_approval.received",
      intent: "receive_user_clarification",
      payload: {
        goalId: input.goalId,
        requestId: input.clarificationResponse.requestId,
        answeredAt: input.clarificationResponse.answeredAt,
        answers: input.clarificationResponse.answers,
        evidenceRefs: input.clarificationResponse.evidenceRefs,
        clarificationResponse: input.clarificationResponse,
        directionPackage: input.directionPackage,
      },
    })
  );
}

function publishDirectionHandoffRevisionRequested(input: {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  agentId: string;
  clarificationResponse: UserClarificationResponse;
  previousDirectionPackage: DirectionHandoffPackageRef;
  previousConvergenceReviewId: string;
  previousConvergenceOutcome: UndergroundConvergenceReport["outcome"];
}): void {
  input.runtime.bus.publish(
    createMessage({
      traceId: input.traceId,
      from: { id: input.agentId, role: "underground_center" },
      to: { role: "agentarbor_handoff" },
      type: "direction_handoff.revision_requested",
      intent: "request_direction_handoff_revision",
      payload: {
        goalId: input.goalId,
        revisionReason: "user_clarification_answered",
        requestId: input.clarificationResponse.requestId,
        answeredAt: input.clarificationResponse.answeredAt,
        evidenceRefs: input.clarificationResponse.evidenceRefs,
        clarificationResponse: input.clarificationResponse,
        directionPackage: input.previousDirectionPackage,
        convergenceReport: {
          reviewId: input.previousConvergenceReviewId,
          outcome: input.previousConvergenceOutcome,
        },
      },
    })
  );
}
