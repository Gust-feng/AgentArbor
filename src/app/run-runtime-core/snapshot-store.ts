export type RunEnvelope = {
  readonly runId: string;
  readonly updatedAt: string;
  readonly status: string;
  readonly runKind?: string;
  readonly runMode?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly conversationId?: string;
};

export interface RunSnapshotStore<TSnapshot> {
  upsert(snapshot: TSnapshot): Promise<TSnapshot>;
  get(runId: string): Promise<TSnapshot | undefined>;
  list(limit?: number): Promise<readonly TSnapshot[]>;
  delete(runId: string): Promise<void>;
}

export function createInMemoryRunSnapshotStore<TSnapshot>(input: {
  readonly getEnvelope: (snapshot: TSnapshot) => RunEnvelope;
}): RunSnapshotStore<TSnapshot> {
  const snapshots = new Map<string, TSnapshot>();
  return {
    async upsert(snapshot: TSnapshot): Promise<TSnapshot> {
      const stored = cloneJson(snapshot);
      snapshots.set(input.getEnvelope(stored).runId, stored);
      return cloneJson(stored);
    },
    async get(runId: string): Promise<TSnapshot | undefined> {
      const snapshot = snapshots.get(runId);
      return snapshot === undefined ? undefined : cloneJson(snapshot);
    },
    async list(limit = 50): Promise<readonly TSnapshot[]> {
      return [...snapshots.values()]
        .sort((left, right) => compareRunEnvelopeByRecency(input.getEnvelope(left), input.getEnvelope(right)))
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((snapshot) => cloneJson(snapshot));
    },
    async delete(runId: string): Promise<void> {
      snapshots.delete(runId);
    },
  };
}

function compareRunEnvelopeByRecency(left: RunEnvelope, right: RunEnvelope): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
