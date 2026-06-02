import path from "node:path";
import type { SandboxPolicy, SandboxPolicyRequest } from "../../../domain/tools/index.js";

const MAX_FILE_BYTES = 512_000;
const MAX_COMMAND_TIMEOUT_MS = 30_000;
const BLOCKED_PATH_SEGMENTS = new Set([".git", "node_modules", "dist", "coverage", ".trellis"]);
const DEFAULT_ALLOWED_COMMANDS = new Set(["dir", "type", "echo", "where", "findstr", "fc", "git", "pnpm", "npm", "node", "python"]);

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

export function sandboxRequest(
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

export function assertSandboxAllowed(policy: SandboxPolicy, request: SandboxPolicyRequest): void {
  const decision = policy.check(request);
  if (!decision.allowed) {
    throw new LocalSandboxPolicyViolationError(decision.reason);
  }
}

export function normalizeRunCommandInput(record: Readonly<Record<string, unknown>>): {
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

export function normalizeCommandName(value: string): string {
  const normalized = path.basename(value).toLowerCase();
  return normalized.endsWith(".exe") || normalized.endsWith(".cmd") || normalized.endsWith(".bat")
    ? normalized.replace(/\.(exe|cmd|bat)$/i, "")
    : normalized;
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
  return { allowed: true };
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

function deny(code: string, reason: string): ReturnType<SandboxPolicy["check"]> {
  return { allowed: false, code, reason };
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

function requireString(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return text;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}
