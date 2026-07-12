import { isDeepStrictEqual } from "node:util";
import type {
  ToolDefinitionMetadata,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorResult,
  ToolFactValue,
  ToolInputSchema,
  ToolContinuation,
  ToolModelContract,
} from "../../domain/tools/index.js";
import { normalizeToolFactValue, withToolModelAttachments } from "../../domain/tools/index.js";
import type { ModelInputAttachment } from "../../domain/intelligence/index.js";
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
const MAX_MCP_MODEL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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
      "Image, audio, and non-image embedded resource bytes are passed out of band as typed model attachments with MIME, filename or URI, and byte-length facts instead of being copied into the JSON body.",
      "Audio remains an audio attachment: compatible Chat Completions providers map wav/mp3 to input_audio, while unsupported protocols or formats fail explicitly instead of treating audio as a generic file.",
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
  readonly continuation?: ToolContinuation;
  readonly continuations?: readonly ToolContinuation[];
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
      readonly filename: string;
      readonly byteLength: number;
      readonly modelInput: "audio_attachment";
      readonly modelAttachmentIndex: number;
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
            readonly filename: string;
            readonly byteLength: number;
            readonly modelInput: "file_attachment";
            readonly modelAttachmentIndex: number;
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
  const modelAttachments: ModelInputAttachment[] = [];
  const attachImage = (data: string, mimeType: string) => {
    const byteLength = approximateBase64Bytes(data);
    assertMcpModelAttachmentSize(byteLength, mimeType);
    const modelAttachmentIndex = modelAttachments.length;
    modelAttachments.push({
      kind: "image",
      source: { kind: "data", mimeType, data },
      byteLength,
    });
    return { byteLength, modelAttachmentIndex };
  };
  const attachFile = (
    data: string,
    mimeType: string,
    filename: string,
    inputRef: string
  ) => {
    const byteLength = approximateBase64Bytes(data);
    assertMcpModelAttachmentSize(byteLength, mimeType);
    const modelAttachmentIndex = modelAttachments.length;
    modelAttachments.push({
      kind: "file",
      source: { kind: "data", mimeType, data },
      filename,
      inputRef,
      byteLength,
    });
    return { byteLength, modelAttachmentIndex };
  };
  const attachAudio = (
    data: string,
    mimeType: string,
    filename: string,
    inputRef: string,
  ) => {
    const byteLength = approximateBase64Bytes(data);
    assertMcpModelAttachmentSize(byteLength, mimeType);
    const modelAttachmentIndex = modelAttachments.length;
    modelAttachments.push({
      kind: "audio",
      source: { kind: "data", mimeType, data },
      filename,
      inputRef,
      byteLength,
    });
    return { byteLength, modelAttachmentIndex };
  };
  for (const [contentIndex, part] of protocolContent.entries()) {
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
      case "audio": {
        const filename = `mcp-audio-${contentIndex + 1}${extensionForMimeType(part.mimeType)}`;
        const attachment = attachAudio(
          part.data,
          part.mimeType,
          filename,
          `mcp-content:audio:${contentIndex}`
        );
        content.push({
          type: "audio",
          mimeType: part.mimeType,
          filename,
          ...attachment,
          modelInput: "audio_attachment",
        });
        break;
      }
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
        const mimeType = part.resource.mimeType ?? "application/octet-stream";
        const filename = filenameForResource(
          part.resource.uri,
          mimeType,
          contentIndex
        );
        const attachment = attachFile(
          part.resource.blob,
          mimeType,
          filename,
          part.resource.uri
        );
        content.push({
          type: "resource",
          resource: {
            uri: part.resource.uri,
            ...(part.resource.mimeType === undefined ? {} : { mimeType: part.resource.mimeType }),
            filename,
            ...attachment,
            modelInput: "file_attachment",
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
    ...mcpContinuationFacts(result.structuredContent),
  };
  return withToolModelAttachments(output, modelAttachments);
}

function mcpContinuationFacts(
  structuredContent: unknown,
): Pick<McpToolOutput, "continuation" | "continuations"> {
  const record = plainRecord(structuredContent);
  const continuation = mcpContinuationFromUnknown(record.continuation);
  const continuations = Array.isArray(record.continuations)
    ? record.continuations
      .map(mcpContinuationFromUnknown)
      .filter((item): item is ToolContinuation => item !== undefined)
    : [];
  return {
    ...(continuation === undefined ? {} : { continuation }),
    ...(continuations.length === 0 ? {} : { continuations }),
  };
}

function mcpContinuationFromUnknown(value: unknown): ToolContinuation | undefined {
  const record = plainRecord(value);
  const ref = nonEmptyString(record.ref);
  const nextInput = record.nextInput === undefined
    ? undefined
    : normalizeToolFactValue(record.nextInput);
  const note = nonEmptyString(record.note);
  // MCP does not define a continuation field. Only promote an explicit next
  // tool input, which is executable by the calling model; a ref alone may be
  // ordinary server business data and cannot prove that omitted bytes are readable.
  if (nextInput === undefined) {
    return undefined;
  }
  return {
    ...(ref === undefined ? {} : { ref }),
    ...(nextInput === undefined ? {} : { nextInput }),
    ...(note === undefined ? {} : { note }),
  };
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

function assertMcpModelAttachmentSize(byteLength: number, mimeType: string): void {
  if (byteLength <= MAX_MCP_MODEL_ATTACHMENT_BYTES) {
    return;
  }
  throw Object.assign(
    new Error(
      `MCP model attachment ${mimeType} has ${byteLength} bytes; the in-request limit is ${MAX_MCP_MODEL_ATTACHMENT_BYTES}.`,
    ),
    {
      errorDomain: "runtime_error",
      code: "mcp_model_attachment_too_large",
      facts: {
        mimeType,
        byteLength,
        maxBytes: MAX_MCP_MODEL_ATTACHMENT_BYTES,
      },
    },
  );
}

function filenameForResource(uri: string, mimeType: string, contentIndex: number): string {
  try {
    const parsed = new URL(uri);
    const candidate = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (candidate !== undefined && candidate.length > 0) {
      return decodeURIComponent(candidate);
    }
  } catch {
  }
  return `mcp-resource-${contentIndex + 1}${extensionForMimeType(mimeType)}`;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase().split(";", 1)[0]?.trim()) {
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/mpeg":
      return ".mp3";
    case "audio/mp4":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/webm":
      return ".webm";
    case "application/pdf":
      return ".pdf";
    case "application/json":
      return ".json";
    case "text/plain":
      return ".txt";
    default:
      return ".bin";
  }
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
