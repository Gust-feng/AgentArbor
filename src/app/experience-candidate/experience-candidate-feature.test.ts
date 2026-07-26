import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ExperienceCandidateFeatureError,
  type ExperienceCandidateContentInput,
  type ExperienceCandidateEvent,
  type ExperienceCandidateFeature,
  type ExperienceCandidateRepository,
  type ExperienceCandidateRevisionRecord,
} from "./contracts.js";
import { createFileSystemExperienceCandidateRepository } from "./file-system-repository.js";
import {
  createExperienceCandidateFeature,
  type CreateExperienceCandidateFeatureInput,
} from "./experience-candidate-feature.js";

const KNOWN_SOURCES = new Set([
  "path-memory:ordinary:run-a",
  "path-memory:ordinary:run-b",
]);

async function tempRepository(t: test.TestContext): Promise<ExperienceCandidateRepository> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-feature-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return createFileSystemExperienceCandidateRepository(root);
}

function ids(start = 0): (prefix: string) => string {
  let next = start;
  return (prefix) => `${prefix}-${(next += 1).toString().padStart(4, "0")}`;
}

function clock(iso = "2026-07-26T10:00:00.000Z"): () => Date {
  return () => new Date(iso);
}

async function featureFixture(
  t: test.TestContext,
  overrides?: Partial<CreateExperienceCandidateFeatureInput>,
): Promise<ExperienceCandidateFeature> {
  return createExperienceCandidateFeature({
    repository: await tempRepository(t),
    pathMemoryLookup: async (memoryId) => KNOWN_SOURCES.has(memoryId),
    idFactory: ids(),
    now: clock(),
    ...overrides,
  });
}

function contentFixture(overrides?: Partial<ExperienceCandidateContentInput>): ExperienceCandidateContentInput {
  return {
    sourcePathMemoryIds: ["path-memory:ordinary:run-a"],
    title: "Build check workflow",
    statement: "Run the build before answering build questions",
    appliesWhen: ["user asks about build status"],
    notApplicableWhen: [],
    confidence: "medium",
    ...overrides,
  };
}

test("propose creates revision 1 with proposed status and publishes one event", async (t) => {
  const feature = await featureFixture(t);
  const events: ExperienceCandidateEvent[] = [];
  feature.events.subscribe((event) => events.push(event));

  const candidate = await feature.commands.propose(contentFixture());
  assert.match(candidate.candidateId, /^experience-candidate:/);
  assert.equal(candidate.revision, 1);
  assert.deepEqual(candidate.governance, { status: "proposed" });
  assert.deepEqual(candidate.origin, { kind: "proposed" });
  assert.equal(candidate.createdAt, "2026-07-26T10:00:00.000Z");
  assert.equal(candidate.createdBy, "user");

  assert.deepEqual(await feature.queries.getHead(candidate.candidateId), candidate);
  assert.deepEqual(events, [{ type: "experience_candidate.proposed", candidate }]);
  await feature.release();
});

test("propose rejects unknown source PathMemory ids and names them", async (t) => {
  const feature = await featureFixture(t);
  await assert.rejects(
    feature.commands.propose(contentFixture({
      sourcePathMemoryIds: ["path-memory:ordinary:run-a", "path-memory:ordinary:missing"],
    })),
    (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_source_not_found");
      assert.match(error.message, /path-memory:ordinary:missing/);
      return true;
    },
  );
  assert.equal((await feature.queries.listHeads()).length, 0);
  await feature.release();
});

test("revise replaces content, resets status to proposed and records fromRevision", async (t) => {
  const feature = await featureFixture(t);
  const events: ExperienceCandidateEvent[] = [];
  feature.events.subscribe((event) => events.push(event));
  const proposed = await feature.commands.propose(contentFixture());
  const accepted = await feature.commands.accept(proposed.candidateId, { reason: "looks right" });

  const revised = await feature.commands.revise(proposed.candidateId, contentFixture({
    sourcePathMemoryIds: ["path-memory:ordinary:run-b"],
    title: "Broader build workflow",
    statement: "Always verify with the project build command",
    appliesWhen: ["build or typecheck questions"],
    notApplicableWhen: ["read-only documentation tasks"],
    confidence: "high",
  }));
  assert.equal(revised.revision, accepted.revision + 1);
  assert.deepEqual(revised.governance, { status: "proposed" });
  assert.deepEqual(revised.origin, { kind: "revised", fromRevision: accepted.revision });
  assert.equal(revised.title, "Broader build workflow");
  assert.deepEqual(revised.sourcePathMemoryIds, ["path-memory:ordinary:run-b"]);

  assert.deepEqual(await feature.queries.getHead(proposed.candidateId), revised);
  // History remains immutable and fully readable.
  assert.deepEqual(
    (await feature.queries.listRevisions(proposed.candidateId)).map((record) => record.revision),
    [1, 2, 3],
  );
  assert.deepEqual(events.map((event) => event.type), [
    "experience_candidate.proposed",
    "experience_candidate.decided",
    "experience_candidate.revised",
  ]);
  await feature.release();
});

test("revise validates sources but decisions do not", async (t) => {
  const availableSources = new Set(KNOWN_SOURCES);
  const feature = await featureFixture(t, {
    pathMemoryLookup: async (memoryId) => availableSources.has(memoryId),
  });
  const proposed = await feature.commands.propose(contentFixture());

  await assert.rejects(
    feature.commands.revise(proposed.candidateId, contentFixture({
      sourcePathMemoryIds: ["path-memory:ordinary:gone"],
    })),
    (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_source_not_found");
      return true;
    },
  );

  // Sources may disappear after the proposal; archival references are allowed
  // to be unavailable at decision time (ADR-0032 §7).
  availableSources.clear();
  const accepted = await feature.commands.accept(proposed.candidateId);
  assert.equal(accepted.governance.status, "accepted");
  await feature.release();
});

test("accept and reject require a proposed head and stamp decidedAt", async (t) => {
  const feature = await featureFixture(t);
  const first = await feature.commands.propose(contentFixture());
  const second = await feature.commands.propose(contentFixture({ title: "Second candidate" }));

  const accepted = await feature.commands.accept(first.candidateId, { reason: "works" });
  assert.equal(accepted.governance.status, "accepted");
  assert.equal(accepted.governance.decidedAt, "2026-07-26T10:00:00.000Z");
  assert.equal(accepted.governance.reason, "works");
  assert.deepEqual(accepted.origin, { kind: "decision", fromRevision: 1 });
  assert.equal(accepted.statement, first.statement);

  const rejected = await feature.commands.reject(second.candidateId);
  assert.equal(rejected.governance.status, "rejected");
  assert.equal(rejected.governance.decidedAt, "2026-07-26T10:00:00.000Z");
  await feature.release();
});

test("governance transitions reject every illegal combination", async (t) => {
  const feature = await featureFixture(t);
  const expectInvalid = async (operation: Promise<unknown>): Promise<void> => {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_invalid_transition");
      return true;
    });
  };

  // proposed: retire is illegal.
  const proposed = await feature.commands.propose(contentFixture());
  await expectInvalid(feature.commands.retire(proposed.candidateId));

  // accepted: accept/reject are illegal; retire is legal.
  const toAccept = await feature.commands.propose(contentFixture());
  await feature.commands.accept(toAccept.candidateId);
  await expectInvalid(feature.commands.accept(toAccept.candidateId));
  await expectInvalid(feature.commands.reject(toAccept.candidateId));

  // rejected: accept/reject/retire are all illegal.
  const toReject = await feature.commands.propose(contentFixture());
  await feature.commands.reject(toReject.candidateId);
  await expectInvalid(feature.commands.accept(toReject.candidateId));
  await expectInvalid(feature.commands.reject(toReject.candidateId));
  await expectInvalid(feature.commands.retire(toReject.candidateId));

  // retired is terminal: no decision and no revise.
  const toRetire = await feature.commands.propose(contentFixture());
  await feature.commands.accept(toRetire.candidateId);
  await feature.commands.retire(toRetire.candidateId);
  await expectInvalid(feature.commands.accept(toRetire.candidateId));
  await expectInvalid(feature.commands.reject(toRetire.candidateId));
  await expectInvalid(feature.commands.retire(toRetire.candidateId));
  await expectInvalid(feature.commands.revise(toRetire.candidateId, contentFixture()));

  // rejected heads may still be revised back into governance.
  const revived = await feature.commands.revise(toReject.candidateId, contentFixture());
  assert.equal(revived.governance.status, "proposed");
  await feature.release();
});

test("commands on unknown candidates report not found", async (t) => {
  const feature = await featureFixture(t);
  for (const operation of [
    feature.commands.accept("experience-candidate:missing"),
    feature.commands.revise("experience-candidate:missing", contentFixture()),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_not_found");
      return true;
    });
  }
  assert.equal(await feature.queries.getHead("experience-candidate:missing"), undefined);
  assert.equal(await feature.queries.getRevision("experience-candidate:missing", 1), undefined);
  await feature.release();
});

test("concurrent revise and decision produce exactly one legal head without gaps", async (t) => {
  const feature = await featureFixture(t);
  const proposed = await feature.commands.propose(contentFixture());

  const results = await Promise.allSettled([
    feature.commands.revise(proposed.candidateId, contentFixture({ statement: "revised statement" })),
    feature.commands.accept(proposed.candidateId),
  ]);
  // Both read the same head concurrently; the repository chain guard lets
  // exactly one become revision 2 while the loser fails as a conflict.
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  assert.equal(fulfilled.length, 1);
  for (const result of results) {
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof ExperienceCandidateFeatureError);
      assert.equal(result.reason.code, "experience_candidate_revision_conflict");
    }
  }

  const head = await feature.queries.getHead(proposed.candidateId);
  assert.equal(head?.revision, 2);
  const revisions = await feature.queries.listRevisions(proposed.candidateId);
  assert.deepEqual(revisions.map((record) => record.revision), [1, 2]);
  await feature.release();
});

test("listHeads filters by status and source PathMemory id", async (t) => {
  const feature = await featureFixture(t);
  const first = await feature.commands.propose(contentFixture());
  const second = await feature.commands.propose(contentFixture({
    sourcePathMemoryIds: ["path-memory:ordinary:run-b"],
  }));
  await feature.commands.accept(second.candidateId);

  assert.deepEqual(
    (await feature.queries.listHeads({ status: "proposed" })).map((record) => record.candidateId),
    [first.candidateId],
  );
  assert.deepEqual(
    (await feature.queries.listHeads({ sourcePathMemoryId: "path-memory:ordinary:run-b" })).map((record) => record.candidateId),
    [second.candidateId],
  );
  assert.equal((await feature.queries.listHeads()).length, 2);
  await feature.release();
});

test("a restarted feature instance reads the same head and history", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-restart-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const lookup = async (memoryId: string): Promise<boolean> => KNOWN_SOURCES.has(memoryId);
  const first = createExperienceCandidateFeature({
    repository: createFileSystemExperienceCandidateRepository(root),
    pathMemoryLookup: lookup,
    idFactory: ids(),
    now: clock(),
  });
  const proposed = await first.commands.propose(contentFixture());
  const accepted = await first.commands.accept(proposed.candidateId);
  await first.release();

  const restarted = createExperienceCandidateFeature({
    repository: createFileSystemExperienceCandidateRepository(root),
    pathMemoryLookup: lookup,
    idFactory: ids(50),
    now: clock(),
  });
  assert.deepEqual(await restarted.queries.getHead(proposed.candidateId), accepted);
  assert.deepEqual(await restarted.queries.listRevisions(proposed.candidateId), [proposed, accepted]);
  const retired = await restarted.commands.retire(proposed.candidateId);
  assert.equal(retired.revision, 3);
  await restarted.release();
});

test("listener failures never affect committed candidates and events fire once each", async (t) => {
  const feature = await featureFixture(t);
  const events: ExperienceCandidateEvent[] = [];
  feature.events.subscribe(() => {
    throw new Error("listener exploded");
  });
  feature.events.subscribe((event) => events.push(event));

  const proposed = await feature.commands.propose(contentFixture());
  const revised = await feature.commands.revise(proposed.candidateId, contentFixture({ title: "Revised" }));
  const accepted = await feature.commands.accept(proposed.candidateId);
  assert.deepEqual(events, [
    { type: "experience_candidate.proposed", candidate: proposed },
    { type: "experience_candidate.revised", candidate: revised },
    { type: "experience_candidate.decided", candidate: accepted },
  ]);
  assert.notEqual(await feature.queries.getHead(proposed.candidateId), undefined);
  await feature.release();
});

test("release drains accepted work and rejects new commands and queries", async (t) => {
  const repository = await tempRepository(t);
  let releaseGate: () => void = () => undefined;
  const gated = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const slowRepository: ExperienceCandidateRepository = {
    ...repository,
    async append(record: ExperienceCandidateRevisionRecord) {
      await gated;
      return repository.append(record);
    },
  };
  const feature = createExperienceCandidateFeature({
    repository: slowRepository,
    pathMemoryLookup: async () => true,
    idFactory: ids(),
    now: clock(),
  });
  const inFlight = feature.commands.propose(contentFixture());

  const released = feature.release();
  releaseGate();
  await released;

  const candidate = await inFlight;
  assert.notEqual(await repository.getHead(candidate.candidateId), undefined);

  assert.throws(() => feature.commands.propose(contentFixture()), (error: unknown) => {
    assert.ok(error instanceof ExperienceCandidateFeatureError);
    assert.equal(error.code, "experience_candidate_feature_released");
    return true;
  });
  assert.throws(() => feature.queries.listHeads(), (error: unknown) => {
    assert.ok(error instanceof ExperienceCandidateFeatureError);
    assert.equal(error.code, "experience_candidate_feature_released");
    return true;
  });
});

test("repository failures surface as precise feature errors", async (t) => {
  const repository = await tempRepository(t);
  const failing: ExperienceCandidateRepository = {
    ...repository,
    append() {
      return Promise.reject(new ExperienceCandidateFeatureError("experience_candidate_repository_failure", "disk full"));
    },
  };
  const feature = createExperienceCandidateFeature({
    repository: failing,
    pathMemoryLookup: async () => true,
    idFactory: ids(),
  });
  await assert.rejects(feature.commands.propose(contentFixture()), (error: unknown) => {
    assert.ok(error instanceof ExperienceCandidateFeatureError);
    assert.equal(error.code, "experience_candidate_repository_failure");
    return true;
  });
  assert.equal((await repository.listHeads()).length, 0);
  await feature.release();
});
