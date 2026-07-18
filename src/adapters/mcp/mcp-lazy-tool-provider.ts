import type { McpServerSettings } from "../../domain/config/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import {
  DEFAULT_MCP_MAX_CONCURRENT_CALLS_PER_SERVER,
  McpClientWrapper,
  type McpClientConfig,
  type McpToolInfo,
} from "./mcp-client.js";
import { createLazyMcpToolExecutor } from "./mcp-tool-adapter.js";

export type LazyMcpToolProviderConfig = {
  readonly servers: readonly McpServerSettings[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly maxConcurrentCallsPerServer?: number;
};

type LazyServerSession = {
  readonly server: McpServerSettings;
  client?: McpClientWrapper;
  connecting?: Promise<McpClientWrapper>;
};

export class LazyMcpToolExecutorProvider {
  private readonly sessions = new Map<string, LazyServerSession>();

  constructor(private readonly config: LazyMcpToolProviderConfig) {
    for (const server of config.servers) {
      if (!server.enabled || !hasCompleteRuntimeConfig(server) || (server.cachedTools?.length ?? 0) === 0) {
        continue;
      }
      this.sessions.set(server.serverId, { server });
    }
  }

  getToolsForRegistry(): readonly ToolExecutor[] {
    const executors: ToolExecutor[] = [];
    for (const session of this.sessions.values()) {
      for (const tool of session.server.cachedTools ?? []) {
        if (!isToolEnabled(session.server, tool.name)) {
          continue;
        }
        executors.push(createLazyMcpToolExecutor(
          () => this.getClient(session),
          tool as McpToolInfo,
          session.server.serverId,
          {
            confirmationMode: session.server.confirmationMode,
            autoApprovedTools: session.server.autoApprovedTools,
          }
        ));
      }
    }
    return executors;
  }

  getDiscoveredToolsForRegistry(): readonly ToolExecutor[] {
    const executors: ToolExecutor[] = [];
    for (const session of this.sessions.values()) {
      for (const tool of session.server.cachedTools ?? []) {
        executors.push(createLazyMcpToolExecutor(
          () => this.getClient(session),
          tool as McpToolInfo,
          session.server.serverId,
          {
            confirmationMode: session.server.confirmationMode,
            autoApprovedTools: session.server.autoApprovedTools,
          }
        ));
      }
    }
    return executors;
  }

  async disconnectAll(): Promise<void> {
    const clients = [...this.sessions.values()]
      .map((session) => session.client)
      .filter((client): client is McpClientWrapper => client !== undefined);
    await Promise.allSettled(clients.map((client) => client.disconnect()));
    for (const session of this.sessions.values()) {
      session.client = undefined;
      session.connecting = undefined;
    }
  }

  private async getClient(session: LazyServerSession): Promise<McpClientWrapper> {
    if (session.client?.isConnected() === true) {
      return session.client;
    }
    if (session.connecting !== undefined) {
      return session.connecting;
    }
    const client = new McpClientWrapper(mcpClientConfigFromServer(session.server, this.config.env, {
      maxConcurrentCallsPerServer: this.config.maxConcurrentCallsPerServer,
    }));
    session.connecting = client.connect().then(() => {
      session.client = client;
      session.connecting = undefined;
      return client;
    }).catch((error) => {
      session.connecting = undefined;
      throw error;
    });
    return session.connecting;
  }
}

export function mcpClientConfigFromServer(
  server: McpServerSettings,
  env?: Readonly<Record<string, string | undefined>>,
  options: { readonly maxConcurrentCallsPerServer?: number } = {},
): McpClientConfig {
  return {
    serverId: server.serverId,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: resolveEnvRefs(server.envSecretRefs, env),
    httpHeaders: resolveHttpHeaders(server, env),
    maxConcurrentCalls: options.maxConcurrentCallsPerServer ?? DEFAULT_MCP_MAX_CONCURRENT_CALLS_PER_SERVER,
  };
}

function resolveEnvRefs(
  envSecretRefs: readonly string[],
  env?: Readonly<Record<string, string | undefined>>
): Record<string, string> | undefined {
  if (envSecretRefs.length === 0 || env === undefined) {
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

function resolveHttpHeaders(
  server: McpServerSettings,
  env?: Readonly<Record<string, string | undefined>>
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (server.bearerTokenSecretRef !== undefined) {
    const value = env?.[server.bearerTokenSecretRef];
    if (value !== undefined) {
      headers.Authorization = `Bearer ${value}`;
    }
  }
  if (server.apiKeySecretRef !== undefined) {
    const value = env?.[server.apiKeySecretRef];
    if (value !== undefined) {
      headers[server.apiKeyHeaderName ?? "X-API-Key"] = value;
    }
  }
  for (const ref of server.headerSecretRefs ?? []) {
    const parsed = parseHeaderSecretRef(ref);
    if (parsed === undefined) {
      continue;
    }
    const value = env?.[parsed.secretRef];
    if (value !== undefined) {
      headers[parsed.headerName] = value;
    }
  }
  return Object.keys(headers).length === 0 ? undefined : headers;
}

function parseHeaderSecretRef(value: string): { readonly headerName: string; readonly secretRef: string } | undefined {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }
  const headerName = value.slice(0, separator).trim();
  const secretRef = value.slice(separator + 1).trim();
  return headerName.length === 0 || secretRef.length === 0 ? undefined : { headerName, secretRef };
}

function isToolEnabled(server: McpServerSettings, toolName: string): boolean {
  if (server.toolExposureMode === "none") {
    return false;
  }
  if (server.toolExposureMode === "all") {
    return true;
  }
  return server.enabledTools.includes(toolName);
}

function hasCompleteRuntimeConfig(server: McpServerSettings): boolean {
  if (server.transport === "stdio") {
    return server.command !== undefined && server.command.trim().length > 0;
  }
  return server.url !== undefined && server.url.trim().length > 0;
}
