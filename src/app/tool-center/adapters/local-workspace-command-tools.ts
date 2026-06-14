import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, promises as fs } from "node:fs";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import type { SanitizedCommandShellConfig } from "../../../domain/config/index.js";
import type { ToolDefinition, ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  positiveInteger,
  resolveWorkspacePath,
  safeRefToken,
  throwIfAborted,
  type LocalWorkspaceToolOptions,
} from "./local-workspace-common.js";
import {
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
} from "./local-workspace-sandbox.js";

const MAX_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_STDOUT_CHARS = 64_000;
const MAX_COMMAND_STDERR_CHARS = 32_000;
const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_CANCELLED_EXIT_CODE = 130;
const COMMAND_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_BACKGROUND_WAIT_MS = 500;
const MAX_BACKGROUND_WAIT_MS = 5_000;
const BACKGROUND_LOG_PREVIEW_CHARS = 2_000;
const DEFAULT_WAIT_FOR_PORT_TIMEOUT_MS = 10_000;
const MAX_WAIT_FOR_PORT_TIMEOUT_MS = 60_000;
const PORT_CONNECT_TIMEOUT_MS = 250;
const PORT_POLL_INTERVAL_MS = 100;

type CommandExecutionResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly cwd: string;
  readonly timedOut?: boolean;
  readonly cancelled?: boolean;
  readonly signal?: string;
  readonly background?: boolean;
  readonly pid?: number;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly durationMs?: number;
  readonly waitForPort?: number;
  readonly portReady?: boolean;
  readonly portWaitCancelled?: boolean;
  readonly truncated?: boolean;
  readonly stdoutChars?: number;
  readonly stderrChars?: number;
  readonly stdoutOmittedChars?: number;
  readonly stderrOmittedChars?: number;
};

type TextPreview = {
  readonly text: string;
  readonly chars: number;
  readonly omittedChars: number;
  readonly truncated: boolean;
};

export function createDefaultCommandShellConfig(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env
): SanitizedCommandShellConfig {
  if (platform === "win32") {
    if (usePowerShellOnWindows(env)) {
      return createWindowsPowerShellConfig(platform);
    }
    const gitBash = windowsGitBashExecutable(env);
    if (gitBash !== undefined) {
      return {
        kind: "bash",
        label: "Git Bash",
        executable: gitBash,
        syntax: "posix",
        platform,
        invocation: [gitBash, "-lc", "<commandLine>"],
        commandLineParameter: "commandLine",
        notes: [
          "Write one complete POSIX shell command line.",
          "Auto-selected Git Bash on Windows to reduce cmd.exe quoting and shim issues.",
          "Use command plus args when shell quoting would still be fragile.",
        ],
        updatedAt: "runtime-default",
      };
    }
    return createWindowsPowerShellConfig(platform);
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

function createWindowsPowerShellConfig(platform: NodeJS.Platform): SanitizedCommandShellConfig {
  return {
    kind: "powershell",
    label: "Windows PowerShell",
    executable: "powershell.exe",
    syntax: "powershell",
    platform,
    invocation: ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "<commandLine>"],
    commandLineParameter: "commandLine",
    notes: [
      "Write one complete PowerShell command line.",
      "Use PowerShell syntax for variables, pipelines, quoting, and command chaining.",
      "ExecutionPolicy is bypassed for this process so local script shims can run when allowed by policy.",
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
      const normalized = normalizeShellCommandInput(record, commandShell.syntax);
      const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT_MS, positiveInteger(record.timeoutMs) ?? DEFAULT_COMMAND_TIMEOUT_MS);
      const backgroundWaitMs = Math.min(MAX_BACKGROUND_WAIT_MS, positiveInteger(record.backgroundWaitMs) ?? DEFAULT_BACKGROUND_WAIT_MS);
      const waitForPort = optionalPort(record.waitForPort);
      const waitForPortTimeoutMs = Math.min(
        MAX_WAIT_FOR_PORT_TIMEOUT_MS,
        positiveInteger(record.waitForPortTimeoutMs) ?? DEFAULT_WAIT_FOR_PORT_TIMEOUT_MS
      );
      const background = record.background === true;
      const cwd = await resolveCommandCwd(rootDirectory, record.cwd);
      assertSandboxAllowed(sandboxPolicy, {
        operation: "execute",
        workspaceRoot: path.resolve(rootDirectory),
        relativePath: cwd.relativePath,
        command: normalized.command,
        commandLine: normalized.commandLine,
        args: normalized.legacyArgs,
        bytes: timeoutMs,
      });
      const executeDirectly = normalized.legacyProgram !== undefined &&
        await shouldExecuteDirectly({
          command: normalized.legacyProgram,
          rootDirectory,
          platform: commandShell.platform,
        });
      const startedAt = Date.now();
      const rawResult = background
        ? normalized.legacyProgram === undefined || !executeDirectly
          ? await runBackgroundShellCommand(commandShell, normalized.commandLine, cwd.absolutePath, cwd.relativePath, backgroundWaitMs)
          : await runBackgroundProgramCommand(commandShell, normalized.legacyProgram, normalized.legacyArgs, normalized.commandLine, cwd.absolutePath, cwd.relativePath, backgroundWaitMs)
        : normalized.legacyProgram === undefined || !executeDirectly
          ? await runShellCommand(commandShell, normalized.commandLine, cwd.absolutePath, cwd.relativePath, timeoutMs, context.abortSignal)
          : await runProgramCommand(normalized.legacyProgram, normalized.legacyArgs, cwd.absolutePath, cwd.relativePath, timeoutMs, context.abortSignal);
      const result = await enrichCommandResult({
        result: rawResult,
        waitForPort,
        waitForPortTimeoutMs,
        startedAt,
        abortSignal: context.abortSignal,
      });
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
        "Legacy alias of shell_command kept for compatibility with older runs and prompts.",
        "Use the same input contract and command behavior as shell_command.",
      ].join(" "),
      modelContract: {
        purpose: "Compatibility alias for shell_command with the same command execution behavior.",
        whenToUse: [
          "Use only when resuming or honoring older prompts that call run_command.",
        ],
        whenNotToUse: [
          "Prefer shell_command for new command calls.",
        ],
        inputNotes: [
          "Use the same inputs as shell_command: commandLine for shell execution, or command plus args for direct argv execution.",
          "timeoutMs optionally caps execution time.",
          "background=true starts the command as a detached background process and returns pid, logPath, and stopCommand.",
          "waitForPort optionally waits for a localhost TCP port to become reachable after starting a background command.",
          "cwd optionally selects a workspace-relative working directory for this command.",
        ],
        runtimeHints: [
          { label: "current shell", value: `${commandShell.label} (${commandShell.syntax})` },
          { label: "compatibility", value: "legacy alias of shell_command" },
        ],
        usageNotes: [
          "Prefer shell_command for new command calls.",
          "If command and args are provided, the runtime executes the program directly with argv instead of shell parsing.",
        ],
        outputNotes: [
          "When stdout/stderr are under the preview caps, result.stdout and result.stderr contain the exact command text.",
          "Returns result.commandLine, result.shell, result.exitCode, result.stdout/result.stderr previews, truncation facts, and timeout/background metadata when relevant.",
        ],
        examples: [
          { title: "Compatibility command", input: { commandLine: commandShell.syntax === "cmd" ? "dir" : "pwd" } },
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
      "Run a real workspace command in the current integrated shell.",
      shellUsageSentence(commandShell),
      "Use commandLine for normal shell-native command execution, including mkdir, copy, move, delete, package manager, build, test, git, HTTP, and binary-file workflows.",
      "Use command plus args when you want direct argv execution without shell parsing.",
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
      purpose: "Run a real command in the current workspace shell and return stdout, stderr, exitCode, and shell metadata.",
      whenToUse: [
        "Use as the general-purpose workspace command tool for shell-native workflows.",
        "Use for creating directories, copying or moving files, removing directories, package managers, tests, builds, git, environment probes, HTTP requests, and binary-file operations.",
        "Use when a normal CLI command is the direct way to do the task.",
      ],
      whenNotToUse: [
        "Do not use for simple text file reads, directory listings, text search, or exact text edits when the dedicated workspace tool is simpler.",
      ],
      inputNotes: [
        "commandLine is the normal complete shell command line.",
        "command plus args executes a program directly with argv and bypasses shell parsing.",
        "cwd optionally selects a workspace-relative working directory; omit it to run from the workspace root.",
        "background=true starts a detached process and returns immediately with pid, logPath, and stopCommand.",
        `backgroundWaitMs watches a background command for early exit and initial logs; defaults to ${DEFAULT_BACKGROUND_WAIT_MS} and is capped at ${MAX_BACKGROUND_WAIT_MS}.`,
        `waitForPort optionally waits for a localhost TCP port to become reachable after a background command starts; waitForPortTimeoutMs defaults to ${DEFAULT_WAIT_FOR_PORT_TIMEOUT_MS} and is capped at ${MAX_WAIT_FOR_PORT_TIMEOUT_MS}.`,
        `timeoutMs defaults to ${DEFAULT_COMMAND_TIMEOUT_MS} and is capped at ${MAX_COMMAND_TIMEOUT_MS}.`,
      ],
      runtimeHints: [
        { label: "current shell", value: `${commandShell.label} (${commandShell.syntax})` },
        { label: "executable", value: commandShell.executable },
        { label: "invocation", value: commandShell.invocation.join(" ") },
      ],
      usageNotes: [
        "Choose the command form yourself based on the current shell and the task.",
        "Use commandLine for normal shell commands, pipelines, redirection, chaining, environment expansion, shell builtins, and shell-native quoting.",
        "Use command and args when quoting would be fragile, especially for inline scripts such as node -e, python -c, or paths and arguments that are easier to express as argv.",
        "If curl is unavailable, use the installed runtime such as node or python for HTTP requests instead of waiting for a separate HTTP tool.",
        "Use this tool for normal filesystem commands such as mkdir, rmdir, copy, move, and recursive cleanup.",
        "Use background=true for dev servers, file watchers, long-running demos, and other commands expected to keep running.",
        "For dev servers, combine background=true with waitForPort so the tool returns only after the local port is reachable or the port wait times out.",
        "When background=true, do not append shell-native background operators such as POSIX & just to detach the process; the tool already returns pid, logPath, and stopCommand.",
        "Use cwd instead of repeated cd chaining when the command should run inside a project subdirectory.",
        "Before relying on a command, you may probe the environment with ordinary shell commands such as where, which, command -v, or version checks.",
      ],
      outputNotes: [
        `result.stdout and result.stderr are model-visible previews capped at ${MAX_COMMAND_STDOUT_CHARS} and ${MAX_COMMAND_STDERR_CHARS} characters for foreground command output; under those caps they contain the exact command text.`,
        "result.stdoutTruncated/result.stderrTruncated, result.stdoutChars/result.stderrChars, and result.stdoutOmittedChars/result.stderrOmittedChars report the concrete truncation facts for those previews.",
        "result.shell records the shell that executed the command.",
        "result.cwd records the workspace-relative working directory used for the command.",
        "result.timedOut is true when the foreground command exceeded timeoutMs; stdout/stderr contain captured output before termination.",
        "result.background, result.pid, result.logPath, and result.stopCommand describe detached background commands; these small metadata fields are not shortened by stdout/stderr preview budgeting.",
        "result.durationMs records total observed tool execution time; result.portReady records whether waitForPort became reachable.",
        "result.cancelled records foreground command cancellation; result.portWaitCancelled records cancellation while waiting for a background port.",
        "If command and args are provided, execution bypasses shell parsing and uses direct argv execution.",
        "A non-zero exitCode is command feedback; stdout/stderr remain command output previews, not interpreted recommendations.",
      ],
      examples: [
        {
          title: "Run tests",
          input: { commandLine: "pnpm test", timeoutMs: 120000 },
        },
        {
          title: "Probe environment",
          input: { commandLine: commandShell.syntax === "cmd" ? "where rg" : "command -v rg" },
        },
        {
          title: "Use shell pipeline",
          input: { commandLine: commandShell.syntax === "cmd" ? "dir /s /b *.ts | findstr tool" : "find . -name '*.ts' | grep tool" },
        },
        {
          title: "Bypass fragile shell quoting with argv",
          input: {
            commandLine: "node -e \"console.log('hello from argv mode')\"",
            command: "node",
            args: ["-e", "console.log('hello from argv mode')"],
          },
        },
        {
          title: "Start dev server in background",
          input: { commandLine: "pnpm dev", cwd: "apps/web", background: true, waitForPort: 5173 },
        },
        {
          title: "Run Python inline script with argv",
          input: {
            commandLine: "python -c \"print('hello from python argv mode')\"",
            command: "python",
            args: ["-c", "print('hello from python argv mode')"],
          },
        },
      ],
    },
    inputSchema: {
      type: "object",
      properties: {
        commandLine: {
          type: "string",
          description: `Recommended. A complete ${commandShell.syntax} shell command line for ${commandShell.label}. If command plus args are also provided, this is treated as the human-readable equivalent shown in the transcript.`,
        },
        command: {
          type: "string",
          description: "Optional direct program path or executable name. Use together with args when shell quoting would be fragile and the command should bypass shell parsing.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional argv list for direct program execution. When present with command, the runtime executes the program directly instead of parsing commandLine through the shell.",
        },
        timeoutMs: {
          type: "number",
          description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_COMMAND_TIMEOUT_MS}; maximum ${MAX_COMMAND_TIMEOUT_MS}.`,
        },
        cwd: {
          type: "string",
          description: "Optional workspace-relative working directory. Defaults to the workspace root.",
        },
        background: {
          type: "boolean",
          description: "If true, start the command as a detached background process and return pid, logPath, and stopCommand without waiting for the process to exit.",
        },
        backgroundWaitMs: {
          type: "number",
          description: `Optional background startup observation window in milliseconds. Defaults to ${DEFAULT_BACKGROUND_WAIT_MS}; maximum ${MAX_BACKGROUND_WAIT_MS}.`,
        },
        waitForPort: {
          type: "number",
          description: "Optional localhost TCP port to poll after a background command starts, useful for dev servers.",
        },
        waitForPortTimeoutMs: {
          type: "number",
          description: `Optional port wait timeout in milliseconds. Defaults to ${DEFAULT_WAIT_FOR_PORT_TIMEOUT_MS}; maximum ${MAX_WAIT_FOR_PORT_TIMEOUT_MS}.`,
        },
      },
      required: [],
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
  readonly result: CommandExecutionResult;
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
    readonly cwd: string;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly stdoutTruncated: boolean;
    readonly stderrTruncated: boolean;
    readonly stdoutChars: number;
    readonly stderrChars: number;
    readonly stdoutOmittedChars: number;
    readonly stderrOmittedChars: number;
    readonly timedOut?: boolean;
    readonly cancelled?: boolean;
    readonly signal?: string;
    readonly background?: boolean;
    readonly pid?: number;
    readonly logPath?: string;
    readonly stopCommand?: string;
    readonly durationMs?: number;
    readonly waitForPort?: number;
    readonly portReady?: boolean;
    readonly portWaitCancelled?: boolean;
  };
  readonly truncated: boolean;
} {
  const stdout = commandOutputPreview({
    text: input.result.stdout,
    chars: input.result.stdoutChars,
    omittedChars: input.result.stdoutOmittedChars,
    maxChars: MAX_COMMAND_STDOUT_CHARS,
  });
  const stderr = commandOutputPreview({
    text: input.result.stderr,
    chars: input.result.stderrChars,
    omittedChars: input.result.stderrOmittedChars,
    maxChars: MAX_COMMAND_STDERR_CHARS,
  });
  const prefix = input.action === "shell_command" ? "workspace:shell" : "workspace:command";
  const statusText = input.result.background === true
    ? input.result.waitForPort !== undefined && input.result.portReady !== true
      ? `started background pid ${input.result.pid ?? "unknown"}; port ${input.result.waitForPort} not ready`
      : input.result.waitForPort !== undefined
        ? `started background pid ${input.result.pid ?? "unknown"}; port ${input.result.waitForPort} ready`
        : `started background pid ${input.result.pid ?? "unknown"}`
    : input.result.timedOut === true
      ? `timed out (exit ${input.result.exitCode})`
      : input.result.cancelled === true
        ? `cancelled (exit ${input.result.exitCode})`
      : `exit ${input.result.exitCode}`;
  return {
    action: input.action,
    status: "completed",
    refId: `${prefix}:${safeRefToken(input.commandLine)}`,
    summary: `${input.commandLine} · ${statusText}`,
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
      cwd: input.result.cwd,
      exitCode: input.result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      stdoutChars: stdout.chars,
      stderrChars: stderr.chars,
      stdoutOmittedChars: stdout.omittedChars,
      stderrOmittedChars: stderr.omittedChars,
      timedOut: input.result.timedOut === true ? true : undefined,
      cancelled: input.result.cancelled === true ? true : undefined,
      signal: input.result.signal,
      background: input.result.background === true ? true : undefined,
      pid: input.result.pid,
      logPath: input.result.logPath,
      stopCommand: input.result.stopCommand,
      durationMs: input.result.durationMs,
      waitForPort: input.result.waitForPort,
      portReady: input.result.portReady,
      portWaitCancelled: input.result.portWaitCancelled === true ? true : undefined,
    },
    truncated: input.truncated || input.result.truncated === true || stdout.truncated || stderr.truncated,
  };
}

function commandOutputPreview(input: {
  readonly text: string;
  readonly chars: number | undefined;
  readonly omittedChars?: number;
  readonly maxChars: number;
}): TextPreview {
  const chars = Math.max(input.chars ?? input.text.length + (input.omittedChars ?? 0), input.text.length);
  const text = input.text.length <= input.maxChars
    ? input.text
    : input.text.slice(0, input.maxChars);
  return {
    text,
    chars,
    omittedChars: Math.max(0, chars - text.length),
    truncated: text.length < chars,
  };
}

function normalizeShellCommandInput(
  record: Readonly<Record<string, unknown>>,
  shellSyntax: SanitizedCommandShellConfig["syntax"]
): {
  readonly command: string;
  readonly commandLine: string;
  readonly legacyProgram?: string;
  readonly legacyArgs: readonly string[];
} {
  const directCommand = stringField(record.command);
  const directArgs = toStringArray(record.args);
  const commandLine = stringField(record.commandLine);
  if (directCommand !== undefined && directArgs.length > 0) {
    return {
      command: directCommand,
      commandLine: commandLine ?? shellCommandLineFromArgv(directCommand, directArgs, shellSyntax),
      legacyProgram: directCommand,
      legacyArgs: directArgs,
    };
  }
  if (commandLine !== undefined) {
    return {
      command: commandLine,
      commandLine,
      legacyArgs: [],
    };
  }
  const command = requireCommand(record.command);
  const legacyArgs = directArgs;
  return {
    command,
    commandLine: legacyArgs.length === 0 ? command : [command, ...legacyArgs].join(" "),
    legacyProgram: legacyArgs.length === 0 ? undefined : command,
    legacyArgs,
  };
}

function shellCommandLineFromArgv(
  command: string,
  args: readonly string[],
  shellSyntax: SanitizedCommandShellConfig["syntax"]
): string {
  return [command, ...args].map((value) => quoteShellArg(value, shellSyntax)).join(" ");
}

function quoteShellArg(value: string, shellSyntax: SanitizedCommandShellConfig["syntax"]): string {
  if (shellSyntax === "cmd") {
    return quoteCmdArg(value);
  }
  if (shellSyntax === "powershell") {
    return quotePowerShellArg(value);
  }
  return quotePosixArg(value);
}

function quotePosixArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) && value.length > 0) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quotePowerShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:\\@%+=,-]+$/u.test(value) && value.length > 0) {
    return value;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCmdArg(value: string): string {
  if (/^[A-Za-z0-9_./:\\@+=,-]+$/u.test(value) && value.length > 0) {
    return value;
  }
  const escaped = value
    .replace(/\^/g, "^^")
    .replace(/"/g, '\\"')
    .replace(/[&|<>()]/g, (character) => `^${character}`)
    .replace(/%/g, "^%")
    .replace(/!/g, "^!");
  return `"${escaped}"`;
}

async function runShellCommand(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<CommandExecutionResult> {
  const args = shellArgs(shell, commandLine);
  return runSpawnedCommand(shell.executable, args, workingDirectory, relativeCwd, timeoutMs, abortSignal, {
    windowsVerbatimArguments: shell.syntax === "cmd",
  });
}

async function runProgramCommand(
  command: string,
  args: readonly string[],
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined
): Promise<CommandExecutionResult> {
  return runSpawnedCommand(command, [...args], workingDirectory, relativeCwd, timeoutMs, abortSignal);
}

async function runBackgroundShellCommand(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  waitMs: number
): Promise<CommandExecutionResult> {
  const logPath = await createBackgroundCommandLogPath(commandLine);
  return runBackgroundCommand({
    file: shell.executable,
    args: shellArgs(shell, backgroundShellRedirectCommandLine(shell, commandLine, logPath)),
    commandLine,
    workingDirectory,
    relativeCwd,
    waitMs,
    stopShellSyntax: shell.syntax,
    platform: shell.platform,
    logPath,
    captureMode: "shell-redirection",
    windowsVerbatimArguments: shell.syntax === "cmd",
  });
}

async function runBackgroundProgramCommand(
  shell: SanitizedCommandShellConfig,
  command: string,
  args: readonly string[],
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  waitMs: number
): Promise<CommandExecutionResult> {
  return runBackgroundCommand({
    file: command,
    args: [...args],
    commandLine,
    workingDirectory,
    relativeCwd,
    waitMs,
    stopShellSyntax: shell.syntax,
    platform: shell.platform,
  });
}

async function runSpawnedCommand(
  file: string,
  args: readonly string[],
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  options: { readonly windowsVerbatimArguments?: boolean } = {}
): Promise<CommandExecutionResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let child: ChildProcess;
    const stdout = createBoundedOutputCollector(MAX_COMMAND_STDOUT_CHARS);
    const stderr = createBoundedOutputCollector(MAX_COMMAND_STDERR_CHARS);
    const appendTerminationDiagnostic = () => {
      const timeoutMessage = timedOut ? `Command timed out after ${timeoutMs}ms and was terminated.` : undefined;
      const cancelMessage = cancelled ? "Command execution cancelled." : undefined;
      if (timeoutMessage !== undefined) stderr.appendText(timeoutMessage);
      if (cancelMessage !== undefined) stderr.appendText(cancelMessage);
    };
    const resultFromClose = (code: number | null, signal: NodeJS.Signals | null | undefined): CommandExecutionResult => ({
      stdout: stdout.text(),
      stderr: stderr.text(),
      stdoutChars: stdout.chars(),
      stderrChars: stderr.chars(),
      stdoutOmittedChars: stdout.omittedChars(),
      stderrOmittedChars: stderr.omittedChars(),
      exitCode: timedOut
        ? COMMAND_TIMEOUT_EXIT_CODE
        : cancelled
          ? COMMAND_CANCELLED_EXIT_CODE
          : typeof code === "number"
            ? code
            : signal === undefined || signal === null
            ? 0
            : COMMAND_CANCELLED_EXIT_CODE,
      cwd: relativeCwd,
      timedOut,
      cancelled,
      signal: signal ?? undefined,
      truncated: stdout.truncated() || stderr.truncated(),
    });
    const finish = (value: CommandExecutionResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (terminationTimer !== undefined) {
        clearTimeout(terminationTimer);
      }
      if (abortHandler !== undefined) {
        abortSignal?.removeEventListener("abort", abortHandler);
      }
      resolve(value);
    };
    const requestTermination = () => {
      terminateProcessTree(child);
      if (terminationTimer === undefined) {
        terminationTimer = setTimeout(() => {
          appendTerminationDiagnostic();
          stderr.appendText(
            `Command process did not close within ${COMMAND_TERMINATION_GRACE_MS}ms after termination was requested.`
          );
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(resultFromClose(null, undefined));
        }, COMMAND_TERMINATION_GRACE_MS);
        terminationTimer.unref?.();
      }
    };
    child = spawn(file, [...args], {
      cwd: workingDirectory,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout === null || child.stderr === null) {
      throw new Error("Command process did not expose stdout/stderr pipes.");
    }
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (abortHandler !== undefined) {
        abortSignal?.removeEventListener("abort", abortHandler);
      }
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      appendTerminationDiagnostic();
      finish(resultFromClose(code, signal));
    });
    timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, timeoutMs);
    abortHandler = () => {
      cancelled = true;
      requestTermination();
    };
    abortSignal?.addEventListener("abort", abortHandler, { once: true });
    if (abortSignal?.aborted === true) {
      abortHandler();
    }
  });
}

async function resolveCommandCwd(
  rootDirectory: string,
  value: unknown
): Promise<{ readonly absolutePath: string; readonly relativePath: string }> {
  const target = resolveWorkspacePath(rootDirectory, typeof value === "string" && value.trim().length > 0 ? value : ".");
  const stat = await fs.stat(target.absolutePath);
  if (!stat.isDirectory()) {
    throw new Error(`shell_command cwd must be a workspace directory: ${target.relativePath}`);
  }
  return target;
}

async function enrichCommandResult(input: {
  readonly result: CommandExecutionResult;
  readonly waitForPort: number | undefined;
  readonly waitForPortTimeoutMs: number;
  readonly startedAt: number;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<CommandExecutionResult> {
  if (input.waitForPort === undefined) {
    return {
      ...input.result,
      durationMs: Date.now() - input.startedAt,
    };
  }
  if (input.result.background !== true) {
    return {
      ...input.result,
      waitForPort: input.waitForPort,
      portReady: false,
      durationMs: Date.now() - input.startedAt,
      stderr: appendCommandDiagnostic(
        input.result.stderr,
        "waitForPort was requested but the command is not running in the background."
      ),
    };
  }
  const portWait = await waitForLocalhostPort({
    port: input.waitForPort,
    timeoutMs: input.waitForPortTimeoutMs,
    abortSignal: input.abortSignal,
  });
  const portReady = portWait.ready;
  const durationMs = Date.now() - input.startedAt;
  return {
    ...input.result,
    waitForPort: input.waitForPort,
    portReady,
    portWaitCancelled: portWait.cancelled ? true : undefined,
    durationMs,
    stdout: portReady
      ? appendCommandDiagnostic(input.result.stdout, `Port ${input.waitForPort} is ready.`)
      : input.result.stdout,
    stderr: portWait.ready
      ? input.result.stderr
      : portWait.cancelled
        ? appendCommandDiagnostic(
            input.result.stderr,
            `Port wait for ${input.waitForPort} was cancelled before the port became ready.`
          )
      : appendCommandDiagnostic(
          input.result.stderr,
          `Port ${input.waitForPort} did not become ready within ${input.waitForPortTimeoutMs}ms.`
        ),
  };
}

async function waitForLocalhostPort(input: {
  readonly port: number;
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<{ readonly ready: boolean; readonly cancelled: boolean }> {
  const deadline = Date.now() + input.timeoutMs;
  do {
    if (input.abortSignal?.aborted === true) {
      return { ready: false, cancelled: true };
    }
    if (await canConnectToLocalhostPort(input.port)) {
      return { ready: true, cancelled: false };
    }
    try {
      await delay(Math.min(PORT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), input.abortSignal);
    } catch (error) {
      if (Boolean(input.abortSignal?.aborted)) {
        return { ready: false, cancelled: true };
      }
      throw error;
    }
  } while (Date.now() < deadline);
  return { ready: false, cancelled: false };
}

function canConnectToLocalhostPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(PORT_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

function delay(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error("Command execution cancelled."));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function appendCommandDiagnostic(existing: string, message: string): string {
  return existing.trim().length === 0 ? message : `${existing.replace(/\s*$/u, "")}\n${message}`;
}

async function runBackgroundCommand(input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly commandLine: string;
  readonly workingDirectory: string;
  readonly relativeCwd: string;
  readonly waitMs: number;
  readonly stopShellSyntax: SanitizedCommandShellConfig["syntax"];
  readonly platform: NodeJS.Platform;
  readonly logPath?: string;
  readonly captureMode?: "stdio" | "shell-redirection";
  readonly windowsVerbatimArguments?: boolean;
}): Promise<CommandExecutionResult> {
  const logPath = input.logPath ?? await createBackgroundCommandLogPath(input.commandLine);
  const captureMode = input.captureMode ?? "stdio";
  const logFd = captureMode === "stdio" ? openSync(logPath, "a") : undefined;
  let child: ChildProcess | undefined;
  let earlyExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  try {
    child = spawn(input.file, [...input.args], {
      cwd: input.workingDirectory,
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: input.windowsVerbatimArguments === true,
      stdio: captureMode === "stdio" ? ["ignore", logFd, logFd] : "ignore",
    });
    const start = await waitForBackgroundStart(child, input.waitMs);
    if (start.status === "exited") {
      earlyExit = { code: start.code, signal: start.signal };
    } else {
      child.unref();
    }
  } finally {
    if (logFd !== undefined) {
      closeSync(logFd);
    }
  }
  if (child === undefined) {
    throw new Error("Failed to start background command.");
  }
  if (earlyExit !== undefined) {
    const logPreview = await readBackgroundLogPreview(logPath);
    const stderr = `Background command exited before it stayed running${earlyExit.signal == null ? "" : ` with signal ${earlyExit.signal}`}.`;
    return {
      stdout: logPreview.text,
      stderr,
      exitCode: typeof earlyExit.code === "number" ? earlyExit.code : COMMAND_CANCELLED_EXIT_CODE,
      cwd: input.relativeCwd,
      signal: earlyExit.signal ?? undefined,
      logPath,
      stdoutChars: logPreview.chars,
      stderrChars: stderr.length,
      stdoutOmittedChars: logPreview.omittedChars,
      stderrOmittedChars: 0,
      truncated: logPreview.truncated,
    };
  }
  const pid = child.pid;
  const stopCommand = pid === undefined ? undefined : stopCommandForPid(pid, input.platform, input.stopShellSyntax);
  const initialLogPreview = await readBackgroundLogPreview(logPath, BACKGROUND_LOG_PREVIEW_CHARS);
  const stdout = [
    `Started background process${pid === undefined ? "" : ` pid ${pid}`}.`,
    `Log: ${logPath}`,
    stopCommand === undefined ? undefined : `Stop: ${stopCommand}`,
    initialLogPreview.text.trim().length === 0 ? undefined : `Initial output:\n${initialLogPreview.text}`,
  ].filter((line): line is string => line !== undefined).join("\n");
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    cwd: input.relativeCwd,
    background: true,
    pid,
    logPath,
    stopCommand,
    stdoutChars: stdout.length + initialLogPreview.omittedChars,
    stderrChars: 0,
    stdoutOmittedChars: initialLogPreview.omittedChars,
    stderrOmittedChars: 0,
    truncated: initialLogPreview.truncated,
  };
}

function backgroundShellRedirectCommandLine(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  logPath: string
): string {
  if (shell.syntax === "cmd") {
    return `(${commandLine}) >> ${quoteCmdArg(logPath)} 2>&1`;
  }
  if (shell.syntax === "powershell") {
    return `& { ${commandLine} } *>> ${quotePowerShellArg(logPath)}`;
  }
  return `{ ${commandLine}; } >> ${quotePosixArg(posixPathForShell(logPath, shell.platform))} 2>&1`;
}

function posixPathForShell(filePath: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") {
    return filePath;
  }
  const resolved = path.resolve(filePath);
  const drivePath = /^([A-Za-z]):[\\/](.*)$/u.exec(resolved);
  if (drivePath !== null) {
    return `/${drivePath[1]!.toLowerCase()}/${drivePath[2]!.replace(/\\/g, "/")}`;
  }
  return resolved.replace(/\\/g, "/");
}

function createBoundedOutputCollector(maxChars: number): {
  readonly append: (chunk: Buffer) => void;
  readonly appendText: (text: string) => void;
  readonly text: () => string;
  readonly truncated: () => boolean;
  readonly chars: () => number;
  readonly omittedChars: () => number;
} {
  let value = "";
  let totalChars = 0;
  let isTruncated = false;
  const appendText = (text: string) => {
    if (text.length === 0) {
      return;
    }
    totalChars += text.length;
    const remaining = maxChars - value.length;
    if (remaining <= 0) {
      isTruncated = true;
      return;
    }
    if (text.length > remaining) {
      value += text.slice(0, remaining);
      isTruncated = true;
      return;
    }
    value += text;
  };
  return {
    append(chunk: Buffer) {
      appendText(chunk.toString("utf8"));
    },
    appendText,
    text() {
      return value;
    },
    truncated() {
      return isTruncated;
    },
    chars() {
      return totalChars;
    },
    omittedChars() {
      return Math.max(0, totalChars - value.length);
    },
  };
}

async function createBackgroundCommandLogPath(commandLine: string): Promise<string> {
  const directory = path.join(os.tmpdir(), "agentarbor-command-logs");
  await fs.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(directory, `${timestamp}-${safeRefToken(commandLine)}.log`);
}

async function waitForBackgroundStart(child: ChildProcess, waitMs: number): Promise<
  | { readonly status: "running" }
  | { readonly status: "exited"; readonly code: number | null; readonly signal: NodeJS.Signals | null }
> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const settle = (result: { readonly status: "running" } | { readonly status: "exited"; readonly code: number | null; readonly signal: NodeJS.Signals | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      resolve(result);
    };
    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle({ status: "exited", code, signal });
    };
    timer = setTimeout(() => {
      settle({ status: "running" });
    }, waitMs);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function readBackgroundLogPreview(logPath: string, maxChars = MAX_COMMAND_STDOUT_CHARS): Promise<TextPreview> {
  try {
    const text = await fs.readFile(logPath, "utf8");
    return commandOutputPreview({ text, chars: text.length, maxChars });
  } catch {
    return {
      text: "",
      chars: 0,
      omittedChars: 0,
      truncated: false,
    };
  }
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill();
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    const forceTimer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process tree already exited.
      }
    }, 1_500);
    forceTimer.unref?.();
  } catch {
    child.kill("SIGTERM");
  }
}

function stopCommandForPid(
  pid: number,
  platform: NodeJS.Platform,
  shellSyntax: SanitizedCommandShellConfig["syntax"]
): string {
  if (platform === "win32") {
    return shellSyntax === "posix"
      ? `taskkill.exe //pid ${pid} //T //F`
      : `taskkill /pid ${pid} /T /F`;
  }
  return `kill -TERM -${pid} || kill -TERM ${pid}`;
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

function optionalPort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const port = positiveInteger(value);
  if (port === undefined || port > 65_535) {
    throw new Error("waitForPort must be an integer TCP port between 1 and 65535.");
  }
  return port;
}

function firstNonBlank(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function usePowerShellOnWindows(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.AGENTARBOR_USE_POWERSHELL_TOOL === "1" || env.CLAUDE_CODE_USE_POWERSHELL_TOOL === "1";
}

function windowsGitBashExecutable(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = firstNonBlank(
    env.AGENTARBOR_GIT_BASH_PATH,
    env.CLAUDE_CODE_GIT_BASH_PATH,
    env.GIT_BASH_PATH
  );
  if (configured !== undefined) {
    return configured;
  }
  return [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ].find((candidate) => existsSync(candidate));
}

async function shouldExecuteDirectly(input: {
  readonly command: string;
  readonly rootDirectory: string;
  readonly platform: NodeJS.Platform;
}): Promise<boolean> {
  if (input.platform !== "win32") {
    return true;
  }
  const resolved = await resolveWindowsCommandPath(input.command, input.rootDirectory);
  if (resolved === undefined) {
    return false;
  }
  const extension = path.extname(resolved).toLowerCase();
  return extension !== ".cmd" && extension !== ".bat";
}

async function resolveWindowsCommandPath(command: string, rootDirectory: string): Promise<string | undefined> {
  const hasSeparator = /[\\/]/u.test(command);
  const pathExts = windowsExecutableExtensions();
  if (path.isAbsolute(command) || hasSeparator) {
    const base = path.isAbsolute(command) ? command : path.resolve(rootDirectory, command);
    return firstExistingCommandCandidate(base, pathExts);
  }
  const searchPath = process.env.PATH ?? "";
  for (const directory of searchPath.split(path.delimiter).filter((entry) => entry.length > 0)) {
    const resolved = await firstExistingCommandCandidate(path.join(directory, command), pathExts);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}

async function firstExistingCommandCandidate(base: string, extensions: readonly string[]): Promise<string | undefined> {
  const explicitExtension = path.extname(base).length > 0;
  const candidates = explicitExtension ? [base] : [base, ...extensions.map((extension) => `${base}${extension}`)];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

function windowsExecutableExtensions(): readonly string[] {
  const configured = process.env.PATHEXT
    ?.split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return configured !== undefined && configured.length > 0
    ? configured
    : [".com", ".exe", ".bat", ".cmd"];
}
