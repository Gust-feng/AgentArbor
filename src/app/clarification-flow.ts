import type {
  ConvergenceReview,
  DirectionHandoff,
  UndergroundExplorationReport,
  UndergroundConvergenceReport,
  UserClarificationRequest,
  UserClarificationResponse,
} from "../domain/underground/index.js";
import { createDirectionHandoffPackageRef } from "../domain/agentarbor/direction-handoff-package.js";
import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageRef,
} from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { ArborMessageType } from "../domain/common.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import {
  applyCandidateConvergenceDecisions,
  compareCandidatesForGoal,
  createDefaultGoalIntentProfile,
  createOpenQuestionDisposition,
  createUndergroundConvergenceReport,
  type CandidatePool,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { createAwaitingUserDirectionMaterial } from "./minimal-direction.js";
import { createMinimalUndergroundEvidenceLedger } from "./minimal-underground.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import {
  createClarificationRecoveryDirectionMaterial,
  createDefaultClarificationResponse,
} from "./clarification-recovery.js";
import {
  runUndergroundExploration,
  type UndergroundConvergenceInput,
  type UndergroundConvergenceResult,
} from "./underground-runner.js";
import { publishConvergenceReviewCompleted } from "./underground-events.js";

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
  goal = "Build only if the permission boundary is unknown and must be confirmed."
): ClarificationRequiredUndergroundFlowResult {
  const runtime = createMinimalRuntime();
  const traceId = createId("trace");
  const goalId = createId("goal");
  const agentId = "underground-analyzer";

  runtime.bus.publish(
    createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal },
    })
  );

  const { candidatePool: convergedCandidatePool, convergenceReport, undergroundReport } = runUndergroundExploration({
    runtime,
    traceId,
    goalId,
    rawGoal: goal,
    agentId,
    converge: createClarificationRequiredConvergence,
  });

  const material = createAwaitingUserDirectionMaterial({
    goalId,
    goal,
    producedByAgentId: agentId,
    constraints: runtime.constraints,
    goalIntentProfile: undergroundReport.goalIntentProfile,
    candidatePool: convergedCandidatePool,
    convergenceReport,
  });
  const directionHandoffPackage = runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);
  const loadedDirectionHandoffPackage = runtime.directionHandoffPackageStore.load(
    directionHandoffPackage.manifest.directionId,
    directionHandoffPackage.manifest.directionVersion
  );

  runtime.bus.publish(
    createMessage({
      traceId,
      from: { id: agentId, role: "underground_center" },
      to: { role: "user" },
      type: "user_approval.requested",
      intent: "request_user_clarification",
      payload: {
        goalId,
        clarificationRequest: material.clarificationRequest,
        directionPackage: {
          packageId: loadedDirectionHandoffPackage.manifest.packageId,
          directionId: loadedDirectionHandoffPackage.manifest.directionId,
          version: loadedDirectionHandoffPackage.manifest.directionVersion,
          status: loadedDirectionHandoffPackage.manifest.status,
        },
        convergenceReport: {
          reviewId: convergenceReport.reviewId,
          outcome: convergenceReport.outcome,
        },
      },
    })
  );

  const observationSnapshot = createRunObservationSnapshot({
    traceId,
    goalId,
    eventEntries: runtime.eventLog.list(),
    undergroundReport,
    directionHandoffPackage: loadedDirectionHandoffPackage,
  });

  return {
    runtime,
    directionHandoff: material.directionHandoff,
    directionHandoffPackage,
    loadedDirectionHandoffPackage,
    undergroundReport,
    clarificationRequest: material.clarificationRequest,
    observationSnapshot,
    eventTypes: runtime.eventLog.types(),
  };
}

export function runClarificationRecoveryFlow(
  goal = "Build only if the permission boundary is unknown and must be confirmed."
): ClarificationRecoveryFlowResult {
  const awaiting = runClarificationRequiredUndergroundFlow(goal);
  const response = createDefaultClarificationResponse(awaiting.clarificationRequest);
  const previousPackageRef = createDirectionHandoffPackageRef(awaiting.loadedDirectionHandoffPackage);

  publishUserApprovalReceived({
    runtime: awaiting.runtime,
    traceId: awaiting.runtime.eventLog.list()[0]?.message.traceId ?? createId("trace"),
    goalId: awaiting.clarificationRequest.goalId,
    agentId: "underground-analyzer",
    clarificationResponse: response,
    directionPackage: previousPackageRef,
  });
  publishDirectionHandoffRevisionRequested({
    runtime: awaiting.runtime,
    traceId: awaiting.runtime.eventLog.list()[0]?.message.traceId ?? createId("trace"),
    goalId: awaiting.clarificationRequest.goalId,
    agentId: "underground-analyzer",
    clarificationResponse: response,
    previousDirectionPackage: previousPackageRef,
    previousConvergenceReview: awaiting.loadedDirectionHandoffPackage.convergenceReview,
  });

  const material = createClarificationRecoveryDirectionMaterial({
    awaitingUserPackage: awaiting.loadedDirectionHandoffPackage,
    clarificationRequest: awaiting.clarificationRequest,
    clarificationResponse: response,
  });
  const recoveredCandidatePool = applyCandidateConvergenceDecisions(
    awaiting.undergroundReport.candidatePool,
    material.convergenceReview.decisions,
    response.answeredAt
  );
  const recoveredUndergroundReport: UndergroundExplorationReport = {
    ...awaiting.undergroundReport,
    candidatePool: recoveredCandidatePool,
    convergenceReport: material.convergenceReview,
  };

  publishConvergenceReviewCompleted({
    runtime: awaiting.runtime,
    traceId: awaiting.runtime.eventLog.list()[0]?.message.traceId ?? createId("trace"),
    agentId: "underground-analyzer",
    convergenceReport: material.convergenceReview,
    candidatePool: recoveredCandidatePool,
    undergroundReport: recoveredUndergroundReport,
  });

  const approvedDirectionHandoffPackage = awaiting.runtime.directionHandoffPackageStore.save(
    material.directionHandoffPackage
  );
  const loadedApprovedDirectionHandoffPackage = awaiting.runtime.directionHandoffPackageStore.load(
    approvedDirectionHandoffPackage.manifest.directionId,
    approvedDirectionHandoffPackage.manifest.directionVersion
  );

  awaiting.runtime.bus.publish(
    createMessage({
      traceId: awaiting.runtime.eventLog.list()[0]?.message.traceId ?? createId("trace"),
      from: { id: "underground-analyzer", role: "underground_center" },
      to: { role: "aboveground_center" },
      type: "direction_handoff.completed",
      intent: "complete_direction_handoff_revision",
      payload: {
        goalId: awaiting.clarificationRequest.goalId,
        directionHandoff: material.directionHandoff,
        clarificationResponse: response,
        previousDirectionPackage: previousPackageRef,
        directionPackage: createDirectionHandoffPackageRef(loadedApprovedDirectionHandoffPackage),
        lineage: loadedApprovedDirectionHandoffPackage.lineage,
        convergenceReport: {
          reviewId: material.convergenceReview.reviewId,
          outcome: material.convergenceReview.outcome,
        },
      },
    })
  );

  const observationSnapshot = createRunObservationSnapshot({
    traceId: awaiting.runtime.eventLog.list()[0]?.message.traceId ?? createId("trace"),
    goalId: awaiting.clarificationRequest.goalId,
    eventEntries: awaiting.runtime.eventLog.list(),
    undergroundReport: recoveredUndergroundReport,
    directionHandoffPackage: loadedApprovedDirectionHandoffPackage,
  });

  return {
    runtime: awaiting.runtime,
    awaitingUserDirectionHandoffPackage: awaiting.loadedDirectionHandoffPackage,
    approvedDirectionHandoffPackage,
    loadedApprovedDirectionHandoffPackage,
    undergroundReport: awaiting.undergroundReport,
    recoveredUndergroundReport,
    clarificationRequest: awaiting.clarificationRequest,
    clarificationResponse: response,
    approvedConvergenceReport: material.convergenceReview,
    directionHandoff: material.directionHandoff,
    observationSnapshot,
    eventTypes: awaiting.runtime.eventLog.types(),
  };
}

function publishUserApprovalReceived(input: {
  runtime: MinimalRuntime;
  traceId: string;
  goalId: string;
  agentId: string;
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
  previousConvergenceReview: ConvergenceReview;
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
          reviewId: input.previousConvergenceReview.reviewId,
          outcome: input.previousConvergenceReview.outcome,
        },
      },
    })
  );
}

function createClarificationRequiredConvergence(
  input: UndergroundConvergenceInput
): UndergroundConvergenceResult {
  const createdAt = nowIso();
  const goalIntentProfile = input.goalIntentProfile ?? createDefaultGoalIntentProfile(input.goalId, createdAt);
  const comparisonResult = compareCandidatesForGoal({
    goalProfile: goalIntentProfile,
    candidates: input.candidatePool.candidates,
    rootletOutputs: input.rootletOutputs,
    createdAt,
  });
  const decisions = comparisonResult.decisions;
  const candidatePool = applyCandidateConvergenceDecisions(input.candidatePool, decisions, createdAt);
  const unknownCandidateIds = new Set(decisions
    .filter((decision) => decision.status === "unknown")
    .map((decision) => decision.candidateId));
  const evidenceLedger = createMinimalUndergroundEvidenceLedger({
    goalIntentProfile,
    constraints: input.constraints,
    rootletOutputs: input.rootletOutputs,
    extraEntries: comparisonResult.evidenceEntries,
    createdAt,
  });

  return {
    candidatePool,
    evidenceLedger,
    convergenceReport: createUndergroundConvergenceReport({
      reviewId: createId("convergence"),
      reviewedByAgentIds: [input.agentId],
      leadAgentId: input.agentId,
      candidatePool,
      decisions,
      candidateComparisons: comparisonResult.comparisons,
      provenanceRefs: ["goal.received", "candidate_pool.updated", "soil:minimal-constraints"],
      budget: {
        ...input.plan.budget,
        spentCandidateOutputs: candidatePool.candidates.length,
        exhausted: input.plan.budget.exhausted && candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
      },
      summary:
        "Minimal radial exploration found a viable direction but requires user clarification before handoff approval.",
      openQuestionDispositions: comparisonResult.comparisons
        .filter((comparison) => unknownCandidateIds.has(comparison.candidateId))
        .sort((left, right) => Number(right.conclusion === "needs_user") - Number(left.conclusion === "needs_user"))
        .map((comparison) =>
          createOpenQuestionDisposition({
            candidateId: comparison.candidateId,
            reason:
              comparison.conclusion === "needs_user"
                ? "permission_boundary_unclear"
                : "critical_fact_missing",
            question:
              comparison.conclusion === "needs_user"
                ? "Can Aboveground execution proceed within the current permission boundary?"
                : "Keep this non-blocking uncertainty visible for later review.",
            blockingLevel: comparison.conclusion === "needs_user" ? "blocking" : "non_blocking",
            evidenceRefs: comparison.evidenceRefs,
          })
        ),
      userClarificationRequestId: createId("user-clarification"),
      createdAt,
    }),
  };
}
