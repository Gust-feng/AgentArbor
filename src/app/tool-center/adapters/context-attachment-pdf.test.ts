import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfText, pdfReadErrorReason } from "./context-attachment-pdf.js";
import { createTextPdfBuffer } from "./context-attachment-test-support.js";

test("PDF extraction uses PDF.js text mapping and reports page facts", async () => {
  const result = await extractPdfText(createTextPdfBuffer(["Quarterly report", "Revenue is 1200"]));

  assert.match(result.text, /Quarterly report/u);
  assert.match(result.text, /Revenue is 1200/u);
  assert.deepEqual(result.facts, { pageCount: 1, textItems: 2 });
});

test("PDF extraction preserves caller cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancel PDF extraction"));

  await assert.rejects(
    () => extractPdfText(createTextPdfBuffer(["unused"]), controller.signal),
    { name: "AbortError", message: "Tool execution cancelled." },
  );
});

test("PDF parser errors are normalized without exposing library messages", async () => {
  await assert.rejects(() => extractPdfText(Buffer.from("not a PDF", "utf8")));
  assert.equal(pdfReadErrorReason(Object.assign(new Error("broken"), { name: "InvalidPDFException" })), "invalid_pdf");
  assert.equal(pdfReadErrorReason(new Error("unexpected parser details")), "pdf_parse_failed");
});
