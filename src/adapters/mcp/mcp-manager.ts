import type { McpServerSettings } from "../../domain/config/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import type { McpClientConfig, McpToolInfo } from "./mcp-client.js";
import { McpClientWrapper } from "./mcp-client.js";
import { createMcpToolExecutor } from "./mcp-tool-adapter.js";

export type McpManagerConfig = {
  readonly servers: readonly McpServerSettings[];
  readonly env?: Readonly<Record<string, string>>;
};

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

type ServerEntry = {
  client: McpClientWrapper;
  readonly config: McpServerSettings;
  status: McpServerStatus;
  tools: readonly McpToolInfo[];
  errorMessage?: string;
};

export class McpManager {
  private readonly entries = new Map<string, ServerEntry>();

  constructor(config: McpManagerConfig) {
    for (const server of config.servers) {
      if (!server.enabled) {
        continue;
      }
      const resolvedEnv = resolveEnvRefs(server.envSecretRefs, config.env);
      const clientConfig: McpClientConfig = {
        serverId: server.serverId,
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        env: resolvedEnv,
      };
      this.entries.set(server.serverId, {
        client: new McpClientWrapper(clientConfig),
        config: server,
        status: "disconnected",
        tools: [],
      });
    }
  }

  async connectAll(): Promise<void> {
    const promises = [...this.entries.values()].map((entry) => this.connectEntry(entry));
    await Promise.allSettled(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = [...this.entries.values()].map(async (entry) => {
      if (entry.status === "connected") {
        try {
          await entry.client.disconnect();
        } catch {
        }
        entry.status = "disconnected";
        entry.tools = [];
      }
    });
    await Promise.allSettled(promises);
  }

  getToolsForRegistry(): readonly ToolExecutor[] {
    const executors: ToolExecutor[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "connected") {
        continue;
      }
      for (const tool of entry.tools) {
        executors.push(createMcpToolExecutor(entry.client, tool, entry.config.serverId));
      }
    }
    return executors;
  }

  getServerStatuses(): Readonly<Record<string, McpServerStatus>> {
    const statuses: Record<string, McpServerStatus> = {};
    for (const [serverId, entry] of this.entries) {
      statuses[serverId] = entry.status;
    }
    return statuses;
  }

  getEntryForTesting(serverId: string): ServerEntry | undefined {
    return this.entries.get(serverId);
  }

  private async connectEntry(entry: ServerEntry): Promise<void> {
    entry.status = "connecting";
    try {
      await entry.client.connect();
      entry.tools = await entry.client.listTools();
      entry.status = "connected";
    } catch (error) {
      entry.status = "error";
      entry.errorMessage = error instanceof Error ? error.message : "Unknown connection error.";
      entry.tools = [];
    }
  }
}

function resolveEnvRefs(
  envSecretRefs: readonly string[],
  env?: Readonly<Record<string, string>>
): Record<string, string> | undefined {
  if (envSecretRefs.length === 0) {
    return undefined;
  }
  if (env === undefined) {
    return undefined;
  }
  const resolved: Record<string, string> = {};
  for (const ref of envSecretRefs) {
    const value = env[ref];
    if (value !== undefined) {
      resolved[ref] = value;
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
