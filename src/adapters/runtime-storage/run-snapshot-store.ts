import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunEnvelope, RunSnapshotStore } from "../../app/run-runtime-core/snapshot-store.js";

export function createFileSystemRunSnapshotStore<TSnapshot>(input: {
  readonly rootDir: string;
  readonly getEnvelope: (snapshot: TSnapshot) => RunEnvelope;
  readonly fileName?: string;
}): RunSnapshotStore<TSnapshot> {
  const fileName = input.fileName ?? "record.json";
  return {
    async upsert(snapshot: TSnapshot): Promise<TSnapshot> {
      const stored = cloneJson(snapshot);
      const envelope = input.getEnvelope(stored);
      await writeJsonFile(path.join(input.rootDir, safeFileName(envelope.runId), fileName), stored);
      return cloneJson(stored);
    },
    async get(runId: string): Promise<TSnapshot | undefined> {
      return readJsonFile<TSnapshot>(path.join(input.rootDir, safeFileName(runId), fileName));
    },
    async list(limit = 50): Promise<readonly TSnapshot[]> {
      const entries = await fs.readdir(input.rootDir, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) {
          return [];
        }
        throw error;
      });
      const snapshots = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readJsonFile<TSnapshot>(path.join(input.rootDir, entry.name, fileName)))
      );
      const available: TSnapshot[] = [];
      for (const snapshot of snapshots) {
        if (snapshot !== undefined) {
          available.push(snapshot);
        }
      }
      return available
        .sort((left, right) => compareRunEnvelopeByRecency(input.getEnvelope(left), input.getEnvelope(right)))
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((snapshot) => cloneJson(snapshot));
    },
    async delete(runId: string): Promise<void> {
      await fs.rm(path.join(input.rootDir, safeFileName(runId)), { recursive: true, force: true });
    },
  };
}

function compareRunEnvelopeByRecency(left: RunEnvelope, right: RunEnvelope): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const targetDirectory = path.dirname(filePath);
  const tempDirectory = path.join(targetDirectory, ".tmp");
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

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });
  return content === undefined ? undefined : (JSON.parse(content) as T);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
