import type {
  CapabilityToolAvailability,
  ModelCapabilities,
  SanitizedCommandShellConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import type { InformationSourceKind } from "../../domain/research/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ToolCategory, ToolDefinition, ToolExecutor } from "../../domain/tools/index.js";
import { getSubAgentToolDefinitions } from "../sub-agents/sub-agent-tools.js";
import type { SubAgentRegistry } from "../sub-agents/sub-agent-registry.js";
import {
  createBrowserSnapshotTool,
} from "../tool-center/adapters/browser-tool.js";
import {
  createContextAttachmentTools,
} from "../tool-center/adapters/context-attachment-tools.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-contracts.js";
import {
  createHttpRequestTool,
} from "../tool-center/adapters/http-request-tool.js";
import {
  createLocalCreateFileTool,
  createLocalDeleteFileTool,
  createLocalEditFileTool,
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
  createLocalWriteFileTool,
} from "../tool-center/adapters/local-workspace-tools.js";
import {
  createDefaultCommandShellConfig,
  createLocalRunCommandTool,
  createLocalShellCommandTool,
  type LocalCommandProcessRegistry,
  readLocalCommandLogRef,
} from "../tool-center/adapters/local-workspace-command-tools.js";
import {
  createReadSkillResourceTool,
  hasReadableSelectedSkillResources,
} from "../tool-center/adapters/skill-resource-tool.js";
import {
  createLocalWorkspaceSandboxPolicy,
} from "../tool-center/adapters/local-workspace-sandbox.js";
import {
  createDefaultResearchRuntime,
  createResearchReadTool,
  createResearchSearchTool,
  type PageFetchLike,
} from "../research/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { ToolRegistry, type ToolRegistryScope } from "./tool-registry.js";

export type McpToolExecutorProvider = {
  getToolsForRegistry(): readonly ToolExecutor[];
  getDiscoveredToolsForRegistry?(): readonly ToolExecutor[];
  disconnectAll?(): Promise<void>;
};

export type CreateDesktopBasicToolRegistryOptions = {
  readonly runtime?: MinimalRuntime;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: ToolRegistryFetchLike;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
  readonly toolCatalogNames?: readonly string[];
  readonly toolCatalogAvailability?: readonly CapabilityToolAvailability[];
  readonly mcpManager?: McpToolExecutorProvider;
  readonly commandShell?: SanitizedCommandShellConfig;
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
  readonly includeSkillResourceToolCatalog?: boolean;
  readonly taskSoil?: TaskSoil;
  readonly modelCapabilities?: ModelCapabilities;
  readonly subAgentRegistry?: SubAgentRegistry;
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

export function createDesktopBasicToolRegistry(
  options: CreateDesktopBasicToolRegistryOptions = {}
): ToolRegistry {
  const env = options.env ?? process.env;
  const registry = new ToolRegistry();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const researchRuntime = createDefaultResearchRuntime({
    env,
    tavilyFetch: options.fetch,
    pageFetch: options.fetch as unknown as PageFetchLike,
    codebaseRoot: workspaceRoot,
    commandLogRegistry: {
      read: readLocalCommandLogRef,
    },
    constraints: options.runtime?.constraints,
    sourcePreference: options.sourcePreference ?? parseInformationSourcePreference(env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE),
    tavilyMaxResults: options.tavilyMaxResults ?? positiveIntegerFromString(env.AGENTARBOR_TAVILY_MAX_RESULTS),
  });
  const sandboxPolicy = createLocalWorkspaceSandboxPolicy();
  const commandShell = options.commandShell ?? createDefaultCommandShellConfig(process.platform, env);
  const playwrightAvailable = options.playwrightAvailable ?? isPackageResolvable("playwright");
  const includeLegacyRunCommand = options.toolCatalogNames?.includes("run_command") === true;
  const skillResourceTool =
    options.includeSkillResourceToolCatalog || hasReadableSelectedSkillResources(options.skillContexts ?? [])
      ? [createReadSkillResourceTool(options.skillContexts ?? [])]
      : [];
  const executors: readonly ToolExecutor[] = [
    createResearchSearchTool(researchRuntime),
    createResearchReadTool(researchRuntime),
    createLocalReadFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalListDirTool(workspaceRoot, { sandboxPolicy }),
    createLocalGrepFilesTool(workspaceRoot, { sandboxPolicy }),
    createLocalCreateFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalWriteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalEditFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalDeleteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalShellCommandTool(workspaceRoot, { sandboxPolicy, commandShell, processRegistry: options.processRegistry }),
    ...(includeLegacyRunCommand
      ? [createLocalRunCommandTool(workspaceRoot, { sandboxPolicy, commandShell, processRegistry: options.processRegistry })]
      : []),
    ...createContextAttachmentTools({
      taskSoil: options.taskSoil,
      workspaceRoot,
      supportsVisionInput: options.modelCapabilities?.supportsVisionInput,
    }),
    ...skillResourceTool,
    createHttpRequestTool(),
    createBrowserSnapshotTool(),
  ];
  const toolCatalogNames =
    options.toolCatalogNames === undefined ? undefined : new Set(options.toolCatalogNames);
  const toolCatalogAvailability = toolAvailabilityByName(options.toolCatalogAvailability);
  for (const executor of executors) {
    if (toolCatalogNames !== undefined && !toolCatalogNames.has(executor.definition.name)) {
      continue;
    }
    const state = options.toolStates?.find((item) => item.name === executor.definition.name);
    const enabledByDefault = state?.enabled ?? executor.definition.name !== "run_command";
    const frozenAvailability = toolCatalogAvailability.get(executor.definition.name);
    const currentAvailability =
      executor.definition.name === "browser_snapshot" && !playwrightAvailable
        ? { status: "unavailable" as const, disabledReason: "Playwright is not installed in this workspace." }
        : executor.definition.name === "read_context_attachment_image" && options.modelCapabilities?.supportsVisionInput === false
          ? { status: "unavailable" as const, disabledReason: "Current model does not support vision input." }
          : { status: "available" as const };
    registry.register({
      executor,
      scopes: ["desktop-basic", toolScopeFor(executor.definition.metadata?.category)],
      enabledByDefault,
      availability: frozenAvailability ?? currentAvailability,
    });
  }
  if (options.mcpManager !== undefined) {
    const mcpExecutors =
      toolCatalogNames === undefined
        ? (options.mcpManager.getDiscoveredToolsForRegistry?.() ?? options.mcpManager.getToolsForRegistry())
        : options.mcpManager.getToolsForRegistry();
    for (const executor of mcpExecutors) {
      if (toolCatalogNames !== undefined && !toolCatalogNames.has(executor.definition.name)) {
        continue;
      }
      registry.register({
        executor,
        scopes: ["mcp"],
        enabledByDefault: true,
      });
    }
  }
  if (options.subAgentRegistry !== undefined) {
    const subAgentToolDefs = getSubAgentToolDefinitions({ includeSpawnTool: true });
    for (const definition of subAgentToolDefs) {
      if (toolCatalogNames !== undefined && !toolCatalogNames.has(definition.name)) {
        continue;
      }
      const stubExecutor: ToolExecutor = {
        definition,
        execute: async () => {
          throw new Error("Sub-agent tools not initialized in current runtime context.");
        },
      };
      registry.register({
        executor: stubExecutor,
        scopes: ["desktop-basic"],
        enabledByDefault: true,
      });
    }
  }
  return registry;
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
  return "desktop-basic";
}

function parseInformationSourcePreference(value: string | undefined): readonly InformationSourceKind[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const sources = [...new Set(value.split(",").map((item) => informationSourceOrUndefined(item.trim())))].filter(
    (source): source is InformationSourceKind => source !== undefined
  );
  return sources.length === 0 ? undefined : sources;
}

function informationSourceOrUndefined(value: string): InformationSourceKind | undefined {
  if (
    value === "web" ||
    value === "page" ||
    value === "codebase" ||
    value === "soil" ||
    value === "run_memory" ||
    value === "docs" ||
    value === "packages" ||
    value === "github" ||
    value === "command_log"
  ) {
    return value;
  }
  return undefined;
}

function positiveIntegerFromString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : undefined;
}

function isPackageResolvable(specifier: string): boolean {
  try {
    import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
