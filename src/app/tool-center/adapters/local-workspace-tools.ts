import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
      if ((request.operation === "write" || request.operation === "edit" || request.operation === "delete") && !allowWrite) {
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

export function createLocalCreateFileTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "create_file",
      description: "Create a new UTF-8 text file under the local workspace. Fails if the target already exists; never overwrites.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
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
          content: { type: "string", description: "UTF-8 text content to create." },
        },
        required: ["path", "content"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const content = requireText(record.content, "content", { allowEmpty: true });
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      if (target.relativePath === ".") {
        throw new Error("create_file expects a file path.");
      }
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("write", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      try {
        await fs.writeFile(target.absolutePath, content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new Error(`create_file target already exists: ${target.relativePath}.`);
        }
        throw error;
      }
      const stat = await fs.stat(target.absolutePath);
      const afterHash = sha256Hex(content);
      return {
        action: "create_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · created`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          afterHash,
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
      description: "Atomically edit a UTF-8 text file under the local workspace with exact anchor replacements. Every anchor must match exactly once.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
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
          edits: {
            type: "array",
            description: "Atomic edits. Each anchor is exact text to replace and must match exactly once.",
            items: {
              type: "object",
              properties: {
                anchor: { type: "string", description: "Exact existing text to replace. Must match once." },
                replacement: { type: "string", description: "Replacement text." },
                startLineHint: { type: "number", description: "Optional diagnostic hint only; not used to guess." },
                endLineHint: { type: "number", description: "Optional diagnostic hint only; not used to guess." },
              },
              required: ["anchor", "replacement"],
            },
          },
        },
        required: ["path", "edits"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const edits = parseAnchorEdits(record.edits);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("edit", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`edit_file expects a file path: ${target.relativePath}`);
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`File is too large to edit safely: ${target.relativePath}`);
      }
      const original = await fs.readFile(target.absolutePath, "utf8");
      const located = locateAnchorEdits(original, edits, target.relativePath);
      assertNoOverlappingEdits(located, target.relativePath);
      let updated = original;
      for (const edit of [...located].sort((left, right) => right.start - left.start)) {
        updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
      }
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("edit", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(updated, "utf8"),
      }));
      await fs.writeFile(target.absolutePath, updated, "utf8");
      const beforeHash = sha256Hex(original);
      const afterHash = sha256Hex(updated);
      return {
        action: "edit_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${original.length} -> ${updated.length} chars · ${located.length} replacements`,
        result: {
          path: target.relativePath,
          previousLength: original.length,
          nextLength: updated.length,
          replacements: located.length,
          beforeHash,
          afterHash,
          diffSummary: diffSummaryForEdits(original, located),
        },
        truncated: false,
      };
    },
  };
}

export function createLocalDeleteFileTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "delete_file",
      description: "Delete a regular file under the local workspace. Directory deletion is not supported.",
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
          path: { type: "string", description: "Workspace-relative file path to delete." },
        },
        required: ["path"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("delete", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`delete_file expects a regular file path: ${target.relativePath}`);
      }
      await fs.unlink(target.absolutePath);
      return {
        action: "delete_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · deleted`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
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
          command: { type: "string", description: "Executable name, or a simple shell-style command line without shell operators." },
          args: { type: "array", items: { type: "string" }, description: "Command arguments." },
          timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
        },
        required: ["command"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const { command, args } = normalizeRunCommandInput(record);
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

export function createLocalShellCommandTool(rootDirectory = DEFAULT_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const base = createLocalRunCommandTool(rootDirectory, options);
  return {
    definition: {
      ...base.definition,
      name: "shell_command",
      description: "Run a sandboxed shell-style workspace command. This is an alias of run_command with the same confirmation and allowlist policy.",
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
    },
    execute: async (input, context) => {
      const output = await base.execute(input, context);
      const record = asRecord(output);
      return {
        ...record,
        action: "shell_command",
        refId: typeof record.refId === "string" ? record.refId.replace("workspace:command:", "workspace:shell:") : "workspace:shell:command",
      };
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

function normalizeRunCommandInput(record: Readonly<Record<string, unknown>>): {
  readonly command: string;
  readonly args: readonly string[];
} {
  const rawCommand = requireString(record.command, "command");
  if (hasShellControlToken(rawCommand)) {
    throw new LocalSandboxPolicyViolationError("Sandbox policy rejected shell control tokens in command.");
  }
  const commandTokens = splitSimpleCommandLine(rawCommand);
  const command = commandTokens[0];
  if (command === undefined) {
    throw new Error("command must be a non-empty string.");
  }
  return {
    command,
    args: [...commandTokens.slice(1), ...toStringArray(record.args)],
  };
}

function splitSimpleCommandLine(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote !== undefined) {
    throw new LocalSandboxPolicyViolationError("Sandbox policy rejected an unterminated quoted command.");
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
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
  if (request.operation !== "write" && request.operation !== "edit" && request.operation !== "delete" && isLikelyBinaryPath(relativePath)) {
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

type AnchorEditInput = {
  readonly anchor: string;
  readonly replacement: string;
  readonly startLineHint?: number;
  readonly endLineHint?: number;
};

type LocatedAnchorEdit = AnchorEditInput & {
  readonly start: number;
  readonly end: number;
};

function parseAnchorEdits(value: unknown): readonly AnchorEditInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("edits must be a non-empty array.");
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    return {
      anchor: requireText(record.anchor, `edits[${index}].anchor`, { allowEmpty: false }),
      replacement: requireText(record.replacement, `edits[${index}].replacement`, { allowEmpty: true }),
      startLineHint: positiveInteger(record.startLineHint),
      endLineHint: positiveInteger(record.endLineHint),
    };
  });
}

function locateAnchorEdits(
  source: string,
  edits: readonly AnchorEditInput[],
  relativePath: string
): readonly LocatedAnchorEdit[] {
  return edits.map((edit, index) => {
    const matches = findAllOccurrences(source, edit.anchor);
    const hint = lineHintText(edit);
    if (matches.length === 0) {
      throw new Error(`edit_file anchor ${index + 1} was not found in ${relativePath}${hint}.`);
    }
    if (matches.length > 1) {
      throw new Error(`edit_file anchor ${index + 1} matched ${matches.length} times in ${relativePath}${hint}; provide a more specific anchor.`);
    }
    const start = matches[0]!;
    return {
      ...edit,
      start,
      end: start + edit.anchor.length,
    };
  });
}

function assertNoOverlappingEdits(edits: readonly LocatedAnchorEdit[], relativePath: string): void {
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.end > current.start) {
      throw new Error(`edit_file edits overlap in ${relativePath}; split or narrow the anchors.`);
    }
  }
}

function diffSummaryForEdits(source: string, edits: readonly LocatedAnchorEdit[]): readonly string[] {
  return edits
    .slice()
    .sort((left, right) => left.start - right.start)
    .map((edit) => {
      const line = lineNumberAt(source, edit.start);
      return `line ${line}: ${previewOneLine(edit.anchor)} -> ${previewOneLine(edit.replacement)}`;
    });
}

function findAllOccurrences(source: string, search: string): readonly number[] {
  const matches: number[] = [];
  let position = 0;
  while (position <= source.length - search.length) {
    const index = source.indexOf(search, position);
    if (index === -1) {
      break;
    }
    matches.push(index);
    position = index + search.length;
  }
  return matches;
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function lineHintText(edit: AnchorEditInput): string {
  const start = edit.startLineHint;
  const end = edit.endLineHint;
  if (start === undefined && end === undefined) {
    return "";
  }
  return ` near hinted lines ${start ?? "?"}-${end ?? start ?? "?"}`;
}

function previewOneLine(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
