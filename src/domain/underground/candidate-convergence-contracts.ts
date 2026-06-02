import type { ExplorationCandidateRef } from "./contracts.js";

export type CandidatePoolCounts = {
  total: number;
  candidate: number;
  accepted: number;
  merged: number;
  rejected: number;
  unknown: number;
};

export type CandidateConvergenceStatus = Extract<
  ExplorationCandidateRef["status"],
  "accepted" | "merged" | "rejected" | "unknown"
>;

export type CandidateConvergenceDecision = {
  decisionId: string;
  candidateId: string;
  sourceCandidateRefs: string[];
  status: CandidateConvergenceStatus;
  decidedByRole: "convergence_judge";
  reason: string;
  provenanceRefs: string[];
  evidenceRefs: string[];
};

export type RejectedCandidateRefWithReason = {
  candidateId: string;
  reason: string;
  provenanceRefs: string[];
};
