import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";

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
  readonly contextRef?: string;
  readonly messages: readonly ModelMessage[];
  readonly createdAt?: string;
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
    this.records.set(contextKey(record.runId, record.contextRef), clone(record));
    return clone(record);
  }

  async getByRef(runId: string, contextRef: string): Promise<DeepChildLoopContextRecord | undefined> {
    const record = this.records.get(contextKey(runId, contextRef));
    return record === undefined ? undefined : clone(record);
  }

  async listForChild(runId: string, childRunId: string): Promise<readonly DeepChildLoopContextRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.runId === runId && record.childRunId === childRunId)
      .sort(compareRecords)
      .map(clone);
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
      await writeJsonFile(contextPath(root, record.runId, record.contextRef), record);
      return clone(record);
    },

    async getByRef(runId: string, contextRef: string): Promise<DeepChildLoopContextRecord | undefined> {
      return readJsonFile<DeepChildLoopContextRecord>(contextPath(root, runId, contextRef));
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
          .map((entry) => readJsonFile<DeepChildLoopContextRecord>(path.join(directory, entry.name))),
      );
      return records
        .filter((record): record is DeepChildLoopContextRecord =>
          record !== undefined && record.childRunId === childRunId
        )
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
  const createdAt = input.createdAt ?? nowIso();
  return {
    runId: input.runId,
    childRunId: input.childRunId,
    contextRef: input.contextRef ?? createDeepChildLoopContextRef(input.childRunId),
    createdAt,
    updatedAt: createdAt,
    messages: cloneMessages(input.messages),
  };
}

export function createDeepChildLoopContextRef(childRunId: string): string {
  return `${DEEP_CHILD_LOOP_CONTEXT_REF_PREFIX}:${childRunId}:${createId("context")}`;
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

function safeFileName(value: string): string {
  return encodeURIComponent(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function cloneMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments?.map((attachment) => globalThis.structuredClone(attachment)),
    protocolExtensions:
      message.protocolExtensions === undefined ? undefined : globalThis.structuredClone(message.protocolExtensions),
    toolCalls: message.toolCalls?.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      input: globalThis.structuredClone(toolCall.input),
    })),
  }));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
