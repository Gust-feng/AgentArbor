import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SandboxPolicy, SandboxPolicyRequest, ToolExecutor } from "../../../domain/tools/index.js";

const DEFAULT_MAX_CHARS = 20_000;
const MAX_LIST_ENTRIES = 200;
const MAX_GREP_MATCHES = 80;
const MAX_FILE_BYTES = 512_000;
const MAX_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_ROOT = process.cwd();
const BLOCKED_PATH_SEGMENTS = new Set([".git", "node_modules", "dist", "coverage", ".trellis"]);
const DEFAULT_ALLOWED_COMMANDS = new Set(["dir", "type", "echo", "where", "findstr", "fc", "git", "pnpm", "npm", "node", "python"]);

export type LocalWorkspaceToolOptions = {
  readonly sandboxPolicy?: SandboxPolicy;
};

export type LocalWorkspaceSandboxPolicyOptions = {
  readonly allowWrite?: boolean;
  readonly allowExecute?: boolean;
  readonly allowedCommands?: readonly string[];
  readonly blockedPathSegments?: readonly string[];
  readonly maxWriteBytes?: number;
  readonly maxCommandTimeoutMs?: number;
};

export class LocalSandboxPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalSandboxPolicyViolationError";
  }
}

export function createLocalWorkspaceSandboxPolicy(options: LocalWorkspaceSandboxPolicyOptions = {}): SandboxPolicy {
  const allowWrite = options.allowWrite ?? true;
  const allowExecute = options.allowExecute ?? true;
  const allowedCommands = new Set((options.allowedCommands ?? [...DEFAULT_ALLOWED_COMMANDS]).map(normalizeCommandName));
  const blockedPathSegments = new Set((options.blockedPathSegments ?? [...BLOCKED_PATH_SEGMENTS]).map((segment) => segment.toLowerCase()));
  const maxWriteBytes = options.maxWriteBytes ?? MAX_FILE_BYTES;
  const maxCommandTimeoutMs = options.maxCommandTimeoutMs ?? MAX_COMMAND_TIMEOUT_MS;

  return {
    check(request: SandboxPolicyRequest) {
      const pathDecision = checkSandboxPath(request, blockedPathSegments);
      if (!pathDecision.allowed) {
        return pathDecision;
      }
      if ((request.operation === "write" || request.operation === "edit") && !allowWrite) {
        return deny("write_disabled", "Sandbox policy does not allow local file writes.");
      }
      if ((request.operation === "write" || request.operation === "edit") && (request.bytes ?? 0) > maxWriteBytes) {
        return deny("write_too_large", "Sandbox policy rejected a large local file write.");
      }
      if (request.operation === "execute") {
        if (!allowExecute) {
          return deny("execute_disabled", "Sandbox policy does not allow local command execution.");
        }
        const rawCommand = request.command ?? "";
        if (hasPathSeparator(rawCommand)) {
          return deny("command_path_rejected", "Sandbox policy requires a bare command name.");
        }
        const command = normalizeCommandName(rawCommand);
        if (command.length === 0 || !allowedCommands.has(command)) {
          return deny("command_not_allowed", `Sandbox policy rejected command: ${request.command ?? ""}.`);
        }
        const args = request.args ?? [];
        const commandDecision = checkCommandArgs(command, args, maxCommandTimeoutMs);
        if (!commandDecision.allowed) {
          return commandDecision;
        }
      }
      return { allowed: true };
    },
  };
}

export function createLocalReadFileTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
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
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`File is too large to read safely: ${target.relativePath}`);
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

export function createLocalListDirTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
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

export function createLocalGrepFilesTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
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

export function createLocalWriteFileTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file under the local workspace. Returns the written path and byte size.",
      metadata: {
        category: "filesystem",
        riskLevel: "high",
        operationType: "read-write",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Text content to write." },
          append: { type: "boolean", description: "If true, append to the file instead of overwriting." },
        },
        required: ["path", "content"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const content = requireText(record.content, "content", { allowEmpty: true });
      const append = record.append === true;
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("write", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      if (append) {
        await fs.appendFile(target.absolutePath, content, "utf8");
      } else {
        await fs.writeFile(target.absolutePath, content, "utf8");
      }
      const stat = await fs.stat(target.absolutePath);
      return {
        action: "write_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · ${append ? "appended" : "written"}`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          append,
        },
        truncated: false,
      };
    },
  };
}

export function createLocalEditFileTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "edit_file",
      description: "Edit a UTF-8 text file under the local workspace by replacing an exact match. Returns previous and new sizes.",
      metadata: {
        category: "filesystem",
        riskLevel: "high",
        operationType: "read-write",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          oldText: { type: "string", description: "Exact existing text to replace." },
          newText: { type: "string", description: "Replacement text." },
        },
        required: ["path", "oldText", "newText"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const oldText = requireText(record.oldText, "oldText", { allowEmpty: false });
      const newText = requireText(record.newText, "newText", { allowEmpty: true });
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("edit", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(newText, "utf8"),
      }));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`edit_file expects a file path: ${target.relativePath}`);
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`File is too large to edit safely: ${target.relativePath}`);
      }
      const original = await fs.readFile(target.absolutePath, "utf8");
      const occurrences = countOccurrences(original, oldText);
      if (occurrences === 0) {
        throw new Error(`oldText was not found in ${target.relativePath}.`);
      }
      if (occurrences > 1) {
        throw new Error(`oldText matched ${occurrences} times in ${target.relativePath}; provide a more specific match.`);
      }
      const updated = original.replace(oldText, newText);
      await fs.writeFile(target.absolutePath, updated, "utf8");
      return {
        action: "edit_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${original.length} -> ${updated.length} chars · 1 replacement`,
        result: {
          path: target.relativePath,
          previousLength: original.length,
          nextLength: updated.length,
          replacements: 1,
        },
        truncated: false,
      };
    },
  };
}

export function createLocalRunCommandTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "run_command",
      description: "Run a safe workspace command under the local workspace root. Intended for low-risk verification commands like dir or type.",
      metadata: {
        category: "terminal",
        riskLevel: "high",
        operationType: "execute",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Executable name or command to run." },
          args: { type: "array", items: { type: "string" }, description: "Command arguments." },
          timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
        },
        required: ["command"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const command = requireString(record.command, "command");
      const args = toStringArray(record.args);
      const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT_MS, positiveInteger(record.timeoutMs) ?? 10_000);
      assertSandboxAllowed(sandboxPolicy, {
        operation: "execute",
        workspaceRoot: path.resolve(rootDirectory),
        command,
        args,
        bytes: timeoutMs,
      });
      const builtin = await runInternalWorkspaceCommand(normalizeCommandName(command), args, rootDirectory, sandboxPolicy);
      if (builtin !== undefined) {
        return commandToolOutput(command, args, builtin, false);
      }
      const result = await new Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>((resolve, reject) => {
        const child = execFile(command, args, { cwd: rootDirectory, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
          if (error && typeof error.code === "number") {
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: error.code });
            return;
          }
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
        });
        context.abortSignal?.addEventListener("abort", () => {
          child.kill();
          resolve({ stdout: "", stderr: "Command execution cancelled.", exitCode: 130 });
        }, { once: true });
      });
      return commandToolOutput(command, args, result, false);
    },
  };
}

function sandboxRequest(
  operation: SandboxPolicyRequest["operation"],
  workspaceRoot: string,
  relativePath: string,
  extras: Partial<SandboxPolicyRequest> = {}
): SandboxPolicyRequest {
  return {
    operation,
    workspaceRoot: path.resolve(workspaceRoot),
    relativePath,
    ...extras,
  };
}

function assertSandboxAllowed(policy: SandboxPolicy, request: SandboxPolicyRequest): void {
  const decision = policy.check(request);
  if (!decision.allowed) {
    throw new LocalSandboxPolicyViolationError(decision.reason);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Tool execution cancelled.");
  }
}

function checkSandboxPath(
  request: SandboxPolicyRequest,
  blockedPathSegments: ReadonlySet<string>
): ReturnType<SandboxPolicy["check"]> {
  const relativePath = request.relativePath;
  if (relativePath === undefined || relativePath === ".") {
    return { allowed: true };
  }
  if (relativePath.includes("\u0000")) {
    return deny("invalid_path", "Sandbox policy rejected an invalid path.");
  }
  const segments = relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => blockedPathSegments.has(segment.toLowerCase()))) {
    return deny("blocked_path", `Sandbox policy rejected blocked workspace path: ${relativePath}.`);
  }
  if (request.operation !== "write" && request.operation !== "edit" && isLikelyBinaryPath(relativePath)) {
    return deny("binary_path", `Sandbox policy rejected likely binary file: ${relativePath}.`);
  }
  return { allowed: true };
}

function deny(code: string, reason: string): ReturnType<SandboxPolicy["check"]> {
  return { allowed: false, code, reason };
}

function checkCommandArgs(
  command: string,
  args: readonly string[],
  maxCommandTimeoutMs: number
): ReturnType<SandboxPolicy["check"]> {
  if (args.some((arg) => hasShellControlToken(arg))) {
    return deny("command_arg_rejected", "Sandbox policy rejected shell control tokens in command arguments.");
  }
  if (args.some((arg) => hasUnsafeWorkspaceArg(arg))) {
    return deny("command_arg_rejected", "Sandbox policy rejected arguments outside the local workspace boundary.");
  }
  if (command === "git") {
    const subcommand = firstNonOptionArg(args);
    return subcommand !== undefined && ["status", "diff", "show", "log", "ls-files", "branch"].includes(subcommand)
      ? { allowed: true }
      : deny("git_subcommand_rejected", "Sandbox policy only allows read-only git commands.");
  }
  if (command === "pnpm") {
    const allowed = isAllowedPackageScript(args, ["build", "test", "panel:smoke", "panel:desktop:smoke"]);
    return allowed ? { allowed: true } : deny("pnpm_command_rejected", "Sandbox policy only allows verification pnpm commands.");
  }
  if (command === "npm") {
    const allowed = isAllowedPackageScript(args, ["test"]);
    return allowed ? { allowed: true } : deny("npm_command_rejected", "Sandbox policy only allows verification npm commands.");
  }
  if (command === "node") {
    return args.length === 1 && args[0] === "--version"
      ? { allowed: true }
      : args[0] === "--test"
        ? { allowed: true }
        : deny("node_command_rejected", "Sandbox policy only allows node --version or node --test.");
  }
  if (command === "python") {
    return args.length === 1 && ["--version", "-V"].includes(args[0] ?? "")
      ? { allowed: true }
      : deny("python_command_rejected", "Sandbox policy only allows python version checks by default.");
  }
  if (command === "where" || command === "findstr" || command === "fc") {
    return { allowed: true };
  }
  if (command === "dir" || command === "type" || command === "echo") {
    return { allowed: true };
  }
  return maxCommandTimeoutMs > 0 ? { allowed: true } : deny("command_timeout_rejected", "Sandbox policy rejected command timeout.");
}

function normalizeCommandName(value: string): string {
  const normalized = path.basename(value).toLowerCase();
  return normalized.endsWith(".exe") || normalized.endsWith(".cmd") || normalized.endsWith(".bat")
    ? normalized.replace(/\.(exe|cmd|bat)$/i, "")
    : normalized;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\") || path.isAbsolute(value);
}

function hasShellControlToken(value: string): boolean {
  return /(?:&&|\|\||[;&|`$<>])/.test(value);
}

function hasUnsafeWorkspaceArg(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return (
    path.isAbsolute(trimmed) ||
    lower === "-c" ||
    lower.startsWith("--git-dir") ||
    lower.startsWith("--work-tree") ||
    lower.startsWith("--exec-path") ||
    lower.startsWith("..") ||
    lower.includes("/../") ||
    lower.includes("\\..\\")
  );
}

function firstNonOptionArg(args: readonly string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"))?.toLowerCase();
}

function isAllowedPackageScript(args: readonly string[], allowedScripts: readonly string[]): boolean {
  if (args.length === 1) {
    return allowedScripts.includes(args[0] ?? "");
  }
  if (args.length === 2 && args[0] === "run") {
    return allowedScripts.includes(args[1] ?? "");
  }
  return false;
}

async function runInternalWorkspaceCommand(
  command: string,
  args: readonly string[],
  rootDirectory: string,
  sandboxPolicy: SandboxPolicy
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number } | undefined> {
  if (command === "echo") {
    return { stdout: `${args.join(" ")}\n`, stderr: "", exitCode: 0 };
  }
  if (command === "dir") {
    const target = resolveWorkspacePath(rootDirectory, args[0] ?? ".");
    assertSandboxAllowed(sandboxPolicy, sandboxRequest("list", rootDirectory, target.relativePath));
    const entries = await fs.readdir(target.absolutePath, { withFileTypes: true });
    const stdout = entries
      .map((entry) => `${entry.isDirectory() ? "<DIR>" : "     "} ${entry.name}`)
      .join("\n");
    return { stdout: `${stdout}\n`, stderr: "", exitCode: 0 };
  }
  if (command === "type") {
    const paths = args.length === 0 ? ["."] : args;
    const chunks: string[] = [];
    for (const item of paths) {
      const target = resolveWorkspacePath(rootDirectory, item);
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("read", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        return { stdout: chunks.join("\n"), stderr: `type expects a file path: ${target.relativePath}`, exitCode: 1 };
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { stdout: chunks.join("\n"), stderr: `File is too large to type safely: ${target.relativePath}`, exitCode: 1 };
      }
      chunks.push(await fs.readFile(target.absolutePath, "utf8"));
    }
    return { stdout: chunks.join("\n"), stderr: "", exitCode: 0 };
  }
  return undefined;
}

function commandToolOutput(
  command: string,
  args: readonly string[],
  result: { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  truncated: boolean
): {
  readonly action: "run_command";
  readonly status: "completed";
  readonly refId: string;
  readonly summary: string;
  readonly result: {
    readonly command: string;
    readonly args: readonly string[];
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  readonly truncated: boolean;
} {
  const stdout = truncateText(result.stdout, 8_000);
  const stderr = truncateText(result.stderr, 2_000);
  return {
    action: "run_command",
    status: "completed",
    refId: `workspace:command:${safeRefToken(command)}`,
    summary: `${command} ${args.join(" ")}`.trim() + ` · exit ${result.exitCode}`,
    result: {
      command,
      args,
      exitCode: result.exitCode,
      stdout,
      stderr,
    },
    truncated: truncated || stdout.length < result.stdout.length || stderr.length < result.stderr.length,
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
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES || isLikelyBinaryPath(absolutePath)) {
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

function resolveWorkspacePath(rootDirectory: string, requestedPath: string): { readonly absolutePath: string; readonly relativePath: string } {
  const root = path.resolve(rootDirectory);
  const absolutePath = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace boundary.");
  }
  return {
    absolutePath,
    relativePath: relative.length === 0 ? "." : normalizePath(relative),
  };
}

function toWorkspaceRelative(rootDirectory: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootDirectory), absolutePath);
  return relative.length === 0 ? "." : normalizePath(relative);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function safeRefToken(value: string): string {
  const token = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return token.length === 0 ? "query" : token;
}

function shouldSkipEntry(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "coverage" || name === ".trellis";
}

function isLikelyBinaryPath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dll|bin|lock)$/i.test(value);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function requireString(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return text;
}

function requireText(value: unknown, fieldName: string, options: { readonly allowEmpty: boolean }): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

function countOccurrences(source: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }
  let count = 0;
  let position = 0;
  while (position <= source.length - search.length) {
    const index = source.indexOf(search, position);
    if (index === -1) {
      break;
    }
    count += 1;
    position = index + search.length;
  }
  return count;
}
