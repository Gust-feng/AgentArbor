import { promises as fs } from "node:fs";
import path from "node:path";
import {
  RUNTIME_RUN_MANIFEST_SCHEMA_VERSION,
  RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION,
  RuntimeSnapshotIncompatibleError,
} from "../../domain/runtime-database/index.js";
import type {
  RuntimeConversationRecord,
  RuntimeDatabase,
  RuntimeRunModelCallsRecord,
  RuntimeRunManifest,
  RuntimeRunSnapshot,
  RuntimeRunSnapshotContent,
  RuntimeRunSnapshotDocument,
  RuntimeRunSummaryRecord,
} from "../../domain/runtime-database/index.js";
import {
  runtimeRunSummary,
  validateRuntimeRunManifest,
  validateRuntimeRunSnapshotContent,
  validateRuntimeRunSnapshotDocument,
} from "./runtime-run-snapshot-validation.js";

export type FileSystemRuntimeDatabasePaths = {
  readonly appHome: string;
  readonly runtimeHome: string;
};

export function resolveAgentArborAppHomeFromConfigDirectory(configDirectory: string): string {
  const resolved = path.resolve(configDirectory);
  return path.basename(resolved).toLowerCase() === "config" ? path.dirname(resolved) : resolved;
}

export function resolveAgentArborRuntimeDatabasePaths(configDirectory: string): FileSystemRuntimeDatabasePaths {
  const appHome = resolveAgentArborAppHomeFromConfigDirectory(configDirectory);
  return {
    appHome,
    runtimeHome: path.join(appHome, "runtime"),
  };
}

export class FileSystemRuntimeDatabase implements RuntimeDatabase {
  readonly appHome: string;
  readonly runtimeHome: string;
  private readonly runSaveTails = new Map<string, Promise<void>>();

  constructor(paths: FileSystemRuntimeDatabasePaths) {
    this.appHome = path.resolve(paths.appHome);
    this.runtimeHome = path.resolve(paths.runtimeHome);
  }

  async upsertConversation(record: RuntimeConversationRecord): Promise<RuntimeConversationRecord> {
    const stored = cloneJson(record);
    await writeJsonFile(this.conversationPath(record.conversationId), stored);
    return stored;
  }

  async getConversation(conversationId: string): Promise<RuntimeConversationRecord | undefined> {
    return readJsonFile<RuntimeConversationRecord>(this.conversationPath(conversationId));
  }

  async listConversations(limit = 50): Promise<readonly RuntimeConversationRecord[]> {
    const root = path.join(this.runtimeHome, "conversations");
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      if (isFileNotFound(error)) {
        return [];
      }
      throw error;
    });
    const conversations = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJsonFile<RuntimeConversationRecord>(path.join(root, entry.name)))
    );
    return conversations
      .filter((conversation): conversation is RuntimeConversationRecord => conversation !== undefined)
      .sort(compareConversations)
      .slice(0, Math.max(0, Math.floor(limit)));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await fs.rm(this.conversationPath(conversationId), { force: true });
  }

  async saveRunSnapshot(content: RuntimeRunSnapshotContent): Promise<RuntimeRunSnapshotContent> {
    const snapshot = cloneJson(content);
    const runId = snapshot.run.runId;
    const validation = validateRuntimeRunSnapshotContent(snapshot, runId);
    if (!validation.ok) {
      throw incompatibleSnapshot(runId, validation.reason);
    }
    const previous = this.runSaveTails.get(runId) ?? Promise.resolve();
    const operation = previous.then(() => this.saveRunSnapshotNow(snapshot));
    const tail = operation.then(() => undefined, () => undefined);
    this.runSaveTails.set(runId, tail);
    void tail.finally(() => {
      if (this.runSaveTails.get(runId) === tail) {
        this.runSaveTails.delete(runId);
      }
    });
    return operation;
  }

  async getRun(runId: string): Promise<RuntimeRunSnapshot | undefined> {
    const manifest = await this.readManifest(runId);
    if (manifest === undefined) {
      return undefined;
    }
    const document = await this.readSnapshotDocument(runId, manifest);
    return document.content;
  }

  async listRuns(limit = 50): Promise<readonly RuntimeRunSummaryRecord[]> {
    const root = path.join(this.runtimeHome, "runs");
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      if (isFileNotFound(error)) {
        return [];
      }
      throw error;
    });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readManifest(decodeRunDirectoryName(entry.name))),
    );
    return manifests
      .filter((manifest): manifest is RuntimeRunManifest => manifest !== undefined)
      .sort((left, right) => {
        const byTime = right.run.updatedAt.localeCompare(left.run.updatedAt);
        return byTime === 0 ? left.run.runId.localeCompare(right.run.runId) : byTime;
      })
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((manifest) => cloneJson(manifest.run));
  }

  async listModelCallsForRuns(runIds: readonly string[]): Promise<readonly RuntimeRunModelCallsRecord[]> {
    return Promise.all(
      runIds.map(async (runId) => ({
        runId,
        modelCalls: (await this.getRun(runId))?.modelCalls ?? [],
      }))
    );
  }

  runHome(runId: string): string {
    return this.runDirectory(runId);
  }

  private async saveRunSnapshotNow(snapshot: RuntimeRunSnapshotContent): Promise<RuntimeRunSnapshotContent> {
    const runId = snapshot.run.runId;
    const previous = await this.readManifest(runId);
    const revision = (previous?.revision ?? 0) + 1;
    const snapshotRef = `snapshots/${revision}.json`;
    const document: RuntimeRunSnapshotDocument = {
      schemaVersion: RUNTIME_RUN_SNAPSHOT_SCHEMA_VERSION,
      revision,
      content: snapshot,
    };
    await writeJsonFile(path.join(this.runDirectory(runId), snapshotRef), document);
    await writeJsonFile(this.runPath(runId), {
      schemaVersion: RUNTIME_RUN_MANIFEST_SCHEMA_VERSION,
      revision,
      snapshotRef,
      run: runtimeRunSummary(snapshot.run),
    } satisfies RuntimeRunManifest);
    await this.cleanupOldSnapshots(runId, revision);
    return cloneJson(snapshot);
  }

  private async readManifest(runId: string): Promise<RuntimeRunManifest | undefined> {
    const filePath = this.runPath(runId);
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(filePath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw incompatibleSnapshot(runId, "manifest JSON is invalid", error);
      }
      throw error;
    }
    if (raw === undefined) {
      return undefined;
    }
    const validation = validateRuntimeRunManifest(raw, runId);
    if (!validation.ok) {
      throw incompatibleSnapshot(runId, validation.reason);
    }
    return validation.value;
  }

  private async readSnapshotDocument(
    runId: string,
    manifest: RuntimeRunManifest,
  ): Promise<RuntimeRunSnapshotDocument> {
    if (manifest.revision < 1 || manifest.snapshotRef !== `snapshots/${manifest.revision}.json`) {
      throw incompatibleSnapshot(runId, "manifest revision or snapshot reference is invalid");
    }
    let raw: unknown;
    try {
      raw = await readJsonFile<unknown>(path.join(this.runDirectory(runId), manifest.snapshotRef));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw incompatibleSnapshot(runId, "snapshot JSON is invalid", error);
      }
      throw error;
    }
    const validation = validateRuntimeRunSnapshotDocument(raw, runId, manifest);
    if (!validation.ok) {
      throw incompatibleSnapshot(runId, validation.reason);
    }
    return validation.value;
  }

  private async cleanupOldSnapshots(runId: string, currentRevision: number): Promise<void> {
    const directory = path.join(this.runDirectory(runId), "snapshots");
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .filter((entry) => Number.parseInt(entry.name, 10) < currentRevision - 1)
      .map((entry) => fs.rm(path.join(directory, entry.name), { force: true }).catch(() => undefined)));
  }

  private conversationPath(conversationId: string): string {
    return path.join(this.runtimeHome, "conversations", `${safeFileName(conversationId)}.json`);
  }

  private runPath(runId: string): string {
    return path.join(this.runDirectory(runId), "run.json");
  }

  private runDirectory(runId: string): string {
    return path.join(this.runtimeHome, "runs", safeFileName(runId));
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const targetDirectory = path.dirname(filePath);
  const tempDirectory = path.join(findRuntimeHome(targetDirectory), ".tmp");
  const tempPath = path.join(
    tempDirectory,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.mkdir(tempDirectory, { recursive: true });
  await fs.writeFile(tempPath, content, {
    encoding: "utf8",
    mode: 0o600,
  });
  await renameWithTransientRetry(tempPath, filePath).catch(async (error: unknown) => {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  });
}

async function renameWithTransientRetry(source: string, target: string): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientRenameError(error)) {
        throw error;
      }
      await delay(25 * attempt);
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function findRuntimeHome(directory: string): string {
  let current = path.resolve(directory);
  while (path.basename(current) !== "runtime") {
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(directory);
    }
    current = parent;
  }
  return current;
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function decodeRunDirectoryName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw incompatibleSnapshot(value, "run directory name is invalid", error);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compareConversations(left: RuntimeConversationRecord, right: RuntimeConversationRecord): number {
  const pinned = (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return pinned === 0 ? right.updatedAt.localeCompare(left.updatedAt) : pinned;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function incompatibleSnapshot(runId: string, reason: string, cause?: unknown): RuntimeSnapshotIncompatibleError {
  const error = new RuntimeSnapshotIncompatibleError(runId, reason);
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}
