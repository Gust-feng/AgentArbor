import type {
  ToolCategory,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolExecutionBroker,
  ToolExecutor,
  ToolFileDisplayOperation,
  ToolInputSchema,
  ToolModelContract,
  ToolOperationType,
  ToolRiskLevel,
  ToolRuntimeHint,
  ToolVisibleResultPolicy,
} from "../../domain/tools/index.js";
import {
  toolPresentationForDefinition,
  validateModelVisibleToolContract,
} from "../../domain/tools/index.js";
import { ToolCenter } from "../tool-center/tool-center.js";

export type ToolRegistryScope = "desktop-basic" | "underground" | "research" | "workspace" | "mcp";

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
  readonly displayName: string;
  readonly displayDescription: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly modelContract?: ToolModelContract;
  readonly category: ToolCategory;
  readonly categoryLabel: string;
  readonly riskLevel: ToolRiskLevel;
  readonly riskLabel: string;
  readonly operationType: ToolOperationType;
  readonly fileOperation?: ToolFileDisplayOperation;
  readonly operationLabel: string;
  readonly requiresConfirmation: boolean;
  readonly confirmationLabel: string;
  readonly visibleResultPolicy: ToolVisibleResultPolicy;
  readonly runtimeHints?: readonly ToolRuntimeHint[];
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
    const scopes = uniqueScopes(entry.scopes);
    const availability = entry.availability ?? { status: "available" as const };
    assertModelVisibleToolContract({
      definition: entry.executor.definition,
      scopes,
      enabledByDefault: entry.enabledByDefault,
      availability,
    });
    this.entries.set(entry.executor.definition.name, {
      executor: {
        ...entry.executor,
        definition: {
          ...entry.executor.definition,
          metadata,
        },
      },
      scopes,
      enabledByDefault: entry.enabledByDefault,
      availability,
    });
  }

  createToolCenter(scope: ToolRegistryScope): ToolExecutionBroker {
    return this.createToolCenterForScopes([scope]);
  }

  createToolCenterForScopes(scopes: readonly ToolRegistryScope[]): ToolExecutionBroker {
    const center = new ToolCenter();
    for (const entry of this.entriesForAnyScope(scopes)) {
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
        const presentation = toolPresentationForDefinition(definition);
        return {
          name: definition.name,
          displayName: presentation.displayName,
          displayDescription: presentation.displayDescription,
          description: definition.description,
          inputSchema: cloneInputSchema(definition.inputSchema),
          modelContract:
            definition.modelContract === undefined
              ? undefined
              : globalThis.structuredClone(definition.modelContract),
          category: metadata.category,
          categoryLabel: presentation.categoryLabel,
          riskLevel: metadata.riskLevel,
          riskLabel: presentation.riskLabel,
          operationType: metadata.operationType,
          fileOperation: metadata.fileOperation,
          operationLabel: presentation.operationLabel,
          requiresConfirmation: metadata.requiresConfirmation,
          confirmationLabel: presentation.confirmationLabel,
          visibleResultPolicy: { ...metadata.visibleResultPolicy },
          runtimeHints: cloneRuntimeHints(metadata.runtimeHints),
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

  private entriesForAnyScope(scopes: readonly ToolRegistryScope[]): readonly ToolRegistryEntry[] {
    const requested = new Set(scopes);
    return [...this.entries.values()].filter((entry) => entry.scopes.some((scope) => requested.has(scope)));
  }
}

function cloneInputSchema(value: ToolInputSchema): ToolInputSchema {
  return {
    type: "object",
    properties: globalThis.structuredClone(value.properties),
    required: value.required === undefined ? undefined : [...value.required],
    additionalProperties: value.additionalProperties,
  };
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
    fileOperation: metadata.fileOperation,
    requiresConfirmation: metadata.requiresConfirmation,
    visibleResultPolicy: {
      userVisible: metadata.visibleResultPolicy.userVisible,
      maxPreviewChars: metadata.visibleResultPolicy.maxPreviewChars,
      omitRawOutput: metadata.visibleResultPolicy.omitRawOutput,
    },
    runtimeHints: cloneRuntimeHints(metadata.runtimeHints),
  };
}

function cloneRuntimeHints(value: ToolDefinitionMetadata["runtimeHints"]): ToolDefinitionMetadata["runtimeHints"] {
  if (value === undefined) {
    return undefined;
  }
  return value.map((hint) => {
    if (hint.kind === "command_shell") {
      return {
        ...hint,
        invocation: [...hint.invocation],
        notes: [...hint.notes],
      };
    }
    return hint;
  });
}

function uniqueScopes(scopes: readonly ToolRegistryScope[]): readonly ToolRegistryScope[] {
  const source: readonly ToolRegistryScope[] = scopes.length === 0 ? ["desktop-basic"] : scopes;
  return [...new Set<ToolRegistryScope>(source)];
}

/**
 * 「进模型可见集合」的硬门槛（FR-TOOL-001 / FR-TOOL-002）。
 *
 * 这是工具进入模型可见集合（进而进入本轮 `allowedTools`）的统一完备校验：
 * 缺模型可见功能性契约字段或能力契约元数据字段的工具不得进入模型可见集合。
 * 校验只依赖工具自身的显式契约字段（{@link validateModelVisibleToolContract}），
 * 不依赖工具名前缀、关键字或硬编码白名单。
 *
 * 当前仅对会成为默认普通 Agent 模型可见来源的 scope（desktop-basic / research /
 * workspace）且默认启用且可用的工具强制门槛；`mcp` scope 的契约门槛对齐属于
 * FR-COMPAT-003（阶段 2 gated），不在本任务范围。
 */
export function assertModelVisibleToolContract(input: {
  readonly definition: ToolDefinition;
  readonly scopes: readonly ToolRegistryScope[];
  readonly enabledByDefault: boolean;
  readonly availability: ToolRegistryAvailability;
}): void {
  if (!shouldRequireModelContract(input)) {
    return;
  }
  const validation = validateModelVisibleToolContract(input.definition);
  if (!validation.ok) {
    throw new Error(
      `Model-visible tool ${input.definition.name} is missing model contract fields: ${validation.missing.join(", ")}.`
    );
  }
}

function shouldRequireModelContract(input: {
  readonly scopes: readonly ToolRegistryScope[];
  readonly enabledByDefault: boolean;
  readonly availability: ToolRegistryAvailability;
}): boolean {
  if (!input.enabledByDefault || input.availability.status !== "available") {
    return false;
  }
  return input.scopes.some((scope) =>
    scope === "desktop-basic" || scope === "research" || scope === "workspace" || scope === "mcp"
  );
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
