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

/**
 * @deprecated 废弃候选（T3-5 / ADR-0025 deep 一期）。
 *
 * 正式 deep 入口：POST /api/deep/conversations + /api/deep/conversations/:id/runs + src/app/deep/*
 * （DeepRuntime：manager 自由决策循环 → 一层 child 探索 → 父层综合 → SynthesizedConclusion）。
 *
 * 本兼容路径驱动的是旧 UndergroundAgentOrchestrator 固定拓扑（与 directionHandoffPackage /
 * Plan 语义强耦合），不是正式 DeepRuntime；ADR-0025 三段式重构不转正本路径。
 *
 * 退役前置条件（闭环4）：调用方迁移到 /api/deep/* 且等价能力（manager 决策 / child 探索 /
 * 父层综合）验证完成；退役时须同步更新 panel-server-structure.test.ts 的结构断言。
 *
 * 边界：domain/underground 的 AgentLoop / Guard / run tree / 事件契约为保留复用抽象，
 * 不在本退役标记范围。
 *
 * 当前保持运行不阻塞；禁止改名 / 删除（结构测试要求签名存在）。
 */
export async function runDeepDesktopForPanel(
  runtime: PanelRuntime,
  goal: string,
  resources: DesktopRunResources,
  options: PanelRunExecutionOptions
): Promise<PanelRunExecutionResult> {
  const createToolCenter = createDesktopToolCenterFactory(runtime.providerFetch, resources);
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
    completed: true,
    config: resources.capabilitySnapshot.activeModel,
    informationAccess: resources.informationAccess,
    capabilitySnapshot: resources.capabilitySnapshot,
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

/**
 * @deprecated 废弃候选（T3-5 / ADR-0025 deep 一期）。
 *
 * 正式 deep 入口：POST /api/deep/conversations + /api/deep/conversations/:id/runs + src/app/deep/*
 * （DeepRuntime：manager 自由决策循环 → 一层 child 探索 → 父层综合 → SynthesizedConclusion）。
 *
 * 本兼容路径驱动的是旧 UndergroundAgentOrchestrator 固定拓扑（与 directionHandoffPackage /
 * Plan 语义强耦合），不是正式 DeepRuntime；ADR-0025 三段式重构不转正本路径。
 *
 * 退役前置条件（闭环4）：调用方迁移到 /api/deep/* 且等价能力验证完成；退役时须同步更新
 * panel-server-structure.test.ts 的结构断言。
 *
 * 边界：domain/underground 的 AgentLoop / Guard / run tree / 事件契约为保留复用抽象，不在退役范围。
 *
 * 当前保持运行不阻塞；禁止改名 / 删除（结构测试要求签名存在）。
 */
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

  const activeModel = options.config ?? await runtime.configCenter.getModelProviderConfig();
  const informationAccess = options.informationAccess ?? await runtime.configCenter.getInformationAccessConfig();
  const aiEnvironment = await runtime.configCenter.createUndergroundAiEnvironment({
    modelProvider: activeModel,
    informationAccess,
  });
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
    completed: true,
    config: activeModel,
    informationAccess,
    summary,
    observation: toPanelObservation(result.observationSnapshot),
    eventEntries: result.runtime.eventLog.list(),
  };
}
