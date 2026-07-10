import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type { TaskSoilContextRef } from "../../../domain/soil/index.js";
import type { ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  isLikelyBinaryPath,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
  positiveInteger,
  safeRefToken,
  stringOrFallback,
  throwIfAborted,
  truncateText,
} from "./local-workspace-common.js";
import {
  boundedContinuationOffset,
  createSearchFacts,
  DEFAULT_LIST_DEPTH,
  fileHasNulByte,
  listDirectoryTree,
  MAX_LIST_DEPTH,
  MAX_LIST_ENTRIES,
  MAX_LIST_OFFSET,
  MAX_SEARCH_MATCHES,
  MAX_SEARCH_OFFSET,
  searchPath,
  type SearchMatch,
} from "./context-attachment-files.js";
import { extractPdfText } from "./context-attachment-pdf.js";
import {
  charWindowContent,
  parseLineRange,
  readAttachmentTextFile,
  readLineRange,
  returnedRawTextChars,
  sliceLines,
} from "./context-attachment-text.js";
import {
  archiveTargetExtension,
  assertAttachmentAuthorized,
  attachmentEntries,
  attachmentSummary,
  attachmentTitle,
  isSupportedSpreadsheetRef,
  isSupportedSpreadsheetTarget,
  requireAttachmentEntry,
  resolveAttachmentTarget,
  statAttachmentTarget,
  tableTargetExtension,
  tableTargetFormat,
  type AttachmentEntry,
  type AttachmentTarget,
  type ContextAttachmentToolOptions,
} from "./context-attachment-access.js";
import { createReadContextAttachmentImageTool } from "./context-attachment-image.js";

export type { ContextAttachmentToolOptions } from "./context-attachment-access.js";

const DEFAULT_MAX_CHARS = 128_000;
const MAX_TABLE_SAMPLE_ROWS = 20;
const DEFAULT_TABLE_SAMPLE_ROWS = 5;
const MAX_TABLE_READ_ROWS = 200;
const DEFAULT_TABLE_READ_ROWS = 50;
const MAX_TABLE_CELL_CHARS = 500;
const MAX_SPREADSHEET_BYTES = 8 * 1024 * 1024;
const MAX_SPREADSHEET_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_ARCHIVE_LIST_ENTRIES = 200;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const DEFAULT_PDF_MAX_CHARS = 128_000;
type TableDelimiter = {
  readonly kind: "comma" | "tab" | "semicolon";
  readonly char: "," | "\t" | ";";
};

type ParsedDelimitedTable = {
  readonly kind: "delimited";
  readonly delimiter: TableDelimiter;
  readonly rows: readonly ParsedTableRow[];
};

type ParsedSpreadsheetTable = {
  readonly kind: "xlsx";
  readonly sheetName: string;
  readonly sheetIndex: number;
  readonly sheets: readonly string[];
  readonly rows: readonly ParsedTableRow[];
};

type ParsedAttachmentTable = ParsedDelimitedTable | ParsedSpreadsheetTable;

type ParsedTableRow = {
  readonly rowNumber: number;
  readonly cells: readonly string[];
};

type ZipEntry = {
  readonly name: string;
  readonly flags: number;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

type XlsxSheet = {
  readonly name: string;
  readonly relationshipId: string;
  readonly path: string;
};

export function createContextAttachmentTools(options: ContextAttachmentToolOptions = {}): readonly ToolExecutor[] {
  return [
    createListContextAttachmentsTool(options),
    createReadContextAttachmentTextTool(options),
    createReadContextAttachmentPdfTextTool(options),
    createReadContextAttachmentImageTool(options),
    createInspectContextAttachmentTableTool(options),
    createReadContextAttachmentTableTool(options),
    createInspectContextAttachmentArchiveTool(options),
    createListContextAttachmentFilesTool(options),
    createSearchContextAttachmentFilesTool(options),
  ];
}

export function createListContextAttachmentsTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "list_context_attachments",
      description: "List user-provided context attachments available to this run without exposing local absolute paths.",
      modelContract: {
        usageNotes: [
          "List current Task Soil context attachments by attachmentId, kind, title, summary, MIME type, byte length, and available operations.",
          "Use before reading or searching an attachment when the attachmentId is unknown.",
          "This tool returns references and metadata only; it does not return file contents.",
          "Local absolute paths are intentionally not returned. Use attachmentId with the attachment tools instead.",
        ],
        outputNotes: [
          "result.attachments[] contains attachmentId, kind, title, summary, MIME type, byte length, authorization, and supported operations.",
          "result.count is the number of returned attachments.",
          "Attachments with authorized=false cannot be read by attachment tools in this run.",
        ],
        runtimeHints: [
          { label: "source", value: "current Task Soil contextRefs" },
        ],
        examples: [
          { title: "List available attachments", input: {} },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute: async (_input, context) => {
      throwIfAborted(context.abortSignal);
      const attachments = attachmentEntries(options.taskSoil).map((entry) => attachmentSummary(entry));
      return {
        action: "list_context_attachments",
        status: "completed",
        refId: "context-attachments:index",
        summary: `${attachments.length} context attachments available by reference.`,
        result: {
          count: attachments.length,
          attachments,
        },
        display: {
          kind: "generic_tool_summary",
          action: "list_context_attachments",
          summary: `${attachments.length} context attachments available by reference.`,
          items: attachments.slice(0, 12).map((attachment) =>
            [
              attachment.attachmentId,
              attachment.kind,
              attachment.title,
              attachment.mimeType,
              attachment.byteLength === undefined ? undefined : `${attachment.byteLength} bytes`,
            ].filter(isString).join(" · ")
          ),
        },
      };
    },
  };
}

export function createReadContextAttachmentTextTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "read_context_attachment_text",
      description: "Read a text file attachment, or a focused text file inside an attached project, using attachmentId instead of a local path.",
      modelContract: {
        usageNotes: [
          "Read textual content from a current context attachment selected by attachmentId or ref.",
          "For file attachments, omit path. For project attachments, path is required and must be relative to the attached project root.",
          "Use startLine/endLine to inspect a focused range or continue through a large file.",
          "Use startChar to continue a character-window read when result.nextStartChar is present.",
          "maxLength applies to whole-file/startChar reads; do not combine maxLength with startLine/endLine.",
          "Do not use for images, PDFs, archives, spreadsheets, or binary files; the tool will return non-text metadata instead of content.",
          "Local absolute paths are not accepted as input and are not returned in output.",
        ],
        outputNotes: [
          "result.content contains UTF-8 text when the attachment target is readable text.",
          "result.binary or result.readable=false means the attachment cannot be read as text by this tool.",
          "result.path is relative to the attachment root for project attachments and never a local absolute path.",
          "result.hasMoreAfter/result.nextStartChar provide the continuation point for character-window reads.",
          "truncated and hasMoreAfter indicate whether another focused read may be needed.",
        ],
        runtimeHints: [
          { label: "max file bytes without line range", value: String(MAX_LOCAL_WORKSPACE_FILE_BYTES) },
          { label: "max returned chars", value: String(DEFAULT_MAX_CHARS) },
        ],
        examples: [
          { title: "Read attached text file", input: { attachmentId: "ctx_notes", maxLength: 20000 } },
          { title: "Read file inside attached project", input: { attachmentId: "ctx_project", path: "src/index.ts", startLine: 1, endLine: 120 } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 900,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative file path inside a project attachment." },
          maxLength: { type: "number", description: "Maximum characters to return." },
          startLine: { type: "number", description: "Optional 1-based first line to return." },
          endLine: { type: "number", description: "Optional 1-based last line to return." },
          startChar: { type: "number", description: "Optional zero-based character offset for continuing a truncated text window." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path),
        requireFile: true,
        projectPathRequired: true,
      });
      const stat = await statAttachmentTarget(target.targetAbsolutePath, "Attachment text target could not be read.");
      if (!stat.isFile()) {
        throw new Error("read_context_attachment_text expects a file target.");
      }
      const binary = isLikelyBinaryPath(target.targetAbsolutePath) || await fileHasNulByte(target.targetAbsolutePath, stat.size);
      if (binary) {
        return {
          action: "read_context_attachment_text",
          status: "completed",
          refId: `context-attachment:${entry.attachmentId}:text`,
          summary: `${attachmentTitle(entry)} · ${stat.size} bytes · not readable as text`,
          result: {
            attachmentId: entry.attachmentId,
            kind: entry.ref.kind,
            title: attachmentTitle(entry),
            path: target.targetPath,
            mimeType: entry.ref.metadata?.mimeType,
            bytes: stat.size,
            readable: false,
            binary: true,
            reason: "binary_or_unsupported_text_format",
          },
        };
      }
      const lineRange = parseLineRange(record);
      const hasStartChar = record.startChar !== undefined;
      const startChar = boundedOffset(record.startChar, Number.MAX_SAFE_INTEGER);
      if (lineRange !== undefined && hasStartChar) {
        throw new Error("read_context_attachment_text cannot combine startChar with startLine/endLine.");
      }
      if (lineRange !== undefined && record.maxLength !== undefined) {
        throw new Error("read_context_attachment_text cannot combine maxLength with startLine/endLine; request a smaller line range instead.");
      }
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES && lineRange === undefined) {
        throw new Error("Attachment text target is too large to read safely without a line range.");
      }
      const maxLength = positiveInteger(record.maxLength) ?? DEFAULT_MAX_CHARS;
      const content = lineRange === undefined
        ? charWindowContent(await readAttachmentTextFile(target.targetAbsolutePath), startChar)
        : stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES
          ? await readLineRange(target.targetAbsolutePath, lineRange)
          : sliceLines(await readAttachmentTextFile(target.targetAbsolutePath), lineRange);
      const truncated = content.content.length > maxLength;
      if (lineRange !== undefined && truncated) {
        throw new Error("read_context_attachment_text line range exceeds the text return budget; request fewer lines so continuation does not skip unread text.");
      }
      const returned = truncateText(content.content, maxLength);
      const returnedTextChars = returnedRawTextChars(content.content, maxLength);
      const nextStartChar = content.startChar === undefined
        ? undefined
        : content.content.length > returnedTextChars
          ? content.startChar + returnedTextChars
          : content.nextStartChar;
      const rangeSummary = content.range === undefined
        ? ""
        : ` · lines ${content.range.startLine}-${content.range.endLine}${content.totalLines === undefined ? "" : ` of ${content.totalLines}`}`;
      return {
        action: "read_context_attachment_text",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:text`,
        summary: `${attachmentTitle(entry)}${target.targetPath === "." ? "" : `:${target.targetPath}`} · ${stat.size} bytes${rangeSummary}${truncated ? " · truncated" : ""}`,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          mimeType: entry.ref.metadata?.mimeType,
          bytes: stat.size,
          readable: true,
          content: returned,
          startLine: content.range?.startLine,
          endLine: content.range?.endLine,
          totalLines: content.totalLines,
          hasMoreBefore: content.hasMoreBefore,
          hasMoreAfter: content.hasMoreAfter || truncated,
          startChar: content.startChar,
          textChars: content.startChar === undefined ? undefined : returnedTextChars,
          charCount: content.charCount,
          nextStartChar,
        },
        truncated: truncated || content.hasMoreAfter,
      };
    },
  };
}

export function createReadContextAttachmentPdfTextTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "read_context_attachment_pdf_text",
      description: "Extract best-effort text from a text-native PDF context attachment using attachmentId instead of a local path.",
      modelContract: {
        usageNotes: [
          "Use for PDF context attachments when the model needs textual content from the document.",
          "For project attachments, path is required and must point to the PDF file inside the attached project.",
          "This is a conservative built-in extractor for text-native PDFs; scanned PDFs, OCR, complex encodings, and image-only pages may return no_extractable_pdf_text.",
          "Use read_context_attachment_text for normal text files and table tools for tables; do not paste PDF bytes into the prompt.",
          "startChar continues a truncated extracted text window from a zero-based character offset.",
          "Local absolute paths are not accepted as input and are not returned in output.",
        ],
        outputNotes: [
          "result.readable=true means bounded PDF text was extracted for the model.",
          "result.content contains best-effort text, with hasMoreAfter/truncated indicating whether content was clipped.",
          "result.nextStartChar provides the continuation point when truncated is true.",
          "result.reason explains unsupported, scanned, encrypted, or unreadable PDF cases without returning local paths.",
        ],
        runtimeHints: [
          { label: "max PDF bytes", value: String(MAX_PDF_BYTES) },
          { label: "default returned chars", value: String(DEFAULT_PDF_MAX_CHARS) },
        ],
        examples: [
          { title: "Read attached PDF text", input: { attachmentId: "ctx_report_pdf", maxLength: 50000 } },
          { title: "Read PDF inside project", input: { attachmentId: "ctx_project", path: "docs/report.pdf" } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 900,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative PDF path inside a project attachment." },
          maxLength: { type: "number", description: "Maximum extracted characters to return." },
          startChar: { type: "number", description: "Zero-based extracted-text character offset for continuing a truncated PDF read." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path),
        requireFile: true,
        projectPathRequired: true,
      });
      const stat = await statAttachmentTarget(target.targetAbsolutePath, "Attachment PDF target could not be read.");
      if (!stat.isFile()) {
        throw new Error("read_context_attachment_pdf_text expects a file target.");
      }
      const format = tableTargetFormat(entry.ref, target.targetPath);
      if (format !== "pdf") {
        return unsupportedPdfResult({
          entry,
          target,
          reason: "not_a_pdf",
          bytes: stat.size,
        });
      }
      if (stat.size > MAX_PDF_BYTES) {
        return unsupportedPdfResult({
          entry,
          target,
          reason: "pdf_file_too_large",
          bytes: stat.size,
        });
      }
      const buffer = await fs.readFile(target.targetAbsolutePath).catch(() => undefined);
      if (buffer === undefined) {
        return unsupportedPdfResult({
          entry,
          target,
          reason: "pdf_file_unreadable",
          bytes: stat.size,
        });
      }
      const extracted = extractPdfText(buffer);
      if (extracted.text.length === 0) {
        return unsupportedPdfResult({
          entry,
          target,
          reason: extracted.reason ?? "no_extractable_pdf_text",
          bytes: stat.size,
          facts: extracted.facts,
        });
      }
      const maxLength = positiveInteger(record.maxLength) ?? DEFAULT_PDF_MAX_CHARS;
      const startChar = boundedOffset(record.startChar, extracted.text.length);
      const returned = extracted.text.slice(startChar, startChar + maxLength);
      const hasMoreAfter = extracted.text.length > startChar + returned.length;
      const summary = `${attachmentTitle(entry)}${target.targetPath === "." ? "" : `:${target.targetPath}`} · PDF text · ${returned.length}${hasMoreAfter ? ` of ${extracted.text.length - startChar}` : ""} chars${startChar > 0 ? ` · offset ${startChar}` : ""}${hasMoreAfter ? " · truncated" : ""}`;
      return {
        action: "read_context_attachment_pdf_text",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:pdf:${safeRefToken(target.targetPath)}`,
        summary,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          mimeType: entry.ref.metadata?.mimeType,
          bytes: stat.size,
          format: "pdf",
          readable: true,
          extraction: "best_effort_pdf_text",
          content: returned,
          startChar,
          textChars: returned.length,
          charCount: extracted.text.length,
          hasMoreAfter,
          nextStartChar: hasMoreAfter ? startChar + returned.length : undefined,
          ...extracted.facts,
        },
        truncated: hasMoreAfter,
      };
    },
  };
}

export function createInspectContextAttachmentTableTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "inspect_context_attachment_table",
      description: "Inspect a CSV, TSV, or XLSX context attachment and return sheet, column, row-count, and sample-row facts.",
      modelContract: {
        usageNotes: [
          "Inspect a table from a current context attachment selected by attachmentId or ref.",
          "Use for CSV, TSV, semicolon-separated text tables, or XLSX workbooks before reading specific rows.",
          "For project attachments, path is required and must point to the table file inside the attached project.",
          "For XLSX, omit sheetName/sheetIndex to inspect the first sheet; use returned sheets to choose another sheet.",
          "This tool does not parse legacy XLS binary spreadsheets, PDFs, images, or archives; it returns an unsupported reason for those formats.",
          "Local absolute paths are not accepted as input and are not returned in output.",
        ],
        outputNotes: [
          "result.table=true means rows were parsed as a supported table format.",
          "result.format is delimited or xlsx; XLSX results include sheetName, sheetIndex, and sheets.",
          "result.columns contains header columns when headerRow is true.",
          "result.sampleRows contains bounded row samples with rowNumber and values, plus record when headers are available.",
          "result.reason explains unsupported or unreadable table targets without returning local paths.",
        ],
        runtimeHints: [
          { label: "supported formats", value: "csv, tsv, semicolon-separated text, xlsx" },
          { label: "max sample rows", value: String(MAX_TABLE_SAMPLE_ROWS) },
        ],
        examples: [
          { title: "Inspect attached CSV", input: { attachmentId: "ctx_sales_csv", sampleRows: 5 } },
          { title: "Inspect CSV inside project", input: { attachmentId: "ctx_project", path: "data/sales.csv" } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_400,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative table path inside a project attachment." },
          sheetName: { type: "string", description: "XLSX sheet name to inspect. Defaults to the first sheet." },
          sheetIndex: { type: "number", description: "1-based XLSX sheet index to inspect when sheetName is not provided." },
          sampleRows: { type: "number", description: "Number of sample data rows to return. Defaults to 5 and is capped." },
          headerRow: { type: "boolean", description: "Whether the first row should be treated as column headers. Defaults to true." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path),
        requireFile: true,
        projectPathRequired: true,
      });
      const table = await loadTableTarget(entry, target, {
        sheetName: stringOrUndefined(record.sheetName),
        sheetIndex: positiveInteger(record.sheetIndex),
      });
      if (!table.supported) {
        return unsupportedTableResult({
          action: "inspect_context_attachment_table",
          entry,
          target,
          reason: table.reason,
          bytes: table.bytes,
        });
      }
      const headerRow = booleanOrDefault(record.headerRow, true);
      const sampleRows = Math.min(MAX_TABLE_SAMPLE_ROWS, positiveInteger(record.sampleRows) ?? DEFAULT_TABLE_SAMPLE_ROWS);
      const tableFacts = tableFactsFromRows(table.parsed.rows, { headerRow });
      const samples = tableRowsForModel({
        rows: table.parsed.rows,
        columns: tableFacts.columns,
        startRow: tableFacts.dataStartRow,
        rowCount: sampleRows,
        includeRecord: headerRow,
      });
      const summary = `${attachmentTitle(entry)}${target.targetPath === "." ? "" : `:${target.targetPath}`} · ${tableFormatSummary(table.parsed)} · ${tableFacts.totalRows} rows · ${tableFacts.columnCount} columns`;
      return {
        action: "inspect_context_attachment_table",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:table:${safeRefToken(target.targetPath)}`,
        summary,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          mimeType: entry.ref.metadata?.mimeType,
          bytes: table.bytes,
          table: true,
          format: table.parsed.kind,
          delimiter: table.parsed.kind === "delimited" ? table.parsed.delimiter.kind : undefined,
          sheetName: table.parsed.kind === "xlsx" ? table.parsed.sheetName : undefined,
          sheetIndex: table.parsed.kind === "xlsx" ? table.parsed.sheetIndex : undefined,
          sheets: table.parsed.kind === "xlsx" ? table.parsed.sheets : undefined,
          headerRow,
          totalRows: tableFacts.totalRows,
          dataRows: tableFacts.dataRows,
          columnCount: tableFacts.columnCount,
          columns: tableFacts.columns,
          sampleRows: samples,
        },
        display: {
          kind: "generic_tool_summary",
          action: "inspect_context_attachment_table",
          summary,
          items: [
            `columns: ${tableFacts.columns.slice(0, 12).join(", ")}`,
            ...samples.slice(0, 4).map((row) => `row ${row.rowNumber}: ${row.values.join(" | ")}`),
          ],
        },
      };
    },
  };
}

export function createReadContextAttachmentTableTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "read_context_attachment_table",
      description: "Read a bounded row window from a CSV, TSV, or XLSX context attachment as structured table rows.",
      modelContract: {
        usageNotes: [
          "Read a bounded physical row window from a supported table attachment.",
          "Use inspect_context_attachment_table first when you need column names or row counts.",
          "For project attachments, path is required and must point to the table file inside the attached project.",
          "For XLSX, omit sheetName/sheetIndex to read the first sheet; use inspect_context_attachment_table to discover sheets.",
          "startRow is 1-based physical row number. With headerRow=true, data usually starts at row 2.",
          "This tool does not parse legacy XLS binary spreadsheets, PDFs, images, or archives.",
        ],
        outputNotes: [
          "result.rows[] contains rowNumber, values, and record when headers are available.",
          "result.format is delimited or xlsx; XLSX results include sheetName, sheetIndex, and sheets.",
          "result.columns contains header columns when headerRow is true.",
          "result.hasMoreBefore/hasMoreAfter indicate whether another row window may be needed.",
          "result.nextStartRow and continuation.nextInput provide the next executable row-window call when truncated is true.",
          "result.reason explains unsupported or unreadable table targets without returning local paths.",
        ],
        runtimeHints: [
          { label: "max rows per call", value: String(MAX_TABLE_READ_ROWS) },
          { label: "supported formats", value: "csv, tsv, semicolon-separated text, xlsx" },
        ],
        examples: [
          { title: "Read first data rows", input: { attachmentId: "ctx_sales_csv", startRow: 2, rowCount: 50 } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative table path inside a project attachment." },
          sheetName: { type: "string", description: "XLSX sheet name to read. Defaults to the first sheet." },
          sheetIndex: { type: "number", description: "1-based XLSX sheet index to read when sheetName is not provided." },
          startRow: { type: "number", description: "1-based physical row number to start from. Defaults to 2 when headerRow=true, otherwise 1." },
          rowCount: { type: "number", description: "Number of rows to return. Defaults to 50 and is capped." },
          headerRow: { type: "boolean", description: "Whether the first row should be treated as column headers. Defaults to true." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path),
        requireFile: true,
        projectPathRequired: true,
      });
      const table = await loadTableTarget(entry, target, {
        sheetName: stringOrUndefined(record.sheetName),
        sheetIndex: positiveInteger(record.sheetIndex),
      });
      if (!table.supported) {
        return unsupportedTableResult({
          action: "read_context_attachment_table",
          entry,
          target,
          reason: table.reason,
          bytes: table.bytes,
        });
      }
      const headerRow = booleanOrDefault(record.headerRow, true);
      const rowCount = Math.min(MAX_TABLE_READ_ROWS, positiveInteger(record.rowCount) ?? DEFAULT_TABLE_READ_ROWS);
      const startRow = positiveInteger(record.startRow) ?? (headerRow ? 2 : 1);
      const tableFacts = tableFactsFromRows(table.parsed.rows, { headerRow });
      const rows = tableRowsForModel({
        rows: table.parsed.rows,
        columns: tableFacts.columns,
        startRow,
        rowCount,
        includeRecord: headerRow,
      });
      const actualEndRow = rows.length === 0 ? startRow : rows[rows.length - 1]!.rowNumber;
      const hasMoreAfter = table.parsed.rows.some((row) => row.rowNumber > actualEndRow);
      const nextStartRow = hasMoreAfter ? actualEndRow + 1 : undefined;
      const continuation = nextStartRow === undefined
        ? undefined
        : {
            nextInput: compactRecord({
              attachmentId: entry.attachmentId,
              path: target.targetPath,
              sheetName: table.parsed.kind === "xlsx" ? table.parsed.sheetName : undefined,
              sheetIndex: table.parsed.kind === "xlsx" ? table.parsed.sheetIndex : undefined,
              startRow: nextStartRow,
              rowCount,
              headerRow,
            }),
            note: "Continue read_context_attachment_table with the same attachment/path/sheet/header settings and nextStartRow.",
          };
      const summary = `${attachmentTitle(entry)}${target.targetPath === "." ? "" : `:${target.targetPath}`} · rows ${startRow}-${actualEndRow} of ${tableFacts.totalRows} · ${rows.length} returned`;
      const result = {
        attachmentId: entry.attachmentId,
        kind: entry.ref.kind,
        title: attachmentTitle(entry),
        path: target.targetPath,
        mimeType: entry.ref.metadata?.mimeType,
        bytes: table.bytes,
        table: true,
        format: table.parsed.kind,
        delimiter: table.parsed.kind === "delimited" ? table.parsed.delimiter.kind : undefined,
        sheetName: table.parsed.kind === "xlsx" ? table.parsed.sheetName : undefined,
        sheetIndex: table.parsed.kind === "xlsx" ? table.parsed.sheetIndex : undefined,
        sheets: table.parsed.kind === "xlsx" ? table.parsed.sheets : undefined,
        headerRow,
        totalRows: tableFacts.totalRows,
        dataRows: tableFacts.dataRows,
        columnCount: tableFacts.columnCount,
        columns: tableFacts.columns,
        startRow,
        requestedRowCount: rowCount,
        rowCount,
        rows,
        rowsReturned: rows.length,
        hasMoreBefore: startRow > 1,
        hasMoreAfter,
        nextStartRow,
        continuation,
      };
      return {
        action: "read_context_attachment_table",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:table:${safeRefToken(target.targetPath)}:${startRow}`,
        summary,
        result,
        display: {
          kind: "generic_tool_summary",
          action: "read_context_attachment_table",
          summary,
          items: rows.slice(0, 8).map((row) => `row ${row.rowNumber}: ${row.values.join(" | ")}`),
        },
        continuation,
        canonicalResult: continuation === undefined ? undefined : {
          content: [
            { type: "text", text: [summary, ...rows.slice(0, 8).map((row) => `row ${row.rowNumber}: ${row.values.join(" | ")}`)].join("\n") },
          ],
          structuredContent: {
            action: "read_context_attachment_table",
            result,
            truncated: true,
          },
          truncation: {
            truncated: true,
            continuation,
          },
          continuation,
        },
        truncated: hasMoreAfter,
      };
    },
  };
}

export function createInspectContextAttachmentArchiveTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "inspect_context_attachment_archive",
      description: "Inspect a ZIP archive context attachment and return bounded internal entry metadata without extracting files.",
      modelContract: {
        usageNotes: [
          "Inspect a ZIP archive from a current context attachment selected by attachmentId or ref.",
          "For project attachments, path is required and must point to the archive file inside the attached project.",
          "This tool only lists ZIP entries; it does not extract files or read archive contents.",
          "Use this before deciding whether an archive needs explicit extraction or a project attachment workflow.",
          "Local absolute paths are not accepted as input and are not returned in output.",
        ],
        outputNotes: [
          "result.archive=true means the archive directory was parsed.",
          "result.entries[] contains archive-internal path, kind, byte size, compressed byte size, and unsafePath when a name is not safe to extract.",
          "result.reason explains unsupported archive formats such as tar/gz/7z without returning local paths.",
        ],
        runtimeHints: [
          { label: "supported formats", value: "zip" },
          { label: "max returned entries", value: String(MAX_ARCHIVE_LIST_ENTRIES) },
        ],
        examples: [
          { title: "Inspect attached ZIP", input: { attachmentId: "ctx_archive", limit: 80 } },
          { title: "Inspect ZIP inside project", input: { attachmentId: "ctx_project", path: "assets/project.zip" } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_400,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative archive path inside a project attachment." },
          limit: { type: "number", description: "Maximum archive entries to return." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path),
        requireFile: true,
        projectPathRequired: true,
      });
      const stat = await statAttachmentTarget(target.targetAbsolutePath, "Attachment archive target could not be read.");
      if (!stat.isFile()) {
        throw new Error("inspect_context_attachment_archive expects a file target.");
      }
      const format = tableTargetFormat(entry.ref, target.targetPath);
      if (format !== "archive" || archiveTargetExtension(entry.ref, target.targetPath) !== ".zip") {
        return unsupportedArchiveResult({
          entry,
          target,
          reason: format === "archive" ? "unsupported_archive_format" : "not_an_archive",
          bytes: stat.size,
        });
      }
      if (stat.size > MAX_SPREADSHEET_BYTES) {
        return unsupportedArchiveResult({
          entry,
          target,
          reason: "archive_file_too_large",
          bytes: stat.size,
        });
      }
      const buffer = await fs.readFile(target.targetAbsolutePath).catch(() => undefined);
      if (buffer === undefined) {
        return unsupportedArchiveResult({
          entry,
          target,
          reason: "archive_file_unreadable",
          bytes: stat.size,
        });
      }
      const parsed = (() => {
        try {
          return { supported: true as const, entries: readZipEntries(buffer) };
        } catch (error: unknown) {
          return { supported: false as const, reason: archiveReadErrorReason(error) };
        }
      })();
      if (!parsed.supported) {
        return unsupportedArchiveResult({
          entry,
          target,
          reason: parsed.reason,
          bytes: stat.size,
        });
      }
      const limit = Math.min(MAX_ARCHIVE_LIST_ENTRIES, positiveInteger(record.limit) ?? MAX_ARCHIVE_LIST_ENTRIES);
      const archiveEntries = parsed.entries.map(archiveEntrySummary);
      const returned = archiveEntries.slice(0, limit);
      const truncated = archiveEntries.length > returned.length;
      const summary = `${attachmentTitle(entry)}${target.targetPath === "." ? "" : `:${target.targetPath}`} · zip archive · ${returned.length}${truncated ? ` of ${archiveEntries.length}` : ""} entries`;
      return {
        action: "inspect_context_attachment_archive",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:archive:${safeRefToken(target.targetPath)}`,
        summary,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          mimeType: entry.ref.metadata?.mimeType,
          bytes: stat.size,
          archive: true,
          format: "zip",
          entryCount: archiveEntries.length,
          entriesReturned: returned.length,
          entries: returned,
        },
        display: {
          kind: "generic_tool_summary",
          action: "inspect_context_attachment_archive",
          summary,
          items: returned.slice(0, 12).map((item) =>
            [item.kind, item.path, item.bytes === undefined ? undefined : `${item.bytes} bytes`].filter(isString).join(" ")
          ),
        },
        truncated,
      };
    },
  };
}

export function createListContextAttachmentFilesTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "list_context_attachment_files",
      description: "List files under an attached project folder using attachmentId and attachment-relative paths.",
      modelContract: {
        usageNotes: [
          "List files and folders inside a project or workspace context attachment.",
          "Use this before reading a file inside a selected local project or attached project folder.",
          "path is optional and defaults to the attachment root. It must be relative to the attachment root.",
          "depth defaults to 1 and is capped; limit caps returned entries; offset continues a truncated listing.",
          "Local absolute paths are not accepted or returned.",
        ],
        outputNotes: [
          "result.entries[] contains attachment-relative path, name, kind, byte size, and depth.",
          "result.totalEntries is the full enumerated count when traversal completes.",
          "result.hasMoreAfter/result.nextOffset provide the continuation point when truncated is true.",
          "result.reachedOffsetCeiling=true means there are more entries beyond the supported continuation window and no nextOffset will be returned.",
          "truncated tells whether another continuation page is available.",
        ],
        runtimeHints: [
          { label: "max depth", value: String(MAX_LIST_DEPTH) },
          { label: "max entries", value: String(MAX_LIST_ENTRIES) },
          { label: "max continuation offset", value: String(MAX_LIST_OFFSET) },
        ],
        examples: [
          { title: "List attached project root", input: { attachmentId: "ctx_project", depth: 2, limit: 80 } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Attachment-relative directory path. Defaults to attachment root." },
          depth: { type: "number", description: "Recursive listing depth. Defaults to 1 and is capped." },
          limit: { type: "number", description: "Maximum entries to return." },
          offset: { type: "number", description: "Zero-based entry offset used to continue a truncated listing." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path) ?? ".",
        requireFile: false,
        projectPathRequired: false,
      });
      if (target.rootKind !== "project") {
        throw new Error("list_context_attachment_files expects a project or workspace attachment.");
      }
      const stat = await statAttachmentTarget(target.targetAbsolutePath, "Attachment directory target could not be read.");
      if (!stat.isDirectory()) {
        throw new Error("list_context_attachment_files expects an attachment-relative directory path.");
      }
      const depth = Math.min(MAX_LIST_DEPTH, positiveInteger(record.depth) ?? DEFAULT_LIST_DEPTH);
      const limit = Math.min(MAX_LIST_ENTRIES, positiveInteger(record.limit) ?? MAX_LIST_ENTRIES);
      const offset = boundedOffset(record.offset, MAX_LIST_OFFSET);
      const listed = await listDirectoryTree({
        absolutePath: target.targetAbsolutePath,
        rootAbsolutePath: target.rootAbsolutePath,
        maxDepth: depth,
        limit,
        offset,
      });
      const continuation = boundedContinuationOffset({
        hasMoreAfter: listed.hasMoreAfter,
        nextOffset: listed.nextOffset,
        maxOffset: MAX_LIST_OFFSET,
      });
      const continuationSummary = continuation.reachedOffsetCeiling
        ? " · offset ceiling reached"
        : continuation.hasMoreAfter
          ? " · truncated"
          : "";
      const summary = `${attachmentTitle(entry)}:${target.targetPath} · ${listed.entries.length}${listed.truncated ? ` of ${listed.totalEntries}` : ""} entries · depth ${depth}${offset > 0 ? ` · offset ${offset}` : ""}${continuationSummary}`;
      return {
        action: "list_context_attachment_files",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:files:${safeRefToken(target.targetPath)}`,
        summary,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          depth,
          offset,
          limit,
          maxDepth: MAX_LIST_DEPTH,
          maxEntries: MAX_LIST_ENTRIES,
          entries: listed.entries,
          entriesReturned: listed.entries.length,
          totalEntries: listed.totalEntries,
          unreadableDirectories: listed.unreadableDirectories,
          unreadableSamples: listed.unreadableSamples,
          hasMoreAfter: continuation.hasMoreAfter,
          nextOffset: continuation.nextOffset,
          reachedOffsetCeiling: continuation.reachedOffsetCeiling,
          offsetCeiling: MAX_LIST_OFFSET,
        },
        display: {
          kind: "generic_tool_summary",
          action: "list_context_attachment_files",
          summary,
          items: listed.entries.slice(0, 12).map((entry) =>
            [entry.kind, entry.path, entry.bytes === undefined ? undefined : `${entry.bytes} bytes`].filter(isString).join(" ")
          ),
        },
        truncated: continuation.hasMoreAfter,
      };
    },
  };
}

export function createSearchContextAttachmentFilesTool(options: ContextAttachmentToolOptions = {}): ToolExecutor {
  return {
    definition: {
      name: "search_context_attachment_files",
      description: "Search text files inside an attached project or text attachment using attachmentId and attachment-relative paths.",
      modelContract: {
        usageNotes: [
          "Search text files inside a current context attachment for a case-insensitive plain-text query.",
          "Use this to locate relevant files or passages in an attached local project before reading them.",
          "For project attachments, path optionally narrows search to an attachment-relative directory or file.",
          "For file attachments, omit path; the tool searches that file only.",
          "offset optionally continues a previously truncated search with the same query/path.",
          "Do not use regular expressions. Local absolute paths are not accepted or returned.",
        ],
        outputNotes: [
          "result.matches[] includes attachment-relative path, 1-based line, and preview.",
          "Skipped binary, too-large, unreadable, generated, or non-file entries are counted.",
          "result.hasMoreAfter/result.nextOffset provide the continuation point when truncated is true.",
          "result.reachedOffsetCeiling=true means there are more matches beyond the supported continuation window and no nextOffset will be returned.",
          "truncated tells whether another continuation page is available.",
        ],
        runtimeHints: [
          { label: "max matches", value: String(MAX_SEARCH_MATCHES) },
          { label: "max file bytes", value: String(MAX_LOCAL_WORKSPACE_FILE_BYTES) },
          { label: "max continuation offset", value: String(MAX_SEARCH_OFFSET) },
        ],
        examples: [
          { title: "Search attached project", input: { attachmentId: "ctx_project", query: "TODO", path: "src", limit: 20 } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1_600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          query: { type: "string", description: "Plain-text query to search for, case-insensitive." },
          path: { type: "string", description: "Attachment-relative directory or file path. Defaults to attachment root for project attachments." },
          limit: { type: "number", description: "Maximum matches to return." },
          offset: { type: "number", description: "Zero-based match offset used to continue a truncated search." },
        },
        required: ["query"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const query = stringOrFallback(record.query, "");
      if (query.length === 0) {
        throw new Error("search_context_attachment_files requires a non-empty query.");
      }
      const entry = requireAttachmentEntry(options.taskSoil, record);
      assertAttachmentAuthorized(entry);
      const target = await resolveAttachmentTarget({
        entry,
        workspaceRoot: options.workspaceRoot ?? process.cwd(),
        requestedPath: stringOrUndefined(record.path) ?? ".",
        requireFile: false,
        projectPathRequired: false,
      });
      await statAttachmentTarget(target.targetAbsolutePath, "Attachment search target could not be read.");
      const limit = Math.min(MAX_SEARCH_MATCHES, positiveInteger(record.limit) ?? MAX_SEARCH_MATCHES);
      const offset = boundedOffset(record.offset, MAX_SEARCH_OFFSET);
      const collectionLimit = Math.min(MAX_SEARCH_OFFSET + MAX_SEARCH_MATCHES + 1, offset + limit + 1);
      const collectedMatches: SearchMatch[] = [];
      const facts = createSearchFacts();
      await searchPath({
        absolutePath: target.targetAbsolutePath,
        rootAbsolutePath: target.rootAbsolutePath,
        normalizedQuery: query.toLowerCase(),
        limit: collectionLimit,
        matches: collectedMatches,
        facts,
      });
      const matches = collectedMatches.slice(offset, offset + limit);
      const rawHasMoreAfter = collectedMatches.length > offset + matches.length;
      const continuation = boundedContinuationOffset({
        hasMoreAfter: rawHasMoreAfter,
        nextOffset: rawHasMoreAfter ? offset + matches.length : undefined,
        maxOffset: MAX_SEARCH_OFFSET,
      });
      const continuationSummary = continuation.reachedOffsetCeiling
        ? " · offset ceiling reached"
        : continuation.hasMoreAfter
          ? " · truncated"
          : "";
      const summary = `${attachmentTitle(entry)}:${target.targetPath} · ${matches.length} matches for ${query}${offset > 0 ? ` · offset ${offset}` : ""}${continuationSummary}`;
      return {
        action: "search_context_attachment_files",
        status: "completed",
        refId: `context-attachment:${entry.attachmentId}:search:${safeRefToken(query)}`,
        summary,
        result: {
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          query,
          path: target.targetPath,
          offset,
          limit,
          matches,
          matchesReturned: matches.length,
          searchedFiles: facts.searchedFiles,
          skippedFiles: facts.skippedFiles,
          skippedBinaryFiles: facts.skippedBinaryFiles,
          skippedTooLargeFiles: facts.skippedTooLargeFiles,
          skippedUnreadableFiles: facts.skippedUnreadableFiles,
          skippedDirectories: facts.skippedDirectories,
          skippedOtherEntries: facts.skippedOtherEntries,
          skippedSamples: facts.skippedSamples,
          hasMoreAfter: continuation.hasMoreAfter,
          nextOffset: continuation.nextOffset,
          reachedOffsetCeiling: continuation.reachedOffsetCeiling,
          offsetCeiling: MAX_SEARCH_OFFSET,
        },
        display: {
          kind: "generic_tool_summary",
          action: "search_context_attachment_files",
          summary,
          items: matches.slice(0, 12).map((match) => `${match.path}:${match.line}`),
        },
        truncated: continuation.hasMoreAfter,
      };
    },
  };
}

async function loadTableTarget(
  entry: AttachmentEntry,
  target: AttachmentTarget,
  options: {
    readonly sheetName?: string;
    readonly sheetIndex?: number;
  }
): Promise<
  | { readonly supported: true; readonly parsed: ParsedAttachmentTable; readonly bytes: number }
  | { readonly supported: false; readonly reason: string; readonly bytes?: number }
> {
  const stat = await statAttachmentTarget(target.targetAbsolutePath, "Attachment table target could not be read.");
  if (!stat.isFile()) {
    return { supported: false, reason: "not_a_file", bytes: stat.size };
  }
  const format = tableTargetFormat(entry.ref, target.targetPath);
  if (format === "pdf") {
    return { supported: false, reason: "unsupported_pdf", bytes: stat.size };
  }
  if (format === "image") {
    return { supported: false, reason: "unsupported_image", bytes: stat.size };
  }
  if (format === "spreadsheet") {
    if (!isSupportedSpreadsheetTarget(entry.ref, target.targetPath)) {
      return { supported: false, reason: "unsupported_legacy_spreadsheet", bytes: stat.size };
    }
    if (stat.size > MAX_SPREADSHEET_BYTES) {
      return { supported: false, reason: "spreadsheet_file_too_large", bytes: stat.size };
    }
    const parsed = await readXlsxTable(target.targetAbsolutePath, options).catch((error: unknown) => ({
      supported: false as const,
      reason: xlsxReadErrorReason(error),
    }));
    return parsed.supported
      ? { supported: true, parsed: parsed.table, bytes: stat.size }
      : { supported: false, reason: parsed.reason, bytes: stat.size };
  }
  if (format === "archive") {
    return { supported: false, reason: "unsupported_archive", bytes: stat.size };
  }
  if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES) {
    return { supported: false, reason: "table_file_too_large", bytes: stat.size };
  }
  if (await fileHasNulByte(target.targetAbsolutePath, stat.size)) {
    return { supported: false, reason: "binary_or_unsupported_text_format", bytes: stat.size };
  }
  const raw = await readAttachmentTextFile(target.targetAbsolutePath);
  const delimiter = delimiterForTableTarget(entry.ref, target.targetPath, raw);
  if (delimiter === undefined) {
    return { supported: false, reason: "unsupported_non_table_text", bytes: stat.size };
  }
  return {
    supported: true,
    parsed: {
      kind: "delimited",
      delimiter,
      rows: parseDelimitedRows(raw, delimiter.char),
    },
    bytes: stat.size,
  };
}

function unsupportedTableResult(input: {
  readonly action: "inspect_context_attachment_table" | "read_context_attachment_table";
  readonly entry: AttachmentEntry;
  readonly target: AttachmentTarget;
  readonly reason: string;
  readonly bytes?: number;
}): Readonly<Record<string, unknown>> {
  const summary = `${attachmentTitle(input.entry)}${input.target.targetPath === "." ? "" : `:${input.target.targetPath}`} · not readable as a delimiter-separated table · ${input.reason}`;
  return {
    action: input.action,
    status: "completed",
    refId: `context-attachment:${input.entry.attachmentId}:table:${safeRefToken(input.target.targetPath)}`,
    summary,
    result: {
      attachmentId: input.entry.attachmentId,
      kind: input.entry.ref.kind,
      title: attachmentTitle(input.entry),
      path: input.target.targetPath,
      mimeType: input.entry.ref.metadata?.mimeType,
      bytes: input.bytes,
      table: false,
      format: tableTargetFormat(input.entry.ref, input.target.targetPath),
      readable: false,
      reason: input.reason,
    },
    display: {
      kind: "generic_tool_summary",
      action: input.action,
      summary,
    },
  };
}

function unsupportedArchiveResult(input: {
  readonly entry: AttachmentEntry;
  readonly target: AttachmentTarget;
  readonly reason: string;
  readonly bytes?: number;
}): Readonly<Record<string, unknown>> {
  const summary = `${attachmentTitle(input.entry)}${input.target.targetPath === "." ? "" : `:${input.target.targetPath}`} · not readable as a ZIP archive · ${input.reason}`;
  return {
    action: "inspect_context_attachment_archive",
    status: "completed",
    refId: `context-attachment:${input.entry.attachmentId}:archive:${safeRefToken(input.target.targetPath)}`,
    summary,
    result: {
      attachmentId: input.entry.attachmentId,
      kind: input.entry.ref.kind,
      title: attachmentTitle(input.entry),
      path: input.target.targetPath,
      mimeType: input.entry.ref.metadata?.mimeType,
      bytes: input.bytes,
      archive: false,
      format: tableTargetFormat(input.entry.ref, input.target.targetPath),
      readable: false,
      reason: input.reason,
    },
    display: {
      kind: "generic_tool_summary",
      action: "inspect_context_attachment_archive",
      summary,
    },
  };
}

function unsupportedPdfResult(input: {
  readonly entry: AttachmentEntry;
  readonly target: AttachmentTarget;
  readonly reason: string;
  readonly bytes?: number;
  readonly facts?: Readonly<Record<string, number>>;
}): Readonly<Record<string, unknown>> {
  const summary = `${attachmentTitle(input.entry)}${input.target.targetPath === "." ? "" : `:${input.target.targetPath}`} · PDF text not available · ${input.reason}`;
  return {
    action: "read_context_attachment_pdf_text",
    status: "completed",
    refId: `context-attachment:${input.entry.attachmentId}:pdf:${safeRefToken(input.target.targetPath)}`,
    summary,
    result: {
      attachmentId: input.entry.attachmentId,
      kind: input.entry.ref.kind,
      title: attachmentTitle(input.entry),
      path: input.target.targetPath,
      mimeType: input.entry.ref.metadata?.mimeType,
      bytes: input.bytes,
      format: "pdf",
      readable: false,
      reason: input.reason,
      ...input.facts,
    },
    display: {
      kind: "generic_tool_summary",
      action: "read_context_attachment_pdf_text",
      summary,
    },
  };
}

function archiveReadErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]+$/u.test(message) ? message : "archive_parse_failed";
}

function archiveEntrySummary(entry: ZipEntry): {
  readonly path: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly bytes: number;
  readonly compressedBytes: number;
  readonly compressionMethod: number;
  readonly unsafePath: boolean;
} {
  const rawName = entry.name.replace(/\\/g, "/");
  const normalized = normalizeZipEntryName(entry.name);
  const unsafePath = isUnsafeArchivePath(rawName);
  const safePath = truncateText(normalized.length === 0 ? "." : normalized, 500);
  const basename = path.posix.basename(safePath.replace(/\/+$/u, "")) || safePath;
  return {
    path: safePath,
    name: basename,
    kind: safePath.endsWith("/") ? "directory" : "file",
    bytes: entry.uncompressedSize,
    compressedBytes: entry.compressedSize,
    compressionMethod: entry.compressionMethod,
    unsafePath,
  };
}

function isUnsafeArchivePath(value: string): boolean {
  return value.length === 0 ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "..");
}

function tableFactsFromRows(
  rows: readonly ParsedTableRow[],
  options: { readonly headerRow: boolean }
): {
  readonly totalRows: number;
  readonly dataRows: number;
  readonly dataStartRow: number;
  readonly columnCount: number;
  readonly columns: readonly string[];
} {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const header = options.headerRow ? rows[0]?.cells : undefined;
  const columns = header === undefined
    ? generatedColumns(columnCount)
    : normalizedColumns(header, columnCount);
  return {
    totalRows: rows.length,
    dataRows: options.headerRow ? Math.max(0, rows.length - 1) : rows.length,
    dataStartRow: options.headerRow ? (rows[0]?.rowNumber ?? 1) + 1 : (rows[0]?.rowNumber ?? 1),
    columnCount,
    columns,
  };
}

function tableRowsForModel(input: {
  readonly rows: readonly ParsedTableRow[];
  readonly columns: readonly string[];
  readonly startRow: number;
  readonly rowCount: number;
  readonly includeRecord: boolean;
}): readonly {
  readonly rowNumber: number;
  readonly values: readonly string[];
  readonly record?: Readonly<Record<string, string>>;
}[] {
  return input.rows.filter((row) => row.rowNumber >= input.startRow).slice(0, input.rowCount).map((row) => {
    const values = normalizedRowValues(row.cells, Math.max(input.columns.length, row.cells.length));
    return {
      rowNumber: row.rowNumber,
      values,
      record: input.includeRecord ? rowRecord(input.columns, values) : undefined,
    };
  });
}

function normalizedRowValues(row: readonly string[], columnCount: number): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    values.push(truncateText(row[index] ?? "", MAX_TABLE_CELL_CHARS));
  }
  return values;
}

function rowRecord(columns: readonly string[], values: readonly string[]): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  for (let index = 0; index < Math.max(columns.length, values.length); index += 1) {
    record[columns[index] ?? `column_${index + 1}`] = values[index] ?? "";
  }
  return record;
}

function normalizedColumns(header: readonly string[], columnCount: number): readonly string[] {
  const result: string[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < columnCount; index += 1) {
    const raw = truncateText((header[index] ?? "").trim(), 120);
    const base = safeColumnName(raw.length === 0 ? `column_${index + 1}` : raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.push(count === 0 ? base : `${base}_${count + 1}`);
  }
  return result;
}

function generatedColumns(columnCount: number): readonly string[] {
  return Array.from({ length: columnCount }, (_value, index) => `column_${index + 1}`);
}

function safeColumnName(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim() || "column";
}

function parseDelimitedRows(raw: string, delimiter: "," | "\t" | ";"): readonly ParsedTableRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index]!;
    if (char === "\"") {
      if (inQuotes && raw[index + 1] === "\"") {
        field += "\"";
        index += 2;
        continue;
      }
      inQuotes = !inQuotes;
      index += 1;
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(stripBomIfFirstCell(field, rows.length, row.length));
      field = "";
      index += 1;
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(stripBomIfFirstCell(field, rows.length, row.length));
      rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && raw[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    field += char;
    index += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(stripBomIfFirstCell(field, rows.length, row.length));
    rows.push(row);
  }
  return rows
    .map((cells, index): ParsedTableRow => ({ rowNumber: index + 1, cells }))
    .filter((item) => item.cells.some((cell) => cell.length > 0));
}

function stripBomIfFirstCell(value: string, rowIndex: number, cellIndex: number): string {
  return rowIndex === 0 && cellIndex === 0 ? value.replace(/^\uFEFF/u, "") : value;
}

function delimiterForTableTarget(
  ref: TaskSoilContextRef,
  targetPath: string,
  raw: string
): TableDelimiter | undefined {
  const extension = tableTargetExtension(ref, targetPath);
  if (extension === ".tsv") {
    return { kind: "tab", char: "\t" };
  }
  if (extension === ".csv") {
    return { kind: "comma", char: "," };
  }
  const mimeType = ref.metadata?.mimeType?.toLowerCase();
  if (mimeType === "text/tab-separated-values") {
    return { kind: "tab", char: "\t" };
  }
  if (mimeType === "text/csv" || mimeType === "application/csv") {
    return { kind: "comma", char: "," };
  }
  return sniffDelimiter(raw);
}

function sniffDelimiter(raw: string): TableDelimiter | undefined {
  const sample = raw.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 8);
  if (sample.length === 0) {
    return undefined;
  }
  const candidates: readonly TableDelimiter[] = [
    { kind: "comma", char: "," },
    { kind: "tab", char: "\t" },
    { kind: "semicolon", char: ";" },
  ];
  const scored = candidates.map((candidate) => {
    const counts = sample.map((line) => countDelimiterOutsideQuotes(line, candidate.char));
    const positive = counts.filter((count) => count > 0);
    const consistent = positive.length >= Math.min(2, sample.length) && new Set(positive).size <= 2;
    return {
      candidate,
      score: positive.reduce((sum, count) => sum + count, 0) + (consistent ? 10 : 0),
    };
  }).sort((left, right) => right.score - left.score);
  return scored[0] !== undefined && scored[0].score > 0 ? scored[0].candidate : undefined;
}

function countDelimiterOutsideQuotes(value: string, delimiter: "," | "\t" | ";"): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\"") {
      if (inQuotes && value[index + 1] === "\"") {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function tableFormatSummary(table: ParsedAttachmentTable): string {
  return table.kind === "delimited"
    ? `${table.delimiter.kind} table`
    : `xlsx sheet "${table.sheetName}"`;
}

async function readXlsxTable(
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

function xlsxReadErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]+$/u.test(message) ? message : "xlsx_parse_failed";
}

function readZipEntries(buffer: Buffer): readonly ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === undefined) {
    throw new Error("xlsx_zip_directory_missing");
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("unsupported_zip64");
  }
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error("zip_entry_limit_exceeded");
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new Error("xlsx_zip_directory_invalid");
  }
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("xlsx_zip_directory_invalid");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) {
      throw new Error("xlsx_zip_directory_invalid");
    }
    entries.push({
      name: buffer.subarray(nameStart, nameEnd).toString("utf8"),
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return undefined;
}

function readZipTextEntry(buffer: Buffer, entry: ZipEntry): string {
  return readZipEntryBuffer(buffer, entry).toString("utf8");
}

function readZipEntryBuffer(buffer: Buffer, entry: ZipEntry): Buffer {
  if ((entry.flags & 0x1) === 0x1) {
    throw new Error("unsupported_encrypted_zip");
  }
  if (entry.uncompressedSize > MAX_SPREADSHEET_ENTRY_BYTES) {
    throw new Error("spreadsheet_entry_too_large");
  }
  if (entry.localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error("xlsx_zip_entry_invalid");
  }
  const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error("xlsx_zip_entry_invalid");
  }
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    if (inflated.length > MAX_SPREADSHEET_ENTRY_BYTES) {
      throw new Error("spreadsheet_entry_too_large");
    }
    return inflated;
  }
  throw new Error("unsupported_zip_compression");
}

function normalizeZipEntryName(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
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

function boundedOffset(value: unknown, maxOffset: number): number {
  return Math.min(maxOffset, Math.max(0, positiveInteger(value) ?? 0));
}

function compactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toPortableRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
