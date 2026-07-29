import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";
import { captureKnowledgeAsset, reconcileKnowledgeAssets } from "./knowledge-asset-store.js";

test("knowledge asset capture copies only the selected child file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-child-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const assets = path.join(directory, "assets");
  await fs.mkdir(path.join(source, "nested"), { recursive: true });
  await fs.writeFile(path.join(source, "selected.md"), "# selected", "utf8");
  await fs.writeFile(path.join(source, "other.md"), "# other", "utf8");

  const asset = await captureKnowledgeAsset(assets, "asset-one", workspaceReference(source), "selected.md");

  assert.equal(asset.sourceRelativePath, "selected.md");
  assert.equal(asset.contentKind, "file");
  assert.equal(await fs.readFile(path.join(assets, encoded("asset-one"), "content"), "utf8"), "# selected");
  assert.equal(await fs.stat(path.join(assets, encoded("asset-one"), "other.md")).then(() => true, () => false), false);
});

test("knowledge asset capture rejects oversized content and removes temporary directories", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-limit-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "large.bin");
  const assets = path.join(directory, "assets");
  await fs.writeFile(source, "");
  await fs.truncate(source, 256 * 1024 * 1024 + 1);

  await assert.rejects(
    captureKnowledgeAsset(assets, "asset-large", localFileReference(source)),
    (error: unknown) => error instanceof PanelHttpError && error.code === "knowledge_asset_capture_limit",
  );
  assert.deepEqual(await fs.readdir(assets).catch(() => []), []);
});

test("knowledge asset reconciliation removes pending and orphan directories only", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-reconcile-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const active = encoded("active");
  await Promise.all([
    fs.mkdir(path.join(directory, active), { recursive: true }),
    fs.mkdir(path.join(directory, `${active}.pending-interrupted`), { recursive: true }),
    fs.mkdir(path.join(directory, encoded("orphan")), { recursive: true }),
  ]);

  await reconcileKnowledgeAssets(directory, new Set(["active"]));

  assert.deepEqual(await fs.readdir(directory), [active]);
});

function workspaceReference(source: string): SpaceReferenceItem {
  return { id: "reference-one", spaceId: "space-one", title: "source", reference: { kind: "workspace_folder", path: source }, createdAt: "now", updatedAt: "now" };
}

function localFileReference(source: string): SpaceReferenceItem {
  return { id: "reference-two", spaceId: "space-one", title: "large.bin", reference: { kind: "local_file", path: source }, createdAt: "now", updatedAt: "now" };
}

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
