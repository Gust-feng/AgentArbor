import { execFile } from "node:child_process";
import path from "node:path";
import type { ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  positiveInteger,
  safeRefToken,
  throwIfAborted,
  truncateText,
  type LocalWorkspaceToolOptions,
} from "./local-workspace-common.js";
import {
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
} from "./local-workspace-sandbox.js";

const MAX_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_STDOUT_CHARS = 128_000;
const MAX_COMMAND_STDERR_CHARS = 64_000;

export function createLocalRunCommandTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "run_command",
      description: "Run a workspace shell command after confirmation. Supports normal shell syntax such as pipes, redirection, command chaining, and environment expansion.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
        operationType: "execute",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 1200,
          omitRawOutput: false,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command line to run in the workspace." },
          args: { type: "array", items: { type: "string" }, description: "Optional arguments appended to the command with shell quoting." },
          timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
        },
        required: ["command"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const { command, args, commandLine } = normalizeShellCommandInput(record);
      const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT_MS, positiveInteger(record.timeoutMs) ?? 10_000);
      assertSandboxAllowed(sandboxPolicy, {
        operation: "execute",
        workspaceRoot: path.resolve(rootDirectory),
        command,
        args,
        bytes: timeoutMs,
      });
      const result = await runShellCommand(commandLine, rootDirectory, timeoutMs, context.abortSignal);
      return commandToolOutput(command, args, commandLine, result, false);
    },
  };
}

export function createLocalShellCommandTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const base = createLocalRunCommandTool(rootDirectory, options);
  return {
    definition: {
      ...base.definition,
      name: "shell_command",
      description: "Alias of run_command for workspace shell commands.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
        operationType: "execute",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 1200,
          omitRawOutput: false,
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

function commandToolOutput(
  command: string,
  args: readonly string[],
  commandLine: string,
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
    readonly commandLine: string;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  readonly truncated: boolean;
} {
  const stdout = truncateText(result.stdout, MAX_COMMAND_STDOUT_CHARS);
  const stderr = truncateText(result.stderr, MAX_COMMAND_STDERR_CHARS);
  return {
    action: "run_command",
    status: "completed",
    refId: `workspace:command:${safeRefToken(command)}`,
    summary: `${commandLine} · exit ${result.exitCode}`,
    result: {
      command,
      args,
      commandLine,
      exitCode: result.exitCode,
      stdout,
      stderr,
    },
    truncated: truncated || stdout.length < result.stdout.length || stderr.length < result.stderr.length,
  };
}

function normalizeShellCommandInput(record: Readonly<Record<string, unknown>>): {
  readonly command: string;
  readonly args: readonly string[];
  readonly commandLine: string;
} {
  const command = requireCommand(record.command);
  const args = toStringArray(record.args);
  const commandLine = [command, ...args.map(shellQuote)].join(" ").trim();
  return { command, args, commandLine };
}

async function runShellCommand(
  commandLine: string,
  rootDirectory: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const shell = process.platform === "win32"
    ? {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", commandLine],
      }
    : {
        file: "/bin/sh",
        args: ["-lc", commandLine],
      };
  return new Promise((resolve, reject) => {
    const child = execFile(shell.file, shell.args, {
      cwd: rootDirectory,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 16,
    }, (error, stdout, stderr) => {
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
    abortSignal?.addEventListener("abort", () => {
      child.kill();
      resolve({ stdout: "", stderr: "Command execution cancelled.", exitCode: 130 });
    }, { once: true });
  });
}

function requireCommand(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error("command must be a non-empty string.");
  }
  return text;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
