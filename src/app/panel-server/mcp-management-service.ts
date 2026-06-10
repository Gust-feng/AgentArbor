import { existsSync } from "node:fs";
import path from "node:path";
import type { McpReferenceInfo } from "../../adapters/mcp/index.js";
import { McpManager } from "../../adapters/mcp/index.js";
import type { McpServerSettings } from "../../domain/config/index.js";
import { redactSensitiveText } from "../../kernel/redaction.js";
import type { CapabilityCenter } from "../capability-center.js";
import type { ConfigCenter } from "../config-center.js";
import { PanelHttpError } from "./http-utils.js";

export type PanelMcpManagementRuntime = {
  readonly configCenter: ConfigCenter;
  readonly capabilityCenter: CapabilityCenter;
};

export type PanelMcpToolSummary = {
  readonly name: string;
  readonly namespacedName: string;
  readonly description?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly openWorldHint?: boolean;
};

export type PanelMcpTestResult = {
  readonly ok: boolean;
  readonly connectedAt?: string;
  readonly errorCode?: string;
  readonly errorSummary?: string;
  readonly tools: readonly PanelMcpToolSummary[];
  readonly catalog: Awaited<ReturnType<CapabilityCenter["snapshot"]>>["mcpCatalog"];
};

export type PanelMcpReferenceResult = {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly errorSummary?: string;
  readonly prompts: McpReferenceInfo["prompts"];
  readonly resources: McpReferenceInfo["resources"];
  readonly resourceTemplates: McpReferenceInfo["resourceTemplates"];
};

export async function testPanelMcpServer(
  runtime: PanelMcpManagementRuntime,
  serverId: string,
  options: { readonly persistConnectionState?: boolean } = {}
): Promise<PanelMcpTestResult> {
  const server = (await runtime.configCenter.listMcpServers()).find((item) => item.serverId === serverId);
  if (server === undefined) {
    throw new PanelHttpError(404, "mcp_server_not_found", "未找到 MCP 服务。");
  }
  if (!hasCompleteMcpRuntimeConfig(server)) {
    if (options.persistConnectionState !== false) {
      await runtime.configCenter.updateMcpServerConnectionState({
        serverId,
        errorSummary: "缺少连接配置。",
      });
      runtime.capabilityCenter.invalidate();
    }
    return {
      ok: false,
      errorCode: missingConfigCode(server),
      errorSummary: "缺少连接配置。",
      tools: [],
      catalog: (await runtime.capabilityCenter.snapshot()).mcpCatalog,
    };
  }
  const missingCommand = missingStdioCommand(server);
  if (missingCommand !== undefined) {
    const errorSummary = `MCP command not found: ${missingCommand}`;
    if (options.persistConnectionState !== false) {
      await runtime.configCenter.updateMcpServerConnectionState({ serverId, errorSummary });
      runtime.capabilityCenter.invalidate();
    }
    return {
      ok: false,
      errorCode: "command_not_found",
      errorSummary,
      tools: [],
      catalog: (await runtime.capabilityCenter.snapshot()).mcpCatalog,
    };
  }

  const mcpEnv = await runtime.configCenter.createMcpRuntimeEnvironment({
    servers: [server],
    baseEnv: await runtime.configCenter.createModelRuntimeEnvironment(),
  });
  const manager = new McpManager({
    servers: [{ ...server, enabled: true }],
    env: mcpEnv,
    connectTimeoutMs: 3_000,
  });
  try {
    await manager.connectAll();
    const snapshot = manager.getServerRuntimeSnapshots().find((item) => item.serverId === server.serverId);
    if (snapshot?.status === "connected") {
      const connectedAt = snapshot.lastConnectedAt ?? new Date().toISOString();
      const testedTools = manager.getServerTools(server.serverId).map((tool) => ({
        name: tool.name,
        namespacedName: `${serverId}__${tool.name}`,
        description: tool.description,
        readOnlyHint: tool.annotations?.readOnlyHint,
        destructiveHint: tool.annotations?.destructiveHint,
        openWorldHint: tool.annotations?.openWorldHint,
      }));
      if (options.persistConnectionState !== false) {
        await runtime.configCenter.updateMcpServerConnectionState({
          serverId,
          connectedAt,
          errorSummary: undefined,
        });
        runtime.capabilityCenter.invalidate();
      }
      return {
        ok: true,
        connectedAt,
        tools: testedTools,
        catalog: (await runtime.capabilityCenter.snapshot()).mcpCatalog,
      };
    }

    const errorSummary = snapshot?.errorSummary ?? "MCP 连接失败。";
    const errorCode = classifyMcpConnectionError(errorSummary, server);
    if (options.persistConnectionState !== false) {
      await runtime.configCenter.updateMcpServerConnectionState({ serverId, errorSummary });
      runtime.capabilityCenter.invalidate();
    }
    return {
      ok: false,
      errorCode,
      errorSummary,
      tools: [],
      catalog: (await runtime.capabilityCenter.snapshot()).mcpCatalog,
    };
  } finally {
    await manager.disconnectAll();
  }
}

export async function listPanelMcpReferences(
  runtime: PanelMcpManagementRuntime,
  serverId: string
): Promise<PanelMcpReferenceResult> {
  const server = (await runtime.configCenter.listMcpServers()).find((item) => item.serverId === serverId);
  if (server === undefined) {
    throw new PanelHttpError(404, "mcp_server_not_found", "未找到 MCP 服务。");
  }
  if (!hasCompleteMcpRuntimeConfig(server)) {
    return {
      ok: false,
      errorCode: missingConfigCode(server),
      errorSummary: "缺少连接配置。",
      prompts: [],
      resources: [],
      resourceTemplates: [],
    };
  }
  const missingCommand = missingStdioCommand(server);
  if (missingCommand !== undefined) {
    return {
      ok: false,
      errorCode: "command_not_found",
      errorSummary: `MCP command not found: ${missingCommand}`,
      prompts: [],
      resources: [],
      resourceTemplates: [],
    };
  }

  const mcpEnv = await runtime.configCenter.createMcpRuntimeEnvironment({
    servers: [server],
    baseEnv: await runtime.configCenter.createModelRuntimeEnvironment(),
  });
  const manager = new McpManager({
    servers: [{ ...server, enabled: true }],
    env: mcpEnv,
    connectTimeoutMs: 3_000,
  });
  try {
    await manager.connectAll();
    const snapshot = manager.getServerRuntimeSnapshots().find((item) => item.serverId === server.serverId);
    if (snapshot?.status !== "connected") {
      const errorSummary = snapshot?.errorSummary ?? "MCP 连接失败。";
      return {
        ok: false,
        errorCode: classifyMcpConnectionError(errorSummary, server),
        errorSummary,
        prompts: [],
        resources: [],
        resourceTemplates: [],
      };
    }
    const references = await manager.getServerReferences(server.serverId);
    return {
      ok: true,
      prompts: references?.prompts ?? [],
      resources: references?.resources ?? [],
      resourceTemplates: references?.resourceTemplates ?? [],
    };
  } catch (error) {
    const errorSummary = safePanelMcpErrorSummary(error instanceof Error ? error.message : "MCP prompts/resources 获取失败。");
    return {
      ok: false,
      errorCode: classifyMcpConnectionError(errorSummary, server),
      errorSummary,
      prompts: [],
      resources: [],
      resourceTemplates: [],
    };
  } finally {
    await manager.disconnectAll();
  }
}

export function classifyMcpConnectionError(message: string, server: Pick<McpServerSettings, "transport" | "url" | "command">): string {
  const normalized = message.toLowerCase();
  if (server.transport === "http" && server.url !== undefined) {
    try {
      new URL(server.url);
    } catch {
      return "invalid_url";
    }
  }
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("did not connect") || normalized.includes("did not list tools")) {
    return "timeout";
  }
  if (
    normalized.includes("enoent") ||
    normalized.includes("not recognized") ||
    normalized.includes("command not found") ||
    normalized.includes("spawn") ||
    normalized.includes("找不到") ||
    normalized.includes("无法找到")
  ) {
    return "command_not_found";
  }
  if (normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("401") || normalized.includes("403") || normalized.includes("api密钥无效") || normalized.includes("invalid api")) {
    return "auth_failed";
  }
  if (normalized.includes("list tools") || normalized.includes("listtools")) {
    return "list_tools_failed";
  }
  return "connection_failed";
}

function missingStdioCommand(server: McpServerSettings): string | undefined {
  if (server.transport !== "stdio" || server.command === undefined) {
    return undefined;
  }
  return commandExists(server.command) ? undefined : server.command;
}

function commandExists(command: string): boolean {
  if (command.trim().length === 0) {
    return false;
  }
  if (command.includes("/") || command.includes("\\") || path.isAbsolute(command)) {
    return existsSync(command);
  }
  const pathEntries = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter((item) => item.length > 0);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((item) => item.length > 0)
    : [""];
  const candidates = process.platform === "win32" && path.extname(command).length > 0
    ? [command]
    : extensions.map((extension) => `${command}${extension}`);
  return pathEntries.some((directory) => candidates.some((candidate) => existsSync(path.join(directory, candidate))));
}

function missingConfigCode(server: McpServerSettings): string {
  if (server.transport === "http" && (server.url === undefined || server.url.trim().length === 0)) {
    return "missing_url";
  }
  if (server.transport === "stdio" && (server.command === undefined || server.command.trim().length === 0)) {
    return "missing_command";
  }
  if (server.transport === "sse") {
    return "legacy_sse_unavailable";
  }
  return "missing_config";
}

function hasCompleteMcpRuntimeConfig(server: McpServerSettings): boolean {
  if (server.transport === "sse") {
    return false;
  }
  if (server.transport === "stdio") {
    return server.command !== undefined && server.command.trim().length > 0;
  }
  return server.url !== undefined && server.url.trim().length > 0;
}

function safePanelMcpErrorSummary(message: string): string {
  const redacted = redactSensitiveText(message)
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length <= 500 ? redacted : `${redacted.slice(0, 499)}…`;
}
