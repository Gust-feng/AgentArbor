import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeToolFactValue } from "../../../domain/tools/index.js";
import {
  asRecord,
  contextAttachmentToolCenter,
  createMinimalXlsxBuffer,
  createZipBuffer,
  taskSoilWithContext,
  TOOL_CONTEXT,
} from "./context-attachment-test-support.js";
test("context attachment table tools inspect and read selected CSV without exposing local paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-table-"));
  const csvFile = path.join(localRoot, "sales.csv");
  const content = [
    "region,revenue,notes",
    "north,1200,\"large, quoted\"",
    "south,900,steady",
    "",
  ].join("\n");
  await fs.writeFile(csvFile, content, "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_sales_csv",
          ref: `local-file:${csvFile}`,
          kind: "file",
          title: "sales.csv",
          summary: "Selected CSV table.",
          metadata: {
            byteLength: Buffer.byteLength(content),
            mimeType: "text/csv",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${csvFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "list_context_attachments",
        "inspect_context_attachment_table",
        "read_context_attachment_table",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-table",
        toolName: "list_context_attachments",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const inspected = await center.execute(
      {
        callId: "call:inspect-table",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_sales_csv", sampleRows: 2 },
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-table",
        toolName: "read_context_attachment_table",
        input: { attachmentId: "ctx_sales_csv", startRow: 2, rowCount: 1 },
      },
      TOOL_CONTEXT,
      permission
    );
    const projected = JSON.stringify([listed.output, inspected.output, read.output]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    assert.equal(read.status, "completed");
    assertDirectAttachmentFacts(inspected.output);
    assertDirectAttachmentFacts(read.output);
    assert.equal(projected.includes("\"format\":\"table\""), true);
    assert.equal(projected.includes("\"canReadTable\":true"), true);
    assert.equal(projected.includes("region"), true);
    assert.equal(projected.includes("revenue"), true);
    assert.equal(projected.includes("large, quoted"), true);
    assert.equal(projected.includes(csvFile), false);
    assert.equal(projected.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    await fs.rm(localRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("context attachment table read returns executable row continuation facts", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-table-continuation-"));
  await fs.mkdir(path.join(projectRoot, "data"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "data", "sales.csv"),
    "region,revenue\nnorth,1200\nsouth,800\nwest,900\n",
    "utf8"
  );
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project_table",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "table-project",
          metadata: { available: true },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["read_context_attachment_table"],
    };

    const firstRead = await center.execute(
      {
        callId: "call:read-table-continuation-1",
        toolName: "read_context_attachment_table",
        input: { attachmentId: "ctx_project_table", path: "data/sales.csv", startRow: 2, rowCount: 1, headerRow: true },
      },
      TOOL_CONTEXT,
      permission
    );
    const output = asRecord(firstRead.output);
    const continuation = asRecord(output.continuation);
    const nextInput = asRecord(continuation.nextInput);

    assert.equal(firstRead.status, "completed");
    assert.equal(output.truncated, true);
    assert.equal(output.hasMoreAfter, true);
    assert.equal(output.nextStartRow, undefined);
    assert.equal(output.rowCount, 1);
    assert.equal(output.path, "data/sales.csv");
    assert.equal(output.headerRow, true);
    assert.equal(nextInput.attachmentId, "ctx_project_table");
    assert.equal(nextInput.path, "data/sales.csv");
    assert.equal(nextInput.startRow, 3);
    assert.equal(nextInput.rowCount, 1);
    assert.equal(nextInput.headerRow, true);
    assertDirectAttachmentFacts(output);

    const secondRead = await center.execute(
      {
        callId: "call:read-table-continuation-2",
        toolName: "read_context_attachment_table",
        input: normalizeToolFactValue(nextInput),
      },
      TOOL_CONTEXT,
      permission
    );
    const secondRows = asRecord(secondRead.output).rows as readonly unknown[];

    assert.equal(secondRead.status, "completed");
    assert.equal(asRecord(secondRows[0]).rowNumber, 3);
    assert.equal((asRecord(secondRows[0]).values as readonly unknown[])[0], "south");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

function assertDirectAttachmentFacts(value: unknown): void {
  const output = asRecord(value);
  for (const legacyField of ["action", "status", "summary", "result"]) {
    assert.equal(legacyField in output, false, `attachment executor output must not contain ${legacyField}`);
  }
}

test("context attachment table tools read TSV inside selected local project", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-table-project-"));
  await fs.mkdir(path.join(projectRoot, "data"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "data", "metrics.tsv"), "name\tvalue\nalpha\t42\n", "utf8");
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_project_table",
          ref: `local-project:${projectRoot}`,
          kind: "project",
          title: "table-project",
          metadata: { available: true },
        },
      ],
      permissionBoundaryRefs: [`read:local-project:${projectRoot}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const result = await center.execute(
      {
        callId: "call:read-tsv",
        toolName: "read_context_attachment_table",
        input: { attachmentId: "ctx_project_table", path: "data/metrics.tsv", startRow: 2 },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["read_context_attachment_table"],
      }
    );
    const modelVisible = JSON.stringify(result.output);

    assert.equal(result.status, "completed");
    assert.equal(modelVisible.includes("tab"), true);
    assert.equal(modelVisible.includes("alpha"), true);
    assert.equal(modelVisible.includes("42"), true);
    assert.equal(modelVisible.includes(projectRoot), false);
    assert.equal(modelVisible.includes("local-project:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context attachment table tools inspect and read selected XLSX workbook without exposing local paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-xlsx-"));
  const xlsxFile = path.join(localRoot, "workbook.xlsx");
  const workbook = createMinimalXlsxBuffer();
  await fs.writeFile(xlsxFile, workbook);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_workbook",
          ref: `local-file:${xlsxFile}`,
          kind: "file",
          title: "workbook.xlsx",
          metadata: {
            byteLength: workbook.length,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${xlsxFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "list_context_attachments",
        "inspect_context_attachment_table",
        "read_context_attachment_table",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-xlsx",
        toolName: "list_context_attachments",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const inspected = await center.execute(
      {
        callId: "call:inspect-xlsx",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_workbook", sheetName: "Sales", sampleRows: 1 },
      },
      TOOL_CONTEXT,
      permission
    );
    const read = await center.execute(
      {
        callId: "call:read-xlsx",
        toolName: "read_context_attachment_table",
        input: { attachmentId: "ctx_workbook", sheetIndex: 1, startRow: 2, rowCount: 1 },
      },
      TOOL_CONTEXT,
      permission
    );
    const notes = await center.execute(
      {
        callId: "call:inspect-xlsx-notes",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_workbook", sheetName: "notes", sampleRows: 1 },
      },
      TOOL_CONTEXT,
      permission,
    );
    const bounded = await center.execute(
      {
        callId: "call:read-xlsx-bounded",
        toolName: "read_context_attachment_table",
        input: { attachmentId: "ctx_workbook", sheetName: "Sales", startRow: 2, rowCount: 999 },
      },
      TOOL_CONTEXT,
      permission,
    );
    const modelVisible = JSON.stringify([listed.output, inspected.output, read.output, notes.output, bounded.output]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    assert.equal(read.status, "completed");
    assert.equal(notes.status, "completed");
    assert.equal(bounded.status, "completed");
    assert.equal(modelVisible.includes("\"format\":\"spreadsheet\""), true);
    assert.equal(modelVisible.includes("\"canReadTable\":true"), true);
    assert.equal(modelVisible.includes("\"format\":\"xlsx\""), true);
    assert.equal(modelVisible.includes("\"sheetName\":\"Sales\""), true);
    assert.equal(modelVisible.includes("\"sheets\":[\"Sales\",\"Notes\"]"), true);
    assert.equal(asRecord(notes.output).sheetName, "Notes");
    assert.equal(modelVisible.includes("north"), true);
    assert.equal(modelVisible.includes("1200"), true);
    assert.equal(modelVisible.includes("\"active\":\"TRUE\""), true);
    assert.equal(modelVisible.includes("\"started\":\"2024-01-01T00:00:00.000Z\""), true);
    assert.equal(modelVisible.includes("\"optional\":\"\""), true);
    assert.equal(asRecord(bounded.output).rowsReturned, 200);
    assert.equal(asRecord(bounded.output).truncated, true);
    assert.equal(modelVisible.includes(xlsxFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});

test("context attachment XLSX reads fail explicitly for corruption, cancellation, and size limits", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-xlsx-failures-"));
  const validFile = path.join(localRoot, "valid.xlsx");
  const corruptFile = path.join(localRoot, "corrupt.xlsx");
  const largeFile = path.join(localRoot, "large.xlsx");
  await fs.writeFile(validFile, createMinimalXlsxBuffer());
  await fs.writeFile(corruptFile, "not an xlsx archive", "utf8");
  await fs.writeFile(largeFile, Buffer.alloc(8 * 1024 * 1024 + 1));
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [validFile, corruptFile, largeFile].map((file, index) => ({
        attachmentId: ["ctx_valid_xlsx", "ctx_corrupt_xlsx", "ctx_large_xlsx"][index],
        ref: `local-file:${file}`,
        kind: "file" as const,
        title: path.basename(file),
        metadata: {
          byteLength: index === 2 ? 8 * 1024 * 1024 + 1 : undefined,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          available: true,
        },
      })),
      permissionBoundaryRefs: [validFile, corruptFile, largeFile].map((file) => `read:local-file:${file}`),
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: ["inspect_context_attachment_table"],
    };

    const corrupt = await center.execute(
      {
        callId: "call:inspect-corrupt-xlsx",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_corrupt_xlsx" },
      },
      TOOL_CONTEXT,
      permission,
    );
    const tooLarge = await center.execute(
      {
        callId: "call:inspect-large-xlsx",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_large_xlsx" },
      },
      TOOL_CONTEXT,
      permission,
    );
    const controller = new AbortController();
    controller.abort();
    const cancelled = await center.execute(
      {
        callId: "call:inspect-cancelled-xlsx",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_valid_xlsx" },
      },
      { ...TOOL_CONTEXT, abortSignal: controller.signal },
      permission,
    );

    assert.equal(corrupt.status, "completed");
    assert.equal(asRecord(corrupt.output).reason, "xlsx_parse_failed");
    assert.equal(tooLarge.status, "completed");
    assert.equal(asRecord(tooLarge.output).reason, "spreadsheet_file_too_large");
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});

test("context attachment table tools report unsupported legacy XLS spreadsheet formats", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-xls-"));
  const xlsFile = path.join(localRoot, "workbook.xls");
  await fs.writeFile(xlsFile, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_workbook",
          ref: `local-file:${xlsFile}`,
          kind: "file",
          title: "workbook.xls",
          metadata: {
            byteLength: 4,
            mimeType: "application/vnd.ms-excel",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${xlsFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const result = await center.execute(
      {
        callId: "call:inspect-xlsx",
        toolName: "inspect_context_attachment_table",
        input: { attachmentId: "ctx_workbook" },
      },
      TOOL_CONTEXT,
      {
        callerAgentId: TOOL_CONTEXT.callerAgentId,
        allowedTools: ["inspect_context_attachment_table"],
      }
    );
    const modelVisible = JSON.stringify(result.output);

    assert.equal(result.status, "completed");
    assert.equal(modelVisible.includes("\"table\":false"), true);
    assert.equal(modelVisible.includes("unsupported_legacy_spreadsheet"), true);
    assert.equal(modelVisible.includes(xlsFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});
