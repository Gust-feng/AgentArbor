import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { KnowledgePage } from "../personal-knowledge/index.js";
import { readManagedKnowledgeAsset } from "./knowledge-asset-store.js";

const DIRECTORY_PAGE: KnowledgePage = {
  refId: "directory-page",
  kind: "space_reference",
  collectedAt: 1,
  asset: {
    status: "managed",
    title: "目录资产",
    sourceLabel: "C:/source",
    contentKind: "directory",
    sourceReferenceId: "reference-one",
    sourceRelativePath: "",
  },
};

test("readManagedKnowledgeAsset reads text, continues large text and reports fingerprints", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(contentPath(root, "directory-page"), { recursive: true });
  await writeFile(path.join(contentPath(root, "directory-page"), "note.txt"), "0123456789ABCDEFGHIJ", "utf8");

  const first = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, { relativePath: "note.txt", maxLength: 10 });
  assert.equal(first.status, "text");
  assert.equal(first.status === "text" && first.text, "0123456789");
  assert.equal(first.status === "text" && first.truncated, true);
  assert.equal(first.status === "text" && first.continuation, "10");
  const second = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, {
    relativePath: "note.txt",
    maxLength: 10,
    continuation: first.status === "text" ? first.continuation : undefined,
  });
  assert.equal(second.status, "text");
  assert.equal(second.status === "text" && second.text, "ABCDEFGHIJ");
  assert.equal(second.status === "text" && second.truncated, false);
  assert.equal(second.status === "text" && second.fingerprint, first.status === "text" ? first.fingerprint : undefined);

  const filePage: KnowledgePage = { ...DIRECTORY_PAGE, refId: "file-page", asset: { ...DIRECTORY_PAGE.asset!, contentKind: "file" } };
  const invalid = await readManagedKnowledgeAsset(root, filePage, { relativePath: "../escape.md" });
  assert.equal(invalid.status, "invalid");
  const missing = await readManagedKnowledgeAsset(root, filePage, { relativePath: "" });
  assert.equal(missing.status, "missing");
});

test("readManagedKnowledgeAsset lists directories with replayable continuation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = contentPath(root, "directory-page");
  await mkdir(path.join(content, "sub"), { recursive: true });
  await writeFile(path.join(content, "a.md"), "a", "utf8");
  await writeFile(path.join(content, "b.md"), "b", "utf8");
  await writeFile(path.join(content, "sub", "c.md"), "c", "utf8");

  const first = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, { relativePath: "", maxLength: 2 });
  assert.equal(first.status, "directory");
  assert.deepEqual(first.status === "directory" && first.entries.map((entry) => entry.name), ["sub", "a.md"]);
  assert.equal(first.status === "directory" && first.truncated, true);
  const second = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, {
    relativePath: "",
    maxLength: 2,
    continuation: first.status === "directory" ? first.continuation : undefined,
  });
  assert.equal(second.status, "directory");
  assert.deepEqual(second.status === "directory" && second.entries.map((entry) => entry.name), ["b.md"]);
  assert.equal(second.status === "directory" && second.truncated, false);
  const child = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, { relativePath: "sub/c.md", maxLength: 10 });
  assert.equal(child.status, "text");
  assert.equal(child.status === "text" && child.text, "c");
});

test("readManagedKnowledgeAsset reports media facts and rejects binary content", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-knowledge-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = contentPath(root, "directory-page");
  await mkdir(content, { recursive: true });
  await writeFile(path.join(content, "diagram.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8");
  await writeFile(path.join(content, "blob.bin"), Buffer.from([0, 1, 2, 3, 255]));

  const media = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, { relativePath: "diagram.svg" });
  assert.equal(media.status, "media");
  assert.equal(media.status === "media" && media.mediaKind, "image");
  assert.equal(media.status === "media" && media.mimeType, "image/svg+xml");
  assert.equal(media.status === "media" && media.contentUrl, "/api/personal-knowledge/assets/directory-page/content?path=diagram.svg");

  const binary = await readManagedKnowledgeAsset(root, DIRECTORY_PAGE, { relativePath: "blob.bin" });
  assert.equal(binary.status, "unsupported");
});

function contentPath(root: string, refId: string): string {
  return path.join(root, Buffer.from(refId, "utf8").toString("base64url"), "content");
}
