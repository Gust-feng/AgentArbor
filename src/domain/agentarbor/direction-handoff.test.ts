import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedDirectionHandoff,
  DirectionHandoffConvergenceError,
} from "./direction-handoff.js";
import type { ConvergenceReview, ExplorationCandidateRef } from "../underground/contracts.js";
import { minimalDirectionHandoff } from "./test-fixtures.js";

test("rejects a DirectionHandoff that keeps unconverged candidates", () => {
  const candidate: ExplorationCandidateRef = {
    id: "candidate-unconverged",
    kind: "claim_candidate",
    producedByAgentId: "underground-analyzer",
    clusterId: "cluster-test",
    sourceRefs: ["goal.received"],
    status: "candidate",
  };
  const review: ConvergenceReview = {
    reviewId: "review-test",
    reviewedByAgentIds: ["underground-analyzer"],
    leadAgentId: "underground-analyzer",
    crossCheckedCandidateRefs: [candidate.id],
    deduplicatedCandidateRefs: [candidate.id],
    acceptedCandidateRefs: [candidate.id],
    rejectedCandidateRefs: [],
    conflictResolutionRefs: [],
    provenanceRefs: ["goal.received"],
  };

  assert.throws(
    () => createApprovedDirectionHandoff(minimalDirectionHandoff(candidate, review.reviewId), review),
    DirectionHandoffConvergenceError
  );
});
