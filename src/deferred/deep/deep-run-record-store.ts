import path from "node:path";
import { z } from "zod";
import type { AgentRunTree } from "../../domain/underground/agent-fabric.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-storage/run-snapshot-store.js";
import {
  createInMemoryRunSnapshotStore,
  type RunEnvelope,
  type RunSnapshotCodec,
  type RunSnapshotStore,
} from "../../app/run-runtime-core/snapshot-store.js";
import type {
  DeepExplorationReport,
  DeepLiveProjection,
  DeepResearchBrief,
  DeepRun,
} from "./contracts.js";
import type { DeepRunControlEvent } from "./deep-run-executor.js";
import type { DeepRunStreamEvent } from "./deep-events.js";
import {
  projectMultiAgentCapabilitySnapshot,
  type MultiAgentCapabilitySnapshot,
} from "./multi-agent-capability-snapshot.js";

/** deep run 的运行级分区名，与普通会话记录隔离。 */
export const DEEP_RUN_RECORD_PARTITION = "deep-runs";
export const DEEP_RUN_RECORD_SCHEMA_VERSION = "deep-run-record/v1";

/**
 * 一次 deep run 的持久化快照，承载可重放事件、运行树、实时投影和最终报告。
 */
export type DeepRunRecord = {
  readonly run: DeepRun;
  readonly agentRunTree: AgentRunTree;
  readonly report?: DeepExplorationReport;
  readonly controlEvents: readonly DeepRunControlEvent[];
  readonly eventSequence: readonly DeepRunStreamEvent[];
  readonly liveProjection?: DeepLiveProjection;
  readonly brief?: DeepResearchBrief;
  readonly updatedAt: string;
};

const jsonObjectSchema = z.record(z.string(), z.unknown());
const multiAgentCapabilitySnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  createdAt: z.string().min(1),
  activeModel: jsonObjectSchema,
  modelCapabilities: jsonObjectSchema,
  toolCatalog: z.object({
    scope: z.literal("desktop-basic"),
    tools: z.array(jsonObjectSchema),
    allowedTools: z.array(z.string()),
  }).strict(),
  mcpCatalog: z.array(jsonObjectSchema),
  workspace: jsonObjectSchema,
  commandShell: jsonObjectSchema.optional(),
  toolConfirmation: jsonObjectSchema.optional(),
  securitySummary: z.string(),
  warnings: z.array(z.string()),
}).strip().transform((snapshot) =>
  projectMultiAgentCapabilitySnapshot(snapshot as unknown as MultiAgentCapabilitySnapshot)
);
const deepRunRecordSchema = z.object({
  run: z.object({
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    parentRunId: z.string().min(1).optional(),
    rootRunId: z.string().min(1).optional(),
    turnOrdinal: z.number().int().positive().optional(),
    goal: z.string(),
    status: z.enum(["pending", "running", "interrupted", "corrected", "stopped", "completed", "failed"]),
    isolation: z.object({
      kind: z.literal("deep_conversation"),
      runKind: z.literal("underground"),
      runMode: z.literal("deep"),
    }).strict(),
    aiMode: z.enum(["none", "fake", "openai-compatible", "openai-responses"]).optional(),
    // v1 readers drop former Ordinary-only catalogs while preserving every
    // capability fact that can affect Multi-Agent execution and continuation.
    capabilitySnapshot: multiAgentCapabilitySnapshotSchema.optional(),
    continuationFacts: jsonObjectSchema.optional(),
    startedAt: z.string().min(1),
    updatedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
  }).strict(),
  agentRunTree: z.object({
    treeId: z.string().min(1),
    rootRunId: z.string().min(1),
    rootAgentId: z.string().min(1),
    rootSpec: jsonObjectSchema,
    childRuns: z.array(jsonObjectSchema),
    delegationDecisions: z.array(jsonObjectSchema),
    parentSyntheses: z.array(jsonObjectSchema),
    status: z.enum(["running", "completed", "failed", "stopped"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  report: z.object({
    reportId: z.string().min(1),
    runId: z.string().min(1),
    conversationId: z.string().min(1),
    goal: z.string(),
    agentRunTree: jsonObjectSchema,
    childSummaries: z.array(jsonObjectSchema),
    synthesisRecords: z.array(jsonObjectSchema),
    conclusion: jsonObjectSchema,
    createdAt: z.string().min(1),
  }).strict().optional(),
  controlEvents: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("interrupt"),
      atStepIndex: z.number().int().nonnegative(),
      recordedAt: z.string().min(1),
      reason: z.string().optional(),
      preservedChildRuns: z.number().int().nonnegative(),
      preservedMaterials: z.number().int().nonnegative(),
    }).strict(),
    z.object({
      kind: z.literal("correct"),
      atStepIndex: z.number().int().nonnegative(),
      recordedAt: z.string().min(1),
      correctionContext: z.array(z.string()),
      reason: z.string().optional(),
    }).strict(),
    z.object({
      kind: z.literal("stop"),
      atStepIndex: z.number().int().nonnegative(),
      recordedAt: z.string().min(1),
      reason: z.string().optional(),
      partialSynthesis: z.boolean(),
    }).strict(),
  ])),
  eventSequence: z.array(z.object({
    id: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().positive(),
    type: z.enum([
      "deep.goal_received", "deep.manager.decided", "deep.child.started", "deep.child.waiting",
      "deep.child.instruction_queued", "deep.child.completed", "deep.child.blocked",
      "deep.child.interrupted", "deep.child.failed", "deep.parent_synthesis.completed", "deep.failed",
      "deep.interrupted", "deep.corrected", "deep.stopped", "deep.conclusion.produced",
    ]),
    title: z.string(),
    summary: z.string(),
    status: z.string(),
    timestamp: z.string().min(1),
    refs: z.array(z.object({
      kind: z.enum([
        "conversation", "delegation_decision", "child_run", "child_instruction", "parent_synthesis",
        "control", "conclusion", "agent_run_tree",
      ]),
      refId: z.string().min(1),
    }).strict()),
    visibility: z.literal("public"),
  }).strict()),
  liveProjection: z.object({
    phase: z.enum(["starting", "deciding", "exploring", "synthesizing", "completed", "needs_input", "stopped", "failed"]),
    activeNodeId: z.string(),
    children: z.array(jsonObjectSchema),
    decision: jsonObjectSchema.optional(),
    synthesis: jsonObjectSchema.optional(),
    conclusion: jsonObjectSchema.optional(),
    updatedAt: z.string().min(1),
  }).strict().optional(),
  brief: z.object({
    briefId: z.string().min(1),
    goal: z.string(),
    scopeSummary: z.string(),
    sourcePolicySummary: z.string(),
    plannedAngles: z.array(z.string()),
    needsUserApproval: z.boolean(),
    updatedAt: z.string().min(1),
  }).strict().optional(),
  updatedAt: z.string().min(1),
}).strict().superRefine((record, context) => {
  record.eventSequence.forEach((event, index) => {
    if (event.runId !== record.run.runId || event.sequence !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Deep event identity or sequence is invalid",
        path: ["eventSequence", index],
      });
    }
  });
  if (record.report !== undefined && (
    record.report.runId !== record.run.runId ||
    record.report.conversationId !== record.run.conversationId
  )) {
    context.addIssue({ code: "custom", message: "Deep report identity is invalid", path: ["report"] });
  }
});

const deepRunRecordCodec: RunSnapshotCodec<DeepRunRecord> = {
  schemaVersion: DEEP_RUN_RECORD_SCHEMA_VERSION,
  decode(value) {
    const parsed = deepRunRecordSchema.safeParse(value);
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
    return parsed.data as unknown as DeepRunRecord;
  },
};

/** Deep run 隔离持久化端口。 */
export interface DeepRunRecordStore extends RunSnapshotStore<DeepRunRecord> {
  /**
   * 按会话查询完整 run 集合。省略 limit 时不截断；显式 limit 在筛选和排序后生效。
   */
  listByConversation(conversationId: string, limit?: number): Promise<readonly DeepRunRecord[]>;
  /**
   * 按任务链根 run 查询。兼容尚未携带 rootRunId 的首轮记录。
   * 省略 limit 时不截断；显式 limit 在筛选和排序后生效。
   */
  listByRootRun(rootRunId: string, limit?: number): Promise<readonly DeepRunRecord[]>;
}

/** 内存实现用于测试和开发态运行。 */
export class InMemoryDeepRunRecordStore implements DeepRunRecordStore {
  private readonly store = createInMemoryRunSnapshotStore<DeepRunRecord>({
    getEnvelope: deepRunRecordEnvelope,
    codec: deepRunRecordCodec,
  });

  async upsert(record: DeepRunRecord): Promise<DeepRunRecord> {
    return this.store.upsert(record);
  }

  async get(runId: string): Promise<DeepRunRecord | undefined> {
    return this.store.get(runId);
  }

  async list(limit = 50): Promise<readonly DeepRunRecord[]> {
    return this.store.list(limit);
  }

  async listByConversation(conversationId: string, limit?: number): Promise<readonly DeepRunRecord[]> {
    return listMatchingDeepRunRecords(
      this.store,
      (record) => record.run.conversationId === conversationId,
      limit,
    );
  }

  async listByRootRun(rootRunId: string, limit?: number): Promise<readonly DeepRunRecord[]> {
    return listMatchingDeepRunRecords(
      this.store,
      (record) => (record.run.rootRunId ?? record.run.runId) === rootRunId,
      limit,
    );
  }

  async delete(runId: string): Promise<void> {
    return this.store.delete(runId);
  }
}

/** 文件系统实现写入 `${runtimeHome}/deep-runs/<runId>/record.json`。 */
export function createFileSystemDeepRunRecordStore(runtimeHome: string): DeepRunRecordStore {
  const store = createFileSystemRunSnapshotStore<DeepRunRecord>({
    rootDir: path.join(runtimeHome, DEEP_RUN_RECORD_PARTITION),
    getEnvelope: deepRunRecordEnvelope,
    codec: deepRunRecordCodec,
  });
  return {
    upsert: (record) => store.upsert(record),
    get: (runId) => store.get(runId),
    list: (limit) => store.list(limit),
    delete: (runId) => store.delete(runId),
    listByConversation: (conversationId, limit) => listMatchingDeepRunRecords(
      store,
      (record) => record.run.conversationId === conversationId,
      limit,
    ),
    listByRootRun: (rootRunId, limit) => listMatchingDeepRunRecords(
      store,
      (record) => (record.run.rootRunId ?? record.run.runId) === rootRunId,
      limit,
    ),
  };
}

async function listMatchingDeepRunRecords(
  store: RunSnapshotStore<DeepRunRecord>,
  matches: (record: DeepRunRecord) => boolean,
  limit: number | undefined,
): Promise<readonly DeepRunRecord[]> {
  // RunSnapshotStore 的 list 是展示查询并有默认窗口；Deep 领域查询必须先取全量，
  // 再按 owning feature 的键筛选和限量，避免旧记录被最近窗口遮蔽。索引尚未出生前，
  // 全量扫描只存在于 store 内部，调用方不应再复制这个实现细节。
  const matching = (await store.list(Number.MAX_SAFE_INTEGER))
    .filter(matches)
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
  return limit === undefined
    ? matching
    : matching.slice(0, Math.max(0, Math.floor(limit)));
}

function deepRunRecordEnvelope(record: DeepRunRecord): RunEnvelope {
  return {
    runId: record.run.runId,
    updatedAt: record.run.updatedAt,
    status: record.run.status,
    runKind: record.run.isolation.runKind,
    runMode: record.run.isolation.runMode,
    rootRunId: record.run.rootRunId,
    parentRunId: record.run.parentRunId,
    conversationId: record.run.conversationId,
  };
}
