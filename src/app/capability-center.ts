import type {
  BasicAgentCapabilitySnapshot,
  CapabilityMcpCatalogItem,
  CapabilitySkillCatalogItem,
  CapabilityToolCatalogItem,
  McpServerSettings,
} from "../domain/config/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import type { ToolExecutor } from "../domain/tools/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { McpManager, type McpManagerConfig, type McpServerRuntimeSnapshot } from "../adapters/mcp/index.js";
import type { ConfigCenter } from "./config-center.js";
import { isKnownModel, resolveModelCapabilities } from "./model-capability-registry.js";
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
    const [activeModel, overrides, toolStates, mcpServers, workspace, env, skills] = await Promise.all([
      this.options.configCenter.getModelProviderConfig(),
      this.options.configCenter.listModelCapabilityOverrides(),
      this.options.configCenter.listToolStates(),
      this.options.configCenter.listMcpServers(),
      this.options.configCenter.getWorkspaceConfig(),
      this.options.configCenter.createModelRuntimeEnvironment(),
      this.listSkills(),
    ]);
    const connectableMcpServers = mcpServers.filter(isMcpServerConnectable);
    const mcpManager = this.createMcpManager({
      servers: connectableMcpServers,
      env,
      connectTimeoutMs: this.options.mcpConnectTimeoutMs ?? 800,
    });
    if (connectableMcpServers.length > 0) {
      await mcpManager.connectAll();
    }
    let desktopToolCatalog;
    let mcpToolCatalog;
    let mcpRuntimeSnapshots;
    try {
      const registry = createDesktopBasicToolRegistry({
        env,
        fetch: this.options.fetch,
        workspaceRoot: workspace.workspaceDirectory,
        playwrightAvailable: this.options.playwrightAvailable,
        toolStates,
        mcpManager,
      });
      desktopToolCatalog = registry.catalog("desktop-basic");
      mcpToolCatalog = registry.catalog("mcp");
      mcpRuntimeSnapshots = mcpManager.getServerRuntimeSnapshots();
    } finally {
      await mcpManager.disconnectAll();
    }
    const allTools = [
      ...desktopToolCatalog.tools,
      ...mcpToolCatalog.tools,
    ].map(capabilityToolCatalogItem);
    const allAllowedTools = [
      ...desktopToolCatalog.allowedTools,
      ...mcpToolCatalog.allowedTools,
    ];
    const modelCapabilities = resolveModelCapabilities({ profile: activeModel, overrides });
    const warnings = capabilityWarnings({ activeModel, knownModel: isKnownModel(activeModel), toolCount: allAllowedTools.length });
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
        mcpCatalogItemForServer(server, mcpRuntimeSnapshots, mcpToolCatalog.tools)
      ),
      workspace,
      securitySummary: "本轮模型、工具、工作方法和工作区能力快照。",
      warnings,
    };
  }

  private createMcpManager(config: McpManagerConfig): CapabilityCenterMcpManager {
    return this.options.createMcpManager?.(config) ?? new McpManager(config);
  }
}

function capabilityWarnings(input: {
  readonly activeModel: { readonly model?: string; readonly secretConfigured: boolean };
  readonly knownModel: boolean;
  readonly toolCount: number;
}): readonly string[] {
  const warnings: string[] = [];
  if (!input.activeModel.secretConfigured) {
    warnings.push("当前模型 profile 未配置 API Key。");
  }
  if (input.activeModel.model === undefined) {
    warnings.push("当前模型 profile 未填写模型名。");
  } else if (!input.knownModel) {
    warnings.push("当前模型不在内置能力目录中，已使用保守上下文窗口。");
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
    scopes: tool.scopes,
    enabled: tool.enabledByDefault,
    availability: tool.availability,
    disabledReason: tool.disabledReason,
  };
}

function mcpCatalogItemForServer(
  server: McpServerSettings,
  runtimeSnapshots: readonly McpServerRuntimeSnapshot[],
  mcpTools: readonly ToolCatalogItem[]
): CapabilityMcpCatalogItem {
  const availability = server.enabled ? mcpAvailability(server) : "disabled";
  const runtime = runtimeSnapshots.find((snapshot) => snapshot.serverId === server.serverId);
  const runtimeStatus = mcpRuntimeStatusFor(server, availability, runtime);
  return {
    serverId: server.serverId,
    label: server.label,
    transport: server.transport,
    enabled: server.enabled,
    availability,
    runtimeStatus,
    errorSummary: runtime?.errorSummary,
    commandSummary: commandSummaryFor(server.command, server.args),
    url: server.transport === "http" ? server.url : undefined,
    envSecretRefCount: server.envSecretRefs.length,
    runtimeConfig: availability === "configured" ? {
      transport: server.transport,
      command: server.transport === "stdio" ? server.command : undefined,
      args: server.transport === "stdio" ? [...(server.args ?? [])] : undefined,
      url: server.transport === "http" ? server.url : undefined,
      envSecretRefs: [...server.envSecretRefs],
    } : undefined,
    tools: runtimeStatus === "connected"
      ? mcpTools
          .filter((tool) => tool.name.startsWith(`${server.serverId}__`))
          .map(capabilityToolCatalogItem)
      : [],
    updatedAt: server.updatedAt,
  };
}

function mcpAvailability(server: {
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly url?: string;
}): CapabilityMcpCatalogItem["availability"] {
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
