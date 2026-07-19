import type {
  CapabilityToolAvailability,
  ModelCapabilities,
  SanitizedCommandShellConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import type { Constraint } from "../../domain/constraints.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolCategory, ToolDefinition, ToolExecutor } from "../../domain/tools/index.js";
import type { ProcessTerminator } from "../runtime-guard/index.js";
import {
  createBrowserSnapshotTool,
} from "./adapters/browser-tool.js";
import {
  createContextAttachmentTools,
} from "./adapters/context-attachment-tools.js";
import {
  createHttpRequestTool,
} from "./adapters/http-request-tool.js";
import {
  createLocalCreateFileTool,
  createLocalDeleteFileTool,
  createLocalEditFileTool,
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
  createLocalWriteFileTool,
} from "./adapters/local-workspace-tools.js";
import {
  createDefaultCommandShellConfig,
  createLocalShellCommandTool,
  type LocalCommandProcessRegistry,
} from "./adapters/local-workspace-command-tools.js";
import { createLocalManagedProcessTools } from "./adapters/local-workspace-managed-process-tools.js";
import {
  createLocalWorkspaceSandboxPolicy,
} from "./adapters/local-workspace-sandbox.js";
import { createReadToolOutputTool } from "./adapters/tool-output-read-tool.js";
import { ToolRegistry, type ToolRegistryScope } from "./tool-registry.js";
import type { ToolOutputStore } from "./tool-output-store.js";
import type { ToolOutputTokenCounter } from "./tool-output-limits.js";
import type { ToolExecutionMetricsSink } from "../../domain/tools/index.js";

export type CreateAgentToolRegistryOptions = {
  readonly runtime?: { readonly constraints?: readonly Constraint[] };
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: ToolRegistryFetchLike;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
  readonly toolCatalogNames?: readonly string[];
  readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
  readonly baseToolScopes?: readonly ToolRegistryScope[];
  readonly commandShell?: SanitizedCommandShellConfig;
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly processTerminator?: ProcessTerminator;
  readonly taskSoil?: TaskSoil;
  readonly modelCapabilities?: ModelCapabilities;
  readonly toolOutputStore?: ToolOutputStore;
  readonly outputTokenCounter?: ToolOutputTokenCounter;
  readonly metricsSink?: ToolExecutionMetricsSink;
};

export type ToolRegistryFetchLike = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
}>;

export function createAgentToolRegistry(
  options: CreateAgentToolRegistryOptions = {},
  registry?: ToolRegistry,
): ToolRegistry {
  const targetRegistry = registry ?? new ToolRegistry({
    toolCenter: {
      outputStore: options.toolOutputStore,
      outputTokenCounter: options.outputTokenCounter,
      metricsSink: options.metricsSink,
    },
  });
  const env = options.env ?? process.env;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const sandboxPolicy = createLocalWorkspaceSandboxPolicy();
  const commandShell = options.commandShell ?? createDefaultCommandShellConfig(process.platform, env);
  const playwrightAvailable = options.playwrightAvailable ?? isPackageResolvable("playwright");
  const baseToolScopes = options.baseToolScopes ?? ["agent-basic"];
  const executors: readonly ToolExecutor[] = [
    createLocalReadFileTool(workspaceRoot, { sandboxPolicy, outputTokenCounter: options.outputTokenCounter }),
    createLocalListDirTool(workspaceRoot, { sandboxPolicy, outputTokenCounter: options.outputTokenCounter }),
    createLocalGrepFilesTool(workspaceRoot, { sandboxPolicy, outputTokenCounter: options.outputTokenCounter }),
    createLocalCreateFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalWriteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalEditFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalDeleteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalShellCommandTool(workspaceRoot, { sandboxPolicy, commandShell, processRegistry: options.processRegistry }),
    ...createLocalManagedProcessTools(workspaceRoot, {
      sandboxPolicy,
      commandShell,
      processRegistry: options.processRegistry,
      processTerminator: options.processTerminator,
    }),
    ...createContextAttachmentTools({
      taskSoil: options.taskSoil,
      workspaceRoot,
      supportsVisionInput: options.modelCapabilities?.supportsVisionInput,
    }),
    createHttpRequestTool({ outputStore: options.toolOutputStore }),
    createBrowserSnapshotTool({ outputStore: options.toolOutputStore }),
    ...(options.toolOutputStore === undefined ? [] : [createReadToolOutputTool(options.toolOutputStore, {
      outputTokenCounter: options.outputTokenCounter,
    })]),
  ];
  const toolCatalogNames =
    options.toolCatalogNames === undefined ? undefined : new Set(options.toolCatalogNames);
  const toolCatalogAvailability = toolAvailabilityByName(options.toolCatalogAvailability);
  for (const executor of executors) {
    if (toolCatalogNames !== undefined && !toolCatalogNames.has(executor.definition.name)) {
      continue;
    }
    const state = options.toolStates?.find((item) => item.name === executor.definition.name);
    const enabledByDefault = state?.enabled ?? true;
    const frozenAvailability = toolCatalogAvailability.get(executor.definition.name);
    const currentAvailability =
      executor.definition.name === "browser_snapshot" && !playwrightAvailable
        ? { status: "unavailable" as const, disabledReason: "Playwright is not installed in this workspace." }
        : executor.definition.name === "read_context_attachment_image" && options.modelCapabilities?.supportsVisionInput === false
          ? { status: "unavailable" as const, disabledReason: "Current model does not support vision input." }
          : { status: "available" as const };
    targetRegistry.register({
      executor,
      scopes: [...baseToolScopes, toolScopeFor(executor.definition.metadata?.category)],
      enabledByDefault,
      availability: frozenAvailability ?? currentAvailability,
    });
  }
  return targetRegistry;
}

function toolAvailabilityByName(
  items: readonly CapabilityToolAvailability[] | undefined
): ReadonlyMap<string, { readonly status: "available" } | { readonly status: "unavailable"; readonly disabledReason: string }> {
  const result = new Map<string, { readonly status: "available" } | { readonly status: "unavailable"; readonly disabledReason: string }>();
  for (const item of items ?? []) {
    result.set(item.name, item.availability === "available"
      ? { status: "available" }
      : { status: "unavailable", disabledReason: item.disabledReason ?? "Unavailable in the run capability snapshot." });
  }
  return result;
}

function toolScopeFor(category: ToolCategory | undefined): ToolRegistryScope {
  if (category === "research" || category === "web") {
    return "research";
  }
  if (category === "filesystem" || category === "terminal" || category === "workspace") {
    return "workspace";
  }
  return "agent-basic";
}

function isPackageResolvable(specifier: string): boolean {
  try {
    import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
