import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { ToolExecutor, ToolFactValue } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  isLikelyBinaryPath,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
  optionalSafeIntegerAtLeast,
  positiveInteger,
  resolveWorkspacePath,
  safeRefToken,
  shouldSkipEntry,
  stringOrFallback,
  throwIfAborted,
  toWorkspaceRelative,
  truncateText,
  type LocalWorkspaceToolOptions,
} from "./local-workspace-common.js";
import {
  isUtf16CodeUnitBoundary,
  utf16SafePrefixLength,
} from "../text-window.js";
import { DEFAULT_MAX_INLINE_TOOL_CONTENT_JSON_CHARS } from "../tool-output-limits.js";
import {
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
  sandboxRequest,
} from "./local-workspace-sandbox.js";

const DEFAULT_MAX_CHARS = 128_000;
const MIN_CHARACTER_WINDOW_CHARS = 3;
const READ_FILE_CONTENT_JSON_MAX_CHARS = DEFAULT_MAX_INLINE_TOOL_CONTENT_JSON_CHARS;
const MAX_LIST_ENTRIES = 200;
const DEFAULT_LIST_DEPTH = 1;
const MAX_LIST_DEPTH = 3;
const MAX_GREP_MATCHES = 80;
const MAX_GREP_OFFSET = 10_000;
const MAX_GREP_COLLECT_LIMIT = MAX_GREP_OFFSET + MAX_GREP_MATCHES + 1;
const MAX_SKIPPED_SAMPLES = 8;
const MAX_READ_LINE_COUNT = 2_000;
const DEFAULT_READ_LINE_COUNT = 200;
const RIPGREP_TIMEOUT_MS = 10_000;

type GrepMatch = { readonly path: string; readonly line: number; readonly preview: string };
type ListDirEntry = {
  readonly path: string;
  readonly name: string;
  readonly kind: "directory" | "file" | "symlink" | "other";
  readonly bytes?: number;
  readonly depth: number;
};

type ReadContentWindow = {
  readonly content: string;
  readonly range?: { readonly startLine: number; readonly endLine: number };
  readonly totalLines?: number;
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
  readonly startChar?: number;
  readonly textChars?: number;
  readonly charCount?: number;
  readonly nextStartChar?: number;
};

type GrepSkippedReason =
  | "binary"
  | "too_large"
  | "unreadable"
  | "skipped_directory"
  | "skipped_entry"
  | "not_file";

type GrepSkippedSample = {
  readonly path: string;
  readonly reason: GrepSkippedReason;
  readonly bytes?: number;
  readonly errorCode?: string;
};

type GrepFacts = {
  searchedFiles: number;
  skippedFiles: number;
  skippedBinaryFiles: number;
  skippedTooLargeFiles: number;
  skippedUnreadableFiles: number;
  skippedDirectories: number;
  skippedOtherEntries: number;
  skippedSamples: GrepSkippedSample[];
  skippedFactsComplete: boolean;
};

export type LocalWorkspaceReadToolOptions = LocalWorkspaceToolOptions & {
  readonly ripgrepSearch?: RipgrepSearchRunner | false;
};

export type RipgrepSearchRunner = (request: {
  readonly absolutePath: string;
  readonly rootDirectory: string;
  readonly query: string;
  readonly limit: number;
}) => Promise<readonly GrepMatch[] | undefined>;

export function createLocalReadFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "read_file",
      description: "Read a UTF-8 text file under the local workspace. Supports optional 1-based startLine/endLine windows for large or focused reads.",
      modelContract: {
        usageNotes: [
          "Read a workspace-relative UTF-8 text file and return content plus file metadata.",
          "Use when you need exact file contents before explaining, editing, or debugging.",
          "Use after list_dir or grep_files identifies a relevant file.",
          "Do not use for binary files or files larger than the workspace file-size limit.",
          "path is required and must be workspace-relative.",
          "Use startLine/endLine for focused reads or to continue through a large file.",
          "Use continuation.nextInput to continue a truncated character or line window.",
          "maxLength optionally limits returned characters for whole-file/startChar reads; do not combine maxLength with startLine/endLine.",
        ],
        outputNotes: [
          "content contains the returned text when the file is textual.",
          "binary is true when the file appears binary and no text content is returned.",
          "hasMoreAfter reports whether more text exists; continuation.nextInput provides the executable next read.",
          "truncated tells whether more content may be needed.",
        ],
        runtimeHints: [
          { label: "workspace root", value: "current configured local workspace" },
          { label: "max file bytes", value: String(MAX_LOCAL_WORKSPACE_FILE_BYTES) },
        ],
        examples: [
          { title: "Read source file", input: { path: "src/app/example.ts", maxLength: 20000 } },
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
          path: { type: "string", description: "Workspace-relative file path." },
          maxLength: { type: "number", minimum: MIN_CHARACTER_WINDOW_CHARS, description: "Maximum characters to return; must be at least 3 so every truncated UTF-16 window can advance." },
          startLine: { type: "number", description: "Optional 1-based first line to return." },
          endLine: { type: "number", description: "Optional 1-based last line to return. When omitted with startLine, returns a bounded window." },
          startChar: { type: "number", minimum: 0, description: "Optional zero-based character offset for continuing a truncated text window." },
        },
        required: ["path"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("read", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`read_file expects a file path: ${target.relativePath}`);
      }
      const probe = Buffer.alloc(Math.min(stat.size, 8192));
      const handle = await fs.open(target.absolutePath, "r");
      try {
        await handle.read(probe, 0, probe.length, 0);
      } finally {
        await handle.close();
      }
      if (probe.includes(0)) {
        return {
          refId: `workspace:file:${target.relativePath}`,
          path: target.relativePath,
          bytes: stat.size,
          binary: true,
        };
      }
      const lineRange = parseLineRange(record);
      const startChar = optionalSafeIntegerAtLeast(record.startChar, "read_file startChar", 0);
      if (lineRange !== undefined && startChar !== undefined) {
        throw new Error("read_file cannot combine startChar with startLine/endLine.");
      }
      if (lineRange !== undefined && record.maxLength !== undefined) {
        throw new Error("read_file cannot combine maxLength with startLine/endLine; request a smaller line range instead.");
      }
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES && lineRange === undefined) {
        throw new Error(`File is too large to read safely without a line range: ${target.relativePath}`);
      }
      const maxLength = optionalSafeIntegerAtLeast(
        record.maxLength,
        "read_file maxLength",
        MIN_CHARACTER_WINDOW_CHARS,
      ) ?? DEFAULT_MAX_CHARS;
      const content = lineRange === undefined
        ? charWindowContent(await fs.readFile(target.absolutePath, "utf8"), startChar ?? 0)
        : stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES
          ? await readLineRange(target.absolutePath, lineRange)
          : sliceLines(await fs.readFile(target.absolutePath, "utf8"), lineRange);
      const returned = truncateReadFileContent(content.content, maxLength);
      if (lineRange !== undefined && returned.truncated) {
        throw new Error("read_file line range exceeds the text return budget; request fewer lines so continuation does not skip unread text.");
      }
      const returnedTextChars = returned.rawChars;
      const nextStartChar = content.startChar === undefined
        ? undefined
        : content.content.length > returnedTextChars
          ? content.startChar + returnedTextChars
          : content.nextStartChar;
      const hasMoreAfter = content.hasMoreAfter || returned.truncated;
      const continuation = nextStartChar !== undefined
        ? { nextInput: { path: target.relativePath, startChar: nextStartChar, maxLength } }
        : hasMoreAfter && content.range !== undefined
          ? { nextInput: { path: target.relativePath, startLine: content.range.endLine + 1 } }
          : undefined;
      return {
        refId: `workspace:file:${target.relativePath}`,
        path: target.relativePath,
        bytes: stat.size,
        content: returned.text,
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

export function createLocalListDirTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "list_dir",
      description: "List files and folders under a local workspace directory. Returns factual path, name, kind, size, and depth metadata.",
      modelContract: {
        usageNotes: [
          "List a workspace directory and return entry paths, names, kinds, byte sizes, depths, and counts.",
          "Use to discover project structure before reading or editing files.",
          "Use when the exact file path is unknown.",
          "Do not use for text search inside files; use grep_files for that.",
          "path is optional and defaults to the workspace root.",
          "depth defaults to 1 and cannot exceed 3.",
          "limit optionally caps returned entries and cannot exceed the tool maximum.",
          "offset optionally continues a previously truncated listing.",
        ],
        outputNotes: [
          "entries contains directory entries with path, name, kind, bytes, and depth.",
          "totalEntries is the full enumerated entry count when traversal completes.",
          "hasMoreAfter reports whether more entries exist; continuation.nextInput provides the executable next page.",
          "truncated tells whether not all entries were returned.",
        ],
        runtimeHints: [
          { label: "workspace root", value: "current configured local workspace" },
          { label: "max entries", value: String(MAX_LIST_ENTRIES) },
        ],
        examples: [
          { title: "List root", input: { path: ".", limit: 80 } },
          { title: "List source directory", input: { path: "src/app" } },
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
          path: { type: "string", description: "Workspace-relative directory path. Defaults to workspace root." },
          depth: { type: "number", description: "Recursive listing depth. Defaults to 1 and is capped at 3." },
          limit: { type: "number", description: "Maximum entries to return." },
          offset: { type: "number", description: "Zero-based entry offset used to continue a truncated listing." },
        },
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, "."));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("list", rootDirectory, target.relativePath));
      const targetStat = await fs.stat(target.absolutePath);
      if (!targetStat.isDirectory()) {
        throw new Error(`list_dir expects a directory path: ${target.relativePath}`);
      }
      const requestedDepth = positiveInteger(record.depth) ?? DEFAULT_LIST_DEPTH;
      const depth = Math.min(MAX_LIST_DEPTH, requestedDepth);
      const limit = Math.min(MAX_LIST_ENTRIES, positiveInteger(record.limit) ?? MAX_LIST_ENTRIES);
      const offset = nonNegativeInteger(record.offset) ?? 0;
      const listed = await listDirectoryTree({
        absolutePath: target.absolutePath,
        rootDirectory,
        maxDepth: depth,
        limit,
        offset,
      });
      const nextOffset = listed.hasMoreAfter ? offset + listed.entries.length : undefined;
      return {
        refId: `workspace:dir:${target.relativePath}`,
        path: target.relativePath,
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
        hasMoreAfter: listed.hasMoreAfter,
        truncated: listed.hasMoreAfter,
        continuation: nextOffset === undefined
          ? undefined
          : { nextInput: { path: target.relativePath, depth, limit, offset: nextOffset } },
      };
    },
  };
}

export function createLocalGrepFilesTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceReadToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  const ripgrepSearch = options.ripgrepSearch === false ? undefined : options.ripgrepSearch ?? searchWithRipgrep;
  return {
    definition: {
      name: "grep_files",
      description: "Search text files under the local workspace for a plain-text query. Uses ripgrep when available, with a JS recursive fallback.",
      modelContract: {
        usageNotes: [
          "Search workspace text files for a case-insensitive plain-text query and return file paths with line previews.",
          "Use to locate code, docs, symbols, or phrases before reading files.",
          "Use when you need line numbers and previews for likely matches.",
          "Do not use for regular expressions; this tool searches plain text only.",
          "Do not use for binary files or generated folders skipped by the workspace search.",
          "query is required and must be non-empty.",
          "path optionally narrows search to a workspace-relative directory or file.",
          "limit optionally caps returned matches.",
          "offset optionally continues a previously truncated search with the same query/path and is capped to the tool maximum.",
        ],
        outputNotes: [
          "matches[] includes path, 1-based line, and preview.",
          "engine records whether ripgrep or the JS fallback produced the result.",
          "The JS fallback reports factual skipped file counts and samples. The ripgrep path leaves skipped facts unavailable rather than inventing them.",
          "hasMoreAfter reports whether more matches exist; continuation.nextInput provides the executable next page.",
          "If more matches exist beyond the supported offset range, the tool fails with the observed matchesPreview and searchComplete=false.",
          "truncated=true only appears with an executable continuation.",
        ],
        runtimeHints: [
          { label: "workspace root", value: "current configured local workspace" },
          { label: "max matches", value: String(MAX_GREP_MATCHES) },
          { label: "max offset", value: String(MAX_GREP_OFFSET) },
        ],
        examples: [
          { title: "Find a function name", input: { query: "createAgentToolRegistry", path: "src", limit: 20 } },
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
          query: { type: "string", description: "Plain-text query to search for, case-insensitive." },
          path: { type: "string", description: "Workspace-relative directory or file path. Defaults to workspace root." },
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
        throw new Error("grep_files requires a non-empty query.");
      }
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, "."));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("search", rootDirectory, target.relativePath));
      const limit = Math.min(MAX_GREP_MATCHES, positiveInteger(record.limit) ?? MAX_GREP_MATCHES);
      const offset = boundedOffset(record.offset, MAX_GREP_OFFSET);
      const collectLimit = Math.min(MAX_GREP_COLLECT_LIMIT, offset + limit + 1);
      const ripgrepMatches = await ripgrepSearch?.({
        absolutePath: target.absolutePath,
        rootDirectory,
        query,
        limit: collectLimit,
      }).catch(() => undefined);
      const matches: GrepMatch[] = [];
      let grepFacts: GrepFacts | undefined;
      const engine = ripgrepMatches === undefined ? "js" : "rg";
      if (ripgrepMatches === undefined) {
        grepFacts = createGrepFacts();
        await grepPath(target.absolutePath, rootDirectory, query.toLowerCase(), collectLimit, matches, grepFacts);
        grepFacts.skippedFactsComplete = matches.length < collectLimit;
      } else {
        matches.push(...ripgrepMatches.slice(0, collectLimit));
      }
      const returnedMatches = matches.slice(offset, offset + limit);
      const hasMoreAfter = matches.length > offset + returnedMatches.length;
      const rawNextOffset = hasMoreAfter ? offset + returnedMatches.length : undefined;
      const nextOffset = rawNextOffset !== undefined && rawNextOffset <= MAX_GREP_OFFSET
        ? rawNextOffset
        : undefined;
      const reachedOffsetCeiling = hasMoreAfter && nextOffset === undefined;
      const observation = {
        refId: `workspace:grep:${target.relativePath}:${safeRefToken(query)}`,
        query,
        path: target.relativePath,
        engine,
        offset,
        limit,
        maxOffset: MAX_GREP_OFFSET,
        offsetCeiling: MAX_GREP_OFFSET,
        matchesReturned: returnedMatches.length,
        hasMoreAfter,
        reachedOffsetCeiling,
        searchedFiles: grepFacts?.searchedFiles,
        skippedFactsAvailable: grepFacts !== undefined,
        skippedFactsComplete: grepFacts?.skippedFactsComplete,
        skippedFiles: grepFacts?.skippedFiles,
        skippedBinaryFiles: grepFacts?.skippedBinaryFiles,
        skippedTooLargeFiles: grepFacts?.skippedTooLargeFiles,
        skippedUnreadableFiles: grepFacts?.skippedUnreadableFiles,
        skippedDirectories: grepFacts?.skippedDirectories,
        skippedOtherEntries: grepFacts?.skippedOtherEntries,
        skippedSamples: grepFacts?.skippedSamples,
      };
      if (reachedOffsetCeiling) {
        return {
          kind: "tool_call_result",
          result: {
            callId: context.toolCallId ?? "grep_files",
            toolName: "grep_files",
            input: input as ToolFactValue,
            output: {
              ...observation,
              matchesPreview: returnedMatches,
              searchComplete: false,
            },
            status: "failed",
            error: "grep_files found more matches than can be continued within the supported offset range.",
            errorDomain: "runtime_error",
            errorFacts: {
              code: "grep_files_continuation_limit_reached",
              retryable: false,
            },
          },
        };
      }
      return {
        ...observation,
        matches: returnedMatches,
        searchComplete: !hasMoreAfter,
        truncated: hasMoreAfter,
        continuation: nextOffset === undefined
          ? undefined
          : { nextInput: { query, path: target.relativePath, limit, offset: nextOffset } },
      };
    },
  };
}

async function listDirectoryTree(input: {
  readonly absolutePath: string;
  readonly rootDirectory: string;
  readonly maxDepth: number;
  readonly limit: number;
  readonly offset: number;
}): Promise<{
  readonly entries: readonly ListDirEntry[];
  readonly totalEntries: number;
  readonly unreadableDirectories: number;
  readonly unreadableSamples: readonly { readonly path: string; readonly errorCode?: string }[];
  readonly hasMoreAfter: boolean;
}> {
  const entries: ListDirEntry[] = [];
  const unreadableSamples: { path: string; errorCode?: string }[] = [];
  let totalEntries = 0;
  let unreadableDirectories = 0;

  async function visit(directory: string, currentDepth: number): Promise<void> {
    if (currentDepth >= input.maxDepth) {
      return;
    }
    const children = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      unreadableDirectories += 1;
      pushUnreadableDirectorySample(input.rootDirectory, directory, error, unreadableSamples);
      return undefined;
    });
    if (children === undefined) {
      return;
    }

    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absoluteChild = path.join(directory, child.name);
      const stat = await fs.stat(absoluteChild).catch(() => undefined);
      const entryDepth = currentDepth + 1;
      totalEntries += 1;
      const entryIndex = totalEntries - 1;
      if (entryIndex >= input.offset && entries.length < input.limit) {
        entries.push({
          path: toWorkspaceRelative(input.rootDirectory, absoluteChild),
          name: child.name,
          kind: directoryEntryKind(child),
          bytes: stat?.size,
          depth: entryDepth,
        });
      }
      if (child.isDirectory()) {
        await visit(absoluteChild, entryDepth);
      }
    }
  }

  await visit(input.absolutePath, 0);
  return {
    entries,
    totalEntries,
    unreadableDirectories,
    unreadableSamples,
    hasMoreAfter: totalEntries > input.offset + entries.length,
  };
}

function directoryEntryKind(entry: import("node:fs").Dirent): ListDirEntry["kind"] {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

function pushUnreadableDirectorySample(
  rootDirectory: string,
  absolutePath: string,
  error: unknown,
  samples: { path: string; errorCode?: string }[]
): void {
  if (samples.length >= MAX_SKIPPED_SAMPLES) {
    return;
  }
  samples.push({
    path: toWorkspaceRelative(rootDirectory, absolutePath),
    errorCode: nodeErrorCode(error),
  });
}

async function grepPath(
  absolutePath: string,
  rootDirectory: string,
  normalizedQuery: string,
  limit: number,
  matches: GrepMatch[],
  facts: GrepFacts,
  isRoot = true
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }
  const stat = await fs.stat(absolutePath).catch((error: unknown) => {
    if (isRoot) {
      throw error;
    }
    recordSkippedFile(facts, rootDirectory, absolutePath, "unreadable", undefined, error);
    return undefined;
  });
  if (stat === undefined) {
    return;
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch((error: unknown) => {
      if (isRoot) {
        throw error;
      }
      recordSkippedDirectory(facts, rootDirectory, absolutePath, "unreadable", error);
      return undefined;
    });
    if (entries === undefined) {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= limit) {
        return;
      }
      const childPath = path.join(absolutePath, entry.name);
      if (shouldSkipEntry(entry.name)) {
        if (entry.isDirectory()) {
          recordSkippedDirectory(facts, rootDirectory, childPath, "skipped_directory");
        } else if (entry.isFile()) {
          recordSkippedFile(facts, rootDirectory, childPath, "skipped_entry");
        } else {
          recordSkippedOtherEntry(facts, rootDirectory, childPath, "skipped_entry");
        }
        continue;
      }
      await grepPath(childPath, rootDirectory, normalizedQuery, limit, matches, facts, false);
    }
    return;
  }
  if (!stat.isFile()) {
    recordSkippedOtherEntry(facts, rootDirectory, absolutePath, "not_file", stat.size);
    return;
  }
  if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES) {
    recordSkippedFile(facts, rootDirectory, absolutePath, "too_large", stat.size);
    return;
  }
  if (isLikelyBinaryPath(absolutePath)) {
    recordSkippedFile(facts, rootDirectory, absolutePath, "binary", stat.size);
    return;
  }
  const raw = await fs.readFile(absolutePath, "utf8").catch((error: unknown) => {
    recordSkippedFile(facts, rootDirectory, absolutePath, "unreadable", stat.size, error);
    return undefined;
  });
  if (raw === undefined) {
    return;
  }
  if (raw.includes("\u0000")) {
    recordSkippedFile(facts, rootDirectory, absolutePath, "binary", stat.size);
    return;
  }
  facts.searchedFiles += 1;
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
    const line = lines[index] ?? "";
    if (line.toLowerCase().includes(normalizedQuery)) {
      matches.push({
        path: toWorkspaceRelative(rootDirectory, absolutePath),
        line: index + 1,
        preview: truncateText(line.trim(), 500),
      });
    }
  }
}

function createGrepFacts(): GrepFacts {
  return {
    searchedFiles: 0,
    skippedFiles: 0,
    skippedBinaryFiles: 0,
    skippedTooLargeFiles: 0,
    skippedUnreadableFiles: 0,
    skippedDirectories: 0,
    skippedOtherEntries: 0,
    skippedSamples: [],
    skippedFactsComplete: true,
  };
}

function recordSkippedFile(
  facts: GrepFacts,
  rootDirectory: string,
  absolutePath: string,
  reason: GrepSkippedReason,
  bytes?: number,
  error?: unknown
): void {
  facts.skippedFiles += 1;
  if (reason === "binary") facts.skippedBinaryFiles += 1;
  if (reason === "too_large") facts.skippedTooLargeFiles += 1;
  if (reason === "unreadable") facts.skippedUnreadableFiles += 1;
  pushSkippedSample(facts, rootDirectory, absolutePath, reason, bytes, error);
}

function recordSkippedDirectory(
  facts: GrepFacts,
  rootDirectory: string,
  absolutePath: string,
  reason: GrepSkippedReason,
  error?: unknown
): void {
  facts.skippedDirectories += 1;
  pushSkippedSample(facts, rootDirectory, absolutePath, reason, undefined, error);
}

function recordSkippedOtherEntry(
  facts: GrepFacts,
  rootDirectory: string,
  absolutePath: string,
  reason: GrepSkippedReason,
  bytes?: number,
  error?: unknown
): void {
  facts.skippedOtherEntries += 1;
  pushSkippedSample(facts, rootDirectory, absolutePath, reason, bytes, error);
}

function pushSkippedSample(
  facts: GrepFacts,
  rootDirectory: string,
  absolutePath: string,
  reason: GrepSkippedReason,
  bytes?: number,
  error?: unknown
): void {
  if (facts.skippedSamples.length >= MAX_SKIPPED_SAMPLES) {
    return;
  }
  facts.skippedSamples.push({
    path: toWorkspaceRelative(rootDirectory, absolutePath),
    reason,
    bytes,
    errorCode: nodeErrorCode(error),
  });
}

function nodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function parseLineRange(record: Readonly<Record<string, unknown>>): { readonly startLine: number; readonly endLine: number } | undefined {
  const startLine = positiveInteger(record.startLine);
  const explicitEndLine = positiveInteger(record.endLine);
  if (startLine === undefined && explicitEndLine === undefined) {
    return undefined;
  }
  const start = startLine ?? 1;
  const end = explicitEndLine ?? start + DEFAULT_READ_LINE_COUNT - 1;
  if (end < start) {
    throw new Error("read_file endLine must be greater than or equal to startLine.");
  }
  if (end - start + 1 > MAX_READ_LINE_COUNT) {
    throw new Error(`read_file line range is too large; request at most ${MAX_READ_LINE_COUNT} lines at a time.`);
  }
  return { startLine: start, endLine: end };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function boundedOffset(value: unknown, maxOffset: number): number {
  return Math.min(maxOffset, nonNegativeInteger(value) ?? 0);
}

function charWindowContent(raw: string, requestedStartChar: number): ReadContentWindow {
  if (requestedStartChar > raw.length) {
    throw new Error(`read_file startChar ${requestedStartChar} exceeds charCount ${raw.length}.`);
  }
  const startChar = requestedStartChar;
  if (!isUtf16CodeUnitBoundary(raw, startChar)) {
    throw new Error("read_file startChar must not split a UTF-16 surrogate pair.");
  }
  return {
    content: raw.slice(startChar),
    range: undefined,
    totalLines: countLines(raw),
    hasMoreBefore: startChar > 0,
    hasMoreAfter: false,
    startChar,
    charCount: raw.length,
  };
}

function sliceLines(
  raw: string,
  range: { readonly startLine: number; readonly endLine: number }
): ReadContentWindow {
  const lines = raw.split(/\r?\n/);
  const selected = lines.slice(range.startLine - 1, range.endLine);
  const actualEndLine = selected.length === 0 ? range.startLine : range.startLine + selected.length - 1;
  return {
    content: selected.join("\n"),
    range: { startLine: range.startLine, endLine: actualEndLine },
    totalLines: lines.length,
    hasMoreBefore: range.startLine > 1,
    hasMoreAfter: actualEndLine < lines.length,
  };
}

function truncateReadFileContent(value: string, maxLength: number): {
  readonly text: string;
  readonly rawChars: number;
  readonly truncated: boolean;
} {
  if (value.length <= maxLength && JSON.stringify(value).length <= READ_FILE_CONTENT_JSON_MAX_CHARS) {
    return { text: value, rawChars: value.length, truncated: false };
  }

  const maxRawChars = Math.max(0, Math.min(value.length, maxLength - 1));
  let low = 0;
  let high = maxRawChars;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, middle)}…`;
    if (JSON.stringify(candidate).length <= READ_FILE_CONTENT_JSON_MAX_CHARS) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const rawChars = utf16SafePrefixLength(value, low);
  return {
    text: `${value.slice(0, rawChars)}…`,
    rawChars,
    truncated: true,
  };
}

function countLines(raw: string): number {
  return raw.length === 0 ? 0 : raw.split(/\r?\n/).length;
}

async function readLineRange(
  absolutePath: string,
  range: { readonly startLine: number; readonly endLine: number }
): Promise<ReadContentWindow> {
  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  let lineNumber = 0;
  let hasMoreAfter = false;
  try {
    for await (const line of reader) {
      lineNumber += 1;
      if (lineNumber < range.startLine) {
        continue;
      }
      if (lineNumber > range.endLine) {
        hasMoreAfter = true;
        break;
      }
      lines.push(line);
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  const actualEndLine = lines.length === 0 ? range.startLine : range.startLine + lines.length - 1;
  return {
    content: lines.join("\n"),
    range: { startLine: range.startLine, endLine: actualEndLine },
    totalLines: hasMoreAfter ? undefined : lineNumber,
    hasMoreBefore: range.startLine > 1,
    hasMoreAfter,
  };
}

async function searchWithRipgrep(request: {
  readonly absolutePath: string;
  readonly rootDirectory: string;
  readonly query: string;
  readonly limit: number;
}): Promise<readonly GrepMatch[] | undefined> {
  const output = await runRipgrep(request).catch(() => undefined);
  if (output === undefined) {
    return undefined;
  }
  return parseRipgrepJson(output, request.rootDirectory, request.limit);
}

async function runRipgrep(request: {
  readonly absolutePath: string;
  readonly rootDirectory: string;
  readonly query: string;
}): Promise<string> {
  const args = [
    "--json",
    "--fixed-strings",
    "--ignore-case",
    "--line-number",
    "--color=never",
    "--hidden",
    "--max-filesize",
    String(MAX_LOCAL_WORKSPACE_FILE_BYTES),
    "--glob",
    "!node_modules/**",
    "--glob",
    "!dist/**",
    "--glob",
    "!coverage/**",
    "--glob",
    "!.git/**",
    "--",
    request.query,
    request.absolutePath,
  ];
  return new Promise((resolve, reject) => {
    execFile("rg", args, {
      cwd: request.rootDirectory,
      timeout: RIPGREP_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 16,
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException & { readonly code?: string | number }).code;
        if (String(code) === "1") {
          resolve(String(stdout ?? ""));
          return;
        }
        reject(error);
        return;
      }
      resolve(String(stdout ?? ""));
    });
  });
}

function parseRipgrepJson(value: string, rootDirectory: string, limit: number): readonly GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (matches.length >= limit || line.trim().length === 0) {
      continue;
    }
    const event = asRecord(parseJsonOrUndefined(line));
    if (event.type !== "match") {
      continue;
    }
    const data = asRecord(event.data);
    const pathText = stringOrFallback(asRecord(data.path).text, "");
    const lineNumber = positiveInteger(data.line_number);
    const lineText = stringOrFallback(asRecord(data.lines).text, "");
    if (pathText.length === 0 || lineNumber === undefined) {
      continue;
    }
    matches.push({
      path: toWorkspaceRelative(rootDirectory, path.isAbsolute(pathText) ? pathText : path.resolve(rootDirectory, pathText)),
      line: lineNumber,
      preview: truncateText(lineText.trim(), 500),
    });
  }
  return matches;
}

function parseJsonOrUndefined(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
