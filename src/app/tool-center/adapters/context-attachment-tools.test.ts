import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { createTaskSoil, type TaskSoil } from "../../../domain/soil/index.js";
import { ToolCenter } from "../../tool-center/tool-center.js";
import { createContextAttachmentTools } from "./context-attachment-tools.js";

const TOOL_CONTEXT = {
  callerAgentId: "agent:test",
  traceId: "trace:test",
  goalId: "goal:test",
};

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
    const projected = JSON.stringify([
      listed.projection?.agentContent,
      inspected.projection?.agentContent,
      read.projection?.agentContent,
    ]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    assert.equal(read.status, "completed");
    assert.equal(projected.includes("\"format\":\"table\""), true);
    assert.equal(projected.includes("\"canReadTable\":true"), true);
    assert.equal(projected.includes("region"), true);
    assert.equal(projected.includes("revenue"), true);
    assert.equal(projected.includes("large, quoted"), true);
    assert.equal(projected.includes(csvFile), false);
    assert.equal(projected.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});

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
    const modelVisible = JSON.stringify(result.projection?.agentContent);

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
    const modelVisible = JSON.stringify([
      listed.projection?.agentContent,
      inspected.projection?.agentContent,
      read.projection?.agentContent,
    ]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    assert.equal(read.status, "completed");
    assert.equal(modelVisible.includes("\"format\":\"spreadsheet\""), true);
    assert.equal(modelVisible.includes("\"canReadTable\":true"), true);
    assert.equal(modelVisible.includes("\"format\":\"xlsx\""), true);
    assert.equal(modelVisible.includes("\"sheetName\":\"Sales\""), true);
    assert.equal(modelVisible.includes("\"sheets\":[\"Sales\",\"Notes\"]"), true);
    assert.equal(modelVisible.includes("north"), true);
    assert.equal(modelVisible.includes("1200"), true);
    assert.equal(modelVisible.includes(xlsxFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(localRoot, { recursive: true, force: true });
  }
});

test("context attachment archive tools inspect selected ZIP without extracting or exposing local paths", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-workspace-"));
  const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ctx-zip-"));
  const zipFile = path.join(localRoot, "project.zip");
  const archive = createZipBuffer({
    "README.md": "# Demo\n",
    "src/index.ts": "export const answer = 42;\n",
    "../unsafe.txt": "bad path",
  });
  await fs.writeFile(zipFile, archive);
  try {
    const taskSoil = taskSoilWithContext({
      contextRefs: [
        {
          attachmentId: "ctx_archive",
          ref: `local-file:${zipFile}`,
          kind: "file",
          title: "project.zip",
          metadata: {
            byteLength: archive.length,
            mimeType: "application/zip",
            available: true,
          },
        },
      ],
      permissionBoundaryRefs: [`read:local-file:${zipFile}`],
    });
    const center = contextAttachmentToolCenter({ taskSoil, workspaceRoot: workspace });
    const permission = {
      callerAgentId: TOOL_CONTEXT.callerAgentId,
      allowedTools: [
        "list_context_attachments",
        "inspect_context_attachment_archive",
      ],
    };
    const listed = await center.execute(
      {
        callId: "call:list-zip",
        toolName: "list_context_attachments",
        input: {},
      },
      TOOL_CONTEXT,
      permission
    );
    const inspected = await center.execute(
      {
        callId: "call:inspect-zip",
        toolName: "inspect_context_attachment_archive",
        input: { attachmentId: "ctx_archive" },
      },
      TOOL_CONTEXT,
      permission
    );
    const modelVisible = JSON.stringify([
      listed.projection?.agentContent,
      inspected.projection?.agentContent,
    ]);

    assert.equal(listed.status, "completed");
    assert.equal(inspected.status, "completed");
    assert.equal(modelVisible.includes("\"format\":\"archive\""), true);
    assert.equal(modelVisible.includes("\"canInspectArchive\":true"), true);
    assert.equal(modelVisible.includes("\"archive\":true"), true);
    assert.equal(modelVisible.includes("\"format\":\"zip\""), true);
    assert.equal(modelVisible.includes("src/index.ts"), true);
    assert.equal(modelVisible.includes("\"unsafePath\":true"), true);
    assert.equal(modelVisible.includes(zipFile), false);
    assert.equal(modelVisible.includes("local-file:"), false);
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
    const modelVisible = JSON.stringify(result.projection?.agentContent);

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

function contextAttachmentToolCenter(input: {
  readonly taskSoil: TaskSoil;
  readonly workspaceRoot: string;
}): ToolCenter {
  const center = new ToolCenter();
  for (const tool of createContextAttachmentTools(input)) {
    center.register(tool);
  }
  return center;
}

function taskSoilWithContext(input: Pick<TaskSoil, "contextRefs" | "permissionBoundaryRefs">): TaskSoil {
  return createTaskSoil({
    rawGoal: "Use context attachments.",
    taskSoilId: "task-soil:test",
    goalId: "goal-test",
    traceId: "trace-test",
    contextRefs: input.contextRefs,
    permissionBoundaryRefs: input.permissionBoundaryRefs,
    createdAt: "2026-06-27T00:00:00.000Z",
  });
}

function createMinimalXlsxBuffer(): Buffer {
  return createZipBuffer({
    "[Content_Types].xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
      "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
      "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
      "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
      "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>",
      "</Types>",
    ].join(""),
    "xl/workbook.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
      "<sheets>",
      "<sheet name=\"Sales\" sheetId=\"1\" r:id=\"rId1\"/>",
      "<sheet name=\"Notes\" sheetId=\"2\" r:id=\"rId2\"/>",
      "</sheets>",
      "</workbook>",
    ].join(""),
    "xl/_rels/workbook.xml.rels": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>",
      "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>",
      "</Relationships>",
    ].join(""),
    "xl/sharedStrings.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<si><t>region</t></si>",
      "<si><t>revenue</t></si>",
      "<si><t>north</t></si>",
      "<si><t>notes</t></si>",
      "</sst>",
    ].join(""),
    "xl/worksheets/sheet1.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<sheetData>",
      "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>",
      "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><v>1200</v></c></row>",
      "</sheetData>",
      "</worksheet>",
    ].join(""),
    "xl/worksheets/sheet2.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>3</v></c></row></sheetData>",
      "</worksheet>",
    ].join(""),
  });
}

function createTextPdfBuffer(lines: readonly string[]): Buffer {
  const textOperators = lines
    .map((line, index) => `${index === 0 ? "" : "T* "}${pdfLiteral(line)} Tj`)
    .join("\n");
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    textOperators,
    "ET",
  ].join("\n");
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj",
    "<< /Length " + Buffer.byteLength(stream, "latin1") + " >>",
    "stream",
    stream,
    "endstream",
    "endobj",
    "%%EOF",
    "",
  ].join("\n"), "latin1");
}

function pdfLiteral(value: string): string {
  return `(${value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

function createZipBuffer(entries: Readonly<Record<string, string>>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const compressed = deflateRawSync(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
