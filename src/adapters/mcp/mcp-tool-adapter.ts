import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolInputSchema,
  ToolModelContract,
} from "../../domain/tools/index.js";
import type { McpConfirmationMode } from "../../domain/config/index.js";
import type { McpClientWrapper, McpContentPart, McpToolInfo } from "./mcp-client.js";

const MAX_MCP_TEXT_CHARS = 128_000;

export type McpToolConfirmationStrategy = {
  readonly confirmationMode: McpConfirmationMode;
  readonly autoApprovedTools: readonly string[];
};

const DEFAULT_CONFIRMATION_STRATEGY: McpToolConfirmationStrategy = {
  confirmationMode: "never",
  autoApprovedTools: [],
};

export function createMcpToolExecutor(
  client: McpClientWrapper,
  tool: McpToolInfo,
  serverId: string,
  confirmationStrategy: McpToolConfirmationStrategy = DEFAULT_CONFIRMATION_STRATEGY
): ToolExecutor {
  return {
    definition: createMcpToolDefinition(tool, serverId, confirmationStrategy),
    async execute(input: unknown, _context: ToolExecutionContext): Promise<unknown> {
      return executeMcpTool(client, tool, input);
    },
  };
}

export function createLazyMcpToolExecutor(
  getClient: () => Promise<McpClientWrapper>,
  tool: McpToolInfo,
  serverId: string,
  confirmationStrategy: McpToolConfirmationStrategy = DEFAULT_CONFIRMATION_STRATEGY
): ToolExecutor {
  return {
    definition: createMcpToolDefinition(tool, serverId, confirmationStrategy),
    async execute(input: unknown, _context: ToolExecutionContext): Promise<unknown> {
      return executeMcpTool(await getClient(), tool, input);
    },
  };
}

export function createCachedMcpToolExecutor(
  tool: McpToolInfo,
  serverId: string,
  confirmationStrategy: McpToolConfirmationStrategy = DEFAULT_CONFIRMATION_STRATEGY
): ToolExecutor {
  return {
    definition: createMcpToolDefinition(tool, serverId, confirmationStrategy),
    async execute(): Promise<unknown> {
      throw new Error(`MCP tool "${serverId}__${tool.name}" is cached for catalog use and requires a live MCP connection to execute.`);
    },
  };
}

export async function executeMcpTool(
  client: McpClientWrapper,
  tool: Pick<McpToolInfo, "name">,
  input: unknown
): Promise<unknown> {
  const result = await client.callTool(tool.name, input);
  if (result.isError === true) {
    const errorText = extractTextContent(result.content);
    throw new Error(errorText.length > 0 ? errorText : `MCP tool "${tool.name}" returned an error.`);
  }
  return buildToolOutput(result.content);
}

function createMcpToolDefinition(
  tool: McpToolInfo,
  serverId: string,
  confirmationStrategy: McpToolConfirmationStrategy
): ToolExecutor["definition"] {
  const namespacedName = `${serverId}__${tool.name}`;
  const inputSchema = toolInputSchema(tool);
  const metadata = inferToolMetadataFromMcpAnnotations(tool.annotations, {
    serverId,
    toolName: tool.name,
    confirmationStrategy,
  }) as ToolDefinitionMetadata;
  return {
    name: namespacedName,
    description: tool.description ?? tool.title ?? `MCP tool: ${tool.name} from ${serverId}`,
    inputSchema,
    modelContract: createMcpToolModelContract({
      serverId,
      tool,
      inputSchema,
      metadata,
    }),
    metadata,
  };
}

function toolInputSchema(tool: McpToolInfo): ToolInputSchema {
  return {
    type: "object",
    properties: recordOrEmpty(tool.inputSchema.properties),
    required: stringArrayOrUndefined(tool.inputSchema.required),
    additionalProperties: typeof tool.inputSchema.additionalProperties === "boolean"
      ? tool.inputSchema.additionalProperties
      : undefined,
  };
}

function createMcpToolModelContract(input: {
  readonly serverId: string;
  readonly tool: McpToolInfo;
  readonly inputSchema: ToolInputSchema;
  readonly metadata: ToolDefinitionMetadata;
}): ToolModelContract {
  const propertyNames = Object.keys(input.inputSchema.properties);
  const required = new Set(input.inputSchema.required ?? []);
  const requiredNames = propertyNames.filter((name) => required.has(name));
  const optionalNames = propertyNames.filter((name) => !required.has(name));
  const inputNotes = [
    propertyNames.length === 0
      ? "Input is a JSON object; this MCP tool declares no named input fields."
      : `Input is a JSON object with fields: ${propertyNames.join(", ")}.`,
    requiredNames.length === 0 ? "No required input fields are declared." : `Required fields: ${requiredNames.join(", ")}.`,
    optionalNames.length === 0 ? undefined : `Optional fields: ${optionalNames.join(", ")}.`,
    input.inputSchema.additionalProperties === false
      ? "Do not include fields outside the declared MCP input schema."
      : "Additional fields may be accepted only if the MCP server supports them.",
  ].filter(isString);
  return {
    purpose: input.tool.description?.trim() ?? input.tool.title?.trim() ?? `Call MCP tool ${input.tool.name} on server ${input.serverId}.`,
    whenToUse: [
      `Use when the task needs the ${input.tool.name} capability exposed by MCP server ${input.serverId}.`,
      "Use only for the operation described by the MCP tool description and input schema.",
    ],
    whenNotToUse: [
      "Do not use when a built-in workspace, shell, research, HTTP, or browser tool directly fits the task.",
    ],
    inputNotes,
    usageNotes: [
      `The model-visible tool name is ${input.serverId}__${input.tool.name}; the MCP server receives the original tool name ${input.tool.name}.`,
      "MCP annotations are advisory; rely on the tool description, schema, and returned result when deciding follow-up steps.",
    ],
    outputNotes: [
      "Successful calls return MCP content normalized into summary, result.text, result.multimodal, and truncated.",
      "MCP tool error results fail the tool call and preserve server-provided error text when available.",
    ],
    runtimeHints: [
      { label: "MCP server", value: input.serverId },
      { label: "MCP tool", value: input.tool.name },
      ...(input.tool.title === undefined ? [] : [{ label: "MCP title", value: input.tool.title }]),
      { label: "operation", value: input.metadata.operationType },
      { label: "requires confirmation", value: String(input.metadata.requiresConfirmation) },
    ],
    examples: [
      {
        title: "Call MCP tool",
        input: exampleInputForSchema(input.inputSchema),
      },
    ],
  };
}

function extractTextContent(content: readonly McpContentPart[]): string {
  return content
    .filter((part): part is McpContentPart & { readonly type: "text" } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

type McpToolOutput = {
  readonly summary: string;
  readonly result: {
    readonly text?: string;
    readonly multimodal?: readonly McpToolMultimodalSummary[];
  };
  readonly truncated: boolean;
};

type McpToolMultimodalSummary =
  | {
      readonly type: "image";
      readonly mimeType: string;
      readonly bytesApprox: number;
    }
  | {
      readonly type: "audio";
      readonly mimeType: string;
      readonly bytesApprox: number;
    };

function inferToolMetadataFromMcpAnnotations(
  annotations: McpToolInfo["annotations"],
  options: {
    readonly serverId: string;
    readonly toolName: string;
    readonly confirmationStrategy: McpToolConfirmationStrategy;
  }
): ToolDefinitionMetadata {
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  const openWorld = annotations?.openWorldHint === true;
  const riskLevel = destructive || openWorld ? "high" : readOnly ? "low" : "medium";
  const operationType = openWorld ? "external-submit" : destructive ? "read-write" : readOnly ? "read-only" : "execute";
  return {
    category: "mcp",
    riskLevel,
    operationType,
    requiresConfirmation: requiresMcpToolConfirmation({
      serverId: options.serverId,
      toolName: options.toolName,
      confirmationStrategy: options.confirmationStrategy,
      riskLevel,
      operationType,
    }),
    visibleResultPolicy: {
      userVisible: "summary-only",
      maxPreviewChars: 1_200,
      omitRawOutput: false,
    },
  };
}

function requiresMcpToolConfirmation(input: {
  readonly serverId: string;
  readonly toolName: string;
  readonly confirmationStrategy: McpToolConfirmationStrategy;
  readonly riskLevel: ToolDefinitionMetadata["riskLevel"];
  readonly operationType: ToolDefinitionMetadata["operationType"];
}): boolean {
  if (mcpToolNameSetHas(
    input.confirmationStrategy.autoApprovedTools,
    input.serverId,
    input.toolName
  )) {
    return false;
  }
  if (input.confirmationStrategy.confirmationMode === "never") {
    return false;
  }
  if (input.confirmationStrategy.confirmationMode === "always") {
    return true;
  }
  if (input.operationType === "read-only") {
    return false;
  }
  return input.riskLevel === "high" || input.operationType === "external-submit";
}

function mcpToolNameSetHas(tools: readonly string[], serverId: string, toolName: string): boolean {
  const localName = toolName.startsWith(`${serverId}__`) ? toolName.slice(`${serverId}__`.length) : toolName;
  const namespacedName = `${serverId}__${localName}`;
  return tools.includes(localName) || tools.includes(namespacedName);
}

function buildToolOutput(content: readonly McpContentPart[]): McpToolOutput {
  const textParts: string[] = [];
  const multimodalParts: McpToolMultimodalSummary[] = [];
  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "image") {
      multimodalParts.push({
        type: "image",
        mimeType: part.mimeType,
        bytesApprox: approximateBase64Bytes(part.data),
      });
    } else if (part.type === "audio") {
      multimodalParts.push({
        type: "audio",
        mimeType: part.mimeType,
        bytesApprox: approximateBase64Bytes(part.data),
      });
    }
  }
  const text = textParts.join("\n").trim();
  const visibleText = truncateText(text, MAX_MCP_TEXT_CHARS);
  const mediaSummary = multimodalParts.length === 0
    ? undefined
    : `MCP returned ${multimodalParts.length} non-text content item(s); raw media bytes are retained by the MCP server, not AgentArbor.`;
  const summary = [visibleText.text, mediaSummary].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
  return {
    summary: summary.length === 0 ? "MCP tool returned no text content." : summary,
    result: {
      text: visibleText.text.length > 0 ? visibleText.text : undefined,
      multimodal: multimodalParts.length === 0 ? undefined : multimodalParts,
    },
    truncated: visibleText.truncated,
  };
}

function truncateText(value: string, maxLength: number): { readonly text: string; readonly truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}

function approximateBase64Bytes(value: string): number {
  const clean = value.replace(/\s+/g, "");
  if (clean.length === 0) {
    return 0;
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function exampleInputForSchema(schema: ToolInputSchema): Readonly<Record<string, unknown>> {
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) {
    return {};
  }
  const required = new Set(schema.required ?? []);
  const selected = entries
    .filter(([name]) => required.has(name))
    .concat(entries.filter(([name]) => !required.has(name)))
    .slice(0, 3);
  const result: Record<string, unknown> = {};
  for (const [name, propertySchema] of selected) {
    result[name] = exampleValueForJsonSchema(propertySchema);
  }
  return result;
}

function exampleValueForJsonSchema(value: unknown): unknown {
  const schema = recordOrUndefined(value);
  const type = typeof schema?.type === "string" ? schema.type : undefined;
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (type === "string") {
    return "example";
  }
  if (type === "number" || type === "integer") {
    return 1;
  }
  if (type === "boolean") {
    return true;
  }
  if (type === "array") {
    return [];
  }
  if (type === "object") {
    return {};
  }
  return "example";
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return recordOrUndefined(value) ?? {};
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArrayOrUndefined(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
