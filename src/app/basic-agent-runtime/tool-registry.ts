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
import { ToolCenter } from "../tool-center/index.js";

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

function uniqueScopes(scopes: readonly ToolRegistryScope[]): readonly ToolRegistryScope[] {
  const source: readonly ToolRegistryScope[] = scopes.length === 0 ? ["desktop-basic"] : scopes;
  return [...new Set<ToolRegistryScope>(source)];
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
