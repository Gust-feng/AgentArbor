import { createHash, randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  TOOL_OUTPUT_REF_PREFIX,
  ToolOutputStoreError,
  type RetainToolOutputInput,
  type ToolOutputReadWindow,
  type ToolOutputRetention,
  type ToolOutputSlice,
  type ToolOutputStore,
} from "../../app/tool-center/tool-output-store.js";
import { MAX_TOOL_OUTPUT_SOURCE_METADATA_JSON_CHARS } from "../../app/tool-center/tool-output-limits.js";
import {
  isUtf16CodeUnitBoundary,
  utf16SafeWindowEnd,
} from "../../app/tool-center/text-window.js";

const TOOL_EVIDENCE_SCHEMA_VERSION = "tool-evidence/v1" as const;
const METADATA_FILE = "metadata.json";
const CONTENT_FILE = "content.txt";

const metadataSchema = z.object({
  schemaVersion: z.literal(TOOL_EVIDENCE_SCHEMA_VERSION),
  ref: z.string().min(1),
  availability: z.literal("durable"),
  mediaType: z.enum(["text/plain", "application/json"]),
  sourceToolName: z.string().min(1),
  sourceCallId: z.string().min(1),
  sourceFactId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  totalChars: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().min(1),
}).strict();

type ToolEvidenceMetadata = z.infer<typeof metadataSchema>;

export type FileSystemToolOutputStoreOptions = {
  readonly now?: () => number;
  readonly createRefToken?: () => string;
};

/**
 * Durable backing for oversized tool facts. Each opaque ref is committed as one
 * directory so a restart can observe either the complete evidence or no entry.
 */
export class FileSystemToolOutputStore implements ToolOutputStore {
  private readonly root: string;
  private readonly entriesRoot: string;
  private readonly now: () => number;
  private readonly createRefToken: () => string;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(root: string, options: FileSystemToolOutputStoreOptions = {}) {
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new ToolOutputStoreError(
        "invalid_tool_output_store_configuration",
        "Tool evidence root must be a non-empty path.",
      );
    }
    this.root = path.resolve(root);
    if (path.dirname(this.root) === this.root) {
      throw new ToolOutputStoreError(
        "invalid_tool_output_store_configuration",
        "Tool evidence root cannot be a filesystem root.",
      );
    }
    this.entriesRoot = path.join(this.root, "entries");
    this.now = options.now ?? Date.now;
    this.createRefToken = options.createRefToken ?? randomUUID;
  }

  retain(input: RetainToolOutputInput): Promise<ToolOutputRetention> {
    return this.mutate(async () => {
      const normalized = normalizeRetainInput(input);
      await fs.mkdir(this.entriesRoot, { recursive: true });
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const token = requireRefToken(this.createRefToken());
        const ref = `${TOOL_OUTPUT_REF_PREFIX}${token}`;
        const target = this.entryDirectory(token);
        if (await pathExists(target)) continue;

        const createdAt = isoTimestamp(this.now());
        const metadata: ToolEvidenceMetadata = {
          schemaVersion: TOOL_EVIDENCE_SCHEMA_VERSION,
          ref,
          availability: "durable",
          mediaType: normalized.mediaType,
          sourceToolName: normalized.sourceToolName,
          sourceCallId: normalized.sourceCallId,
          ...(normalized.sourceFactId === undefined ? {} : { sourceFactId: normalized.sourceFactId }),
          ...(normalized.ownerId === undefined ? {} : { ownerId: normalized.ownerId }),
          totalChars: normalized.content.length,
          byteLength: Buffer.byteLength(normalized.content, "utf8"),
          sha256: sha256(normalized.content),
          createdAt,
        };
        const temporary = path.join(this.entriesRoot, `.${token}.${randomUUID()}.tmp`);
        try {
          await fs.mkdir(temporary);
          await fs.writeFile(path.join(temporary, CONTENT_FILE), normalized.content, {
            encoding: "utf8",
            mode: 0o600,
          });
          await fs.writeFile(path.join(temporary, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await fs.rename(temporary, target);
          return retentionFromMetadata(metadata);
        } catch (error) {
          if (await pathExists(target)) continue;
          throw error;
        } finally {
          await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      throw new ToolOutputStoreError(
        "tool_output_ref_generation_failed",
        "Tool evidence store could not produce a unique reference.",
      );
    });
  }

  async read(ref: string, window: ToolOutputReadWindow): Promise<ToolOutputSlice | undefined> {
    const token = refToken(ref);
    const normalizedWindow = normalizeReadWindow(window);
    const directory = this.entryDirectory(token);
    const metadata = await this.readMetadata(directory);
    if (metadata === undefined) {
      if (await pathExists(directory)) {
        throw corruptEvidence(ref, "Stored tool evidence metadata is missing.");
      }
      return undefined;
    }
    if (metadata.ref !== ref) {
      throw corruptEvidence(ref, "Stored metadata does not match the requested reference.");
    }

    let content: string;
    try {
      content = await fs.readFile(path.join(directory, CONTENT_FILE), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw corruptEvidence(ref, "Stored tool evidence content is missing.");
      }
      throw error;
    }
    verifyContent(metadata, content);
    if (normalizedWindow.startChar > metadata.totalChars) {
      throw new ToolOutputStoreError(
        "tool_output_window_out_of_range",
        `Tool output startChar ${normalizedWindow.startChar} exceeds totalChars ${metadata.totalChars}.`,
        { startChar: normalizedWindow.startChar, totalChars: metadata.totalChars },
      );
    }
    if (!isUtf16CodeUnitBoundary(content, normalizedWindow.startChar)) {
      throw new ToolOutputStoreError(
        "invalid_tool_output_window",
        "Tool output startChar must not split a UTF-16 surrogate pair.",
        { startChar: normalizedWindow.startChar },
      );
    }

    const endChar = utf16SafeWindowEnd(
      content,
      normalizedWindow.startChar,
      normalizedWindow.maxChars,
    );
    const slice = content.slice(normalizedWindow.startChar, endChar);
    const nextStartChar = normalizedWindow.startChar + slice.length;
    return {
      ...retentionFromMetadata(metadata),
      content: slice,
      startChar: normalizedWindow.startChar,
      textChars: slice.length,
      hasMoreAfter: nextStartChar < metadata.totalChars,
    };
  }

  release(ref: string): Promise<boolean> {
    return this.mutate(async () => {
      const directory = this.entryDirectory(refToken(ref));
      if (!(await pathExists(directory))) return false;
      await fs.rm(directory, { recursive: true, force: false });
      return true;
    });
  }

  releaseOwner(ownerId: string): Promise<number> {
    return this.mutate(async () => {
      const normalizedOwner = nonEmptyText(ownerId, "ownerId");
      let released = 0;
      for (const directory of await this.entryDirectories()) {
        const metadata = await this.readMetadata(directory);
        if (metadata === undefined) {
          throw corruptEvidence(path.basename(directory), "Stored tool evidence metadata is missing.");
        }
        if (metadata.ownerId !== normalizedOwner) continue;
        await fs.rm(directory, { recursive: true, force: false });
        released += 1;
      }
      return released;
    });
  }

  clear(): Promise<void> {
    return this.mutate(async () => {
      for (const directory of await this.entryDirectories(true)) {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }

  async close(): Promise<void> {
    await this.mutationTail;
  }

  private entryDirectory(token: string): string {
    return path.join(this.entriesRoot, token);
  }

  private async entryDirectories(includeTemporary = false): Promise<readonly string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.entriesRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    return entries.flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      if (!includeTemporary && entry.name.startsWith(".")) return [];
      return [path.join(this.entriesRoot, entry.name)];
    });
  }

  private async readMetadata(directory: string): Promise<ToolEvidenceMetadata | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(directory, METADATA_FILE), "utf8");
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw corruptEvidence(path.basename(directory), "Stored tool evidence metadata is not valid JSON.");
    }
    const result = metadataSchema.safeParse(parsed);
    if (!result.success) {
      throw corruptEvidence(
        path.basename(directory),
        `Stored tool evidence metadata is invalid at ${result.error.issues[0]?.path.join(".") || "root"}.`,
      );
    }
    if (!Number.isFinite(Date.parse(result.data.createdAt))) {
      throw corruptEvidence(result.data.ref, "Stored tool evidence createdAt is invalid.");
    }
    return result.data;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.mutationTail = previous.then(() => current, () => current);
    return previous.catch(() => undefined).then(operation).finally(release);
  }
}

function normalizeRetainInput(input: RetainToolOutputInput): RetainToolOutputInput {
  if (input.mediaType !== "text/plain" && input.mediaType !== "application/json") {
    throw new ToolOutputStoreError(
      "invalid_tool_output",
      "Tool output mediaType must be text/plain or application/json.",
    );
  }
  if (typeof input.content !== "string") {
    throw new ToolOutputStoreError("invalid_tool_output", "Tool output content must be a string.");
  }
  const sourceToolName = nonEmptyText(input.sourceToolName, "sourceToolName");
  const sourceCallId = nonEmptyText(input.sourceCallId, "sourceCallId");
  const sourceFactId = input.sourceFactId === undefined
    ? undefined
    : nonEmptyText(input.sourceFactId, "sourceFactId");
  const ownerId = input.ownerId === undefined ? undefined : nonEmptyText(input.ownerId, "ownerId");
  const sourceMetadataChars = JSON.stringify({ sourceToolName, sourceCallId, sourceFactId }).length;
  if (sourceMetadataChars > MAX_TOOL_OUTPUT_SOURCE_METADATA_JSON_CHARS) {
    throw new ToolOutputStoreError(
      "tool_output_source_metadata_too_large",
      "Tool output provenance metadata exceeds the readable continuation budget.",
      { sourceMetadataChars, maxSourceMetadataChars: MAX_TOOL_OUTPUT_SOURCE_METADATA_JSON_CHARS },
    );
  }
  return {
    mediaType: input.mediaType,
    content: input.content,
    sourceToolName,
    sourceCallId,
    ...(sourceFactId === undefined ? {} : { sourceFactId }),
    ...(ownerId === undefined ? {} : { ownerId }),
  };
}

function retentionFromMetadata(metadata: ToolEvidenceMetadata): ToolOutputRetention {
  return {
    ref: metadata.ref,
    availability: metadata.availability,
    mediaType: metadata.mediaType,
    sourceToolName: metadata.sourceToolName,
    sourceCallId: metadata.sourceCallId,
    ...(metadata.sourceFactId === undefined ? {} : { sourceFactId: metadata.sourceFactId }),
    totalChars: metadata.totalChars,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    createdAt: metadata.createdAt,
  };
}

function verifyContent(metadata: ToolEvidenceMetadata, content: string): void {
  if (
    content.length !== metadata.totalChars ||
    Buffer.byteLength(content, "utf8") !== metadata.byteLength ||
    sha256(content) !== metadata.sha256
  ) {
    throw corruptEvidence(metadata.ref, "Stored tool evidence content does not match its metadata.");
  }
}

function normalizeReadWindow(window: ToolOutputReadWindow): ToolOutputReadWindow {
  if (!Number.isSafeInteger(window.startChar) || window.startChar < 0) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_window",
      "Tool output startChar must be a non-negative safe integer.",
      { startChar: window.startChar },
    );
  }
  if (!Number.isSafeInteger(window.maxChars) || window.maxChars <= 0) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_window",
      "Tool output maxChars must be a positive safe integer.",
      { maxChars: window.maxChars },
    );
  }
  return { startChar: window.startChar, maxChars: window.maxChars };
}

function refToken(ref: string): string {
  if (typeof ref !== "string" || !ref.startsWith(TOOL_OUTPUT_REF_PREFIX)) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_ref",
      `Tool output ref must use the ${TOOL_OUTPUT_REF_PREFIX} scheme.`,
    );
  }
  return requireRefToken(ref.slice(TOOL_OUTPUT_REF_PREFIX.length));
}

function requireRefToken(token: string): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(token)) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_ref",
      "Tool output ref contains an invalid token.",
    );
  }
  return token;
}

function nonEmptyText(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolOutputStoreError(
      "invalid_tool_output",
      `${fieldName} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function isoTimestamp(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_store_configuration",
      "Tool evidence store clock must return a non-negative safe integer timestamp.",
      { value: Number.isFinite(value) ? value : String(value) },
    );
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new ToolOutputStoreError(
      "invalid_tool_output_store_configuration",
      "Tool evidence store clock is outside the supported date range.",
      { value },
    );
  }
  return timestamp.toISOString();
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function corruptEvidence(ref: string, message: string): ToolOutputStoreError {
  return new ToolOutputStoreError("tool_output_corrupt", message, { ref });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT";
}
