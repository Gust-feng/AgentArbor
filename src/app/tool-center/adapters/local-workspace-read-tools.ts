import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  isLikelyBinaryPath,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
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
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
  sandboxRequest,
} from "./local-workspace-sandbox.js";

const DEFAULT_MAX_CHARS = 128_000;
const MAX_LIST_ENTRIES = 200;
const MAX_GREP_MATCHES = 80;
const MAX_READ_LINE_COUNT = 2_000;
const DEFAULT_READ_LINE_COUNT = 200;
const RIPGREP_TIMEOUT_MS = 10_000;

type GrepMatch = { readonly path: string; readonly line: number; readonly preview: string };

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
          "maxLength optionally limits returned characters; omit it for the default preview budget.",
        ],
        outputNotes: [
          "result.content contains the returned text when the file is textual.",
          "result.binary is true when the file appears binary and no text content is returned.",
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
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 900,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          maxLength: { type: "number", description: "Maximum characters to return." },
          startLine: { type: "number", description: "Optional 1-based first line to return." },
          endLine: { type: "number", description: "Optional 1-based last line to return. When omitted with startLine, returns a bounded window." },
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
          action: "read_file",
          status: "completed",
          refId: `workspace:file:${target.relativePath}`,
          summary: `${target.relativePath} · ${stat.size} bytes · binary`,
          result: {
            path: target.relativePath,
            bytes: stat.size,
            binary: true,
          },
        };
      }
      const lineRange = parseLineRange(record);
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES && lineRange === undefined) {
        throw new Error(`File is too large to read safely without a line range: ${target.relativePath}`);
      }
      const maxLength = positiveInteger(record.maxLength) ?? DEFAULT_MAX_CHARS;
      const content = lineRange === undefined
        ? wholeFileContent(await fs.readFile(target.absolutePath, "utf8"))
        : stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES
          ? await readLineRange(target.absolutePath, lineRange)
          : sliceLines(await fs.readFile(target.absolutePath, "utf8"), lineRange);
      const truncated = content.content.length > maxLength;
      const returned = truncateText(content.content, maxLength);
      const rangeSummary = content.range === undefined
        ? ""
        : ` · lines ${content.range.startLine}-${content.range.endLine}${content.totalLines === undefined ? "" : ` of ${content.totalLines}`}`;
      return {
        action: "read_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes${rangeSummary}${truncated ? " · truncated" : ""}`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          content: returned,
          startLine: content.range?.startLine,
          endLine: content.range?.endLine,
          totalLines: content.totalLines,
          hasMoreBefore: content.hasMoreBefore,
          hasMoreAfter: content.hasMoreAfter || truncated,
        },
        truncated: truncated || content.hasMoreAfter,
      };
    },
  };
}

export function createLocalListDirTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "list_dir",
      description: "List files and folders under a local workspace directory. Returns names, kinds, and sizes.",
      modelContract: {
        usageNotes: [
          "List a workspace directory and return entry names, kinds, sizes, and total count.",
          "Use to discover project structure before reading or editing files.",
          "Use when the exact file path is unknown.",
          "Do not use for text search inside files; use grep_files for that.",
          "path is optional and defaults to the workspace root.",
          "limit optionally caps returned entries and cannot exceed the tool maximum.",
        ],
        outputNotes: [
          "result.entries contains directory entries with name, kind, and optional byte size.",
          "result.totalEntries is the full entry count for the directory.",
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
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1200,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative directory path. Defaults to workspace root." },
          limit: { type: "number", description: "Maximum entries to return." },
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
      const entries = await fs.readdir(target.absolutePath, { withFileTypes: true });
      const limit = Math.min(MAX_LIST_ENTRIES, positiveInteger(record.limit) ?? MAX_LIST_ENTRIES);
      const listed = await Promise.all(entries.slice(0, limit).map(async (entry) => {
        const absolutePath = path.join(target.absolutePath, entry.name);
        const stat = await fs.stat(absolutePath).catch(() => undefined);
        return {
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          bytes: stat?.isFile() === true ? stat.size : undefined,
        };
      }));
      const truncated = entries.length > listed.length;
      return {
        action: "list_dir",
        status: "completed",
        refId: `workspace:dir:${target.relativePath}`,
        summary: `${target.relativePath} · ${entries.length} entries${truncated ? " · truncated" : ""}`,
        result: {
          path: target.relativePath,
          entries: listed,
          totalEntries: entries.length,
        },
        truncated,
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
        ],
        outputNotes: [
          "result.matches[] includes path, 1-based line, and preview.",
          "truncated tells whether the match limit was reached.",
        ],
        runtimeHints: [
          { label: "workspace root", value: "current configured local workspace" },
          { label: "max matches", value: String(MAX_GREP_MATCHES) },
        ],
        examples: [
          { title: "Find a function name", input: { query: "createDesktopBasicToolRegistry", path: "src", limit: 20 } },
        ],
      },
      metadata: {
        category: "filesystem",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 1600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Plain-text query to search for, case-insensitive." },
          path: { type: "string", description: "Workspace-relative directory or file path. Defaults to workspace root." },
          limit: { type: "number", description: "Maximum matches to return." },
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
      const ripgrepMatches = await ripgrepSearch?.({
        absolutePath: target.absolutePath,
        rootDirectory,
        query,
        limit,
      }).catch(() => undefined);
      const matches: GrepMatch[] = [];
      const engine = ripgrepMatches === undefined ? "js" : "rg";
      if (ripgrepMatches === undefined) {
        await grepPath(target.absolutePath, rootDirectory, query.toLowerCase(), limit, matches);
      } else {
        matches.push(...ripgrepMatches.slice(0, limit));
      }
      const truncated = matches.length >= limit;
      return {
        action: "grep_files",
        status: "completed",
        refId: `workspace:grep:${target.relativePath}:${safeRefToken(query)}`,
        summary: `${target.relativePath} · ${matches.length} matches for ${query}${truncated ? " · truncated" : ""}`,
        result: {
          query,
          path: target.relativePath,
          engine,
          matches,
        },
        truncated,
      };
    },
  };
}

async function grepPath(
  absolutePath: string,
  rootDirectory: string,
  normalizedQuery: string,
  limit: number,
  matches: GrepMatch[]
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }
  const stat = await fs.stat(absolutePath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= limit) {
        return;
      }
      if (shouldSkipEntry(entry.name)) {
        continue;
      }
      await grepPath(path.join(absolutePath, entry.name), rootDirectory, normalizedQuery, limit, matches).catch(() => undefined);
    }
    return;
  }
  if (!stat.isFile() || stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES || isLikelyBinaryPath(absolutePath)) {
    return;
  }
  const raw = await fs.readFile(absolutePath, "utf8").catch(() => undefined);
  if (raw === undefined || raw.includes("\u0000")) {
    return;
  }
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

function wholeFileContent(raw: string): {
  readonly content: string;
  readonly range: undefined;
  readonly totalLines: number;
  readonly hasMoreBefore: false;
  readonly hasMoreAfter: false;
} {
  return {
    content: raw,
    range: undefined,
    totalLines: countLines(raw),
    hasMoreBefore: false,
    hasMoreAfter: false,
  };
}

function sliceLines(
  raw: string,
  range: { readonly startLine: number; readonly endLine: number }
): {
  readonly content: string;
  readonly range: { readonly startLine: number; readonly endLine: number };
  readonly totalLines: number;
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
} {
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

function countLines(raw: string): number {
  return raw.length === 0 ? 0 : raw.split(/\r?\n/).length;
}

async function readLineRange(
  absolutePath: string,
  range: { readonly startLine: number; readonly endLine: number }
): Promise<{
  readonly content: string;
  readonly range: { readonly startLine: number; readonly endLine: number };
  readonly totalLines?: number;
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
}> {
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
