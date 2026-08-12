import assert from "node:assert/strict";
import test from "node:test";

import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import { createSpaceContentVaultContributor, type SpaceSyncRecord } from "./space-contributor.js";

test("Space contributor projects metadata and applies remote create and rename through commands", async () => {
  const spaces = new Map<string, SpaceSyncRecord>();
  const contributor = createSpaceContentVaultContributor({
    list: async () => [...spaces.values()],
    read: async (id) => spaces.get(id),
    async create({ id, title }) { spaces.set(id, space(id, title)); },
    async rename({ id, title }) {
      const current = spaces.get(id)!;
      spaces.set(id, { ...current, title, updatedAt: "2026-08-04T00:00:01.000Z" });
    },
    subscribe: () => () => undefined,
  });

  await contributor.apply(resource("space-1", "手机空间", 1));
  assert.equal((await contributor.read("space-1"))?.payload.title, "手机空间");

  await contributor.apply(resource("space-1", "重命名空间", 2));
  assert.equal(spaces.get("space-1")?.title, "重命名空间");
});

test("Space contributor does not silently delete an existing Space", async () => {
  const current = space("space-1", "保留空间");
  const contributor = createSpaceContentVaultContributor({
    list: async () => [current],
    read: async () => current,
    create: async () => undefined,
    rename: async () => undefined,
    subscribe: () => () => undefined,
  });
  const deleted: ContentVaultResource = {
    ...resource("space-1", "保留空间", 2),
    deleted: true,
    payload: undefined,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
  };

  await assert.rejects(contributor.apply(deleted), /Space deletion is not available/u);
});

function space(id: string, title: string): SpaceSyncRecord {
  return { id, title, createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };
}

function resource(resourceId: string, title: string, revision: number): ContentVaultResource {
  const payload = { title, createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };
  return {
    kind: "space",
    resourceId,
    revision,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: JSON.stringify(payload).length,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-1",
  };
}
