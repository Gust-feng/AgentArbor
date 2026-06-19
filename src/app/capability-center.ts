import type {
  BasicAgentCapabilitySnapshot,
  CapabilityMcpCatalogItem,
  CapabilitySkillCatalogItem,
  CapabilityToolCatalogItem,
  McpServerSettings,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import type { ToolExecutor } from "../domain/tools/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { McpManager, type McpManagerConfig, type McpServerRuntimeSnapshot } from "../adapters/mcp/index.js";
import type { ConfigCenter } from "./config-center.js";
import { resolveModelCapabilities } from "./model-capability-registry.js";
import {
  createDesktopBasicToolRegistry,
  type ToolRegistryFetchLike,
} from "./basic-agent-runtime/builtin-tool-runtime.js";
import type { ToolCatalogItem } from "./basic-agent-runtime/tool-registry.js";
import { discoverSkills } from "./skills/skill-loader.js";
import type { SkillStateStore } from "./skills/skill-state-store.js";

export type CapabilityCenterOptions = {
  readonly configCenter: ConfigCenter;
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
  readonly fetch?: ToolRegistryFetchLike;
  readonly playwrightAvailable?: boolean;
  readonly mcpConnectTimeoutMs?: number;
  readonly createMcpManager?: (config: McpManagerConfig) => CapabilityCenterMcpManager;
};

export type CapabilityCenterMcpManager = {
  connectAll(): Promise<void>;
  disconnectAll(): Promise<void>;
  getServerRuntimeSnapshots(): readonly McpServerRuntimeSnapshot[];
  getToolsForRegistry(): readonly ToolExecutor[];
  getDiscoveredToolsForRegistry?(): readonly ToolExecutor[];
};

export class CapabilityCenter {
  private skillsPromise?: Promise<readonly SkillDefinition[]>;
  private snapshotPromise?: Promise<BasicAgentCapabilitySnapshot>;

  constructor(private readonly options: CapabilityCenterOptions) {}

  invalidate(): void {
    this.skillsPromise = undefined;
    this.snapshotPromise = undefined;
  }

  async listSkills(): Promise<readonly SkillDefinition[]> {
    if (this.skillsPromise === undefined) {
      const current = discoverSkills({
        roots: this.options.skillRoots,
        stateStore: this.options.skillStateStore,
      });
      this.skillsPromise = current.catch((error) => {
        if (this.skillsPromise === current) {
          this.skillsPromise = undefined;
        }
        throw error;
      });
    }
    return this.skillsPromise;
  }

  async snapshot(): Promise<BasicAgentCapabilitySnapshot> {
    if (this.snapshotPromise === undefined) {
      const current = this.buildSnapshot();
      this.snapshotPromise = current.catch((error) => {
        if (this.snapshotPromise === current) {
          this.snapshotPromise = undefined;
        }
        throw error;
      });
    }
    return this.snapshotPromise;
  }

  private async buildSnapshot(): Promise<BasicAgentCapabilitySnapshot> {
    const [activeModel, overrides, toolStates, toolConfirmation, mcpServers, workspace, commandShell, env, skills] = await Promise.all([
      this.options.configCenter.getModelProviderConfig(),
      this.options.configCenter.listModelCapabilityOverrides(),
      this.options.configCenter.listToolStates(),
      this.options.configCenter.getToolConfirmationConfig(),
      this.options.configCenter.listMcpServers(),
      this.options.configCenter.getWorkspaceConfig(),
      this.options.configCenter.getCommandShellConfig(),
      this.options.configCenter.createModelRuntimeEnvironment(),
      this.listSkills(),
    ]);
    const connectableMcpServers = mcpServers.filter(isMcpServerConnectable);
    const mcpEnv = await this.options.configCenter.createMcpRuntimeEnvironment({
      servers: connectableMcpServers,
      baseEnv: env,
    });
    const mcpManager = this.createMcpManager({
      servers: connectableMcpServers,
      env: mcpEnv,
      connectTimeoutMs: this.options.mcpConnectTimeoutMs ?? 3_000,
    });
    let desktopToolCatalog;
    let mcpToolCatalog;
    let exposedMcpToolCatalog;
    let mcpRuntimeSnapshots;
    try {
      if (connectableMcpServers.length > 0) {
        await mcpManager.connectAll();
      }
      const registry = createDesktopBasicToolRegistry({
        env,
        fetch: this.options.fetch,
        workspaceRoot: workspace.workspaceDirectory,
        playwrightAvailable: this.options.playwrightAvailable,
        toolStates,
        mcpManager,
        commandShell,
      });
      desktopToolCatalog = registry.catalog("desktop-basic");
      mcpToolCatalog = registry.catalog("mcp");
      exposedMcpToolCatalog = filteredMcpToolCatalog(mcpToolCatalog, mcpServers);
      mcpRuntimeSnapshots = mcpManager.getServerRuntimeSnapshots();
    } finally {
      await mcpManager.disconnectAll();
    }
    const allTools = [
      ...desktopToolCatalog.tools,
      ...exposedMcpToolCatalog.tools,
    ].map(capabilityToolCatalogItem);
    const allAllowedTools = [
      ...desktopToolCatalog.allowedTools,
      ...exposedMcpToolCatalog.allowedTools,
    ];
    const modelCapabilities = resolveModelCapabilities({ profile: activeModel, overrides });
    const warnings = capabilityWarnings({
      activeModel,
      toolCount: allAllowedTools.length,
    });
    return {
      snapshotId: createId("capability-snapshot"),
      createdAt: nowIso(),
      activeModel,
      modelCapabilities,
      toolCatalog: {
        scope: "desktop-basic",
        tools: allTools,
        allowedTools: allAllowedTools,
      },
      skillCatalog: skills.map((skill): CapabilitySkillCatalogItem => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        sourcePath: skill.sourcePath,
        triggers: [...skill.triggers],
        lastUsedAt: skill.lastUsedAt,
      })),
      mcpCatalog: mcpServers.map((server): CapabilityMcpCatalogItem =>
        mcpCatalogItemForServer(server, mcpRuntimeSnapshots, mcpToolCatalog.tools, exposedMcpToolCatalog.tools)
      ),
      workspace,
      commandShell,
      toolConfirmation,
      securitySummary: `本轮模型、工具、技能和工作区能力快照。确认策略：${toolConfirmation.label}。`,
      warnings,
    };
  }

  private createMcpManager(config: McpManagerConfig): CapabilityCenterMcpManager {
    return this.options.createMcpManager?.(config) ?? new McpManager(config);
  }
}

function capabilityWarnings(input: {
  readonly activeModel: SanitizedModelProviderConfig;
  readonly toolCount: number;
}): readonly string[] {
  const warnings: string[] = [];
  if (!input.activeModel.secretConfigured) {
    warnings.push("当前模型 profile 未配置 API Key。");
  }
  if (input.activeModel.model === undefined) {
    warnings.push("当前模型 profile 未填写模型名。");
  }
  if (input.toolCount === 0) {
    warnings.push("当前没有可用工具。");
  }
  return warnings;
}

function capabilityToolCatalogItem(tool: ToolCatalogItem): CapabilityToolCatalogItem {
  return {
    name: tool.name,
    displayName: tool.displayName,
    displayDescription: tool.displayDescription,
    description: tool.description,
    category: tool.category,
    categoryLabel: tool.categoryLabel,
    riskLevel: tool.riskLevel,
    riskLabel: tool.riskLabel,
    operationType: tool.operationType,
    operationLabel: tool.operationLabel,
    requiresConfirmation: tool.requiresConfirmation,
    confirmationLabel: tool.confirmationLabel,
    visibleResultPolicy: tool.visibleResultPolicy,
    runtimeHints: tool.runtimeHints,
    scopes: tool.scopes,
    enabled: tool.enabledByDefault,
    availability: tool.availability,
    disabledReason: tool.disabledReason,
  };
}

function mcpCatalogItemForServer(
  server: McpServerSettings,
  runtimeSnapshots: readonly McpServerRuntimeSnapshot[],
  discoveredMcpTools: readonly ToolCatalogItem[],
  exposedMcpTools: readonly ToolCatalogItem[]
): CapabilityMcpCatalogItem {
  const availability = server.enabled ? mcpAvailability(server) : "disabled";
  const runtime = runtimeSnapshots.find((snapshot) => snapshot.serverId === server.serverId);
  const runtimeStatus = mcpRuntimeStatusFor(server, availability, runtime);
  return {
    serverId: server.serverId,
    label: server.label,
    transport: server.transport,
    enabled: server.enabled,
    confirmationMode: server.confirmationMode,
    availability,
    runtimeStatus,
    errorSummary: runtime?.errorSummary ?? server.lastError,
    commandSummary: commandSummaryFor(server.command, server.args),
    url: isNetworkMcpTransport(server.transport) ? server.url : undefined,
    envSecretRefCount: server.envSecretRefs.length,
    authSecretRefCount: [
      server.bearerTokenSecretRef,
      server.apiKeySecretRef,
      ...(server.headerSecretRefs ?? []),
    ].filter((ref) => ref !== undefined).length,
    toolExposureMode: server.toolExposureMode,
    enabledTools: [...server.enabledTools],
    autoApprovedTools: [...server.autoApprovedTools],
    lastConnectedAt: runtime?.lastConnectedAt ?? server.lastConnectedAt,
    lastError: server.lastError,
    runtimeConfig: availability === "configured" ? {
      transport: server.transport,
      command: server.transport === "stdio" ? server.command : undefined,
      args: server.transport === "stdio" ? [...(server.args ?? [])] : undefined,
      url: isNetworkMcpTransport(server.transport) ? server.url : undefined,
      envSecretRefs: [...server.envSecretRefs],
      headerSecretRefs: [...(server.headerSecretRefs ?? [])],
      bearerTokenSecretRef: server.bearerTokenSecretRef,
      apiKeySecretRef: server.apiKeySecretRef,
      apiKeyHeaderName: server.apiKeyHeaderName,
      confirmationMode: server.confirmationMode,
      toolExposureMode: server.toolExposureMode,
      enabledTools: [...server.enabledTools],
      autoApprovedTools: [...server.autoApprovedTools],
    } : undefined,
    tools: runtimeStatus === "connected"
      ? discoveredMcpTools
          .filter((tool) => tool.name.startsWith(`${server.serverId}__`))
          .map(capabilityToolCatalogItem)
      : [],
    exposedTools: runtimeStatus === "connected"
      ? exposedMcpTools
          .filter((tool) => tool.name.startsWith(`${server.serverId}__`))
          .map(capabilityToolCatalogItem)
      : [],
    updatedAt: server.updatedAt,
  };
}

function filteredMcpToolCatalog<T extends {
  readonly tools: readonly ToolCatalogItem[];
  readonly allowedTools: readonly string[];
}>(
  catalog: T,
  servers: readonly McpServerSettings[]
): T {
  const configuredServers = new Map(servers.map((server) => [server.serverId, server]));
  const tools = catalog.tools.filter((tool) => {
    const server = serverForNamespacedTool(configuredServers, tool.name);
    return server === undefined ? false : isMcpToolEnabledForServer(server, tool.name);
  });
  const allowedToolNames = new Set(tools.map((tool) => tool.name));
  return {
    ...catalog,
    tools,
    allowedTools: catalog.allowedTools.filter((name) => allowedToolNames.has(name)),
  };
}

function serverForNamespacedTool(
  servers: ReadonlyMap<string, McpServerSettings>,
  toolName: string
): McpServerSettings | undefined {
  const separator = toolName.indexOf("__");
  if (separator <= 0) {
    return undefined;
  }
  return servers.get(toolName.slice(0, separator));
}

function isMcpToolEnabledForServer(server: McpServerSettings, namespacedToolName: string): boolean {
  if (server.toolExposureMode === "none") {
    return false;
  }
  if (server.toolExposureMode === "all") {
    return true;
  }
  const localName = namespacedToolName.startsWith(`${server.serverId}__`)
    ? namespacedToolName.slice(`${server.serverId}__`.length)
    : namespacedToolName;
  return server.enabledTools.includes(namespacedToolName) || server.enabledTools.includes(localName);
}

function mcpAvailability(server: {
  readonly transport: "stdio" | "http" | "sse";
  readonly command?: string;
  readonly url?: string;
}): CapabilityMcpCatalogItem["availability"] {
  if (server.transport === "sse") {
    return "unavailable";
  }
  if (server.transport === "stdio") {
    return server.command === undefined ? "unavailable" : "configured";
  }
  return server.url === undefined ? "unavailable" : "configured";
}

function mcpRuntimeStatusFor(
  server: McpServerSettings,
  availability: CapabilityMcpCatalogItem["availability"],
  runtime: McpServerRuntimeSnapshot | undefined
): NonNullable<CapabilityMcpCatalogItem["runtimeStatus"]> {
  if (!server.enabled) {
    return "disabled";
  }
  if (availability === "unavailable") {
    return "unavailable";
  }
  if (runtime === undefined) {
    return "configured";
  }
  if (runtime.status === "disconnected") {
    return "configured";
  }
  return runtime.status;
}

function isMcpServerConnectable(server: McpServerSettings): boolean {
  return server.enabled && mcpAvailability(server) === "configured";
}

function isNetworkMcpTransport(transport: McpServerSettings["transport"]): boolean {
  return transport === "http" || transport === "sse";
}

function commandSummaryFor(command: string | undefined, args: readonly string[] | undefined): string | undefined {
  if (command === undefined) {
    return undefined;
  }
  let previousWasSensitiveFlag = false;
  const safeArgs = (args ?? []).slice(0, 6).map((arg) => {
    const sensitiveFlag = /^--?(?:api[_-]?key|token|secret|password|passwd|bearer)$/i.test(arg);
    const sensitiveKeyValue = /(?:api[_-]?key|token|secret|password|passwd|bearer)\s*[=:]/i.test(arg);
    if (previousWasSensitiveFlag || sensitiveFlag || sensitiveKeyValue || arg.includes("=")) {
      previousWasSensitiveFlag = sensitiveFlag;
      return "[arg]";
    }
    previousWasSensitiveFlag = false;
    return arg;
  });
  return [command, ...safeArgs].join(" ");
}
