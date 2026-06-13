import { execFile } from "node:child_process";
import path from "node:path";
import type { SanitizedCommandShellConfig } from "../../../domain/config/index.js";
import type { ToolDefinition, ToolExecutor } from "../../../domain/tools/index.js";
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

const MAX_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_STDOUT_CHARS = 128_000;
const MAX_COMMAND_STDERR_CHARS = 64_000;

export function createDefaultCommandShellConfig(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env
): SanitizedCommandShellConfig {
  if (platform === "win32") {
    const executable = firstNonBlank(env.ComSpec, env.COMSPEC) ?? "cmd.exe";
    return {
      kind: "cmd",
      label: "Windows Command Prompt",
      executable,
      syntax: "cmd",
      platform,
      invocation: [executable, "/d", "/s", "/c", "<commandLine>"],
      commandLineParameter: "commandLine",
      notes: [
        "Write one complete cmd.exe command line.",
        "Use Windows path separators when helpful.",
        "Use cmd syntax for environment expansion, pipes, redirection, and command chaining.",
      ],
      updatedAt: "runtime-default",
    };
  }
  const executable = firstNonBlank(env.SHELL) ?? "/bin/sh";
  return {
    kind: executable.endsWith("/bash") || executable === "bash" ? "bash" : "sh",
    label: executable.endsWith("/bash") || executable === "bash" ? "Bash" : "POSIX shell",
    executable,
    syntax: "posix",
    platform,
    invocation: [executable, "-lc", "<commandLine>"],
    commandLineParameter: "commandLine",
    notes: [
      "Write one complete POSIX shell command line.",
      "Use POSIX shell syntax for quoting, environment expansion, pipes, redirection, and command chaining.",
    ],
    updatedAt: "runtime-default",
  };
}

export function createLocalShellCommandTool(
  rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT,
  options: LocalWorkspaceToolOptions = {}
): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  const commandShell = normalizeCommandShellConfig(options.commandShell);
  return {
    definition: shellCommandDefinition(commandShell),
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const normalized = normalizeShellCommandInput(record);
      const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT_MS, positiveInteger(record.timeoutMs) ?? DEFAULT_COMMAND_TIMEOUT_MS);
      assertSandboxAllowed(sandboxPolicy, {
        operation: "execute",
        workspaceRoot: path.resolve(rootDirectory),
        command: normalized.command,
        commandLine: normalized.commandLine,
        args: normalized.legacyArgs,
        bytes: timeoutMs,
      });
      const result = normalized.legacyProgram === undefined
        ? await runShellCommand(commandShell, normalized.commandLine, rootDirectory, timeoutMs, context.abortSignal)
        : await runProgramCommand(normalized.legacyProgram, normalized.legacyArgs, rootDirectory, timeoutMs, context.abortSignal);
      return commandToolOutput({
        action: "shell_command",
        command: normalized.command,
        commandLine: normalized.commandLine,
        legacyArgs: normalized.legacyArgs,
        shell: commandShell,
        result,
        truncated: false,
      });
    },
  };
}

export function createLocalRunCommandTool(
  rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT,
  options: LocalWorkspaceToolOptions = {}
): ToolExecutor {
  const shellCommand = createLocalShellCommandTool(rootDirectory, options);
  const commandShell = normalizeCommandShellConfig(options.commandShell);
  return {
    definition: {
      ...shellCommand.definition,
      name: "run_command",
      description: [
        "Compatibility command executor. Prefer shell_command for all new model-visible command calls.",
        shellUsageSentence(commandShell),
      ].join(" "),
      modelContract: {
        usageNotes: [
          "This tool exists for older command calls. Prefer shell_command with commandLine for new calls.",
          "If args is provided for compatibility, the command is executed as a program with argv, not as shell syntax.",
        ],
        outputNotes: [
          "Returns result.commandLine, result.shell, result.exitCode, result.stdout, and result.stderr.",
        ],
      },
    },
    execute: async (input, context) => {
      const output = await shellCommand.execute(input, context);
      const record = asRecord(output);
      return {
        ...record,
        action: "run_command",
        refId: typeof record.refId === "string" ? record.refId.replace("workspace:shell:", "workspace:command:") : "workspace:command:compat",
      };
    },
  };
}

function shellCommandDefinition(commandShell: SanitizedCommandShellConfig): ToolDefinition {
  return {
    name: "shell_command",
    description: [
      "Run one complete workspace shell command after confirmation.",
      shellUsageSentence(commandShell),
      "Put the exact command in commandLine. Do not split it into args.",
      "Use normal shell features when they help: pipes, redirection, command chaining, environment expansion, and quoted inline scripts.",
    ].join(" "),
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
      runtimeHints: [{
        kind: "command_shell",
        shellId: commandShell.kind,
        label: commandShell.label,
        executable: commandShell.executable,
        syntax: commandShell.syntax,
        platform: commandShell.platform,
        invocation: commandShell.invocation,
        commandLineParameter: "commandLine",
        notes: commandShell.notes,
      }],
    },
    modelContract: {
      runtimeHints: [
        { label: "current shell", value: `${commandShell.label} (${commandShell.syntax})` },
        { label: "executable", value: commandShell.executable },
        { label: "invocation", value: commandShell.invocation.join(" ") },
      ],
      usageNotes: [
        "Use commandLine as the single command string.",
        "Write the command in the current shell syntax; do not use args for new calls.",
        "Use pipes, redirection, command chaining, environment expansion, and quoted inline scripts directly in commandLine.",
      ],
      outputNotes: [
        "result.stdout and result.stderr are returned to the model for follow-up reasoning.",
        "result.shell records the shell that executed the command.",
        "A non-zero exitCode is command feedback; inspect stdout/stderr before deciding the next step.",
      ],
      examples: [
        {
          title: "Run tests",
          input: { commandLine: "pnpm test", timeoutMs: 120000 },
        },
        {
          title: "Search files",
          input: { commandLine: commandShell.syntax === "cmd" ? "dir /s /b *.ts" : "find . -name '*.ts'" },
        },
      ],
    },
    inputSchema: {
      type: "object",
      properties: {
        commandLine: {
          type: "string",
          description: `Required. A complete ${commandShell.syntax} shell command line for ${commandShell.label}.`,
        },
        timeoutMs: {
          type: "number",
          description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_COMMAND_TIMEOUT_MS}; maximum ${MAX_COMMAND_TIMEOUT_MS}.`,
        },
      },
      required: ["commandLine"],
      additionalProperties: false,
    },
  };
}

function commandToolOutput(input: {
  readonly action: "run_command" | "shell_command";
  readonly command: string;
  readonly commandLine: string;
  readonly legacyArgs: readonly string[];
  readonly shell: SanitizedCommandShellConfig;
  readonly result: { readonly stdout: string; readonly stderr: string; readonly exitCode: number };
  readonly truncated: boolean;
}): {
  readonly action: "run_command" | "shell_command";
  readonly status: "completed";
  readonly refId: string;
  readonly summary: string;
  readonly result: {
    readonly command: string;
    readonly commandLine: string;
    readonly args?: readonly string[];
    readonly shell: {
      readonly kind: SanitizedCommandShellConfig["kind"];
      readonly label: string;
      readonly executable: string;
      readonly syntax: SanitizedCommandShellConfig["syntax"];
      readonly invocation: readonly string[];
    };
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  readonly truncated: boolean;
} {
  const stdout = truncateText(input.result.stdout, MAX_COMMAND_STDOUT_CHARS);
  const stderr = truncateText(input.result.stderr, MAX_COMMAND_STDERR_CHARS);
  const prefix = input.action === "shell_command" ? "workspace:shell" : "workspace:command";
  return {
    action: input.action,
    status: "completed",
    refId: `${prefix}:${safeRefToken(input.commandLine)}`,
    summary: `${input.commandLine} · exit ${input.result.exitCode}`,
    result: {
      command: input.command,
      commandLine: input.commandLine,
      args: input.legacyArgs.length === 0 ? undefined : [...input.legacyArgs],
      shell: {
        kind: input.shell.kind,
        label: input.shell.label,
        executable: input.shell.executable,
        syntax: input.shell.syntax,
        invocation: [...input.shell.invocation],
      },
      exitCode: input.result.exitCode,
      stdout,
      stderr,
    },
    truncated: input.truncated || stdout.length < input.result.stdout.length || stderr.length < input.result.stderr.length,
  };
}

function normalizeShellCommandInput(record: Readonly<Record<string, unknown>>): {
  readonly command: string;
  readonly commandLine: string;
  readonly legacyProgram?: string;
  readonly legacyArgs: readonly string[];
} {
  const commandLine = stringField(record.commandLine);
  if (commandLine !== undefined) {
    return {
      command: commandLine,
      commandLine,
      legacyArgs: [],
    };
  }
  const command = requireCommand(record.command);
  const legacyArgs = toStringArray(record.args);
  return {
    command,
    commandLine: legacyArgs.length === 0 ? command : [command, ...legacyArgs].join(" "),
    legacyProgram: legacyArgs.length === 0 ? undefined : command,
    legacyArgs,
  };
}

async function runShellCommand(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  rootDirectory: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const args = shellArgs(shell, commandLine);
  return runExecFile(shell.executable, args, rootDirectory, timeoutMs, abortSignal);
}

async function runProgramCommand(
  command: string,
  args: readonly string[],
  rootDirectory: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  return runExecFile(command, [...args], rootDirectory, timeoutMs, abortSignal);
}

async function runExecFile(
  file: string,
  args: readonly string[],
  rootDirectory: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: { readonly stdout: string; readonly stderr: string; readonly exitCode: number }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const child = execFile(file, [...args], {
      cwd: rootDirectory,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 16,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code === "number") {
        finish({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: error.code });
        return;
      }
      if (error && typeof error.signal === "string") {
        finish({ stdout: String(stdout ?? ""), stderr: String(stderr ?? error.message), exitCode: 130 });
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      finish({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 });
    });
    abortSignal?.addEventListener("abort", () => {
      child.kill();
      finish({ stdout: "", stderr: "Command execution cancelled.", exitCode: 130 });
    }, { once: true });
  });
}

function shellArgs(shell: SanitizedCommandShellConfig, commandLine: string): readonly string[] {
  if (shell.syntax === "cmd") {
    return ["/d", "/s", "/c", commandLine];
  }
  if (shell.syntax === "powershell") {
    return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", commandLine];
  }
  return ["-lc", commandLine];
}

function normalizeCommandShellConfig(value: SanitizedCommandShellConfig | undefined): SanitizedCommandShellConfig {
  if (value === undefined) {
    return createDefaultCommandShellConfig();
  }
  return {
    ...value,
    invocation: [...value.invocation],
    notes: [...value.notes],
    commandLineParameter: "commandLine",
  };
}

function shellUsageSentence(shell: SanitizedCommandShellConfig): string {
  return `Current runtime shell is ${shell.label} (${shell.syntax}) via ${shell.executable}.`;
}

function requireCommand(value: unknown): string {
  const text = stringField(value);
  if (text === undefined) {
    throw new Error("commandLine must be a non-empty string.");
  }
  return text;
}

function stringField(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length === 0 ? undefined : text;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
