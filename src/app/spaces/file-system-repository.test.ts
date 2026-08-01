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
