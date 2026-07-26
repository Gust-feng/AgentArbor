export const EXPERIENCE_CANDIDATE_SCHEMA_VERSION = "experience-candidate/v1" as const;

export type ExperienceCandidateFeatureErrorCode =
  | "experience_candidate_feature_released"
  | "experience_candidate_not_found"
  | "experience_candidate_revision_conflict"
  | "experience_candidate_invalid_transition"
  | "experience_candidate_source_not_found"
  | "experience_candidate_snapshot_incompatible"
  | "experience_candidate_repository_failure";

/** Expected command/query failures that callers may map without parsing messages. */
export class ExperienceCandidateFeatureError extends Error {
  readonly name = "ExperienceCandidateFeatureError";

  constructor(
    readonly code: ExperienceCandidateFeatureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ExperienceCandidateGovernanceStatus = "proposed" | "accepted" | "rejected" | "retired";

export type ExperienceCandidateConfidence = "low" | "medium" | "high";

export type ExperienceCandidateOrigin =
  | { readonly kind: "proposed" }
  | { readonly kind: "revised"; readonly fromRevision: number }
  | { readonly kind: "decision"; readonly fromRevision: number };

export type ExperienceCandidateRevisionRecord = {
  /** "experience-candidate:<uuid>"; shared across every revision of one candidate. */
  readonly candidateId: string;
  /** Starts at 1 and grows by exactly one per change; each revision is immutable. */
  readonly revision: number;
  readonly sourcePathMemoryIds: readonly string[];
  readonly title: string;
  /** The reusable experience statement itself. */
  readonly statement: string;
  readonly appliesWhen: readonly string[];
  readonly notApplicableWhen: readonly string[];
  readonly confidence: ExperienceCandidateConfidence;
  readonly governance: {
    readonly status: ExperienceCandidateGovernanceStatus;
    readonly decidedAt?: string;
    readonly reason?: string;
  };
  readonly origin: ExperienceCandidateOrigin;
  readonly createdAt: string;
  /** Phase two only supports explicit user writes (ADR-0032 §3). */
  readonly createdBy: "user";
};

export type ExperienceCandidateDocument = {
  readonly schemaVersion: typeof EXPERIENCE_CANDIDATE_SCHEMA_VERSION;
  readonly record: ExperienceCandidateRevisionRecord;
};

export type ExperienceCandidateContentInput = {
  readonly sourcePathMemoryIds: readonly string[];
  readonly title: string;
  readonly statement: string;
  readonly appliesWhen: readonly string[];
  readonly notApplicableWhen: readonly string[];
  readonly confidence: ExperienceCandidateConfidence;
};

export type ExperienceCandidateDecisionInput = {
  readonly reason?: string;
};

export type ExperienceCandidateListFilter = {
  readonly status?: ExperienceCandidateGovernanceStatus;
  readonly sourcePathMemoryId?: string;
  readonly limit?: number;
};

export type ExperienceCandidateEvent =
  | { readonly type: "experience_candidate.proposed"; readonly candidate: ExperienceCandidateRevisionRecord }
  | { readonly type: "experience_candidate.revised"; readonly candidate: ExperienceCandidateRevisionRecord }
  | { readonly type: "experience_candidate.decided"; readonly candidate: ExperienceCandidateRevisionRecord };

export interface ExperienceCandidateRepository {
  /**
   * Persists one immutable (candidateId, revision) record. Throws
   * `experience_candidate_revision_conflict` when the revision already exists;
   * an existing revision file is never overwritten.
   */
  append(record: ExperienceCandidateRevisionRecord): Promise<void>;
  getRevision(candidateId: string, revision: number): Promise<ExperienceCandidateRevisionRecord | undefined>;
  /** Head is the highest revision; a corrupted head file fails loudly instead of falling back. */
  getHead(candidateId: string): Promise<ExperienceCandidateRevisionRecord | undefined>;
  listRevisions(candidateId: string): Promise<readonly ExperienceCandidateRevisionRecord[]>;
  listHeads(filter?: ExperienceCandidateListFilter): Promise<readonly ExperienceCandidateRevisionRecord[]>;
}

export interface ExperienceCandidateFeature {
  readonly commands: {
    propose(input: ExperienceCandidateContentInput): Promise<ExperienceCandidateRevisionRecord>;
    revise(candidateId: string, input: ExperienceCandidateContentInput): Promise<ExperienceCandidateRevisionRecord>;
    accept(candidateId: string, input?: ExperienceCandidateDecisionInput): Promise<ExperienceCandidateRevisionRecord>;
    reject(candidateId: string, input?: ExperienceCandidateDecisionInput): Promise<ExperienceCandidateRevisionRecord>;
    retire(candidateId: string, input?: ExperienceCandidateDecisionInput): Promise<ExperienceCandidateRevisionRecord>;
  };
  readonly queries: {
    getHead(candidateId: string): Promise<ExperienceCandidateRevisionRecord | undefined>;
    getRevision(candidateId: string, revision: number): Promise<ExperienceCandidateRevisionRecord | undefined>;
    listHeads(filter?: ExperienceCandidateListFilter): Promise<readonly ExperienceCandidateRevisionRecord[]>;
    listRevisions(candidateId: string): Promise<readonly ExperienceCandidateRevisionRecord[]>;
  };
  readonly events: {
    subscribe(listener: (event: ExperienceCandidateEvent) => void): () => void;
  };
  release(): Promise<void>;
}
