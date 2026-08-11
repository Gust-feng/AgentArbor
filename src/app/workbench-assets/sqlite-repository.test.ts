import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteRuntimeDatabase } from "../../adapters/runtime-storage/index.js";
import { workbenchAssetCaptionFingerprint } from "./asset-caption.js";
import { workbenchAssetTextFingerprint } from "./asset-text.js";
import { createSqliteWorkbenchAssetRepository } from "./sqlite-repository.js";
import type { WorkbenchAsset } from "./contracts.js";

test("Workbench asset repository atomically updates editable text using the expected fingerprint", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-workbench-assets-"));
  const database = new SqliteRuntimeDatabase(path.join(directory, "workbench.sqlite3"));
  const repository = createSqliteWorkbenchAssetRepository(database);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const markdown: WorkbenchAsset = {
    id: "note-one",
    kind: "markdown",
    title: "研究笔记.md",
    markdown: "# 初稿",
  };
  const code: WorkbenchAsset = {
    id: "code-one",
    kind: "code",
    title: "main.ts",
    code: { language: "typescript", filename: "main.ts", source: "export const value = 1;" },
  };
  const pdf: WorkbenchAsset = {
    id: "paper-one",
    kind: "pdf",
    title: "论文.pdf",
    pdf: { pages: ["只读正文"] },
  };
  const image: WorkbenchAsset = {
    id: "image-one",
    kind: "image",
    title: "结构图.png",
    image: { src: "/image.png", alt: "结构图", caption: "初始说明" },
  };
  await repository.upsertMany([markdown, code, pdf, image]);

  const expectedFingerprint = workbenchAssetTextFingerprint(markdown.markdown ?? "");
  const updated = await repository.updateText({
    id: markdown.id,
    expectedFingerprint,
    text: "# 定稿",
  });
  assert.equal(updated.status, "updated");
  if (updated.status !== "updated") return;
  assert.equal(updated.fingerprint, workbenchAssetTextFingerprint("# 定稿"));
  assert.equal((await repository.get(markdown.id))?.markdown, "# 定稿");

  const conflict = await repository.updateText({
    id: markdown.id,
    expectedFingerprint,
    text: "不应覆盖",
  });
  assert.deepEqual(conflict, {
    status: "conflict",
    fingerprint: workbenchAssetTextFingerprint("# 定稿"),
  });
  assert.equal((await repository.get(markdown.id))?.markdown, "# 定稿");

  const codeUpdated = await repository.updateText({
    id: code.id,
    expectedFingerprint: workbenchAssetTextFingerprint(code.code?.source ?? ""),
    text: "export const value = 2;",
  });
  assert.equal(codeUpdated.status, "updated");
  assert.deepEqual((await repository.get(code.id))?.code, {
    language: "typescript",
    filename: "main.ts",
    source: "export const value = 2;",
  });

  assert.deepEqual(await repository.updateText({
    id: pdf.id,
    expectedFingerprint: "irrelevant",
    text: "不允许写入",
  }), { status: "not_editable", kind: "pdf" });
  assert.equal((await repository.get(pdf.id))?.pdf?.pages[0], "只读正文");

  const imageFingerprint = workbenchAssetCaptionFingerprint(image.image?.caption);
  const imageUpdated = await repository.updateCaption({ id: image.id, expectedFingerprint: imageFingerprint, caption: "新的说明" });
  assert.equal(imageUpdated.status, "updated");
  assert.equal((await repository.get(image.id))?.image?.caption, "新的说明");
  assert.deepEqual(await repository.updateCaption({ id: image.id, expectedFingerprint: imageFingerprint, caption: "不应覆盖" }), {
    status: "conflict",
    fingerprint: workbenchAssetCaptionFingerprint("新的说明"),
  });
  const imageCleared = await repository.updateCaption({ id: image.id, expectedFingerprint: workbenchAssetCaptionFingerprint("新的说明"), caption: "" });
  assert.equal(imageCleared.status, "updated");
  assert.equal((await repository.get(image.id))?.image?.caption, undefined);
  assert.deepEqual(await repository.updateText({
    id: "missing",
    expectedFingerprint: "irrelevant",
    text: "不存在",
  }), { status: "not_found" });

  await repository.removeMany([markdown.id, markdown.id, "missing"]);
  assert.equal(await repository.get(markdown.id), undefined);
  assert.notEqual(await repository.get(code.id), undefined);
});
