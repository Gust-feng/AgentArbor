import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { makeTestDirectory, removeTestDirectory } from "../testing/fs-test-directories.js";
import { createSpaceReferenceDeletionFilePort } from "./space-reference-deletion.js";
import { PanelHttpError } from "./http-utils.js";

test("Space deletion file port stages, restores, and removes a local file", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-file-port-");
  t.after(() => removeTestDirectory(root));
  const sourcePath = path.join(root, "note.md");
  await fs.writeFile(sourcePath, "keep", "utf8");
  const files = createSpaceReferenceDeletionFilePort(path.join(root, "managed"));
  const target = await files.prepare({
    item: localFileItem("reference-one", sourcePath),
    deletionId: "delete-one",
    targetIndex: 0,
  });
  assert.ok(target);
  assert.equal(target.stagedPath, path.join(root, ".note.md.agentarbor-delete-delete-one-0"));

  await files.stage(target);
  assert.deepEqual(await files.inspect(target), { sourceExists: false, stagedExists: true });

  await files.restore(target);
  assert.deepEqual(await files.inspect(target), { sourceExists: true, stagedExists: false });
  assert.equal(await fs.readFile(sourcePath, "utf8"), "keep");

  await files.stage(target);
  await files.removeStaged(target);
  assert.deepEqual(await files.inspect(target), { sourceExists: false, stagedExists: false });
});

test("Space deletion file port ignores a missing local file", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-missing-");
  t.after(() => removeTestDirectory(root));
  const files = createSpaceReferenceDeletionFilePort(path.join(root, "managed"));

  assert.equal(await files.prepare({
    item: localFileItem("missing", path.join(root, "missing.md")),
    deletionId: "delete-missing",
    targetIndex: 0,
  }), undefined);
});

test("Space deletion file port rejects the managed root and paths outside it", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-managed-root-");
  t.after(() => removeTestDirectory(root));
  const managedRoot = path.join(root, "managed");
  const outside = path.join(root, "outside");
  await fs.mkdir(managedRoot, { recursive: true });
  await fs.mkdir(outside);
  const files = createSpaceReferenceDeletionFilePort(managedRoot);

  for (const [referenceId, sourcePath] of [["root", managedRoot], ["outside", outside]] as const) {
    await assert.rejects(
      files.prepare({
        item: managedFolderItem(referenceId, sourcePath),
        deletionId: `delete-${referenceId}`,
        targetIndex: 0,
      }),
      (error: unknown) => error instanceof PanelHttpError
        && error.statusCode === 409
        && error.code === "space_managed_folder_not_found",
    );
  }
});

test("Space deletion file port rejects a managed path that escapes through a directory link", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-managed-link-");
  t.after(() => removeTestDirectory(root));
  const managedRoot = path.join(root, "managed");
  const outsideRoot = path.join(root, "outside");
  const outsideFolder = path.join(outsideRoot, "owned");
  await fs.mkdir(managedRoot, { recursive: true });
  await fs.mkdir(outsideFolder, { recursive: true });
  const linkedOutsideRoot = path.join(managedRoot, "escape");
  await fs.symlink(outsideRoot, linkedOutsideRoot, process.platform === "win32" ? "junction" : "dir");
  const files = createSpaceReferenceDeletionFilePort(managedRoot);

  await assert.rejects(
    files.prepare({
      item: managedFolderItem("linked-outside", path.join(linkedOutsideRoot, "owned")),
      deletionId: "delete-linked-outside",
      targetIndex: 0,
    }),
    (error: unknown) => error instanceof PanelHttpError
      && error.statusCode === 409
      && error.code === "space_managed_folder_not_found",
  );
  assert.equal((await fs.lstat(outsideFolder)).isDirectory(), true);
});

test("Space deletion file port inspects source and staged siblings independently", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-inspect-");
  t.after(() => removeTestDirectory(root));
  const sourcePath = path.join(root, "note.md");
  await fs.writeFile(sourcePath, "source", "utf8");
  const files = createSpaceReferenceDeletionFilePort(path.join(root, "managed"));
  const target = await files.prepare({
    item: localFileItem("reference-one", sourcePath),
    deletionId: "delete-inspect",
    targetIndex: 3,
  });
  assert.ok(target);

  await fs.writeFile(target.stagedPath, "staged", "utf8");
  assert.deepEqual(await files.inspect(target), { sourceExists: true, stagedExists: true });
});

test("Space deletion file port refuses an existing staged sibling", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-stage-conflict-");
  t.after(() => removeTestDirectory(root));
  const sourcePath = path.join(root, "note.md");
  const stagedPath = path.join(root, ".note.md.agentarbor-delete-delete-conflict-0");
  await fs.writeFile(sourcePath, "source", "utf8");
  await fs.writeFile(stagedPath, "existing", "utf8");
  const files = createSpaceReferenceDeletionFilePort(path.join(root, "managed"));

  await assert.rejects(
    files.prepare({
      item: localFileItem("reference-one", sourcePath),
      deletionId: "delete-conflict",
      targetIndex: 0,
    }),
    (error: unknown) => error instanceof PanelHttpError
      && error.statusCode === 409
      && error.code === "space_reference_deletion_stage_exists",
  );
  assert.equal(await fs.readFile(sourcePath, "utf8"), "source");
  assert.equal(await fs.readFile(stagedPath, "utf8"), "existing");
});

test("Space deletion file port never overwrites a source recreated before restore", async (t) => {
  const root = await makeTestDirectory("agentarbor-space-delete-restore-conflict-");
  t.after(() => removeTestDirectory(root));
  const sourcePath = path.join(root, "note.md");
  await fs.writeFile(sourcePath, "original", "utf8");
  const files = createSpaceReferenceDeletionFilePort(path.join(root, "managed"));
  const target = await files.prepare({
    item: localFileItem("reference-one", sourcePath),
    deletionId: "delete-restore-conflict",
    targetIndex: 0,
  });
  assert.ok(target);
  await files.stage(target);
  await fs.writeFile(sourcePath, "new source", "utf8");

  await assert.rejects(
    files.restore(target),
    (error: unknown) => error instanceof PanelHttpError
      && error.code === "space_reference_deletion_restore_conflict",
  );
  assert.equal(await fs.readFile(sourcePath, "utf8"), "new source");
  assert.equal(await fs.readFile(target.stagedPath, "utf8"), "original");
});

function localFileItem(id: string, sourcePath: string) {
  return {
    id,
    spaceId: "space-one",
    title: path.basename(sourcePath),
    reference: { kind: "local_file" as const, path: sourcePath },
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function managedFolderItem(id: string, sourcePath: string) {
  return {
    id,
    spaceId: "space-one",
    title: path.basename(sourcePath),
    reference: { kind: "managed_folder" as const, path: sourcePath },
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}