import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolInputSchema,
  ToolMultimodalContent,
} from "../../domain/tools/index.js";
import { inferToolMetadataFromMcpAnnotations } from "../../domain/tools/index.js";
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
  readonly text: string;
  readonly multimodal?: readonly ToolMultimodalContent[];
};

function buildToolOutput(content: readonly McpContentPart[]): McpToolOutput {
  const textParts: string[] = [];
  const multimodalParts: ToolMultimodalContent[] = [];
  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "image") {
      multimodalParts.push({
        type: "image",
        mimeType: part.mimeType,
        data: part.data,
      });
    } else if (part.type === "audio") {
      multimodalParts.push({
        type: "audio",
        mimeType: part.mimeType,
        data: part.data,
      });
    }
  }
  if (multimodalParts.length === 0) {
    return { text: textParts.join("\n") };
  }
  return { text: textParts.join("\n"), multimodal: multimodalParts };
}
