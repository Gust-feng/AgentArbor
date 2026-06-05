import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readAppSource } from "./panel-structure-test-utils.js";

test("basic agent work session keeps projection modules split", async () => {
  const [workSession, transcriptProjection, transcriptTools, contextProjection] = await Promise.all([
    readAppSource(path.join("basic-agent-runtime", "work-session.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-session-transcript.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-session-transcript-tools.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-session-context.ts")),
  ]);

  assert.equal(workSession.includes('from "./work-session-transcript.js"'), true);
  assert.equal(workSession.includes('from "./work-session-context.js"'), true);
  assert.equal(workSession.includes("transcriptNodesFromRunEvents(transcriptSourceEvents(input.events), pendingConfirmation)"), true);
  assert.equal(workSession.includes("function transcriptNodesFromRunEvents"), false);
  assert.equal(workSession.includes("function transcriptNodeFromRunEvent"), false);
  assert.equal(workSession.includes("updatePendingReasoningNode"), false);
  assert.equal(workSession.includes("function contextLedgerFor"), false);
  assert.equal(workSession.includes("function contextAttachmentsFor"), false);
  assert.equal(workSession.includes("function envelopeSafeToolEvidence"), false);
  assert.equal(workSession.includes("function taskSoilContextAttachments"), false);
  assert.equal(transcriptProjection.includes("export function transcriptNodesFromRunEvents"), true);
  assert.equal(transcriptProjection.includes("function transcriptNodeFromRunEvent"), true);
  assert.equal(transcriptProjection.includes("updatePendingReasoningNode"), true);
  assert.equal(transcriptProjection.includes('from "./work-session-transcript-tools.js"'), true);
  assert.equal(transcriptProjection.includes("function toolTranscriptTitleFromRunEvent"), false);
  assert.equal(transcriptProjection.includes("function transcriptToolSummaryFromRunEvent"), false);
  assert.equal(transcriptProjection.includes("function fileDisplaySummary"), false);
  assert.equal(transcriptTools.includes("export function toolTranscriptTitleFromRunEvent"), true);
  assert.equal(transcriptTools.includes("export function transcriptToolSummaryFromRunEvent"), true);
  assert.equal(transcriptTools.includes("function fileDisplaySummary"), true);
  assert.equal(contextProjection.includes("export function contextAttachmentsFor"), true);
  assert.equal(contextProjection.includes("export function contextLedgerFor"), true);
  assert.equal(contextProjection.includes("export function envelopeSafeToolEvidence"), true);
  assert.equal(contextProjection.includes("function taskSoilContextAttachments"), true);
});

test("desktop agent session keeps projection and contracts split", async () => {
  const [session, contracts, sharedContracts, projection, runtime, events, definition] = await Promise.all([
    readAppSource("desktop-agent-session.ts"),
    readAppSource("desktop-agent-session-contracts.ts"),
    readAppSource("desktop-agent-contracts.ts"),
    readAppSource("desktop-agent-session-projection.ts"),
    readAppSource("desktop-agent-session-runtime.ts"),
    readAppSource("desktop-agent-session-events.ts"),
    readAppSource(path.join("agent-prompts", "desktop-root-agent.ts")),
  ]);

  assert.equal(session.includes('from "./desktop-agent-session-contracts.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-projection.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-runtime.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-events.js"'), true);
  assert.equal(session.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(session.includes("export async function runDesktopAgentSession"), true);
  assert.equal(session.includes("function desktopAgentResultFromTurn"), true);
  assert.equal(session.includes("function parseAnswer"), false);
  assert.equal(session.includes("function pendingConfirmationFrom"), false);
  assert.equal(session.includes("function resultBlocksFrom"), false);
  assert.equal(session.includes("function activityFromEventEntries"), false);
  assert.equal(session.includes("function activityFromEventEntry"), false);
  assert.equal(session.includes("function toolActivityTitle"), false);
  assert.equal(session.includes("function safeDesktopAgentContextPack"), false);
  assert.equal(session.includes("function createIntelligenceChannelFromOptions"), false);
  assert.equal(session.includes("function desktopAgentOutputContract"), false);
  assert.equal(session.includes("function publishGoalReceived"), false);
  assert.equal(session.includes("function publishConfirmationRequested"), false);
  assert.equal(session.includes("function publishTriggeredSkills"), false);
  assert.equal(session.includes("function allowedToolsForDesktopAgent"), false);
  assert.equal(session.includes("function allowedToolsForRun"), false);
  assert.equal(session.includes("function constraintRefsFromTaskSoil"), false);
  assert.equal(session.includes("new AgentTurnRuntime"), false);
  assert.equal(contracts.includes("export type DesktopAgentSessionResult"), true);
  assert.equal(contracts.includes("export type RunDesktopAgentSessionOptions"), true);
  assert.equal(contracts.includes("export type { DesktopAgentConversationMessage, DesktopAgentSkillContext }"), true);
  assert.equal(sharedContracts.includes("export type DesktopAgentConversationMessage"), true);
  assert.equal(sharedContracts.includes("export type DesktopAgentSkillContext"), true);
  assert.equal(projection.includes("export function safeDesktopAgentContextPack"), true);
  assert.equal(projection.includes("export function parseAnswer"), true);
  assert.equal(projection.includes("export function pendingConfirmationFrom"), true);
  assert.equal(projection.includes("export function resultBlocksFrom"), true);
  assert.equal(projection.includes("export function activityFromEventEntries"), true);
  assert.equal(projection.includes("function activityFromEventEntry"), true);
  assert.equal(projection.includes("function toolActivityTitle"), true);
  assert.equal(runtime.includes('from "./desktop-agent-session-events.js"'), true);
  assert.equal(runtime.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(runtime.includes('from "./agent-prompts/contracts.js"'), true);
  assert.equal(runtime.includes("export function createIntelligenceChannelFromOptions"), true);
  assert.equal(runtime.includes("export function createDesktopAgentOutputContract"), true);
  assert.equal(runtime.includes("export function createDesktopAgentTurnRuntime"), true);
  assert.equal(runtime.includes("new AgentTurnRuntime"), true);
  assert.equal(runtime.includes("export function allowedToolsForRun"), true);
  assert.equal(runtime.includes("export function constraintRefsFromTaskSoil"), true);
  assert.equal(events.includes('from "./desktop-agent-session-runtime.js"'), false);
  assert.equal(events.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(events.includes("export function publishGoalReceived"), true);
  assert.equal(events.includes("export function publishConfirmationRequested"), true);
  assert.equal(events.includes("export function publishTriggeredSkills"), true);
  assert.equal(events.includes("export function publishContextCompactionCompleted"), true);
  assert.equal(events.includes("export function publishContextCompactionFailed"), true);
  assert.equal(definition.includes("export const DESKTOP_ROOT_AGENT: AgentDefinition ="), true);
  assert.equal(definition.includes('export const DESKTOP_AGENT_ID = "desktop-agent-session"'), true);
  assert.equal(definition.includes("agentId: DESKTOP_AGENT_ID"), true);
  assert.equal(definition.includes("toolVisibilityProfile"), true);
  assert.equal(definition.includes("outputContract"), true);
  assert.equal(definition.includes("turnPolicy"), true);
});

test("panel canvas keeps ordinary desktop agent projection split", async () => {
  const [canvas, desktopCanvas, canvasCommon, agentRunTreeView, transcriptContracts, trackingContracts, desktopAgentExecution] = await Promise.all([
    readAppSource("panel-canvas-read-model.ts"),
    readAppSource("panel-desktop-agent-canvas.ts"),
    readAppSource("panel-canvas-common.ts"),
    readAppSource("panel-agent-run-tree-view.ts"),
    readAppSource("panel-run-transcript-contracts.ts"),
    readAppSource("panel-run-tracking-contracts.ts"),
    readAppSource(path.join("panel-server", "desktop-agent-execution.ts")),
  ]);

  assert.equal(canvas.includes('from "./panel-desktop-agent-canvas.js"'), true);
  assert.equal(canvas.includes('from "./panel-canvas-common.js"'), true);
  assert.equal(canvas.includes("export function createDesktopAgentCanvas"), false);
  assert.equal(canvas.includes("export type DesktopAgentCanvasReadModel"), false);
  assert.equal(canvas.includes("function taskSoilCanvas"), false);
  assert.equal(canvas.includes("function safeText"), false);
  assert.equal(canvas.includes("export type SafeAgentRunTreeView ="), false);
  assert.equal(canvas.includes("export function createSafeAgentRunTreeView"), false);
  assert.equal(canvas.includes('from "./panel-run-read-model.js"'), false);
  assert.equal(desktopCanvas.includes("export type DesktopAgentCanvasReadModel"), true);
  assert.equal(desktopCanvas.includes("export function createDesktopAgentCanvas"), true);
  assert.equal(desktopCanvas.includes('from "./panel-canvas-common.js"'), true);
  assert.equal(desktopCanvas.includes('from "./panel-run-read-model.js"'), false);
  assert.equal(canvasCommon.includes("export function taskSoilCanvas"), true);
  assert.equal(canvasCommon.includes("export function safeText"), true);
  assert.equal(agentRunTreeView.includes("export type SafeAgentRunTreeView"), true);
  assert.equal(agentRunTreeView.includes("export function createSafeAgentRunTreeView"), true);
  assert.equal(transcriptContracts.includes("export type PanelRunTranscript"), true);
  assert.equal(trackingContracts.includes("export type PanelObservationReadModel"), true);
  assert.equal(desktopAgentExecution.includes('from "../panel-desktop-agent-canvas.js"'), true);
  assert.equal(desktopAgentExecution.includes('from "../panel-canvas-read-model.js"'), false);
});

test("panel run read model stays a compatibility facade", async () => {
  const [readModel, transcript, steps] = await Promise.all([
    readAppSource("panel-run-read-model.ts"),
    readAppSource("panel-run-transcript.ts"),
    readAppSource("panel-run-steps.ts"),
  ]);

  assert.equal(readModel.includes("export { createPanelRunTranscript }"), true);
  assert.equal(readModel.includes("export { deriveRunSteps }"), true);
  assert.equal(readModel.includes("function createPanelRunTranscript"), false);
  assert.equal(readModel.includes("function deriveRunSteps"), false);
  assert.equal(readModel.includes("createPanelWorkNotes("), false);
  assert.equal(transcript.includes("export function createPanelRunTranscript"), true);
  assert.equal(transcript.includes("createPanelWorkNotes("), true);
  assert.equal(steps.includes("export function deriveRunSteps"), true);
});

test("cognitive work session keeps helpers split by runtime concern", async () => {
  const [session, contracts, modelIo, fabric, result, runProjection, runtime, safe] = await Promise.all([
    readAppSource("cognitive-work-session.ts"),
    readAppSource("cognitive-work-session-contracts.ts"),
    readAppSource("cognitive-work-session-model-io.ts"),
    readAppSource("cognitive-work-session-fabric.ts"),
    readAppSource("cognitive-work-session-result.ts"),
    readAppSource("cognitive-work-session-run-projection.ts"),
    readAppSource("cognitive-work-session-runtime.ts"),
    readAppSource("cognitive-work-session-safe.ts"),
  ]);

  assert.equal(session.includes('from "./cognitive-work-session-contracts.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-model-io.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-fabric.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-result.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-run-projection.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-runtime.js"'), true);
  assert.equal(session.includes('from "./cognitive-work-session-safe.js"'), true);
  assert.equal(session.includes("function managerDecisionMessages"), false);
  assert.equal(session.includes("function directAnswerMessages"), false);
  assert.equal(session.includes("function childMaterialMessages"), false);
  assert.equal(session.includes("function synthesisMessages"), false);
  assert.equal(session.includes("function decisionOutputContract"), false);
  assert.equal(session.includes("function directAnswerOutputContract"), false);
  assert.equal(session.includes("function childMaterialOutputContract"), false);
  assert.equal(session.includes("function synthesisOutputContract"), false);
  assert.equal(session.includes("function parseDecision"), false);
  assert.equal(session.includes("function parseDirectAnswer"), false);
  assert.equal(session.includes("function parseChildMaterial"), false);
  assert.equal(session.includes("function parseSynthesis"), false);
  assert.equal(session.includes("function createManagerSpec"), false);
  assert.equal(session.includes("function createPlannedChildren"), false);
  assert.equal(session.includes("function createChildSpec"), false);
  assert.equal(session.includes("function createDelegationDecision"), false);
  assert.equal(session.includes("function createParentSynthesis"), false);
  assert.equal(session.includes("function publishGoalReceived"), false);
  assert.equal(session.includes("function publishFinalArtifact"), false);
  assert.equal(session.includes("function renderReport"), false);
  assert.equal(session.includes("function baseInputRefs"), false);
  assert.equal(session.includes("function refsFromTurn"), false);
  assert.equal(session.includes("function createStepRecord"), false);
  assert.equal(session.includes("function evidenceRefsFromToolCalls"), false);
  assert.equal(session.includes("function modelCallRefsFromEvents"), false);
  assert.equal(session.includes("function toolCallRefsFromEvents"), false);
  assert.equal(session.includes("function createIntelligenceChannelFromOptions"), false);
  assert.equal(session.includes("function executeRequiredTurn"), false);
  assert.equal(session.includes("new AgentTurnRuntime"), false);
  assert.equal(contracts.includes("export type CognitiveWorkSessionResult"), true);
  assert.equal(contracts.includes("export type WorkSessionDecision"), true);
  assert.equal(contracts.includes("export const WORK_SESSION_ALLOWED_TOOLS"), true);
  assert.equal(modelIo.includes("export function managerDecisionMessages"), true);
  assert.equal(modelIo.includes("export function decisionOutputContract"), true);
  assert.equal(modelIo.includes("export function parseDecision"), true);
  assert.equal(fabric.includes("export function createManagerSpec"), true);
  assert.equal(fabric.includes("export function createParentSynthesis"), true);
  assert.equal(result.includes("export function publishGoalReceived"), true);
  assert.equal(result.includes("export function renderReport"), true);
  assert.equal(runProjection.includes("export function createStepRecord"), true);
  assert.equal(runProjection.includes("export function evidenceRefsFromToolCalls"), true);
  assert.equal(runProjection.includes("export function modelCallRefsFromEvents"), true);
  assert.equal(runtime.includes("export function createIntelligenceChannelFromOptions"), true);
  assert.equal(runtime.includes("export function createWorkSessionTurnRuntime"), true);
  assert.equal(runtime.includes("export async function executeRequiredTurn"), true);
  assert.equal(safe.includes("export function safeText"), true);
  assert.equal(safe.includes("export function unique"), true);
});
