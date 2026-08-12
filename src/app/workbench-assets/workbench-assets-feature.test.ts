import assert from "node:assert/strict";
import test from "node:test";

import type {
  UpdateWorkbenchAssetTextInput,
  UpdateWorkbenchAssetTextResult,
  WorkbenchAsset,
  WorkbenchAssetRepository,
} from "./contracts.js";
import { createWorkbenchAssetsFeature } from "./workbench-assets-feature.js";

test("Workbench Assets publishes committed replacements and successful text updates", async () => {
  const repository = new FakeWorkbenchAssetRepository();
  const feature = createWorkbenchAssetsFeature(repository);
  const events: string[] = [];
  feature.events.subscribe((event) => events.push(event.assetId));

  await feature.commands.replace(markdown("asset-one", "initial"));
  repository.nextUpdate = {
    status: "updated",
    asset: markdown("asset-one", "updated"),
    fingerprint: "sha256:updated",
  };
  await feature.commands.updateText({
    id: "asset-one",
    expectedFingerprint: "sha256:initial",
    text: "updated",
  });

  assert.deepEqual(events, ["asset-one", "asset-one"]);
  await feature.release();
});

test("Workbench Assets does not publish failed or conflicting text updates", async () => {
  const repository = new FakeWorkbenchAssetRepository();
  const feature = createWorkbenchAssetsFeature(repository);
  const events: string[] = [];
  feature.events.subscribe((event) => events.push(event.assetId));

  for (const result of [
    { status: "not_found" } as const,
    { status: "not_editable", kind: "pdf" } as const,
    { status: "conflict", fingerprint: "sha256:current" } as const,
    { status: "too_large" } as const,
  ]) {
    repository.nextUpdate = result;
    assert.deepEqual(await feature.commands.updateText({
      id: "asset-one",
      expectedFingerprint: "sha256:expected",
      text: "next",
    }), result);
  }

  assert.deepEqual(events, []);
  await feature.release();
});

test("Workbench Assets release waits for committed work and rejects later use", async () => {
  const repository = new FakeWorkbenchAssetRepository();
  const feature = createWorkbenchAssetsFeature(repository);

  await feature.commands.replace(markdown("asset-one", "initial"));
  await feature.release();
  await feature.release();

  await assert.rejects(feature.queries.list(), /released/u);
  await assert.rejects(feature.commands.replace(markdown("asset-two", "next")), /released/u);
});

class FakeWorkbenchAssetRepository implements WorkbenchAssetRepository {
  private readonly assets = new Map<string, WorkbenchAsset>();
  nextUpdate: UpdateWorkbenchAssetTextResult = { status: "not_found" };

  async get(id: string): Promise<WorkbenchAsset | undefined> {
    return this.assets.get(id);
  }

  async list(): Promise<readonly WorkbenchAsset[]> {
    return [...this.assets.values()];
  }

  async removeMany(assetIds: readonly string[]): Promise<void> {
    for (const id of assetIds) this.assets.delete(id);
  }

  async upsertMany(assets: readonly WorkbenchAsset[]): Promise<void> {
    for (const asset of assets) this.assets.set(asset.id, asset);
  }

  async updateCaption() {
    return { status: "not_found" } as never;
  }
  async updateText(_input: UpdateWorkbenchAssetTextInput): Promise<UpdateWorkbenchAssetTextResult> {
    return this.nextUpdate;
  }
}

function markdown(id: string, text: string): WorkbenchAsset {
  return { id, kind: "markdown", title: `${id}.md`, markdown: text };
}
