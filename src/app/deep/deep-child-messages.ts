import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ChildAgentRunParentInstructionSource,
  ChildAgentRunParentInstructionStatus,
} from "../../domain/underground/agent-fabric.js";

export const DEEP_CHILD_MESSAGE_REF_PREFIX = "child_message";

export type DeepChildMessageRecord = {
  readonly runId: string;
  readonly childRunId: string;
  readonly instructionId: string;
  readonly messageRef: string;
  readonly source: ChildAgentRunParentInstructionSource;
  readonly status: ChildAgentRunParentInstructionStatus;
  /**
   * Raw parent-to-child instruction kept for child run resumability and audit.
   * This record is internal storage only; default events, liveProjection, and
   * AgentRunTree continue to reference it by messageRef plus safe summaries.
   */
  readonly content: string;
  readonly contentSummary: string;
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
  readonly updatedAt: string;
};

export type DeepChildMessageInput = {
  readonly runId: string;
  readonly childRunId: string;
  readonly instructionId: string;
  readonly messageRef?: string;
  readonly source: ChildAgentRunParentInstructionSource;
  readonly status: ChildAgentRunParentInstructionStatus;
  readonly content: string;
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
};

export interface DeepChildMessageStore {
  upsert(record: DeepChildMessageRecord): Promise<DeepChildMessageRecord>;
  getByRef(runId: string, messageRef: string): Promise<DeepChildMessageRecord | undefined>;
  listForRun(runId: string): Promise<readonly DeepChildMessageRecord[]>;
  listForChild(runId: string, childRunId: string): Promise<readonly DeepChildMessageRecord[]>;
}

export class InMemoryDeepChildMessageStore implements DeepChildMessageStore {
  private readonly records = new Map<string, DeepChildMessageRecord>();

  async upsert(record: DeepChildMessageRecord): Promise<DeepChildMessageRecord> {
    this.records.set(messageKey(record.runId, record.messageRef), clone(record));
    return clone(record);
  }

  async getByRef(runId: string, messageRef: string): Promise<DeepChildMessageRecord | undefined> {
    const record = this.records.get(messageKey(runId, messageRef));
    return record === undefined ? undefined : clone(record);
  }

  async listForRun(runId: string): Promise<readonly DeepChildMessageRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.runId === runId)
      .sort(compareMessages)
      .map(clone);
  }

  async listForChild(runId: string, childRunId: string): Promise<readonly DeepChildMessageRecord[]> {
    return (await this.listForRun(runId)).filter((record) => record.childRunId === childRunId);
  }
}

export function createFileSystemDeepChildMessageStore(runtimeHome: string): DeepChildMessageStore {
  const root = path.join(runtimeHome, "deep-runs");
  return {
    async upsert(record: DeepChildMessageRecord): Promise<DeepChildMessageRecord> {
      const filePath = messagePath(root, record.runId, record.messageRef);
      await writeJsonFile(filePath, record);
      return clone(record);
    },

    async getByRef(runId: string, messageRef: string): Promise<DeepChildMessageRecord | undefined> {
      return readJsonFile<DeepChildMessageRecord>(messagePath(root, runId, messageRef));
    },

    async listForRun(runId: string): Promise<readonly DeepChildMessageRecord[]> {
      const directory = path.join(root, safeFileName(runId), "child-messages");
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) {
          return [];
        }
        throw error;
      });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => readJsonFile<DeepChildMessageRecord>(path.join(directory, entry.name))),
      );
      return records
        .filter((record): record is DeepChildMessageRecord => record !== undefined)
        .sort(compareMessages);
    },

    async listForChild(runId: string, childRunId: string): Promise<readonly DeepChildMessageRecord[]> {
      return (await this.listForRun(runId)).filter((record) => record.childRunId === childRunId);
    },
  };
}

export function createDeepChildMessageRecord(input: DeepChildMessageInput): DeepChildMessageRecord {
  const messageRef = input.messageRef ?? createDeepChildMessageRef(input.instructionId);
  return {
    runId: input.runId,
    childRunId: input.childRunId,
    instructionId: input.instructionId,
    messageRef,
    source: input.source,
    status: input.status,
    content: input.content,
    contentSummary: summarizeDeepChildMessage(input.content),
    requestedAt: input.requestedAt,
    queuedAt: input.queuedAt,
    executedAt: input.executedAt,
    cancelledAt: input.cancelledAt,
    updatedAt: input.executedAt ?? input.cancelledAt ?? input.queuedAt ?? input.requestedAt,
  };
}

export function createDeepChildMessageRef(instructionId: string): string {
  return `${DEEP_CHILD_MESSAGE_REF_PREFIX}:${instructionId}`;
}

export function summarizeDeepChildMessage(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function messagePath(root: string, runId: string, messageRef: string): string {
  return path.join(root, safeFileName(runId), "child-messages", `${safeFileName(messageRef)}.json`);
}

function messageKey(runId: string, messageRef: string): string {
  return `${runId}:${messageRef}`;
}

function compareMessages(left: DeepChildMessageRecord, right: DeepChildMessageRecord): number {
  const byTime = left.updatedAt.localeCompare(right.updatedAt);
  return byTime === 0 ? left.messageRef.localeCompare(right.messageRef) : byTime;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
