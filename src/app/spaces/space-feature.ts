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

export type CreateSpaceFeatureInput = {
  readonly repository: SpaceRepository;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly workspaceMountIdentity?: (workspacePath: string) => Promise<string>;
};

export function createSpaceFeature(input: CreateSpaceFeatureInput): SpaceFeature {
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.idFactory ?? (() => crypto.randomUUID());
  const listeners = new Set<(event: SpaceEvent) => void>();
  let released = false;
  let tail = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const assertUsable = (action: string) => {
    if (released) throw new SpaceFeatureError("space_feature_released", `Space feature is released and cannot ${action}`);
  };
  const publish = (event: SpaceEvent) => listeners.forEach((listener) => listener(event));
  const newId = (snapshot: SpaceTreeSnapshot): string => {
    const id = createId().trim();
    if (id.length === 0) throw new SpaceFeatureError("space_invalid_input", "Space ids must not be empty");
    const taken = new Set([...snapshot.spaces.map((entry) => entry.id), ...snapshot.referenceItems.map((entry) => entry.id)]);
    if (taken.has(id)) throw new SpaceFeatureError("space_id_collision", `Space id ${id} already exists`);
    return id;
  };

  return {
    commands: {
      createSpace({ id, title, demoDataset }) {
        assertUsable("create a Space");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const at = now();
          const space: Space = {
            id: id === undefined ? newId(snapshot) : idFor(id, snapshot),
            title: titleFor(title),
            ...(demoDataset === undefined ? {} : { demoDataset }),
            createdAt: at,
            updatedAt: at,
          };
          await input.repository.write({ ...snapshot, spaces: [...snapshot.spaces, space] });
          publish({ type: "space.created", space });
          return space;
        });
      },
      addReference({ id, spaceId, title, reference }) {
        assertUsable("add a reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          requireSpace(snapshot, spaceId);
          await assertWorkspaceMountUnique(snapshot, reference, input.workspaceMountIdentity);
          const at = now();
          const item: SpaceReferenceItem = {
            id: id === undefined ? newId(snapshot) : idFor(id, snapshot), spaceId, title: titleFor(title), reference: validateSpaceReference(reference), createdAt: at, updatedAt: at,
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
          publish({ type: "space.renamed", target });
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
          const moved = { ...item, spaceId: destinationSpaceId, updatedAt: at };
          await input.repository.write({
            ...snapshot,
            referenceItems: [moved, ...snapshot.referenceItems.filter((entry) => entry.id !== item.id)],
            spaces: touchSpaces(snapshot.spaces, [item.spaceId, destinationSpaceId], at),
          });
          publish({ type: "space.moved", target, destinationSpaceId });
          return target;
        });
      },
      removeReference(itemId) {
        assertUsable("remove a reference");
        return serialize(async () => {
          const snapshot = await input.repository.read();
          const item = requireReference(snapshot, itemId);
          const at = now();
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
      async list() {
        assertUsable("list Spaces");
        const snapshot = await input.repository.read();
        return snapshot.spaces.map((space) => ({
          ...space,
          folderCount: snapshot.referenceItems.filter((item) => item.spaceId === space.id && (item.reference.kind === "workspace_folder" || item.reference.kind === "managed_folder")).length,
          referenceItemCount: snapshot.referenceItems.filter((item) => item.spaceId === space.id).length,
        }));
      },
      async getTree(spaceId) {
        assertUsable("read a Space");
        const snapshot = await input.repository.read();
        const space = snapshot.spaces.find((entry) => entry.id === spaceId);
        if (space === undefined) return undefined;
        const entries = snapshot.referenceItems.filter((item) => item.spaceId === spaceId)
          .map((item) => ({ kind: "reference" as const, item }));
        return { space, entries };
      },
      async getReference(itemId) {
        assertUsable("read a reference");
        return (await input.repository.read()).referenceItems.find((entry) => entry.id === itemId);
      },
      async hasWorkspaceMountConflict(itemId) {
        assertUsable("check a workspace mount");
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
    async release() { released = true; await tail; listeners.clear(); },
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
async function workspaceMountIdentity(value: string, identify: CreateSpaceFeatureInput["workspaceMountIdentity"]): Promise<string> {
  if (identify !== undefined) return await identify(value);
  return value.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase("en-US");
}

export function emptySpaceTreeSnapshot(): SpaceTreeSnapshot {
  return { schemaVersion: SPACE_TREE_SCHEMA_VERSION, spaces: [], referenceItems: [] };
}
