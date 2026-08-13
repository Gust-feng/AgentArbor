import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTestDirectory } from "../testing/fs-test-directories.js";
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

test("Managed Content lists only UTF-8 text files and skips binary materials in the same root", async (t) => {
  const fixture = await createFixture(t);
  const root = await fixture.feature.commands.createRoot({ spaceId: "space-one", title: "资料" });
  await fixture.feature.commands.writeText({ rootId: root.id, relativePath: "notes/idea.md", text: "灵感" });

  const rootPath = fixture.roots.get(root.id)!.path;
  // JPEG/PDF 魔数开头的二进制文件：属于受管文件夹的正常内容，但不属于文本同步边界。
  await writeFile(path.join(rootPath, "灵感·山.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00]));
  await writeFile(path.join(rootPath, "入门笔记.pdf"), Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])]));

  assert.deepEqual((await fixture.feature.queries.listTextFiles(root.id)).map((file) => file.relativePath), ["notes/idea.md"]);
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
        if (current !== undefined) await removeTestDirectory(current.path);
        roots.delete(id);
      },
      subscribe: () => () => undefined,
    },
  });
  t.after(async () => {
    await feature.release();
    await removeTestDirectory(directory);
  });
  return { feature, roots };
}
