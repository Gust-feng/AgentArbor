import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSpaceFeature, emptySpaceTreeSnapshot } from "../spaces/space-feature.js";
import { spaceReferenceAttachmentId } from "../spaces/space-file-access.js";
import { reconcileMissingRunSpaceFiles } from "./space-file-reference-reconciliation.js";

test("Ordinary terminal reconciliation unlinks a frozen local file only after it is missing", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-file-reconcile-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "linked.md");
  await fs.writeFile(source, "content", "utf8");
  const feature = memorySpaceFeature();
  const space = await feature.commands.createSpace({ title: "资料" });
  const item = await feature.commands.addReference({
    spaceId: space.id,
    title: "linked.md",
    reference: { kind: "local_file", path: source },
  });
  const taskSoil = {
    contextRefs: [{
      attachmentId: spaceReferenceAttachmentId(item.id),
      ref: `local-file:${source}`,
      kind: "file" as const,
    }],
  };

  assert.deepEqual((await reconcileMissingRunSpaceFiles(feature, taskSoil)).removedReferenceIds, []);
  assert.notEqual(await feature.queries.getReference(item.id), undefined);

  await fs.rm(source);
  assert.deepEqual((await reconcileMissingRunSpaceFiles(feature, taskSoil)).removedReferenceIds, [item.id]);
  assert.equal(await feature.queries.getReference(item.id), undefined);
});

test("Ordinary terminal reconciliation preserves folders, unrelated links and inspection failures", async () => {
  const feature = memorySpaceFeature();
  const space = await feature.commands.createSpace({ title: "资料" });
  const failedFile = await feature.commands.addReference({
    spaceId: space.id,
    title: "unavailable.md",
    reference: { kind: "local_file", path: "Z:/unavailable.md" },
  });
  const unrelatedFile = await feature.commands.addReference({
    spaceId: space.id,
    title: "unrelated.md",
    reference: { kind: "local_file", path: "Z:/unrelated.md" },
  });
  const folder = await feature.commands.addReference({
    spaceId: space.id,
    title: "folder",
    reference: { kind: "workspace_folder", path: "Z:/missing-folder" },
  });
  const inspectionError = Object.assign(new Error("access denied"), { code: "EACCES" });

  const result = await reconcileMissingRunSpaceFiles(feature, {
    contextRefs: [
      { attachmentId: spaceReferenceAttachmentId(failedFile.id), ref: "local-file:failed", kind: "file" },
      { attachmentId: spaceReferenceAttachmentId(folder.id), ref: "local-project:folder", kind: "project" },
    ],
  }, { inspect: async () => ({ status: "failed", error: inspectionError }) });

  assert.deepEqual(result.removedReferenceIds, []);
  assert.deepEqual(result.inspectionFailures, [{ referenceId: failedFile.id, error: inspectionError }]);
  assert.notEqual(await feature.queries.getReference(failedFile.id), undefined);
  assert.notEqual(await feature.queries.getReference(unrelatedFile.id), undefined);
  assert.notEqual(await feature.queries.getReference(folder.id), undefined);
});

function memorySpaceFeature() {
  let snapshot = emptySpaceTreeSnapshot();
  let id = 0;
  return createSpaceFeature({
    repository: {
      async read() { return snapshot; },
      async write(next) { snapshot = next; },
    },
    idFactory: () => `id-${++id}`,
  });
}
