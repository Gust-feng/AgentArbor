import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolInputSchema,
} from "../../domain/tools/index.js";
import type { McpClientWrapper, McpContentPart, McpToolInfo } from "./mcp-client.js";

export function createMcpToolExecutor(
  client: McpClientWrapper,
  tool: McpToolInfo,
  serverId: string
): ToolExecutor {
  const namespacedName = `${serverId}__${tool.name}`;
  const metadata = inferToolMetadataFromMcpAnnotations(tool.annotations) as ToolDefinitionMetadata;
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
  annotations: McpToolInfo["annotations"]
): ToolDefinitionMetadata {
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  const openWorld = annotations?.openWorldHint === true;
  return {
    category: "mcp",
    riskLevel: readOnly ? "low" : destructive || openWorld ? "high" : "medium",
    operationType: readOnly ? "read-only" : openWorld ? "external-submit" : destructive ? "read-write" : "execute",
    requiresConfirmation: !readOnly,
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: readOnly ? 1_200 : 600,
      omitRawOutput: true,
    },
  };
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
  const safeText = truncateText(text, 4_000);
  const mediaSummary = multimodalParts.length === 0
    ? undefined
    : `MCP returned ${multimodalParts.length} non-text content item(s); raw media bytes are retained by the MCP server, not AgentArbor.`;
  const summary = [safeText.text, mediaSummary].filter((item): item is string => item !== undefined && item.length > 0).join("\n");
  return {
    summary: summary.length === 0 ? "MCP tool returned no text content." : summary,
    result: {
      text: safeText.text.length > 0 ? safeText.text : undefined,
      multimodal: multimodalParts.length === 0 ? undefined : multimodalParts,
    },
    truncated: safeText.truncated,
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
