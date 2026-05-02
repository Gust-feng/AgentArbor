import type { DirectionHandoffPackage } from "./contracts.js";
import type { AddDirectionHandoffPackageIssue } from "./validation-issues.js";

export function validateCandidateReferenceIndex(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
): void {
  const sourceCandidateIds = new Set(pkg.directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id));
  const indexedCandidateIds = new Set(pkg.candidateReferenceIndex.map((candidate) => candidate.candidateId));

  for (const candidateId of sourceCandidateIds) {
    if (!indexedCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_MISSING_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index is missing source candidate ${candidateId}.`
      );
    }
  }

  const sourceCandidateById = new Map(pkg.directionHandoff.sourceCandidateRefs.map((candidate) => [candidate.id, candidate]));
  for (const indexedCandidate of pkg.candidateReferenceIndex) {
    const sourceCandidate = sourceCandidateById.get(indexedCandidate.candidateId);
    if (sourceCandidate !== undefined && indexedCandidate.status !== sourceCandidate.status) {
      addIssue(
        "CANDIDATE_INDEX_STATUS_MISMATCH",
        "candidateReferenceIndex",
        `Candidate reference index status for ${indexedCandidate.candidateId} must match the DirectionHandoff source candidate status.`
      );
    }
  }

  for (const candidateId of indexedCandidateIds) {
    if (!sourceCandidateIds.has(candidateId)) {
      addIssue(
        "CANDIDATE_INDEX_HAS_NON_SOURCE_REF",
        "candidateReferenceIndex",
        `Candidate reference index contains non-source candidate ${candidateId}.`
      );
    }
  }
}
