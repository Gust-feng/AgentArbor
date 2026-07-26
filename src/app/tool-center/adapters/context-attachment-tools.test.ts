import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeToolFactValue } from "../../../domain/tools/index.js";
import {
  asRecord,
  contextAttachmentToolCenter,
  createTextPdfBuffer,
  taskSoilWithContext,
  TOOL_CONTEXT,
  writeEmptyFiles,
} from "./context-attachment-test-support.js";
test("context attachment tools read selected local file by attachmentId without exposing absolute path to the model", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-local-"));
  const localFile = path.join(localRoot, "secret-notes.txt");
  const content = "attached local text\nsecond line";
  await fs.writeFile(localFile, content, "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_local_file",
          ref: `local-file:${localFile}`,
          kind: "file",
          title: "secret-notes.txt",
          summary: "Selected local text file.",
          metadata: {
            byteLength: Buffer.byteLength(content),
            mimeType: "text/plain",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const result = await center.execute(
      {
        callId: "call:read-local",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_local_file" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentRead"],
      }
    );
    const modelVisible = JSON.stringify(result.output);

    assert.equal(result.status, "completed");
    assertDirectAttachmentFacts(result.output);
    assert.equal(modelVisible.includes("attached local text"), true);
    assert.equal(modelVisible.includes("second line"), true);
    assert.equal(modelVisible.includes(localFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment text read returns executable character continuation", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-text-continuation-"));
  const localFile = path.join(localRoot, "long-notes.txt");
  await fs.writeFile(localFile, "abcdefghij", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_long_text",
          ref: `local-file:${localFile}`,
          kind: "file",
          title: "long-notes.txt",
          summary: "Selected long text file.",
          metadata: {
            byteLength: 10,
            mimeType: "text/plain",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["AttachmentRead"],
    };

    const firstRead = await center.execute(
      {
        callId: "call:read-text-window-1",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_long_text", maxLength: 5 },
      },
      TOOL_CONTEXT,
      permission
    );
    const firstResult = asRecord(firstRead.output);
    const firstNextInput = asRecord(asRecord(asRecord(firstRead.output).continuation).nextInput);

    assert.equal(firstRead.status, "completed");
    assertDirectAttachmentFacts(firstRead.output);
    assert.equal(firstResult.content, "abcd…");
    assert.equal(firstResult.startChar, 0);
    assert.equal(firstResult.textChars, 4);
    assert.equal(firstResult.charCount, 10);
    assert.equal(firstResult.nextStartChar, undefined);
    assert.equal(firstNextInput.attachmentId, "ctx_long_text");
    assert.equal(firstNextInput.maxLength, 5);
    assert.equal(firstNextInput.startChar, 4);

    const secondRead = await center.execute(
      {
        callId: "call:read-text-window-2",
        toolName: "AttachmentRead",
        input: normalizeToolFactValue(firstNextInput),
      },
      TOOL_CONTEXT,
      permission
    );
    const secondResult = asRecord(secondRead.output);
    assert.equal(secondResult.content, "efgh…");
    assert.equal(secondResult.startChar, 4);
    assert.equal(asRecord(asRecord(asRecord(secondRead.output).continuation).nextInput).startChar, 8);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment text continuation keeps emoji surrogate pairs intact", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-text-unicode-"));
  const localFile = path.join(localRoot, "unicode.txt");
  await fs.writeFile(localFile, "A😀BC", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [{
        attachmentId: "ctx_unicode_text",
        ref: `local-file:${localFile}`,
        kind: "file",
        title: "unicode.txt",
      }],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["AttachmentRead"],
    };

    const first = await center.execute(
      {
        callId: "call:read-unicode-window-1",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_unicode_text", maxLength: 3 },
      },
      TOOL_CONTEXT,
      permission,
    );
    const firstFacts = asRecord(first.output);
    const second = await center.execute(
      {
        callId: "call:read-unicode-window-2",
        toolName: "AttachmentRead",
        input: normalizeToolFactValue(asRecord(asRecord(firstFacts.continuation).nextInput)),
      },
      TOOL_CONTEXT,
      permission,
    );
    const secondFacts = asRecord(second.output);

    assert.equal(firstFacts.content, "A…");
    assert.equal(firstFacts.textChars, 1);
    assert.equal(secondFacts.content, "😀…");
    assert.equal(secondFacts.textChars, 2);
    const split = await center.execute(
      {
        callId: "call:read-unicode-window-split",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_unicode_text", maxLength: 3, startChar: 2 },
      },
      TOOL_CONTEXT,
      permission,
    );
    assert.equal(split.status, "failed");
    assert.match(String(split.error), /must not split a UTF-16 surrogate pair/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment text read rejects a character window too small to advance continuation", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-text-minimum-"));
  const localFile = path.join(localRoot, "long-notes.txt");
  await fs.writeFile(localFile, "abcdefghij", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_small_text_window",
          ref: `local-file:${localFile}`,
          kind: "file",
          title: "long-notes.txt",
          summary: "Selected long text file.",
          metadata: {
            byteLength: 10,
            mimeType: "text/plain",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });

    const result = await center.execute(
      {
        callId: "call:read-text-minimum",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_small_text_window", maxLength: 2 },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentRead"],
      }
    );

    assert.equal(result.status, "failed");
    assert.match(String(result.error), /attachment_read_text maxLength must be at least 3/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment text read rejects invalid explicit maxLength values", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-text-invalid-window-"));
  const localFile = path.join(localRoot, "long-notes.txt");
  await fs.writeFile(localFile, "abcdefghij", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [{
        attachmentId: "ctx_invalid_text_window",
        ref: `local-file:${localFile}`,
        kind: "file",
        title: "long-notes.txt",
      }],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });

    for (const maxLength of [0, -1, 1, 2, 1.5, "1"] as const) {
      const result = await center.execute(
        {
          callId: `call:invalid-attachment-max-length:${String(maxLength)}`,
          toolName: "AttachmentRead",
          input: { attachmentId: "ctx_invalid_text_window", maxLength },
        },
        TOOL_CONTEXT,
        {
          callerAgentId: TOOL_CONTEXT.callerAgentId,
          allowedTools: ["AttachmentRead"],
        },
      );
      assert.equal(result.status, "failed");
      assert.match(String(result.error), /maxLength must be at least 3 and a safe integer/);
    }
    for (const startChar of [-1, 1.5, "1", 11] as const) {
      const result = await center.execute(
        {
          callId: `call:invalid-attachment-start-char:${String(startChar)}`,
          toolName: "AttachmentRead",
          input: { attachmentId: "ctx_invalid_text_window", startChar },
        },
        TOOL_CONTEXT,
        {
          callerAgentId: TOOL_CONTEXT.callerAgentId,
          allowedTools: ["AttachmentRead"],
        },
      );
      assert.equal(result.status, "failed");
      assert.match(String(result.error), /attachment_read_text startChar/);
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment text read rejects line ranges with maxLength to avoid skipped continuation", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-text-line-maxlength-"));
  const localFile = path.join(localRoot, "long-lines.txt");
  await fs.writeFile(localFile, "abcdefghij\nklmnopqrst\n", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_long_lines",
          ref: `local-file:${localFile}`,
          kind: "file",
          title: "long-lines.txt",
          summary: "Selected long line text file.",
          metadata: {
            byteLength: 22,
            mimeType: "text/plain",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${localFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const result = await center.execute(
      {
        callId: "call:read-text-line-maxlength",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_long_lines", startLine: 1, endLine: 2, maxLength: 5 },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentRead"],
      }
    );

    assert.equal(result.status, "failed");
    assert.match(String(result.error), /cannot combine maxLength with startLine\/endLine/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment PDF tool extracts text-native PDF content and rejects invalid windows", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-pdf-"));
  const pdfFile = path.join(localRoot, "report.pdf");
  const content = createTextPdfBuffer(["Quarterly report", "Revenue is 1200"]);
  await fs.writeFile(pdfFile, content);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_report_pdf",
          ref: `local-file:${pdfFile}`,
          kind: "file",
          title: "report.pdf",
          summary: "Selected PDF report.",
          metadata: {
            byteLength: content.length,
            mimeType: "application/pdf",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${pdfFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "AttachmentList",
        "AttachmentReadPdf",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-pdf",
        toolName: "AttachmentList",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-pdf",
        toolName: "AttachmentReadPdf",
        input: { attachmentId: "ctx_report_pdf" },
      },
      TOOL_CONTEXT,
      permission
    );
    const modelVisible = JSON.stringify([listed.output, read.output]);

    assert.equal(listed.status, "completed");
    assert.equal(read.status, "completed");
    assertDirectAttachmentFacts(listed.output);
    assertDirectAttachmentFacts(read.output);
    assert.equal(modelVisible.includes("\"format\":\"pdf\""), true);
    assert.equal(modelVisible.includes("\"canReadPdfText\":true"), true);
    assert.equal(modelVisible.includes("Quarterly report"), true);
    assert.equal(modelVisible.includes("Revenue is 1200"), true);
    assert.equal(modelVisible.includes(pdfFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
    for (const maxLength of [0, -1, 1, 2, 1.5, "1"] as const) {
      const invalid = await center.execute(
        {
          callId: `call:read-pdf-invalid-${String(maxLength)}`,
          toolName: "AttachmentReadPdf",
          input: { attachmentId: "ctx_report_pdf", maxLength },
        },
        TOOL_CONTEXT,
        permission,
      );
      assert.equal(invalid.status, "failed");
      assert.match(String(invalid.error), /maxLength must be at least 3 and a safe integer/);
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment tools browse search and read files inside selected local project", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-project-"));
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "index.ts"), "export const marker = 'needle';\n", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "sample-project",
          summary: "Selected local project.",
          metadata: {
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "AttachmentListFiles",
        "AttachmentSearchFiles",
        "AttachmentRead",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-project",
        toolName: "AttachmentListFiles",
        input: { attachmentId: "ctx_project", depth: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searched = await center.execute(
      {
        callId: "call:search-project",
        toolName: "AttachmentSearchFiles",
        input: { attachmentId: "ctx_project", query: "needle" },
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-project-file",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_project", path: "src/index.ts" },
      },
      TOOL_CONTEXT,
      permission
    );
    const projected = JSON.stringify([listed.output, searched.output, read.output]);

    assert.equal(listed.status, "completed");
    assert.equal(searched.status, "completed");
    assert.equal(read.status, "completed");
    assertDirectAttachmentFacts(listed.output);
    assertDirectAttachmentFacts(searched.output);
    assertDirectAttachmentFacts(read.output);
    assert.equal(projected.includes("src/index.ts"), true);
    assert.equal(projected.includes("needle"), true);
    assert.equal(projected.includes(projectRoot), false);
    assert.equal(projected.includes("local-project:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment list and search tools expose executable continuation offsets", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-project-continuation-"));
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    await fs.writeFile(path.join(projectRoot, "src", `note-${index}.txt`), `needle ${index}\n`, "utf8");
  }
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "sample-project",
          summary: "Selected local project.",
          metadata: { available: true },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["AttachmentListFiles", "AttachmentSearchFiles"],
    };

    const listed = await center.execute(
      {
        callId: "call:list-project-continuation",
        toolName: "AttachmentListFiles",
        input: { attachmentId: "ctx_project", path: "src", depth: 1, limit: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const listOutput = asRecord(listed.output);
    const listNextInput = asRecord(asRecord(listOutput.continuation).nextInput);

    assert.equal(listed.status, "completed");
    assert.equal(listOutput.truncated, true);
    assert.equal(listNextInput.attachmentId, "ctx_project");
    assert.equal(listNextInput.path, "src");
    assert.equal(listNextInput.offset, 2);

    const secondListed = await center.execute(
      {
        callId: "call:list-project-continuation-2",
        toolName: "AttachmentListFiles",
        input: normalizeToolFactValue(listNextInput),
      },
      TOOL_CONTEXT,
      permission
    );
    const secondListResult = asRecord(secondListed.output);
    assert.equal(secondListed.status, "completed");
    assert.equal(secondListResult.offset, 2);
    assert.equal(asRecord(asRecord(asRecord(secondListed.output).continuation).nextInput).offset, 4);
    assert.equal(Array.isArray(secondListResult.entries), true);
    assert.equal(asRecord((secondListResult.entries as readonly unknown[])[0]).path, "src/note-3.txt");

    const searched = await center.execute(
      {
        callId: "call:search-project-continuation",
        toolName: "AttachmentSearchFiles",
        input: { attachmentId: "ctx_project", query: "needle", path: "src", limit: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searchOutput = asRecord(searched.output);
    const searchNextInput = asRecord(asRecord(searchOutput.continuation).nextInput);

    assert.equal(searched.status, "completed");
    assert.equal(searchOutput.truncated, true);
    assert.equal(searchNextInput.attachmentId, "ctx_project");
    assert.equal(searchNextInput.query, "needle");
    assert.equal(searchNextInput.path, "src");
    assert.equal(searchNextInput.offset, 2);

    const secondSearched = await center.execute(
      {
        callId: "call:search-project-continuation-2",
        toolName: "AttachmentSearchFiles",
        input: normalizeToolFactValue(searchNextInput),
      },
      TOOL_CONTEXT,
      permission
    );
    const secondSearchResult = asRecord(secondSearched.output);
    assert.equal(secondSearched.status, "completed");
    assert.equal(secondSearchResult.offset, 2);
    assert.equal(asRecord(asRecord(asRecord(secondSearched.output).continuation).nextInput).offset, 4);
    assert.equal(Array.isArray(secondSearchResult.matches), true);
    assert.equal(asRecord((secondSearchResult.matches as readonly unknown[])[0]).path, "src/note-3.txt");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment list and search tools fail honestly at the offset ceiling", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-project-ceiling-"));
  const listingRoot = path.join(projectRoot, "listing");
  const searchRoot = path.join(projectRoot, "search");
  await fs.mkdir(listingRoot, { recursive: true });
  await fs.mkdir(searchRoot, { recursive: true });
  await writeEmptyFiles(listingRoot, 10_002);
  await fs.writeFile(
    path.join(searchRoot, "matches.txt"),
    Array.from({ length: 10_082 }, (_value, index) => `needle ${String(index).padStart(5, "0")}`).join("\n"),
    "utf8"
  );
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "ceiling-project",
          summary: "Selected local project with many entries.",
          metadata: { available: true },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["AttachmentListFiles", "AttachmentSearchFiles"],
    };

    const listed = await center.execute(
      {
        callId: "call:list-project-ceiling",
        toolName: "AttachmentListFiles",
        input: { attachmentId: "ctx_project", path: "listing", depth: 1, limit: 1, offset: 10_000 },
      },
      TOOL_CONTEXT,
      permission
    );
    const listOutput = asRecord(listed.output);

    assert.equal(listed.status, "failed");
    assert.equal(listed.errorFacts?.code, "context_attachment_list_continuation_limit_reached");
    assert.equal(listed.errorFacts?.retryable, false);
    assert.equal(listOutput.truncated, undefined);
    assert.equal(listOutput.continuation, undefined);
    assert.equal(listOutput.listingComplete, false);
    assert.equal(listOutput.entriesReturned, 1);
    assert.equal(Array.isArray(listOutput.entriesPreview), true);
    assert.equal(listOutput.hasMoreAfter, true);
    assert.equal(listOutput.nextOffset, undefined);
    assert.equal(listOutput.reachedOffsetCeiling, true);
    assert.equal(listOutput.offsetCeiling, 10_000);

    const searched = await center.execute(
      {
        callId: "call:search-project-ceiling",
        toolName: "AttachmentSearchFiles",
        input: { attachmentId: "ctx_project", path: "search/matches.txt", query: "needle", limit: 80, offset: 10_000 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searchOutput = asRecord(searched.output);

    assert.equal(searched.status, "failed");
    assert.equal(searched.errorFacts?.code, "context_attachment_search_continuation_limit_reached");
    assert.equal(searched.errorFacts?.retryable, false);
    assert.equal(searchOutput.truncated, undefined);
    assert.equal(searchOutput.continuation, undefined);
    assert.equal(searchOutput.searchComplete, false);
    assert.equal(searchOutput.matchesReturned, 80);
    assert.equal(Array.isArray(searchOutput.matchesPreview), true);
    assert.equal(searchOutput.hasMoreAfter, true);
    assert.equal(searchOutput.nextOffset, undefined);
    assert.equal(searchOutput.reachedOffsetCeiling, true);
    assert.equal(searchOutput.offsetCeiling, 10_000);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("context attachment tools reject refs outside current Task Soil permissions", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-local-"));
  const localFile = path.join(localRoot, "notes.txt");
  await fs.writeFile(localFile, "private text", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_denied",
          ref: `local-file:${localFile}`,
          kind: "file",
          title: "notes.txt",
          metadata: { available: true, mimeType: "text/plain" },
        },
      ],
      permissionBoundaryRefs: [],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const result = await center.execute(
      {
        callId: "call:denied",
        toolName: "AttachmentRead",
        input: { attachmentId: "ctx_denied" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["AttachmentRead"],
      }
    );
    const modelVisible = JSON.stringify(result);

    assert.equal(result.status, "failed");
    assert.equal(modelVisible.includes("not authorized"), true);
    assert.equal(modelVisible.includes(localFile), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function assertDirectAttachmentFacts(value: unknown): void {
  const output = asRecord(value);
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `attachment executor output must not contain ${legacyField}`);
  }
}
