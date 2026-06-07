import type {
  BasicAgentCapabilitySnapshot,
  CapabilityMcpCatalogItem,
  CapabilitySkillCatalogItem,
  CapabilityToolCatalogItem,
} from "../domain/config/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import { createId, nowIso } from "../kernel/id.js";
import type { ConfigCenter } from "./config-center.js";
import { isKnownModel, resolveModelCapabilities } from "./model-capability-registry.js";
import {
  createDesktopBasicToolRegistry,
  type ToolRegistryFetchLike,
} from "./basic-agent-runtime/builtin-tool-runtime.js";
import { discoverSkills } from "./skills/skill-loader.js";
import type { SkillStateStore } from "./skills/skill-state-store.js";

export type CapabilityCenterOptions = {
  readonly configCenter: ConfigCenter;
  readonly skillRoots: readonly string[];
  readonly skillStateStore?: SkillStateStore;
  readonly fetch?: ToolRegistryFetchLike;
  readonly playwrightAvailable?: boolean;
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
    const toolCatalog = createDesktopBasicToolRegistry({
      env,
      fetch: this.options.fetch,
      workspaceRoot: workspace.workspaceDirectory,
      playwrightAvailable: this.options.playwrightAvailable,
      toolStates,
    }).catalog("desktop-basic");
    const modelCapabilities = resolveModelCapabilities({ profile: activeModel, overrides });
    const warnings = capabilityWarnings({ activeModel, knownModel: isKnownModel(activeModel), toolCount: toolCatalog.allowedTools.length });
    return {
      snapshotId: createId("capability-snapshot"),
      createdAt: nowIso(),
      activeModel,
      modelCapabilities,
      toolCatalog: {
        scope: "desktop-basic",
        tools: toolCatalog.tools.map((tool): CapabilityToolCatalogItem => ({
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
        })),
        allowedTools: toolCatalog.allowedTools,
      },
      skillCatalog: applyEnabledSkillFilter(skills).map((skill): CapabilitySkillCatalogItem => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: true,
        sourcePath: skill.sourcePath,
        triggers: [...skill.triggers],
        lastUsedAt: skill.lastUsedAt,
      })),
      mcpCatalog: mcpServers.map((server): CapabilityMcpCatalogItem => ({
        serverId: server.serverId,
        label: server.label,
        transport: server.transport,
        enabled: server.enabled,
        availability: server.enabled ? mcpAvailability(server) : "disabled",
        commandSummary: commandSummaryFor(server.command, server.args),
        url: server.transport === "http" ? server.url : undefined,
        envSecretRefCount: server.envSecretRefs.length,
        updatedAt: server.updatedAt,
      })),
      workspace,
      securitySummary: "本轮模型、工具、工作方法和工作区能力快照。",
      warnings,
    };
  }
}

function applyEnabledSkillFilter(
  skills: readonly SkillDefinition[]
): readonly SkillDefinition[] {
  return skills.filter((skill) => skill.enabled);
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

function commandSummaryFor(command: string | undefined, args: readonly string[] | undefined): string | undefined {
  if (command === undefined) {
    return undefined;
  }
  const safeArgs = (args ?? []).slice(0, 6).map((arg) => arg.includes("=") ? "[arg]" : arg);
  return [command, ...safeArgs].join(" ");
}
