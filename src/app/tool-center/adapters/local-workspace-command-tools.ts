import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, promises as fs, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SanitizedCommandShellConfig } from "../../../domain/config/index.js";
import type { ToolDefinition, ToolExecutionContext, ToolExecutor } from "../../../domain/tools/index.js";
import {
  createPlatformPortOccupantProbe,
  probeLocalPort,
  processPortFactFromLocalPortFact,
  waitForLocalPort,
  type LocalPortHost,
  type LocalPortOccupancyFact,
  type LocalPortProbeFact,
  type PortOccupantProbe,
  type ProcessPortFact,
  type ProcessRecord,
  type ProcessRecordUpdate,
  type ProcessRegistration,
} from "../../runtime-guard/index.js";
import { toSanitizedCommandShellConfig } from "../../config-center/command-shell-settings.js";
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
const MAX_COMMAND_STDOUT_CHARS = 16_000;
const MAX_COMMAND_STDERR_CHARS = 8_000;
const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_CANCELLED_EXIT_CODE = 130;
const COMMAND_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_BACKGROUND_WAIT_MS = 500;
const MAX_BACKGROUND_WAIT_MS = 5_000;
const BACKGROUND_LOG_PREVIEW_CHARS = 2_000;
const DEFAULT_WAIT_FOR_PORT_TIMEOUT_MS = 10_000;
const MAX_WAIT_FOR_PORT_TIMEOUT_MS = 60_000;
const COMMAND_LOG_REF_SCHEME = "command-log";
const COMMAND_LOG_REF_PREFIX = `${COMMAND_LOG_REF_SCHEME}://`;
const COMMAND_LOG_DIRECTORY_NAME = "agentarbor-command-logs";
const COMMAND_LOG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/u;

type CommandExecutionResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly cwd: string;
  readonly notStarted?: boolean;
  readonly timedOut?: boolean;
  readonly cancelled?: boolean;
  readonly signal?: string;
  readonly background?: boolean;
  readonly pid?: number;
  readonly logRef?: string;
  readonly logPath?: string;
  readonly stopCommand?: string;
  readonly durationMs?: number;
  readonly waitForPort?: number;
  readonly portReady?: boolean;
  readonly preStartPortOccupancy?: LocalPortOccupancyFact;
  readonly portWaitCancelled?: boolean;
  readonly truncated?: boolean;
  readonly stdoutChars?: number;
  readonly stderrChars?: number;
  readonly stdoutOmittedChars?: number;
  readonly stderrOmittedChars?: number;
};

type CommandExecutionOutcome = {
  readonly result: CommandExecutionResult;
  readonly processId?: string;
};

type CommandLogTarget = {
  readonly id: string;
  readonly ref: string;
  readonly path: string;
};

export type LocalCommandProcessRegistry = {
  readonly register: (input: ProcessRegistration) => unknown;
  readonly listAll?: () => readonly ProcessRecord[];
  readonly update?: (processId: string, patch: ProcessRecordUpdate) => unknown;
  readonly markExited?: (
    processId: string,
    input?: { readonly exitCode?: number; readonly signal?: string; readonly exitedAt?: string }
  ) => unknown;
  readonly appendPortFact?: (processId: string, fact: ProcessPortFact) => unknown;
};

export type LocalWorkspaceCommandToolOptions = LocalWorkspaceToolOptions & {
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly portOccupantProbe?: PortOccupantProbe;
};

export type LocalCommandLogReadEntry = {
  readonly refId: string;
  readonly title: string;
  readonly uri: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
};

type TextPreview = {
  readonly text: string;
  readonly chars: number;
  readonly omittedChars: number;
  readonly truncated: boolean;
};

type CommandProcessFacts = {
  readonly registry: LocalCommandProcessRegistry;
  readonly runId?: string;
  readonly toolCallId?: string;
};

type RegistryPortOwner = {
  readonly processId: string;
  readonly pid?: number;
  readonly match: "pid" | "port_fact";
};

export function createDefaultCommandShellConfig(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env
): SanitizedCommandShellConfig {
  return toSanitizedCommandShellConfig(undefined, { platform, env, now: "runtime-default" });
}

export function createLocalShellCommandTool(
  rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT,
  options: LocalWorkspaceCommandToolOptions = {}
): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  const commandShell = normalizeCommandShellConfig(options.commandShell);
  const portOccupantProbe = options.portOccupantProbe ?? createPlatformPortOccupantProbe();
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
      const processFacts = commandProcessFacts(options.processRegistry, context);
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
      const externalPortOccupantProbe = externalOnlyPortOccupantProbe(options.processRegistry, portOccupantProbe);
      const preStartPortFact = await probePreStartWaitPort({
        waitForPort,
        abortSignal: context.abortSignal,
        portOccupantProbe,
      });
      const preStartPortOccupancy = portOccupancyFromPreStartFact(preStartPortFact, options.processRegistry);
      throwIfAborted(context.abortSignal);
      if (background && preStartPortOccupancy !== undefined) {
        return commandToolOutput({
          action: "shell_command",
          command: normalized.command,
          commandLine: normalized.commandLine,
          legacyArgs: normalized.legacyArgs,
          shell: commandShell,
          result: commandNotStartedForOccupiedPort({
            cwd: cwd.relativePath,
            waitForPort,
            preStartPortOccupancy,
            startedAt,
          }),
          truncated: false,
        });
      }
      const rawOutcome = background
        ? normalized.legacyProgram === undefined || !executeDirectly
          ? await runBackgroundShellCommand(commandShell, normalized.commandLine, cwd.absolutePath, cwd.relativePath, backgroundWaitMs, processFacts)
          : await runBackgroundProgramCommand(commandShell, normalized.legacyProgram, normalized.legacyArgs, normalized.commandLine, cwd.absolutePath, cwd.relativePath, backgroundWaitMs, processFacts)
        : normalized.legacyProgram === undefined || !executeDirectly
          ? await runShellCommand(commandShell, normalized.commandLine, cwd.absolutePath, cwd.relativePath, timeoutMs, context.abortSignal, processFacts)
          : await runProgramCommand(normalized.legacyProgram, normalized.legacyArgs, normalized.commandLine, cwd.absolutePath, cwd.relativePath, timeoutMs, context.abortSignal, processFacts);
      const result = await enrichCommandResult({
        result: rawOutcome.result,
        waitForPort,
        waitForPortTimeoutMs,
        preStartPortFact,
        startedAt,
        abortSignal: context.abortSignal,
        processRegistry: options.processRegistry,
        processId: rawOutcome.processId,
        portOccupantProbe: externalPortOccupantProbe,
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
  options: LocalWorkspaceCommandToolOptions = {}
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
          "background=true starts the command as a detached background process and returns pid, logRef, diagnostic logPath, and stopCommand.",
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
          "Returns result.commandLine, result.shell, result.exitCode, result.stdout/result.stderr previews, truncation facts, controlled logRef, and timeout/background metadata when relevant.",
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
      "Use commandLine for normal shell-native command execution, including mkdir, copy, move, delete, package manager, build, test, git, and binary-file workflows.",
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
        "Use as the general-purpose workspace command tool for shell-native workflows such as builds, tests, git, package managers, environment probes, directory creation, file moves, and binary-file operations.",
        "Use when a normal CLI command is the direct way to do the task.",
      ],
      whenNotToUse: [
        "Do not use when read_file, list_dir, grep_files, edit_file, http_request, or browser_snapshot is the clearer direct fit.",
      ],
      inputNotes: [
        "commandLine is the normal complete shell command line.",
        "command plus args executes a program directly with argv and bypasses shell parsing.",
        "background=true starts a detached process and returns immediately with pid, logRef, diagnostic logPath, and stopCommand.",
        "cwd optionally selects a workspace-relative working directory; omit it to run from the workspace root.",
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
        "Use background=true for dev servers, file watchers, long-running demos, and other commands expected to keep running.",
        "Use command and args when quoting would be fragile, especially for inline scripts such as node -e, python -c, or paths and arguments that are easier to express as argv.",
        "If curl is unavailable, use the installed runtime such as node or python for HTTP requests instead of waiting for a separate HTTP tool.",
        "Use this tool for normal filesystem commands such as mkdir, rmdir, copy, move, and recursive cleanup.",
        "For dev servers, combine background=true with waitForPort so the tool returns only after the local port is reachable or the port wait times out.",
        "When background=true, do not append shell-native background operators such as POSIX & just to detach the process; the tool already returns pid, logRef, diagnostic logPath, and stopCommand.",
        "Use cwd instead of repeated cd chaining when the command should run inside a project subdirectory.",
        "Before relying on a command, you may probe the environment with ordinary shell commands such as where, which, command -v, or version checks.",
      ],
      outputNotes: [
        `result.stdout and result.stderr are model-visible previews capped at ${MAX_COMMAND_STDOUT_CHARS} and ${MAX_COMMAND_STDERR_CHARS} characters for foreground command output; under those caps they contain the exact command text.`,
        "result.stdoutTruncated/result.stderrTruncated, result.stdoutChars/result.stderrChars, and result.stdoutOmittedChars/result.stderrOmittedChars report the concrete truncation facts for those previews.",
        "result.shell records the shell that executed the command.",
        "result.cwd records the workspace-relative working directory used for the command.",
        "result.timedOut is true when the foreground command exceeded timeoutMs; stdout/stderr contain captured output before termination.",
        "result.background, result.pid, result.logRef, result.logPath, and result.stopCommand describe detached background commands; these small metadata fields are not shortened by stdout/stderr preview budgeting.",
        "Use result.logRef as the controlled command-log entry point. result.logPath is retained only as a diagnostic filesystem detail.",
        "result.durationMs records total observed tool execution time; result.portReady records whether waitForPort became reachable.",
        "If background=true and waitForPort is already occupied before start, result.notStarted is true, result.exitCode is null, and result.preStartPortOccupancy records the port, pid when known, owner status, and observation source.",
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
          description: "If true, start the command as a detached background process and return pid, logRef, diagnostic logPath, and stopCommand without waiting for the process to exit.",
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
    readonly exitCode: number | null;
    readonly notStarted?: boolean;
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
    readonly logRef?: string;
    readonly logPath?: string;
    readonly stopCommand?: string;
    readonly durationMs?: number;
    readonly waitForPort?: number;
    readonly portReady?: boolean;
    readonly preStartPortOccupancy?: LocalPortOccupancyFact;
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
  const statusText = input.result.notStarted === true
    ? input.result.preStartPortOccupancy !== undefined
      ? `not started; port ${input.result.preStartPortOccupancy.port} occupied`
      : "not started"
    : input.result.background === true
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
      notStarted: input.result.notStarted === true ? true : undefined,
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
      logRef: input.result.logRef,
      logPath: input.result.logPath,
      stopCommand: input.result.stopCommand,
      durationMs: input.result.durationMs,
      waitForPort: input.result.waitForPort,
      portReady: input.result.portReady,
      preStartPortOccupancy: input.result.preStartPortOccupancy,
      portWaitCancelled: input.result.portWaitCancelled === true ? true : undefined,
    },
    truncated: input.truncated || input.result.truncated === true || stdout.truncated || stderr.truncated,
  };
}

export async function readLocalCommandLogRef(
  ref: string,
  request: { readonly maxLength: number; readonly abortSignal?: AbortSignal }
): Promise<LocalCommandLogReadEntry | undefined> {
  throwIfAborted(request.abortSignal);
  const target = commandLogTargetFromRef(ref);
  if (target === undefined) {
    return undefined;
  }
  let content: string;
  try {
    content = await fs.readFile(target.path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
  throwIfAborted(request.abortSignal);
  return {
    refId: ref,
    title: `Command log ${target.id}`,
    uri: ref,
    content,
    metadata: {
      id: target.id,
    },
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

function commandProcessFacts(
  registry: LocalCommandProcessRegistry | undefined,
  context: ToolExecutionContext
): CommandProcessFacts | undefined {
  if (registry === undefined) {
    return undefined;
  }
  const record = asRecord(context);
  return {
    registry,
    runId: stringField(record.runId) ?? stringField(record.traceId),
    toolCallId: stringField(record.toolCallId) ?? stringField(record.callId),
  };
}

function registerCommandProcess(
  facts: CommandProcessFacts | undefined,
  input: Omit<ProcessRegistration, "processId" | "owned" | "runId" | "toolCallId" | "ports" | "facts">
): string | undefined {
  if (facts === undefined) {
    return undefined;
  }
  const processId = `process-${randomUUID()}`;
  const registration: ProcessRegistration = {
    ...input,
    processId,
    runId: facts.runId,
    toolCallId: facts.toolCallId,
    owned: true,
  };
  try {
    facts.registry.register(registration);
    return processId;
  } catch {
    return undefined;
  }
}

function markCommandProcessExited(
  facts: CommandProcessFacts | undefined,
  processId: string | undefined,
  input: { readonly exitCode?: number; readonly signal?: string }
): void {
  if (facts === undefined || processId === undefined) {
    return;
  }
  try {
    if (facts.registry.markExited !== undefined) {
      facts.registry.markExited(processId, {
        exitCode: input.exitCode,
        signal: input.signal,
        exitedAt: new Date().toISOString(),
      });
      return;
    }
    facts.registry.update?.(processId, {
      status: "exited",
      endedAt: new Date().toISOString(),
      exitCode: input.exitCode,
      signal: input.signal,
    });
  } catch {
    // Process facts are observational and must not change command execution results.
  }
}

function appendCommandPortFact(
  registry: LocalCommandProcessRegistry | undefined,
  processId: string | undefined,
  fact: ProcessPortFact
): void {
  if (registry === undefined || processId === undefined) {
    return;
  }
  try {
    if (registry.appendPortFact !== undefined) {
      registry.appendPortFact(processId, fact);
      return;
    }
    registry.update?.(processId, { ports: [fact] });
  } catch {
    // Process facts are observational and must not change command execution results.
  }
}

function externalOnlyPortOccupantProbe(
  registry: LocalCommandProcessRegistry | undefined,
  probe: PortOccupantProbe
): PortOccupantProbe {
  return async (input) => {
    const observed = await probe(input);
    if (observed === undefined) {
      return undefined;
    }
    if (findActiveRegistryPortOwner(registry, input.port, input.host, observed.pid) !== undefined) {
      return undefined;
    }
    return observed;
  };
}

function findActiveRegistryPortOwner(
  registry: LocalCommandProcessRegistry | undefined,
  port: number,
  host: LocalPortHost,
  observedPid: number | undefined
): RegistryPortOwner | undefined {
  const records = registry?.listAll?.() ?? [];
  for (const record of records) {
    if (record.owned !== true || !isActiveProcessStatus(record.status)) {
      continue;
    }
    if (observedPid !== undefined) {
      if (record.pid !== observedPid) {
        continue;
      }
      return {
        processId: record.processId,
        pid: record.pid,
        match: "pid",
      };
    }
    if (record.ports.some((fact) => fact.port === port && fact.host === host && fact.ready === true)) {
      return {
        processId: record.processId,
        pid: record.pid,
        match: "port_fact",
      };
    }
  }
  return undefined;
}

function isActiveProcessStatus(status: ProcessRecord["status"]): boolean {
  return status === "starting" || status === "running" || status === "killing";
}

async function probePreStartWaitPort(input: {
  readonly waitForPort: number | undefined;
  readonly abortSignal: AbortSignal | undefined;
  readonly portOccupantProbe: PortOccupantProbe;
}): Promise<LocalPortProbeFact | undefined> {
  if (input.waitForPort === undefined) {
    return undefined;
  }
  const fact = await probeLocalPort({
    port: input.waitForPort,
    host: "127.0.0.1",
    timeoutMs: 250,
    abortSignal: input.abortSignal,
    portOccupantProbe: input.portOccupantProbe,
  });
  return fact.ready === true ? fact : undefined;
}

function portOccupancyFromPreStartFact(
  fact: LocalPortProbeFact | undefined,
  registry: LocalCommandProcessRegistry | undefined
): LocalPortOccupancyFact | undefined {
  if (fact === undefined || fact.ready !== true) {
    return undefined;
  }
  const observedPid = fact.externalOccupant?.pid;
  const registryOwner = findActiveRegistryPortOwner(registry, fact.port, fact.host, observedPid);
  const pid = observedPid;
  const source = fact.externalOccupant?.observedBy ?? "connect_probe";
  if (registryOwner?.match === "pid") {
    return {
      kind: "pre_start_port_occupancy",
      port: fact.port,
      host: fact.host,
      occupied: true,
      ...(pid === undefined ? {} : { pid }),
      pidKnown: pid !== undefined,
      owner: "agentarbor",
      ownedByUs: true,
      source,
      ownershipSource: "process_registry",
      registryProcessId: registryOwner.processId,
      checkedAt: fact.checkedAt,
    };
  }
  return {
    kind: "pre_start_port_occupancy",
    port: fact.port,
    host: fact.host,
    occupied: true,
    ...(pid === undefined ? {} : { pid }),
    pidKnown: pid !== undefined,
    owner: "unknown",
    ownerUnknown: true,
    source,
    checkedAt: fact.checkedAt,
  };
}

function commandNotStartedForOccupiedPort(input: {
  readonly cwd: string;
  readonly waitForPort: number | undefined;
  readonly preStartPortOccupancy: LocalPortOccupancyFact;
  readonly startedAt: number;
}): CommandExecutionResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: null,
    cwd: input.cwd,
    notStarted: true,
    waitForPort: input.waitForPort,
    portReady: false,
    preStartPortOccupancy: input.preStartPortOccupancy,
    durationMs: Date.now() - input.startedAt,
    stdoutChars: 0,
    stderrChars: 0,
    stdoutOmittedChars: 0,
    stderrOmittedChars: 0,
    truncated: false,
  };
}

async function runShellCommand(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  processFacts: CommandProcessFacts | undefined
): Promise<CommandExecutionOutcome> {
  const args = shellArgs(shell, commandLine);
  return runSpawnedCommand(shell.executable, args, workingDirectory, relativeCwd, timeoutMs, abortSignal, {
    commandLine,
    windowsVerbatimArguments: shell.syntax === "cmd",
  }, processFacts);
}

async function runProgramCommand(
  command: string,
  args: readonly string[],
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  processFacts: CommandProcessFacts | undefined
): Promise<CommandExecutionOutcome> {
  return runSpawnedCommand(command, [...args], workingDirectory, relativeCwd, timeoutMs, abortSignal, { commandLine }, processFacts);
}

async function runBackgroundShellCommand(
  shell: SanitizedCommandShellConfig,
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  waitMs: number,
  processFacts: CommandProcessFacts | undefined
): Promise<CommandExecutionOutcome> {
  const logTarget = await createCommandLogTarget(commandLine);
  return runBackgroundCommand({
    file: shell.executable,
    args: shellArgs(shell, backgroundShellRedirectCommandLine(shell, commandLine, logTarget.path)),
    commandLine,
    workingDirectory,
    relativeCwd,
    waitMs,
    stopShellSyntax: shell.syntax,
    platform: shell.platform,
    logTarget,
    captureMode: "shell-redirection",
    windowsVerbatimArguments: shell.syntax === "cmd",
    processFacts,
  });
}

async function runBackgroundProgramCommand(
  shell: SanitizedCommandShellConfig,
  command: string,
  args: readonly string[],
  commandLine: string,
  workingDirectory: string,
  relativeCwd: string,
  waitMs: number,
  processFacts: CommandProcessFacts | undefined
): Promise<CommandExecutionOutcome> {
  return runBackgroundCommand({
    file: command,
    args: [...args],
    commandLine,
    workingDirectory,
    relativeCwd,
    waitMs,
    stopShellSyntax: shell.syntax,
    platform: shell.platform,
    processFacts,
  });
}

async function runSpawnedCommand(
  file: string,
  args: readonly string[],
  workingDirectory: string,
  relativeCwd: string,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
  options: { readonly commandLine: string; readonly windowsVerbatimArguments?: boolean },
  processFacts: CommandProcessFacts | undefined
): Promise<CommandExecutionOutcome> {
  const logTarget = await createCommandLogTarget(options.commandLine);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let child: ChildProcess;
    let processId: string | undefined;
    let logFd: number | undefined = openSync(logTarget.path, "a");
    const stdout = createBoundedOutputCollector(MAX_COMMAND_STDOUT_CHARS);
    const stderr = createBoundedOutputCollector(MAX_COMMAND_STDERR_CHARS);
    writeCommandLogHeader(logFd, options.commandLine, relativeCwd);
    const appendStdout = (chunk: Buffer) => {
      stdout.append(chunk);
      writeCommandLogChunk(logFd, "stdout", chunk);
    };
    const appendStderr = (chunk: Buffer) => {
      stderr.append(chunk);
      writeCommandLogChunk(logFd, "stderr", chunk);
    };
    const appendStderrText = (text: string) => {
      stderr.appendText(text);
      writeCommandLogText(logFd, "stderr", text);
    };
    const closeLog = () => {
      if (logFd === undefined) {
        return;
      }
      closeSync(logFd);
      logFd = undefined;
    };
    const removeLog = () => {
      void fs.unlink(logTarget.path).catch(() => {
        // Best-effort cleanup for non-truncated foreground commands.
      });
    };
    const appendTerminationDiagnostic = () => {
      const timeoutMessage = timedOut ? `Command timed out after ${timeoutMs}ms and was terminated.` : undefined;
      const cancelMessage = cancelled ? "Command execution cancelled." : undefined;
      if (timeoutMessage !== undefined) appendStderrText(timeoutMessage);
      if (cancelMessage !== undefined) appendStderrText(cancelMessage);
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
      closeLog();
      markCommandProcessExited(processFacts, processId, {
        exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
        signal: value.signal,
      });
      if (value.truncated === true) {
        resolve({
          result: {
            ...value,
            logRef: logTarget.ref,
            logPath: logTarget.path,
          },
          processId,
        });
        return;
      }
      removeLog();
      resolve({ result: value, processId });
    };
    const requestTermination = () => {
      terminateProcessTree(child);
      if (terminationTimer === undefined) {
        terminationTimer = setTimeout(() => {
          appendTerminationDiagnostic();
          appendStderrText(
            `Command process did not close within ${COMMAND_TERMINATION_GRACE_MS}ms after termination was requested.`
          );
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(resultFromClose(null, undefined));
        }, COMMAND_TERMINATION_GRACE_MS);
        terminationTimer.unref?.();
      }
    };
    try {
      child = spawn(file, [...args], {
        cwd: workingDirectory,
        windowsHide: true,
        windowsVerbatimArguments: options.windowsVerbatimArguments === true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      closeLog();
      removeLog();
      reject(error);
      return;
    }
    processId = registerCommandProcess(processFacts, {
      kind: "foreground",
      pid: child.pid,
      commandLine: options.commandLine,
      cwd: workingDirectory,
      startedAt: new Date().toISOString(),
      status: "running",
    });
    if (child.stdout === null || child.stderr === null) {
      closeLog();
      removeLog();
      throw new Error("Command process did not expose stdout/stderr pipes.");
    }
    child.stdout.on("data", appendStdout);
    child.stderr.on("data", appendStderr);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (abortHandler !== undefined) {
        abortSignal?.removeEventListener("abort", abortHandler);
      }
      markCommandProcessExited(processFacts, processId, {});
      closeLog();
      removeLog();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      appendTerminationDiagnostic();
      finish(resultFromClose(code, signal));
    });
    timer = setTimeout(() => {
      if (cancelled) {
        return;
      }
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
  readonly preStartPortFact: LocalPortProbeFact | undefined;
  readonly startedAt: number;
  readonly abortSignal: AbortSignal | undefined;
  readonly processRegistry: LocalCommandProcessRegistry | undefined;
  readonly processId?: string;
  readonly portOccupantProbe: PortOccupantProbe;
}): Promise<CommandExecutionResult> {
  if (input.waitForPort === undefined) {
    return {
      ...input.result,
      durationMs: Date.now() - input.startedAt,
    };
  }
  if (input.result.background !== true) {
    const portFact = input.preStartPortFact ?? await probeLocalPort({
      port: input.waitForPort,
      host: "127.0.0.1",
      timeoutMs: Math.min(250, input.waitForPortTimeoutMs),
      abortSignal: input.abortSignal,
      portOccupantProbe: input.portOccupantProbe,
    });
    const preStartPortOccupancy = portOccupancyFromPreStartFact(portFact, input.processRegistry);
    appendCommandPortFact(input.processRegistry, input.processId, processPortFactFromLocalPortFact(portFact));
    return {
      ...input.result,
      waitForPort: input.waitForPort,
      portReady: false,
      preStartPortOccupancy,
      durationMs: Date.now() - input.startedAt,
      stderr: appendCommandDiagnostic(
        input.result.stderr,
        "waitForPort was requested but the command is not running in the background."
      ),
    };
  }
  if (input.preStartPortFact !== undefined) {
    appendCommandPortFact(
      input.processRegistry,
      input.processId,
      processPortFactFromLocalPortFact(input.preStartPortFact)
    );
  }
  const portWait = await waitForLocalPort({
    port: input.waitForPort,
    host: "127.0.0.1",
    timeoutMs: input.waitForPortTimeoutMs,
    probeTimeoutMs: 250,
    pollIntervalMs: 100,
    abortSignal: input.abortSignal,
    portOccupantProbe: input.portOccupantProbe,
  });
  appendCommandPortFact(input.processRegistry, input.processId, processPortFactFromLocalPortFact(portWait));
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
  readonly logTarget?: CommandLogTarget;
  readonly captureMode?: "stdio" | "shell-redirection";
  readonly windowsVerbatimArguments?: boolean;
  readonly processFacts?: CommandProcessFacts;
}): Promise<CommandExecutionOutcome> {
  const logTarget = input.logTarget ?? await createCommandLogTarget(input.commandLine);
  const logPath = logTarget.path;
  const captureMode = input.captureMode ?? "stdio";
  const logFd = captureMode === "stdio" ? openSync(logPath, "a") : undefined;
  let child: ChildProcess | undefined;
  let earlyExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  const startedAt = new Date().toISOString();
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
  const pid = child.pid;
  if (earlyExit !== undefined) {
    const processId = registerCommandProcess(input.processFacts, {
      kind: "background",
      pid,
      commandLine: input.commandLine,
      cwd: input.workingDirectory,
      startedAt,
      status: "exited",
      exitCode: typeof earlyExit.code === "number" ? earlyExit.code : COMMAND_CANCELLED_EXIT_CODE,
      signal: earlyExit.signal ?? undefined,
      logRef: logTarget.ref,
      logPath,
    });
    const logPreview = await readBackgroundLogPreview(logPath);
    const stderr = `Background command exited before it stayed running${earlyExit.signal == null ? "" : ` with signal ${earlyExit.signal}`}.`;
    return {
      processId,
      result: {
        stdout: logPreview.text,
        stderr,
        exitCode: typeof earlyExit.code === "number" ? earlyExit.code : COMMAND_CANCELLED_EXIT_CODE,
        cwd: input.relativeCwd,
        signal: earlyExit.signal ?? undefined,
        logRef: logTarget.ref,
        logPath,
        stdoutChars: logPreview.chars,
        stderrChars: stderr.length,
        stdoutOmittedChars: logPreview.omittedChars,
        stderrOmittedChars: 0,
        truncated: logPreview.truncated,
      },
    };
  }
  const stopCommand = pid === undefined ? undefined : stopCommandForPid(pid, input.platform, input.stopShellSyntax);
  const processId = registerCommandProcess(input.processFacts, {
    kind: "background",
    pid,
    commandLine: input.commandLine,
    cwd: input.workingDirectory,
    startedAt,
    status: "running",
    logRef: logTarget.ref,
    logPath,
    stopCommand,
  });
  const initialLogPreview = await readBackgroundLogPreview(logPath, BACKGROUND_LOG_PREVIEW_CHARS);
  const stdout = [
    `Started background process${pid === undefined ? "" : ` pid ${pid}`}.`,
    `Log: ${logTarget.ref}`,
    stopCommand === undefined ? undefined : `Stop: ${stopCommand}`,
    initialLogPreview.text.trim().length === 0 ? undefined : `Initial output:\n${initialLogPreview.text}`,
  ].filter((line): line is string => line !== undefined).join("\n");
  return {
    processId,
    result: {
      stdout,
      stderr: "",
      exitCode: 0,
      cwd: input.relativeCwd,
      background: true,
      pid,
      logRef: logTarget.ref,
      logPath,
      stopCommand,
      stdoutChars: stdout.length + initialLogPreview.omittedChars,
      stderrChars: 0,
      stdoutOmittedChars: initialLogPreview.omittedChars,
      stderrOmittedChars: 0,
      truncated: initialLogPreview.truncated,
    },
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

async function createCommandLogTarget(commandLine: string): Promise<CommandLogTarget> {
  const directory = commandLogDirectory();
  await fs.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${timestamp}-${randomUUID()}-${safeRefToken(commandLine)}`;
  return {
    id,
    ref: `${COMMAND_LOG_REF_PREFIX}${id}`,
    path: path.join(directory, `${id}.log`),
  };
}

function commandLogTargetFromRef(ref: string): CommandLogTarget | undefined {
  if (!ref.startsWith(COMMAND_LOG_REF_PREFIX)) {
    return undefined;
  }
  const id = ref.slice(COMMAND_LOG_REF_PREFIX.length);
  if (!COMMAND_LOG_ID_PATTERN.test(id)) {
    return undefined;
  }
  return {
    id,
    ref,
    path: path.join(commandLogDirectory(), `${id}.log`),
  };
}

function commandLogDirectory(): string {
  return path.join(os.tmpdir(), COMMAND_LOG_DIRECTORY_NAME);
}

function writeCommandLogHeader(fd: number | undefined, commandLine: string, cwd: string): void {
  if (fd === undefined) {
    return;
  }
  writeSync(fd, [
    `command: ${commandLine}`,
    `cwd: ${cwd}`,
    `createdAt: ${new Date().toISOString()}`,
    "",
  ].join("\n"));
}

function writeCommandLogChunk(fd: number | undefined, stream: "stdout" | "stderr", chunk: Buffer): void {
  if (fd === undefined || chunk.length === 0) {
    return;
  }
  writeSync(fd, `\n[${stream}]\n`);
  writeSync(fd, chunk);
}

function writeCommandLogText(fd: number | undefined, stream: "stdout" | "stderr", text: string): void {
  if (fd === undefined || text.length === 0) {
    return;
  }
  writeSync(fd, `\n[${stream}]\n${text}`);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT";
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
