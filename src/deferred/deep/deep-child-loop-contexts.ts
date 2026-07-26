import { promises as fs } from "node:fs";
import path from "node:path";
import {
  persistedModelProtocolExtensions,
  type ModelMessage,
} from "../../domain/intelligence/index.js";
import { nowIso } from "../../kernel/id.js";
import { isNodeError, toPersistedJsonShape } from "../../kernel/values/index.js";

export const DEEP_CHILD_LOOP_CONTEXT_REF_PREFIX = "child_loop_context";

export type DeepChildLoopContextRecord = {
  readonly runId: string;
  readonly childRunId: string;
  readonly contextRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ModelMessage[];
};

export type DeepChildLoopContextInput = {
  readonly runId: string;
  readonly childRunId: string;
  readonly messages: readonly ModelMessage[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export interface DeepChildLoopContextStore {
  upsert(record: DeepChildLoopContextRecord): Promise<DeepChildLoopContextRecord>;
  getByRef(runId: string, contextRef: string): Promise<DeepChildLoopContextRecord | undefined>;
  listForChild(runId: string, childRunId: string): Promise<readonly DeepChildLoopContextRecord[]>;
  deleteForRun(runId: string): Promise<void>;
}

export class InMemoryDeepChildLoopContextStore implements DeepChildLoopContextStore {
  private readonly records = new Map<string, DeepChildLoopContextRecord>();

  async upsert(record: DeepChildLoopContextRecord): Promise<DeepChildLoopContextRecord> {
    assertCurrentContextRecord(record);
    const key = contextKey(record.runId, record.contextRef);
    const stored = latestContextRecord(this.records.get(key), record);
    this.records.set(key, toPersistedJsonShape(stored));
    return toPersistedJsonShape(stored);
  }

  async getByRef(runId: string, contextRef: string): Promise<DeepChildLoopContextRecord | undefined> {
    const record = this.records.get(contextKey(runId, contextRef));
    return record === undefined ? undefined : toPersistedJsonShape(record);
  }

  async listForChild(runId: string, childRunId: string): Promise<readonly DeepChildLoopContextRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.runId === runId && record.childRunId === childRunId)
      .sort(compareRecords)
      .map(toPersistedJsonShape);
  }

  async deleteForRun(runId: string): Promise<void> {
    for (const key of this.records.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.records.delete(key);
      }
    }
  }
}

export function createFileSystemDeepChildLoopContextStore(runtimeHome: string): DeepChildLoopContextStore {
  const root = path.join(runtimeHome, "deep-runs");
  return {
    async upsert(record: DeepChildLoopContextRecord): Promise<DeepChildLoopContextRecord> {
      assertCurrentContextRecord(record);
      const filePath = contextPath(root, record.runId, record.contextRef);
      const existing = await readCurrentContextRecord(filePath, record.runId, record.contextRef);
      const stored = latestContextRecord(existing, record);
      await writeJsonFile(filePath, stored);
      return toPersistedJsonShape(stored);
    },

    async getByRef(runId: string, contextRef: string): Promise<DeepChildLoopContextRecord | undefined> {
      return readCurrentContextRecord(contextPath(root, runId, contextRef), runId, contextRef);
    },

    async listForChild(runId: string, childRunId: string): Promise<readonly DeepChildLoopContextRecord[]> {
      const directory = path.join(root, safeFileName(runId), "child-loop-contexts");
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) {
          return [];
        }
        throw error;
      });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => readJsonFile<unknown>(path.join(directory, entry.name))),
      );
      return records
        .filter((record): record is DeepChildLoopContextRecord => isCurrentContextRecord(record))
        .filter((record) => record.runId === runId && record.childRunId === childRunId)
        .sort(compareRecords);
    },

    async deleteForRun(runId: string): Promise<void> {
      await fs.rm(path.join(root, safeFileName(runId), "child-loop-contexts"), { recursive: true, force: true });
    },
  };
}

export function createDeepChildLoopContextRecord(
  input: DeepChildLoopContextInput,
): DeepChildLoopContextRecord {
  const updatedAt = input.updatedAt ?? nowIso();
  const createdAt = input.createdAt ?? updatedAt;
  return {
    runId: input.runId,
    childRunId: input.childRunId,
    contextRef: createDeepChildLoopContextRef(input.childRunId),
    createdAt,
    updatedAt,
    messages: cloneMessages(input.messages),
  };
}

export function createDeepChildLoopContextRef(childRunId: string): string {
  return `${DEEP_CHILD_LOOP_CONTEXT_REF_PREFIX}:${childRunId}`;
}

function contextPath(root: string, runId: string, contextRef: string): string {
  return path.join(root, safeFileName(runId), "child-loop-contexts", `${safeFileName(contextRef)}.json`);
}

function contextKey(runId: string, contextRef: string): string {
  return `${runId}:${contextRef}`;
}

function compareRecords(left: DeepChildLoopContextRecord, right: DeepChildLoopContextRecord): number {
  const byTime = left.updatedAt.localeCompare(right.updatedAt);
  return byTime === 0 ? left.contextRef.localeCompare(right.contextRef) : byTime;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  });
  return content === undefined ? undefined : JSON.parse(content) as T;
}

async function readCurrentContextRecord(
  filePath: string,
  runId: string,
  contextRef: string,
): Promise<DeepChildLoopContextRecord | undefined> {
  const record = await readJsonFile<unknown>(filePath);
  return isCurrentContextRecord(record) && record.runId === runId && record.contextRef === contextRef
    ? record
    : undefined;
}

function latestContextRecord(
  existing: DeepChildLoopContextRecord | undefined,
  next: DeepChildLoopContextRecord,
): DeepChildLoopContextRecord {
  if (existing !== undefined && existing.childRunId !== next.childRunId) {
    throw new Error(`Deep child loop context ref collision: ${next.contextRef}`);
  }
  return {
    ...next,
    createdAt: existing?.createdAt ?? next.createdAt,
    messages: cloneMessages(next.messages),
  };
}

function assertCurrentContextRecord(record: unknown): asserts record is DeepChildLoopContextRecord {
  if (!isCurrentContextRecord(record)) {
    const contextRef = typeof record === "object" && record !== null && "contextRef" in record
      ? String(record.contextRef)
      : "(unknown)";
    throw new Error(`Invalid Deep child loop context record: ${contextRef}`);
  }
}

function isCurrentContextRecord(value: unknown): value is DeepChildLoopContextRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<DeepChildLoopContextRecord>;
  return typeof record.runId === "string" &&
    typeof record.childRunId === "string" &&
    typeof record.contextRef === "string" &&
    record.contextRef === createDeepChildLoopContextRef(record.childRunId) &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.messages);
}

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}


function cloneMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return messages.map((message) => {
    const protocolExtensions = persistedModelProtocolExtensions(message.protocolExtensions);
    return {
      role: message.role,
      content: message.content,
      ...(message.ref === undefined ? {} : { ref: message.ref }),
      ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
      ...(message.toolName === undefined ? {} : { toolName: message.toolName }),
      toolCalls: message.toolCalls?.map((toolCall) => ({
        callId: toolCall.callId,
        toolName: toolCall.toolName,
        input: globalThis.structuredClone(toolCall.input),
      })),
      ...(protocolExtensions === undefined ? {} : { protocolExtensions }),
    };
  });
}

