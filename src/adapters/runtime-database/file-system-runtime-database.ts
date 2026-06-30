import { promises as fs } from "node:fs";
import path from "node:path";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type {
  RuntimeArtifactRecord,
  RuntimeConversationRecord,
  RuntimeContextLedgerRecord,
  RuntimeDatabase,
  RuntimeConfirmationRecord,
  RuntimeEventRecord,
  RuntimeModelCallRecord,
  RuntimeRunModelCallsRecord,
  RuntimeRunRecord,
  RuntimeRunSnapshot,
  RuntimeSubAgentRunRecord,
  RuntimeToolCallRecord,
  RuntimeWorkspaceRecord,
} from "../../domain/runtime-database/index.js";
import type { RunEnvelope, RunSnapshotStore } from "../../app/run-runtime-core/snapshot-store.js";
import {
  createFileSystemRunSnapshotStore,
} from "./run-snapshot-store.js";

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
  private readonly runRecordStore: RunSnapshotStore<RuntimeRunRecord>;

  constructor(paths: FileSystemRuntimeDatabasePaths) {
    this.appHome = path.resolve(paths.appHome);
    this.runtimeHome = path.resolve(paths.runtimeHome);
    this.runRecordStore = createFileSystemRunSnapshotStore<RuntimeRunRecord>({
      rootDir: path.join(this.runtimeHome, "runs"),
      getEnvelope: runtimeRunEnvelope,
      fileName: "run.json",
    });
  }

  async upsertWorkspace(record: RuntimeWorkspaceRecord): Promise<RuntimeWorkspaceRecord> {
    const stored = cloneJson(record);
    await writeJsonFile(this.workspacePath(record.workspaceId), stored);
    return stored;
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

  async upsertRun(record: RuntimeRunRecord): Promise<RuntimeRunRecord> {
    return this.runRecordStore.upsert(record);
  }

  async upsertBasicRun(record: BasicAgentRun): Promise<BasicAgentRun> {
    const stored = cloneJson(record);
    await writeJsonFile(this.basicRunPath(record.runId), stored);
    return stored;
  }

  async replaceBasicRunEvents(runId: string, events: readonly RunEvent[]): Promise<readonly RunEvent[]> {
    const stored = cloneJson(events);
    await writeJsonlFile(this.runJsonlPath(runId, "basic-events.jsonl"), stored);
    return stored;
  }

  async replaceRunEvents(runId: string, events: readonly RuntimeEventRecord[]): Promise<readonly RuntimeEventRecord[]> {
    const stored = cloneJson(events);
    await writeJsonlFile(this.runJsonlPath(runId, "events.jsonl"), stored);
    return stored;
  }

  async replaceModelCalls(runId: string, calls: readonly RuntimeModelCallRecord[]): Promise<readonly RuntimeModelCallRecord[]> {
    const stored = cloneJson(calls);
    await writeJsonlFile(this.runJsonlPath(runId, "model-calls.jsonl"), stored);
    return stored;
  }

  async replaceToolCalls(runId: string, calls: readonly RuntimeToolCallRecord[]): Promise<readonly RuntimeToolCallRecord[]> {
    const stored = cloneJson(calls);
    await writeJsonlFile(this.runJsonlPath(runId, "tool-calls.jsonl"), stored);
    return stored;
  }

  async replaceArtifacts(runId: string, artifacts: readonly RuntimeArtifactRecord[]): Promise<readonly RuntimeArtifactRecord[]> {
    const stored = cloneJson(artifacts);
    await writeJsonlFile(this.runJsonlPath(runId, "artifacts.jsonl"), stored);
    return stored;
  }

  async replaceConfirmations(
    runId: string,
    confirmations: readonly RuntimeConfirmationRecord[]
  ): Promise<readonly RuntimeConfirmationRecord[]> {
    const stored = cloneJson(confirmations);
    await writeJsonlFile(this.runJsonlPath(runId, "confirmations.jsonl"), stored);
    return stored;
  }

  async replaceSubAgentRuns(
    runId: string,
    records: readonly RuntimeSubAgentRunRecord[]
  ): Promise<readonly RuntimeSubAgentRunRecord[]> {
    const stored = cloneJson(records);
    await writeJsonlFile(this.runJsonlPath(runId, "sub-agent-runs.jsonl"), stored);
    return stored;
  }

  async upsertContextLedger(record: RuntimeContextLedgerRecord): Promise<RuntimeContextLedgerRecord> {
    const stored = cloneJson(record);
    await writeJsonFile(this.contextLedgerPath(record.runId), stored);
    return stored;
  }

  async getRun(runId: string): Promise<RuntimeRunSnapshot | undefined> {
    const run = await this.runRecordStore.get(runId);
    if (run === undefined) {
      return undefined;
    }
    const workspace =
      run.workspaceId === undefined
        ? undefined
        : await readJsonFile<RuntimeWorkspaceRecord>(this.workspacePath(run.workspaceId));
    return {
      run,
      workspace,
      basicRun: await readJsonFile<BasicAgentRun>(this.basicRunPath(runId)),
      basicEvents: await readJsonlFile<RunEvent>(this.runJsonlPath(runId, "basic-events.jsonl")),
      events: await readJsonlFile<RuntimeEventRecord>(this.runJsonlPath(runId, "events.jsonl")),
      modelCalls: await readJsonlFile<RuntimeModelCallRecord>(this.runJsonlPath(runId, "model-calls.jsonl")),
      toolCalls: await readJsonlFile<RuntimeToolCallRecord>(this.runJsonlPath(runId, "tool-calls.jsonl")),
      artifacts: await readJsonlFile<RuntimeArtifactRecord>(this.runJsonlPath(runId, "artifacts.jsonl")),
      confirmations: await readJsonlFile<RuntimeConfirmationRecord>(this.runJsonlPath(runId, "confirmations.jsonl")),
      subAgentRuns: await readJsonlFile<RuntimeSubAgentRunRecord>(this.runJsonlPath(runId, "sub-agent-runs.jsonl")),
      contextLedger: await readJsonFile<RuntimeContextLedgerRecord>(this.contextLedgerPath(runId)),
    };
  }

  async listRuns(limit = 50): Promise<readonly RuntimeRunRecord[]> {
    return this.runRecordStore.list(limit);
  }

  async listModelCallsForRuns(runIds: readonly string[]): Promise<readonly RuntimeRunModelCallsRecord[]> {
    return Promise.all(
      runIds.map(async (runId) => ({
        runId,
        modelCalls: await readJsonlFile<RuntimeModelCallRecord>(this.runJsonlPath(runId, "model-calls.jsonl")),
      }))
    );
  }

  runHome(runId: string): string {
    return this.runDirectory(runId);
  }

  private workspacePath(workspaceId: string): string {
    return path.join(this.runtimeHome, "workspaces", `${safeFileName(workspaceId)}.json`);
  }

  private conversationPath(conversationId: string): string {
    return path.join(this.runtimeHome, "conversations", `${safeFileName(conversationId)}.json`);
  }

  private runPath(runId: string): string {
    return path.join(this.runDirectory(runId), "run.json");
  }

  private contextLedgerPath(runId: string): string {
    return path.join(this.runDirectory(runId), "context-ledger.json");
  }

  private basicRunPath(runId: string): string {
    return path.join(this.runDirectory(runId), "basic-run.json");
  }

  private runJsonlPath(runId: string, fileName: string): string {
    return path.join(this.runDirectory(runId), fileName);
  }

  private runDirectory(runId: string): string {
    return path.join(this.runtimeHome, "runs", safeFileName(runId));
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonlFile(filePath: string, values: readonly unknown[]): Promise<void> {
  const lines = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFileAtomically(filePath, lines.length === 0 ? "" : `${lines}\n`);
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
  await fs.rename(tempPath, filePath).catch(async (error: unknown) => {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  });
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

async function readJsonlFile<T>(filePath: string): Promise<readonly T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (isFileNotFound(error)) {
      return [];
    }
    throw error;
  }
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function runtimeRunEnvelope(record: RuntimeRunRecord): RunEnvelope {
  return {
    runId: record.runId,
    updatedAt: record.updatedAt,
    status: record.status,
    runKind: record.runKind,
    runMode: record.runMode,
    conversationId: record.conversationId,
  };
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
