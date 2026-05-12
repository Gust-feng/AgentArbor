import type { InformationSourceKind } from "../../domain/research/index.js";
import type { ToolStateSettings } from "../../domain/config/index.js";
import type {
  ToolCategory,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolExecutionBroker,
  ToolExecutor,
  ToolOperationType,
  ToolRiskLevel,
  ToolVisibleResultPolicy,
} from "../../domain/tools/index.js";
import type { MinimalRuntime } from "../runtime.js";
import {
  createDefaultResearchRuntime,
  createResearchReadTool,
  createResearchSearchTool,
  type PageFetchLike,
} from "../research/index.js";
import {
  createLocalEditFileTool,
  createLocalGrepFilesTool,
  createLocalListDirTool,
  createLocalReadFileTool,
  createLocalRunCommandTool,
  createLocalShellCommandTool,
  createLocalWorkspaceSandboxPolicy,
  createLocalWriteFileTool,
  createBrowserSnapshotTool,
  ToolCenter,
} from "../tool-center/index.js";

export type ToolRegistryScope = "desktop-basic" | "underground" | "research" | "workspace";

export type ToolRegistryEntry = {
  readonly executor: ToolExecutor;
  readonly scopes: readonly ToolRegistryScope[];
  readonly enabledByDefault: boolean;
  readonly availability?: ToolRegistryAvailability;
};

export type ToolRegistryAvailability =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly disabledReason: string };

export type ToolCatalogItem = {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly operationType: ToolOperationType;
  readonly requiresConfirmation: boolean;
  readonly visibleResultPolicy: ToolVisibleResultPolicy;
  readonly scopes: readonly ToolRegistryScope[];
  readonly enabledByDefault: boolean;
  readonly availability: ToolRegistryAvailability["status"];
  readonly disabledReason?: string;
};

export type ToolCatalogSnapshot = {
  readonly scope: ToolRegistryScope;
  readonly tools: readonly ToolCatalogItem[];
  readonly allowedTools: readonly string[];
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

export class ToolRegistry {
  private readonly entries = new Map<string, ToolRegistryEntry>();

  register(entry: ToolRegistryEntry): void {
    const metadata = requireToolMetadata(entry.executor.definition);
    this.entries.set(entry.executor.definition.name, {
      executor: {
        ...entry.executor,
        definition: {
          ...entry.executor.definition,
          metadata,
        },
      },
      scopes: uniqueScopes(entry.scopes),
      enabledByDefault: entry.enabledByDefault,
      availability: entry.availability ?? { status: "available" },
    });
  }

  createToolCenter(scope: ToolRegistryScope): ToolExecutionBroker {
    const center = new ToolCenter();
    for (const entry of this.entriesForScope(scope)) {
      const availability = entry.availability ?? { status: "available" as const };
      if (entry.enabledByDefault && availability.status === "available") {
        center.register(entry.executor);
      }
    }
    return center;
  }

  catalog(scope: ToolRegistryScope): ToolCatalogSnapshot {
    const tools = this.entriesForScope(scope)
      .map((entry): ToolCatalogItem => {
        const definition = entry.executor.definition;
        const metadata = requireToolMetadata(definition);
        const availability = entry.availability ?? { status: "available" as const };
        return {
          name: definition.name,
          description: definition.description,
          category: metadata.category,
          riskLevel: metadata.riskLevel,
          operationType: metadata.operationType,
          requiresConfirmation: metadata.requiresConfirmation,
          visibleResultPolicy: { ...metadata.visibleResultPolicy },
          scopes: [...entry.scopes],
          enabledByDefault: entry.enabledByDefault,
          availability: availability.status,
          disabledReason: availability.status === "unavailable" ? availability.disabledReason : undefined,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      scope,
      tools,
      allowedTools: tools.filter((tool) => tool.enabledByDefault && tool.availability === "available").map((tool) => tool.name),
    };
  }

  private entriesForScope(scope: ToolRegistryScope): readonly ToolRegistryEntry[] {
    return [...this.entries.values()].filter((entry) => entry.scopes.includes(scope));
  }
}

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
    createLocalWriteFileTool(workspaceRoot, { sandboxPolicy }),
    createLocalEditFileTool(workspaceRoot, { sandboxPolicy }),
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
  return registry;
}

export function requireToolMetadata(definition: ToolDefinition): ToolDefinitionMetadata {
  const metadata = definition.metadata;
  if (metadata === undefined) {
    throw new Error(`Tool ${definition.name} cannot enter a registry without metadata.`);
  }
  if (!isToolCategory(metadata.category)) {
    throw new Error(`Tool ${definition.name} has invalid category metadata.`);
  }
  if (!isRiskLevel(metadata.riskLevel)) {
    throw new Error(`Tool ${definition.name} has invalid risk metadata.`);
  }
  if (!isOperationType(metadata.operationType)) {
    throw new Error(`Tool ${definition.name} has invalid operation metadata.`);
  }
  return {
    category: metadata.category,
    riskLevel: metadata.riskLevel,
    operationType: metadata.operationType,
    requiresConfirmation: metadata.requiresConfirmation,
    visibleResultPolicy: {
      userVisible: metadata.visibleResultPolicy.userVisible,
      maxPreviewChars: metadata.visibleResultPolicy.maxPreviewChars,
      omitRawOutput: metadata.visibleResultPolicy.omitRawOutput,
    },
  };
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

function uniqueScopes(scopes: readonly ToolRegistryScope[]): readonly ToolRegistryScope[] {
  const source: readonly ToolRegistryScope[] = scopes.length === 0 ? ["desktop-basic"] : scopes;
  return [...new Set<ToolRegistryScope>(source)];
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

function isToolCategory(value: unknown): value is ToolCategory {
  return value === "research" || value === "workspace" || value === "filesystem" || value === "terminal" || value === "web" || value === "mcp" || value === "other";
}

function isRiskLevel(value: unknown): value is ToolRiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function isOperationType(value: unknown): value is ToolOperationType {
  return value === "read-only" || value === "read-write" || value === "execute" || value === "external-submit";
}
