import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilitySkillCatalogItem,
  CapabilitySkillCompatibility,
  CapabilitySkillMetadataValue,
  CapabilitySkillProvenance,
  CapabilitySkillProvenanceValue,
  CapabilitySkillResourceIndexItem,
  CapabilityMcpCatalogItem,
  CapabilityToolCatalogItem,
  McpServerSettings,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import type { SkillDefinition } from "../domain/basic-agent/index.js";
import type { ToolExecutor } from "../domain/tools/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { createCachedMcpToolExecutor, McpManager, type McpManagerConfig, type McpServerRuntimeSnapshot } from "../adapters/mcp/index.js";
import type { ConfigCenter } from "./config-center.js";
import { resolveModelCapabilities } from "./model-capability-registry.js";
import {
  createDesktopBasicToolRegistry,
  type ToolRegistryFetchLike,
} from "./basic-agent-runtime/builtin-tool-runtime.js";
import type { ToolCatalogItem } from "./basic-agent-runtime/tool-registry.js";
import { discoverSkills, parseSkillMarkdown, type SkillRootInput } from "./skills/skill-loader.js";
import type { SkillStateStore } from "./skills/skill-state-store.js";

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 8_000;

export type CapabilityCenterOptions = {
  readonly configCenter: ConfigCenter;
  readonly skillRoots: readonly SkillRootInput[];
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
    const cachedMcpServers = connectableMcpServers.filter(hasUsableMcpToolCache);
    const liveMcpServers = connectableMcpServers.filter((server) => !hasUsableMcpToolCache(server));
    const mcpEnv = await this.options.configCenter.createMcpRuntimeEnvironment({
      servers: liveMcpServers,
      baseEnv: env,
    });
    const mcpManager = this.createMcpManager({
      servers: liveMcpServers,
      env: mcpEnv,
      connectTimeoutMs: this.options.mcpConnectTimeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS,
    });
    let desktopToolCatalog;
    let mcpToolCatalog;
    let exposedMcpToolCatalog;
    let mcpRuntimeSnapshots;
    try {
      if (liveMcpServers.length > 0) {
        await mcpManager.connectAll();
      }
      const mcpToolProvider = cachedMcpServers.length === 0
        ? mcpManager
        : mergeMcpToolProviders(mcpManager, cachedMcpServers);
      const registry = createDesktopBasicToolRegistry({
        env,
        fetch: this.options.fetch,
        workspaceRoot: workspace.workspaceDirectory,
        playwrightAvailable: this.options.playwrightAvailable,
        toolStates,
        mcpManager: mcpToolProvider,
        commandShell,
        includeSkillResourceToolCatalog: true,
      });
      desktopToolCatalog = registry.catalog("desktop-basic");
      mcpToolCatalog = registry.catalog("mcp");
      exposedMcpToolCatalog = filteredMcpToolCatalog(mcpToolCatalog, mcpServers);
      mcpRuntimeSnapshots = [
        ...cachedMcpRuntimeSnapshots(cachedMcpServers),
        ...mcpManager.getServerRuntimeSnapshots(),
      ];
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
    const skillCatalog = await Promise.all(skills.map(projectSkillCatalogItem));
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
      skillCatalog,
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

async function projectSkillCatalogItem(skill: SkillDefinition): Promise<CapabilitySkillCatalogItem> {
  const base = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    sourcePath: skill.sourcePath,
    triggers: [...skill.triggers],
    lastUsedAt: skill.lastUsedAt,
    summary: skill.summary,
    category: skill.category,
    sourceKind: skill.sourceKind,
    sourceRootId: skill.sourceRootId,
    sourcePrecedence: skill.sourcePrecedence,
    stateKey: skill.stateKey,
    version: skill.version,
    provenance: safeSkillProvenance(skill.provenance),
    whenToUse: skill.whenToUse,
    disableModelInvocation: skill.disableModelInvocation,
    userInvocable: skill.userInvocable,
  };
  const resources = await skillResourceIndex(skill);
  let raw: string;
  try {
    raw = await fs.readFile(skill.sourcePath, "utf8");
  } catch {
    return {
      ...base,
      resources,
      validationStatus: "load_error",
      loadError: "无法读取 SKILL.md 元数据。",
      validationErrors: ["skill file could not be read"],
    };
  }

  const parsed = parseSkillMarkdown(raw);
  const frontmatter = parsed.frontmatter;
  const allowedTools = safeStringArray(frontmatter.allowedTools ?? frontmatter["allowed-tools"])
    .filter(isSafeToolName);
  const metadata = safeSkillMetadata(frontmatter.metadata);
  const compatibility = safeSkillCompatibility(frontmatter.compatibility);
  const provenance = safeSkillProvenance(frontmatter.provenance);
  const validationErrors = validateSkillCatalogItem({
    id: base.id,
    name: base.name,
    description: base.description,
    contentHash: parsed.contentHash,
  });

  return {
    ...base,
    summary: skill.summary ?? firstString(frontmatter.summary),
    category: skill.category ?? firstString(frontmatter.category),
    version: skill.version ?? firstString(frontmatter.version),
    provenance: safeSkillProvenance(skill.provenance) ?? provenance,
    whenToUse: skill.whenToUse ?? firstString(frontmatter.when_to_use ?? frontmatter.whenToUse),
    disableModelInvocation: skill.disableModelInvocation ?? booleanOrUndefined(frontmatter["disable-model-invocation"] ?? frontmatter.disableModelInvocation),
    userInvocable: skill.userInvocable ?? booleanOrUndefined(frontmatter["user-invocable"] ?? frontmatter.userInvocable),
    license: firstString(frontmatter.license),
    compatibility,
    metadata,
    allowedTools,
    resources,
    contentHash: parsed.contentHash,
    bodyHash: parsed.bodyHash,
    validationStatus: validationErrors.length === 0 ? "valid" : "invalid",
    validationErrors: validationErrors.length === 0 ? undefined : validationErrors,
  };
}

async function skillResourceIndex(skill: SkillDefinition): Promise<readonly CapabilitySkillResourceIndexItem[]> {
  const agentSkill = skill as SkillDefinition & {
    readonly scripts?: readonly string[];
    readonly references?: readonly string[];
    readonly assets?: readonly string[];
  };
  const resources = [
    ...(agentSkill.scripts ?? []).map((sourcePath) => ({ kind: "script" as const, sourcePath })),
    ...(agentSkill.references ?? []).map((sourcePath) => ({ kind: "reference" as const, sourcePath })),
    ...(agentSkill.assets ?? []).map((sourcePath) => ({ kind: "asset" as const, sourcePath })),
  ];
  return Promise.all(resources.map(async (resource): Promise<CapabilitySkillResourceIndexItem> => {
    try {
      const content = await fs.readFile(resource.sourcePath);
      return {
        kind: resource.kind,
        name: path.basename(resource.sourcePath),
        relativePath: toSkillRelativeResourcePath(skill, resource.sourcePath),
        sourcePath: resource.sourcePath,
        contentHash: hashBuffer(content),
        byteLength: content.byteLength,
      };
    } catch {
      return {
        kind: resource.kind,
        name: path.basename(resource.sourcePath),
        relativePath: toSkillRelativeResourcePath(skill, resource.sourcePath),
        sourcePath: resource.sourcePath,
        loadError: "无法读取资源。",
      };
    }
  }));
}

function toSkillRelativeResourcePath(skill: SkillDefinition, sourcePath: string): string | undefined {
  const candidate = skill as SkillDefinition & { readonly packagePath?: unknown };
  const packagePath = typeof candidate.packagePath === "string" && candidate.packagePath.trim().length > 0
    ? candidate.packagePath
    : path.dirname(skill.sourcePath);
  const relativePath = path.relative(packagePath, sourcePath);
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath.replace(/\\/g, "/");
}

function safeSkillMetadata(value: unknown): Readonly<Record<string, CapabilitySkillMetadataValue>> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const safe: Record<string, CapabilitySkillMetadataValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isSafeMetadataKey(key)) {
      continue;
    }
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.every((entry): entry is string => typeof entry === "string")) {
      safe[key] = item;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function safeSkillProvenance(value: unknown): CapabilitySkillProvenance | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const safe: Record<string, CapabilitySkillProvenanceValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isSafeMetadataKey(key)) {
      continue;
    }
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.every(isProvenanceArrayValue)) {
      safe[key] = item;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function safeSkillCompatibility(value: unknown): CapabilitySkillCompatibility | undefined {
  if (typeof value === "string") {
    return { requirement: value };
  }
  if (Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")) {
    return { requirements: value };
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  const safe: Record<string, string | readonly string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      safe[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.every((entry): entry is string => typeof entry === "string")) {
      safe[key] = item;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function validateSkillCatalogItem(skill: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly contentHash?: string;
}): readonly string[] {
  const errors: string[] = [];
  if (skill.id.trim().length === 0) errors.push("id is required");
  if (skill.name.trim().length === 0) errors.push("name is required");
  if (skill.description.trim().length === 0) errors.push("description is required");
  if (skill.contentHash === undefined) errors.push("content hash is required");
  return errors;
}

function safeStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  const single = firstString(value);
  return single === undefined ? [] : [single];
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeToolName(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value);
}

function isSafeMetadataKey(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value) && !/(?:body|content|path|source|resource|secret|token|key)/i.test(value);
}

function isProvenanceArrayValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hasUsableMcpToolCache(server: McpServerSettings): boolean {
  return server.lastError === undefined && (server.cachedTools?.length ?? 0) > 0;
}

function mergeMcpToolProviders(
  liveManager: CapabilityCenterMcpManager,
  cachedServers: readonly McpServerSettings[]
): CapabilityCenterMcpManager {
  const cachedDiscoveredTools = cachedMcpToolExecutors(cachedServers, { exposedOnly: false });
  const cachedExposedTools = cachedMcpToolExecutors(cachedServers, { exposedOnly: true });
  return {
    connectAll: () => liveManager.connectAll(),
    disconnectAll: () => liveManager.disconnectAll(),
    getServerRuntimeSnapshots: () => [
      ...cachedMcpRuntimeSnapshots(cachedServers),
      ...liveManager.getServerRuntimeSnapshots(),
    ],
    getToolsForRegistry: () => [
      ...liveManager.getToolsForRegistry(),
      ...cachedExposedTools,
    ],
    getDiscoveredToolsForRegistry: () => [
      ...(liveManager.getDiscoveredToolsForRegistry?.() ?? liveManager.getToolsForRegistry()),
      ...cachedDiscoveredTools,
    ],
  };
}

function cachedMcpToolExecutors(
  servers: readonly McpServerSettings[],
  options: { readonly exposedOnly: boolean }
): readonly ToolExecutor[] {
  const executors: ToolExecutor[] = [];
  for (const server of servers) {
    for (const tool of server.cachedTools ?? []) {
      if (options.exposedOnly && !isMcpToolEnabledForServer(server, `${server.serverId}__${tool.name}`)) {
        continue;
      }
      executors.push(createCachedMcpToolExecutor(tool, server.serverId, {
        confirmationMode: server.confirmationMode,
        autoApprovedTools: server.autoApprovedTools,
      }));
    }
  }
  return executors;
}

function cachedMcpRuntimeSnapshots(servers: readonly McpServerSettings[]): readonly McpServerRuntimeSnapshot[] {
  return servers.map((server) => ({
    serverId: server.serverId,
    status: "connected" as const,
    lastConnectedAt: server.lastConnectedAt ?? server.toolsCachedAt,
    toolNames: (server.cachedTools ?? []).map((tool) => tool.name),
  }));
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

/**
 * 把注册表目录项冻结为能力快照条目（FR-TOOL-001）。
 *
 * CapabilityCenter 只冻结工具契约的原始字段，**不做模型可见集合判定**：
 * 模型可见集合的裁剪在 `capability-policy` 的 `resolveRunCapabilities` 中由
 * `capabilitySnapshot.toolCatalog.tools` ∩ `toolVisibilityProfile` ∩
 * `snapshot.allowedTools` ∩ permission 单一推导得到；裸 ToolCenter 仅执行，
 * 不另立可见集合。
 *
 * 这里冻结的 `requiresConfirmation` 是契约的显式声明值。保守确认默认
 * （缺确认策略时按需确认，FR-TOOL-002）在消费层（capability-policy）通过
 * `resolveEffectiveConfirmationRequirement` 应用，不在快照层重写——保证快照
 * 冻结的是工具自身契约事实，能力推导始终来自单一函数。
 */
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
    fileOperation: tool.fileOperation,
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
    description: server.description,
    transport: server.transport,
    enabled: server.enabled,
    confirmationMode: server.confirmationMode,
    availability,
    runtimeStatus,
    errorSummary: runtime === undefined ? server.lastError : runtime.errorSummary,
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
    toolsCachedAt: server.toolsCachedAt,
    promptCount: server.cachedReferences?.prompts.length,
    resourceCount: server.cachedReferences?.resources.length,
    resourceTemplateCount: server.cachedReferences?.resourceTemplates.length,
    referencesCachedAt: server.referencesCachedAt,
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

function isNetworkMcpTransport(transport: McpServerSettings["transport"]): boolean {
  return transport === "http";
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
