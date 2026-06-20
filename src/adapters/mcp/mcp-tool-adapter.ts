import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolInputSchema,
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
  const namespacedName = `${serverId}__${tool.name}`;
  const metadata = inferToolMetadataFromMcpAnnotations(tool.annotations, {
    serverId,
    toolName: tool.name,
    confirmationStrategy,
  }) as ToolDefinitionMetadata;
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: (tool.inputSchema.properties as Record<string, unknown>) ?? {},
    required: tool.inputSchema.required as readonly string[] | undefined,
    additionalProperties: tool.inputSchema.additionalProperties as boolean | undefined,
  };
  return {
    definition: {
      name: namespacedName,
      description: tool.description ?? `MCP tool: ${tool.name} from ${serverId}`,
      inputSchema,
        metadata,
      },
    async execute(input: unknown, _context: ToolExecutionContext): Promise<unknown> {
      const result = await client.callTool(tool.name, input);
      if (result.isError === true) {
        const errorText = extractTextContent(result.content);
        throw new Error(errorText.length > 0 ? errorText : `MCP tool "${tool.name}" returned an error.`);
      }
      return buildToolOutput(result.content);
    },
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
