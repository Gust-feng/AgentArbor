import {
  SPACE_TREE_SCHEMA_VERSION,
  SpaceFeatureError,
  type Space,
  type SpaceEvent,
  type SpaceFeature,
  type SpaceMovableTarget,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceTarget,
  type SpaceTreeSnapshot,
} from "./contracts.js";
import { validateSpaceReference } from "./space-validation.js";
import {
  createSpaceReferenceDeletionLifecycle,
  type SpaceReferenceDeletionDiagnostic,
  type SpaceReferenceDeletionFilePort,
  type SpaceReferenceDeletionLeasePort,
} from "./space-reference-deletion.js";
import type { SpaceReferenceDeletionJournalStore } from "./file-system-reference-deletion-journal.js";

export type CreateSpaceFeatureInput = {
  readonly repository: SpaceRepository;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly workspaceMountIdentity?: (workspacePath: string) => Promise<string>;
  readonly referenceDeletion?: {
    readonly journal: SpaceReferenceDeletionJournalStore;
    readonly files: SpaceReferenceDeletionFilePort;
    readonly leases: SpaceReferenceDeletionLeasePort;
    readonly createDeletionId?: () => string;
    readonly onDiagnostic?: (diagnostic: SpaceReferenceDeletionDiagnostic) => void;
  };
};

export function createSpaceFeature(input: CreateSpaceFeatureInput): SpaceFeature {
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.idFactory ?? (() => crypto.randomUUID());
  const listeners = new Set<(event: SpaceEvent) => void>();
  let released = false;
  let runtimeFailure: unknown;
  let releasePromise: Promise<void> | undefined;
  let startupSucceeded = false;
  let tail = Promise.resolve();
  let startup: Promise<void> | undefined;
  const serialize = <T>(operation: () => Promise<T>, waitForStartup = true): Promise<T> => {
    const guarded = async () => {
      if (waitForStartup) {
        await startup;
        if (runtimeFailure !== undefined) throw runtimeFailure;
      }
      return operation();
    };
    const result = tail.then(guarded, guarded);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const assertUsable = (action: string) => {
    if (released) throw new SpaceFeatureError("space_feature_released", `Space feature is released and cannot ${action}`);
  };
  const publish = (event: SpaceEvent) => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* Observers cannot roll back an already committed Space command. */ }
    }
  };
  const deletionLifecycle = input.referenceDeletion === undefined
    ? undefined
    : createSpaceReferenceDeletionLifecycle({
        repository: input.repository,
        ...input.referenceDeletion,
      });
  const ready = deletionLifecycle === undefined
    ? Promise.resolve()
    : serialize(() => deletionLifecycle.recover(), false);
  void ready.then(() => { startupSucceeded = true; }, () => undefined);
  startup = ready;
  const waitUntilUsable = async (): Promise<void> => {
    await ready;
    if (runtimeFailure !== undefined) throw runtimeFailure;
  };
  const removeReferenceWithPolicy = (
    itemId: string,
    runOwnershipLifecycle: boolean,
  ): Promise<void> => {
    assertUsable(runOwnershipLifecycle ? "remove a reference" : "unlink a reference");
    return serialize(async () => {
      const snapshot = await input.repository.read();
      const item = requireReference(snapshot, itemId);
      const at = now();
      const subtree = referenceSubtreeIds(snapshot, itemId);
      const removedItems = snapshot.referenceItems.filter((entry) => subtree.has(entry.id));
      const nextSnapshot = {
        ...snapshot,
        referenceItems: snapshot.referenceItems.filter((entry) => !subtree.has(entry.id)),
        spaces: touchSpaces(snapshot.spaces, [item.spaceId], at),
      };
      if (runOwnershipLifecycle && deletionLifecycle !== undefined) {
        try {
          await deletionLifecycle.remove({
            rootReferenceId: itemId,
            removedReferences: removedItems,
            nextSnapshot,
            createdAt: at,
          });
        } catch (error) {
          if (error instanceof SpaceFeatureError && error.code === "space_deletion_recovery_failed") {
            runtimeFailure ??= error;
          }
          throw error;
        }
      } else {
        await input.repository.write(nextSnapshot);
      }
      publish({
        type: "space.reference_removed",
        itemId,
        removedItemIds: removedItems.map((entry) => entry.id),
        spaceId: item.spaceId,
      });
    });
  };
  const newId = (snapshot: SpaceTreeSnapshot): string => {
    const id = createId().trim();
    if (id.length === 0) throw new SpaceFeatureError("space_invalid_input", "Space ids must not be empty");
    const taken = new Set([...snapshot.spaces.map((entry) => entry.id), ...snapshot.referenceItems.map((entry) => entry.id)]);
    if (taken.has(id)) throw new SpaceFeatureError("space_id_collision", `Space id ${id} already exists`);
    return id;
  };

  return {
    ready: waitUntilUsable,
    commands: {
      createSpace({ id, title }) {
        assertUsable("create a Space");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const at = now();
          const space: Space = {
            id: id === undefined ? newId(snapshot) : idFor(id, snapshot),
            title: titleFor(title),
            createdAt: at,
            updatedAt: at,
          };
          await input.repository.write({ ...snapshot, spaces: [...snapshot.spaces, space] });
          publish({ type: "space.created", space });
          return space;
        });
      },
      addReference({ id, spaceId, title, parentId, reference }) {
        assertUsable("add a reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, spaceId);
          if (parentId !== undefined) requireParent(snapshot, spaceId, parentId);
          await assertWorkspaceMountUnique(snapshot, reference, input.workspaceMountIdentity);
          assertConversationOwnerUnique(snapshot, reference);
          const at = now();
          const item: SpaceReferenceItem = {
            id: id === undefined ? newId(snapshot) : idFor(id, snapshot), spaceId, title: titleFor(title), ...(parentId === undefined ? {} : { parentId }), reference: validateSpaceReference(reference), createdAt: at, updatedAt: at,
          };
          await input.repository.write({
            ...snapshot,
            referenceItems: [item, ...snapshot.referenceItems],
            spaces: touchSpaces(snapshot.spaces, [spaceId], at),
          });
          publish({ type: "space.reference_added", item });
          return item;
        });
      },
      rename({ target, title }) {
        assertUsable("rename a Space entry");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const at = now();
          const updated = renameSnapshot(snapshot, target, titleFor(title), at);
          await input.repository.write(updated);
          const spaceId = target.kind === "space" ? target.id : requireReference(snapshot, target.id).spaceId;
          publish({ type: "space.renamed", target, spaceId });
          return target;
        });
      },
      move({ target, destinationSpaceId }) {
        assertUsable("move a Space reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, destinationSpaceId);
          const item = requireReference(snapshot, target.id);
          const at = now();
          const subtree = referenceSubtreeIds(snapshot, item.id);
          const moved = snapshot.referenceItems.filter((entry) => subtree.has(entry.id)).map((entry) => ({
            ...entry,
            spaceId: destinationSpaceId,
            ...(entry.id === item.id ? { parentId: undefined } : {}),
            updatedAt: at,
          }));
          await input.repository.write({
            ...snapshot,
            referenceItems: [...moved, ...snapshot.referenceItems.filter((entry) => !subtree.has(entry.id))],
            spaces: touchSpaces(snapshot.spaces, [item.spaceId, destinationSpaceId], at),
          });
          publish({ type: "space.moved", target, sourceSpaceId: item.spaceId, destinationSpaceId });
          return target;
        });
      },
      unlinkReference: (itemId) => removeReferenceWithPolicy(itemId, false),
      removeReference: (itemId) => removeReferenceWithPolicy(itemId, true),
    },
    queries: {
      async list() {
        assertUsable("list Spaces");
        await waitUntilUsable();
        const snapshot = await input.repository.read();
        return snapshot.spaces.map((space) => ({
          ...space,
          folderCount: snapshot.referenceItems.filter((item) => item.spaceId === space.id && (item.reference.kind === "workspace_folder" || item.reference.kind === "managed_folder" || item.reference.kind === "asset_folder")).length,
          referenceItemCount: snapshot.referenceItems.filter((item) => item.spaceId === space.id).length,
        }));
      },
      async getTree(spaceId) {
        assertUsable("read a Space");
        await waitUntilUsable();
        const snapshot = await input.repository.read();
        const space = snapshot.spaces.find((entry) => entry.id === spaceId);
        if (space === undefined) return undefined;
        const entries = snapshot.referenceItems.filter((item) => item.spaceId === spaceId)
          .map((item) => ({ kind: "reference" as const, item }));
        return { space, entries };
      },
      async getReference(itemId) {
        assertUsable("read a reference");
        await waitUntilUsable();
        return (await input.repository.read()).referenceItems.find((entry) => entry.id === itemId);
      },
      async findConversationOwner(conversationId) {
        assertUsable("resolve a conversation owner");
        await waitUntilUsable();
        const matches = (await input.repository.read()).referenceItems.filter((entry) =>
          entry.reference.kind === "conversation" && entry.reference.conversationId === conversationId
        );
        if (matches.length > 1) {
          throw new SpaceFeatureError(
            "space_conversation_ownership_conflict",
            `Conversation ${conversationId} is linked to multiple Spaces`,
          );
        }
        const item = matches[0];
        return item === undefined ? undefined : { spaceId: item.spaceId, referenceItemId: item.id };
      },
      async hasWorkspaceMountConflict(itemId) {
        assertUsable("check a workspace mount");
        await waitUntilUsable();
        const snapshot = await input.repository.read();
        const item = requireReference(snapshot, itemId);
        if (item.reference.kind !== "workspace_folder") return false;
        const identity = await workspaceMountIdentity(item.reference.path, input.workspaceMountIdentity);
        for (const candidate of snapshot.referenceItems) {
          if (candidate.id === item.id || candidate.reference.kind !== "workspace_folder") continue;
          if (await workspaceMountIdentity(candidate.reference.path, input.workspaceMountIdentity) === identity) return true;
        }
        return false;
      },
    },
    events: {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    async release() {
      if (releasePromise !== undefined) return await releasePromise;
      released = true;
      const attempt = (async () => {
        await ready.catch(() => undefined);
        await tail;
        listeners.clear();
        if (startupSucceeded) await deletionLifecycle?.recover();
      })();
      releasePromise = attempt;
      try {
        await attempt;
      } catch (error) {
        releasePromise = undefined;
        throw error;
      }
    },
  };
}

function titleFor(value: string): string {
  const title = value.trim();
  if (title.length === 0 || title.length > 160) throw new SpaceFeatureError("space_invalid_input", "Space titles must contain 1 to 160 characters");
  return title;
}
function idFor(value: string, snapshot: SpaceTreeSnapshot): string {
  const id = value.trim();
  if (id.length === 0) throw new SpaceFeatureError("space_invalid_input", "Space ids must not be empty");
  const taken = new Set([...snapshot.spaces.map((entry) => entry.id), ...snapshot.referenceItems.map((entry) => entry.id)]);
  if (taken.has(id)) throw new SpaceFeatureError("space_id_collision", `Space id ${id} already exists`);
  return id;
}
function requireSpace(snapshot: SpaceTreeSnapshot, id: string): Space {
  const space = snapshot.spaces.find((entry) => entry.id === id);
  if (space === undefined) throw new SpaceFeatureError("space_not_found", `Space ${id} was not found`);
  return space;
}
function requireReference(snapshot: SpaceTreeSnapshot, id: string): SpaceReferenceItem {
  const item = snapshot.referenceItems.find((entry) => entry.id === id);
  if (item === undefined) throw new SpaceFeatureError("space_reference_not_found", `Space reference ${id} was not found`);
  return item;
}
function requireParent(snapshot: SpaceTreeSnapshot, spaceId: string, id: string): SpaceReferenceItem {
  const parent = requireReference(snapshot, id);
  if (parent.spaceId !== spaceId) throw new SpaceFeatureError("space_invalid_input", "Space reference parent must belong to the same Space");
  if (parent.reference.kind !== "asset_folder") {
    throw new SpaceFeatureError("space_invalid_input", "Only an internal asset folder can contain Space entries");
  }
  return parent;
}
function referenceSubtreeIds(snapshot: SpaceTreeSnapshot, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of snapshot.referenceItems) {
      if (item.parentId !== undefined && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return ids;
}
function renameSnapshot(snapshot: SpaceTreeSnapshot, target: SpaceTarget, title: string, at: string): SpaceTreeSnapshot {
  if (target.kind === "space") {
    requireSpace(snapshot, target.id);
    return { ...snapshot, spaces: snapshot.spaces.map((space) => space.id === target.id ? { ...space, title, updatedAt: at } : space) };
  }
  const item = requireReference(snapshot, target.id);
  return {
    ...snapshot,
    referenceItems: snapshot.referenceItems.map((entry) => entry.id === item.id ? { ...entry, title, updatedAt: at } : entry),
    spaces: touchSpaces(snapshot.spaces, [item.spaceId], at),
  };
}
function touchSpaces(spaces: readonly Space[], ids: readonly string[], at: string): readonly Space[] {
  const targets = new Set(ids);
  return spaces.map((space) => targets.has(space.id) ? { ...space, updatedAt: at } : space);
}
async function assertWorkspaceMountUnique(snapshot: SpaceTreeSnapshot, reference: SpaceReferenceItem["reference"], identify: CreateSpaceFeatureInput["workspaceMountIdentity"]): Promise<void> {
  if (reference.kind !== "workspace_folder") return;
  const identity = await workspaceMountIdentity(reference.path, identify);
  for (const item of snapshot.referenceItems) {
    if (item.reference.kind === "workspace_folder" && await workspaceMountIdentity(item.reference.path, identify) === identity) {
      throw new SpaceFeatureError("space_workspace_mount_conflict", "This workspace folder is already linked to another Space");
    }
  }
}

function assertConversationOwnerUnique(
  snapshot: SpaceTreeSnapshot,
  reference: SpaceReferenceItem["reference"],
): void {
  if (reference.kind !== "conversation") return;
  const existing = snapshot.referenceItems.find((item) =>
    item.reference.kind === "conversation" && item.reference.conversationId === reference.conversationId
  );
  if (existing !== undefined) {
    throw new SpaceFeatureError(
      "space_conversation_ownership_conflict",
      `Conversation ${reference.conversationId} already belongs to Space ${existing.spaceId}`,
    );
  }
}
async function workspaceMountIdentity(value: string, identify: CreateSpaceFeatureInput["workspaceMountIdentity"]): Promise<string> {
  if (identify !== undefined) return await identify(value);
  return value.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase("en-US");
}

export function emptySpaceTreeSnapshot(): SpaceTreeSnapshot {
  return { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
}
