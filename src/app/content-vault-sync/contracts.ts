import type {
  ContentVaultChange,
  ContentVaultMutation,
  ContentVaultMutationResult,
  ContentVaultResource,
  ContentVaultResourceKind,
  ContentVaultSnapshotCursor,
} from "../content-vault/index.js";

export type ContentVaultSyncCredential = {
  readonly accountId: string;
  readonly deviceId: string;
  readonly baseUrl: string;
  readonly token: string;
};

export type ContentVaultSyncRemote = {
  mutate(mutations: readonly ContentVaultMutation[]): Promise<readonly ContentVaultMutationResult[]>;
  changes(after: number, limit?: number): Promise<{
    readonly changes: readonly ContentVaultChange[];
    readonly nextCursor: number;
    readonly hasMore: boolean;
  }>;
  snapshot(cursor?: ContentVaultSnapshotCursor, limit?: number): Promise<{
    readonly resources: readonly ContentVaultResource[];
    readonly nextCursor?: ContentVaultSnapshotCursor;
    readonly changeCursor: number;
  }>;
};

export type ContentVaultLocalResource = {
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly payloadSchemaVersion: 1;
  readonly payload: Readonly<Record<string, unknown>>;
};

/**
 * A content feature contributes only its public read/apply/event surface. The
 * sync engine never receives that feature's repository or database.
 */
export type ContentVaultSyncContributor = {
  readonly kind: ContentVaultResourceKind;
  list(): Promise<readonly ContentVaultLocalResource[]>;
  read(resourceId: string): Promise<ContentVaultLocalResource | undefined>;
  apply(resource: ContentVaultResource): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export type ContentVaultSyncResourceClock = {
  readonly accountId: string;
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly revision: number;
  readonly remoteContentHash: string;
  /** Fingerprint of the local projection created from the remote revision. */
  readonly localFingerprint: string;
  readonly deleted: boolean;
};

export type ContentVaultSyncOutboxEntry = {
  readonly accountId: string;
  readonly mutation: ContentVaultMutation;
  readonly createdAt: string;
};

export type ContentVaultSyncConflictReason =
  | "resource_not_found"
  | "revision_mismatch"
  | "resource_deleted"
  | "initial_divergence"
  | "remote_changed_while_local_pending"
  | "remote_apply_failed";

export type ContentVaultSyncConflict = {
  readonly accountId: string;
  readonly kind: ContentVaultResourceKind;
  readonly resourceId: string;
  readonly mutation?: ContentVaultMutation;
  readonly reason: ContentVaultSyncConflictReason;
  readonly current?: ContentVaultResource;
  readonly message?: string;
  readonly detectedAt: string;
};

export type ContentVaultSyncStatus = {
  readonly state: "stopped" | "idle" | "syncing" | "synced" | "blocked" | "failed";
  readonly accountId?: string;
  readonly cursor: number;
  readonly pendingMutations: number;
  readonly conflicts: number;
  readonly lastSyncedAt?: string;
  readonly error?: string;
};
