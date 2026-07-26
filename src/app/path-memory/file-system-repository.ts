import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { renameWithRetry } from "../../kernel/fs/atomic-write.js";
import { isNodeError, toPersistedJsonShape } from "../../kernel/values/index.js";
import {
  PATH_MEMORY_DELETION_SCHEMA_VERSION,
  PATH_MEMORY_SCHEMA_VERSION,
  PathMemoryFeatureError,
  pathMemoryIdForSource,
  type PathMemory,
  type PathMemoryCaptureResult,
  type PathMemoryDeletionDocument,
  type PathMemoryDeletionRecord,
  type PathMemoryDocument,
  type PathMemoryListFilter,
  type PathMemoryRepository,
} from "./contracts.js";

const toolStepSchema = z.object({
  ordinal: z.number().int().positive(),
  toolFactId: z.string().min(1),
  parentToolFactId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  durationMs: z.number().finite().nonnegative(),
  resultRef: z.string().min(1),
  error: z.object({
    domain: z.string().optional(),
    code: z.string().optional(),
    message: z.string(),
  }).strict().optional(),
}).strict();

const verificationSchema = z.union([
  z.object({
    status: z.enum(["verified", "failed"]),
    /** A formal verification conclusion without evidence is not a fact. */
    evidenceRefs: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    status: z.literal("not_recorded"),
    evidenceRefs: z.tuple([]),
  }).strict(),
]);

const outcomeSchema = z.discriminatedUnion("terminalStatus", [
  z.object({ terminalStatus: z.literal("completed"), answerRef: z.string().min(1) }).strict(),
  z.object({
    terminalStatus: z.literal("failed"),
    error: z.object({ code: z.string().min(1), message: z.string() }).strict(),
  }).strict(),
  z.object({ terminalStatus: z.literal("cancelled"), reason: z.string() }).strict(),
  z.object({
    terminalStatus: z.literal("blocked"),
    reason: z.object({ code: z.string().min(1), message: z.string() }).strict(),
    continueBy: z.literal("new_turn"),
  }).strict(),
]);

const memorySchema = z.object({
  id: z.string().min(1),
  source: z.object({
    feature: z.literal("ordinary"),
    runId: z.string().min(1),
    sourceRevision: z.number().int().positive(),
    conversationId: z.string().min(1),
    userTurnId: z.string().min(1),
    assistantTurnId: z.string().min(1),
    predecessorRunId: z.string().min(1).optional(),
    runCreatedAt: z.string().min(1),
    terminalAt: z.string().min(1),
  }).strict(),
  scope: z.object({
    workspaceRoot: z.string().min(1),
    workspaceSelection: z.enum(["default", "explicit"]),
  }).strict(),
  goal: z.object({
    userRequest: z.string(),
    taskContextRefs: z.array(z.string().min(1)),
  }).strict(),
  path: z.object({
    executionStarted: z.boolean(),
    toolSteps: z.array(toolStepSchema),
  }).strict(),
  outcome: outcomeSchema,
  verification: verificationSchema,
  evidenceRefs: z.array(z.string().min(1)),
  capturedAt: z.string().min(1),
}).strict().superRefine((memory, context) => {
  if (memory.id !== pathMemoryIdForSource(memory.source)) {
    context.addIssue({ code: "custom", message: "memory id must be deterministic for its source", path: ["id"] });
  }
  const ordinals = memory.path.toolSteps.map((step) => step.ordinal);
  if (new Set(ordinals).size !== ordinals.length) {
    context.addIssue({ code: "custom", message: "tool step ordinal is duplicated", path: ["path", "toolSteps"] });
  }
  const factIds = new Set(memory.path.toolSteps.map((step) => step.toolFactId));
  if (factIds.size !== memory.path.toolSteps.length) {
    context.addIssue({ code: "custom", message: "tool fact identity is duplicated", path: ["path", "toolSteps"] });
  }
  for (const [index, step] of memory.path.toolSteps.entries()) {
    if (step.parentToolFactId !== undefined && !factIds.has(step.parentToolFactId)) {
      context.addIssue({ code: "custom", message: "parent tool fact is not part of this path", path: ["path", "toolSteps", index, "parentToolFactId"] });
    }
    if (step.parentToolFactId === step.toolFactId) {
      context.addIssue({ code: "custom", message: "a tool step cannot be its own parent", path: ["path", "toolSteps", index, "parentToolFactId"] });
    }
  }
  if (!memory.path.executionStarted && memory.path.toolSteps.length > 0) {
    context.addIssue({ code: "custom", message: "tool steps require a started execution", path: ["path", "executionStarted"] });
  }
});

const documentSchema = z.object({
  schemaVersion: z.literal(PATH_MEMORY_SCHEMA_VERSION),
  memory: memorySchema,
}).strict();

const deletionDocumentSchema = z.object({
  schemaVersion: z.literal(PATH_MEMORY_DELETION_SCHEMA_VERSION),
  deletion: z.object({
    memoryId: z.string().min(1),
    deletedAt: z.string().min(1),
  }).strict(),
}).strict();

export function validatePathMemory(memory: PathMemory): PathMemory {
  const result = memorySchema.safeParse(memory);
  if (!result.success) {
    throw new PathMemoryFeatureError(
      "path_memory_snapshot_incompatible",
      `PathMemory ${memory.id} is invalid: ${z.prettifyError(result.error)}`,
    );
  }
  return toPersistedJsonShape(result.data);
}

export function createFileSystemPathMemoryRepository(rootDir: string): PathMemoryRepository {
  const recordsDir = path.join(rootDir, "records");
  const deletionsDir = path.join(rootDir, "deletions");
  /** Same-source create ordering: realtime capture and startup reconciliation share one FIFO. */
  const sourceQueues = new Map<string, Promise<void>>();

  const enqueue = <T>(memoryId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = sourceQueues.get(memoryId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    sourceQueues.set(memoryId, tail);
    void tail.finally(() => {
      if (sourceQueues.get(memoryId) === tail) sourceQueues.delete(memoryId);
    });
    return result;
  };

  async function persist(memory: PathMemory): Promise<void> {
    const document: PathMemoryDocument = { schemaVersion: PATH_MEMORY_SCHEMA_VERSION, memory };
    try {
      await writeJsonAtomically(recordPath(recordsDir, memory.id), document);
    } catch (error) {
      throw new PathMemoryFeatureError(
        "path_memory_repository_failure",
        `PathMemory ${memory.id} could not be persisted`,
        { cause: error },
      );
    }
  }

  async function readTombstone(memoryId: string): Promise<PathMemoryDeletionRecord | undefined> {
    const raw = await readJson(deletionPath(deletionsDir, memoryId), memoryId);
    if (raw === undefined) return undefined;
    const result = deletionDocumentSchema.safeParse(raw);
    // A corrupted or unknown tombstone must fail loudly; treating it as absent
    // would silently resurrect an explicitly forgotten memory.
    if (!result.success || result.data.deletion.memoryId !== memoryId) {
      throw new PathMemoryFeatureError(
        "path_memory_snapshot_incompatible",
        `PathMemory deletion record ${memoryId} is incompatible with ${PATH_MEMORY_DELETION_SCHEMA_VERSION}: ${result.success ? "deletion identity is invalid" : z.prettifyError(result.error)}`,
      );
    }
    return result.data.deletion;
  }

  async function readRecord(memoryId: string): Promise<PathMemory | undefined> {
    const raw = await readJson(recordPath(recordsDir, memoryId), memoryId);
    if (raw === undefined) return undefined;
    const result = documentSchema.safeParse(raw);
    if (!result.success || result.data.memory.id !== memoryId) {
      throw new PathMemoryFeatureError(
        "path_memory_snapshot_incompatible",
        `PathMemory record ${memoryId} is incompatible with ${PATH_MEMORY_SCHEMA_VERSION}: ${result.success ? "memory identity is invalid" : z.prettifyError(result.error)}`,
      );
    }
    return toPersistedJsonShape(result.data.memory);
  }

  /** A tombstoned id reads as absent even if the record file survived a crash. */
  async function readVisibleRecord(memoryId: string): Promise<PathMemory | undefined> {
    if (await readTombstone(memoryId) !== undefined) return undefined;
    return readRecord(memoryId);
  }

  return {
    create(memory) {
      return enqueue(memory.id, async (): Promise<PathMemoryCaptureResult> => {
        const validated = validatePathMemory(memory);
        const tombstone = await readTombstone(validated.id);
        if (tombstone !== undefined) {
          return { status: "suppressed", memoryId: validated.id, deletedAt: tombstone.deletedAt };
        }
        const existing = await readRecord(validated.id);
        if (existing !== undefined) {
          if (equalsIgnoringCaptureTime(existing, validated)) {
            return { status: "existing", memory: existing };
          }
          // A newer source revision means Ordinary restated the same run, not that
          // two writers disagree. Replacing keeps startup reconciliation able to
          // converge; without it the mismatch would fail on every restart forever.
          if (validated.source.sourceRevision <= existing.source.sourceRevision) {
            throw new PathMemoryFeatureError(
              "path_memory_source_conflict",
              `PathMemory for ${validated.source.feature} run ${validated.source.runId} already exists with different content at source revision ${existing.source.sourceRevision}`,
            );
          }
          await persist(validated);
          return { status: "replaced", memory: toPersistedJsonShape(validated), supersededRevision: existing.source.sourceRevision };
        }
        await persist(validated);
        return { status: "created", memory: toPersistedJsonShape(validated) };
      });
    },
    get(memoryId) {
      return readVisibleRecord(memoryId);
    },
    findBySource(input) {
      return readVisibleRecord(pathMemoryIdForSource(input));
    },
    async list(filter?: PathMemoryListFilter) {
      const limit = Math.max(0, Math.floor(filter?.limit ?? Number.MAX_SAFE_INTEGER));
      const entries = await fs.readdir(recordsDir, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) return [];
        throw error;
      });
      const memories: PathMemory[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        let memoryId: string;
        try {
          memoryId = decodeURIComponent(entry.name.slice(0, -".json".length));
        } catch {
          throw new PathMemoryFeatureError(
            "path_memory_snapshot_incompatible",
            `PathMemory record file name ${entry.name} is invalid`,
          );
        }
        const memory = await readVisibleRecord(memoryId);
        if (memory === undefined) continue;
        if (filter?.conversationId !== undefined && memory.source.conversationId !== filter.conversationId) continue;
        if (filter?.workspaceRoot !== undefined && memory.scope.workspaceRoot !== filter.workspaceRoot) continue;
        if (filter?.terminalStatus !== undefined && memory.outcome.terminalStatus !== filter.terminalStatus) continue;
        memories.push(memory);
      }
      memories.sort((left, right) => right.source.terminalAt.localeCompare(left.source.terminalAt) || left.id.localeCompare(right.id));
      return memories.slice(0, limit);
    },
    delete(memoryId, deletedAt) {
      return enqueue(memoryId, async () => {
        const target = recordPath(recordsDir, memoryId);
        const existed = await fs.access(target).then(() => true, () => false);
        if (!existed) return false;
        // Tombstone first: if the process dies between the two writes, the
        // record is still suppressed on the next capture instead of resurrected.
        const document: PathMemoryDeletionDocument = {
          schemaVersion: PATH_MEMORY_DELETION_SCHEMA_VERSION,
          deletion: { memoryId, deletedAt },
        };
        try {
          await writeJsonAtomically(deletionPath(deletionsDir, memoryId), document);
          await fs.rm(target, { force: true });
          return true;
        } catch (error) {
          throw new PathMemoryFeatureError(
            "path_memory_repository_failure",
            `PathMemory ${memoryId} could not be deleted`,
            { cause: error },
          );
        }
      });
    },
  };
}

/**
 * Realtime capture and startup reconciliation observe the same source facts at
 * different times; only the capture timestamp may differ between the two.
 */
function equalsIgnoringCaptureTime(left: PathMemory, right: PathMemory): boolean {
  const strip = ({ capturedAt: _capturedAt, ...rest }: PathMemory): unknown => rest;
  return JSON.stringify(strip(left)) === JSON.stringify(strip(right));
}

function recordPath(recordsDir: string, memoryId: string): string {
  return path.join(recordsDir, `${encodeURIComponent(memoryId)}.json`);
}

function deletionPath(deletionsDir: string, memoryId: string): string {
  return path.join(deletionsDir, `${encodeURIComponent(memoryId)}.json`);
}

async function readJson(filePath: string, memoryId: string): Promise<unknown | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new PathMemoryFeatureError(
      "path_memory_snapshot_incompatible",
      `PathMemory record ${memoryId} stored JSON is invalid`,
    );
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempDirectory = path.join(directory, ".tmp");
  const tempPath = path.join(tempDirectory, `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

