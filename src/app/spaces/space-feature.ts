import { nowIso } from "../../kernel/id.js";
import {
  SpaceFeatureError,
  type Space,
  type SpaceEvent,
  type SpaceFeature,
  type SpaceFolder,
  type SpaceMovableTarget,
  type SpaceReferenceItem,
  type SpaceRepository,
  type SpaceSummary,
  type SpaceTarget,
  type SpaceTree,
  type SpaceTreeEntry,
  type SpaceTreeSnapshot,
} from "./contracts.js";
import { validateSpaceReference } from "./space-validation.js";

export type CreateSpaceFeatureInput = {
  readonly repository: SpaceRepository;
  readonly now?: () => string;
  readonly idFactory?: () => string;
};

/** Owns SpaceTree commands, durable snapshots and read-model projection. */
export function createSpaceFeature(input: CreateSpaceFeatureInput): SpaceFeature {
  const now = input.now ?? nowIso;
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const listeners = new Set<(event: SpaceEvent) => void>();
  const pending = new Set<Promise<unknown>>();
  let commandTail: Promise<void> = Promise.resolve();
  let released = false;

  function assertUsable(operation: string): void {
    if (released) {
      throw new SpaceFeatureError("space_feature_released", `Space feature is released and cannot ${operation}`);
    }
  }

  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    void operation.then(() => undefined, () => undefined).finally(() => pending.delete(operation));
    return operation;
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = commandTail.then(operation, operation);
    commandTail = result.then(() => undefined, () => undefined);
    return track(result);
  }

  function publish(event: SpaceEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A projection subscriber may fail, but it cannot undo a committed SpaceTree fact.
      }
    }
  }

  function newId(snapshot: SpaceTreeSnapshot): string {
    const id = idFactory().trim();
    if (id.length === 0) throw new SpaceFeatureError("space_invalid_input", "Space ids must not be empty");
    const taken = new Set([...snapshot.spaces, ...snapshot.folders, ...snapshot.referenceItems].map((entry) => entry.id));
    if (taken.has(id)) throw new SpaceFeatureError("space_id_collision", `Space id ${id} already exists`);
    return id;
  }

  return {
    commands: {
      createSpace({ title }) {
        assertUsable("create a space");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const at = now();
          const space: Space = { id: newId(snapshot), title: titleFor(title), createdAt: at, updatedAt: at };
          await input.repository.write({ ...snapshot, spaces: [...snapshot.spaces, space] });
          publish({ type: "space.created", space });
          return space;
        });
      },
      createFolder({ spaceId, parentFolderId, title }) {
        assertUsable("create a folder");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, spaceId);
          requireParent(snapshot, spaceId, parentFolderId);
          const at = now();
          const folder: SpaceFolder = {
            id: newId(snapshot), spaceId, ...parentFolder(parentFolderId), title: titleFor(title), createdAt: at, updatedAt: at,
          };
          await input.repository.write({ ...snapshot, folders: [...snapshot.folders, folder], spaces: touchSpaces(snapshot.spaces, [spaceId], at) });
          publish({ type: "space.folder_created", folder });
          return folder;
        });
      },
      addReference({ spaceId, parentFolderId, title, reference }) {
        assertUsable("add a reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, spaceId);
          requireParent(snapshot, spaceId, parentFolderId);
          const at = now();
          const item: SpaceReferenceItem = {
            id: newId(snapshot), spaceId, ...parentFolder(parentFolderId), title: titleFor(title), reference: validateSpaceReference(reference), createdAt: at, updatedAt: at,
          };
          await input.repository.write({ ...snapshot, referenceItems: [...snapshot.referenceItems, item], spaces: touchSpaces(snapshot.spaces, [spaceId], at) });
          publish({ type: "space.reference_added", item });
          return item;
        });
      },
      rename({ target, title }) {
        assertUsable("rename a SpaceTree entry");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const at = now();
          const normalizedTitle = titleFor(title);
          const updated = renameSnapshot(snapshot, target, normalizedTitle, at);
          await input.repository.write(updated);
          publish({ type: "space.renamed", target });
          return target;
        });
      },
      move({ target, destinationSpaceId, destinationFolderId }) {
        assertUsable("move a SpaceTree entry");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, destinationSpaceId);
          requireParent(snapshot, destinationSpaceId, destinationFolderId);
          const at = now();
          const updated = moveSnapshot(snapshot, target, destinationSpaceId, destinationFolderId, at);
          await input.repository.write(updated);
          publish({ type: "space.moved", target, destinationSpaceId, destinationFolderId });
          return target;
        });
      },
      removeReference(itemId) {
        assertUsable("remove a reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const item = snapshot.referenceItems.find((entry) => entry.id === itemId);
          if (item === undefined) throw new SpaceFeatureError("space_reference_not_found", `Space reference ${itemId} was not found`);
          const at = now();
          // Do not call a workspace/artifact/conversation API here. This command only deletes this metadata edge.
          await input.repository.write({
            ...snapshot,
            referenceItems: snapshot.referenceItems.filter((entry) => entry.id !== itemId),
            spaces: touchSpaces(snapshot.spaces, [item.spaceId], at),
          });
          publish({ type: "space.reference_removed", itemId });
        });
      },
    },
    queries: {
      list() {
        assertUsable("list spaces");
        return track(input.repository.read().then((snapshot) => summaries(snapshot)));
      },
      getTree(spaceId) {
        assertUsable("read a space");
        return track(input.repository.read().then((snapshot) => treeFor(snapshot, spaceId)));
      },
    },
    events: {
      subscribe(listener) {
        assertUsable("subscribe to SpaceTree events");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    async release() {
      if (released) return;
      released = true;
      listeners.clear();
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

function titleFor(value: string): string {
  const title = value.trim();
  if (title.length === 0) throw new SpaceFeatureError("space_invalid_input", "SpaceTree titles must not be empty");
  if (title.length > 160) throw new SpaceFeatureError("space_invalid_input", "SpaceTree titles must be at most 160 characters");
  return title;
}

function requireSpace(snapshot: SpaceTreeSnapshot, spaceId: string): Space {
  const space = snapshot.spaces.find((entry) => entry.id === spaceId);
  if (space === undefined) throw new SpaceFeatureError("space_not_found", `Space ${spaceId} was not found`);
  return space;
}

function requireParent(snapshot: SpaceTreeSnapshot, spaceId: string, parentFolderId: string | undefined): void {
  if (parentFolderId === undefined) return;
  const parent = snapshot.folders.find((entry) => entry.id === parentFolderId);
  if (parent === undefined || parent.spaceId !== spaceId) {
    throw new SpaceFeatureError("space_parent_not_found", `Folder ${parentFolderId} is not in Space ${spaceId}`);
  }
}

function touchSpaces(spaces: readonly Space[], ids: readonly string[], at: string): readonly Space[] {
  const affected = new Set(ids);
  return spaces.map((space) => affected.has(space.id) ? { ...space, updatedAt: at } : space);
}

function parentFolder(parentFolderId: string | undefined): Pick<SpaceFolder, "parentFolderId"> | Record<never, never> {
  return parentFolderId === undefined ? {} : { parentFolderId };
}

function renameSnapshot(snapshot: SpaceTreeSnapshot, target: SpaceTarget, title: string, at: string): SpaceTreeSnapshot {
  if (target.kind === "space") {
    requireSpace(snapshot, target.id);
    return { ...snapshot, spaces: snapshot.spaces.map((space) => space.id === target.id ? { ...space, title, updatedAt: at } : space) };
  }
  if (target.kind === "folder") {
    const folder = snapshot.folders.find((entry) => entry.id === target.id);
    if (folder === undefined) throw new SpaceFeatureError("space_folder_not_found", `Space folder ${target.id} was not found`);
    return {
      ...snapshot,
      folders: snapshot.folders.map((entry) => entry.id === target.id ? { ...entry, title, updatedAt: at } : entry),
      spaces: touchSpaces(snapshot.spaces, [folder.spaceId], at),
    };
  }
  const item = snapshot.referenceItems.find((entry) => entry.id === target.id);
  if (item === undefined) throw new SpaceFeatureError("space_reference_not_found", `Space reference ${target.id} was not found`);
  return {
    ...snapshot,
    referenceItems: snapshot.referenceItems.map((entry) => entry.id === target.id ? { ...entry, title, updatedAt: at } : entry),
    spaces: touchSpaces(snapshot.spaces, [item.spaceId], at),
  };
}

function moveSnapshot(
  snapshot: SpaceTreeSnapshot,
  target: SpaceMovableTarget,
  destinationSpaceId: string,
  destinationFolderId: string | undefined,
  at: string,
): SpaceTreeSnapshot {
  if (target.kind === "reference") {
    const item = snapshot.referenceItems.find((entry) => entry.id === target.id);
    if (item === undefined) throw new SpaceFeatureError("space_reference_not_found", `Space reference ${target.id} was not found`);
    return {
      ...snapshot,
      referenceItems: snapshot.referenceItems.map((entry) => entry.id === target.id
        ? { ...entry, spaceId: destinationSpaceId, ...parentFolder(destinationFolderId), updatedAt: at }
        : entry),
      spaces: touchSpaces(snapshot.spaces, [item.spaceId, destinationSpaceId], at),
    };
  }

  const folder = snapshot.folders.find((entry) => entry.id === target.id);
  if (folder === undefined) throw new SpaceFeatureError("space_folder_not_found", `Space folder ${target.id} was not found`);
  const subtreeIds = folderSubtreeIds(snapshot.folders, folder.id);
  if (destinationFolderId !== undefined && subtreeIds.has(destinationFolderId)) {
    throw new SpaceFeatureError("space_invalid_move", "A folder cannot be moved into itself or one of its descendants");
  }
  return {
    ...snapshot,
    folders: snapshot.folders.map((entry) => {
      if (!subtreeIds.has(entry.id)) return entry;
      return {
        ...entry,
        spaceId: destinationSpaceId,
        ...(entry.id === folder.id ? { ...parentFolder(destinationFolderId), updatedAt: at } : {}),
      };
    }),
    referenceItems: snapshot.referenceItems.map((item) => subtreeIds.has(item.parentFolderId ?? "")
      ? { ...item, spaceId: destinationSpaceId }
      : item),
    spaces: touchSpaces(snapshot.spaces, [folder.spaceId, destinationSpaceId], at),
  };
}

function folderSubtreeIds(folders: readonly SpaceFolder[], rootId: string): ReadonlySet<string> {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentFolderId !== undefined && result.has(folder.parentFolderId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function summaries(snapshot: SpaceTreeSnapshot): readonly SpaceSummary[] {
  return snapshot.spaces.map((space) => ({
    ...space,
    folderCount: snapshot.folders.filter((folder) => folder.spaceId === space.id).length,
    referenceItemCount: snapshot.referenceItems.filter((item) => item.spaceId === space.id).length,
  })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function treeFor(snapshot: SpaceTreeSnapshot, spaceId: string): SpaceTree | undefined {
  const space = snapshot.spaces.find((entry) => entry.id === spaceId);
  if (space === undefined) return undefined;
  const foldersByParent = new Map<string | undefined, SpaceFolder[]>();
  for (const folder of snapshot.folders.filter((entry) => entry.spaceId === spaceId)) {
    const list = foldersByParent.get(folder.parentFolderId) ?? [];
    list.push(folder);
    foldersByParent.set(folder.parentFolderId, list);
  }
  const itemsByParent = new Map<string | undefined, SpaceReferenceItem[]>();
  for (const item of snapshot.referenceItems.filter((entry) => entry.spaceId === spaceId)) {
    const list = itemsByParent.get(item.parentFolderId) ?? [];
    list.push(item);
    itemsByParent.set(item.parentFolderId, list);
  }
  const build = (parentFolderId: string | undefined): readonly SpaceTreeEntry[] => {
    const folders = (foldersByParent.get(parentFolderId) ?? []).sort(compareTitle).map((folder): SpaceTreeEntry => ({
      kind: "folder", folder, children: build(folder.id),
    }));
    const items = (itemsByParent.get(parentFolderId) ?? []).sort(compareTitle).map((item): SpaceTreeEntry => ({ kind: "reference", item }));
    return [...folders, ...items];
  };
  return { space, entries: build(undefined) };
}

function compareTitle<T extends { readonly title: string; readonly id: string }>(left: T, right: T): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
