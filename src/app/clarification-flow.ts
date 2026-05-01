import type {
  CandidateConvergenceDecision,
  DirectionHandoff,
  UndergroundExplorationReport,
  UserClarificationRequest,
} from "../domain/underground/index.js";
import type { DirectionHandoffPackage } from "../domain/agentarbor/direction-handoff-package/contracts.js";
import type { ArborMessageType } from "../domain/common.js";
import type { RunObservationSnapshot } from "../domain/observation/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import {
  applyCandidateConvergenceDecisions,
  createOpenQuestionDisposition,
  createUndergroundConvergenceReport,
  type CandidatePool,
  type ExplorationCandidateRef,
} from "../domain/underground/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { createAwaitingUserDirectionMaterial } from "./minimal-direction.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import {
  runUndergroundExploration,
  type UndergroundConvergenceInput,
  type UndergroundConvergenceResult,
} from "./underground-runner.js";

export const EXPECTED_CLARIFICATION_REQUIRED_EVENTS: ArborMessageType[] = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "convergence_review.completed",
  "user_approval.requested",
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

export function runClarificationRequiredUndergroundFlow(
  goal = "Build only if the user confirms the permission boundary."
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
    agentId,
    converge: createClarificationRequiredConvergence,
  });

  const material = createAwaitingUserDirectionMaterial({
    goalId,
    goal,
    producedByAgentId: agentId,
    constraints: runtime.constraints,
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

function createClarificationRequiredConvergence(
  input: UndergroundConvergenceInput
): UndergroundConvergenceResult {
  const decisions = createClarificationRequiredDecisions(input.candidatePool);
  const candidatePool = applyCandidateConvergenceDecisions(input.candidatePool, decisions, nowIso());
  const unknownCandidateIds = decisions
    .filter((decision) => decision.status === "unknown")
    .map((decision) => decision.candidateId);

  return {
    candidatePool,
    convergenceReport: createUndergroundConvergenceReport({
      reviewId: createId("convergence"),
      reviewedByAgentIds: [input.agentId],
      leadAgentId: input.agentId,
      candidatePool,
      decisions,
      provenanceRefs: ["goal.received", "candidate_pool.updated", "soil:minimal-constraints"],
      budget: {
        ...input.plan.budget,
        spentCandidateOutputs: candidatePool.candidates.length,
        exhausted: input.plan.budget.exhausted && candidatePool.candidates.length >= input.plan.budget.maxCandidateOutputs,
      },
      summary:
        "Minimal radial exploration found a viable direction but requires user clarification before handoff approval.",
      openQuestionDispositions: unknownCandidateIds.map((candidateId) =>
        createOpenQuestionDisposition({
          candidateId,
          reason: "permission_boundary_unclear",
          question: "Can Aboveground execution proceed within the current permission boundary?",
          blockingLevel: "blocking",
          evidenceRefs: ["AGENTS.md"],
        })
      ),
      userClarificationRequestId: createId("user-clarification"),
      createdAt: nowIso(),
    }),
  };
}

function createClarificationRequiredDecisions(candidatePool: CandidatePool): CandidateConvergenceDecision[] {
  return candidatePool.candidates.map((candidate) => ({
    decisionId: createId("convergence-decision"),
    candidateId: candidate.id,
    sourceCandidateRefs: [candidate.id],
    status: clarificationRequiredStatusForCandidate(candidate),
    decidedByRole: "convergence_judge",
    reason: clarificationRequiredReason(candidate),
    provenanceRefs: [...candidate.sourceRefs, "candidate_pool.updated"],
  }));
}

function clarificationRequiredStatusForCandidate(
  candidate: ExplorationCandidateRef
): CandidateConvergenceDecision["status"] {
  if (candidate.clusterId.includes("option") || candidate.clusterId.includes("evidence")) {
    return "accepted";
  }
  if (candidate.clusterId.includes("asset-fit")) {
    return "merged";
  }
  if (candidate.clusterId.includes("constraint")) {
    return "unknown";
  }
  return "rejected";
}

function clarificationRequiredReason(candidate: ExplorationCandidateRef): string {
  if (candidate.clusterId.includes("constraint")) {
    return "The permission boundary is unclear and must be clarified by the user before approval.";
  }
  if (candidate.clusterId.includes("option") || candidate.clusterId.includes("evidence")) {
    return `${candidate.clusterId} supports the awaiting-user direction draft.`;
  }
  if (candidate.clusterId.includes("asset-fit")) {
    return `${candidate.clusterId} is merged into the awaiting-user direction draft.`;
  }
  return `${candidate.clusterId} remains review evidence but is excluded from handoff input.`;
}
