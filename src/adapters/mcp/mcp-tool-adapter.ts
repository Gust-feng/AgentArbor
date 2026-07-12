import { isDeepStrictEqual } from "node:util";
import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorResult,
  ToolFactValue,
  ToolInputSchema,
  ToolModelContract,
} from "../../domain/tools/index.js";
import { withToolModelAttachments } from "../../domain/tools/index.js";
import type { McpConfirmationMode } from "../../domain/config/index.js";
import type { McpClientWrapper, McpContentPart, McpToolInfo } from "./mcp-client.js";

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
    async execute(input: unknown, context: ToolExecutionContext): Promise<unknown | ToolExecutorResult> {
      return executeMcpToolForExecutor(client, tool, serverId, input, context);
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
    async execute(input: unknown, context: ToolExecutionContext): Promise<unknown | ToolExecutorResult> {
      return executeMcpToolForExecutor(await getClient(), tool, serverId, input, context);
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

async function executeMcpToolForExecutor(
  client: McpClientWrapper,
  tool: Pick<McpToolInfo, "name">,
  serverId: string,
  input: unknown,
  context: ToolExecutionContext
): Promise<McpToolOutput | ToolExecutorResult> {
  const startedAt = Date.now();
  const mcpResult = await client.callTool(tool.name, input);
  const output = buildToolOutput(mcpResult);
  if (mcpResult.isError !== true) {
    return output;
  }
  return {
    kind: "tool_call_result",
    result: {
      callId: context.toolCallId ?? `${serverId}__${tool.name}`,
      toolName: `${serverId}__${tool.name}`,
      input: input as ToolFactValue | undefined,
      output: output as ToolFactValue,
      status: "failed",
      error: `MCP tool ${serverId}__${tool.name} reported an error.`,
      errorDomain: "tool_error",
      errorFacts: {
        code: "mcp_tool_error",
        serverId,
        mcpToolName: tool.name,
      },
      durationMs: Date.now() - startedAt,
    },
  };
}

function createMcpToolDefinition(
  tool: McpToolInfo,
  serverId: string,
  confirmationStrategy: McpToolConfirmationStrategy
): ToolExecutor["definition"] {
  const namespacedName = `${serverId}__${tool.name}`;
  const inputSchema = toolInputSchema(tool);
  const compactDescription = compactMcpToolDescription(tool, serverId);
  const metadata = inferToolMetadataFromMcpAnnotations(tool.annotations, {
    serverId,
    toolName: tool.name,
    confirmationStrategy,
  }) as ToolDefinitionMetadata;
  return {
    name: namespacedName,
    description: compactDescription,
    inputSchema,
    modelContract: createMcpToolModelContract({
      serverId,
      tool,
      inputSchema,
      metadata,
      compactDescription,
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
  readonly compactDescription: string;
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
    purpose: input.compactDescription,
    whenToUse: [
      `Use when the task needs the ${input.tool.name} capability exposed by MCP server ${input.serverId}.`,
      "Use only for the operation described by the MCP tool description and input schema.",
    ],
    whenNotToUse: [
      "Do not use for operations outside the capability described by this MCP tool.",
    ],
    inputNotes,
    usageNotes: [
      `The model-visible tool name is ${input.serverId}__${input.tool.name}; the MCP server receives the original tool name ${input.tool.name}.`,
      "MCP annotations are advisory; rely on the tool description, schema, and returned result when deciding follow-up steps.",
    ],
    outputNotes: [
      "Returns one canonical fact body: content[] plus optional structuredContent; a content text block is omitted only when it is parseable JSON and deeply identical to structuredContent, and no duplicate summary or result wrapper is added.",
      "Text content is preserved once and is not truncated by the MCP adapter. MCP has no standard tool-result continuation, so results beyond the shared transport budget fail honestly unless the server tool itself returns an explicit paging or reference contract.",
      "Image bytes are passed out of band as model attachments while content[] retains only image metadata. Audio remains metadata-only and non-image embedded resource blobs may also be unavailable because the current model attachment contract has no safe input type for them; unforwarded bytes are explicitly marked not_retained and never placed in the JSON fact body.",
      "MCP isError=true produces a failed ToolCallResult while preserving the canonical MCP error content once; protocol, connection, or transport exceptions also fail the tool call.",
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

function compactMcpToolDescription(tool: McpToolInfo, serverId: string): string {
  const primary = compactTextBlock(tool.description);
  if (primary !== undefined) {
    return primary;
  }
  const title = compactTextBlock(tool.title);
  if (title !== undefined) {
    return title;
  }
  return `Call MCP tool ${tool.name} on server ${serverId}.`;
}

function compactTextBlock(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/u)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  const limitedSentences = firstSentences(normalized, 2);
  return truncateAtWordBoundary(limitedSentences, 220);
}

function firstSentences(value: string, limit: number): string {
  const matches = value.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/gu) ?? [];
  const selected = matches
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, limit);
  return selected.length === 0 ? value : selected.join(" ");
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const slice = value.slice(0, maxChars - 1).trimEnd();
  const cutoff = slice.lastIndexOf(" ");
  const trimmed = (cutoff >= 80 ? slice.slice(0, cutoff) : slice).trimEnd();
  return `${trimmed}\u2026`;
}

export type McpToolOutput = {
  readonly content: readonly McpToolOutputContentPart[];
  readonly structuredContent?: ToolFactValue;
};

export type McpToolOutputContentPart =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly mimeType: string;
      readonly byteLength: number;
      readonly modelInput: "attached";
      readonly modelAttachmentIndex: number;
    }
  | {
      readonly type: "audio";
      readonly mimeType: string;
      readonly byteLength: number;
      readonly modelInput: "unsupported";
      readonly dataRetention: "not_retained";
    }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name: string;
      readonly title?: string;
      readonly description?: string;
      readonly mimeType?: string;
      readonly size?: number;
    }
  | {
      readonly type: "resource";
      readonly resource:
        | {
            readonly uri: string;
            readonly mimeType?: string;
            readonly text: string;
          }
        | {
            readonly uri: string;
            readonly mimeType?: string;
            readonly byteLength: number;
            readonly modelInput: "attached";
            readonly modelAttachmentIndex: number;
          }
        | {
            readonly uri: string;
            readonly mimeType?: string;
            readonly byteLength: number;
            readonly modelInput: "unsupported";
            readonly dataRetention: "not_retained";
          };
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

function buildToolOutput(result: {
  readonly content: readonly McpContentPart[];
  readonly structuredContent?: unknown;
}): McpToolOutput {
  const content: McpToolOutputContentPart[] = [];
  const protocolContent = result.structuredContent === undefined
    ? result.content
    : result.content.filter((part) => !isExactStructuredContentMirror(part, result.structuredContent));
  const modelAttachments: Array<{
    readonly kind: "image";
    readonly source: {
      readonly kind: "data";
      readonly mimeType: string;
      readonly data: string;
    };
    readonly byteLength: number;
  }> = [];
  const attachImage = (data: string, mimeType: string) => {
    const byteLength = approximateBase64Bytes(data);
    const modelAttachmentIndex = modelAttachments.length;
    modelAttachments.push({
      kind: "image",
      source: { kind: "data", mimeType, data },
      byteLength,
    });
    return { byteLength, modelAttachmentIndex };
  };
  for (const part of protocolContent) {
    switch (part.type) {
      case "text":
        content.push({ type: "text", text: part.text });
        break;
      case "image": {
        const attachment = attachImage(part.data, part.mimeType);
        content.push({
          type: "image",
          mimeType: part.mimeType,
          ...attachment,
          modelInput: "attached",
        });
        break;
      }
      case "audio":
        content.push({
          type: "audio",
          mimeType: part.mimeType,
          byteLength: approximateBase64Bytes(part.data),
          modelInput: "unsupported",
          dataRetention: "not_retained",
        });
        break;
      case "resource_link":
        content.push({
          type: "resource_link",
          uri: part.uri,
          name: part.name,
          ...(part.title === undefined ? {} : { title: part.title }),
          ...(part.description === undefined ? {} : { description: part.description }),
          ...(part.mimeType === undefined ? {} : { mimeType: part.mimeType }),
          ...(part.size === undefined ? {} : { size: part.size }),
        });
        break;
      case "resource":
        if ("text" in part.resource) {
          content.push({
            type: "resource",
            resource: {
              uri: part.resource.uri,
              ...(part.resource.mimeType === undefined ? {} : { mimeType: part.resource.mimeType }),
              text: part.resource.text,
            },
          });
          break;
        }
        if (part.resource.mimeType?.toLowerCase().startsWith("image/") === true) {
          const attachment = attachImage(part.resource.blob, part.resource.mimeType);
          content.push({
            type: "resource",
            resource: {
              uri: part.resource.uri,
              mimeType: part.resource.mimeType,
              ...attachment,
              modelInput: "attached",
            },
          });
          break;
        }
        content.push({
          type: "resource",
          resource: {
            uri: part.resource.uri,
            ...(part.resource.mimeType === undefined ? {} : { mimeType: part.resource.mimeType }),
            byteLength: approximateBase64Bytes(part.resource.blob),
            modelInput: "unsupported",
            dataRetention: "not_retained",
          },
        });
        break;
      default:
        throw unsupportedMcpContentPart(part);
    }
  }
  const output: McpToolOutput = {
    content,
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent as ToolFactValue }),
  };
  return withToolModelAttachments(output, modelAttachments);
}

function isExactStructuredContentMirror(part: McpContentPart, structuredContent: unknown): boolean {
  if (part.type !== "text") {
    return false;
  }
  try {
    return isDeepStrictEqual(JSON.parse(part.text), structuredContent);
  } catch {
    return false;
  }
}

function unsupportedMcpContentPart(value: never): Error {
  return new Error(`Unsupported MCP content part: ${String((value as { readonly type?: unknown }).type ?? "unknown")}.`);
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
