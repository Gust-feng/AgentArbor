import { createId, type IdFactory } from "../../kernel/id.js";
import {
  ExperienceCandidateFeatureError,
  type ExperienceCandidateContentInput,
  type ExperienceCandidateDecisionInput,
  type ExperienceCandidateEvent,
  type ExperienceCandidateFeature,
  type ExperienceCandidateGovernanceStatus,
  type ExperienceCandidateRepository,
  type ExperienceCandidateRevisionRecord,
} from "./contracts.js";

export type CreateExperienceCandidateFeatureInput = {
  readonly repository: ExperienceCandidateRepository;
  /** Narrow cross-feature port: true when the referenced PathMemory exists. */
  readonly pathMemoryLookup: (memoryId: string) => Promise<boolean>;
  readonly idFactory?: IdFactory;
  readonly now?: () => Date;
};

type DecisionKind = "accept" | "reject" | "retire";

const DECISION_RULES: Record<DecisionKind, {
  readonly from: ExperienceCandidateGovernanceStatus;
  readonly to: ExperienceCandidateGovernanceStatus;
}> = {
  accept: { from: "proposed", to: "accepted" },
  reject: { from: "proposed", to: "rejected" },
  retire: { from: "accepted", to: "retired" },
};

/** "experience-candidate:<uuid>" derived from the shared id factory output. */
function newCandidateId(idFactory: IdFactory): string {
  const generated = idFactory("experience-candidate");
  const suffix = generated.startsWith("experience-candidate-")
    ? generated.slice("experience-candidate-".length)
    : generated;
  return `experience-candidate:${suffix}`;
}

export function createExperienceCandidateFeature(
  input: CreateExperienceCandidateFeatureInput,
): ExperienceCandidateFeature {
  const { repository, pathMemoryLookup } = input;
  const idFactory = input.idFactory ?? createId;
  const now = input.now ?? (() => new Date());
  const listeners = new Set<(event: ExperienceCandidateEvent) => void>();
  const pending = new Set<Promise<unknown>>();
  let released = false;

  function assertUsable(operation: string): void {
    if (released) {
      throw new ExperienceCandidateFeatureError(
        "experience_candidate_feature_released",
        `ExperienceCandidate feature is released and cannot ${operation}`,
      );
    }
  }

  function publish(event: ExperienceCandidateEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures never affect already committed candidate facts.
      }
    }
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    void operation.then(() => undefined, () => undefined).finally(() => {
      pending.delete(operation);
    });
    return operation;
  }

  async function assertSourcesExist(sourcePathMemoryIds: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const memoryId of sourcePathMemoryIds) {
      if (!(await pathMemoryLookup(memoryId))) missing.push(memoryId);
    }
    if (missing.length > 0) {
      throw new ExperienceCandidateFeatureError(
        "experience_candidate_source_not_found",
        `ExperienceCandidate source PathMemory not found: ${missing.join(", ")}`,
      );
    }
  }

  async function requireHead(candidateId: string): Promise<ExperienceCandidateRevisionRecord> {
    const head = await repository.getHead(candidateId);
    if (head === undefined) {
      throw new ExperienceCandidateFeatureError(
        "experience_candidate_not_found",
        `ExperienceCandidate ${candidateId} was not found`,
      );
    }
    return head;
  }

  async function decide(
    kind: DecisionKind,
    candidateId: string,
    decisionInput?: ExperienceCandidateDecisionInput,
  ): Promise<ExperienceCandidateRevisionRecord> {
    const rule = DECISION_RULES[kind];
    const head = await requireHead(candidateId);
    if (head.governance.status !== rule.from) {
      throw new ExperienceCandidateFeatureError(
        "experience_candidate_invalid_transition",
        `ExperienceCandidate ${candidateId} cannot ${kind} from status ${head.governance.status}`,
      );
    }
    // Decisions never re-validate sources: referenced PathMemory records may
    // already be deleted and archival references are allowed to be unavailable.
    const record: ExperienceCandidateRevisionRecord = {
      candidateId,
      revision: head.revision + 1,
      sourcePathMemoryIds: head.sourcePathMemoryIds,
      title: head.title,
      statement: head.statement,
      appliesWhen: head.appliesWhen,
      notApplicableWhen: head.notApplicableWhen,
      confidence: head.confidence,
      governance: {
        status: rule.to,
        decidedAt: now().toISOString(),
        ...(decisionInput?.reason === undefined ? {} : { reason: decisionInput.reason }),
      },
      origin: { kind: "decision", fromRevision: head.revision },
      createdAt: now().toISOString(),
      createdBy: "user",
    };
    await repository.append(record);
    publish({ type: "experience_candidate.decided", candidate: record });
    return record;
  }

  return {
    commands: {
      propose(contentInput: ExperienceCandidateContentInput) {
        assertUsable("propose a candidate");
        return track((async () => {
          await assertSourcesExist(contentInput.sourcePathMemoryIds);
          const record: ExperienceCandidateRevisionRecord = {
            candidateId: newCandidateId(idFactory),
            revision: 1,
            sourcePathMemoryIds: contentInput.sourcePathMemoryIds,
            title: contentInput.title,
            statement: contentInput.statement,
            appliesWhen: contentInput.appliesWhen,
            notApplicableWhen: contentInput.notApplicableWhen,
            confidence: contentInput.confidence,
            governance: { status: "proposed" },
            origin: { kind: "proposed" },
            createdAt: now().toISOString(),
            createdBy: "user",
          };
          await repository.append(record);
          publish({ type: "experience_candidate.proposed", candidate: record });
          return record;
        })());
      },
      revise(candidateId: string, contentInput: ExperienceCandidateContentInput) {
        assertUsable("revise a candidate");
        return track((async () => {
          const head = await requireHead(candidateId);
          if (head.governance.status === "retired") {
            throw new ExperienceCandidateFeatureError(
              "experience_candidate_invalid_transition",
              `ExperienceCandidate ${candidateId} is retired and cannot be revised`,
            );
          }
          await assertSourcesExist(contentInput.sourcePathMemoryIds);
          const record: ExperienceCandidateRevisionRecord = {
            candidateId,
            revision: head.revision + 1,
            sourcePathMemoryIds: contentInput.sourcePathMemoryIds,
            title: contentInput.title,
            statement: contentInput.statement,
            appliesWhen: contentInput.appliesWhen,
            notApplicableWhen: contentInput.notApplicableWhen,
            confidence: contentInput.confidence,
            governance: { status: "proposed" },
            origin: { kind: "revised", fromRevision: head.revision },
            createdAt: now().toISOString(),
            createdBy: "user",
          };
          await repository.append(record);
          publish({ type: "experience_candidate.revised", candidate: record });
          return record;
        })());
      },
      accept(candidateId: string, decisionInput?: ExperienceCandidateDecisionInput) {
        assertUsable("accept a candidate");
        return track(decide("accept", candidateId, decisionInput));
      },
      reject(candidateId: string, decisionInput?: ExperienceCandidateDecisionInput) {
        assertUsable("reject a candidate");
        return track(decide("reject", candidateId, decisionInput));
      },
      retire(candidateId: string, decisionInput?: ExperienceCandidateDecisionInput) {
        assertUsable("retire a candidate");
        return track(decide("retire", candidateId, decisionInput));
      },
    },
    queries: {
      getHead(candidateId) {
        assertUsable("read a candidate");
        return track(repository.getHead(candidateId));
      },
      getRevision(candidateId, revision) {
        assertUsable("read a candidate revision");
        return track(repository.getRevision(candidateId, revision));
      },
      listHeads(filter) {
        assertUsable("list candidates");
        return track(repository.listHeads(filter));
      },
      listRevisions(candidateId) {
        assertUsable("list candidate revisions");
        return track(repository.listRevisions(candidateId));
      },
    },
    events: {
      subscribe(listener) {
        assertUsable("subscribe to events");
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    async release() {
      if (released) return;
      released = true;
      listeners.clear();
      // Drain accepted work; release never invents failures for settled facts.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}
