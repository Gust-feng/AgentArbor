import type {
  AgentCapabilitySnapshot,
  CapabilityToolAvailability,
  McpServerSettings,
  SanitizedCommandShellConfig,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import type { ModelOutputDelta } from "../../domain/intelligence/index.js";
import { LazyMcpToolExecutorProvider } from "../../adapters/mcp/index.js";
import {
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
  type ModelRuntimeConfig,
  type ModelRuntimeEnvironment,
} from "../model-runtime/index.js";
import {
  createDefaultToolCenter,
  type AgentToolRegistryContribution,
  type AgentToolRuntimeContext,
} from "../tool-center/index.js";
import { PanelHttpError } from "./http-utils.js";
import type { ToolRegistryScope } from "../tool-center/tool-registry.js";
import { persistContextWindowFallback } from "../model-runtime/model-context-window-fallback.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { ConfigCenter } from "../config-center/index.js";
import type { LocalCommandProcessRegistry } from "../tool-center/adapters/local-workspace-command-tools.js";
import type { ToolOutputStore } from "../tool-center/tool-output-store.js";
import type { InMemoryProcessRegistry, ProcessTerminator } from "../runtime-guard/index.js";
import type { PanelProviderFetch } from "./types.js";
import {
  createMcpToolRegistryContribution,
  type McpToolExecutorProvider,
} from "../mcp/mcp-tool-contribution.js";
import type { AgentLoopTokenCounter } from "../context-maintenance/index.js";
import type { ToolExecutionMetricsSink } from "../../domain/tools/index.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import type { ContextAttachmentReadAuthorization } from "../tool-center/adapters/context-attachment-access.js";
import type { LocalWorkspacePathAuthorization } from "../tool-center/adapters/local-workspace-common.js";

export type AgentRunResourceHost = {
  readonly configCenter: ConfigCenter;
  readonly providerFetch?: PanelProviderFetch;
  readonly processRegistry: LocalCommandProcessRegistry & Pick<InMemoryProcessRegistry, "cleanupByRun">;
  /** Present when a run-scoped Host lease is allowed to terminate owned processes. */
  readonly processTerminator?: ProcessTerminator;
  readonly toolOutputStore?: ToolOutputStore;
  readonly testOnlyAllowFakeModel?: boolean;
  readonly fileMutationCoordinator?: LocalWorkspaceMutationCoordinator;
  readonly resolveManagedAttachmentPath?: (attachmentId: string) => Promise<string | undefined>;
};

export type AgentHostRunResources<
  TCapabilitySnapshot extends AgentCapabilitySnapshot = AgentCapabilitySnapshot,
> = {
  readonly capabilitySnapshot: TCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly aiEnvironment: ModelRuntimeEnvironment;
  readonly workspaceRoot: string;
  readonly commandShell?: SanitizedCommandShellConfig;
  readonly toolStates: readonly ToolStateSettings[];
  readonly toolCatalogNames: readonly string[];
  readonly toolCatalogAvailability: readonly CapabilityToolAvailability[];
  readonly playwrightAvailable: boolean;
  readonly toolRegistryScopes: readonly ToolRegistryScope[];
  readonly toolContributions: readonly AgentToolRegistryContribution[];
  readonly release: () => Promise<void>;
  readonly processRegistry?: LocalCommandProcessRegistry;
  readonly processTerminator?: ProcessTerminator;
  readonly toolOutputStore?: ToolOutputStore;
  readonly fileMutationCoordinator?: LocalWorkspaceMutationCoordinator;
  readonly resolveManagedAttachmentPath?: (attachmentId: string) => Promise<string | undefined>;
};

export type AgentRunResources<
  TCapabilitySnapshot extends AgentCapabilitySnapshot = AgentCapabilitySnapshot,
> = AgentHostRunResources<TCapabilitySnapshot> & {
  readonly aiConfig: Extract<ModelRuntimeConfig, { readonly enabled: true }>;
};

function toolStatesFromCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): readonly ToolStateSettings[] {
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    enabled: tool.enabled,
    updatedAt: snapshot.createdAt,
  }));
}

function toolCatalogNamesFromCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): readonly string[] {
  return snapshot.toolCatalog.tools.map((tool) => tool.name);
}

function toolCatalogAvailabilityFromCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): readonly CapabilityToolAvailability[] {
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    availability: tool.availability,
    disabledReason: tool.disabledReason,
  }));
}

export async function prepareAgentRunResources<TCapabilitySnapshot extends AgentCapabilitySnapshot>(
  runtime: AgentRunResourceHost,
  aiMode: ModelRuntimeMode,
  input: {
    readonly capabilitySnapshot: TCapabilitySnapshot;
    readonly informationAccess: SanitizedInformationAccessConfig;
    readonly onModelOutputDelta?: (delta: ModelOutputDelta) => void;
  }
): Promise<AgentRunResources<TCapabilitySnapshot>> {
  if (aiMode === "none") {
    throw createModelRuntimeDisabledConfigurationError();
  }
  if (aiMode === "fake" && runtime.testOnlyAllowFakeModel !== true) {
    throw new PanelHttpError(
      400,
      "unsupported_model_provider",
      "Fake model execution is available only through an explicit test runtime.",
    );
  }
  const capabilitySnapshot = input.capabilitySnapshot;
  if (
    isRealAgentAiMode(aiMode) &&
    capabilitySnapshot.activeModel.providerKind !== "openai_compatible"
  ) {
    throw new PanelHttpError(
      400,
      "unsupported_model_provider",
      "当前模型厂商暂不支持运行。"
    );
  }

  const aiEnvironment = await runtime.configCenter.createModelRuntimeEnvironment({
    modelProvider: capabilitySnapshot.activeModel,
    informationAccess: input.informationAccess,
  });
  const runtimeMode = agentRuntimeMode(aiMode, capabilitySnapshot.activeModel);
  const aiConfig =
    aiMode === "fake"
      ? createModelRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: input.onModelOutputDelta })
      : createModelRuntimeConfig({
          mode: runtimeMode,
          env: aiEnvironment,
          modelProvider: capabilitySnapshot.activeModel,
          fetch: runtime.providerFetch,
          onModelOutputDelta: input.onModelOutputDelta,
          onContextWindowExceeded: (event) =>
            persistContextWindowFallback({
              configCenter: runtime.configCenter,
              event,
            }),
          streamingMode: capabilitySnapshot.modelCapabilities.supportsStreaming ? "force_live" : "respect_profile",
        });

  if (!aiConfig.enabled) {
    throw createModelRuntimeDisabledConfigurationError(aiConfig.summaryInput);
  }
  const hostResources = await prepareAgentHostRunResourcesWithEnvironment(
    runtime,
    input,
    aiEnvironment,
  );

  return {
    ...hostResources,
    aiConfig,
  };
}

/**
 * Acquires Host-owned tools, MCP connections, and execution settings without
 * constructing a model runtime. Ordinary uses this boundary because its model
 * loop is provided by the Session adapter; Multi-Agent composes the same Host
 * resources with its existing IntelligenceChannel runtime above.
 */
export async function prepareAgentHostRunResources<
  TCapabilitySnapshot extends AgentCapabilitySnapshot,
>(
  runtime: AgentRunResourceHost,
  input: {
    readonly capabilitySnapshot: TCapabilitySnapshot;
    readonly informationAccess: SanitizedInformationAccessConfig;
  },
): Promise<AgentHostRunResources<TCapabilitySnapshot>> {
  const aiEnvironment = await runtime.configCenter.createModelRuntimeEnvironment({
    modelProvider: input.capabilitySnapshot.activeModel,
    informationAccess: input.informationAccess,
  });
  return prepareAgentHostRunResourcesWithEnvironment(runtime, input, aiEnvironment);
}

async function prepareAgentHostRunResourcesWithEnvironment<
  TCapabilitySnapshot extends AgentCapabilitySnapshot,
>(
  runtime: AgentRunResourceHost,
  input: {
    readonly capabilitySnapshot: TCapabilitySnapshot;
    readonly informationAccess: SanitizedInformationAccessConfig;
  },
  aiEnvironment: ModelRuntimeEnvironment,
): Promise<AgentHostRunResources<TCapabilitySnapshot>> {
  const capabilitySnapshot = input.capabilitySnapshot;
  const mcpManager = await mcpManagerFromCapabilitySnapshot(runtime, capabilitySnapshot, aiEnvironment);
  return {
    capabilitySnapshot,
    informationAccess: input.informationAccess,
    aiEnvironment,
    workspaceRoot: capabilitySnapshot.workspace.workspaceDirectory,
    commandShell: capabilitySnapshot.commandShell,
    toolStates: toolStatesFromCapabilitySnapshot(capabilitySnapshot),
    toolCatalogNames: toolCatalogNamesFromCapabilitySnapshot(capabilitySnapshot),
    toolCatalogAvailability: toolCatalogAvailabilityFromCapabilitySnapshot(capabilitySnapshot),
    playwrightAvailable: capabilitySnapshot.toolCatalog.tools.some(
      (tool) => tool.name === "WebFetch" && tool.availability === "available"
    ),
    toolRegistryScopes: mcpManager === undefined ? ["desktop-basic"] : ["desktop-basic", "mcp"],
    toolContributions: mcpManager === undefined
      ? []
      : [createMcpToolRegistryContribution(mcpManager, { useDiscoveredTools: false })],
    release: async () => {
      await mcpManager?.disconnectAll?.();
    },
    processRegistry: runtime.processRegistry,
    processTerminator: runtime.processTerminator,
    toolOutputStore: runtime.toolOutputStore,
    fileMutationCoordinator: runtime.fileMutationCoordinator,
    resolveManagedAttachmentPath: runtime.resolveManagedAttachmentPath,
  };
}

function isRealAgentAiMode(aiMode: ModelRuntimeMode): boolean {
  return aiMode === "openai-compatible" || aiMode === "openai-responses";
}

export function agentRuntimeMode(
  aiMode: ModelRuntimeMode,
  activeModel: Pick<SanitizedModelProviderConfig, "providerKind" | "protocolKind">
): ModelRuntimeMode {
  if (aiMode === "fake" || aiMode === "none") return aiMode;
  if (activeModel.providerKind === "openai_compatible" && activeModel.protocolKind === "openai_compatible_chat_completions") {
    return "openai-compatible";
  }
  return "openai-responses";
}

async function mcpManagerFromCapabilitySnapshot(
  runtime: AgentRunResourceHost,
  snapshot: AgentCapabilitySnapshot,
  env: Readonly<Record<string, string | undefined>>
): Promise<LazyMcpToolExecutorProvider | undefined> {
  const servers = snapshot.mcpCatalog
    .filter((server) => server.enabled && server.availability === "configured" && server.runtimeConfig !== undefined)
    .filter((server) => server.exposedTools.length > 0)
    .map((server): McpServerSettings => ({
      serverId: server.serverId,
      label: server.label,
      transport: server.runtimeConfig!.transport,
      command: server.runtimeConfig!.command,
      args: server.runtimeConfig!.args,
      url: server.runtimeConfig!.url,
      envSecretRefs: server.runtimeConfig!.envSecretRefs,
      headerSecretRefs: server.runtimeConfig!.headerSecretRefs,
      bearerTokenSecretRef: server.runtimeConfig!.bearerTokenSecretRef,
      apiKeySecretRef: server.runtimeConfig!.apiKeySecretRef,
      apiKeyHeaderName: server.runtimeConfig!.apiKeyHeaderName,
      confirmationMode: server.runtimeConfig!.confirmationMode,
      toolExposureMode: server.runtimeConfig!.toolExposureMode,
      enabledTools: server.runtimeConfig!.enabledTools,
      autoApprovedTools: server.runtimeConfig!.autoApprovedTools,
      enabled: true,
      cachedTools: server.cachedTools ?? [],
      toolsCachedAt: server.toolsCachedAt ?? snapshot.createdAt,
      updatedAt: server.updatedAt,
    }));
  if (servers.length === 0) {
    return undefined;
  }
  const mcpEnv =
    typeof runtime.configCenter.createMcpRuntimeEnvironment === "function"
      ? await runtime.configCenter.createMcpRuntimeEnvironment({ servers, baseEnv: env })
      : env;
  return new LazyMcpToolExecutorProvider({ servers, env: mcpEnv });
}

export function createAgentToolCenterFactory(
  providerFetch: PanelProviderFetch | undefined,
  resources: AgentHostRunResources
) {
  return (toolRuntime: AgentToolRuntimeContext, context?: {
    readonly contributions?: readonly AgentToolRegistryContribution[];
    readonly taskSoil?: TaskSoil;
    readonly outputTokenCounter?: AgentLoopTokenCounter;
    readonly metricsSink?: ToolExecutionMetricsSink;
    readonly contextAttachmentReadAuthorization?: ContextAttachmentReadAuthorization;
    readonly workspacePathAuthorization?: LocalWorkspacePathAuthorization;
  }) => createDefaultToolCenter({
    runtime: toolRuntime,
    env: resources.aiEnvironment,
    fetch: providerFetch,
    workspaceRoot: resources.workspaceRoot,
    commandShell: resources.commandShell,
    toolStates: resources.toolStates,
    toolCatalogNames: resources.toolCatalogNames,
    toolCatalogAvailability: resources.toolCatalogAvailability,
    baseToolScopes: ["desktop-basic"],
    playwrightAvailable: resources.playwrightAvailable,
    toolRegistryScopes: resources.toolRegistryScopes,
    processRegistry: resources.processRegistry,
    processTerminator: resources.processTerminator,
    contributions: [...resources.toolContributions, ...(context?.contributions ?? [])],
    taskSoil: context?.taskSoil,
    modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
    toolOutputStore: resources.toolOutputStore,
    outputTokenCounter: context?.outputTokenCounter,
    metricsSink: context?.metricsSink,
    fileMutationCoordinator: resources.fileMutationCoordinator,
    resolveManagedAttachmentPath: resources.resolveManagedAttachmentPath,
    contextAttachmentReadAuthorization: context?.contextAttachmentReadAuthorization,
    workspacePathAuthorization: context?.workspacePathAuthorization,
  });
}
