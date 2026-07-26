export const PATH_MEMORY_SCHEMA_VERSION = "path-memory/v1" as const;
export const PATH_MEMORY_DELETION_SCHEMA_VERSION = "path-memory-deletion/v1" as const;

export type PathMemoryFeatureErrorCode =
  | "path_memory_feature_released"
  | "path_memory_not_found"
  | "path_memory_source_conflict"
  | "path_memory_snapshot_incompatible"
  | "path_memory_repository_failure";

/** Expected command/query failures that callers may map without parsing messages. */
export class PathMemoryFeatureError extends Error {
  readonly name = "PathMemoryFeatureError";

  constructor(
    readonly code: PathMemoryFeatureErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type PathMemoryToolStep = {
  readonly ordinal: number;
  readonly toolFactId: string;
  readonly parentToolFactId?: string;
  readonly toolName: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly durationMs: number;
  readonly resultRef: string;
  readonly error?: {
    readonly domain?: string;
    readonly code?: string;
    readonly message: string;
  };
};

export type PathMemoryVerification =
  | {
      readonly status: "verified" | "failed";
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: "not_recorded";
      readonly evidenceRefs: readonly [];
    };

export type PathMemoryOutcome =
  | {
      readonly terminalStatus: "completed";
      readonly answerRef: string;
    }
  | {
      readonly terminalStatus: "failed";
      readonly error: { readonly code: string; readonly message: string };
    }
  | {
      readonly terminalStatus: "cancelled";
      readonly reason: string;
    }
  | {
      readonly terminalStatus: "blocked";
      readonly reason: { readonly code: string; readonly message: string };
      readonly continueBy: "new_turn";
    };

export type PathMemorySource = {
  readonly feature: "ordinary";
  readonly runId: string;
  readonly sourceRevision: number;
  readonly conversationId: string;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly predecessorRunId?: string;
  readonly runCreatedAt: string;
  readonly terminalAt: string;
};

export type PathMemory = {
  readonly id: string;
  readonly source: PathMemorySource;
  readonly scope: {
    readonly workspaceRoot: string;
    readonly workspaceSelection: "default" | "explicit";
  };
  readonly goal: {
    readonly userRequest: string;
    readonly taskContextRefs: readonly string[];
  };
  readonly path: {
    readonly executionStarted: boolean;
    readonly toolSteps: readonly PathMemoryToolStep[];
  };
  readonly outcome: PathMemoryOutcome;
  readonly verification: PathMemoryVerification;
  readonly evidenceRefs: readonly string[];
  readonly capturedAt: string;
};

export type PathMemoryDocument = {
  readonly schemaVersion: typeof PATH_MEMORY_SCHEMA_VERSION;
  readonly memory: PathMemory;
};

/** Deterministic identity: one Ordinary run owns at most one PathMemory. */
export function pathMemoryIdForSource(source: {
  readonly feature: "ordinary";
  readonly runId: string;
}): string {
  return `path-memory:${source.feature}:${source.runId}`;
}

export type PathMemoryCaptureInput = {
  readonly source: PathMemorySource;
  readonly scope: PathMemory["scope"];
  readonly goal: PathMemory["goal"];
  readonly path: PathMemory["path"];
  readonly outcome: PathMemoryOutcome;
  readonly verification: PathMemoryVerification;
  readonly evidenceRefs: readonly string[];
};

export type PathMemoryCaptureResult =
  | { readonly status: "created"; readonly memory: PathMemory }
  | { readonly status: "existing"; readonly memory: PathMemory }
  /** The source restated this run at a higher revision; the older record is gone. */
  | { readonly status: "replaced"; readonly memory: PathMemory; readonly supersededRevision: number }
  /** The user explicitly forgot this source; capture and reconciliation must not resurrect it. */
  | { readonly status: "suppressed"; readonly memoryId: string; readonly deletedAt: string };

/** Durable forget fact; without it startup reconciliation would resurrect deleted memories. */
export type PathMemoryDeletionRecord = {
  readonly memoryId: string;
  readonly deletedAt: string;
};

export type PathMemoryDeletionDocument = {
  readonly schemaVersion: typeof PATH_MEMORY_DELETION_SCHEMA_VERSION;
  readonly deletion: PathMemoryDeletionRecord;
};

export type PathMemoryListFilter = {
  readonly conversationId?: string;
  readonly workspaceRoot?: string;
  readonly terminalStatus?: PathMemoryOutcome["terminalStatus"];
  readonly limit?: number;
};

export type PathMemorySearchInput = {
  readonly text: string;
  readonly workspaceRoot?: string;
  readonly conversationId?: string;
  readonly terminalStatus?: PathMemoryOutcome["terminalStatus"];
  readonly limit?: number;
};

export type PathMemorySearchMatchedField =
  | "userRequest"
  | "toolName"
  | "workspaceRoot"
  | "conversationId";

export type PathMemorySearchMatch = {
  readonly memory: PathMemory;
  readonly score: number;
  readonly matchedFields: readonly PathMemorySearchMatchedField[];
};

export type PathMemoryEvent =
  | { readonly type: "path_memory.captured"; readonly memory: PathMemory }
  | {
      readonly type: "path_memory.replaced";
      readonly memory: PathMemory;
      readonly supersededRevision: number;
    }
  | { readonly type: "path_memory.deleted"; readonly memoryId: string };

export interface PathMemoryRepository {
  /**
   * Atomically creates the record for its deterministic id.
   * Returns the stored memory when an identical record already exists, replaces
   * it when the incoming `sourceRevision` is higher, returns `suppressed`
   * without writing when the id carries a deletion tombstone, and throws
   * `path_memory_source_conflict` when content differs at the same or an older
   * revision.
   */
  create(memory: PathMemory): Promise<PathMemoryCaptureResult>;
  get(memoryId: string): Promise<PathMemory | undefined>;
  findBySource(input: { readonly feature: "ordinary"; readonly runId: string }): Promise<PathMemory | undefined>;
  list(filter?: PathMemoryListFilter): Promise<readonly PathMemory[]>;
  /**
   * Persists a deletion tombstone first, then removes the record, so capture
   * and startup reconciliation cannot resurrect the source. Returns true when
   * a stored record was removed; false when no record existed.
   */
  delete(memoryId: string, deletedAt: string): Promise<boolean>;
}

export interface PathMemoryFeature {
  readonly commands: {
    capture(input: PathMemoryCaptureInput): Promise<PathMemoryCaptureResult>;
    delete(memoryId: string): Promise<void>;
  };
  readonly queries: {
    get(memoryId: string): Promise<PathMemory | undefined>;
    findBySource(input: {
      readonly feature: "ordinary";
      readonly runId: string;
    }): Promise<PathMemory | undefined>;
    list(filter?: PathMemoryListFilter): Promise<readonly PathMemory[]>;
    search(input: PathMemorySearchInput): Promise<readonly PathMemorySearchMatch[]>;
  };
  readonly events: {
    subscribe(listener: (event: PathMemoryEvent) => void): () => void;
  };
  release(): Promise<void>;
}
