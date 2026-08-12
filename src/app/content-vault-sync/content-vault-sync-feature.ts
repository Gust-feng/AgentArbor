import { createHash, randomUUID } from "node:crypto";

import {
  canonicalContentVaultJson,
  CONTENT_VAULT_PROTOCOL_VERSION,
  contentVaultResourceKindSchema,
  createContentVaultHttpClient,
  type ContentVaultMutation,
  type ContentVaultResource,
  type ContentVaultResourceKind,
} from "../content-vault/index.js";
import type {
  ContentVaultLocalResource,
  ContentVaultSyncContributor,
  ContentVaultSyncCredential,
  ContentVaultSyncRemote,
  ContentVaultSyncStatus,
} from "./contracts.js";
import type { ContentVaultSyncStore } from "./sqlite-store.js";

const DELETED_LOCAL_FINGERPRINT = "deleted";

export function createContentVaultSyncFeature(input: {
  readonly store: ContentVaultSyncStore;
  readonly credential: () => Promise<ContentVaultSyncCredential | undefined>;
  readonly contributors: readonly ContentVaultSyncContributor[];
  readonly requireAllResourceKinds?: boolean;
  readonly remote?: (credential: ContentVaultSyncCredential) => ContentVaultSyncRemote;
  readonly fetch?: typeof globalThis.fetch;
  readonly idFactory?: () => string;
  readonly now?: () => string;
  readonly pollIntervalMs?: number;
  readonly localChangeDebounceMs?: number;
  readonly onDiagnostic?: (error: unknown) => void;
}) {
  const idFactory = input.idFactory ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;
  const localChangeDebounceMs = input.localChangeDebounceMs ?? 500;
  const contributors = new Map<ContentVaultResourceKind, ContentVaultSyncContributor>();
  for (const contributor of input.contributors) {
    if (contributors.has(contributor.kind)) throw new Error(`Content Vault contributor ${contributor.kind} is duplicated`);
    contributors.set(contributor.kind, contributor);
  }
  if (input.requireAllResourceKinds) {
    const missing = contentVaultResourceKindSchema.options.filter((kind) => !contributors.has(kind));
    if (missing.length > 0) throw new Error(`Content Vault contributors are missing: ${missing.join(", ")}`);
  }
  const unsubscribers = input.contributors.map((contributor) => contributor.subscribe(() => wake(localChangeDebounceMs)));
  let active = false;
  let released = false;
  let timer: NodeJS.Timeout | undefined;
  let queue = Promise.resolve();
  let status: ContentVaultSyncStatus = {
    state: "stopped",
    cursor: 0,
    pendingMutations: 0,
    conflicts: 0,
  };

  function createRemote(credential: ContentVaultSyncCredential): ContentVaultSyncRemote {
    return input.remote?.(credential) ?? createContentVaultHttpClient({
      baseUrl: credential.baseUrl,
      token: credential.token,
      fetch: input.fetch,
    });
  }

  function wake(delay = 0): void {
    if (!active || released) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void synchronize().catch((error: unknown) => input.onDiagnostic?.(error));
    }, delay);
    timer.unref?.();
  }

  async function runSynchronization(): Promise<void> {
    if (released) throw new Error("Content Vault Sync feature is released");
    const credential = await input.credential();
    if (credential === undefined) {
      status = { state: active ? "idle" : "stopped", cursor: 0, pendingMutations: 0, conflicts: 0 };
      return;
    }
    const remote = createRemote(credential);
    const state = input.store.accountState(credential.accountId);
    status = {
      state: "syncing",
      accountId: credential.accountId,
      cursor: state.cursor,
      pendingMutations: input.store.pending(credential.accountId).length,
      conflicts: input.store.listConflicts(credential.accountId).length,
    };
    try {
      await reconcileLocal(credential.accountId);
      await flushOutbox(credential.accountId, remote);
      const initialized = input.store.accountState(credential.accountId).snapshotInitialized;
      if (initialized) await pullChanges(credential.accountId, remote);
      else await applyInitialSnapshot(credential.accountId, remote);
      await retryRemoteApplyConflicts(credential.accountId);
      await reconcileLocal(credential.accountId);
      await flushOutbox(credential.accountId, remote);
      const next = input.store.accountState(credential.accountId);
      const conflicts = input.store.listConflicts(credential.accountId).length;
      status = {
        state: conflicts > 0 ? "blocked" : "synced",
        accountId: credential.accountId,
        cursor: next.cursor,
        pendingMutations: input.store.pending(credential.accountId).length,
        conflicts,
        lastSyncedAt: now(),
      };
    } catch (error) {
      const current = input.store.accountState(credential.accountId);
      status = {
        state: "failed",
        accountId: credential.accountId,
        cursor: current.cursor,
        pendingMutations: input.store.pending(credential.accountId).length,
        conflicts: input.store.listConflicts(credential.accountId).length,
        error: error instanceof Error ? error.message : "Content Vault synchronization failed",
      };
      throw error;
    } finally {
      if (active && !released) wake(pollIntervalMs);
    }
  }

  function synchronize(): Promise<void> {
    const result = queue.then(runSynchronization, runSynchronization);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function stop(): Promise<void> {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    await queue;
    if (!released && !active) status = { ...status, state: "stopped" };
  }

  async function reconcileLocal(accountId: string): Promise<void> {
    for (const contributor of contributors.values()) {
      const localResources = new Map((await contributor.list()).map((resource) => [resource.resourceId, resource]));
      for (const resource of localResources.values()) {
        if (input.store.getConflict(accountId, resource.kind, resource.resourceId) !== undefined) continue;
        if (input.store.outboxForResource(accountId, resource.kind, resource.resourceId) !== undefined) continue;
        const fingerprint = localFingerprint(resource);
        const clock = input.store.getClock(accountId, resource.kind, resource.resourceId);
        if (clock?.localFingerprint === fingerprint) continue;
        input.store.enqueue(accountId, upsertMutation(resource, clock?.revision ?? 0, idFactory()), now());
      }
      for (const clock of input.store.listClocks(accountId, contributor.kind)) {
        if (localResources.has(clock.resourceId) || clock.deleted) continue;
        if (input.store.getConflict(accountId, clock.kind, clock.resourceId) !== undefined) continue;
        if (input.store.outboxForResource(accountId, clock.kind, clock.resourceId) !== undefined) continue;
        input.store.enqueue(accountId, {
          protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
          mutationId: idFactory(),
          kind: clock.kind,
          resourceId: clock.resourceId,
          operation: "delete",
          baseRevision: clock.revision,
        }, now());
      }
    }
  }

  async function flushOutbox(accountId: string, remote: ContentVaultSyncRemote): Promise<void> {
    while (true) {
      const entry = input.store.pending(accountId, 1)[0];
      if (entry === undefined) return;
      const result = (await remote.mutate([entry.mutation]))[0];
      if (result === undefined || result.mutationId !== entry.mutation.mutationId) {
        throw new Error(`Content Vault did not return mutation ${entry.mutation.mutationId}`);
      }
      if (result.status === "applied") {
        input.store.acceptOutbox(accountId, entry.mutation.mutationId, result.resource, mutationLocalFingerprint(entry.mutation));
        continue;
      }
      if (equivalentConflict(entry.mutation, result.current)) {
        input.store.acceptOutbox(accountId, entry.mutation.mutationId, result.current!, mutationLocalFingerprint(entry.mutation));
        continue;
      }
      input.store.recordConflict({
        accountId,
        kind: entry.mutation.kind,
        resourceId: entry.mutation.resourceId,
        mutation: entry.mutation,
        reason: result.reason,
        ...(result.current === undefined ? {} : { current: result.current }),
        detectedAt: now(),
      });
    }
  }

  async function applyInitialSnapshot(accountId: string, remote: ContentVaultSyncRemote): Promise<void> {
    let pageCursor: import("../content-vault/index.js").ContentVaultSnapshotCursor | undefined;
    let snapshotCursor = 0;
    while (true) {
      const page = await remote.snapshot(pageCursor, 100);
      if (pageCursor !== undefined && page.changeCursor !== snapshotCursor) {
        throw new Error("Content Vault snapshot cursor changed during pagination");
      }
      snapshotCursor = page.changeCursor;
      for (const resource of page.resources) {
        await applyRemoteResource(accountId, resource);
      }
      if (page.nextCursor === undefined) break;
      pageCursor = page.nextCursor;
    }
    input.store.completeSnapshot(accountId, snapshotCursor);
    await pullChanges(accountId, remote);
  }

  async function pullChanges(accountId: string, remote: ContentVaultSyncRemote): Promise<void> {
    let cursor = input.store.accountState(accountId).cursor;
    while (true) {
      const page = await remote.changes(cursor, 100);
      for (const change of page.changes) {
        await applyRemoteResource(accountId, change.resource, change.cursor);
        cursor = change.cursor;
      }
      if (page.changes.length === 0 && page.nextCursor > cursor) {
        input.store.advanceCursor(accountId, page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!page.hasMore || page.nextCursor <= cursor && page.changes.length === 0) return;
    }
  }

  async function applyRemoteResource(accountId: string, resource: ContentVaultResource, cursor?: number): Promise<void> {
    const contributor = contributors.get(resource.kind);
    if (contributor === undefined) {
      input.store.recordConflict({
        accountId,
        kind: resource.kind,
        resourceId: resource.resourceId,
        reason: "remote_apply_failed",
        current: resource,
        message: `No local Content Vault contributor owns ${resource.kind}`,
        detectedAt: now(),
      }, cursor);
      return;
    }
    const existingConflict = input.store.getConflict(accountId, resource.kind, resource.resourceId);
    if (existingConflict !== undefined) {
      input.store.recordConflict({
        ...existingConflict,
        current: resource,
        detectedAt: now(),
      }, cursor);
      return;
    }
    const pending = input.store.outboxForResource(accountId, resource.kind, resource.resourceId);
    if (pending !== undefined) {
      input.store.recordConflict({
        accountId,
        kind: resource.kind,
        resourceId: resource.resourceId,
        mutation: pending.mutation,
        reason: "remote_changed_while_local_pending",
        current: resource,
        detectedAt: now(),
      }, cursor);
      return;
    }
    const clock = input.store.getClock(accountId, resource.kind, resource.resourceId);
    if (clock !== undefined && resource.revision <= clock.revision) {
      if (resource.revision === clock.revision && resource.contentHash !== clock.remoteContentHash) {
        throw new Error(`Content Vault revision ${resource.kind}/${resource.resourceId}@${resource.revision} changed hash`);
      }
      if (cursor !== undefined) input.store.advanceCursor(accountId, cursor);
      return;
    }
    const localBefore = await contributor.read(resource.resourceId);
    if (clock === undefined && localBefore !== undefined && !resource.deleted) {
      input.store.recordConflict({
        accountId,
        kind: resource.kind,
        resourceId: resource.resourceId,
        reason: "initial_divergence",
        current: resource,
        detectedAt: now(),
      }, cursor);
      return;
    }
    if (clock !== undefined && localFingerprintOrDeleted(localBefore) !== clock.localFingerprint) {
      input.store.recordConflict({
        accountId,
        kind: resource.kind,
        resourceId: resource.resourceId,
        reason: "remote_changed_while_local_pending",
        current: resource,
        detectedAt: now(),
      }, cursor);
      return;
    }
    try {
      await contributor.apply(resource);
    } catch (error) {
      input.store.recordConflict({
        accountId,
        kind: resource.kind,
        resourceId: resource.resourceId,
        reason: "remote_apply_failed",
        current: resource,
        message: error instanceof Error ? error.message : "Remote content could not be applied",
        detectedAt: now(),
      }, cursor);
      return;
    }
    const localAfter = await contributor.read(resource.resourceId);
    const localAppliedFingerprint = localFingerprintOrDeleted(localAfter);
    if (cursor === undefined) input.store.saveClock(accountId, resource, localAppliedFingerprint);
    else input.store.recordAppliedChange(accountId, cursor, resource, localAppliedFingerprint);
  }

  async function retryRemoteApplyConflicts(accountId: string): Promise<void> {
    for (const conflict of input.store.listConflicts(accountId)) {
      if (conflict.reason !== "remote_apply_failed" || conflict.current === undefined) continue;
      const contributor = contributors.get(conflict.kind);
      if (contributor === undefined) continue;
      try {
        await contributor.apply(conflict.current);
        const local = await contributor.read(conflict.resourceId);
        input.store.resolveConflict(accountId, conflict.current, localFingerprintOrDeleted(local));
      } catch (error) {
        input.store.recordConflict({
          ...conflict,
          message: error instanceof Error ? error.message : "Remote content could not be applied",
          detectedAt: now(),
        });
      }
    }
  }

  return {
    commands: {
      start(): void {
        if (released) throw new Error("Content Vault Sync feature is released");
        if (active) return;
        active = true;
        wake();
      },
      stop,
      async clearAccount(accountId: string): Promise<void> {
        if (released) throw new Error("Content Vault Sync feature is released");
        await stop();
        input.store.clearAccount(accountId);
        status = { state: "stopped", cursor: 0, pendingMutations: 0, conflicts: 0 };
      },
      synchronize,
    },
    queries: {
      status: (): ContentVaultSyncStatus => structuredClone(status),
      conflicts: (accountId: string) => input.store.listConflicts(accountId),
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      await queue;
      status = { ...status, state: "stopped" };
    },
  };
}

export type ContentVaultSyncFeature = ReturnType<typeof createContentVaultSyncFeature>;

function upsertMutation(resource: ContentVaultLocalResource, baseRevision: number, mutationId: string): ContentVaultMutation {
  return {
    protocolVersion: CONTENT_VAULT_PROTOCOL_VERSION,
    mutationId,
    kind: resource.kind,
    resourceId: resource.resourceId,
    operation: "upsert",
    baseRevision,
    payloadSchemaVersion: resource.payloadSchemaVersion,
    payload: resource.payload,
    contentHash: hashPayload(resource.payload),
  };
}

function hashPayload(payload: Readonly<Record<string, unknown>>): string {
  return `sha256:${createHash("sha256").update(canonicalContentVaultJson(payload), "utf8").digest("hex")}`;
}

function localFingerprint(resource: ContentVaultLocalResource): string {
  return hashPayload(resource.payload);
}

function localFingerprintOrDeleted(resource: ContentVaultLocalResource | undefined): string {
  return resource === undefined ? DELETED_LOCAL_FINGERPRINT : localFingerprint(resource);
}

function mutationLocalFingerprint(mutation: ContentVaultMutation): string {
  return mutation.operation === "delete" ? DELETED_LOCAL_FINGERPRINT : mutation.contentHash;
}

function equivalentConflict(mutation: ContentVaultMutation, current: ContentVaultResource | undefined): boolean {
  if (current === undefined) return false;
  return mutation.operation === "delete"
    ? current.deleted
    : !current.deleted && current.contentHash === mutation.contentHash;
}
