import type { ConvergenceReview, DirectionHandoff, ExplorationCandidateRef } from "../underground/contracts.js";
import {
  assertHandoffSourceCandidates,
  type UndergroundConvergenceReport,
} from "../underground/radial-growth.js";

export class DirectionHandoffConvergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectionHandoffConvergenceError";
  }
}

export function assertDirectionHandoffConverged(
  handoff: DirectionHandoff,
  convergenceReview: ConvergenceReview
): void {
  if (handoff.convergenceReviewRef !== convergenceReview.reviewId) {
    throw new DirectionHandoffConvergenceError(
      "DirectionHandoff must reference the convergence review that accepted its source candidates."
    );
  }

  if (handoff.sourceCandidateRefs.length === 0) {
    throw new DirectionHandoffConvergenceError(
      "DirectionHandoff must keep sourceCandidateRefs instead of embedding raw exploration output."
    );
  }

  const report = convergenceReview as ConvergenceReview & Partial<UndergroundConvergenceReport>;
  const mergedCandidateRefs = report.mergedCandidateRefs ?? [];
  const handoffCandidateRefs = report.handoffCandidateRefs ?? [
    ...convergenceReview.acceptedCandidateRefs,
    ...mergedCandidateRefs,
  ];

  try {
    assertHandoffSourceCandidates(handoff.sourceCandidateRefs, {
      reviewId: convergenceReview.reviewId,
      reviewedByAgentIds: convergenceReview.reviewedByAgentIds,
      leadAgentId: convergenceReview.leadAgentId,
      crossCheckedCandidateRefs: convergenceReview.crossCheckedCandidateRefs,
      deduplicatedCandidateRefs: convergenceReview.deduplicatedCandidateRefs,
      acceptedCandidateRefs: convergenceReview.acceptedCandidateRefs,
      mergedCandidateRefs,
      rejectedCandidateRefs: convergenceReview.rejectedCandidateRefs,
      unknownCandidateRefs: report.unknownCandidateRefs ?? [],
      conflictResolutionRefs: convergenceReview.conflictResolutionRefs,
      provenanceRefs: convergenceReview.provenanceRefs,
      decisions: report.decisions ?? [],
      candidateComparisons: report.candidateComparisons,
      recommendedOptionId: report.recommendedOptionId,
      rejectedCandidateRefsWithReasons: report.rejectedCandidateRefsWithReasons ?? [],
      userDecisionRequired: report.userDecisionRequired ?? [],
      abovegroundReferenceOptionIds: report.abovegroundReferenceOptionIds ?? [],
      summary: report.summary ?? "",
      outcome: report.outcome ?? "approved",
      userEscalationRequired: report.userEscalationRequired ?? false,
      userClarificationRequest: report.userClarificationRequest,
      openQuestions: report.openQuestions ?? [],
      budgetExhausted: report.budgetExhausted ?? false,
      stopReason: report.stopReason,
      handoffCandidateRefs,
    });
  } catch (error) {
    throw new DirectionHandoffConvergenceError(
      error instanceof Error ? error.message : "DirectionHandoff source candidates did not converge."
    );
  }

  const unconverged = handoff.sourceCandidateRefs.filter(
    (candidate) =>
      !handoffCandidateRefs.includes(candidate.id) ||
      (candidate.status !== "accepted" && candidate.status !== "merged")
  );

  if (unconverged.length > 0) {
    throw new DirectionHandoffConvergenceError(
      `DirectionHandoff contains unconverged candidates: ${unconverged
        .map((candidate) => candidate.id)
        .join(", ")}`
    );
  }
}

export function markCandidatesAccepted(
  candidates: ExplorationCandidateRef[],
  acceptedCandidateIds: string[]
): ExplorationCandidateRef[] {
  const accepted = new Set(acceptedCandidateIds);
  return candidates.map((candidate) => ({
    ...candidate,
    status: accepted.has(candidate.id) ? "accepted" : candidate.status,
  }));
}

export function createApprovedDirectionHandoff(
  handoff: Omit<DirectionHandoff, "status">,
  convergenceReview: ConvergenceReview
): DirectionHandoff {
  const approvedHandoff: DirectionHandoff = {
    ...handoff,
    status: "approved",
  };
  assertDirectionHandoffConverged(approvedHandoff, convergenceReview);
  return approvedHandoff;
}
