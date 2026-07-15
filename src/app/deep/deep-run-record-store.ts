import path from "node:path";
import type { AgentRunTree } from "../../domain/underground/agent-fabric.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-storage/run-snapshot-store.js";
import {
  createInMemoryRunSnapshotStore,
  type RunEnvelope,
  type RunSnapshotStore,
} from "../run-runtime-core/snapshot-store.js";
import type {
  DeepExplorationReport,
  DeepLiveProjection,
  DeepResearchBrief,
  DeepRun,
} from "./contracts.js";
import type { DeepRunControlEvent } from "./deep-run-executor.js";
import type { DeepRunStreamEvent } from "./deep-events.js";

/** deep run 的运行级分区名，与普通会话记录隔离。 */
export const DEEP_RUN_RECORD_PARTITION = "deep-runs";

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
