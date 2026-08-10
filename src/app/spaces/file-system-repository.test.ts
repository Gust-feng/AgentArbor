import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { createFileSystemSpaceRepository } from "./file-system-repository.js";
import { SPACE_TREE_SCHEMA_VERSION, type SpaceTreeSnapshot } from "./contracts.js";

test("filesystem Space repository persists the root-only schema", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-repo-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemSpaceRepository(root);
  const value: SpaceTreeSnapshot = {
    schemaVersion: SPACE_TREE_SCHEMA_VERSION,
    spaces: [{ id: "space-1", title: "空间", createdAt: "now", updatedAt: "now" }],
    referenceItems: [{ id: "ref-1", spaceId: "space-1", title: "文档", reference: { kind: "local_file", path: "C:/doc.md" }, createdAt: "now", updatedAt: "now" }],
  };
  await repository.write(value);
  assert.deepEqual(await repository.read(), value);
});

test("filesystem Space repository round-trips annotations and rejects invalid ones", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-repo-annotation-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemSpaceRepository(root);
  const annotation = {
    markdown: "# 整理内容",
    keyPoints: ["要点一"],
    tags: ["标签"],
    revision: 3,
    updatedAt: "2026-08-11T00:00:00.000Z",
    updatedBy: "agent" as const,
  };
  const value: SpaceTreeSnapshot = {
    schemaVersion: SPACE_TREE_SCHEMA_VERSION,
    spaces: [{ id: "space-1", title: "空间", createdAt: "now", updatedAt: "now" }],
    referenceItems: [{ id: "ref-1", spaceId: "space-1", title: "网页", reference: { kind: "web_page", url: "https://example.com" }, annotation, createdAt: "now", updatedAt: "now" }],
  };
  await repository.write(value);
  assert.deepEqual((await repository.read()).referenceItems[0].annotation, annotation);

  await assert.rejects(
    repository.write({
      ...value,
      referenceItems: [{ ...value.referenceItems[0], annotation: { ...annotation, revision: 0 } }],
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "space_snapshot_incompatible",
  );
});

test("filesystem Space repository still accepts references without annotation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-repo-bare-"));
  t.after(() => removeTestDirectory(root));
  const repository = createFileSystemSpaceRepository(root);
  const value: SpaceTreeSnapshot = {
    schemaVersion: SPACE_TREE_SCHEMA_VERSION,
    spaces: [{ id: "space-1", title: "空间", createdAt: "now", updatedAt: "now" }],
    referenceItems: [{ id: "ref-1", spaceId: "space-1", title: "网页", reference: { kind: "web_page", url: "https://example.com" }, createdAt: "now", updatedAt: "now" }],
  };
  await repository.write(value);
  assert.deepEqual((await repository.read()).referenceItems[0].annotation, undefined);
});
