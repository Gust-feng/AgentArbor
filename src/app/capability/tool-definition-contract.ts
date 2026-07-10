import { createHash } from "node:crypto";
import type { CapabilityToolCatalogItem } from "../../domain/config/index.js";
import type { ToolDefinition, ToolInputSchema, ToolVisibleResultPolicy } from "../../domain/tools/index.js";

type ToolDefinitionContract = {
  readonly name: string;
  readonly inputSchema: ToolInputSchema;
  readonly metadata: {
    readonly category: NonNullable<ToolDefinition["metadata"]>["category"];
    readonly riskLevel: NonNullable<ToolDefinition["metadata"]>["riskLevel"];
    readonly operationType: NonNullable<ToolDefinition["metadata"]>["operationType"];
    readonly fileOperation?: NonNullable<ToolDefinition["metadata"]>["fileOperation"];
    readonly requiresConfirmation: boolean;
    readonly visibleResultPolicy: ToolVisibleResultPolicy;
  };
};

export function toolDefinitionContractHash(definition: ToolDefinition): string | undefined {
  if (definition.metadata === undefined) {
    return undefined;
  }
  return hashContract({
    name: definition.name,
    inputSchema: normalizedSchemaContract(definition.inputSchema),
    metadata: {
      category: definition.metadata.category,
      riskLevel: definition.metadata.riskLevel,
      operationType: definition.metadata.operationType,
      fileOperation: definition.metadata.fileOperation,
      requiresConfirmation: definition.metadata.requiresConfirmation,
      visibleResultPolicy: definition.metadata.visibleResultPolicy,
    },
  });
}

export function toolCatalogContractHash(
  tool: Pick<
    CapabilityToolCatalogItem,
    | "name"
    | "inputSchema"
    | "category"
    | "riskLevel"
    | "operationType"
    | "fileOperation"
    | "requiresConfirmation"
    | "visibleResultPolicy"
    | "runtimeHints"
  >
): string {
  return hashContract({
    name: tool.name,
    inputSchema: normalizedSchemaContract(tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true }),
    metadata: {
      category: tool.category,
      riskLevel: tool.riskLevel,
      operationType: tool.operationType,
      fileOperation: tool.fileOperation,
      requiresConfirmation: tool.requiresConfirmation,
      visibleResultPolicy: tool.visibleResultPolicy,
    },
  });
}

function hashContract(contract: ToolDefinitionContract): string {
  return `sha256:${createHash("sha256").update(stableStringify(contract)).digest("hex")}`;
}

function normalizedSchemaContract(schema: ToolInputSchema): ToolInputSchema {
  return normalizeSchemaValue(schema) as ToolInputSchema;
}

function normalizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaValue);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "description" || key === "enum") {
        continue;
      }
      result[key] = normalizeSchemaValue(item);
    }
    return result;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
