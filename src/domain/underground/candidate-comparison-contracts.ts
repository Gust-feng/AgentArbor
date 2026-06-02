import type { RootletOutput } from "./rootlet-contracts.js";

export type CandidateComparisonLevel = "strong" | "partial" | "weak" | "blocking";

export type CandidateComparisonConclusion = "accept" | "merge" | "reject" | "needs_user" | "keep_unknown";

export type CandidateComparison = {
  comparisonId: string;
  candidateId: string;
  goalId: string;
  rootletOutputRef: string;
  rootletKind: RootletOutput["kind"];
  candidateSummary: string;
  goalMatch: CandidateComparisonLevel;
  goalMatchBasis: string;
  evidenceSupport: CandidateComparisonLevel;
  evidenceSupportBasis: string;
  evidenceGaps: string[];
  constraintImpact: CandidateComparisonLevel;
  constraintImpactBasis: string;
  hardConstraintConflictRefs: string[];
  riskLevel: CandidateComparisonLevel;
  riskCoverage: string[];
  unknowns: string[];
  whyNot: string[];
  conclusion: CandidateComparisonConclusion;
  evidenceRefs: string[];
  createdAt: string;
  contentDifference?: string;
  whyPreferred?: string;
  conflictWith?: string[];
};
