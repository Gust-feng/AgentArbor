import type { BasicAgentCapabilitySnapshot, CapabilityToolCatalogItem } from "../../domain/config/index.js";
import type { ToolDefinition, ToolInputSchema } from "../../domain/tools/index.js";

export function frozenToolDefinitionsForRun(input: {
  readonly snapshot: BasicAgentCapabilitySnapshot | undefined;
  readonly allowedTools: readonly string[];
}): readonly ToolDefinition[] {
  if (input.snapshot === undefined || input.allowedTools.length === 0) {
    return [];
  }
  const allowed = new Set(input.allowedTools);
  return input.snapshot.toolCatalog.tools
    .filter((tool) => allowed.has(tool.name))
    .map((tool) =>
      toolDefinitionWithFrozenRuntimeCatalog(
        toolDefinitionFromCapabilityTool(tool),
        input.snapshot?.subAgentCatalog ?? []
      )
    );
}

export function toolDefinitionFromCapabilityTool(tool: CapabilityToolCatalogItem): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: cloneInputSchema(tool),
    modelContract:
      tool.modelContract === undefined
        ? undefined
        : globalThis.structuredClone(tool.modelContract),
    metadata: {
      category: tool.category,
      riskLevel: tool.riskLevel,
      operationType: tool.operationType,
      fileOperation: tool.fileOperation,
      requiresConfirmation: tool.requiresConfirmation,
      runtimeHints:
        tool.runtimeHints === undefined
          ? undefined
          : globalThis.structuredClone(tool.runtimeHints),
    },
  };
}

function cloneInputSchema(tool: CapabilityToolCatalogItem): ToolInputSchema {
  const maybeSchema = (tool as { readonly inputSchema?: ToolInputSchema }).inputSchema;
  if (maybeSchema === undefined) {
    return { type: "object", properties: {}, additionalProperties: true };
  }
  return {
    type: "object",
    properties: globalThis.structuredClone(maybeSchema.properties),
    required: maybeSchema.required === undefined ? undefined : [...maybeSchema.required],
    additionalProperties: maybeSchema.additionalProperties,
  };
}

const SUB_AGENT_TOOL_NAMES = new Set(["call_sub_agent", "call_sub_agents", "spawn_sub_agent"]);

function toolDefinitionWithFrozenRuntimeCatalog(
  definition: ToolDefinition,
  subAgentCatalog: BasicAgentCapabilitySnapshot["subAgentCatalog"]
): ToolDefinition {
  if (!SUB_AGENT_TOOL_NAMES.has(definition.name) || definition.modelContract === undefined) {
    return definition;
  }
  const existingHints = definition.modelContract.runtimeHints?.filter(
    (hint) => hint.label !== "available sub-agents"
  ) ?? [];
  return {
    ...definition,
    modelContract: {
      ...definition.modelContract,
      runtimeHints: [
        ...existingHints,
        {
          label: "available sub-agents",
          value: frozenSubAgentCatalogHint(subAgentCatalog),
        },
      ],
    },
  };
}

function frozenSubAgentCatalogHint(
  subAgentCatalog: BasicAgentCapabilitySnapshot["subAgentCatalog"]
): string {
  const enabled = subAgentCatalog.filter((subAgent) => subAgent.enabled);
  if (enabled.length === 0) {
    return "No enabled sub-agents are available in this run.";
  }
  return enabled
    .slice(0, 24)
    .map((subAgent) => {
      const allowedTools = subAgent.allowedTools ?? [];
      const whenToUse = subAgent.whenToUse ?? [];
      const parts = [
        subAgent.name,
        compactHintPart(subAgent.description, 160),
        subAgent.category === undefined ? undefined : `category=${compactHintPart(subAgent.category, 40)}`,
        subAgent.maxSteps === undefined ? undefined : `maxSteps=${subAgent.maxSteps}`,
        allowedTools.length === 0
          ? undefined
          : `allowedTools=${allowedTools.slice(0, 8).join(",")}`,
        whenToUse.length === 0
          ? undefined
          : `whenToUse=${whenToUse.slice(0, 2).map((item) => compactHintPart(item, 80)).join(" / ")}`,
      ].filter((part): part is string => part !== undefined && part.length > 0);
      return parts.join(" | ");
    })
    .join("; ");
}

function compactHintPart(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}
