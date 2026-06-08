import type {
  BasicAgentCapabilitySnapshot,
  ModelCapabilities,
  ModelRunReasoningEffort,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import {
  createDefaultToolCenter,
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import type { MinimalRuntime } from "../runtime.js";
import type { DesktopRunResources, PanelRunExecutionOptions } from "./run-execution-contracts.js";

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
          streamingMode: capabilitySnapshot.modelCapabilities.supportsStreaming ? "force_live" : "respect_profile",
        });

  if (!aiConfig.enabled) {
    throw createModelRuntimeDisabledConfigurationError(aiConfig.summaryInput);
  }

  return {
    capabilitySnapshot,
    informationAccess: options.informationAccess,
    aiEnvironment,
    aiConfig,
    workspaceRoot: capabilitySnapshot.workspace.workspaceDirectory,
    toolStates: toolStatesFromCapabilitySnapshot(capabilitySnapshot),
    toolCatalogNames: toolCatalogNamesFromCapabilitySnapshot(capabilitySnapshot),
    playwrightAvailable: capabilitySnapshot.toolCatalog.tools.some(
      (tool) => tool.name === "browser_snapshot" && tool.availability === "available"
    ),
  };
}

export function desktopCapabilitySnapshotForRunStart(
  snapshot: BasicAgentCapabilitySnapshot,
  reasoningEffort: ModelRunReasoningEffort | undefined
): BasicAgentCapabilitySnapshot {
  return effectiveDesktopCapabilitySnapshotForRun(
    snapshot,
    snapshot.modelCapabilities.supportsReasoningEffort ? reasoningEffort : undefined
  );
}

function effectiveDesktopCapabilitySnapshotForRun(
  snapshot: BasicAgentCapabilitySnapshot,
  reasoningEffort: ModelRunReasoningEffort | undefined
): BasicAgentCapabilitySnapshot {
  const activeModel = activeModelWithRunOpenAISettings(
    snapshot.activeModel,
    snapshot.modelCapabilities,
    reasoningEffort
  );
  return activeModel === snapshot.activeModel ? snapshot : { ...snapshot, activeModel };
}

function activeModelWithRunOpenAISettings(
  activeModel: SanitizedModelProviderConfig,
  modelCapabilities: ModelCapabilities,
  reasoningEffort: ModelRunReasoningEffort | undefined
): SanitizedModelProviderConfig {
  const {
    reasoningEffort: _profileReasoningEffort,
    reasoningSummary: profileReasoningSummary,
    parallelToolCalls: profileParallelToolCalls,
    stream: profileStream,
    ...baseOpenAI
  } = activeModel.openAI ?? {};
  if (reasoningEffort !== undefined && !modelCapabilities.supportsReasoningEffort) {
    throw new PanelHttpError(
      400,
      "unsupported_model_reasoning_effort",
      "当前模型不支持调节思考强度。"
    );
  }
  const openAI = removeUndefinedOpenAISettings({
    ...baseOpenAI,
    ...(modelCapabilities.supportsReasoningEffort && profileReasoningSummary !== undefined
      ? { reasoningSummary: profileReasoningSummary }
      : {}),
    ...(modelCapabilities.supportsParallelToolCalls && profileParallelToolCalls !== undefined
      ? { parallelToolCalls: profileParallelToolCalls }
      : {}),
    ...(profileStream !== undefined || !modelCapabilities.supportsStreaming
      ? { stream: modelCapabilities.supportsStreaming ? profileStream : false }
      : {}),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  });
  return {
    ...activeModel,
    openAI: Object.keys(openAI).length === 0 ? undefined : openAI,
  };
}

function removeUndefinedOpenAISettings<T extends Record<string, unknown>>(settings: T): T {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined)
  ) as T;
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

export function createDesktopToolCenterFactory(
  providerFetch: PanelRuntime["providerFetch"],
  resources: DesktopRunResources
) {
  return (toolRuntime: MinimalRuntime) => createDefaultToolCenter({
    runtime: toolRuntime,
    env: resources.aiEnvironment,
    fetch: providerFetch,
    workspaceRoot: resources.workspaceRoot,
    toolStates: resources.toolStates,
    toolCatalogNames: resources.toolCatalogNames,
    playwrightAvailable: resources.playwrightAvailable,
  });
}
