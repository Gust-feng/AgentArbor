import type {
  WorkbenchProjectionChange,
  WorkbenchProjectionOwner,
} from "../panel-api-contracts.js";

const DEFAULT_HISTORY_LIMIT = 256;
const ALL_OWNERS: readonly WorkbenchProjectionOwner[] = [
  "spaces",
  "mounted_files",
  "personal_knowledge",
  "conversations",
];

export type WorkbenchProjectionChangeInput = Omit<WorkbenchProjectionChange, "revision" | "reset">;

export type WorkbenchProjectionChangeReplay = {
  readonly cursor: number;
  readonly reset: boolean;
  readonly changes: readonly WorkbenchProjectionChange[];
};

export type WorkbenchProjectionChangeFeed = {
  publish(change: WorkbenchProjectionChangeInput): WorkbenchProjectionChange;
  replay(afterRevision?: number): WorkbenchProjectionChangeReplay;
  subscribe(listener: (change: WorkbenchProjectionChange) => void): () => void;
  release(): void;
};

/** Host-owned live invalidation feed. Business snapshots remain in their owning features. */
export function createWorkbenchProjectionChangeFeed(
  historyLimit = DEFAULT_HISTORY_LIMIT,
): WorkbenchProjectionChangeFeed {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error("Workbench projection change history limit must be a positive safe integer.");
  }
  const listeners = new Set<(change: WorkbenchProjectionChange) => void>();
  const history: WorkbenchProjectionChange[] = [];
  let revision = 0;
  let released = false;

  return {
    publish(input) {
      if (released) throw new Error("Workbench projection change feed is released.");
      const change: WorkbenchProjectionChange = {
        ...input,
        owners: uniqueOwners(input.owners),
        revision: ++revision,
        reset: false,
      };
      history.push(change);
      while (history.length > historyLimit) history.shift();
      for (const listener of [...listeners]) {
        try { listener(change); } catch { /* Projection observers cannot affect the committed source fact. */ }
      }
      return change;
    },
    replay(afterRevision) {
      if (released) throw new Error("Workbench projection change feed is released.");
      if (afterRevision === undefined) {
        return { cursor: revision, reset: true, changes: [resetChange(revision)] };
      }
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > revision) {
        return { cursor: revision, reset: true, changes: [resetChange(revision)] };
      }
      const oldestAvailable = history[0]?.revision ?? revision + 1;
      if (afterRevision + 1 < oldestAvailable) {
        return { cursor: revision, reset: true, changes: [resetChange(revision)] };
      }
      return {
        cursor: revision,
        reset: false,
        changes: history.filter((change) => change.revision > afterRevision),
      };
    },
    subscribe(listener) {
      if (released) throw new Error("Workbench projection change feed is released.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release() {
      if (released) return;
      released = true;
      listeners.clear();
      history.length = 0;
    },
  };
}

function resetChange(revision: number): WorkbenchProjectionChange {
  return { revision, reset: true, owners: ALL_OWNERS };
}

function uniqueOwners(owners: readonly WorkbenchProjectionOwner[]): readonly WorkbenchProjectionOwner[] {
  return [...new Set(owners)];
}
