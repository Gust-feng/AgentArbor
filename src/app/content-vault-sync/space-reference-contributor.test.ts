import assert from "node:assert/strict";
import test from "node:test";

import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import type { SpaceReference, SpaceReferenceItem } from "../spaces/index.js";
import {
  createSpaceReferenceContentVaultContributor,
  type SpaceReferenceSyncPort,
} from "./space-reference-contributor.js";

test("Space reference contributor projects only path-independent references", async () => {
  const fixture = createFixture([
    item("folder", { kind: "asset_folder" }),
    item("asset", { kind: "workbench_asset", assetId: "asset-1" }),
    item("managed", { kind: "managed_folder", path: "managed" }),
    item("local", { kind: "local_file", path: "C:/private.txt" }),
  ]);
  const contributor = createSpaceReferenceContentVaultContributor(fixture.port);

  const projected = await contributor.list();
  assert.deepEqual(projected.map((entry) => entry.resourceId), ["folder", "asset"]);
  assert.equal(JSON.stringify(projected).includes("C:/private.txt"), false);
  assert.equal(JSON.stringify(projected).includes("managed"), false);
});

test("Space reference contributor applies create, rename, move and unlink through the narrow port", async () => {
  const fixture = createFixture();
  const contributor = createSpaceReferenceContentVaultContributor(fixture.port);

  await contributor.apply(resource("asset", {
    spaceId: "space-1",
    title: "Draft",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
    createdAt: NOW,
    updatedAt: NOW,
  }));
  await contributor.apply(resource("asset", {
    spaceId: "space-2",
    title: "Final",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
    createdAt: NOW,
    updatedAt: LATER,
  }, 2));
  await contributor.apply(tombstone("asset"));

  assert.deepEqual(fixture.operations, [
    "create:asset:space-1:Draft:workbench_asset",
    "move:asset:space-2",
    "rename:asset:Final",
    "unlink:asset",
  ]);
  assert.equal(fixture.items.has("asset"), false);
});

test("Space reference contributor rejects unsafe structural replacement without mutating the Space", async () => {
  const fixture = createFixture([
    item("nested", { kind: "workbench_asset", assetId: "asset-1" }, { parentId: "folder" }),
    item("local", { kind: "local_file", path: "C:/private.txt" }),
  ]);
  const contributor = createSpaceReferenceContentVaultContributor(fixture.port);

  await assert.rejects(contributor.apply(resource("nested", {
    spaceId: "space-1",
    title: "Nested",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
    createdAt: NOW,
    updatedAt: LATER,
  })), /cannot change parent/u);
  await assert.rejects(contributor.apply(resource("nested", {
    spaceId: "space-1",
    title: "Nested",
    parentId: "folder",
    reference: { kind: "workbench_asset", assetId: "asset-2" },
    createdAt: NOW,
    updatedAt: LATER,
  })), /cannot replace its referenced target/u);
  await assert.rejects(contributor.apply(resource("nested", {
    spaceId: "space-2",
    title: "Nested",
    parentId: "folder",
    reference: { kind: "workbench_asset", assetId: "asset-1" },
    createdAt: NOW,
    updatedAt: LATER,
  })), /cannot move between Spaces/u);
  await assert.rejects(contributor.apply(resource("managed", {
    spaceId: "space-1",
    title: "Managed",
    reference: { kind: "managed_root", managedRootId: "managed" },
    createdAt: NOW,
    updatedAt: LATER,
  })), /managed_root contributor/u);
  await assert.rejects(contributor.apply(tombstone("local")), /local-only source/u);

  assert.deepEqual(fixture.operations, []);
});

const NOW = "2026-08-04T00:00:00.000Z";
const LATER = "2026-08-04T00:01:00.000Z";

function item(
  id: string,
  reference: SpaceReference,
  options: { readonly parentId?: string } = {},
): SpaceReferenceItem {
  return {
    id,
    spaceId: "space-1",
    title: id,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    reference,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createFixture(initial: readonly SpaceReferenceItem[] = []) {
  const items = new Map(initial.map((entry) => [entry.id, entry]));
  const operations: string[] = [];
  const port: SpaceReferenceSyncPort = {
    list: async () => [...items.values()],
    read: async (id) => items.get(id),
    async create(input) {
      operations.push(`create:${input.id}:${input.spaceId}:${input.title}:${input.reference.kind}`);
      items.set(input.id, {
        ...input,
        createdAt: LATER,
        updatedAt: LATER,
      });
    },
    async rename({ id, title }) {
      operations.push(`rename:${id}:${title}`);
      items.set(id, { ...items.get(id)!, title, updatedAt: LATER });
    },
    async move({ id, spaceId }) {
      operations.push(`move:${id}:${spaceId}`);
      const current = items.get(id)!;
      items.set(id, { ...current, spaceId, parentId: undefined, updatedAt: LATER });
    },
    async unlink(id) {
      operations.push(`unlink:${id}`);
      items.delete(id);
    },
    subscribe: () => () => undefined,
  };
  return { items, operations, port };
}

function resource(
  resourceId: string,
  payload: Readonly<Record<string, unknown>>,
  revision = 1,
): ContentVaultResource {
  return {
    kind: "space_reference",
    resourceId,
    revision,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    updatedAt: LATER,
    updatedByDeviceId: "mobile-1",
  };
}

function tombstone(resourceId: string): ContentVaultResource {
  return {
    kind: "space_reference",
    resourceId,
    revision: 2,
    deleted: true,
    payloadSchemaVersion: 1,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
    updatedAt: LATER,
    updatedByDeviceId: "mobile-1",
  };
}
