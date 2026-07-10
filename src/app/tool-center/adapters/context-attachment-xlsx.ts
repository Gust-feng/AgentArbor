import { promises as fs } from "node:fs";
import path from "node:path";
import { positiveInteger } from "./local-workspace-common.js";
import {
  normalizeZipEntryName,
  readZipEntries,
  readZipTextEntry,
} from "./context-attachment-zip.js";

export type ParsedTableRow = {
  readonly rowNumber: number;
  readonly cells: readonly string[];
};

export type ParsedSpreadsheetTable = {
  readonly kind: "xlsx";
  readonly sheetName: string;
  readonly sheetIndex: number;
  readonly sheets: readonly string[];
  readonly rows: readonly ParsedTableRow[];
};

type XlsxSheet = {
  readonly name: string;
  readonly relationshipId: string;
  readonly path: string;
};
export async function readXlsxTable(
  absolutePath: string,
  options: { readonly sheetName?: string; readonly sheetIndex?: number }
): Promise<
  | { readonly supported: true; readonly table: ParsedSpreadsheetTable }
  | { readonly supported: false; readonly reason: string }
> {
  const buffer = await fs.readFile(absolutePath).catch(() => undefined);
  if (buffer === undefined) {
    return { supported: false, reason: "spreadsheet_file_unreadable" };
  }
  const entries = readZipEntries(buffer);
  const byName = new Map(entries.map((entry) => [normalizeZipEntryName(entry.name), entry]));
  const workbookEntry = byName.get("xl/workbook.xml");
  const workbookRelsEntry = byName.get("xl/_rels/workbook.xml.rels");
  if (workbookEntry === undefined || workbookRelsEntry === undefined) {
    return { supported: false, reason: "xlsx_workbook_missing" };
  }
  const workbookXml = readZipTextEntry(buffer, workbookEntry);
  const workbookRelsXml = readZipTextEntry(buffer, workbookRelsEntry);
  const sheets = parseXlsxSheets(workbookXml, workbookRelsXml);
  if (sheets.length === 0) {
    return { supported: false, reason: "xlsx_no_sheets" };
  }
  const selected = selectXlsxSheet(sheets, options);
  if (selected === undefined) {
    return { supported: false, reason: "xlsx_sheet_not_found" };
  }
  const sheetEntry = byName.get(normalizeZipEntryName(selected.path));
  if (sheetEntry === undefined) {
    return { supported: false, reason: "xlsx_sheet_missing" };
  }
  const sharedStringsEntry = byName.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry === undefined
    ? []
    : parseXlsxSharedStrings(readZipTextEntry(buffer, sharedStringsEntry));
  const sheetXml = readZipTextEntry(buffer, sheetEntry);
  return {
    supported: true,
    table: {
      kind: "xlsx",
      sheetName: selected.name,
      sheetIndex: sheets.indexOf(selected) + 1,
      sheets: sheets.map((sheet) => sheet.name),
      rows: parseXlsxRows(sheetXml, sharedStrings),
    },
  };
}

export function xlsxReadErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]+$/u.test(message) ? message : "xlsx_parse_failed";
}

function parseXlsxSheets(workbookXml: string, workbookRelsXml: string): readonly XlsxSheet[] {
  const relationships = parseXlsxRelationships(workbookRelsXml);
  const sheets: XlsxSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/giu)) {
    const attributes = xmlAttributes(match[1] ?? "");
    const name = attributes.name;
    const relationshipId = attributes["r:id"];
    if (name === undefined || relationshipId === undefined) {
      continue;
    }
    const target = relationships.get(relationshipId);
    if (target === undefined) {
      continue;
    }
    sheets.push({
      name,
      relationshipId,
      path: resolveXlsxTargetPath(target),
    });
  }
  return sheets;
}

function parseXlsxRelationships(value: string): ReadonlyMap<string, string> {
  const relationships = new Map<string, string>();
  for (const match of value.matchAll(/<Relationship\b([^>]*)\/?>/giu)) {
    const attributes = xmlAttributes(match[1] ?? "");
    const id = attributes.Id;
    const target = attributes.Target;
    if (id !== undefined && target !== undefined) {
      relationships.set(id, target);
    }
  }
  return relationships;
}

function resolveXlsxTargetPath(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return normalizeZipEntryName(normalized);
  }
  const resolved = path.posix.normalize(path.posix.join("xl", normalized));
  if (resolved.startsWith("../") || resolved === "..") {
    throw new Error("xlsx_relationship_target_invalid");
  }
  return resolved;
}

function selectXlsxSheet(
  sheets: readonly XlsxSheet[],
  options: { readonly sheetName?: string; readonly sheetIndex?: number }
): XlsxSheet | undefined {
  if (options.sheetName !== undefined) {
    const normalizedName = options.sheetName.toLowerCase();
    return sheets.find((sheet) => sheet.name.toLowerCase() === normalizedName);
  }
  const index = options.sheetIndex === undefined ? 0 : options.sheetIndex - 1;
  return sheets[index];
}

function parseXlsxSharedStrings(value: string): readonly string[] {
  const strings: string[] = [];
  for (const match of value.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/giu)) {
    strings.push(xmlTextRuns(match[1] ?? ""));
  }
  return strings;
}

function parseXlsxRows(value: string, sharedStrings: readonly string[]): readonly ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  let fallbackRowNumber = 1;
  for (const rowMatch of value.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/giu)) {
    const rowAttributes = xmlAttributes(rowMatch[1] ?? "");
    const rowNumber = positiveInteger(Number(rowAttributes.r)) ?? fallbackRowNumber;
    const cells: string[] = [];
    let fallbackColumn = 1;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/giu)) {
      const attributes = xmlAttributes(cellMatch[1] ?? "");
      const column = columnNumberFromCellRef(attributes.r) ?? fallbackColumn;
      cells[column - 1] = xlsxCellValue(attributes, cellMatch[2] ?? "", sharedStrings);
      fallbackColumn = column + 1;
    }
    if (cells.some((cell) => (cell ?? "").length > 0)) {
      rows.push({
        rowNumber,
        cells: cells.map((cell) => cell ?? ""),
      });
    }
    fallbackRowNumber = rowNumber + 1;
  }
  return rows;
}

function xlsxCellValue(
  attributes: Readonly<Record<string, string>>,
  cellXml: string,
  sharedStrings: readonly string[]
): string {
  if (attributes.t === "inlineStr") {
    return xmlTextRuns(cellXml);
  }
  const rawValue = firstXmlText(cellXml, "v");
  if (rawValue === undefined) {
    return "";
  }
  if (attributes.t === "s") {
    const sharedIndex = Number(rawValue);
    return Number.isInteger(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "";
  }
  if (attributes.t === "b") {
    return rawValue === "1" ? "TRUE" : rawValue === "0" ? "FALSE" : rawValue;
  }
  return decodeXml(rawValue);
}

function xmlAttributes(value: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    const key = match[1];
    const raw = match[2] ?? match[3];
    if (key !== undefined && raw !== undefined) {
      attributes[key] = decodeXml(raw);
    }
  }
  return attributes;
}

function xmlTextRuns(value: string): string {
  const parts: string[] = [];
  for (const match of value.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/giu)) {
    parts.push(decodeXml(match[1] ?? ""));
  }
  return parts.join("");
}

function firstXmlText(value: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "iu");
  const match = pattern.exec(value);
  return match?.[1];
}

function columnNumberFromCellRef(value: string | undefined): number | undefined {
  const letters = /^([A-Z]+)/iu.exec(value ?? "")?.[1]?.toUpperCase();
  if (letters === undefined) {
    return undefined;
  }
  let result = 0;
  for (const char of letters) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }
  return result;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_match, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    if (entity.toLowerCase().startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return "";
  });
}
