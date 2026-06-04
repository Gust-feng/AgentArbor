import {
  createConfiguredToolCenterFactory,
  createModelRuntimeConfig,
  createModelRuntimeDisabledConfigurationError,
  type ModelRuntimeMode,
} from "../model-runtime/index.js";
import { createUndergroundDeepCanvas } from "../panel-canvas-read-model.js";
import { createPanelRunTranscript, toPanelObservation } from "../panel-run-read-model.js";
import {
  createUndergroundDemoSummary,
} from "../underground-demo-summary.js";
import { runUndergroundDirectionSessionWithIntelligence } from "../underground-direction-session.js";
import type { PanelRuntime } from "./runtime.js";
import { createDesktopToolCenterFactory, desktopRuntimeMode } from "./desktop-run-resources.js";
import type {
  DesktopRunResources,
  PanelRunExecutionOptions,
  PanelRunExecutionResult,
} from "./run-execution-contracts.js";
import { throwIfAborted } from "./request-parsers.js";

export async function runDeepDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  resources: DesktopRunResources,
  options: PanelRunExecutionOptions
): Promise<PanelRunExecutionResult> {
  const createToolCenter = await createDesktopToolCenterFactory(runtime, resources);
  throwIfAborted(options.abortSignal);
  const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: resources.aiConfig.createIntelligenceChannel,
    createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
  });
  throwIfAborted(options.abortSignal);
  const summary = createUndergroundDemoSummary(result, undefined, resources.aiConfig.summaryInput);
  const observation = toPanelObservation(result.observationSnapshot);
  const eventEntries = result.runtime.eventLog.list();
  const transcript = createPanelRunTranscript({
    runId: result.traceId,
    status: "completed",
    eventEntries,
    summary,
    observation,
    agentRunTree: result.undergroundOrchestratorRun.agentRunTree,
    desktopMode: "deep",
    reasoningEffort: options.reasoningEffort,
    createdAt: eventEntries[0]?.recordedAt ?? new Date(0).toISOString(),
    updatedAt: eventEntries.at(-1)?.recordedAt ?? new Date(0).toISOString(),
  });

  return {
    summary,
    observation,
    eventEntries,
    agentRunTree: result.undergroundOrchestratorRun.agentRunTree,
    canvas: createUndergroundDeepCanvas({
      result,
      transcript,
    }),
  };
}

export async function runUndergroundForPanel(
  runtime: PanelRuntime,
  goal: string,
  aiMode: ModelRuntimeMode,
  options: PanelRunExecutionOptions = {}
): Promise<PanelRunExecutionResult> {
  throwIfAborted(options.abortSignal);
  if (aiMode === "none") {
    throw createModelRuntimeDisabledConfigurationError();
  }

  const activeModel = await runtime.configCenter.getModelProviderConfig();
  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment({ modelProvider: activeModel });
  const runtimeMode = desktopRuntimeMode(aiMode, activeModel);
  const aiConfig =
    aiMode === "fake"
      ? createModelRuntimeConfig({ mode: "fake", env: aiEnvironment, onModelOutputDelta: options.onModelOutputDelta })
      : createModelRuntimeConfig({
          mode: runtimeMode,
          env: aiEnvironment,
          modelProvider: activeModel,
          fetch: runtime.providerFetch,
          onModelOutputDelta: options.onModelOutputDelta,
          streamingMode: "force_live",
        });

  if (!aiConfig.enabled) {
    throw createModelRuntimeDisabledConfigurationError(aiConfig.summaryInput);
  }

  const workspaceRoot = (await runtime.configCenter.getWorkspaceConfig()).workspaceDirectory;
  const createToolCenter = await createConfiguredToolCenterFactory(runtime.configCenter, {
    fetch: runtime.providerFetch,
    workspaceRoot,
  });
  throwIfAborted(options.abortSignal);
  const result = await runUndergroundDirectionSessionWithIntelligence(goal, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
  });
  throwIfAborted(options.abortSignal);
  const summary = createUndergroundDemoSummary(result, undefined, aiConfig.summaryInput);
  return {
    summary,
    observation: toPanelObservation(result.observationSnapshot),
    eventEntries: result.runtime.eventLog.list(),
  };
}
