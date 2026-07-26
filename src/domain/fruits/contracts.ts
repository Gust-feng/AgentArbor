export type ExperienceCandidate = {
  id: string;
  /** PathMemory (ADR-0032) is the only run-level source for future candidates. */
  sourcePathMemoryId: string;
  appliesToGoalTypes: string[];
  reusablePattern: string;
  preconditions: string[];
  requiredVerificationGates: string[];
  doNotApplyWhen: string[];
  confidence: "low" | "medium" | "high";
  governanceStatus: "captured" | "under_review" | "accepted" | "rejected" | "expired";
};

export type PathBias = {
  id: string;
  sourceExperienceCandidateId: string;
  appliesToGoalTypes: string[];
  preconditions: string[];
  preferredNodes: string[];
  preferredCapabilities: string[];
  requiredVerificationGates: string[];
  knownFailureModes: string[];
  doNotApplyWhen: string[];
  confidence: "low" | "medium" | "high";
};

export type FruitCandidate = {
  id: string;
  sourceGoalId: string;
  artifactIds: string[];
  verificationIds: string[];
  proposedBy: string;
  governanceStatus: "proposed" | "approved_for_soil_review" | "rejected";
  createdAt: string;
};
