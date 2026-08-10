import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFileSystemPathDependencyRepository,
  createPathDependencyFeature,
  PathDependencyFeatureError,
} from "./index.js";

test("filesystem repository survives a restart and rejects malformed snapshots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-path-dependency-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const feature = createPathDependencyFeature({
    repository: createFileSystemPathDependencyRepository(root),
    idFactory: () => "path-dependency:restart",
    now: () => "2026-08-10T00:00:00.000Z",
  });
  const result = await feature.commands.save({
    owner: { kind: "workspace", id: "workspace-stable" },
    title: "重挂载不漂移",
    methodology: "使用稳定 workspace id，而不是当前路径。",
  });
  assert.equal(result.status, "created");
  await feature.release();

  const restarted = createPathDependencyFeature({ repository: createFileSystemPathDependencyRepository(root) });
  const record = await restarted.queries.get("path-dependency:restart");
  assert.equal(record?.owner.kind, "workspace");
  assert.equal(record?.owner.id, "workspace-stable");
  await restarted.release();

  const recordFile = path.join(root, "records", `${encodeURIComponent("path-dependency:restart")}.json`);
  await fs.writeFile(recordFile, "not-json", "utf8");
  const broken = createPathDependencyFeature({ repository: createFileSystemPathDependencyRepository(root) });
  await assert.rejects(
    broken.queries.get("path-dependency:restart"),
    (error: unknown) => error instanceof PathDependencyFeatureError && error.code === "path_dependency_snapshot_incompatible",
  );
  await broken.release();
});
