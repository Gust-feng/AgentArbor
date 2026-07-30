import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stageOwnedSpaceReferenceDeletion } from "./space-reference-deletion.js";

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
