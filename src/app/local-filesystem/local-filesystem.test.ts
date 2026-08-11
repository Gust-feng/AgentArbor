import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTestDirectory } from "../testing/fs-test-directories.js";
import {
  contentFingerprint,
  createDirectory,
  createFile,
  deleteEntry,
  joinRelativePath,
  languageForPath,
  listDirectory,
  mimeTypeForPath,
  normalizeRelativePath,
  officeKindForPath,
  isKnownBinaryPath,
  renameEntry,
  resolveDestinationWithinRoot,
  resolveWithinRoot,
  writeText,
} from "./index.js";

test("local filesystem normalizes language aliases used by document presentation", () => {
  assert.deepEqual(languageForPath("script.py"), { language: "python" });
  assert.deepEqual(languageForPath(".gitmodules"), { language: "gitmodules" });
  assert.deepEqual(languageForPath(".editorconfig"), { language: "editorconfig" });
  assert.deepEqual(languageForPath("LICENSE"), { language: "license" });
});

test("local filesystem recognizes supported Office Open XML formats without enabling legacy binaries", () => {
  assert.equal(mimeTypeForPath("proposal.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(mimeTypeForPath("budget.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(officeKindForPath("proposal.DOCX"), "docx");
  assert.equal(officeKindForPath("budget.XLSX"), "xlsx");
  assert.equal(officeKindForPath("slides.pptx"), undefined);
  assert.equal(isKnownBinaryPath("proposal.docx"), false);
  assert.equal(isKnownBinaryPath("budget.xlsx"), false);
  for (const legacy of ["legacy.doc", "legacy.xls", "slides.ppt", "slides.pptx"]) {
    assert.equal(isKnownBinaryPath(legacy), true);
  }
});

test("local filesystem resolves only normalized paths inside an authorized root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-local-fs-path-"));
  t.after(() => removeTestDirectory(root));
  await fs.mkdir(path.join(root, "notes"));
  await fs.writeFile(path.join(root, "notes", "one.md"), "one", "utf8");
  const realRoot = await fs.realpath(root);

  assert.equal(await resolveWithinRoot(root, "notes/one.md"), path.join(realRoot, "notes", "one.md"));
  assert.equal(await resolveDestinationWithinRoot(root, "notes/two.md"), path.join(realRoot, "notes", "two.md"));
  assert.throws(() => normalizeRelativePath("notes/../outside.md"));
  assert.throws(() => normalizeRelativePath("C:\\outside.md"));
  assert.throws(() => normalizeRelativePath("/outside.md"));
  assert.equal(normalizeRelativePath("notes/./draft.md"), "notes/draft.md");
  assert.equal(normalizeRelativePath("notes//draft.md/"), "notes/draft.md");
  assert.equal(normalizeRelativePath("."), "");
  assert.throws(() => joinRelativePath("notes", "../outside.md"));
  await assert.rejects(() => resolveDestinationWithinRoot(root, "missing/two.md"));
});

test("local filesystem lists deterministic entry kinds and performs explicit mutations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-local-fs-mutation-"));
  t.after(() => removeTestDirectory(root));
  await fs.mkdir(path.join(root, "z-folder"));
  await fs.writeFile(path.join(root, "b.txt"), "b", "utf8");
  await fs.writeFile(path.join(root, "a.txt"), "a", "utf8");

  const listing = await listDirectory(root);
  assert.equal(listing.ok, true);
  if (listing.ok) {
    assert.deepEqual(listing.value.entries, [
      { name: "z-folder", kind: "directory" },
      { name: "a.txt", kind: "file" },
      { name: "b.txt", kind: "file" },
    ]);
  }

  assert.deepEqual(await createDirectory(path.join(root, "new-folder")), { ok: true, value: undefined });
  assert.deepEqual(await createFile(path.join(root, "new.md")), { ok: true, value: undefined });
  assert.equal((await createFile(path.join(root, "new.md"))).ok, false);
  assert.deepEqual(await renameEntry(path.join(root, "new.md"), path.join(root, "renamed.md")), { ok: true, value: undefined });
  assert.equal((await renameEntry(path.join(root, "renamed.md"), path.join(root, "a.txt"))).ok, false);
  assert.deepEqual(await deleteEntry(path.join(root, "new-folder")), { ok: true, value: undefined });
});

test("local filesystem text writes enforce the expected content fingerprint", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-local-fs-write-"));
  t.after(() => removeTestDirectory(root));
  const file = path.join(root, "note.md");
  await fs.writeFile(file, "first", "utf8");

  const stale = await writeText(file, "wrong", contentFingerprint(Buffer.from("stale", "utf8")));
  assert.equal(stale.ok, false);
  assert.equal(await fs.readFile(file, "utf8"), "first");

  const saved = await writeText(file, "second", contentFingerprint(Buffer.from("first", "utf8")));
  assert.deepEqual(saved, { ok: true, value: { fingerprint: contentFingerprint(Buffer.from("second", "utf8")) } });
  assert.equal(await fs.readFile(file, "utf8"), "second");
});
