import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { renameWithRetry } from "../../kernel/fs/atomic-write.js";
import { isNodeError, toPersistedJsonShape } from "../../kernel/values/index.js";
import {
  EXPERIENCE_CANDIDATE_SCHEMA_VERSION,
  ExperienceCandidateFeatureError,
  type ExperienceCandidateDocument,
  type ExperienceCandidateListFilter,
  type ExperienceCandidateRepository,
  type ExperienceCandidateRevisionRecord,
} from "./contracts.js";

const originSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("proposed") }).strict(),
  z.object({ kind: z.literal("revised"), fromRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("decision"), fromRevision: z.number().int().positive() }).strict(),
]);

const recordSchema = z.object({
  candidateId: z.string().min(1),
  revision: z.number().int().positive(),
  sourcePathMemoryIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  appliesWhen: z.array(z.string().min(1)).min(1),
  notApplicableWhen: z.array(z.string().min(1)),
  confidence: z.enum(["low", "medium", "high"]),
  governance: z.object({
    status: z.enum(["proposed", "accepted", "rejected", "retired"]),
    decidedAt: z.string().min(1).optional(),
    reason: z.string().optional(),
  }).strict(),
  origin: originSchema,
  createdAt: z.string().min(1),
  createdBy: z.literal("user"),
}).strict().superRefine((record, context) => {
  if (record.governance.status !== "proposed" && record.governance.decidedAt === undefined) {
    context.addIssue({
      code: "custom",
      message: "a decided governance status requires decidedAt",
      path: ["governance", "decidedAt"],
    });
  }
  // A candidate that is still proposed has no decision; carrying decidedAt
  // would fabricate a decision fact that never happened.
  if (record.governance.status === "proposed" && record.governance.decidedAt !== undefined) {
    context.addIssue({
      code: "custom",
      message: "a proposed candidate cannot carry decidedAt",
      path: ["governance", "decidedAt"],
    });
  }
  if (record.revision === 1 && record.origin.kind !== "proposed") {
    context.addIssue({ code: "custom", message: "revision 1 must originate from a proposal", path: ["origin"] });
  }
  if (record.revision > 1 && record.origin.kind === "proposed") {
    context.addIssue({ code: "custom", message: "later revisions require a fromRevision origin", path: ["origin"] });
  }
  if (record.origin.kind !== "proposed" && record.origin.fromRevision >= record.revision) {
    context.addIssue({
      code: "custom",
      message: "origin fromRevision must be lower than the revision itself",
      path: ["origin", "fromRevision"],
    });
  }
});

const documentSchema = z.object({
  schemaVersion: z.literal(EXPERIENCE_CANDIDATE_SCHEMA_VERSION),
  record: recordSchema,
}).strict();

export function validateExperienceCandidateRecord(
  record: ExperienceCandidateRevisionRecord,
): ExperienceCandidateRevisionRecord {
  const result = recordSchema.safeParse(record);
  if (!result.success) {
    throw new ExperienceCandidateFeatureError(
      "experience_candidate_snapshot_incompatible",
      `ExperienceCandidate ${record.candidateId} revision ${record.revision} is invalid: ${z.prettifyError(result.error)}`,
    );
  }
  return toPersistedJsonShape(result.data);
}

export function createFileSystemExperienceCandidateRepository(rootDir: string): ExperienceCandidateRepository {
  const recordsDir = path.join(rootDir, "records");
  /** Per-candidate FIFO: concurrent revise/decision attempts serialize on one queue. */
  const candidateQueues = new Map<string, Promise<void>>();

  const enqueue = <T>(candidateId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = candidateQueues.get(candidateId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    candidateQueues.set(candidateId, tail);
    void tail.finally(() => {
      if (candidateQueues.get(candidateId) === tail) candidateQueues.delete(candidateId);
    });
    return result;
  };

  function candidateDir(candidateId: string): string {
    return path.join(recordsDir, encodeURIComponent(candidateId));
  }

  function revisionPath(candidateId: string, revision: number): string {
    return path.join(candidateDir(candidateId), `${revision}.json`);
  }

  async function readRevision(
    candidateId: string,
    revision: number,
  ): Promise<ExperienceCandidateRevisionRecord | undefined> {
    const raw = await readJson(revisionPath(candidateId, revision), candidateId, revision);
    if (raw === undefined) return undefined;
    const result = documentSchema.safeParse(raw);
    if (
      !result.success ||
      result.data.record.candidateId !== candidateId ||
      result.data.record.revision !== revision
    ) {
      throw new ExperienceCandidateFeatureError(
        "experience_candidate_snapshot_incompatible",
        `ExperienceCandidate ${candidateId} revision ${revision} is incompatible with ${EXPERIENCE_CANDIDATE_SCHEMA_VERSION}: ${result.success ? "record identity is invalid" : z.prettifyError(result.error)}`,
      );
    }
    return toPersistedJsonShape(result.data.record);
  }

  async function listRevisionNumbers(candidateId: string): Promise<readonly number[]> {
    const entries = await fs.readdir(candidateDir(candidateId), { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    });
    const revisions: number[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const parsed = Number(entry.name.slice(0, -".json".length));
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ExperienceCandidateFeatureError(
          "experience_candidate_snapshot_incompatible",
          `ExperienceCandidate ${candidateId} revision file name ${entry.name} is invalid`,
        );
      }
      revisions.push(parsed);
    }
    return revisions.sort((left, right) => left - right);
  }

  async function readHead(candidateId: string): Promise<ExperienceCandidateRevisionRecord | undefined> {
    const revisions = await listRevisionNumbers(candidateId);
    const head = revisions.at(-1);
    if (head === undefined) return undefined;
    // A corrupted head revision must fail loudly; falling back to an older
    // revision would present stale content as the current head.
    return readRevision(candidateId, head);
  }

  return {
    append(record) {
      return enqueue(record.candidateId, async () => {
        const validated = validateExperienceCandidateRecord(record);
        const target = revisionPath(validated.candidateId, validated.revision);
        const exists = await fs.access(target).then(() => true, () => false);
        if (exists) {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_revision_conflict",
            `ExperienceCandidate ${validated.candidateId} revision ${validated.revision} already exists`,
          );
        }
        // Revisions form a gapless audit chain: the repository is the
        // persistence boundary, so it must reject holes even when a caller
        // bypasses the feature (imports, fixtures, bugs).
        const storedRevisions = await listRevisionNumbers(validated.candidateId);
        const highest = storedRevisions.at(-1) ?? 0;
        if (validated.revision !== highest + 1) {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_revision_conflict",
            `ExperienceCandidate ${validated.candidateId} revision ${validated.revision} does not continue the stored head revision ${highest}`,
          );
        }
        if (validated.origin.kind !== "proposed" && validated.origin.fromRevision !== validated.revision - 1) {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_revision_conflict",
            `ExperienceCandidate ${validated.candidateId} revision ${validated.revision} must originate from revision ${validated.revision - 1}, not ${validated.origin.fromRevision}`,
          );
        }
        const document: ExperienceCandidateDocument = {
          schemaVersion: EXPERIENCE_CANDIDATE_SCHEMA_VERSION,
          record: validated,
        };
        try {
          await writeJsonAtomically(target, document);
        } catch (error) {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_repository_failure",
            `ExperienceCandidate ${validated.candidateId} revision ${validated.revision} could not be persisted`,
            { cause: error },
          );
        }
      });
    },
    getRevision(candidateId, revision) {
      return readRevision(candidateId, revision);
    },
    getHead(candidateId) {
      return readHead(candidateId);
    },
    async listRevisions(candidateId) {
      const revisions = await listRevisionNumbers(candidateId);
      const records: ExperienceCandidateRevisionRecord[] = [];
      for (const revision of revisions) {
        const record = await readRevision(candidateId, revision);
        if (record === undefined) {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_snapshot_incompatible",
            `ExperienceCandidate ${candidateId} revision ${revision} disappeared while listing history`,
          );
        }
        records.push(record);
      }
      return records;
    },
    async listHeads(filter?: ExperienceCandidateListFilter) {
      const limit = Math.max(0, Math.floor(filter?.limit ?? Number.MAX_SAFE_INTEGER));
      const entries = await fs.readdir(recordsDir, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) return [];
        throw error;
      });
      const heads: ExperienceCandidateRevisionRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".tmp") continue;
        let candidateId: string;
        try {
          candidateId = decodeURIComponent(entry.name);
        } catch {
          throw new ExperienceCandidateFeatureError(
            "experience_candidate_snapshot_incompatible",
            `ExperienceCandidate directory name ${entry.name} is invalid`,
          );
        }
        const head = await readHead(candidateId);
        if (head === undefined) continue;
        if (filter?.status !== undefined && head.governance.status !== filter.status) continue;
        if (
          filter?.sourcePathMemoryId !== undefined &&
          !head.sourcePathMemoryIds.includes(filter.sourcePathMemoryId)
        ) continue;
        heads.push(head);
      }
      heads.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.candidateId.localeCompare(right.candidateId));
      return heads.slice(0, limit);
    },
  };
}

async function readJson(filePath: string, candidateId: string, revision: number): Promise<unknown | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ExperienceCandidateFeatureError(
      "experience_candidate_snapshot_incompatible",
      `ExperienceCandidate ${candidateId} revision ${revision} stored JSON is invalid`,
    );
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempDirectory = path.join(path.dirname(directory), ".tmp");
  const tempPath = path.join(tempDirectory, `${path.basename(directory)}.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

