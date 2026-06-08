import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SandboxPolicy, ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
  positiveInteger,
  resolveWorkspacePath,
  safeRefToken,
  throwIfAborted,
  truncateText,
  type LocalWorkspaceToolOptions,
} from "./local-workspace-common.js";
import {
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
  normalizeCommandName,
  normalizeRunCommandInput,
  sandboxRequest,
} from "./local-workspace-sandbox.js";

const MAX_COMMAND_TIMEOUT_MS = 30_000;

export function createLocalRunCommandTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "run_command",
      description: "Run an allowed workspace command after confirmation. The command is parsed as a bare command name plus arguments; shell operators and arbitrary shell syntax are rejected.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
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
          command: { type: "string", description: "Bare executable name, or a simple command line without shell operators." },
          args: { type: "array", items: { type: "string" }, description: "Command arguments passed without a shell." },
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

export function createLocalShellCommandTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const base = createLocalRunCommandTool(rootDirectory, options);
  return {
    definition: {
      ...base.definition,
      name: "shell_command",
      description: "Alias of run_command for allowed workspace commands. It does not run arbitrary shell syntax.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
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
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES) {
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
