import path from "node:path";
import type { AgentRunTree } from "../../domain/underground/agent-fabric.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-database/run-snapshot-store.js";
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
export interface DeepRunRecordStore extends RunSnapshotStore<DeepRunRecord> {}

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

  async delete(runId: string): Promise<void> {
    return this.store.delete(runId);
  }
}

/** 文件系统实现写入 `${runtimeHome}/deep-runs/<runId>/record.json`。 */
export function createFileSystemDeepRunRecordStore(runtimeHome: string): DeepRunRecordStore {
  return createFileSystemRunSnapshotStore<DeepRunRecord>({
    rootDir: path.join(runtimeHome, DEEP_RUN_RECORD_PARTITION),
    getEnvelope: deepRunRecordEnvelope,
  });
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
