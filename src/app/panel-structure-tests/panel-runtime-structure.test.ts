import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAppSource } from "./panel-structure-test-utils.js";

test("basic agent work view keeps projection modules split", async () => {
  const [workView, transcriptProjection, transcriptTools, contextProjection, workSessionCompat] = await Promise.all([
    readAppSource(path.join("basic-agent-runtime", "work-view.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-view-transcript.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-view-transcript-tools.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-view-context.ts")),
    readAppSource(path.join("basic-agent-runtime", "work-session.ts")),
  ]);

  assert.equal(workView.includes('from "./work-view-transcript.js"'), true);
  assert.equal(workView.includes('from "./work-view-context.js"'), true);
  assert.equal(workView.includes("export function createDesktopWorkViewReadModel"), true);
  assert.equal(workView.includes("createDesktopWorkSessionReadModel"), false);
  assert.equal(workView.includes("CreateDesktopWorkSessionReadModelInput"), false);
  assert.equal(workView.includes("DesktopWorkSessionCanvasLike"), false);
  assert.equal(workView.includes("visibleWorkSessionEvents"), false);
  assert.equal(workView.includes("isProductWorkSessionEvent"), false);
  assert.equal(workView.includes("type LegacyWorkSessionCanvasLike"), true);
  assert.equal(workView.includes("canvas.workSession"), false);
  assert.equal(workView.includes("legacyWorkSessionCanvasFor"), true);
  assert.equal(workView.includes("transcriptNodesFromRunEvents(transcriptSourceEvents(input.events), pendingConfirmation)"), true);
  assert.equal(workView.includes("function transcriptNodesFromRunEvents"), false);
  assert.equal(workView.includes("function transcriptNodeFromRunEvent"), false);
  assert.equal(workView.includes("updatePendingReasoningNode"), false);
  assert.equal(workView.includes("function contextLedgerFor"), false);
  assert.equal(workView.includes("function contextAttachmentsFor"), false);
  assert.equal(workView.includes("function envelopeSafeToolEvidence"), false);
  assert.equal(workView.includes("function taskSoilContextAttachments"), false);
  assert.equal(transcriptProjection.includes("export function transcriptNodesFromRunEvents"), true);
  assert.equal(transcriptProjection.includes("function transcriptNodeFromRunEvent"), true);
  assert.equal(transcriptProjection.includes("updatePendingReasoningNode"), true);
  assert.equal(transcriptProjection.includes('from "./work-view-transcript-tools.js"'), true);
  assert.equal(transcriptProjection.includes("function toolTranscriptTitleFromRunEvent"), false);
  assert.equal(transcriptProjection.includes("function transcriptToolSummaryFromRunEvent"), false);
  assert.equal(transcriptProjection.includes("function fileDisplaySummary"), false);
  assert.equal(transcriptTools.includes("export function toolTranscriptTitleFromRunEvent"), true);
  assert.equal(transcriptTools.includes("export function transcriptToolSummaryFromRunEvent"), true);
  assert.equal(transcriptTools.includes("function fileDisplaySummary"), true);
  assert.equal(contextProjection.includes("export function contextAttachmentsFor"), true);
  assert.equal(contextProjection.includes("export function contextLedgerFor"), true);
  assert.equal(contextProjection.includes("export function envelopeSafeToolEvidence"), true);
  assert.equal(contextProjection.includes("export type WorkViewContextProjectionInput"), true);
  assert.equal(contextProjection.includes("WorkSessionContextProjectionInput"), false);
  assert.equal(contextProjection.includes("function taskSoilContextAttachments"), true);
  assert.equal(contextProjection.includes("function taskSoilCanvasForWorkViewContext"), true);
  assert.equal(contextProjection.includes("function legacyWorkSessionTaskSoilCanvasFor"), true);
  assert.equal(contextProjection.includes('canvas?.kind === "desktop_agent_canvas" || canvas?.kind === "work_session_canvas"'), false);
  assert.equal(workSessionCompat.includes('from "./work-view.js"'), true);
  assert.equal(workSessionCompat.includes("createDesktopWorkSessionReadModel"), true);
  assert.equal(workSessionCompat.includes("export function createDesktopWorkViewReadModel"), false);
});

test("desktop agent session keeps projection and contracts split", async () => {
  const [
    session,
    contracts,
    sharedContracts,
    projection,
    runtime,
    loopPreparation,
    runToolBoundary,
    events,
    registry,
    definitionRef,
    definitionRuntime,
    agentDefinitionContracts,
    identityAsset,
    definition,
    promptAsset,
    turnPolicyAsset,
    outputContractAsset,
    toolVisibilityAsset,
  ] = await Promise.all([
    readAppSource("desktop-agent-session.ts"),
    readAppSource("desktop-agent-session-contracts.ts"),
    readAppSource("desktop-agent-contracts.ts"),
    readAppSource("desktop-agent-session-projection.ts"),
    readAppSource("desktop-agent-session-runtime.ts"),
    readAppSource("desktop-agent-loop-preparation.ts"),
    readAppSource("run-tool-boundary.ts"),
    readAppSource("desktop-agent-session-events.ts"),
    readAppSource(path.join("agent-definitions", "agent-definition-registry.ts")),
    readAppSource(path.join("agent-definitions", "agent-definition-ref.ts")),
    readAppSource(path.join("agent-definitions", "agent-definition-runtime.ts")),
    readAppSource(path.join("agent-prompts", "contracts.ts")),
    readAppSource(path.join("agent-prompts", "desktop-agent-identity.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent-prompt.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent-turn-policy.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent-output-contract.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent-tool-visibility.ts")),
  ]);

  assert.equal(session.includes('from "./desktop-agent-session-contracts.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-projection.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-runtime.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-loop-preparation.js"'), true);
  assert.equal(session.includes('from "./desktop-agent-session-events.js"'), true);
  assert.equal(session.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(session.includes("const agentDefinition = options.agentDefinition ?? DESKTOP_ROOT_AGENT"), true);
  assert.equal(session.includes("const aiMode = resolveDesktopAgentAiMode(options)"), true);
  assert.equal(session.includes('options.aiMode ?? "openai-responses"'), false);
  assert.equal(session.includes("const loop = prepareDesktopAgentLoop({"), true);
  assert.equal(session.includes("const modelCapabilitiesForRun = modelCapabilitiesForDesktopRun(aiMode, options)"), false);
  assert.equal(session.includes("modelCapabilitiesForRun?.supportsToolCalling !== false"), false);
  assert.equal(session.includes("options.capabilitySnapshot?.modelCapabilities ?? options.modelCapabilities"), false);
  assert.equal(session.includes("options.modelCapabilities ?? options.capabilitySnapshot?.modelCapabilities"), false);
  assert.equal(session.includes("agentId: agentDefinition.agentId"), true);
  assert.equal(session.includes("agentDisplayName: agentDefinition.displayName"), false);
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
  assert.equal(session.includes("function createDesktopAgentTurnPolicy"), false);
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
  assert.equal(projection.includes("当前任务的系统指令。"), true);
  assert.equal(projection.includes("桌面基础 Agent 系统边界。"), false);
  assert.equal(runtime.includes('from "./desktop-agent-session-events.js"'), true);
  assert.equal(runtime.includes('from "./agent-prompts/desktop-root-agent.js"'), true);
  assert.equal(runtime.includes('from "./agent-definition-runtime.js"'), true);
  assert.equal(runtime.includes('from "./agent-prompts/contracts.js"'), false);
  assert.equal(runtime.includes("export function createIntelligenceChannelFromOptions"), true);
  assert.equal(runtime.includes("export function resolveDesktopAgentAiMode"), true);
  assert.equal(runtime.includes('options.aiMode ?? options.capabilitySnapshot?.activeModel.defaultAiMode ?? "openai-responses"'), true);
  assert.equal(runtime.includes("options.capabilitySnapshot?.activeModel.model ??"), true);
  assert.equal(runtime.includes("export function createDesktopAgentOutputContract"), false);
  assert.equal(runtime.includes("export function createDesktopAgentTurnPolicy"), true);
  assert.equal(runtime.includes("createAgentTurnPolicyFromDefinition({"), true);
  assert.equal(runtime.includes("resolveAgentRunCapabilities({"), false);
  assert.equal(runtime.includes("input.agentDefinition ?? DESKTOP_ROOT_AGENT"), true);
  assert.equal(runtime.includes("DESKTOP_ROOT_AGENT.turnPolicy.allowModel"), false);
  assert.equal(runtime.includes("DESKTOP_ROOT_AGENT.outputContract"), false);
  assert.equal(runtime.includes("export function createDesktopAgentTurnRuntime"), true);
  assert.equal(runtime.includes("readonly agentId: string"), true);
  assert.equal(runtime.includes("readonly agentDisplayName: string"), true);
  assert.equal(runtime.includes("agentId: input.agentId"), true);
  assert.equal(runtime.includes("displayName: input.agentDisplayName"), true);
  assert.equal(runtime.includes("new AgentTurnRuntime"), true);
  assert.equal(runtime.includes("export function allowedToolsForRun"), false);
  assert.equal(runtime.includes("export function constraintRefsFromTaskSoil"), true);
  assert.equal(loopPreparation.includes('from "./desktop-agent-session-runtime.js"'), true);
  assert.equal(loopPreparation.includes("export function prepareDesktopAgentLoop"), true);
  assert.equal(loopPreparation.includes("export function modelCapabilitiesForDesktopRun"), true);
  assert.equal(loopPreparation.includes("const modelCapabilities = modelCapabilitiesForDesktopRun(input.aiMode, input.options)"), true);
  assert.equal(loopPreparation.includes("modelCapabilities?.supportsToolCalling !== false"), false);
  assert.equal(loopPreparation.includes("(capabilityPlan?.canExposeModelTools ?? modelCapabilities?.supportsToolCalling) !== false"), true);
  assert.equal(loopPreparation.includes('aiMode === "fake" || modelCapabilities?.supportsToolCalling !== false'), false);
  assert.equal(loopPreparation.includes("options.capabilitySnapshot?.modelCapabilities ?? options.modelCapabilities"), true);
  assert.equal(loopPreparation.includes("options.modelCapabilities ?? options.capabilitySnapshot?.modelCapabilities"), false);
  assert.equal(loopPreparation.includes("options.capabilitySnapshot !== undefined ||"), true);
  assert.equal(loopPreparation.includes("agentId: input.agentDefinition.agentId"), true);
  assert.equal(loopPreparation.includes("agentDisplayName: input.agentDefinition.displayName"), true);
  assert.equal(loopPreparation.includes("resolveDesktopAgentRunCapabilities({"), false);
  assert.equal(loopPreparation.includes("restrictRunCapabilityResolutionToExecutableTools("), false);
  assert.equal(loopPreparation.includes("resolveRunToolBoundary({"), true);
  assert.equal(loopPreparation.includes("createDesktopAgentTurnPolicy({"), true);
  assert.equal(runToolBoundary.includes("export function resolveRunToolBoundary"), true);
  assert.equal(runToolBoundary.includes("export function restrictRunCapabilityResolutionToExecutableTools"), true);
  assert.equal(runToolBoundary.includes('from "./capability-policy.js"'), true);
  assert.equal(registry.includes("export class AgentDefinitionRegistry"), true);
  assert.equal(registry.includes("runAgentDefinitionRef(definition)"), true);
  assert.equal(registry.includes("resolve(ref: RunAgentDefinitionRef): AgentDefinition | undefined"), true);
  assert.equal(registry.includes("this.definitionsByRef.has(key)"), true);
  assert.equal(registry.includes("Duplicate AgentDefinition run ref"), true);
  assert.equal(registry.includes('from "./agent-prompts/desktop-root-agent.js"'), false);
  assert.equal(definitionRuntime.includes('from "../agent-prompts/contracts.js"'), true);
  assert.equal(definitionRuntime.includes('from "./agent-prompts/desktop-root-agent.js"'), false);
  assert.equal(definitionRuntime.includes('from "./agent-definition-ref.js"'), true);
  assert.equal(definitionRuntime.includes("export function createAgentTurnPolicyFromDefinition"), true);
  assert.equal(definitionRef.includes("export function runAgentDefinitionRef"), true);
  assert.equal(definitionRef.includes("export function agentDefinitionRefMatchesDefinition"), true);
  assert.equal(definitionRef.includes("export function isCompleteRunAgentDefinitionRef"), true);
  assert.equal(definitionRuntime.includes("export function resolveAgentRunCapabilities"), true);
  assert.equal(definitionRuntime.includes("export function allowedToolsForAgentRun"), false);
  assert.equal(definitionRuntime.includes("export function restrictRunCapabilityResolutionToExecutableTools"), false);
  assert.equal(definitionRuntime.includes("maxModelRounds: definition.turnPolicy.maxModelRounds"), true);
  assert.equal(definitionRuntime.includes("maxToolRounds: definition.turnPolicy.maxToolRounds"), true);
  assert.equal(agentDefinitionContracts.includes("export type AgentSystemPromptSpec"), true);
  assert.equal(agentDefinitionContracts.includes("export type AgentTurnPolicySpec"), true);
  assert.equal(agentDefinitionContracts.includes("export type AgentToolVisibilityProfile"), true);
  assert.equal(agentDefinitionContracts.includes("export type AgentDefinition"), true);
  assert.equal(agentDefinitionContracts.includes("readonly defaultMaxOutputTokens: number;"), true);
  assert.equal(agentDefinitionContracts.includes("readonly maxModelRounds?: number;"), true);
  assert.equal(agentDefinitionContracts.includes("readonly maxToolRounds?: number;"), true);
  assert.equal(agentDefinitionContracts.includes("readonly allowedTools"), false);
  assert.equal(events.includes('from "./desktop-agent-session-runtime.js"'), false);
  assert.equal(events.includes('from "./agent-prompts/desktop-agent-identity.js"'), false);
  assert.equal(events.includes('from "./agent-prompts/desktop-root-agent.js"'), false);
  assert.equal(events.includes("readonly agentId: string"), true);
  assert.equal(events.includes('from: { id: input.agentId, role: "agent" }'), true);
  assert.equal(events.includes('from: { id: input.agentId, role: "runtime" }'), true);
  assert.equal(events.includes("export function publishGoalReceived"), true);
  assert.equal(events.includes("export function publishConfirmationRequested"), true);
  assert.equal(events.includes("export function publishTriggeredSkills"), true);
  assert.equal(events.includes("export function publishContextCompactionCompleted"), true);
  assert.equal(events.includes("export function publishContextCompactionFailed"), true);
  assert.equal(definition.includes("export const DESKTOP_ROOT_AGENT: AgentDefinition ="), true);
  assert.equal(definition.includes('from "./desktop-agent-identity.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-prompt.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-turn-policy.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-output-contract.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-tool-visibility.js"'), true);
  assert.equal(identityAsset.includes('export const DESKTOP_AGENT_ID = "desktop-agent-session"'), true);
  assert.equal(definition.includes('export const DESKTOP_AGENT_ID = "desktop-agent-session"'), false);
  assert.equal(definition.includes("agentId: DESKTOP_AGENT_ID"), true);
  assert.equal(definition.includes("toolVisibilityProfile: DESKTOP_ROOT_AGENT_TOOL_VISIBILITY"), true);
  assert.equal(definition.includes("outputContract: DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT"), true);
  assert.equal(definition.includes("turnPolicy: DESKTOP_ROOT_AGENT_TURN_POLICY"), true);
  assert.equal(definition.includes("You are AgentArbor Desktop Agent"), false);
  assert.equal(definition.includes("desktop.agent_response.v1"), false);
  assert.equal(definition.includes("visibleToolScopes"), false);
  assert.equal(definition.includes("defaultMaxOutputTokens"), false);
  assert.equal(promptAsset.includes("export const DESKTOP_ROOT_AGENT_PROMPT"), true);
  assert.equal(promptAsset.includes("You are AgentArbor Desktop Agent"), true);
  assert.equal(promptAsset.includes('promptRef: "prompt:desktop-root-agent:v4"'), true);
  assert.equal(promptAsset.includes('version: "v4"'), true);
  const currentPromptAsset = currentDesktopRootPromptSource(promptAsset);
  assert.equal(currentPromptAsset.includes("You are AgentArbor Desktop Agent."), true);
  assert.equal(currentPromptAsset.includes("Help the user complete the task clearly and accurately."), true);
  assert.equal(currentPromptAsset.includes("Base external factual claims on available evidence"), true);
  assert.equal(currentPromptAsset.includes("Runtime-selected tools and model-native file or image inputs define what you can inspect in this run"), true);
  assert.equal(currentPromptAsset.includes("If the current request already includes user-provided file or image inputs"), true);
  assert.equal(currentPromptAsset.includes("use available attachment tools before saying you cannot read it"), true);
  assert.equal(currentPromptAsset.includes("latest user message"), false);
  assert.equal(currentPromptAsset.includes("active request"), false);
  assert.equal(currentPromptAsset.includes("earlier messages"), false);
  assert.equal(currentPromptAsset.includes("tool results"), false);
  assert.equal(currentPromptAsset.includes("tool descriptions define the tools"), false);
  assert.equal(currentPromptAsset.includes("reasoning controls are provided by the runtime"), false);
  assert.equal(currentPromptAsset.includes("Stay in the ordinary desktop agent path"), false);
  assert.equal(promptAsset.includes("DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V3"), true);
  assert.equal(promptAsset.includes("DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V2"), true);
  assert.equal(promptAsset.includes("DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V1"), true);
  for (const promptBloatTerm of [
    "capable senior collaborator",
    "Use tools when you need",
    "inspect the relevant files",
    "concise reasoning",
    "chain-of-thought",
  ]) {
    assert.equal(currentPromptAsset.includes(promptBloatTerm), false);
  }
  for (const internalProcessTerm of ["deep mode", "Underground", "Aboveground", "Plan", "Handoff", "rootlet", "organization flow"]) {
    assert.equal(promptAsset.includes(internalProcessTerm), false);
  }
  assert.equal(turnPolicyAsset.includes("export const DESKTOP_ROOT_AGENT_TURN_POLICY"), true);
  assert.equal(turnPolicyAsset.includes("DESKTOP_AGENT_DEFAULT_MAX_OUTPUT_TOKENS"), true);
  assert.equal(turnPolicyAsset.includes('purpose: "desktop_agent"'), true);
  assert.equal(turnPolicyAsset.includes("maxModelRounds"), false);
  assert.equal(turnPolicyAsset.includes("maxToolRounds"), false);
  assert.equal(outputContractAsset.includes("export const DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT"), true);
  assert.equal(outputContractAsset.includes('contractId: "desktop.agent_response.v1"'), true);
  assert.equal(toolVisibilityAsset.includes("export const DESKTOP_ROOT_AGENT_TOOL_VISIBILITY"), true);
  assert.equal(toolVisibilityAsset.includes('visibleToolScopes: ["desktop-basic", "workspace", "research", "mcp"]'), true);
  assert.equal(toolVisibilityAsset.includes('hiddenToolScopes: ["underground"]'), true);
  assert.equal(toolVisibilityAsset.includes('"underground", "mcp"'), false);
});

test("ordinary shared model runtime paths use neutral model runtime naming", async () => {
  const directFactoryImport = "./f" + "actory.js";
  const [
    panelRunJobs,
    panelRunTracking,
    panelRunTrackingContracts,
    taskSoilWorkspace,
    modelProviderCommon,
    modelProviderProfiles,
    modelRuntimeFactoryTest,
    modelRuntimeFactory,
    modelRuntimeFacade,
    undergroundAiRuntime,
    configContracts,
  ] = await Promise.all([
    readAppSource(path.join("panel-server", "run-jobs.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking-contracts.ts")),
    readAppSource(path.join("task-soil", "task-soil-workspace.ts")),
    readAppSource(path.join("config-center", "model-provider-common.ts")),
    readAppSource(path.join("config-center", "model-provider-profile-settings.ts")),
    readAppSource(path.join("model-runtime", "factory.test.ts")),
    readAppSource(path.join("model-runtime", "factory.ts")),
    readAppSource(path.join("model-runtime", "index.ts")),
    readAppSource("underground-ai-runtime.ts"),
    fs.readFile(path.join(process.cwd(), "src", "domain", "config", "contracts.ts"), "utf8"),
  ]);

  for (const source of [
    panelRunJobs,
    panelRunTracking,
    panelRunTrackingContracts,
    taskSoilWorkspace,
  ]) {
    assert.equal(source.includes("UndergroundAiMode"), false);
    assert.equal(source.includes("ModelRuntimeMode"), true);
    assert.equal(source.includes("model-runtime/index.js"), true);
    assert.equal(source.includes(directFactoryImport), false);
  }
  for (const source of [modelProviderCommon, modelProviderProfiles, configContracts]) {
    assert.equal(source.includes("ConfiguredUndergroundAiMode"), false);
    assert.equal(source.includes("ConfiguredModelRuntimeMode"), true);
  }
  assert.equal(modelRuntimeFactoryTest.includes('from "./index.js"'), true);
  assert.equal(modelRuntimeFactoryTest.includes(directFactoryImport), false);
  assert.equal(modelRuntimeFactoryTest.includes("createModelRuntimeConfig"), true);
  assert.equal(modelRuntimeFactoryTest.includes("ModelRuntimeConfigurationError"), true);
  assert.equal(modelRuntimeFactoryTest.includes("createUndergroundAiRuntimeConfig"), false);
  assert.equal(modelRuntimeFactoryTest.includes("UndergroundAiConfigurationError"), false);
  assert.equal(modelRuntimeFactory.includes(directFactoryImport), false);
  assert.equal(modelRuntimeFactory.includes("underground-demo-summary.js"), false);
  assert.equal(modelRuntimeFactory.includes("UndergroundDemoAiInput"), false);
  assert.equal(modelRuntimeFactory.includes("ModelRuntimeSummaryInput"), true);
  assert.equal(modelRuntimeFacade.includes(directFactoryImport), true);
  assert.equal(modelRuntimeFacade.includes("ModelRuntimeSummaryInput"), true);
  for (const source of [modelRuntimeFactory, modelRuntimeFacade]) {
    assert.equal(source.includes("UndergroundAiMode"), false);
    assert.equal(source.includes("UndergroundAiEnvironment"), false);
    assert.equal(source.includes("UndergroundAiProviderFetch"), false);
    assert.equal(source.includes("UndergroundAiRuntimeConfig"), false);
    assert.equal(source.includes("UndergroundAiConfigurationIssueCode"), false);
    assert.equal(source.includes("UndergroundAiConfigurationError"), false);
    assert.equal(source.includes("createUndergroundAiRuntimeConfig"), false);
    assert.equal(source.includes("createUndergroundAiDisabledConfigurationError"), false);
  }
  assert.equal(undergroundAiRuntime.includes("from \"./model-runtime/index.js\""), true);
  assert.equal(undergroundAiRuntime.includes("createUndergroundAiRuntimeConfig"), true);
  assert.equal(undergroundAiRuntime.includes("UndergroundAiMode"), true);

  const directFactoryImportUsers = (await readAppTypeScriptSources())
    .filter(({ source }) => source.includes(directFactoryImport))
    .map(({ relativePath }) => relativePath)
    .sort();
  assert.deepEqual(directFactoryImportUsers, ["model-runtime/index.ts"]);
});

test("shared panel run orchestration uses neutral run mode naming", async () => {
  const [runModePolicy, panelRunJobs, requestParsers, runModeRouting, runExecution, runJobResponse] = await Promise.all([
    readAppSource("run-mode-policy.ts"),
    readAppSource(path.join("panel-server", "run-jobs.ts")),
    readAppSource(path.join("panel-server", "request-parsers.ts")),
    readAppSource(path.join("panel-server", "run-mode-routing.ts")),
    readAppSource(path.join("panel-server", "run-execution.ts")),
    readAppSource(path.join("panel-server", "run-job-response.ts")),
  ]);

  assert.equal(runModePolicy.includes('export type AgentArborRunMode = "agent" | "deep"'), true);
  assert.equal(runModePolicy.includes('export type AgentArborRunKind = "desktop" | "underground"'), true);
  assert.equal(runModePolicy.includes("export function resolveRunModeForKind"), true);
  assert.equal(runModePolicy.includes("export function assertRunModeForKind"), true);
  assert.equal(panelRunJobs.includes("export type PanelRunMode = AgentArborRunMode"), true);
  assert.equal(panelRunJobs.includes("export type PanelRunKind = AgentArborRunKind"), true);
  assert.equal(panelRunJobs.includes("resolveRunModeForKind(runKind, runMode)"), true);

  for (const source of [panelRunJobs, requestParsers, runExecution, runJobResponse]) {
    assert.equal(source.includes("PanelRunMode"), true);
    assert.equal(source.includes("PanelDesktopRunMode"), false);
    assert.equal(source.includes("parseOptionalDesktopRunMode"), false);
  }
  assert.equal(requestParsers.includes("function parseOptionalRunMode"), true);
  assert.equal(requestParsers.includes("resolveEffectiveRunMode"), false);
  assert.equal(runModeRouting.includes("export function resolvePanelRouteRunMode"), true);
  assert.equal(runModeRouting.includes("resolveRunModeForKind(input.runKind, input.requestedRunMode)"), true);
  assert.equal(runModeRouting.includes("PanelHttpError"), true);
  assert.equal(runExecution.includes("assertRunModeForKind(runKind, runMode)"), true);
  assert.equal(runExecution.includes("RunModePolicyError"), true);
});

test("shared run summary types use app-level contracts before panel aliases", async () => {
  const [summaryContract, panelSummaryFacade, undergroundSummary] = await Promise.all([
    readAppSource("run-summary.ts"),
    readAppSource("panel-run-summary.ts"),
    readAppSource("underground-demo-summary.ts"),
  ]);
  const basicAgentRunSummarySources = await Promise.all([
    readAppSource(path.join("basic-agent-runtime", "contracts.ts")),
    readAppSource(path.join("basic-agent-runtime", "run-job.ts")),
  ]);
  const panelRunSummarySources = await Promise.all([
    readAppSource(path.join("panel-server", "run-jobs.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking-contracts.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-stream-events.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-stream-copy.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-transcript-contracts.ts")),
    readAppSource(path.join("panel-read-model", "transcript", "panel-transcript-model-calls.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-work-note-contracts.ts")),
    readAppSource(path.join("panel-server", "run-execution-contracts.ts")),
    readAppSource(path.join("panel-server", "run-execution.ts")),
    readAppSource(path.join("panel-server", "run-job-response.ts")),
  ]);

  assert.equal(summaryContract.includes("underground-demo-summary.js"), false);
  assert.equal(summaryContract.includes("export type RunSummary = {"), true);
  assert.equal(summaryContract.includes("export type RunSummaryAiInput = ModelRuntimeSummaryInput"), true);
  assert.equal(summaryContract.includes("export type RunSummaryPayload"), true);
  assert.equal(panelSummaryFacade.includes("underground-demo-summary.js"), false);
  assert.equal(panelSummaryFacade.includes('from "./run-summary.js"'), true);
  assert.equal(panelSummaryFacade.includes("export type PanelRunSummary = RunSummary"), true);
  assert.equal(panelSummaryFacade.includes("export type PanelRunSummaryPayload = RunSummaryPayload"), true);
  assert.equal(undergroundSummary.includes('from "./run-summary.js"'), true);
  assert.equal(undergroundSummary.includes("export type UndergroundDemoSummary = RunSummary"), true);
  assert.equal(undergroundSummary.includes("export type UndergroundDemoAiInput = RunSummaryAiInput"), true);
  for (const source of basicAgentRunSummarySources) {
    assert.equal(source.includes("underground-demo-summary.js"), false);
    assert.equal(source.includes("UndergroundDemoSummary"), false);
    assert.equal(source.includes("PanelRunSummary"), false);
    assert.equal(source.includes("panel-run-summary.js"), false);
    assert.equal(source.includes("RunSummary"), true);
    assert.equal(source.includes("run-summary.js"), true);
  }
  for (const source of panelRunSummarySources) {
    assert.equal(source.includes("underground-demo-summary.js"), false);
    assert.equal(source.includes("UndergroundDemoSummary"), false);
    assert.equal(source.includes("PanelRunSummary"), true);
    assert.equal(source.includes("panel-run-summary.js"), true);
  }
});

test("shared run shell layers stay centralized instead of diverging per mode", async () => {
  const [
    snapshotStoreFacade,
    adapterSnapshotStore,
    runtimeDatabase,
    runEnvelope,
    runSummary,
    restoredRunProjection,
    runResponseBase,
    deepReadModel,
    runRoutes,
    persistedRunResponse,
    runJobResponse,
  ] = await Promise.all([
    readAppSource(path.join("run-runtime-core", "snapshot-store.ts")),
    fs.readFile(path.join(process.cwd(), "src", "adapters", "runtime-database", "run-snapshot-store.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "adapters", "runtime-database", "file-system-runtime-database.ts"), "utf8"),
    readAppSource(path.join("run-read-model", "envelope.ts")),
    readAppSource(path.join("run-read-model", "summary.ts")),
    readAppSource(path.join("run-read-model", "restored-run-projection.ts")),
    readAppSource(path.join("panel-server", "run-response-base.ts")),
    readAppSource(path.join("deep", "deep-read-model.ts")),
    readAppSource(path.join("panel-server", "run-routes.ts")),
    readAppSource(path.join("panel-server", "persisted-run-response.ts")),
    readAppSource(path.join("panel-server", "run-job-response.ts")),
  ]);

  assert.equal(snapshotStoreFacade.includes("export interface RunSnapshotStore"), true);
  assert.equal(snapshotStoreFacade.includes("export type RunEnvelope = {"), true);
  assert.equal(snapshotStoreFacade.includes("export function createInMemoryRunSnapshotStore"), true);
  assert.equal(adapterSnapshotStore.includes('from "../../app/run-runtime-core/snapshot-store.js"'), true);
  assert.equal(adapterSnapshotStore.includes("export function createFileSystemRunSnapshotStore"), true);
  assert.equal(adapterSnapshotStore.includes("export function createInMemoryRunSnapshotStore"), false);
  assert.equal(runtimeDatabase.includes("private readonly runRecordStore: RunSnapshotStore<RuntimeRunRecord>"), true);
  assert.equal(runtimeDatabase.includes("createFileSystemRunSnapshotStore<RuntimeRunRecord>"), true);

  assert.equal(runEnvelope.includes("export function projectRunEnvelopeViewBase"), true);
  assert.equal(runEnvelope.includes("export function projectConversationRunEnvelopeViewBase"), true);
  assert.equal(runSummary.includes("export function projectSharedRunSummaryBase"), true);
  assert.equal(runSummary.includes("export function projectSharedConversationRunSummaryBase"), true);
  assert.equal(restoredRunProjection.includes("export function restoredRunResultProjection"), true);
  assert.equal(restoredRunProjection.includes("export function restoredRunTerminalSummary"), true);
  assert.equal(runResponseBase.includes("export function projectPanelRunResponseBase"), true);
  assert.equal(runRoutes.includes("export type RuntimeRunSummaryView = ReturnType<typeof projectRuntimeRunSummary>"), true);
  assert.equal(runRoutes.includes("export type RuntimeRunListResponse = {"), true);

  assert.equal(deepReadModel.includes("projectSharedConversationRunSummaryBase"), true);
  assert.equal(runRoutes.includes("projectSharedRunSummaryBase"), true);
  assert.equal(persistedRunResponse.includes("projectPanelRunResponseBase"), true);
  assert.equal(runJobResponse.includes("projectPanelRunResponseBase"), true);
});

test("panel canvas keeps ordinary desktop agent projection split", async () => {
  const [
    canvasFacade,
    desktopCanvasFacade,
    canvasCommonFacade,
    canvas,
    desktopCanvas,
    canvasCommon,
    agentRunTreeView,
    transcriptContracts,
    trackingContracts,
    desktopAgentExecution,
  ] = await Promise.all([
    readAppSource("panel-canvas-read-model.ts"),
    readAppSource("panel-desktop-agent-canvas.ts"),
    readAppSource("panel-canvas-common.ts"),
    readAppSource(path.join("panel-read-model", "canvas", "panel-canvas-read-model.ts")),
    readAppSource(path.join("panel-read-model", "canvas", "panel-desktop-agent-canvas.ts")),
    readAppSource(path.join("panel-read-model", "canvas", "panel-canvas-common.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-agent-run-tree-view.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-transcript-contracts.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking-contracts.ts")),
    readAppSource(path.join("panel-server", "desktop-agent-execution.ts")),
  ]);

  assert.equal(canvasFacade.trim(), 'export * from "./panel-read-model/canvas/panel-canvas-read-model.js";');
  assert.equal(desktopCanvasFacade.trim(), 'export * from "./panel-read-model/canvas/panel-desktop-agent-canvas.js";');
  assert.equal(canvasCommonFacade.trim(), 'export * from "./panel-read-model/canvas/panel-canvas-common.js";');
  assert.equal(canvas.includes('from "./panel-desktop-agent-canvas.js"'), true);
  assert.equal(canvas.includes('from "./panel-canvas-common.js"'), true);
  assert.equal(canvas.includes("export function createDesktopAgentCanvas"), false);
  assert.equal(canvas.includes("export type DesktopAgentCanvasReadModel"), false);
  assert.equal(canvas.includes("export type LegacyWorkSessionCanvasReadModel"), true);
  assert.equal(canvas.includes("export type WorkSessionCanvasReadModel = LegacyWorkSessionCanvasReadModel"), true);
  assert.equal(canvas.includes("export function createLegacyWorkSessionCanvas"), true);
  assert.equal(canvas.includes("export const createWorkSessionCanvas = createLegacyWorkSessionCanvas"), true);
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
  assert.equal(desktopAgentExecution.includes('from "../panel-read-model/canvas/panel-desktop-agent-canvas.js"'), true);
  assert.equal(desktopAgentExecution.includes('from "../panel-desktop-agent-canvas.js"'), false);
  assert.equal(desktopAgentExecution.includes('from "../panel-canvas-read-model.js"'), false);
});

test("panel run read model stays a compatibility facade", async () => {
  const [readModel, workNotesFacade, transcript, transcriptContracts, streamEvents, steps, workNotes] = await Promise.all([
    readAppSource("panel-run-read-model.ts"),
    readAppSource("panel-work-notes.ts"),
    readAppSource(path.join("panel-read-model", "run", "panel-run-transcript.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-transcript-contracts.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-stream-events.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-steps.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-work-notes.ts")),
  ]);

  assert.equal(readModel.trim(), 'export * from "./panel-read-model/run/index.js";');
  assert.equal(workNotesFacade.trim(), 'export * from "./panel-read-model/run/panel-work-notes.js";');
  assert.equal(readModel.includes("function createPanelRunTranscript"), false);
  assert.equal(readModel.includes("function deriveRunSteps"), false);
  assert.equal(readModel.includes("createPanelWorkNotes("), false);
  assert.equal(transcript.includes("export function createPanelRunTranscript"), true);
  assert.equal(transcript.includes("createPanelWorkNotes("), true);
  assert.equal(transcript.includes("agentDefinitionRef: input.agentDefinitionRef"), true);
  assert.equal(transcriptContracts.includes("RunAgentDefinitionRef"), true);
  assert.equal(transcriptContracts.includes("agentDefinitionRef?"), true);
  assert.equal(streamEvents.includes("RunAgentDefinitionRef"), true);
  assert.equal(streamEvents.includes('readonly agentDefinitionRef?: Pick<RunAgentDefinitionRef, "agentDisplayName">'), true);
  assert.equal(streamEvents.includes("const agentLabel = agentSelfLabel(input.agentDefinitionRef)"), true);
  assert.equal(streamEvents.includes("function agentSelfLabel"), true);
  assert.equal(streamEvents.includes("agentLabel,"), true);
  assert.equal(steps.includes("export function deriveRunSteps"), true);
  assert.equal(workNotes.includes('from "./agent-prompts/desktop-agent-identity.js"'), false);
  assert.equal(workNotes.includes('from "./agent-prompts/desktop-root-agent.js"'), false);
  assert.equal(workNotes.includes("input.agentDefinitionRef?.agentId"), true);
});

test("panel run event helpers stay owned by panel read model run", async () => {
  const [topLevelUtils, runEventUtils, workNotes, tracking] = await Promise.all([
    readAppSource("panel-read-model-utils.ts"),
    readAppSource(path.join("panel-read-model", "run", "panel-run-event-utils.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-work-notes.ts")),
    readAppSource(path.join("panel-read-model", "run", "panel-run-tracking.ts")),
  ]);

  assert.equal(runEventUtils.includes("export function eventRefsFor"), true);
  assert.equal(runEventUtils.includes("export function hasEvent"), true);
  assert.equal(runEventUtils.includes("export function lastRecordedAt"), true);
  assert.equal(topLevelUtils.includes("eventRefsFor"), false);
  assert.equal(topLevelUtils.includes("hasEvent"), false);
  assert.equal(topLevelUtils.includes("lastRecordedAt"), false);
  assert.equal(workNotes.includes('from "./panel-run-event-utils.js"'), true);
  assert.equal(tracking.includes('from "./panel-run-event-utils.js"'), true);
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

test("ordinary desktop runtime does not adopt legacy model purposes", async () => {
  const [
    session,
    runtime,
    loopPreparation,
    runExecution,
    desktopAgentExecution,
    turnPolicyAsset,
    desktopChatFacade,
  ] = await Promise.all([
    readAppSource("desktop-agent-session.ts"),
    readAppSource("desktop-agent-session-runtime.ts"),
    readAppSource("desktop-agent-loop-preparation.ts"),
    readAppSource(path.join("panel-server", "run-execution.ts")),
    readAppSource(path.join("panel-server", "desktop-agent-execution.ts")),
    readAppSource(path.join("agent-prompts", "desktop-root-agent-turn-policy.ts")),
    readAppSource("desktop-chat-session.ts"),
  ]);

  for (const [sourceName, source] of [
    ["desktop-agent-session", session],
    ["desktop-agent-session-runtime", runtime],
    ["desktop-agent-loop-preparation", loopPreparation],
    ["panel run execution", runExecution],
    ["ordinary desktop panel execution", desktopAgentExecution],
    ["desktop root turn policy", turnPolicyAsset],
  ] as const) {
    assert.equal(source.includes('purpose: "desktop_chat"'), false, `${sourceName} must not use desktop_chat as an ordinary purpose`);
    assert.equal(source.includes('purpose: "work_session_'), false, `${sourceName} must not use work_session purposes`);
    assert.equal(source.includes('label: "desktop_chat"'), false, `${sourceName} must not label ordinary model calls as desktop_chat`);
    assert.equal(source.includes('label: "work_session_'), false, `${sourceName} must not label ordinary model calls as work_session`);
  }

  assert.equal(turnPolicyAsset.includes('purpose: "desktop_agent"'), true);
  assert.equal(session.includes('label: "desktop_agent"'), true);
  assert.equal(desktopChatFacade.includes("@deprecated Compatibility exports for older callers"), true);
  assert.equal(desktopChatFacade.includes("runDesktopAgentSession as runDesktopChatSession"), true);
});

type AppTypeScriptSource = {
  readonly relativePath: string;
  readonly source: string;
};

async function readAppTypeScriptSources(relativeDir = ""): Promise<readonly AppTypeScriptSource[]> {
  const dir = path.join(process.cwd(), "src", "app", relativeDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nestedSources = await Promise.all(
    entries.map(async (entry): Promise<readonly AppTypeScriptSource[]> => {
      const childRelativePath = path.join(relativeDir, entry.name);
      const childPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return readAppTypeScriptSources(childRelativePath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        return [];
      }
      return [
        {
          relativePath: childRelativePath.split(path.sep).join("/"),
          source: await fs.readFile(childPath, "utf8"),
        },
      ];
    })
  );
  return nestedSources.flat();
}

function currentDesktopRootPromptSource(source: string): string {
  const start = source.indexOf("export const DESKTOP_ROOT_AGENT_PROMPT:");
  const end = source.indexOf("export const DESKTOP_ROOT_AGENT_PROMPT_LEGACY_VERSION_V3:");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}
