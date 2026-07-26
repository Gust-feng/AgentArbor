import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXPERIENCE_CANDIDATE_SCHEMA_VERSION,
  ExperienceCandidateFeatureError,
  type ExperienceCandidateRevisionRecord,
} from "./contracts.js";
import { createFileSystemExperienceCandidateRepository } from "./file-system-repository.js";

async function tempRoot(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-experience-candidate-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return root;
}

export function candidateRecordFixture(
  candidateId: string,
  overrides?: Partial<ExperienceCandidateRevisionRecord>,
): ExperienceCandidateRevisionRecord {
  return {
    candidateId,
    revision: 1,
    sourcePathMemoryIds: ["path-memory:ordinary:run-a"],
    title: "Build check workflow",
    statement: "Run the build before answering build questions",
    appliesWhen: ["user asks about build status"],
    notApplicableWhen: ["workspace has no build script"],
    confidence: "medium",
    governance: { status: "proposed" },
    origin: { kind: "proposed" },
    createdAt: "2026-07-26T10:00:00.000Z",
    createdBy: "user",
    ...overrides,
  };
}

function revisionOf(
  base: ExperienceCandidateRevisionRecord,
  revision: number,
  overrides?: Partial<ExperienceCandidateRevisionRecord>,
): ExperienceCandidateRevisionRecord {
  return {
    ...base,
    revision,
    origin: { kind: "revised", fromRevision: revision - 1 },
    createdAt: `2026-07-26T10:0${revision}:00.000Z`,
    ...overrides,
  };
}

test("append persists an immutable revision that reads back identically", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const record = candidateRecordFixture("experience-candidate:one");
  await repository.append(record);
  assert.deepEqual(await repository.getRevision(record.candidateId, 1), record);
  assert.deepEqual(await repository.getHead(record.candidateId), record);
  assert.deepEqual(await repository.listRevisions(record.candidateId), [record]);
});

test("append refuses to overwrite an existing revision file", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const record = candidateRecordFixture("experience-candidate:dup");
  await repository.append(record);
  await assert.rejects(
    repository.append({ ...record, title: "Different content" }),
    (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_revision_conflict");
      return true;
    },
  );
  assert.deepEqual(await repository.getRevision(record.candidateId, 1), record);
});

test("concurrent duplicate appends converge to exactly one revision file", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemExperienceCandidateRepository(root);
  const record = candidateRecordFixture("experience-candidate:race");
  const results = await Promise.allSettled([
    repository.append(record),
    repository.append({ ...record, statement: "competing writer" }),
    repository.append(record),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof ExperienceCandidateFeatureError);
      assert.equal(result.reason.code, "experience_candidate_revision_conflict");
    }
  }
  const files = await fs.readdir(path.join(root, "records", encodeURIComponent(record.candidateId)));
  assert.deepEqual(files.filter((name) => name.endsWith(".json")), ["1.json"]);
});

test("head is the highest revision and history stays readable", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const first = candidateRecordFixture("experience-candidate:history");
  const second = revisionOf(first, 2, { statement: "Refined statement" });
  const third = revisionOf(first, 3, {
    governance: { status: "accepted", decidedAt: "2026-07-26T10:05:00.000Z" },
    origin: { kind: "decision", fromRevision: 2 },
  });
  await repository.append(first);
  await repository.append(second);
  await repository.append(third);

  assert.equal((await repository.getHead(first.candidateId))?.revision, 3);
  assert.deepEqual(
    (await repository.listRevisions(first.candidateId)).map((record) => record.revision),
    [1, 2, 3],
  );
  assert.deepEqual(await repository.getRevision(first.candidateId, 2), second);
});

test("invalid records are rejected before touching disk", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const base = candidateRecordFixture("experience-candidate:invalid");

  const rejects = async (record: ExperienceCandidateRevisionRecord): Promise<void> => {
    await assert.rejects(repository.append(record), (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_snapshot_incompatible");
      return true;
    });
  };

  await rejects({ ...base, sourcePathMemoryIds: [] });
  await rejects({ ...base, title: "" });
  await rejects({ ...base, appliesWhen: [] });
  // A decided status without decidedAt is not a governance fact.
  await rejects({ ...base, governance: { status: "accepted" } });
  // A candidate still under proposal cannot carry a decision timestamp.
  await rejects({ ...base, governance: { status: "proposed", decidedAt: "2026-07-26T10:01:00.000Z" } });
  // Revision 1 cannot claim to derive from an earlier revision.
  await rejects({ ...base, origin: { kind: "revised", fromRevision: 1 } });
  // Later revisions must reference where they came from.
  await rejects({ ...base, revision: 2, createdAt: base.createdAt });

  assert.equal(await repository.getHead(base.candidateId), undefined);
});

test("append rejects revisions that break the gapless audit chain", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const base = candidateRecordFixture("experience-candidate:chain");

  const rejectsConflict = async (record: ExperienceCandidateRevisionRecord): Promise<void> => {
    await assert.rejects(repository.append(record), (error: unknown) => {
      assert.ok(error instanceof ExperienceCandidateFeatureError);
      assert.equal(error.code, "experience_candidate_revision_conflict");
      return true;
    });
  };

  // Revision 2 without revision 1 must not become a readable head.
  await rejectsConflict(revisionOf(base, 2));
  assert.equal(await repository.getHead(base.candidateId), undefined);

  await repository.append(base);
  // Skipping revision 2 entirely is a hole in the audit chain.
  await rejectsConflict(revisionOf(base, 3, { origin: { kind: "revised", fromRevision: 2 } }));

  // The legitimate continuation still works after the rejections.
  const second = revisionOf(base, 2);
  await repository.append(second);

  // A correct next revision number pointing at a stale origin is also rejected.
  await rejectsConflict(revisionOf(base, 3, { origin: { kind: "revised", fromRevision: 1 } }));

  assert.deepEqual(await repository.getHead(base.candidateId), second);
  assert.deepEqual(
    (await repository.listRevisions(base.candidateId)).map((record) => record.revision),
    [1, 2],
  );
});

test("corrupted or unknown schema head fails loudly instead of falling back", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemExperienceCandidateRepository(root);
  const first = candidateRecordFixture("experience-candidate:corrupt");
  const second = revisionOf(first, 2);
  await repository.append(first);
  await repository.append(second);
  const headFile = path.join(root, "records", encodeURIComponent(first.candidateId), "2.json");

  await fs.writeFile(headFile, "{ not json", "utf8");
  await assert.rejects(repository.getHead(first.candidateId), (error: unknown) => {
    assert.ok(error instanceof ExperienceCandidateFeatureError);
    assert.equal(error.code, "experience_candidate_snapshot_incompatible");
    return true;
  });
  await assert.rejects(repository.listRevisions(first.candidateId));

  await fs.writeFile(
    headFile,
    JSON.stringify({ schemaVersion: "experience-candidate/v999", record: second }),
    "utf8",
  );
  await assert.rejects(repository.getHead(first.candidateId), (error: unknown) => {
    assert.ok(error instanceof ExperienceCandidateFeatureError);
    assert.equal(error.code, "experience_candidate_snapshot_incompatible");
    return true;
  });
  // Uncorrupted earlier revisions stay individually readable.
  assert.deepEqual(await repository.getRevision(first.candidateId, 1), first);
});

test("listHeads filters by status and source id with limit", async (t) => {
  const repository = createFileSystemExperienceCandidateRepository(await tempRoot(t));
  const proposed = candidateRecordFixture("experience-candidate:list-a", {
    createdAt: "2026-07-26T10:01:00.000Z",
  });
  const accepted = candidateRecordFixture("experience-candidate:list-b", {
    sourcePathMemoryIds: ["path-memory:ordinary:run-b"],
    createdAt: "2026-07-26T10:02:00.000Z",
  });
  const acceptedHead = revisionOf(accepted, 2, {
    governance: { status: "accepted", decidedAt: "2026-07-26T10:03:00.000Z" },
    origin: { kind: "decision", fromRevision: 1 },
    createdAt: "2026-07-26T10:03:00.000Z",
  });
  await repository.append(proposed);
  await repository.append(accepted);
  await repository.append(acceptedHead);

  const all = await repository.listHeads();
  assert.deepEqual(all.map((record) => record.candidateId), [
    "experience-candidate:list-b",
    "experience-candidate:list-a",
  ]);
  assert.deepEqual(
    (await repository.listHeads({ status: "accepted" })).map((record) => record.candidateId),
    ["experience-candidate:list-b"],
  );
  assert.deepEqual(
    (await repository.listHeads({ sourcePathMemoryId: "path-memory:ordinary:run-a" })).map((record) => record.candidateId),
    ["experience-candidate:list-a"],
  );
  assert.equal((await repository.listHeads({ limit: 1 })).length, 1);
  assert.equal((await repository.listHeads({ status: "retired" })).length, 0);
});

test("a rebuilt instance reads the same head and history", async (t) => {
  const root = await tempRoot(t);
  const first = candidateRecordFixture("experience-candidate:rebuild");
  const second = revisionOf(first, 2, { confidence: "high" });
  const writer = createFileSystemExperienceCandidateRepository(root);
  await writer.append(first);
  await writer.append(second);

  const rebuilt = createFileSystemExperienceCandidateRepository(root);
  assert.deepEqual(await rebuilt.getHead(first.candidateId), second);
  assert.deepEqual(await rebuilt.listRevisions(first.candidateId), [first, second]);
  assert.equal((await rebuilt.listHeads()).length, 1);
});

test("stored document uses the v1 schema envelope", async (t) => {
  const root = await tempRoot(t);
  const repository = createFileSystemExperienceCandidateRepository(root);
  const record = candidateRecordFixture("experience-candidate:envelope");
  await repository.append(record);
  const raw = JSON.parse(
    await fs.readFile(
      path.join(root, "records", encodeURIComponent(record.candidateId), "1.json"),
      "utf8",
    ),
  ) as { schemaVersion: string; record: unknown };
  assert.equal(raw.schemaVersion, EXPERIENCE_CANDIDATE_SCHEMA_VERSION);
  assert.deepEqual(raw.record, record);
});
