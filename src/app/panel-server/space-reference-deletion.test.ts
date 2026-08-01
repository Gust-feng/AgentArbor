import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InMemoryLocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import { runSpaceReferenceRemoval, stageOwnedSpaceReferenceDeletion } from "./space-reference-deletion.js";

test("staged owned-file deletion can roll back a failed metadata commit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-delete-stage-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "note.md");
  await fs.writeFile(source, "keep", "utf8");
  const staged = await stageOwnedSpaceReferenceDeletion({
    id: "ref", spaceId: "space", title: "note.md", reference: { kind: "local_file", path: source }, createdAt: "now", updatedAt: "now",
  }, path.join(root, "managed"));
  assert.equal(await fs.stat(source).then(() => true, () => false), false);
  await staged?.rollback();
  assert.equal(await fs.readFile(source, "utf8"), "keep");
});

test("missing local-file deletion commits stale Space metadata without a filesystem stage", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-delete-missing-file-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  let metadataRemoved = false;

  await runSpaceReferenceRemoval(
    [{
      id: "missing",
      spaceId: "space",
      title: "missing.md",
      reference: { kind: "local_file", path: path.join(root, "missing.md") },
      createdAt: "now",
      updatedAt: "now",
    }],
    path.join(root, "managed"),
    new InMemoryLocalWorkspaceMutationCoordinator(),
    async () => { metadataRemoved = true; },
  );

  assert.equal(metadataRemoved, true);
});

test("Space reference removal stages and rolls back every owned item in a removed subtree", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-delete-subtree-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, "managed");
  const managedFolder = path.join(managedRoot, "folder");
  const localFile = path.join(root, "note.md");
  await fs.mkdir(managedFolder, { recursive: true });
  await fs.writeFile(path.join(managedFolder, "inside.md"), "managed", "utf8");
  await fs.writeFile(localFile, "local", "utf8");
  const items = [
    { id: "group", spaceId: "space", title: "group", reference: { kind: "asset_folder" as const }, createdAt: "now", updatedAt: "now" },
    { id: "managed", spaceId: "space", parentId: "group", title: "managed", reference: { kind: "managed_folder" as const, path: managedFolder }, createdAt: "now", updatedAt: "now" },
    { id: "local", spaceId: "space", parentId: "group", title: "local", reference: { kind: "local_file" as const, path: localFile }, createdAt: "now", updatedAt: "now" },
  ];

  await assert.rejects(runSpaceReferenceRemoval(
    items,
    managedRoot,
    new InMemoryLocalWorkspaceMutationCoordinator(),
    async () => { throw new Error("metadata failed"); },
  ), /metadata failed/u);

  assert.equal(await fs.readFile(path.join(managedFolder, "inside.md"), "utf8"), "managed");
  assert.equal(await fs.readFile(localFile, "utf8"), "local");

  await runSpaceReferenceRemoval(
    items,
    managedRoot,
    new InMemoryLocalWorkspaceMutationCoordinator(),
    async () => undefined,
  );
  assert.equal(await fs.stat(managedFolder).then(() => true, () => false), false);
  assert.equal(await fs.stat(localFile).then(() => true, () => false), false);
});
