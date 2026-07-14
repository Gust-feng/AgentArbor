import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ORDINARY_CONVERSATION_SCHEMA_VERSION,
  type OrdinaryConversationControlDocument,
  type OrdinaryConversationControlRepository,
  type OrdinaryConversationControlState,
  type OrdinaryConversationControlSummary,
} from "./contracts.js";

export class OrdinaryConversationSnapshotIncompatibleError extends Error {
  readonly code = "ordinary_conversation_snapshot_incompatible" as const;
  constructor(readonly conversationId: string, reason: string) {
    super(`Ordinary conversation snapshot ${conversationId} is incompatible: ${reason}`);
    this.name = "OrdinaryConversationSnapshotIncompatibleError";
  }
}

const lineageSchema = z.object({
  lineageId: z.string().min(1),
  parentLineageId: z.string().min(1).optional(),
  forkFromRunId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
}).strict();
const stateSchema: z.ZodType<OrdinaryConversationControlState> = z.object({
  conversationId: z.string().min(1),
  createdAt: z.string().min(1),
  titleOverride: z.string().min(1).max(80).optional(),
  titleEditedAt: z.string().min(1).optional(),
  pinnedAt: z.string().min(1).optional(),
  deletedAt: z.string().min(1).optional(),
  activeLineageId: z.string().min(1),
  lineages: z.array(lineageSchema).min(1),
}).strict().superRefine((state, context) => {
  if ((state.titleOverride === undefined) !== (state.titleEditedAt === undefined)) {
    context.addIssue({ code: "custom", message: "title override and edit time must appear together" });
  }
  const ids = new Set(state.lineages.map((lineage) => lineage.lineageId));
  if (ids.size !== state.lineages.length || !ids.has(state.activeLineageId)) {
    context.addIssue({ code: "custom", message: "lineage graph identity is invalid" });
  }
  for (const lineage of state.lineages) {
    if (lineage.parentLineageId !== undefined && !ids.has(lineage.parentLineageId)) {
      context.addIssue({ code: "custom", message: "lineage parent was not found" });
    }
    if ((lineage.parentLineageId === undefined) !== (lineage.forkFromRunId === undefined)) {
      context.addIssue({ code: "custom", message: "non-root lineage must name both parent and fork run" });
    }
    const visited = new Set<string>([lineage.lineageId]);
    let parentId = lineage.parentLineageId;
    while (parentId !== undefined) {
      if (visited.has(parentId)) {
        context.addIssue({ code: "custom", message: "lineage graph contains a cycle" });
        break;
      }
      visited.add(parentId);
      parentId = state.lineages.find((candidate) => candidate.lineageId === parentId)?.parentLineageId;
    }
  }
});
const documentSchema: z.ZodType<OrdinaryConversationControlDocument> = z.object({
  schemaVersion: z.literal(ORDINARY_CONVERSATION_SCHEMA_VERSION),
  revision: z.number().int().positive(),
  savedAt: z.string().min(1),
  state: stateSchema,
}).strict();

export function createFileSystemOrdinaryConversationControlRepository(rootDir: string): OrdinaryConversationControlRepository {
  let writeQueue = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    save(state, expectedRevision, savedAt) {
      return enqueue(async () => {
        const current = await readDocument(rootDir, state.conversationId);
        const actualRevision = current?.revision ?? 0;
        if (actualRevision !== expectedRevision) {
          throw new Error(`Ordinary conversation ${state.conversationId} revision conflict: expected ${expectedRevision}, received ${actualRevision}`);
        }
        const document: OrdinaryConversationControlDocument = {
          schemaVersion: ORDINARY_CONVERSATION_SCHEMA_VERSION,
          revision: actualRevision + 1,
          savedAt,
          state: structuredClone(state),
        };
        const result = documentSchema.safeParse(document);
        if (!result.success) throw new OrdinaryConversationSnapshotIncompatibleError(state.conversationId, z.prettifyError(result.error));
        await writeJsonAtomically(documentPath(rootDir, state.conversationId), document);
        return structuredClone(document);
      });
    },
    get(conversationId) { return readDocument(rootDir, conversationId); },
    async list(limit = 50) {
      const root = path.join(rootDir, "conversations");
      const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) return [];
        throw error;
      });
      const documents = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
        readDocument(rootDir, decodeURIComponent(entry.name))));
      return documents.filter((item): item is OrdinaryConversationControlDocument => item !== undefined)
        .map(summary)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(0, Math.floor(limit)));
    },
  };
}

async function readDocument(rootDir: string, conversationId: string): Promise<OrdinaryConversationControlDocument | undefined> {
  const filePath = documentPath(rootDir, conversationId);
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(content) as unknown; }
  catch { throw new OrdinaryConversationSnapshotIncompatibleError(conversationId, "stored JSON is invalid"); }
  const result = documentSchema.safeParse(raw);
  if (!result.success || result.data.state.conversationId !== conversationId) {
    throw new OrdinaryConversationSnapshotIncompatibleError(conversationId, result.success ? "conversation identity is invalid" : z.prettifyError(result.error));
  }
  return structuredClone(result.data);
}

function summary(document: OrdinaryConversationControlDocument): OrdinaryConversationControlSummary {
  return {
    conversationId: document.state.conversationId,
    updatedAt: document.savedAt,
    deleted: document.state.deletedAt !== undefined,
  };
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempDirectory = path.join(directory, ".tmp");
  const tempPath = path.join(tempDirectory, `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { await renameWithRetry(tempPath, filePath); }
  catch (error) { await fs.rm(tempPath, { force: true }).catch(() => undefined); throw error; }
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try { await fs.rename(source, target); return; }
    catch (error) {
      if (attempt === 6 || !isTransientRenameError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

function documentPath(rootDir: string, conversationId: string): string {
  return path.join(rootDir, "conversations", encodeURIComponent(conversationId), "snapshot.json");
}
function isTransientRenameError(error: unknown): boolean {
  return isNodeError(error, "EPERM") || isNodeError(error, "EACCES") || isNodeError(error, "EBUSY");
}
function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === code;
}
