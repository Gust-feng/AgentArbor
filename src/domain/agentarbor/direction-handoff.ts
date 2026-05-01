import type { ConvergenceReview, DirectionHandoff, ExplorationCandidateRef } from "../underground/contracts.js";

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

  const convergedCandidateIds = new Set([
    ...convergenceReview.acceptedCandidateRefs,
    ...convergenceReview.deduplicatedCandidateRefs,
  ]);

  const unconverged = handoff.sourceCandidateRefs.filter(
    (candidate) =>
      !convergedCandidateIds.has(candidate.id) ||
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
