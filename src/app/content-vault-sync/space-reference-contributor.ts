import type { SpaceReference, SpaceReferenceItem } from "../spaces/index.js";
import { parseContentVaultPayload, type ContentVaultResource } from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export type SyncedSpaceReference =
  | { readonly kind: "asset_folder" }
  | { readonly kind: "workbench_asset"; readonly assetId: string };

export type SpaceReferenceSyncRecord = SpaceReferenceItem;

export type SpaceReferenceSyncPort = {
  list(): Promise<readonly SpaceReferenceSyncRecord[]>;
  read(id: string): Promise<SpaceReferenceSyncRecord | undefined>;
  create(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly title: string;
    readonly parentId?: string;
    readonly reference: SyncedSpaceReference;
  }): Promise<void>;
  rename(input: { readonly id: string; readonly title: string }): Promise<void>;
  move(input: { readonly id: string; readonly spaceId: string }): Promise<void>;
  unlink(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
};

/**
 * Projects only path-independent Space metadata. Managed roots have their own
 * contributor; local files, workspace mounts, URLs and runtime references stay
 * on the desktop that owns them.
 */
export function createSpaceReferenceContentVaultContributor(
  port: SpaceReferenceSyncPort,
): ContentVaultSyncContributor {
  return {
    kind: "space_reference",
    async list() {
      return (await port.list()).flatMap((item) => project(item) ?? []);
    },
    async read(resourceId) {
      const item = await port.read(resourceId);
      return item === undefined ? undefined : project(item);
    },
    async apply(resource) {
      const current = await port.read(resource.resourceId);
      if (resource.deleted) {
        if (current === undefined) return;
        if (!isSyncedReference(current.reference)) {
          throw new Error(`Space reference ${resource.resourceId} is owned by a local-only source`);
        }
        await port.unlink(resource.resourceId);
        return;
      }

      const payload = spaceReferencePayload(resource);
      if (payload.reference.kind === "managed_root") {
        throw new Error("Managed Space roots are applied by the managed_root contributor");
      }
      if (current === undefined) {
        await port.create({
          id: resource.resourceId,
          spaceId: payload.spaceId,
          title: payload.title,
          ...(payload.parentId === undefined ? {} : { parentId: payload.parentId }),
          reference: payload.reference,
        });
        return;
      }
      if (!isSyncedReference(current.reference)) {
        throw new Error(`Space reference ${resource.resourceId} collides with a local-only source`);
      }
      if (!sameReference(current.reference, payload.reference)) {
        throw new Error(`Space reference ${resource.resourceId} cannot replace its referenced target`);
      }
      if (current.parentId !== payload.parentId) {
        throw new Error(`Space reference ${resource.resourceId} cannot change parent through Content Vault V1`);
      }
      if (current.spaceId !== payload.spaceId && current.parentId !== undefined) {
        throw new Error(`Nested Space reference ${resource.resourceId} cannot move between Spaces`);
      }
      if (current.spaceId !== payload.spaceId) {
        await port.move({ id: current.id, spaceId: payload.spaceId });
      }
      if (current.title !== payload.title) {
        await port.rename({ id: current.id, title: payload.title });
      }
    },
    subscribe: port.subscribe,
  };
}

function project(item: SpaceReferenceSyncRecord): ContentVaultLocalResource | undefined {
  if (!isSyncedReference(item.reference)) return undefined;
  return {
    kind: "space_reference",
    resourceId: item.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("space_reference", {
      spaceId: item.spaceId,
      title: item.title,
      ...(item.parentId === undefined ? {} : { parentId: item.parentId }),
      reference: item.reference,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  };
}

function isSyncedReference(reference: SpaceReference): reference is SyncedSpaceReference {
  return reference.kind === "asset_folder" || reference.kind === "workbench_asset";
}

function sameReference(left: SyncedSpaceReference, right: SyncedSpaceReference): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "asset_folder") return true;
  return right.kind === "workbench_asset" && left.assetId === right.assetId;
}

type SpaceReferencePayload = {
  readonly spaceId: string;
  readonly title: string;
  readonly parentId?: string;
  readonly reference: SyncedSpaceReference | { readonly kind: "managed_root"; readonly managedRootId: string };
};

function spaceReferencePayload(resource: ContentVaultResource): SpaceReferencePayload {
  if (resource.deleted || resource.payload === undefined) {
    throw new Error(`Content Vault ${resource.kind}/${resource.resourceId} has no active payload`);
  }
  return parseContentVaultPayload("space_reference", resource.payload) as SpaceReferencePayload;
}
