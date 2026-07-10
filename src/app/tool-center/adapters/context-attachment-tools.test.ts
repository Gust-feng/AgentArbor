import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
        toolName: "read_context_attachment_text",
        input: { attachmentId: "ctx_local_file" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["read_context_attachment_text"],
      }
    );
    const modelVisible = JSON.stringify(result.projection?.agentContent);

    assert.equal(result.status, "completed");
    assert.equal(modelVisible.includes("attached local text"), true);
    assert.equal(modelVisible.includes("second line"), true);
    assert.equal(modelVisible.includes(localFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
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
      allowedTools: ["read_context_attachment_text"],
    };

    const firstRead = await center.execute(
      {
        callId: "call:read-text-window-1",
        toolName: "read_context_attachment_text",
        input: { attachmentId: "ctx_long_text", maxLength: 5 },
      },
      TOOL_CONTEXT,
      permission
    );
    const firstResult = asRecord(asRecord(firstRead.output).result);
    const firstNextInput = asRecord(asRecord(asRecord(firstRead.projection?.modelResult).continuation).nextInput);

    assert.equal(firstRead.status, "completed");
    assert.equal(firstResult.content, "abcd…");
    assert.equal(firstResult.startChar, 0);
    assert.equal(firstResult.textChars, 4);
    assert.equal(firstResult.charCount, 10);
    assert.equal(firstResult.nextStartChar, 4);
    assert.equal(firstNextInput.attachmentId, "ctx_long_text");
    assert.equal(firstNextInput.maxLength, 5);
    assert.equal(firstNextInput.startChar, 4);

    const secondRead = await center.execute(
      {
        callId: "call:read-text-window-2",
        toolName: "read_context_attachment_text",
        input: firstNextInput,
      },
      TOOL_CONTEXT,
      permission
    );
    const secondResult = asRecord(asRecord(secondRead.output).result);
    assert.equal(secondResult.content, "efgh…");
    assert.equal(secondResult.startChar, 4);
    assert.equal(secondResult.nextStartChar, 8);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
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
        toolName: "read_context_attachment_text",
        input: { attachmentId: "ctx_long_lines", startLine: 1, endLine: 2, maxLength: 5 },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["read_context_attachment_text"],
      }
    );

    assert.equal(result.status, "failed");
    assert.match(String(result.error), /cannot combine maxLength with startLine\/endLine/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});

test("context attachment PDF tool extracts text-native PDF content without exposing local paths", async () => {
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
        "list_context_attachments",
        "read_context_attachment_pdf_text",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-pdf",
        toolName: "list_context_attachments",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-pdf",
        toolName: "read_context_attachment_pdf_text",
        input: { attachmentId: "ctx_report_pdf" },
      },
      TOOL_CONTEXT,
      permission
    );
    const modelVisible = JSON.stringify([
      listed.projection?.agentContent,
      read.projection?.agentContent,
    ]);

    assert.equal(listed.status, "completed");
    assert.equal(read.status, "completed");
    assert.equal(modelVisible.includes("\"format\":\"pdf\""), true);
    assert.equal(modelVisible.includes("\"canReadPdfText\":true"), true);
    assert.equal(modelVisible.includes("Quarterly report"), true);
    assert.equal(modelVisible.includes("Revenue is 1200"), true);
    assert.equal(modelVisible.includes(pdfFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
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
        "list_context_attachment_files",
        "search_context_attachment_files",
        "read_context_attachment_text",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-project",
        toolName: "list_context_attachment_files",
        input: { attachmentId: "ctx_project", depth: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searched = await center.execute(
      {
        callId: "call:search-project",
        toolName: "search_context_attachment_files",
        input: { attachmentId: "ctx_project", query: "needle" },
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-project-file",
        toolName: "read_context_attachment_text",
        input: { attachmentId: "ctx_project", path: "src/index.ts" },
      },
      TOOL_CONTEXT,
      permission
    );
    const projected = JSON.stringify([
      listed.projection?.agentContent,
      searched.projection?.agentContent,
      read.projection?.agentContent,
    ]);

    assert.equal(listed.status, "completed");
    assert.equal(searched.status, "completed");
    assert.equal(read.status, "completed");
    assert.equal(projected.includes("src/index.ts"), true);
    assert.equal(projected.includes("needle"), true);
    assert.equal(projected.includes(projectRoot), false);
    assert.equal(projected.includes("local-project:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
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
      allowedTools: ["list_context_attachment_files", "search_context_attachment_files"],
    };

    const listed = await center.execute(
      {
        callId: "call:list-project-continuation",
        toolName: "list_context_attachment_files",
        input: { attachmentId: "ctx_project", path: "src", depth: 1, limit: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const listModelResult = asRecord(listed.projection?.modelResult);
    const listNextInput = asRecord(asRecord(listModelResult.continuation).nextInput);
    const listAgentContent = asRecord(listed.projection?.agentContent);

    assert.equal(listed.status, "completed");
    assert.equal(asRecord(listModelResult.truncation).truncated, true);
    assert.equal(listNextInput.attachmentId, "ctx_project");
    assert.equal(listNextInput.path, "src");
    assert.equal(listNextInput.offset, 2);
    assert.equal(asRecord(asRecord(listAgentContent.continuation).nextInput).offset, 2);

    const secondListed = await center.execute(
      {
        callId: "call:list-project-continuation-2",
        toolName: "list_context_attachment_files",
        input: listNextInput,
      },
      TOOL_CONTEXT,
      permission
    );
    const secondListResult = asRecord(asRecord(secondListed.output).result);
    assert.equal(secondListed.status, "completed");
    assert.equal(secondListResult.offset, 2);
    assert.equal(secondListResult.nextOffset, 4);
    assert.equal(Array.isArray(secondListResult.entries), true);
    assert.equal(asRecord((secondListResult.entries as readonly unknown[])[0]).path, "src/note-3.txt");

    const searched = await center.execute(
      {
        callId: "call:search-project-continuation",
        toolName: "search_context_attachment_files",
        input: { attachmentId: "ctx_project", query: "needle", path: "src", limit: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searchModelResult = asRecord(searched.projection?.modelResult);
    const searchNextInput = asRecord(asRecord(searchModelResult.continuation).nextInput);
    const searchAgentContent = asRecord(searched.projection?.agentContent);

    assert.equal(searched.status, "completed");
    assert.equal(asRecord(searchModelResult.truncation).truncated, true);
    assert.equal(searchNextInput.attachmentId, "ctx_project");
    assert.equal(searchNextInput.query, "needle");
    assert.equal(searchNextInput.path, "src");
    assert.equal(searchNextInput.offset, 2);
    assert.equal(asRecord(asRecord(searchAgentContent.continuation).nextInput).offset, 2);

    const secondSearched = await center.execute(
      {
        callId: "call:search-project-continuation-2",
        toolName: "search_context_attachment_files",
        input: searchNextInput,
      },
      TOOL_CONTEXT,
      permission
    );
    const secondSearchResult = asRecord(asRecord(secondSearched.output).result);
    assert.equal(secondSearched.status, "completed");
    assert.equal(secondSearchResult.offset, 2);
    assert.equal(secondSearchResult.nextOffset, 4);
    assert.equal(Array.isArray(secondSearchResult.matches), true);
    assert.equal(asRecord((secondSearchResult.matches as readonly unknown[])[0]).path, "src/note-3.txt");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context attachment list and search tools stop continuation at the offset ceiling", async () => {
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
      allowedTools: ["list_context_attachment_files", "search_context_attachment_files"],
    };

    const listed = await center.execute(
      {
        callId: "call:list-project-ceiling",
        toolName: "list_context_attachment_files",
        input: { attachmentId: "ctx_project", path: "listing", depth: 1, limit: 1, offset: 10_000 },
      },
      TOOL_CONTEXT,
      permission
    );
    const listOutput = asRecord(listed.output);
    const listResult = asRecord(listOutput.result);
    const listModelResult = asRecord(listed.projection?.modelResult);
    const listStructuredContent = asRecord(listModelResult.structuredContent);
    const listAgentContent = asRecord(listed.projection?.agentContent);

    assert.equal(listed.status, "completed");
    assert.equal(listOutput.truncated, true);
    assert.equal(listResult.entriesReturned, 1);
    assert.equal(listResult.hasMoreAfter, true);
    assert.equal(listResult.nextOffset, undefined);
    assert.equal(listResult.reachedOffsetCeiling, true);
    assert.equal(listResult.offsetCeiling, 10_000);
    assert.equal(listModelResult.continuation, undefined);
    assert.equal(asRecord(listModelResult.truncation).truncated, true);
    assert.equal(listStructuredContent.hasMoreAfter, true);
    assert.equal(listStructuredContent.nextOffset, undefined);
    assert.equal(listStructuredContent.reachedOffsetCeiling, true);
    assert.equal(listStructuredContent.offsetCeiling, 10_000);
    assert.equal(listStructuredContent.truncated, true);
    assert.equal(listAgentContent.hasMoreAfter, true);
    assert.equal(listAgentContent.nextOffset, undefined);
    assert.equal(listAgentContent.reachedOffsetCeiling, true);
    assert.equal(listAgentContent.offsetCeiling, 10_000);
    assert.equal(listAgentContent.continuation, undefined);

    const searched = await center.execute(
      {
        callId: "call:search-project-ceiling",
        toolName: "search_context_attachment_files",
        input: { attachmentId: "ctx_project", path: "search/matches.txt", query: "needle", limit: 80, offset: 10_000 },
      },
      TOOL_CONTEXT,
      permission
    );
    const searchOutput = asRecord(searched.output);
    const searchResult = asRecord(searchOutput.result);
    const searchModelResult = asRecord(searched.projection?.modelResult);
    const searchStructuredContent = asRecord(searchModelResult.structuredContent);
    const searchAgentContent = asRecord(searched.projection?.agentContent);

    assert.equal(searched.status, "completed");
    assert.equal(searchOutput.truncated, true);
    assert.equal(searchResult.matchesReturned, 80);
    assert.equal(searchResult.hasMoreAfter, true);
    assert.equal(searchResult.nextOffset, undefined);
    assert.equal(searchResult.reachedOffsetCeiling, true);
    assert.equal(searchResult.offsetCeiling, 10_000);
    assert.equal(searchModelResult.continuation, undefined);
    assert.equal(asRecord(searchModelResult.truncation).truncated, true);
    assert.equal(searchStructuredContent.hasMoreAfter, true);
    assert.equal(searchStructuredContent.nextOffset, undefined);
    assert.equal(searchStructuredContent.reachedOffsetCeiling, true);
    assert.equal(searchStructuredContent.offsetCeiling, 10_000);
    assert.equal(searchStructuredContent.truncated, true);
    assert.equal(searchAgentContent.hasMoreAfter, true);
    assert.equal(searchAgentContent.nextOffset, undefined);
    assert.equal(searchAgentContent.reachedOffsetCeiling, true);
    assert.equal(searchAgentContent.offsetCeiling, 10_000);
    assert.equal(searchAgentContent.continuation, undefined);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
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
        toolName: "read_context_attachment_text",
        input: { attachmentId: "ctx_denied" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["read_context_attachment_text"],
      }
    );
    const modelVisible = JSON.stringify(result.projection?.agentContent);

    assert.equal(result.status, "failed");
    assert.equal(modelVisible.includes("not authorized"), true);
    assert.equal(modelVisible.includes(localFile), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});
