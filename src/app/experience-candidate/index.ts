/**
 * Historical ExperienceCandidate implementation retained as a buildable
 * orphan for contract and repository regression coverage. It has no
 * production composition, route or settings owner and must not be reattached
 * as a source or migration input for the new path-dependencies feature.
 */
export {
  EXPERIENCE_CANDIDATE_SCHEMA_VERSION,
  ExperienceCandidateFeatureError,
  type ExperienceCandidateConfidence,
  type ExperienceCandidateContentInput,
  type ExperienceCandidateDecisionInput,
  type ExperienceCandidateDocument,
  type ExperienceCandidateEvent,
  type ExperienceCandidateFeature,
  type ExperienceCandidateFeatureErrorCode,
  type ExperienceCandidateGovernanceStatus,
  type ExperienceCandidateListFilter,
  type ExperienceCandidateOrigin,
  type ExperienceCandidateRepository,
  type ExperienceCandidateRevisionRecord,
} from "./contracts.js";
export { createFileSystemExperienceCandidateRepository } from "./file-system-repository.js";
export { createExperienceCandidateFeature } from "./experience-candidate-feature.js";
