import { promises as fs } from "node:fs";
import type { ToolExecutor, ToolFactValue } from "../../../domain/tools/index.js";
import {
  asRecord,
  isLikelyBinaryPath,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
  optionalSafeIntegerAtLeast,
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
import { extractPdfText, pdfReadErrorReason } from "./context-attachment-pdf.js";
import {
  charWindowContent,
  parseLineRange,
  readAttachmentTextFile,
  readLineRange,
  returnedRawTextChars,
  sliceLines,
} from "./context-attachment-text.js";
import {
  assertAttachmentAuthorized,
  attachmentEntries,
  attachmentSummary,
  attachmentTitle,
  requireAttachmentEntry,
  resolveAttachmentTarget,
  statAttachmentTarget,
  tableTargetFormat,
  type AttachmentEntry,
  type AttachmentTarget,
  type ContextAttachmentToolOptions,
} from "./context-attachment-access.js";
import { createReadContextAttachmentImageTool } from "./context-attachment-image.js";
import { createInspectContextAttachmentArchiveTool } from "./context-attachment-archive.js";
import {
  createInspectContextAttachmentTableTool,
  createReadContextAttachmentTableTool,
} from "./context-attachment-table.js";
import {
  isUtf16CodeUnitBoundary,
  utf16SafeWindowEnd,
} from "../text-window.js";

export type { ContextAttachmentToolOptions } from "./context-attachment-access.js";
export {
  createInspectContextAttachmentArchiveTool,
  createInspectContextAttachmentTableTool,
  createReadContextAttachmentImageTool,
  createReadContextAttachmentTableTool,
};

const DEFAULT_MAX_CHARS = 128_000;
const MIN_CHARACTER_WINDOW_CHARS = 3;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const DEFAULT_PDF_MAX_CHARS = 128_000;

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
          "attachments[] contains attachmentId, kind, title, summary, MIME type, byte length, authorization, and supported operations.",
          "count is the number of returned attachments.",
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
        refId: "context-attachments:index",
        count: attachments.length,
        attachments,
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
          "Use continuation.nextInput to continue a truncated character or line window.",
          "maxLength applies to whole-file/startChar reads; do not combine maxLength with startLine/endLine.",
          "Do not use for images, PDFs, archives, spreadsheets, or binary files; the tool will return non-text metadata instead of content.",
          "Local absolute paths are not accepted as input and are not returned in output.",
        ],
        outputNotes: [
          "content contains UTF-8 text when the attachment target is readable text.",
          "binary or readable=false means the attachment cannot be read as text by this tool.",
          "path is relative to the attachment root for project attachments and never a local absolute path.",
          "hasMoreAfter reports whether more text exists; continuation.nextInput provides the executable next read.",
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
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative file path inside a project attachment." },
          maxLength: { type: "number", minimum: MIN_CHARACTER_WINDOW_CHARS, description: "Maximum characters to return; must be at least 3 so every truncated UTF-16 window can advance." },
          startLine: { type: "number", description: "Optional 1-based first line to return." },
          endLine: { type: "number", description: "Optional 1-based last line to return." },
          startChar: { type: "number", minimum: 0, description: "Optional zero-based character offset for continuing a truncated text window." },
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
          refId: `context-attachment:${entry.attachmentId}:text`,
          attachmentId: entry.attachmentId,
          kind: entry.ref.kind,
          title: attachmentTitle(entry),
          path: target.targetPath,
          mimeType: entry.ref.metadata?.mimeType,
          bytes: stat.size,
          readable: false,
          binary: true,
          reason: "binary_or_unsupported_text_format",
        };
      }
      const lineRange = parseLineRange(record);
      const hasStartChar = record.startChar !== undefined;
      const startChar = optionalSafeIntegerAtLeast(
        record.startChar,
        "read_context_attachment_text startChar",
        0,
      ) ?? 0;
      if (lineRange !== undefined && hasStartChar) {
        throw new Error("read_context_attachment_text cannot combine startChar with startLine/endLine.");
      }
      if (lineRange !== undefined && record.maxLength !== undefined) {
        throw new Error("read_context_attachment_text cannot combine maxLength with startLine/endLine; request a smaller line range instead.");
      }
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES && lineRange === undefined) {
        throw new Error("Attachment text target is too large to read safely without a line range.");
      }
      const maxLength = optionalSafeIntegerAtLeast(
        record.maxLength,
        "read_context_attachment_text maxLength",
        MIN_CHARACTER_WINDOW_CHARS,
      ) ?? DEFAULT_MAX_CHARS;
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
      const hasMoreAfter = content.hasMoreAfter || truncated;
      const continuation = nextStartChar !== undefined
        ? {
            nextInput: compactRecord({
              attachmentId: entry.attachmentId,
              path: target.targetPath,
              startChar: nextStartChar,
              maxLength,
            }),
          }
        : hasMoreAfter && content.range !== undefined
          ? {
              nextInput: compactRecord({
                attachmentId: entry.attachmentId,
                path: target.targetPath,
                startLine: content.range.endLine + 1,
              }),
            }
          : undefined;
      return {
        refId: `context-attachment:${entry.attachmentId}:text`,
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
        hasMoreAfter,
        startChar: content.startChar,
        textChars: content.startChar === undefined ? undefined : returnedTextChars,
        charCount: content.charCount,
        truncated: hasMoreAfter,
        continuation,
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
          "readable=true means bounded PDF text was extracted for the model.",
          "content contains best-effort text, with hasMoreAfter/truncated indicating whether content was clipped.",
          "continuation.nextInput provides the executable next PDF text window when truncated is true.",
          "reason explains unsupported, scanned, encrypted, or unreadable PDF cases without returning local paths.",
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
      },
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string", description: "Attachment id from Task Soil context, preferred over ref." },
          ref: { type: "string", description: "Exact non-local context ref when attachmentId is unavailable." },
          path: { type: "string", description: "Relative PDF path inside a project attachment." },
          maxLength: { type: "number", minimum: MIN_CHARACTER_WINDOW_CHARS, description: "Maximum extracted characters to return; must be at least 3." },
          startChar: { type: "number", minimum: 0, description: "Zero-based extracted-text character offset for continuing a truncated PDF read." },
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
      const buffer = await fs.readFile(target.targetAbsolutePath, { signal: context.abortSignal }).catch(() => undefined);
      throwIfAborted(context.abortSignal);
      if (buffer === undefined) {
        return unsupportedPdfResult({
          entry,
          target,
          reason: "pdf_file_unreadable",
          bytes: stat.size,
        });
      }
      const extracted = await extractPdfText(buffer, context.abortSignal).catch((error: unknown) => {
        throwIfAborted(context.abortSignal);
        return {
          text: "",
          reason: pdfReadErrorReason(error),
          facts: { pageCount: 0, textItems: 0 },
        };
      });
      if (extracted.text.length === 0) {
        return unsupportedPdfResult({
          entry,
          target,
          reason: extracted.reason ?? "no_extractable_pdf_text",
          bytes: stat.size,
          facts: extracted.facts,
        });
      }
      const maxLength = optionalSafeIntegerAtLeast(
        record.maxLength,
        "read_context_attachment_pdf_text maxLength",
        MIN_CHARACTER_WINDOW_CHARS,
      ) ?? DEFAULT_PDF_MAX_CHARS;
      const startChar = optionalSafeIntegerAtLeast(
        record.startChar,
        "read_context_attachment_pdf_text startChar",
        0,
      ) ?? 0;
      if (startChar > extracted.text.length) {
        throw new Error(
          `read_context_attachment_pdf_text startChar ${startChar} exceeds charCount ${extracted.text.length}.`,
        );
      }
      if (!isUtf16CodeUnitBoundary(extracted.text, startChar)) {
        throw new Error("read_context_attachment_pdf_text startChar must not split a UTF-16 surrogate pair.");
      }
      const endChar = utf16SafeWindowEnd(extracted.text, startChar, maxLength);
      const returned = extracted.text.slice(startChar, endChar);
      const hasMoreAfter = extracted.text.length > startChar + returned.length;
      const nextStartChar = hasMoreAfter ? startChar + returned.length : undefined;
      return {
        refId: `context-attachment:${entry.attachmentId}:pdf:${safeRefToken(target.targetPath)}`,
        attachmentId: entry.attachmentId,
        kind: entry.ref.kind,
        title: attachmentTitle(entry),
        path: target.targetPath,
        mimeType: entry.ref.metadata?.mimeType,
        bytes: stat.size,
        format: "pdf",
        readable: true,
        extraction: "pdfjs_text",
        content: returned,
        startChar,
        textChars: returned.length,
        charCount: extracted.text.length,
        hasMoreAfter,
        ...extracted.facts,
        truncated: hasMoreAfter,
        continuation: nextStartChar === undefined
          ? undefined
          : {
              nextInput: compactRecord({
                attachmentId: entry.attachmentId,
                path: target.targetPath,
                startChar: nextStartChar,
                maxLength,
              }),
            },
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
          "entries[] contains attachment-relative path, name, kind, byte size, and depth.",
          "totalEntries is the full enumerated count when traversal completes.",
          "hasMoreAfter reports whether more entries exist; continuation.nextInput provides the executable next page.",
          "If more entries exist beyond the supported offset range, the tool fails with entriesPreview and listingComplete=false.",
          "truncated=true only appears with an executable continuation.",
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
      const observation = {
        refId: `context-attachment:${entry.attachmentId}:files:${safeRefToken(target.targetPath)}`,
        attachmentId: entry.attachmentId,
        kind: entry.ref.kind,
        title: attachmentTitle(entry),
        path: target.targetPath,
        depth,
        offset,
        limit,
        maxDepth: MAX_LIST_DEPTH,
        maxEntries: MAX_LIST_ENTRIES,
        entriesReturned: listed.entries.length,
        totalEntries: listed.totalEntries,
        unreadableDirectories: listed.unreadableDirectories,
        unreadableSamples: listed.unreadableSamples,
        hasMoreAfter: continuation.hasMoreAfter,
        reachedOffsetCeiling: continuation.reachedOffsetCeiling,
        offsetCeiling: MAX_LIST_OFFSET,
      };
      if (continuation.reachedOffsetCeiling) {
        return {
          kind: "tool_call_result",
          result: {
            callId: context.toolCallId ?? "list_context_attachment_files",
            toolName: "list_context_attachment_files",
            input: input as ToolFactValue,
            output: {
              ...observation,
              entriesPreview: listed.entries,
              listingComplete: false,
            },
            status: "failed",
            error: "Attachment listing found more entries than can be continued within the supported offset range.",
            errorDomain: "runtime_error",
            errorFacts: {
              code: "context_attachment_list_continuation_limit_reached",
              retryable: false,
            },
          },
        };
      }
      return {
        ...observation,
        entries: listed.entries,
        listingComplete: !continuation.hasMoreAfter,
        truncated: continuation.hasMoreAfter,
        continuation: continuation.nextOffset === undefined
          ? undefined
          : {
              nextInput: compactRecord({
                attachmentId: entry.attachmentId,
                path: target.targetPath,
                depth,
                limit,
                offset: continuation.nextOffset,
              }),
            },
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
          "matches[] includes attachment-relative path, 1-based line, and preview.",
          "Skipped binary, too-large, unreadable, generated, or non-file entries are counted.",
          "hasMoreAfter reports whether more matches exist; continuation.nextInput provides the executable next page.",
          "If more matches exist beyond the supported offset range, the tool fails with matchesPreview and searchComplete=false.",
          "truncated=true only appears with an executable continuation.",
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
      const observation = {
        refId: `context-attachment:${entry.attachmentId}:search:${safeRefToken(query)}`,
        attachmentId: entry.attachmentId,
        kind: entry.ref.kind,
        title: attachmentTitle(entry),
        query,
        path: target.targetPath,
        offset,
        limit,
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
        reachedOffsetCeiling: continuation.reachedOffsetCeiling,
        offsetCeiling: MAX_SEARCH_OFFSET,
      };
      if (continuation.reachedOffsetCeiling) {
        return {
          kind: "tool_call_result",
          result: {
            callId: context.toolCallId ?? "search_context_attachment_files",
            toolName: "search_context_attachment_files",
            input: input as ToolFactValue,
            output: {
              ...observation,
              matchesPreview: matches,
              searchComplete: false,
            },
            status: "failed",
            error: "Attachment search found more matches than can be continued within the supported offset range.",
            errorDomain: "runtime_error",
            errorFacts: {
              code: "context_attachment_search_continuation_limit_reached",
              retryable: false,
            },
          },
        };
      }
      return {
        ...observation,
        matches,
        searchComplete: !continuation.hasMoreAfter,
        truncated: continuation.hasMoreAfter,
        continuation: continuation.nextOffset === undefined
          ? undefined
          : {
              nextInput: compactRecord({
                attachmentId: entry.attachmentId,
                query,
                path: target.targetPath,
                limit,
                offset: continuation.nextOffset,
              }),
            },
      };
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
  return {
    refId: `context-attachment:${input.entry.attachmentId}:pdf:${safeRefToken(input.target.targetPath)}`,
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
  };
}

function boundedOffset(value: unknown, maxOffset: number): number {
  return Math.min(maxOffset, Math.max(0, positiveInteger(value) ?? 0));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function compactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
