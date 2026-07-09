import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAppSource } from "./panel-structure-test-utils.js";

test("panel server source keeps conversation restore and persistence split", async () => {
  const [
    requestHandler,
    conversationHistory,
    conversationRoutes,
    conversationRestore,
    conversationSync,
    persistedRunResponse,
    runtimeRecords,
    runPersistence,
    runStreamSync,
    basicAgentRoutes,
    basicAgentRunView,
    conversationCurrentRun,
    runRoutes,
    requestParsers,
    runModeRouting,
    deepRoutes,
    deepReadModel,
    deepModelIo,
    liveModelStream,
    runJobResponse,
    panelRunJobs,
    basicRunViewContracts,
    conversationContracts,
    panelRuntime,
    agentDefinitionCatalog,
    skillService,
    runExecution,
    runExecutionContracts,
    desktopRunResources,
    desktopRunModelSettings,
    desktopAgentExecution,
    undergroundCompatExecution,
    runStreamEvents,
    runStreamCopy,
    runStreamContracts,
    modelProgressCopy,
    modelFailureVisibleCopy,
    basicAgentContracts,
  ] = await Promise.all([
    readAppSource(path.join("panel-server", "request-handler.ts")),
    readAppSource(path.join("panel-server", "conversation-history.ts")),
    readAppSource(path.join("panel-server", "conversation-routes.ts")),
    readAppSource(path.join("panel-server", "conversation-restore.ts")),
    readAppSource(path.join("panel-server", "conversation-sync.ts")),
    readAppSource(path.join("panel-server", "persisted-run-response.ts")),
    readAppSource(path.join("panel-server", "runtime-records.ts")),
    readAppSource(path.join("panel-server", "run-persistence.ts")),
    readAppSource(path.join("panel-server", "run-stream-sync.ts")),
    readAppSource(path.join("panel-server", "basic-agent-routes.ts")),
    readAppSource(path.join("panel-server", "basic-agent-run-view.ts")),
    readAppSource(path.join("panel-server", "conversation-current-run.ts")),
    readAppSource(path.join("panel-server", "run-routes.ts")),
    readAppSource(path.join("panel-server", "request-parsers.ts")),
    readAppSource(path.join("panel-server", "run-mode-routing.ts")),
    readAppSource(path.join("panel-server", "deep-routes.ts")),
    readAppSource(path.join("deep", "deep-read-model.ts")),
    readAppSource(path.join("deep", "deep-model-io.ts")),
    readAppSource(path.join("panel-server", "live-model-stream.ts")),
    readAppSource(path.join("panel-server", "run-job-response.ts")),
    readAppSource("panel-run-jobs.ts"),
    readAppSource("panel-basic-agent-run-view-contracts.ts"),
    readAppSource("panel-conversation-contracts.ts"),
    readAppSource(path.join("panel-server", "runtime.ts")),
    readAppSource("agent-definition-catalog.ts"),
    readAppSource(path.join("panel-server", "skill-service.ts")),
    readAppSource(path.join("panel-server", "run-execution.ts")),
    readAppSource(path.join("panel-server", "run-execution-contracts.ts")),
    readAppSource(path.join("panel-server", "desktop-run-resources.ts")),
    readAppSource(path.join("panel-server", "desktop-run-model-settings.ts")),
    readAppSource(path.join("panel-server", "desktop-agent-execution.ts")),
    readAppSource(path.join("panel-server", "underground-compat-execution.ts")),
    readAppSource("panel-run-stream-events.ts"),
    readAppSource("panel-run-stream-copy.ts"),
    readAppSource("panel-run-stream-contracts.ts"),
    readAppSource("panel-model-progress-copy.ts"),
    readAppSource("model-failure-visible-copy.ts"),
    readAppSource(path.join("basic-agent-runtime", "contracts.ts")),
  ]);

  assert.equal(requestHandler.includes('from "./conversation-history.js"'), false);
  assert.equal(requestHandler.includes('from "./conversation-routes.js"'), true);
  assert.equal(requestHandler.includes('from "./conversation-restore.js"'), false);
  assert.equal(requestHandler.includes('from "./conversation-sync.js"'), false);
  assert.equal(requestHandler.includes('from "./persisted-run-response.js"'), false);
  assert.equal(requestHandler.includes('from "./runtime-records.js"'), false);
  assert.equal(requestHandler.includes('from "./run-persistence.js"'), false);
  assert.equal(requestHandler.includes('from "./run-stream-sync.js"'), true);
  assert.equal(requestHandler.includes('from "./run-routes.js"'), true);
  assert.equal(requestHandler.includes('from "./live-model-stream.js"'), false);
  assert.equal(requestHandler.includes('from "./run-job-response.js"'), false);
  assert.equal(requestHandler.includes('from "./runtime.js"'), true);
  assert.equal(requestHandler.includes('from "./skill-service.js"'), true);
  assert.equal(requestHandler.includes('from "./run-execution.js"'), true);
  assert.equal(conversationSync.includes("canvas.workSession"), false);
  assert.equal(conversationSync.includes("legacyWorkSessionCanvasForConversationSync"), true);
  assert.equal(runtimeRecords.includes("canvas.workSession"), false);
  assert.equal(runtimeRecords.includes("legacyWorkSessionCanvasForRuntimeRecord"), true);
  assert.equal(conversationHistory.includes("export async function buildConversationHistoryMessages"), true);
  assert.equal(conversationRoutes.includes("export async function handlePanelConversationRoute"), true);
  assert.equal(conversationRoutes.includes("startGuidanceFollowUpRun"), false);
  assert.equal(conversationRoutes.includes("export function scheduleNextQueuedConversationRun"), true);
  assert.equal(conversationRoutes.includes("export async function getPanelConversation"), true);
  assert.equal(conversationRoutes.includes("async function handleConversationMessageRequest"), true);
  assert.equal(conversationRoutes.includes("runtime.runExecutor.start({"), true);
  assert.equal(conversationRoutes.includes("runForPanel("), false);
  assert.equal(conversationRoutes.includes("runDesktopAgentSession"), false);
  assert.equal(conversationRoutes.includes("runOrdinaryDesktopForPanel"), false);
  assert.equal(conversationRoutes.includes("const config = await runtime.configCenter.getModelProviderConfig()"), false);
  assert.equal(conversationRoutes.includes("async function handleConversationRollbackRequest"), true);
  assert.equal(conversationRoutes.includes("async function ensurePanelConversationLoaded"), true);
  assert.equal(conversationRoutes.includes("async function listPanelConversations"), true);
  assert.equal(conversationRoutes.includes("async function workspaceFolderForConversation"), true);
  assert.equal(conversationRoutes.includes("function workspaceFolderFromConversationContext"), true);
  assert.equal(conversationRoutes.includes("function workspacePathFromTaskSoilInput"), true);
  assert.equal(conversationRoutes.includes("local-project:"), true);
  assert.equal(conversationRestore.includes("export async function restorePersistedPanelConversation"), true);
  assert.equal(conversationSync.includes("export function syncConversationTurnForJob"), true);
  assert.notEqual(
    conversationSync.indexOf('canvas?.kind === "desktop_agent_canvas"'),
    -1,
    "conversation sync should inspect desktop agent canvas"
  );
  assert.notEqual(
    conversationSync.indexOf('canvas?.kind === "work_session_canvas"'),
    -1,
    "conversation sync may keep legacy work_session_canvas only as a compatibility fallback"
  );
  assert.equal(
    conversationSync.indexOf('canvas?.kind === "desktop_agent_canvas"') < conversationSync.indexOf('canvas?.kind === "work_session_canvas"'),
    true,
    "ordinary conversation sync must prefer desktop_agent_canvas before legacy work_session_canvas"
  );
  assert.equal(persistedRunResponse.includes("export function createPersistedPanelRunResponse"), true);
  assert.equal(persistedRunResponse.includes("RunAgentDefinitionRef"), true);
  assert.equal(persistedRunResponse.includes("PanelRunResponseBase"), true);
  assert.equal(persistedRunResponse.includes("agentDefinitionRef: input.snapshot.run.agentDefinitionRef"), true);
  assert.equal(persistedRunResponse.includes("function persistedRunAgentLabel"), true);
  assert.equal(persistedRunResponse.includes("snapshot.run.agentDefinitionRef?.agentDisplayName"), true);
  for (const [sourceName, source] of [
    ["run-job-response", runJobResponse],
    ["persisted-run-response", persistedRunResponse],
    ["basic-agent-run-view", basicAgentRunView],
    ["conversation-current-run", conversationCurrentRun],
    ["runtime-records", runtimeRecords],
    ["run-persistence", runPersistence],
    ["panel-run-jobs", panelRunJobs],
    ["panel-basic-agent-run-view-contracts", basicRunViewContracts],
  ] as const) {
    assert.equal(source.includes('from "../agent-prompts/contracts.js"'), false, `${sourceName} must not import full AgentDefinition`);
    assert.equal(source.includes('from "./agent-prompts/contracts.js"'), false, `${sourceName} must not import full AgentDefinition`);
    assert.equal(source.includes("readonly agentDefinition?: AgentDefinition"), false, `${sourceName} should expose RunAgentDefinitionRef only`);
    assert.equal(source.includes("readonly agentDefinition?: AgentDefinition;"), false, `${sourceName} should not carry full AgentDefinition values`);
    assert.equal(source.includes("agentDefinition: AgentDefinition;"), false, `${sourceName} should not carry full AgentDefinition values`);
    assert.equal(source.includes("systemPrompt"), false, `${sourceName} must not reference prompt body fields`);
    assert.equal(source.includes("sourcePath"), false, `${sourceName} must not expose agent definition source paths`);
  }
  for (const [sourceName, source] of [
    ["conversation-routes", conversationRoutes],
    ["basic-agent-routes", basicAgentRoutes],
    ["run-routes", runRoutes],
    ["run-execution", runExecution],
    ["desktop-agent-execution", desktopAgentExecution],
    ["run-job-response", runJobResponse],
    ["persisted-run-response", persistedRunResponse],
    ["basic-agent-run-view", basicAgentRunView],
    ["conversation-current-run", conversationCurrentRun],
  ] as const) {
    assert.equal(source.includes("adapters/intelligence"), false, `${sourceName} must not import provider adapters`);
    assert.equal(source.includes("openai-compatible-chat-completions-provider"), false, `${sourceName} must not bind OpenAI chat provider`);
    assert.equal(source.includes("openai-responses-provider"), false, `${sourceName} must not bind OpenAI responses provider`);
    assert.equal(source.includes("normalizeOpenAI"), false, `${sourceName} must not normalize provider responses`);
    assert.equal(source.includes("toOpenAIFetch"), false, `${sourceName} must not map provider transport`);
  }
  assert.equal(runtimeRecords.includes("export function createRuntimeRunRecord"), true);
  assert.notEqual(
    runtimeRecords.indexOf('canvas?.kind === "desktop_agent_canvas"'),
    -1,
    "runtime records should inspect desktop agent canvas"
  );
  assert.notEqual(
    runtimeRecords.indexOf('canvas?.kind === "work_session_canvas"'),
    -1,
    "runtime records may keep legacy work_session_canvas only as a compatibility fallback"
  );
  assert.equal(
    runtimeRecords.indexOf('canvas?.kind === "desktop_agent_canvas"') < runtimeRecords.indexOf('canvas?.kind === "work_session_canvas"'),
    true,
    "runtime result summaries must prefer desktop_agent_canvas before legacy work_session_canvas"
  );
  assert.equal(runPersistence.includes("export async function persistPanelRun"), true);
  assert.equal(runStreamSync.includes("export function syncPanelRunStreamEventsForJob"), true);
  assert.equal(runStreamSync.includes("agentDefinitionRef: job.agentDefinitionRef"), true);
  assert.equal(panelRunJobs.includes("function panelJobAgentLabel"), true);
  assert.equal(panelRunJobs.includes("job.agentDefinitionRef?.agentDisplayName"), true);
  assert.equal(basicAgentRoutes.includes('from "./basic-agent-run-view.js"'), true);
  assert.equal(basicAgentRoutes.includes('from "./conversation-current-run.js"'), false);
  const basicAgentWorkViewRouteSource = sourceBetween(
    basicAgentRoutes,
    "async function handleGetBasicWorkViewRequest",
    "async function handleGetBasicRunEventsRequest"
  );
  assert.equal(
    basicAgentWorkViewRouteSource.includes("createBasicAgentRunViewReadModel(runtime, runId, 0)"),
    true
  );
  assert.equal(basicAgentWorkViewRouteSource.includes("createLiveBasicAgentWorkSessionReadModel"), false);
  assert.equal(basicAgentWorkViewRouteSource.includes("createPersistedBasicAgentWorkSessionReadModel"), false);
  assert.equal(basicAgentWorkViewRouteSource.includes("runtime.runtimeDatabase?.getRun"), false);
  assert.equal(basicAgentWorkViewRouteSource.includes("runtime.runExecutor.replayEvents"), false);
  const basicAgentRunViewRouteSource = sourceBetween(
    basicAgentRoutes,
    "async function handleGetBasicRunViewRequest",
    "async function handleGetBasicRunStreamRequest"
  );
  assert.equal(basicAgentRunViewRouteSource.includes("createBasicAgentRunViewReadModel(runtime, runId, cursor)"), true);
  assert.equal(basicAgentRunViewRouteSource.includes("syncLiveRunEvents"), false);
  assert.equal(basicAgentRunViewRouteSource.includes("runtime.runJobs.get"), false);
  assert.equal(basicAgentRunView.includes("export async function createBasicAgentRunViewReadModel"), true);
  assert.equal(basicAgentRunView.includes("function createLiveBasicAgentRunViewReadModel"), true);
  assert.equal(basicAgentRunView.includes("function createPersistedBasicAgentRunViewReadModel"), true);
  assert.equal(basicAgentRunView.includes("type BasicAgentRunViewCoreReadModel = Omit<PanelBasicAgentRunViewReadModel, \"workSession\">"), false);
  assert.equal(basicAgentRunView.includes("function addLegacyWorkSessionAlias"), false);
  assert.equal(basicAgentRunView.includes("workSession: view.workView"), false);
  assert.equal(basicAgentRunView.includes("workSession: workView"), false);
  assert.equal(basicAgentRunView.includes("const agentDefinitionRef = job.agentDefinitionRef ?? run.agentDefinitionRef"), true);
  assert.equal(basicAgentRunView.includes("agentDefinitionRef: run.agentDefinitionRef"), true);
  assert.equal(basicAgentRunView.includes("agentDefinitionRef: snapshot.run.agentDefinitionRef"), false);
  assert.equal(basicAgentRunView.includes("createLiveBasicAgentWorkViewReadModel"), true);
  assert.equal(basicAgentRunView.includes("createPersistedBasicAgentWorkViewReadModel"), true);
  assert.equal(basicAgentRunView.includes("createLiveBasicAgentWorkSessionReadModel"), false);
  assert.equal(basicAgentRunView.includes("createPersistedBasicAgentWorkSessionReadModel"), false);
  assert.equal(basicAgentRunView.includes("createPersistedStreamEvents"), true);
  assert.equal(basicAgentRunView.includes("panelStatusFromRuntimeStatus"), true);
  assert.equal(basicAgentRunView.includes("createPersistedPanelRunResponse"), false);
  assert.equal(basicAgentRunView.includes("getModelProviderConfig"), false);
  assert.equal(basicAgentRunView.includes("getInformationAccessConfig"), false);
  assert.equal(basicAgentRunView.includes("readonly configCenter"), false);
  assert.equal(basicAgentRunView.includes("readonly conversations"), false);
  assert.equal(conversationCurrentRun.includes('from "./basic-agent-run-view.js"'), true);
  assert.equal(conversationCurrentRun.includes("export async function createConversationCurrentRunReadModel"), true);
  assert.equal(conversationCurrentRun.includes("function createLiveBasicAgentRunViewReadModel"), false);
  assert.equal(conversationCurrentRun.includes("function createPersistedBasicAgentRunViewReadModel"), false);
  assert.equal(conversationCurrentRun.includes("createPersistedPanelRunResponse"), false);
  assert.equal(conversationCurrentRun.includes("createPanelRunResultReadModel"), false);
  assert.equal(basicRunViewContracts.includes("export type PanelBasicAgentRunViewReadModel"), true);
  assert.equal(basicRunViewContracts.includes("DesktopWorkViewReadModel"), true);
  assert.equal(basicRunViewContracts.includes("DesktopWorkSessionReadModel"), false);
  assert.equal(basicRunViewContracts.includes("RunAgentDefinitionRef"), true);
  assert.equal(basicRunViewContracts.includes("readonly agentDefinitionRef?: RunAgentDefinitionRef"), true);
  assert.equal(basicAgentRunView.includes("createPanelRunResultReadModel"), false);
  assert.equal(basicRunViewContracts.includes("PanelRunResultReadModel"), false);
  assert.equal(basicRunViewContracts.includes("readonly result:"), false);
  assert.equal(conversationContracts.includes("PanelConversationCurrentRunReadModel = PanelBasicAgentRunViewReadModel"), true);
  assert.equal(conversationContracts.includes("readonly result: PanelRunResultReadModel"), false);
  assert.equal(runRoutes.includes("export async function handlePanelRunRoute"), true);
  assert.equal(runRoutes.includes("async function handleRunRequest"), true);
  assert.equal(runRoutes.includes("async function handleStartRunRequest"), true);
  assert.equal(runRoutes.includes("async function handleGetRunRequest"), true);
  assert.equal(runRoutes.includes("function handleGetRunStreamRequest"), true);
  assert.equal(runRoutes.includes("async function createPersistedRunResponse"), true);
  const startRunRequestSource = sourceBetween(
    runRoutes,
    "async function handleStartRunRequest",
    "function requirePanelRunJob"
  );
  assert.equal(runRoutes.includes("async function defaultAiModeForStartRun"), false);
  assert.equal(runRoutes.includes("defaultAiModeForStartRun("), false);
  assert.equal(startRunRequestSource.includes("const runInput = parseRunInput(body);"), true);
  assert.equal(startRunRequestSource.includes("runtime.runExecutor.start({"), true);
  assert.equal(startRunRequestSource.includes("runtime.runExecutor.schedule"), true);
  assert.equal(startRunRequestSource.includes("runForPanel("), false);
  assert.equal(startRunRequestSource.includes("createPanelRunResponse("), false);
  assert.equal(startRunRequestSource.includes("defaultAiMode"), false);
  assert.equal(startRunRequestSource.includes("const config = await runtime.configCenter.getModelProviderConfig()"), false);
  assert.equal(startRunRequestSource.includes("parseRunInput(body,"), false);
  const runRequestSource = sourceBetween(
    runRoutes,
    "async function handleRunRequest",
    "async function handleStartRunRequest"
  );
  assert.equal(runRequestSource.includes('if (runKind === "desktop")'), true);
  assert.equal(runRequestSource.includes("desktop_sync_run_not_supported"), true);
  assert.equal(runRequestSource.includes("runtime.runExecutor.start({"), false);
  assert.equal(runRequestSource.includes("runtime.runExecutor.schedule"), false);
  assert.equal(requestParsers.includes("export function parseRunInput(raw: unknown): PanelRunInput"), true);
  assert.equal(requestParsers.includes("export function parseRunInput(raw: unknown,"), false);
  assert.equal(requestParsers.includes("defaultAiModeForRunKind"), false);
  assert.equal(requestParsers.includes("defaultAiMode?: ModelRuntimeMode"), false);
  assert.equal(requestParsers.includes("resolveEffectiveRunMode"), false);
  assert.equal(runModeRouting.includes("export function resolvePanelRouteRunMode"), true);
  assert.equal(runModeRouting.includes("resolveRunModeForKind(input.runKind, input.requestedRunMode)"), true);
  assert.equal(runRoutes.includes('from "./run-mode-routing.js"'), true);
  assert.equal(runRoutes.includes("resolvePanelRouteRunMode({ runKind, requestedRunMode })"), true);
  assert.equal(conversationRoutes.includes('from "./run-mode-routing.js"'), true);
  assert.equal(conversationRoutes.includes("resolvePanelRouteRunMode({"), true);
  assert.equal(conversationRoutes.includes('runKind: "desktop"'), true);
  assert.equal(conversationRoutes.includes("conversation_run_mode_not_supported"), true);
  assert.equal(deepRoutes.includes('from "../run-tool-boundary.js"'), true);
  assert.equal(deepRoutes.includes("function deepCapabilitySnapshotWithExecutableTools"), true);
  assert.equal(deepRoutes.includes("resolveRunToolBoundary({"), true);
  assert.equal(deepRoutes.includes("allowedTools: toolBoundary.allowedTools"), true);
  assert.equal(deepRoutes.includes("capabilitySnapshot: effectiveCapabilitySnapshot"), true);
  assert.equal(deepModelIo.includes("readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot"), true);
  assert.equal(deepModelIo.includes("不得声称没有文件、终端、工作区或底层工具"), true);
  assert.equal(deepModelIo.includes("需要列目录、读/改文件、执行命令、查看工作区"), true);
  assert.equal(deepReadModel.includes("function workspaceFolderForDeepConversation"), true);
  assert.equal(deepReadModel.includes("workspaceFolderForDeepRecord(record) ??"), true);
  assert.equal(deepReadModel.includes("workspaceFolderForDeepConversation(conversation)"), true);
  assert.equal(liveModelStream.includes("export function appendLiveModelOutputDelta"), true);
  assert.equal(runJobResponse.includes("export function createPanelRunJobResponse"), true);
  assert.equal(runJobResponse.includes("type PanelDesktopRouteReadModel"), false);
  assert.equal(panelRuntime.includes("export type PanelRuntime"), true);
  assert.equal(panelRuntime.includes("export type PanelRuntimeHooks"), true);
  assert.equal(panelRuntime.includes("export function createPanelRuntime"), true);
  assert.equal(panelRuntime.includes("export function isPanelRuntime"), true);
  assert.equal(panelRuntime.includes('from "../agent-definition-catalog.js"'), true);
  assert.equal(panelRuntime.includes('from "../agent-prompts/desktop-root-agent.js"'), false);
  assert.equal(panelRuntime.includes("AgentDefinitionRegistry"), true);
  assert.equal(panelRuntime.includes("readonly agentDefinitions: AgentDefinitionRegistry"), true);
  assert.equal(panelRuntime.includes("createRuntimeAgentDefinitionCatalog({"), true);
  assert.equal(panelRuntime.includes("additionalDefinitions: options.agentDefinitions"), true);
  assert.equal(panelRuntime.includes("agentDefinitions: agentDefinitionCatalog.registry"), true);
  assert.equal(panelRuntime.includes("agentDefinitions: options.agentDefinitions ?? []"), false);
  assert.equal(panelRuntime.includes("new AgentDefinitionRegistry(["), false);
  assert.equal(agentDefinitionCatalog.includes("export function createRuntimeAgentDefinitionCatalog"), true);
  assert.equal(agentDefinitionCatalog.includes('from "./agent-definition-registry.js"'), true);
  assert.equal(agentDefinitionCatalog.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(agentDefinitionCatalog.includes("new AgentDefinitionRegistry(["), true);
  assert.equal(panelRuntime.includes("new BasicAgentRunExecutor"), true);
  assert.equal(panelRuntime.includes("prepareRunStart: (startInput) => preparePanelBasicRunStart(runtime as PanelRuntime, startInput)"), true);
  assert.equal(panelRuntime.includes("async function preparePanelBasicRunStart"), true);
  assert.equal(panelRuntime.includes("readonly desktopAgentDefinition"), true);
  assert.equal(panelRuntime.includes("desktopAgentDefinition: agentDefinitionCatalog.desktopAgentDefinition"), true);
  assert.equal(panelRuntime.includes("desktopAgentDefinitionFromConfig"), true);
  const panelRunStartPreparationSource = sourceBetween(
    panelRuntime,
    "async function preparePanelBasicRunStart",
    "function resolveSkillRoots"
  );
  assert.equal(panelRunStartPreparationSource.includes("runtime.desktopAgentDefinition, desktopAgentConfig"), true);
  assert.equal(panelRunStartPreparationSource.includes("runtime.configCenter.getInformationAccessConfig()"), true);
  assert.equal(panelRunStartPreparationSource.includes('if (input.runKind !== "desktop")'), true);
  assert.equal(panelRunStartPreparationSource.includes("runtime.configCenter.getModelProviderConfig()"), true);
  assert.equal(panelRunStartPreparationSource.includes("runtime.capabilityCenter.snapshot()"), true);
  assert.equal(panelRunStartPreparationSource.includes("const config = capabilitySnapshot.activeModel"), true);
  assert.equal(panelRunStartPreparationSource.includes("aiMode: input.aiMode ?? config.defaultAiMode"), true);
  assert.equal(panelRuntime.includes('resolvePanelRunMode, type PanelRunJob'), true);
  assert.equal(panelRunStartPreparationSource.includes("resolvePanelRunMode(input.runKind, input.runMode) === \"agent\""), true);
  assert.equal(panelRunStartPreparationSource.includes("runtime.configCenter.getDesktopAgentConfig()"), true);
  assert.equal(panelRunStartPreparationSource.includes("const agentDefinitionRef = agentDefinition === undefined"), true);
  assert.equal(panelRunStartPreparationSource.includes(": runAgentDefinitionRef(agentDefinition)"), true);
  assert.equal(panelRunStartPreparationSource.includes("agentDefinitionRef,"), true);
  assert.equal(panelRunStartPreparationSource.includes('input.runMode ?? "agent"'), false);
  assert.equal(panelRuntime.includes('from "./desktop-run-model-settings.js"'), true);
  assert.equal(panelRuntime.includes('from "./desktop-run-resources.js"'), false);
  assert.equal(panelRuntime.includes('from "./live-model-stream.js"'), true);
  assert.equal(panelRuntime.includes('from "./conversation-sync.js"'), true);
  assert.equal(skillService.includes("export async function listPanelSkills"), true);
  assert.equal(skillService.includes("export async function refreshPanelSkills"), true);
  assert.equal(skillService.includes("export async function setPanelSkillEnabled"), true);
  assert.equal(skillService.includes("export async function resolveTriggeredSkillContexts"), true);
  assert.equal(runExecution.includes("export async function executeBasicPanelRun"), true);
  const executeBasicPanelRunSource = sourceBetween(
    runExecution,
    "export async function executeBasicPanelRun",
    "export async function failPanelRunJob"
  );
  assert.equal(executeBasicPanelRunSource.includes("executePanelRunFromFrozenJob(runtime,"), true);
  assert.equal(executeBasicPanelRunSource.includes("runForPanel("), false);
  assert.equal(runExecution.includes("BasicAgentRunExecutor.start"), true);
  assert.equal(runExecution.includes("function executePanelRunFromFrozenJob"), true);
  assert.equal(runExecution.includes("@deprecated Compatibility helper for legacy synchronous run routes"), true);
  assert.equal(runExecution.includes("Default\n * ordinary Desktop Agent runs must be created through BasicAgentRunExecutor.start"), true);
  const runForPanelSource = sourceBetween(
    runExecution,
    "export async function runForPanel",
    "type PanelRunFrozenExecutionInput"
  );
  assert.equal(runForPanelSource.includes('if (runKind === "desktop")'), true);
  assert.equal(runForPanelSource.includes("desktop_sync_run_not_supported"), true);
  assert.equal(runForPanelSource.includes("runDesktopForPanel("), false);
  assert.equal(runExecution.includes("export async function failPanelRunJob"), true);
  assert.equal(runExecution.includes("export async function runForPanel"), true);
  assert.equal(runExecution.includes("export async function createPanelRunResponse"), true);
  assert.equal(runExecution.includes("function assertOrdinaryDesktopRunResponseFacts"), true);
  assert.equal(runExecution.includes("desktop_capability_snapshot_required"), true);
  assert.equal(runExecution.includes("desktop_information_access_required"), true);
  assert.equal(runExecution.includes("input.run.agentDefinitionRef === undefined"), true);
  assert.equal(runExecution.includes("export function createConfigurationFailedAiSummary"), true);
  assert.equal(runExecution.includes('from "./conversation-history.js"'), true);
  assert.equal(runExecution.includes('from "./desktop-run-resources.js"'), true);
  assert.equal(runExecution.includes('from "./desktop-agent-execution.js"'), true);
  assert.equal(runExecution.includes('from "./underground-compat-execution.js"'), true);
  assert.equal(runExecution.includes('from "./run-execution-contracts.js"'), true);
  assert.equal(runExecution.includes('from "../model-failure-visible-copy.js"'), true);
  assert.equal(runExecution.includes("function resolveExecutionAgentDefinition"), true);
  assert.equal(runExecution.includes("agentDefinition: resolveExecutionAgentDefinition(runtime, job)"), true);
  assert.equal(runExecution.includes("agentDefinitionRef: job.agentDefinitionRef"), true);
  assert.equal(runExecution.includes("runtime.agentDefinitionOverrides.get(runAgentDefinitionRefCacheKey(job.agentDefinitionRef))"), true);
  assert.equal(runExecution.includes("runtime.agentDefinitions.resolve(job.agentDefinitionRef)"), true);
  assert.equal(runExecution.includes("job.agentDefinitionRef.agentId !== expectedRef.agentId"), false);
  assert.equal(runExecution.includes("completed artifact"), false);
  assert.equal(runExecution.includes("没有形成最终结果"), false);
  assert.equal(runExecutionContracts.includes("export type PanelRunExecutionResult"), true);
  assert.equal(runExecutionContracts.includes("export type PanelRunExecutionOptions"), true);
  assert.equal(runExecutionContracts.includes("readonly agentDefinition?: AgentDefinition"), true);
  assert.equal(runExecutionContracts.includes("readonly agentDefinitionRef?: RunAgentDefinitionRef"), true);
  assert.equal(runExecutionContracts.includes("readonly informationAccess?: SanitizedInformationAccessConfig"), true);
  assert.equal(runExecutionContracts.includes("export type DesktopRunResources"), true);
  assert.equal(runExecutionContracts.includes("readonly informationAccess: SanitizedInformationAccessConfig"), true);
  assert.equal(runExecutionContracts.includes("readonly toolCatalogAvailability:"), true);
  assert.equal(basicAgentContracts.includes("export type DesktopAgentRunSpec"), true);
  assert.equal(basicAgentContracts.includes("export type DesktopAgentRunBirthFacts"), true);
  assert.equal(basicAgentContracts.includes("export type DesktopAgentRunExecutionInput"), true);
  assert.equal(basicAgentContracts.includes("readonly runKind: \"desktop\""), true);
  assert.equal(basicAgentContracts.includes("readonly runMode: \"agent\""), true);
  assert.equal(basicAgentContracts.includes("export type DesktopAgentRunExecutionResult = BasicAgentRunExecutionResult"), true);
  assert.equal(desktopRunResources.includes("export async function prepareDesktopRunResources"), true);
  assert.equal(desktopRunResources.includes("export function desktopRuntimeMode"), true);
  assert.equal(desktopRunResources.includes("export function createDesktopToolCenterFactory"), true);
  assert.equal(desktopRunResources.includes("createConfiguredToolCenterFactory"), false);
  assert.equal(desktopRunResources.includes("createDefaultToolCenter"), true);
  assert.equal(desktopRunResources.includes("function toolStatesFromCapabilitySnapshot"), true);
  assert.equal(desktopRunResources.includes("effectiveDesktopCapabilitySnapshotForRun"), true);
  assert.equal(desktopRunResources.includes("desktop_information_access_required"), true);
  assert.equal(desktopRunResources.includes("informationAccess: options.informationAccess"), true);
  assert.equal(desktopRunResources.includes("modelCapabilities.supportsStreaming ? \"force_live\" : \"respect_profile\""), true);
  assert.equal(desktopRunResources.includes("createModelRuntimeEnvironment({"), true);
  assert.equal(desktopRunResources.includes("createUndergroundAiEnvironment"), false);
  assert.equal(desktopRunModelSettings.includes("export function desktopCapabilitySnapshotForRunStart"), true);
  assert.equal(desktopRunModelSettings.includes("export function effectiveDesktopCapabilitySnapshotForRun"), true);
  assert.equal(desktopRunModelSettings.includes("function activeModelWithRunOpenAISettings"), true);
  assert.equal(desktopRunModelSettings.includes("modelCapabilities.supportsParallelToolCalls"), true);
  assert.equal(desktopRunModelSettings.includes("modelCapabilities.supportsReasoningEffort"), true);
  assert.equal(desktopRunModelSettings.includes("modelCapabilities.supportsStreaming ? profileStream : false"), true);
  assert.equal(desktopRunModelSettings.includes("unsupported_model_reasoning_effort"), true);
  const desktopToolCenterFactorySource = sourceAfter(desktopRunResources, "export function createDesktopToolCenterFactory");
  assert.equal(desktopToolCenterFactorySource.includes("runtime.configCenter"), false);
  assert.equal(desktopToolCenterFactorySource.includes("runtime.capabilityCenter"), false);
  assert.equal(desktopToolCenterFactorySource.includes("runtime.providerFetch"), false);
  assert.equal(desktopToolCenterFactorySource.includes("env: resources.aiEnvironment"), true);
  assert.equal(desktopToolCenterFactorySource.includes("fetch: providerFetch"), true);
  assert.equal(desktopToolCenterFactorySource.includes("toolStates: resources.toolStates"), true);
  assert.equal(desktopToolCenterFactorySource.includes("toolCatalogNames: resources.toolCatalogNames"), true);
  assert.equal(desktopToolCenterFactorySource.includes("toolCatalogAvailability: resources.toolCatalogAvailability"), true);
  assert.equal(desktopAgentExecution.includes("export type OrdinaryDesktopPanelRunExecutionInput"), true);
  assert.equal(desktopAgentExecution.includes("export async function executeOrdinaryDesktopRunForPanel"), true);
  assert.equal(desktopAgentExecution.includes("@deprecated Use executeOrdinaryDesktopRunForPanel with an object input"), true);
  assert.equal(desktopAgentExecution.includes("export async function runOrdinaryDesktopForPanel"), true);
  assert.equal(desktopAgentExecution.includes("runDesktopAgentSession"), true);
  assert.equal(desktopAgentExecution.includes("createDesktopToolCenterFactory(runtime.providerFetch, resources)"), true);
  assert.equal(desktopAgentExecution.includes("createDefaultToolCenter"), false);
  assert.equal(desktopAgentExecution.includes("createConfiguredToolCenter"), false);
  assert.equal(desktopAgentExecution.includes("const agentDefinition = options.agentDefinition ?? runtime.desktopAgentDefinition"), true);
  assert.equal(desktopAgentExecution.includes('from "../agent-definition-ref.js"'), true);
  assert.equal(desktopAgentExecution.includes("const expectedAgentDefinitionRef = runAgentDefinitionRef(agentDefinition)"), false);
  assert.equal(desktopAgentExecution.includes("agent_definition_ref_required"), true);
  assert.equal(desktopAgentExecution.includes("const agentDefinitionRef = options.agentDefinitionRef;"), true);
  assert.equal(desktopAgentExecution.includes("const agentDefinitionRef = options.agentDefinitionRef ?? expectedAgentDefinitionRef"), false);
  assert.equal(desktopAgentExecution.includes("agentDefinitionRefMatchesDefinition(agentDefinitionRef, agentDefinition)"), true);
  assert.equal(desktopAgentExecution.includes("function assertAgentDefinitionRefMatchesDefinition"), false);
  assert.equal(desktopAgentExecution.includes("agentDefinitionRef: runAgentDefinitionRef(agentDefinition)"), false);
  assert.equal(desktopAgentExecution.includes("agentDefinitionRef,"), true);
  assert.equal(desktopAgentExecution.includes("skillTriggerOptions(resources.capabilitySnapshot.skillTrigger?.mode ?? \"keyword\", context)"), true);
  assert.equal(desktopAgentExecution.includes('routingMode: "keyword"'), true);
  assert.equal(desktopAgentExecution.includes('routingMode: "model"'), true);
  assert.equal(desktopAgentExecution.includes("intelligenceChannel: context.intelligenceChannel"), true);
  assert.equal(desktopAgentExecution.includes("historySummary: skillRouterHistorySummary(context.conversationHistory)"), true);
  assert.equal(desktopAgentExecution.includes("callerRef: `skill-router:${context.goalId}`"), true);
  assert.equal(desktopAgentExecution.includes("config: resources.capabilitySnapshot.activeModel"), true);
  assert.equal(desktopAgentExecution.includes("informationAccess: resources.informationAccess"), true);
  assert.equal(desktopAgentExecution.includes("informationAccess: options.informationAccess"), false);
  assert.equal(desktopAgentExecution.includes("capabilitySnapshot: resources.capabilitySnapshot"), true);
  assert.equal(desktopAgentExecution.includes("type OrdinaryDesktopPanelFacts"), true);
  assert.equal(desktopAgentExecution.includes("facts: OrdinaryDesktopPanelFacts"), true);
  assert.equal(desktopAgentExecution.includes("facts: Pick<PanelRunExecutionResult"), false);
  assert.equal(desktopAgentExecution.includes("facts = {}"), false);
  assert.equal(desktopAgentExecution.includes('agent.status === "confirmation_needed"'), true);
  assert.equal(desktopAgentExecution.includes('"approval_needed"'), true);
  assert.equal(desktopAgentExecution.includes('status: agent.status === "paused" ? "blocked" : "completed"'), false);
  assert.equal(desktopAgentExecution.includes("没有形成最终结果"), true);
  assert.equal(desktopAgentExecution.includes("desktopPanelResultFromAgent(resumed, facts, reasoningEffort, releaseResources)"), true);
  assert.equal(undergroundCompatExecution.includes("export async function runDeepDesktopForPanel"), true);
  assert.equal(undergroundCompatExecution.includes("export async function runUndergroundForPanel"), true);
  assert.equal(undergroundCompatExecution.includes("runUndergroundDirectionSessionWithIntelligence"), true);
  assert.equal(undergroundCompatExecution.includes("createUndergroundDeepCanvas"), true);
  const deepDesktopExecutionSource = sourceBetween(
    undergroundCompatExecution,
    "export async function runDeepDesktopForPanel",
    "export async function runUndergroundForPanel"
  );
  assert.equal(deepDesktopExecutionSource.includes("informationAccess: resources.informationAccess"), true);
  assert.equal(runStreamEvents.includes('from "./panel-run-stream-copy.js"'), true);
  assert.equal(runStreamEvents.includes('from "./panel-run-read-model.js"'), false);
  assert.equal(runStreamEvents.includes("function agentNoteForEvent"), false);
  assert.equal(runStreamEvents.includes("function finalResultSummary"), false);
  assert.equal(runStreamEvents.includes("function modelFailureKindForDisplay"), false);
  assert.equal(runStreamEvents.includes("function purposeProgressLabel"), false);
  assert.equal(runStreamEvents.includes("Rootlet 集群"), false);
  assert.equal(runStreamEvents.includes("direction_handoff"), false);
  assert.equal(runStreamCopy.includes("export function agentNoteForEvent"), true);
  assert.equal(runStreamCopy.includes("export function finalResultSummary"), true);
  assert.equal(runStreamCopy.includes("export function modelRequestedSummary"), true);
  assert.equal(runStreamCopy.includes("function purposeProgressLabel"), false);
  assert.equal(runStreamCopy.includes('from "./panel-model-progress-copy.js"'), true);
  assert.equal(persistedRunResponse.includes('from "../panel-model-progress-copy.js"'), true);
  assert.equal(modelProgressCopy.includes("export function modelRequestedSummary"), true);
  assert.equal(modelProgressCopy.includes("export function restoredModelRequestedSummary"), true);
  assert.equal(modelProgressCopy.includes("function purposeProgressLabel"), true);
  assert.equal(runStreamCopy.includes('from "./panel-run-stream-events.js"'), false);
  assert.equal(runStreamCopy.includes('from "./panel-run-read-model.js"'), false);
  assert.equal(runStreamContracts.includes("export type PanelRunStreamEventType"), true);
  assert.equal(runStreamContracts.includes("export type PanelRunStreamEvent ="), true);
  assert.equal(runStreamCopy.includes("Rootlet 集群"), false);
  assert.equal(runStreamCopy.includes("动态 rootlet"), false);

  for (const privateRestoreDetail of [
    "backfillConversationResponseModels",
    "completedAssistantRunIds",
    "conversationTurnModelFromRunSnapshot",
    "latestRuntimeModelCall",
  ]) {
    assert.equal(requestHandler.includes(privateRestoreDetail), false);
    assert.equal(conversationRestore.includes(privateRestoreDetail), true);
  }
  for (const privateLiveStreamDetail of ["modelPurposeForRequest", "isUserFacingStreamingPurpose"]) {
    assert.equal(requestHandler.includes(privateLiveStreamDetail), false);
    assert.equal(liveModelStream.includes(privateLiveStreamDetail), true);
  }
  assert.equal(requestHandler.includes("createPanelRunTranscript"), false);
  assert.equal(runJobResponse.includes("createPanelRunTranscript"), true);
  assert.equal(requestHandler.includes("function routeReadModel"), false);
  assert.equal(runJobResponse.includes("function routeReadModel"), false);
  assert.equal(runJobResponse.includes("type PanelDesktopRouteReadModel"), false);
  for (const privateRuntimeDetail of [
    "function assemblePanelRuntime",
    "function resolveSkillRoots",
    "function createPanelRuntimePersistence",
    "new BasicAgentRunExecutor",
  ]) {
    assert.equal(requestHandler.includes(privateRuntimeDetail), false);
    assert.equal(panelRuntime.includes(privateRuntimeDetail), true);
  }
  for (const privateSkillDetail of ["discoverSkills", "loadSkillBody", "resolveSkillSelection"]) {
    assert.equal(requestHandler.includes(privateSkillDetail), false);
    assert.equal(skillService.includes(privateSkillDetail), true);
  }
  for (const privateConversationRouteDetail of [
    "async function handleConversationMessageRequest",
    "async function handleConversationRollbackRequest",
    "async function ensurePanelConversationLoaded",
    "async function listPanelConversations",
    "function queuedRunCanStartNow",
  ]) {
    assert.equal(requestHandler.includes(privateConversationRouteDetail), false);
    assert.equal(conversationRoutes.includes(privateConversationRouteDetail), true);
  }
  for (const privateRunExecutionDetail of [
    "async function runDesktopForPanel",
  ]) {
    assert.equal(requestHandler.includes(privateRunExecutionDetail), false);
    assert.equal(runExecution.includes(privateRunExecutionDetail), true);
  }
  assert.equal(requestHandler.includes("latestModelFailureTextForUser"), false);
  assert.equal(runExecution.includes("latestModelFailureTextForUser"), true);
  assert.equal(runExecution.includes("function latestModelFailureMessage"), false);
  assert.equal(modelFailureVisibleCopy.includes("export function latestModelFailureTextForUser"), true);
  assert.equal(modelFailureVisibleCopy.includes("friendlyUserFacingModelFailureText"), true);
  for (const privateRunRouteDetail of [
    "async function handleRunRequest",
    "async function handleStartRunRequest",
    "async function handleGetRunRequest",
    "function handleGetRunStreamRequest",
    "async function createPersistedRunResponse",
    "function requirePanelRunJob",
  ]) {
    assert.equal(requestHandler.includes(privateRunRouteDetail), false);
    assert.equal(runRoutes.includes(privateRunRouteDetail), true);
  }
  for (const compatibilityDetail of [
    "async function runDeepDesktopForPanel",
    "async function runUndergroundForPanel",
    "runUndergroundDirectionSessionWithIntelligence",
    "createUndergroundDeepCanvas",
  ]) {
    assert.equal(runExecution.includes(compatibilityDetail), false);
    assert.equal(undergroundCompatExecution.includes(compatibilityDetail), true);
  }
  for (const movedDesktopResourceDetail of [
    "function toolStatesFromCapabilitySnapshot",
  ]) {
    assert.equal(runExecution.includes(movedDesktopResourceDetail), false);
    assert.equal(desktopRunResources.includes(movedDesktopResourceDetail), true);
  }
  for (const desktopRunModelSettingDetail of [
    "function activeModelWithRunOpenAISettings",
  ]) {
    assert.equal(runExecution.includes(desktopRunModelSettingDetail), false);
    assert.equal(desktopRunModelSettings.includes(desktopRunModelSettingDetail), true);
  }
  for (const ordinaryDesktopDetail of ["runDesktopAgentSession", "function desktopPanelResultFromAgent"]) {
    assert.equal(runExecution.includes(ordinaryDesktopDetail), false);
    assert.equal(desktopAgentExecution.includes(ordinaryDesktopDetail), true);
  }
});

test("panel server routes cannot bypass ordinary desktop run creation", async () => {
  const routeFiles = await listPanelServerRouteFiles();
  for (const file of routeFiles) {
    const source = await fs.readFile(file, "utf8");
    const relative = path.relative(process.cwd(), file);
    assert.equal(source.includes("runDesktopAgentSession"), false, `${relative} must not call desktop session directly`);
    assert.equal(source.includes("runOrdinaryDesktopForPanel"), false, `${relative} must not call ordinary desktop execution directly`);
    assert.equal(source.includes("executeOrdinaryDesktopRunForPanel"), false, `${relative} must not call ordinary desktop execution directly`);
    assert.equal(source.includes('from "../desktop-agent-session'), false, `${relative} must not import desktop session directly`);
    assert.equal(source.includes('from "./desktop-agent-execution'), false, `${relative} must not import desktop execution directly`);
  }
});

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing source start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function sourceAfter(source: string, start: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source start marker: ${start}`);
  return source.slice(startIndex);
}

async function listPanelServerRouteFiles(): Promise<readonly string[]> {
  const root = path.join(process.cwd(), "src", "app", "panel-server");
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("routes.ts"))
    .map((entry) => path.join(root, entry.name));
}
