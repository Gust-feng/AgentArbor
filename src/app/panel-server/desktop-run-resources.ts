import type {
  BasicAgentCapabilitySnapshot,
  ModelRunReasoningEffort,
  SanitizedModelProviderConfig,
  ToolStateSettings,
} from "../../domain/config/index.js";
import {
  createConfiguredToolCenterFactory,
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import { PanelHttpError } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";
import type { DesktopRunResources, PanelRunExecutionOptions } from "./run-execution-contracts.js";

function toolStatesFromCapabilitySnapshot(snapshot: BasicAgentCapabilitySnapshot): readonly ToolStateSettings[] {
  return snapshot.toolCatalog.tools.map((tool) => ({
    name: tool.name,
    enabled: tool.enabled,
    updatedAt: snapshot.createdAt,
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

  const baseCapabilitySnapshot = options.capabilitySnapshot ?? (await runtime.capabilityCenter.snapshot());
  const activeModel = activeModelWithRunOpenAISettings(
    baseCapabilitySnapshot.activeModel,
    baseCapabilitySnapshot.modelCapabilities.supportsReasoningEffort,
    options.reasoningEffort
  );
  const capabilitySnapshot =
    activeModel === baseCapabilitySnapshot.activeModel
      ? baseCapabilitySnapshot
      : { ...baseCapabilitySnapshot, activeModel };
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

  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment({
    modelProvider: capabilitySnapshot.activeModel,
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
        });

  if (!aiConfig.enabled) {
    throw createModelRuntimeDisabledConfigurationError(aiConfig.summaryInput);
  }

  return {
    capabilitySnapshot,
    aiEnvironment,
    aiConfig,
    workspaceRoot: capabilitySnapshot.workspace.workspaceDirectory,
    toolStates: toolStatesFromCapabilitySnapshot(capabilitySnapshot),
    playwrightAvailable: capabilitySnapshot.toolCatalog.tools.some(
      (tool) => tool.name === "browser_snapshot" && tool.availability === "available"
    ),
  };
}

function activeModelWithRunOpenAISettings(
  activeModel: SanitizedModelProviderConfig,
  supportsReasoningEffort: boolean,
  reasoningEffort: ModelRunReasoningEffort | undefined
): SanitizedModelProviderConfig {
  const { reasoningEffort: _profileReasoningEffort, ...baseOpenAI } = activeModel.openAI ?? {};
  if (reasoningEffort !== undefined && !supportsReasoningEffort) {
    throw new PanelHttpError(
      400,
      "unsupported_model_reasoning_effort",
      "当前模型不支持调节思考强度。"
    );
  }
  const openAI = {
    ...baseOpenAI,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
  return {
    ...activeModel,
    openAI: Object.keys(openAI).length === 0 ? undefined : openAI,
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

export async function createDesktopToolCenterFactory(
  runtime: PanelRuntime,
  resources: DesktopRunResources
) {
  return createConfiguredToolCenterFactory(runtime.configCenter, {
    env: resources.aiEnvironment,
    fetch: runtime.providerFetch,
    workspaceRoot: resources.workspaceRoot,
    toolStates: resources.toolStates,
    playwrightAvailable: resources.playwrightAvailable,
  });
}
