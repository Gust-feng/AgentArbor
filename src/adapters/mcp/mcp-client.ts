import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type McpClientConfig = {
  readonly serverId: string;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
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
    this.transport = this.options.transport ?? buildTransport(this.config);
    this.client = new Client(
      { name: `agentarbor-${this.config.serverId}`, version: "0.1.0" },
      { capabilities: {} }
    );
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected || this.client === undefined) {
      return;
    }
    await this.client.close();
    this.client = undefined;
    this.transport = undefined;
    this.connected = false;
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

  isConnected(): boolean {
    return this.connected;
  }

  private assertConnected(): void {
    if (!this.connected || this.client === undefined) {
      throw new Error(`MCP client "${this.config.serverId}" is not connected.`);
    }
  }
}

function buildTransport(config: McpClientConfig): Transport {
  if (config.transport === "stdio") {
    if (config.command === undefined) {
      throw new Error(`MCP server "${config.serverId}" requires a command for stdio transport.`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args === undefined ? undefined : [...config.args],
      env: config.env === undefined ? undefined : { ...config.env },
    });
  }
  if (config.url === undefined) {
    throw new Error(`MCP server "${config.serverId}" requires a url for http transport.`);
  }
  return new StreamableHTTPClientTransport(new URL(config.url));
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
