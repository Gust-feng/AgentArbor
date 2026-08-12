import { parseContentVaultPayload, type ContentVaultResource } from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export type SpaceSyncRecord = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Host-facing port implemented from the Space feature's public facade. */
export type SpaceSyncPort = {
  list(): Promise<readonly SpaceSyncRecord[]>;
  read(id: string): Promise<SpaceSyncRecord | undefined>;
  create(input: { readonly id: string; readonly title: string }): Promise<void>;
  rename(input: { readonly id: string; readonly title: string }): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export function createSpaceContentVaultContributor(port: SpaceSyncPort): ContentVaultSyncContributor {
  return {
    kind: "space",
    async list() {
      return (await port.list()).map(projectSpace);
    },
    async read(resourceId) {
      const space = await port.read(resourceId);
      return space === undefined ? undefined : projectSpace(space);
    },
    async apply(resource) {
      const current = await port.read(resource.resourceId);
      if (resource.deleted) {
        if (current !== undefined) throw new Error("Space deletion is not available through the current Space command facade");
        return;
      }
      const payload = spacePayload(resource);
      if (current === undefined) {
        await port.create({ id: resource.resourceId, title: payload.title });
        return;
      }
      if (current.title !== payload.title) await port.rename({ id: current.id, title: payload.title });
    },
    subscribe: port.subscribe,
  };
}

function projectSpace(space: SpaceSyncRecord): ContentVaultLocalResource {
  return {
    kind: "space",
    resourceId: space.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("space", {
      title: space.title,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    }),
  };
}

function spacePayload(resource: ContentVaultResource): { readonly title: string } {
  const payload = parseContentVaultPayload("space", resource.payload);
  return { title: String(payload.title) };
}
