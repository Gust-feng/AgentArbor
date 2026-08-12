import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManagedContentFeature } from "./managed-content-feature.js";
import { MANAGED_CONTENT_MAX_TEXT_BYTES, ManagedContentError, type ManagedContentRootRecord } from "./contracts.js";

test("Managed Content owns root and UTF-8 file creation, edits, moves and deletes", async (t) => {
  const fixture = await createFixture(t);
  const root = await fixture.feature.commands.createRoot({ spaceId: "space-one", title: "资料" });
  assert.equal(root.id, "managed-one");

  const initial = await fixture.feature.commands.writeText({
    rootId: root.id,
    relativePath: "notes/idea.md",
    text: "第一版",
  });
  assert.match(initial.fingerprint, /^sha256:/u);
  assert.deepEqual((await fixture.feature.queries.listTextFiles(root.id)).map((file) => ({
    path: file.relativePath,
    text: file.text,
  })), [{ path: "notes/idea.md", text: "第一版" }]);

  const updated = await fixture.feature.commands.writeText({
    rootId: root.id,
    relativePath: "notes/idea.md",
    text: "第二版",
    expectedFingerprint: initial.fingerprint,
  });
  assert.equal(updated.text, "第二版");
  await assert.rejects(
    fixture.feature.commands.writeText({
      rootId: root.id,
      relativePath: "notes/idea.md",
      text: "过期写入",
      expectedFingerprint: initial.fingerprint,
    }),
    (error: unknown) => error instanceof ManagedContentError && error.code === "managed_content_revision_conflict",
  );

  const renamed = await fixture.feature.commands.renameEntry({
    rootId: root.id,
    relativePath: "notes/idea.md",
    name: "decision.md",
  });
  assert.equal(renamed.relativePath, "notes/decision.md");
  assert.equal((await fixture.feature.queries.readTextFile(root.id, renamed.relativePath))?.text, "第二版");

  await assert.rejects(
    fixture.feature.commands.writeText({ rootId: root.id, relativePath: "../outside.md", text: "越界" }),
    (error: unknown) => error instanceof ManagedContentError && error.code === "managed_content_invalid_path",
  );

  await fixture.feature.commands.deleteText({ rootId: root.id, relativePath: renamed.relativePath });
  assert.equal(await fixture.feature.queries.readTextFile(root.id, renamed.relativePath), undefined);
  await fixture.feature.commands.deleteRoot(root.id);
  assert.equal(await fixture.feature.queries.readRoot(root.id), undefined);
});

test("Managed Content fails a scan when a formerly syncable file becomes unreadable content", async (t) => {
  const fixture = await createFixture(t);
  const root = await fixture.feature.commands.createRoot({ spaceId: "space-one", title: "资料" });
  await fixture.feature.commands.writeText({ rootId: root.id, relativePath: "notes/large.md", text: "initial" });

  const rootPath = fixture.roots.get(root.id)!.path;
  await writeFile(path.join(rootPath, "notes", "large.md"), Buffer.alloc(MANAGED_CONTENT_MAX_TEXT_BYTES + 1, 65));

  await assert.rejects(
    fixture.feature.queries.listTextFiles(root.id),
    (error: unknown) => error instanceof ManagedContentError && error.code === "managed_content_not_text",
  );
});

async function createFixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-content-"));
  const roots = new Map<string, ManagedContentRootRecord>();
  const feature = createManagedContentFeature({
    rootDirectory: directory,
    idFactory: () => "managed-one",
    spaces: {
      listManagedRoots: async () => [...roots.values()],
      readManagedRoot: async (id) => roots.get(id),
      async createManagedRoot(root) {
        if (root.spaceId !== "space-one") throw new Error("space missing");
        roots.set(root.id, root);
      },
      async renameManagedRoot(id, title) {
        const current = roots.get(id)!;
        roots.set(id, { ...current, title });
      },
      async moveManagedRoot(id, spaceId) {
        const current = roots.get(id)!;
        roots.set(id, { ...current, spaceId });
      },
      async removeManagedRoot(id) {
        const current = roots.get(id);
        if (current !== undefined) await rm(current.path, { recursive: true, force: true });
        roots.delete(id);
      },
      subscribe: () => () => undefined,
    },
  });
  t.after(async () => {
    await feature.release();
    await rm(directory, { recursive: true, force: true });
  });
  return { feature, roots };
}
