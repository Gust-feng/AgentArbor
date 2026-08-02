import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { buildLocalDocumentPreview } from "./local-document-preview.js";

test("local document preview exposes DOCX and XLSX through the shared read-only contract", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-office-preview-"));
  t.after(() => removeTestDirectory(root));
  await fs.writeFile(path.join(root, "proposal.docx"), Buffer.from("docx"));
  await fs.writeFile(path.join(root, "budget.xlsx"), Buffer.from("xlsx"));

  const meta = { itemId: "reference-one", title: "Office files", sourceKind: "workspace_folder" as const };
  const docx = await buildLocalDocumentPreview(root, "proposal.docx", meta, { contentBaseUrl: "/api/reference/content" });
  const xlsx = await buildLocalDocumentPreview(root, "budget.xlsx", meta, { contentBaseUrl: "/api/reference/content" });

  assert.equal(docx.status, "ready");
  assert.deepEqual(docx.presentation, { kind: "docx", editable: false, sourceMode: false });
  assert.deepEqual(docx.content, {
    kind: "office",
    officeKind: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/api/reference/content?path=proposal.docx",
  });
  assert.equal(xlsx.status, "ready");
  assert.deepEqual(xlsx.presentation, { kind: "xlsx", editable: false, sourceMode: false });
  assert.deepEqual(xlsx.content, {
    kind: "office",
    officeKind: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    url: "/api/reference/content?path=budget.xlsx",
  });

  const managedContent = path.join(root, "content");
  await fs.writeFile(managedContent, Buffer.from("managed-docx"));
  const managed = await buildLocalDocumentPreview(managedContent, "", {
    itemId: "managed-one",
    title: "Managed proposal",
    sourceKind: "knowledge_asset",
  }, {
    contentBaseUrl: "/api/personal-knowledge/assets/managed-one/content",
    contentTypeHintPath: "proposal.docx",
  });
  assert.deepEqual(managed.content, {
    kind: "office",
    officeKind: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/api/personal-knowledge/assets/managed-one/content",
  });
});

test("local document preview keeps legacy Office and presentation files unsupported", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-legacy-office-preview-"));
  t.after(() => removeTestDirectory(root));
  const meta = { itemId: "reference-one", title: "Legacy files", sourceKind: "workspace_folder" as const };

  for (const filename of ["legacy.doc", "legacy.xls", "slides.ppt", "slides.pptx"]) {
    await fs.writeFile(path.join(root, filename), Buffer.from("binary"));
    const preview = await buildLocalDocumentPreview(root, filename, meta);
    assert.equal(preview.status, "unsupported");
    assert.equal(preview.presentation.kind, "unavailable");
    assert.equal(preview.content.kind, "unavailable");
  }
});
