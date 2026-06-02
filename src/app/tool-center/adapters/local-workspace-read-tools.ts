import { promises as fs } from "node:fs";
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

const DEFAULT_MAX_CHARS = 20_000;
const MAX_LIST_ENTRIES = 200;
const MAX_GREP_MATCHES = 80;

export function createLocalReadFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "read_file",
      description: "Read a UTF-8 text file under the local workspace. Returns truncated content and file metadata.",
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
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES) {
        throw new Error(`File is too large to read safely: ${target.relativePath}`);
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
      const raw = await fs.readFile(target.absolutePath, "utf8");
      const maxLength = positiveInteger(record.maxLength) ?? DEFAULT_MAX_CHARS;
      const truncated = raw.length > maxLength;
      return {
        action: "read_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes${truncated ? " · truncated" : ""}`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          content: truncateText(raw, maxLength),
        },
        truncated,
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

export function createLocalGrepFilesTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "grep_files",
      description: "Search text files under the local workspace for a plain-text query. Returns matching file paths and line previews.",
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
      const matches: Array<{ readonly path: string; readonly line: number; readonly preview: string }> = [];
      await grepPath(target.absolutePath, rootDirectory, query.toLowerCase(), limit, matches);
      const truncated = matches.length >= limit;
      return {
        action: "grep_files",
        status: "completed",
        refId: `workspace:grep:${target.relativePath}:${safeRefToken(query)}`,
        summary: `${target.relativePath} · ${matches.length} matches for ${query}${truncated ? " · truncated" : ""}`,
        result: {
          query,
          path: target.relativePath,
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
  matches: Array<{ readonly path: string; readonly line: number; readonly preview: string }>
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
