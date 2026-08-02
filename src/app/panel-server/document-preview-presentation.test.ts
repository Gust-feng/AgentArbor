import assert from "node:assert/strict";
import test from "node:test";

import { documentPresentation } from "./document-preview-presentation.js";

test("document presentation owns text semantics and editing capabilities", () => {
  assert.deepEqual(documentPresentation({
    kind: "text",
    text: "# Title",
    truncated: false,
    editable: true,
    language: "md",
  }), { kind: "markdown", editable: true, sourceMode: true });

  assert.deepEqual(documentPresentation({
    kind: "text",
    text: "{}",
    truncated: false,
    editable: true,
    language: "json",
  }), { kind: "code", editable: true, sourceMode: false });

  assert.deepEqual(documentPresentation({
    kind: "text",
    text: "plain",
    truncated: false,
    editable: false,
    language: "plaintext",
  }), { kind: "text", editable: false, sourceMode: false });

  assert.deepEqual(documentPresentation({
    kind: "text",
    text: "custom UTF-8",
    truncated: false,
    editable: true,
    language: "custom-extension",
  }), { kind: "text", editable: true, sourceMode: false });
});

test("document presentation preserves non-text content kinds", () => {
  assert.deepEqual(documentPresentation({
    kind: "media",
    mediaKind: "image",
    mimeType: "image/png",
    url: "/image.png",
  }), { kind: "image", editable: false, sourceMode: false });
  assert.deepEqual(documentPresentation({ kind: "pages", pages: ["page"] }), { kind: "pdf", editable: false, sourceMode: false });
  assert.deepEqual(documentPresentation({
    kind: "office",
    officeKind: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/document.docx",
  }), { kind: "docx", editable: false, sourceMode: false });
  assert.deepEqual(documentPresentation({
    kind: "office",
    officeKind: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    url: "/workbook.xlsx",
  }), { kind: "xlsx", editable: false, sourceMode: false });
  assert.deepEqual(documentPresentation({ kind: "directory", relativePath: "", entries: [], truncated: false }), { kind: "directory", editable: false, sourceMode: false });
  assert.deepEqual(documentPresentation({ kind: "unavailable", message: "missing" }), { kind: "unavailable", editable: false, sourceMode: false });
});
