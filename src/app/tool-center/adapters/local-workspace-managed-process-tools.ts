import path from "node:path";
import type { ToolExecutor } from "../../../domain/tools/index.js";
import type { ProcessTerminator, ProcessRecord } from "../../runtime-guard/index.js";
import {
  createLocalShellCommandTool,
  type LocalCommandProcessRegistry,
  type LocalWorkspaceCommandToolOptions,
} from "./local-workspace-command-tools.js";

export type LocalManagedProcessToolOptions = LocalWorkspaceCommandToolOptions & {
  readonly processTerminator?: ProcessTerminator;
};

export function createLocalManagedProcessTools(
  rootDirectory: string,
  options: LocalManagedProcessToolOptions = {},
): readonly ToolExecutor[] {
  const shellCommand = createLocalShellCommandTool(rootDirectory, options);
  return [
    createStartProcessTool(shellCommand, options.processRegistry),
    createInspectProcessTool(rootDirectory, options.processRegistry),
    createStopProcessTool(rootDirectory, options.processRegistry, options.processTerminator),
  ];
}

function createStartProcessTool(
  shellCommand: ToolExecutor,
  processRegistry: LocalCommandProcessRegistry | undefined,
): ToolExecutor {
  return {
    definition: {
      name: "start_process",
      description: "Start a workspace process that remains available after the current Agent run and can be inspected or stopped by processId.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
        operationType: "execute",
        requiresConfirmation: true,
      },
      modelContract: {
        purpose: "Start a long-running workspace service or watcher and return a stable processId, readiness facts, and a controlled log reference.",
        whenToUse: [
          "Use for dev servers, file watchers, preview servers, and other commands expected to keep running after this Agent run.",
          "Use inspect_process with the returned processId to verify state and stop_process to terminate it.",
        ],
        whenNotToUse: [
          "Use shell_command for one-shot commands that should wait for an exit code.",
        ],
        outputNotes: [
          "state is running, exited, or not_started; a running process has no exitCode yet.",
          "processId is the stable identity for later inspection and stopping; pid is diagnostic only.",
          "not_started means no process was created, for example because waitForPort was already occupied; the returned occupancy facts explain why.",
          "The default lifetime is workspace_session and survives the current Agent run until explicitly stopped or the Workbench shuts down.",
        ],
      },
      inputSchema: processStartInputSchema(),
    },
    execute: async (input, context) => {
      if (processRegistry === undefined) {
        throw new Error("start_process requires the Host process registry.");
      }
      const record = asRecord(input);
      const output = asRecord(await shellCommand.execute({
        ...record,
        background: true,
        lifetime: record.lifetime ?? "workspace_session",
      }, context));
      const processId = stringValue(output.processId);
      const {
        processState: _processState,
        background: _background,
        exitCode,
        ...facts
      } = output;
      const lifetime = stringValue(output.lifetime) ?? stringValue(record.lifetime) ?? "workspace_session";
      if (output.notStarted === true) {
        return {
          ...facts,
          state: "not_started",
          lifetime,
          ...(typeof exitCode === "number" ? { exitCode } : {}),
        };
      }
      if (processId === undefined) {
        throw new Error("start_process did not receive a stable processId from the Host process registry.");
      }
      const state = stringValue(output.processState) ?? (output.exitCode === null ? "running" : "exited");
      return {
        ...facts,
        processId,
        state,
        lifetime,
        ...(typeof exitCode === "number" ? { exitCode } : {}),
      };
    },
  };
}

function createInspectProcessTool(
  rootDirectory: string,
  processRegistry: LocalCommandProcessRegistry | undefined,
): ToolExecutor {
  return {
    definition: {
      name: "inspect_process",
      description: "Inspect one managed workspace process by processId, or list managed processes in the current workspace.",
      metadata: {
        category: "terminal",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
      modelContract: {
        purpose: "Read current process state, command, lifetime, pid diagnostic, ports, and log references without executing or changing the process.",
        whenToUse: ["Use after start_process or when recovering a processId from earlier conversation context."],
        outputNotes: ["A supplied processId returns found=false when it is absent or outside this workspace. Without processId, only this workspace's managed records are listed."],
      },
      inputSchema: {
        type: "object",
        properties: {
          processId: { type: "string", description: "Stable process identity returned by start_process." },
        },
        additionalProperties: false,
      },
    },
    execute: async (input) => {
      if (processRegistry?.get === undefined || processRegistry.listAll === undefined) {
        throw new Error("inspect_process requires the Host process registry.");
      }
      const processId = stringValue(asRecord(input).processId);
      if (processId !== undefined) {
        const record = processRegistry.get(processId);
        if (record === undefined || !isInsideWorkspace(rootDirectory, record.cwd)) {
          return { found: false, processId };
        }
        return { found: true, ...processFacts(record) };
      }
      const processes = processRegistry.listAll()
        .filter((record) => isInsideWorkspace(rootDirectory, record.cwd))
        .map(processFacts);
      return { found: true, processes };
    },
  };
}

function createStopProcessTool(
  rootDirectory: string,
  processRegistry: LocalCommandProcessRegistry | undefined,
  processTerminator: ProcessTerminator | undefined,
): ToolExecutor {
  return {
    definition: {
      name: "stop_process",
      description: "Stop one owned managed workspace process by stable processId and return the observed termination result.",
      metadata: {
        category: "terminal",
        riskLevel: "medium",
        operationType: "execute",
        requiresConfirmation: true,
      },
      modelContract: {
        purpose: "Terminate an existing workspace process without reconstructing or replaying its original shell command.",
        whenToUse: ["Use the exact processId returned by start_process or inspect_process."],
        outputNotes: ["stopStatus distinguishes stopped, already_stopped, not_found, not_owned, unknown, and failed."],
      },
      inputSchema: {
        type: "object",
        properties: {
          processId: { type: "string", description: "Stable process identity returned by start_process." },
        },
        required: ["processId"],
        additionalProperties: false,
      },
    },
    execute: async (input) => {
      if (processRegistry?.get === undefined || processRegistry.stopOwned === undefined || processTerminator === undefined) {
        throw new Error("stop_process requires the Host process registry and process terminator.");
      }
      const processId = stringValue(asRecord(input).processId);
      if (processId === undefined) {
        throw new Error("stop_process processId must be a non-empty string.");
      }
      const record = processRegistry.get(processId);
      if (record === undefined || !isInsideWorkspace(rootDirectory, record.cwd)) {
        return { processId, stopStatus: "not_found" };
      }
      const result = await processRegistry.stopOwned(processId, processTerminator);
      if (result.status === "not_found" || result.status === "not_owned") {
        return { processId, stopStatus: result.status };
      }
      if (result.status === "already_stopped") {
        return { processId, stopStatus: result.status, ...processFacts(result.process) };
      }
      if (result.status === "unknown" || result.status === "failed") {
        const error = new Error(`Could not confirm stopping managed process ${processId}.`);
        Object.assign(error, {
          code: result.status === "failed" ? "process_stop_failed" : "process_stop_unknown",
          facts: {
            processId,
            stopStatus: result.status,
            state: result.process.status,
            killTree: result.killTree,
          },
        });
        throw error;
      }
      return { processId, stopStatus: result.status, ...processFacts(result.process) };
    },
  };
}

function processStartInputSchema() {
  return {
    type: "object" as const,
    properties: {
      commandLine: { type: "string" as const, description: "Complete shell command line to start." },
      command: { type: "string" as const, description: "Direct executable name or path." },
      args: { type: "array" as const, items: { type: "string" as const }, description: "Direct argv values." },
      cwd: { type: "string" as const, description: "Workspace-relative working directory." },
      lifetime: {
        type: "string" as const,
        enum: ["run", "workspace_session"] as const,
        description: "run is cleaned with the current run; workspace_session survives the run and ends on explicit stop or Workbench shutdown.",
      },
      backgroundWaitMs: { type: "number" as const, description: "Startup observation window in milliseconds." },
      waitForPort: { type: "number" as const, description: "Local TCP port to wait for after startup." },
      waitForPortTimeoutMs: { type: "number" as const, description: "Maximum local port readiness wait." },
    },
    additionalProperties: false as const,
  };
}

function processFacts(record: ProcessRecord): Record<string, unknown> {
  return {
    processId: record.processId,
    state: record.status,
    lifetime: record.lifetime,
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    ...(record.pid === undefined ? {} : { pid: record.pid }),
    commandLine: record.commandLine,
    cwd: record.cwd,
    startedAt: record.startedAt,
    ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.signal === undefined ? {} : { signal: record.signal }),
    ...(record.logRef === undefined ? {} : { logRef: record.logRef }),
    ...(record.logPath === undefined ? {} : { logPath: record.logPath }),
    ...(record.stopCommand === undefined ? {} : { stopCommand: record.stopCommand }),
    ports: record.ports,
    facts: record.facts,
  };
}

function isInsideWorkspace(rootDirectory: string, candidate: string): boolean {
  const root = path.resolve(rootDirectory);
  const relative = path.relative(root, path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
