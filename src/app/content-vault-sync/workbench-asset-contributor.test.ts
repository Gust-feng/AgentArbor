import assert from "node:assert/strict";
import test from "node:test";

import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import {
  createWorkbenchAssetsFeature,
  type WorkbenchAsset,
  type WorkbenchAssetRepository,
} from "../workbench-assets/index.js";
import { createWorkbenchAssetContentVaultContributor } from "./workbench-asset-contributor.js";

test("Workbench Asset contributor synchronizes only editable text assets through the feature facade", async () => {
  const values = new Map<string, WorkbenchAsset>([
    ["markdown-one", { id: "markdown-one", kind: "markdown", title: "笔记.md", markdown: "初稿" }],
    ["image-one", { id: "image-one", kind: "image", title: "图片.png", image: { src: "local", alt: "图片" } }],
  ]);
  const repository = memoryRepository(values);
  const feature = createWorkbenchAssetsFeature(repository);
  const contributor = createWorkbenchAssetContentVaultContributor({
    list: () => feature.queries.list(),
    read: (id) => feature.queries.get(id),
    replace: (asset) => feature.commands.replace(asset),
    subscribe: (listener) => feature.events.subscribe(() => listener()),
  });

  assert.deepEqual((await contributor.list()).map((asset) => asset.resourceId), ["markdown-one"]);
  await contributor.apply(resource("code-one", {
    title: "worker.ts",
    kind: "code",
    text: "export const ready = true;",
    language: "typescript",
  }));
  assert.deepEqual(values.get("code-one"), {
    id: "code-one",
    kind: "code",
    title: "worker.ts",
    origin: "space",
    code: { language: "typescript", filename: "worker.ts", source: "export const ready = true;" },
  });

  await assert.rejects(contributor.apply(tombstone("markdown-one")), /deletion is not available/u);
  assert.equal(values.get("markdown-one")?.kind, "markdown");
  await feature.release();
});

function memoryRepository(values: Map<string, WorkbenchAsset>): WorkbenchAssetRepository {
  return {
    get: async (id) => values.get(id),
    list: async () => [...values.values()],
    async upsertMany(assets) { for (const asset of assets) values.set(asset.id, asset); },
    async removeMany(assetIds) { for (const id of assetIds) values.delete(id); },
    async updateText() { throw new Error("not used"); },
  };
}

function resource(resourceId: string, payload: Readonly<Record<string, unknown>>): ContentVaultResource {
  return {
    kind: "workbench_asset",
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-one",
  };
}

function tombstone(resourceId: string): ContentVaultResource {
  return {
    kind: "workbench_asset",
    resourceId,
    revision: 2,
    deleted: true,
    payloadSchemaVersion: 1,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-one",
  };
}
