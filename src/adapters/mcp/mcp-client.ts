import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ensureManagedMcpExecutable, mcpRuntimePathEnvironment } from "./mcp-local-runtime.js";

export type McpClientConfig = {
  readonly serverId: string;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly httpHeaders?: Readonly<Record<string, string>>;
};

export type McpClientWrapperOptions = {
  readonly transport?: Transport;
};

export type McpToolInfo = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly openWorldHint?: boolean;
  };
};

export type McpToolResult = {
  readonly content: readonly McpContentPart[];
  readonly isError?: boolean;
};

export type McpPromptInfo = {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
};

export type McpResourceInfo = {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
};

export type McpResourceTemplateInfo = {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
};

export type McpReferenceInfo = {
  readonly prompts: readonly McpPromptInfo[];
  readonly resources: readonly McpResourceInfo[];
  readonly resourceTemplates: readonly McpResourceTemplateInfo[];
};

export type McpContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "audio"; readonly data: string; readonly mimeType: string };

export class McpClientWrapper {
  private client: Client | undefined;
  private connected = false;
  private transport: Transport | undefined;

  constructor(
    private readonly config: McpClientConfig,
    private readonly options: McpClientWrapperOptions = {}
  ) {}

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.transport = this.options.transport ?? await buildTransport(this.config);
    this.client = new Client(
      { name: `agentarbor-${this.config.serverId}`, version: "0.1.0" },
      { capabilities: {} }
    );
    try {
      await this.client.connect(this.transport);
      this.connected = true;
    } catch (error) {
      await this.disconnect().catch(() => undefined);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    if (client === undefined && transport === undefined) {
      return;
    }
    this.client = undefined;
    this.transport = undefined;
    this.connected = false;
    if (client !== undefined) {
      try {
        await client.close();
        return;
      } catch {
      }
    }
    await transport?.close();
  }

  async listTools(): Promise<readonly McpToolInfo[]> {
    this.assertConnected();
    const result = await this.client!.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: tool.annotations === undefined ? undefined : {
        title: tool.annotations.title,
        readOnlyHint: tool.annotations.readOnlyHint,
        destructiveHint: tool.annotations.destructiveHint,
        openWorldHint: tool.annotations.openWorldHint,
      },
    }));
  }

  async callTool(name: string, args: unknown): Promise<McpToolResult> {
    this.assertConnected();
    const result = await this.client!.callTool({ name, arguments: args as Record<string, unknown> });
    const isError = "isError" in result ? (result.isError as boolean) : undefined;
    const rawContent = "content" in result ? (result.content as readonly unknown[]) : [];
    const content = rawContent
      .filter(isMcpContentPart)
      .map(toMcpContentPart);
    return { content, isError };
  }

  async listReferences(): Promise<McpReferenceInfo> {
    this.assertConnected();
    const [prompts, resources, resourceTemplates] = await Promise.all([
      this.client!.listPrompts().then((result) => result.prompts.map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments?.map((argument) => ({
          name: argument.name,
          description: argument.description,
          required: argument.required,
        })),
      }))).catch(() => [] as McpPromptInfo[]),
      this.client!.listResources().then((result) => result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
        size: resource.size,
      }))).catch(() => [] as McpResourceInfo[]),
      this.client!.listResourceTemplates().then((result) => result.resourceTemplates.map((resourceTemplate) => ({
        uriTemplate: resourceTemplate.uriTemplate,
        name: resourceTemplate.name,
        title: resourceTemplate.title,
        description: resourceTemplate.description,
        mimeType: resourceTemplate.mimeType,
      }))).catch(() => [] as McpResourceTemplateInfo[]),
    ]);
    return { prompts, resources, resourceTemplates };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private assertConnected(): void {
    if (!this.connected || this.client === undefined) {
      throw new Error(`MCP client "${this.config.serverId}" is not connected.`);
    }
  }
}

async function buildTransport(config: McpClientConfig): Promise<Transport> {
  if (config.transport === "stdio") {
    if (config.command === undefined) {
      throw new Error(`MCP server "${config.serverId}" requires a command for stdio transport.`);
    }
    const stdioEnv = buildStdioEnvironment(config.env ?? {});
    const command = (await ensureManagedMcpExecutable(config.command, {
      ...process.env,
      ...(stdioEnv ?? {}),
    })).executable ?? config.command;
    return new StdioClientTransport({
      command,
      args: config.args === undefined ? undefined : [...config.args],
      env: stdioEnv,
      stderr: "ignore",
    });
  }
  if (config.url === undefined) {
    throw new Error(`MCP server "${config.serverId}" requires a url for http transport.`);
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: Object.keys(config.httpHeaders ?? {}).length === 0
      ? undefined
      : { headers: { ...config.httpHeaders } },
  });
}

function buildStdioEnvironment(env: Readonly<Record<string, string>>): Record<string, string> {
  const base = {
    ...getDefaultEnvironment(),
    ...platformPathEnvironment(process.env),
    ...env,
  };
  return {
    ...base,
    ...mcpRuntimePathEnvironment(base),
    NODE_USE_SYSTEM_CA: base.NODE_USE_SYSTEM_CA ?? "1",
  };
}

function platformPathEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
    const value = env[key];
    if (value !== undefined && value.trim().length > 0) {
      result[key] = value;
    }
  }
  return result;
}

type RawMcpContent = {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
};

function isMcpContentPart(value: unknown): value is RawMcpContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as RawMcpContent).type === "string"
  );
}

function toMcpContentPart(raw: RawMcpContent): McpContentPart {
  if (raw.type === "text" && typeof raw.text === "string") {
    return { type: "text", text: raw.text };
  }
  if (raw.type === "image" && typeof raw.data === "string" && typeof raw.mimeType === "string") {
    return { type: "image", data: raw.data, mimeType: raw.mimeType };
  }
  if (raw.type === "audio" && typeof raw.data === "string" && typeof raw.mimeType === "string") {
    return { type: "audio", data: raw.data, mimeType: raw.mimeType };
  }
  return { type: "text", text: JSON.stringify(raw) };
}
