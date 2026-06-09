import type { McpServerSettings } from "../../domain/config/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { McpClientConfig, McpToolInfo } from "./mcp-client.js";
import { McpClientWrapper } from "./mcp-client.js";
import { createMcpToolExecutor } from "./mcp-tool-adapter.js";

export type McpManagerConfig = {
  readonly servers: readonly McpServerSettings[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly connectTimeoutMs?: number;
};

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export type McpServerRuntimeSnapshot = {
  readonly serverId: string;
  readonly status: McpServerStatus;
  readonly errorSummary?: string;
  readonly toolNames: readonly string[];
};

type ServerEntry = {
  client: McpClientWrapper;
  readonly config: McpServerSettings;
  status: McpServerStatus;
  tools: readonly McpToolInfo[];
  errorMessage?: string;
};

export class McpManager {
  private readonly entries = new Map<string, ServerEntry>();
  private readonly connectTimeoutMs: number;

  constructor(config: McpManagerConfig) {
    this.connectTimeoutMs = Math.max(500, Math.floor(config.connectTimeoutMs ?? 3_000));
    for (const server of config.servers) {
      if (!server.enabled || !hasCompleteRuntimeConfig(server)) {
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

  getServerRuntimeSnapshots(): readonly McpServerRuntimeSnapshot[] {
    return [...this.entries.values()].map((entry) => ({
      serverId: entry.config.serverId,
      status: entry.status,
      errorSummary: entry.errorMessage === undefined ? undefined : safeErrorSummary(entry.errorMessage),
      toolNames: entry.tools.map((tool) => tool.name),
    }));
  }

  getEntryForTesting(serverId: string): ServerEntry | undefined {
    return this.entries.get(serverId);
  }

  private async connectEntry(entry: ServerEntry): Promise<void> {
    entry.status = "connecting";
    try {
      await withTimeout(
        entry.client.connect(),
        this.connectTimeoutMs,
        `MCP server "${entry.config.serverId}" did not connect before timeout.`
      );
      entry.tools = await withTimeout(
        entry.client.listTools(),
        this.connectTimeoutMs,
        `MCP server "${entry.config.serverId}" did not list tools before timeout.`
      );
      entry.status = "connected";
    } catch (error) {
      entry.status = "error";
      entry.errorMessage = safeErrorSummary(error instanceof Error ? error.message : "Unknown connection error.");
      entry.tools = [];
    }
  }
}

function resolveEnvRefs(
  envSecretRefs: readonly string[],
  env?: Readonly<Record<string, string | undefined>>
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

function hasCompleteRuntimeConfig(server: McpServerSettings): boolean {
  if (server.transport === "stdio") {
    return server.command !== undefined && server.command.trim().length > 0;
  }
  return server.url !== undefined && server.url.trim().length > 0;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function safeErrorSummary(message: string): string {
  const redacted = redactSensitiveText(message)
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length <= 500 ? redacted : `${redacted.slice(0, 499)}…`;
}
