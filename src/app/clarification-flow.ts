import type {
  ArborMessageType,
  CandidateConvergenceDecision,
  DirectionHandoff,
  DirectionHandoffPackage,
  RunObservationSnapshot,
  UndergroundExplorationReport,
  UserClarificationRequest,
} from "../domain/contracts.js";
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
import {
  completeRootletClusters,
  createMinimalCandidatePool,
  createMinimalUndergroundExplorationPlan,
  createUndergroundExplorationReport,
  produceMinimalRootletOutputs,
  spendCandidateBudget,
  startRootletClusters,
} from "./minimal-underground.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";
import {
  publishCandidatePoolUpdated,
  publishConvergenceReviewCompleted,
  publishExplorationCandidatesProduced,
  publishRootletClustersStarted,
  publishUndergroundExplorationPlanned,
} from "./underground-events.js";

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

  const plan = createMinimalUndergroundExplorationPlan(goalId);
  publishUndergroundExplorationPlanned({ runtime, traceId, agentId, plan });

  const startedPlan = startRootletClusters(plan);
  publishRootletClustersStarted({ runtime, traceId, agentId, plan: startedPlan });

  const rootletOutputs = produceMinimalRootletOutputs({
    plan: startedPlan,
    producedByAgentId: agentId,
    constraints: runtime.constraints,
  });
  publishExplorationCandidatesProduced({ runtime, traceId, agentId, rootletOutputs });

  const candidatePool = createMinimalCandidatePool({
    goalId,
    producedByAgentId: agentId,
    rootletOutputs,
  });
  publishCandidatePoolUpdated({ runtime, traceId, agentId, candidatePool });

  const completedPlan = spendCandidateBudget(completeRootletClusters(startedPlan), rootletOutputs.length);
  const decisions = createClarificationRequiredDecisions(candidatePool);
  const convergedCandidatePool = applyCandidateConvergenceDecisions(candidatePool, decisions, nowIso());
  const unknownCandidateIds = decisions
    .filter((decision) => decision.status === "unknown")
    .map((decision) => decision.candidateId);
  const convergenceReport = createUndergroundConvergenceReport({
    reviewId: createId("convergence"),
    reviewedByAgentIds: [agentId],
    leadAgentId: agentId,
    candidatePool: convergedCandidatePool,
    decisions,
    provenanceRefs: ["goal.received", "candidate_pool.updated", "soil:minimal-constraints"],
    budget: {
      ...completedPlan.budget,
      spentCandidateOutputs: convergedCandidatePool.candidates.length,
      exhausted:
        completedPlan.budget.exhausted &&
        convergedCandidatePool.candidates.length >= completedPlan.budget.maxCandidateOutputs,
    },
    summary: "Minimal radial exploration found a viable direction but requires user clarification before handoff approval.",
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
  });
  const undergroundReport = createUndergroundExplorationReport({
    plan: completedPlan,
    rootletOutputs,
    candidatePool: convergedCandidatePool,
    convergenceReport,
  });
  publishConvergenceReviewCompleted({
    runtime,
    traceId,
    agentId,
    convergenceReport,
    candidatePool: convergedCandidatePool,
    undergroundReport,
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
