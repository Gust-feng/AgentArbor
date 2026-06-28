import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolAvailability,
  McpServerSettings,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import { LazyMcpToolExecutorProvider } from "../../adapters/mcp/index.js";
import {
  createDefaultToolCenter,
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopAgentToolCenterContext } from "../desktop-agent-session-contracts.js";
import type { DesktopRunResources, PanelRunExecutionOptions } from "./run-execution-contracts.js";
import { effectiveDesktopCapabilitySnapshotForRun } from "./desktop-run-model-settings.js";
import type { ToolRegistryScope } from "../basic-agent-runtime/tool-registry.js";
import { persistContextWindowFallback } from "../model-context-window-fallback.js";

function toolStatesFromCapabilitySnapshot(snapshot: BasicAgentCapabilitySnapshot): readonly ToolStateSettings[] {
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    enabled: tool.enabled,
    updatedAt: snapshot.createdAt,
  }));
}

function toolCatalogNamesFromCapabilitySnapshot(snapshot: BasicAgentCapabilitySnapshot): readonly string[] {
  return snapshot.toolCatalog.tools.map((tool) => tool.name);
}

function toolCatalogAvailabilityFromCapabilitySnapshot(snapshot: BasicAgentCapabilitySnapshot): readonly CapabilityToolAvailability[] {
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    availability: tool.availability,
    disabledReason: tool.disabledReason,
  }));
}

export async function prepareDesktopRunResources(
  runtime: PanelRuntime,
  aiMode: ModelRuntimeMode,
  options: PanelRunExecutionOptions
): Promise<DesktopRunResources> {
  if (aiMode === "none") {
    throw createModelRuntimeDisabledConfigurationError();
  }

  const baseCapabilitySnapshot = options.capabilitySnapshot;
  if (baseCapabilitySnapshot === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_capability_snapshot_required",
      "Desktop Agent run requires a capability snapshot frozen when the run was created."
    );
  }
  if (options.informationAccess === undefined) {
    throw new PanelHttpError(
      500,
      "desktop_information_access_required",
      "Desktop Agent run requires information access settings frozen when the run was created."
    );
  }
  const capabilitySnapshot = effectiveDesktopCapabilitySnapshotForRun(
    baseCapabilitySnapshot,
    options.reasoningEffort
  );
  if (
    isRealDesktopAiMode(aiMode) &&
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
    informationAccess: options.informationAccess,
  });
  const runtimeMode = desktopRuntimeMode(aiMode, capabilitySnapshot.activeModel);
  const aiConfig =
    aiMode === "fake"
      ? createModelRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: options.onModelOutputDelta })
      : createModelRuntimeConfig({
          mode: runtimeMode,
          env: aiEnvironment,
          modelProvider: capabilitySnapshot.activeModel,
          fetch: runtime.providerFetch,
          onModelOutputDelta: options.onModelOutputDelta,
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
  const mcpManager = await mcpManagerFromCapabilitySnapshot(runtime, capabilitySnapshot, aiEnvironment);

  return {
    capabilitySnapshot,
    informationAccess: options.informationAccess,
    aiEnvironment,
    aiConfig,
    workspaceRoot: capabilitySnapshot.workspace.workspaceDirectory,
    commandShell: capabilitySnapshot.commandShell,
    toolStates: toolStatesFromCapabilitySnapshot(capabilitySnapshot),
    toolCatalogNames: toolCatalogNamesFromCapabilitySnapshot(capabilitySnapshot),
    toolCatalogAvailability: toolCatalogAvailabilityFromCapabilitySnapshot(capabilitySnapshot),
    playwrightAvailable: capabilitySnapshot.toolCatalog.tools.some(
      (tool) => tool.name === "browser_snapshot" && tool.availability === "available"
    ),
    mcpManager,
    processRegistry: runtime.processRegistry,
  };
}

function isRealDesktopAiMode(aiMode: ModelRuntimeMode): boolean {
  return aiMode === "openai-compatible" || aiMode === "openai-responses";
}

export function desktopRuntimeMode(
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
  runtime: PanelRuntime,
  snapshot: BasicAgentCapabilitySnapshot,
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

export function createDesktopToolCenterFactory(
  providerFetch: PanelRuntime["providerFetch"],
  resources: DesktopRunResources
) {
  const toolRegistryScopes: readonly ToolRegistryScope[] =
    resources.mcpManager === undefined ? ["desktop-basic"] : ["desktop-basic", "mcp"];
  return (toolRuntime: MinimalRuntime, context?: DesktopAgentToolCenterContext) => createDefaultToolCenter({
    runtime: toolRuntime,
    env: resources.aiEnvironment,
    fetch: providerFetch,
    workspaceRoot: resources.workspaceRoot,
    commandShell: resources.commandShell,
    toolStates: resources.toolStates,
    toolCatalogNames: resources.toolCatalogNames,
    toolCatalogAvailability: resources.toolCatalogAvailability,
    playwrightAvailable: resources.playwrightAvailable,
    mcpManager: resources.mcpManager,
    toolRegistryScopes,
    processRegistry: resources.processRegistry,
    skillContexts: context?.skillContexts ?? [],
    taskSoil: context?.taskSoil,
    modelCapabilities: resources.capabilitySnapshot.modelCapabilities,
  });
}
