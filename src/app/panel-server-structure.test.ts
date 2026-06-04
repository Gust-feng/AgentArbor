import assert from "node:assert/strict";
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
    runRoutes,
    liveModelStream,
    runJobResponse,
    panelRuntime,
    skillService,
    runExecution,
    runExecutionContracts,
    desktopRunResources,
    desktopAgentExecution,
    undergroundCompatExecution,
    runStreamEvents,
    runStreamCopy,
    runStreamContracts,
    modelProgressCopy,
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
    readAppSource(path.join("panel-server", "run-routes.ts")),
    readAppSource(path.join("panel-server", "live-model-stream.ts")),
    readAppSource(path.join("panel-server", "run-job-response.ts")),
    readAppSource(path.join("panel-server", "runtime.ts")),
    readAppSource(path.join("panel-server", "skill-service.ts")),
    readAppSource(path.join("panel-server", "run-execution.ts")),
    readAppSource(path.join("panel-server", "run-execution-contracts.ts")),
    readAppSource(path.join("panel-server", "desktop-run-resources.ts")),
    readAppSource(path.join("panel-server", "desktop-agent-execution.ts")),
    readAppSource(path.join("panel-server", "underground-compat-execution.ts")),
    readAppSource("panel-run-stream-events.ts"),
    readAppSource("panel-run-stream-copy.ts"),
    readAppSource("panel-run-stream-contracts.ts"),
    readAppSource("panel-model-progress-copy.ts"),
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
  assert.equal(conversationHistory.includes("export async function buildConversationHistoryMessages"), true);
  assert.equal(conversationRoutes.includes("export async function handlePanelConversationRoute"), true);
  assert.equal(conversationRoutes.includes("startGuidanceFollowUpRun"), false);
  assert.equal(conversationRoutes.includes("export function scheduleNextQueuedConversationRun"), true);
  assert.equal(conversationRoutes.includes("export async function getPanelConversation"), true);
  assert.equal(conversationRoutes.includes("async function handleConversationMessageRequest"), true);
  assert.equal(conversationRoutes.includes("async function handleConversationRollbackRequest"), true);
  assert.equal(conversationRoutes.includes("async function ensurePanelConversationLoaded"), true);
  assert.equal(conversationRoutes.includes("async function listPanelConversations"), true);
  assert.equal(conversationRestore.includes("export async function restorePersistedPanelConversation"), true);
  assert.equal(conversationSync.includes("export function syncConversationTurnForJob"), true);
  assert.equal(persistedRunResponse.includes("export function createPersistedPanelRunResponse"), true);
  assert.equal(runtimeRecords.includes("export function createRuntimeRunRecord"), true);
  assert.equal(runPersistence.includes("export async function persistPanelRun"), true);
  assert.equal(runStreamSync.includes("export function syncPanelRunStreamEventsForJob"), true);
  assert.equal(runRoutes.includes("export async function handlePanelRunRoute"), true);
  assert.equal(runRoutes.includes("async function handleRunRequest"), true);
  assert.equal(runRoutes.includes("async function handleStartRunRequest"), true);
  assert.equal(runRoutes.includes("async function handleGetRunRequest"), true);
  assert.equal(runRoutes.includes("function handleGetRunStreamRequest"), true);
  assert.equal(runRoutes.includes("async function createPersistedRunResponse"), true);
  assert.equal(liveModelStream.includes("export function appendLiveModelOutputDelta"), true);
  assert.equal(runJobResponse.includes("export function createPanelRunJobResponse"), true);
  assert.equal(runJobResponse.includes("type PanelDesktopRouteReadModel"), true);
  assert.equal(panelRuntime.includes("export type PanelRuntime"), true);
  assert.equal(panelRuntime.includes("export type PanelRuntimeHooks"), true);
  assert.equal(panelRuntime.includes("export function createPanelRuntime"), true);
  assert.equal(panelRuntime.includes("export function isPanelRuntime"), true);
  assert.equal(panelRuntime.includes("new BasicAgentRunExecutor"), true);
  assert.equal(panelRuntime.includes('from "./live-model-stream.js"'), true);
  assert.equal(panelRuntime.includes('from "./conversation-sync.js"'), true);
  assert.equal(skillService.includes("export async function listPanelSkills"), true);
  assert.equal(skillService.includes("export async function setPanelSkillEnabled"), true);
  assert.equal(skillService.includes("export async function resolveTriggeredSkillContexts"), true);
  assert.equal(runExecution.includes("export async function executeBasicPanelRun"), true);
  assert.equal(runExecution.includes("export async function failPanelRunJob"), true);
  assert.equal(runExecution.includes("export async function runForPanel"), true);
  assert.equal(runExecution.includes("export async function createCompletedPanelRunResponse"), true);
  assert.equal(runExecution.includes("export function createConfigurationFailedAiSummary"), true);
  assert.equal(runExecution.includes('from "./conversation-history.js"'), true);
  assert.equal(runExecution.includes('from "./desktop-run-resources.js"'), true);
  assert.equal(runExecution.includes('from "./desktop-agent-execution.js"'), true);
  assert.equal(runExecution.includes('from "./underground-compat-execution.js"'), true);
  assert.equal(runExecution.includes('from "./run-execution-contracts.js"'), true);
  assert.equal(runExecutionContracts.includes("export type PanelRunExecutionResult"), true);
  assert.equal(runExecutionContracts.includes("export type PanelRunExecutionOptions"), true);
  assert.equal(runExecutionContracts.includes("export type DesktopRunResources"), true);
  assert.equal(desktopRunResources.includes("export async function prepareDesktopRunResources"), true);
  assert.equal(desktopRunResources.includes("export function desktopRuntimeMode"), true);
  assert.equal(desktopRunResources.includes("export async function createDesktopToolCenterFactory"), true);
  assert.equal(desktopRunResources.includes("function toolStatesFromCapabilitySnapshot"), true);
  assert.equal(desktopRunResources.includes("function activeModelWithRunOpenAISettings"), true);
  assert.equal(desktopAgentExecution.includes("export async function runOrdinaryDesktopForPanel"), true);
  assert.equal(desktopAgentExecution.includes("runDesktopAgentSession"), true);
  assert.equal(undergroundCompatExecution.includes("export async function runDeepDesktopForPanel"), true);
  assert.equal(undergroundCompatExecution.includes("export async function runUndergroundForPanel"), true);
  assert.equal(undergroundCompatExecution.includes("runUndergroundDirectionSessionWithIntelligence"), true);
  assert.equal(undergroundCompatExecution.includes("createUndergroundDeepCanvas"), true);
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
  for (const privateRunResponseDetail of ["function routeReadModel", "createPanelTranscriptNodes"]) {
    assert.equal(requestHandler.includes(privateRunResponseDetail), false);
    assert.equal(runJobResponse.includes(privateRunResponseDetail), true);
  }
  for (const privateRuntimeDetail of [
    "function assemblePanelRuntime",
    "function resolveSkillRoots",
    "function createPanelRuntimePersistence",
    "new BasicAgentRunExecutor",
  ]) {
    assert.equal(requestHandler.includes(privateRuntimeDetail), false);
    assert.equal(panelRuntime.includes(privateRuntimeDetail), true);
  }
  for (const privateSkillDetail of ["discoverSkills", "loadSkillBody", "selectTriggeredSkills"]) {
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
    "function latestModelFailureMessage",
  ]) {
    assert.equal(requestHandler.includes(privateRunExecutionDetail), false);
    assert.equal(runExecution.includes(privateRunExecutionDetail), true);
  }
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
    "function activeModelWithRunOpenAISettings",
  ]) {
    assert.equal(runExecution.includes(movedDesktopResourceDetail), false);
    assert.equal(desktopRunResources.includes(movedDesktopResourceDetail), true);
  }
  for (const ordinaryDesktopDetail of ["runDesktopAgentSession", "function desktopPanelResultFromAgent"]) {
    assert.equal(runExecution.includes(ordinaryDesktopDetail), false);
    assert.equal(desktopAgentExecution.includes(ordinaryDesktopDetail), true);
  }
});
