import type { ToolStateSettings } from "../../domain/config/index.js";
import type { InformationSourceKind } from "../../domain/research/index.js";
import type { ToolCategory, ToolExecutor } from "../../domain/tools/index.js";
import type { McpManager } from "../../adapters/mcp/index.js";
import {
  createBrowserSnapshotTool,
  createLocalCreateFileTool,
  createLocalDeleteFileTool,
  createLocalEditFileTool,
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
  createLocalRunCommandTool,
  createLocalShellCommandTool,
  createLocalWorkspaceSandboxPolicy,
} from "../tool-center/index.js";
import {
  createDefaultResearchRuntime,
  createResearchReadTool,
  createResearchSearchTool,
  type PageFetchLike,
} from "../research/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { ToolRegistry, type ToolRegistryScope } from "./tool-registry.js";

export type CreateDesktopBasicToolRegistryOptions = {
  readonly runtime?: MinimalRuntime;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: ToolRegistryFetchLike;
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly tavilyMaxResults?: number;
  readonly workspaceRoot?: string;
  readonly playwrightAvailable?: boolean;
  readonly toolStates?: readonly ToolStateSettings[];
  readonly mcpManager?: McpManager;
};

export type ToolRegistryFetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
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
  const researchRuntime = createDefaultResearchRuntime({
    env,
    tavilyFetch: options.fetch,
    pageFetch: options.fetch as unknown as PageFetchLike,
    constraints: options.runtime?.constraints,
    sourcePreference: options.sourcePreference ?? parseInformationSourcePreference(env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE),
    tavilyMaxResults: options.tavilyMaxResults ?? positiveIntegerFromString(env.AGENTARBOR_TAVILY_MAX_RESULTS),
  });
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const sandboxPolicy = createLocalWorkspaceSandboxPolicy();
  const playwrightAvailable = options.playwrightAvailable ?? isPackageResolvable("playwright");
  const executors: readonly ToolExecutor[] = [
    createResearchSearchTool(researchRuntime),
    createResearchReadTool(researchRuntime),
    createLocalReadFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalListDirTool(workspaceRoot, { sandboxPolicy }),
    createLocalGrepFilesTool(workspaceRoot, { sandboxPolicy }),
    createLocalCreateFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalEditFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalDeleteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalRunCommandTool(workspaceRoot, { sandboxPolicy }),
    createLocalShellCommandTool(workspaceRoot, { sandboxPolicy }),
    createBrowserSnapshotTool(),
  ];
  for (const executor of executors) {
    const state = options.toolStates?.find((item) => item.name === executor.definition.name);
    registry.register({
      executor,
      scopes: ["desktop-basic", toolScopeFor(executor.definition.metadata?.category)],
      enabledByDefault: state?.enabled ?? true,
      availability:
        executor.definition.name === "browser_snapshot" && !playwrightAvailable
          ? { status: "unavailable", disabledReason: "Playwright is not installed in this workspace." }
          : { status: "available" },
    });
  }
  if (options.mcpManager !== undefined) {
    for (const executor of options.mcpManager.getToolsForRegistry()) {
      registry.register({
        executor,
        scopes: ["mcp", "desktop-basic"],
        enabledByDefault: true,
      });
    }
  }
  return registry;
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
    value === "github"
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
