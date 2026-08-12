import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { createTaskSoil, type TaskSoil } from "../../../domain/soil/index.js";
import { ToolCenter } from "../../tool-center/tool-center.js";
import { createContextAttachmentTools } from "./context-attachment-tools.js";
import type { ContextAttachmentReadAuthorization } from "./context-attachment-access.js";

export const TOOL_CONTEXT = {
  callerAgentId: "agent:test",
  traceId: "trace:test",
  goalId: "goal:test",
};
export function contextAttachmentToolCenter(input: {
  readonly taskSoil: TaskSoil;
  readonly workspaceRoot: string;
  readonly supportsVisionInput?: boolean;
  readonly resolveManagedAttachmentPath?: (attachmentId: string) => Promise<string | undefined>;
  readonly readAuthorization?: ContextAttachmentReadAuthorization;
}): ToolCenter {
  const center = new ToolCenter();
  for (const tool of createContextAttachmentTools(input)) {
    center.register(tool);
  }
  return center;
}

export function taskSoilWithContext(input: Pick<TaskSoil, "contextRefs" | "permissionBoundaryRefs">): TaskSoil {
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

export function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

export async function writeEmptyFiles(directory: string, count: number): Promise<void> {
  const batchSize = 200;
  for (let start = 0; start < count; start += batchSize) {
    const batchCount = Math.min(batchSize, count - start);
    await Promise.all(Array.from({ length: batchCount }, (_value, offset) => {
      const index = start + offset;
      return fs.writeFile(path.join(directory, `entry-${String(index).padStart(5, "0")}.txt`), "", "utf8");
    }));
  }
}

export function createTinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
}

export function createMinimalXlsxBuffer(): Buffer {
  return createZipBuffer({
    "[Content_Types].xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
      "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
      "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
      "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
      "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>",
      "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>",
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
      "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
      "</Relationships>",
    ].join(""),
    "xl/sharedStrings.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<si><t>region</t></si>",
      "<si><t>revenue</t></si>",
      "<si><t>active</t></si>",
      "<si><t>started</t></si>",
      "<si><t>optional</t></si>",
      "<si><t>north</t></si>",
      "<si><t>notes</t></si>",
      "</sst>",
    ].join(""),
    "xl/styles.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"yyyy-mm-dd\"/></numFmts>",
      "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\"/></cellStyleXfs>",
      "<cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"164\" applyNumberFormat=\"1\"/></cellXfs>",
      "</styleSheet>",
    ].join(""),
    "xl/worksheets/sheet1.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<sheetData>",
      "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c><c r=\"C1\" t=\"s\"><v>2</v></c><c r=\"D1\" t=\"s\"><v>3</v></c><c r=\"E1\" t=\"s\"><v>4</v></c></row>",
      "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>5</v></c><c r=\"B2\"><v>1200</v></c><c r=\"C2\" t=\"b\"><v>1</v></c><c r=\"D2\" s=\"1\"><v>45292</v></c></row>",
      ...Array.from({ length: 203 }, (_value, index) => {
        const rowNumber = index + 3;
        return `<row r=\"${rowNumber}\"><c r=\"A${rowNumber}\" t=\"s\"><v>5</v></c><c r=\"B${rowNumber}\"><v>${rowNumber}</v></c></row>`;
      }),
      "</sheetData>",
      "</worksheet>",
    ].join(""),
    "xl/worksheets/sheet2.xml": [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
      "<sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>6</v></c></row></sheetData>",
      "</worksheet>",
    ].join(""),
  });
}

export function createTextPdfBuffer(lines: readonly string[]): Buffer {
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
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(source, "latin1"));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, "latin1");
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "latin1");
}

function pdfLiteral(value: string): string {
  return `(${value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

export function createZipBuffer(entries: Readonly<Record<string, string>>): Buffer {
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