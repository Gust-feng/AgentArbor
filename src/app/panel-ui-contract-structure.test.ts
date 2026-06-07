import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("panel UI contracts stay split by product concern", async () => {
  const [
    types,
    contractCommon,
    contractConfig,
    contractContext,
    contractConversation,
    contractRun,
    contractSkills,
    contractTools,
    appRunController,
    appState,
    chatActive,
    modelSettings,
  ] = await Promise.all([
    readPanelUiSource("types.ts"),
    readPanelUiSource(path.join("contracts", "common.ts")),
    readPanelUiSource(path.join("contracts", "config.ts")),
    readPanelUiSource(path.join("contracts", "context.ts")),
    readPanelUiSource(path.join("contracts", "conversation.ts")),
    readPanelUiSource(path.join("contracts", "run.ts")),
    readPanelUiSource(path.join("contracts", "skills.ts")),
    readPanelUiSource(path.join("contracts", "tools.ts")),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource(path.join("components", "chat-active.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
  ]);

  assert.equal(types.includes("BasicAgentRun"), true);
  assert.equal(types.includes('from "./contracts/run"'), true);
  assert.equal(types.includes("export type TaskStatus ="), false);
  assert.equal(types.includes("readonly runId: string"), false);
  assert.equal(contractCommon.includes("export type TaskStatus"), true);
  assert.equal(contractRun.includes("export type BasicAgentRun"), true);
  assert.equal(contractRun.includes("export type RunAgentDefinitionRef"), true);
  assert.equal(contractRun.includes("readonly agentDefinitionRef?: RunAgentDefinitionRef"), true);
  assert.equal(contractRun.includes("readonly definitionHash?: string"), true);
  assert.equal(contractRun.includes("systemPrompt"), false);
  assert.equal(contractRun.includes('import type { ObservationRef, TaskStatus } from "./common"'), true);
  assert.equal(contractRun.includes('import type { ContextAttachment } from "./context"'), true);
  assert.equal(contractRun.includes('from "../../../panel-basic-agent-run-view-contracts"'), true);
  assert.equal(contractRun.includes("type BackendBasicAgentRunView = PanelBasicAgentRunView<"), true);
  assert.equal(contractRun.includes("export type BasicAgentRunView = BackendBasicAgentRunView"), true);
  assert.equal(contractRun.includes('Omit<BackendBasicAgentRunView, "workSession">'), false);
  assert.equal(contractRun.includes("DesktopWorkSession"), false);
  assert.equal(contractRun.includes("readonly workSession?:"), false);
  assert.equal(contractRun.includes("readonly workSession:"), false);
  assert.equal(contractRun.includes("readonly underground?:"), false);
  assert.equal(contractRun.includes("convergenceSummary"), false);
  assert.equal(contractRun.includes('readonly runMode: "agent";'), true);
  assert.equal(contractRun.includes('"agent" | "deep"'), false);
  assert.equal(contractConfig.includes("export type ConfigResponse"), true);
  assert.equal(contractContext.includes("export type ContextAttachment"), true);
  assert.equal(contractConversation.includes("export type Conversation"), true);
  assert.equal(contractConversation.includes("readonly currentRun?: BasicAgentRunView;"), true);
  assert.equal(contractConversation.includes("readonly currentRun?: {"), false);
  assert.equal(contractSkills.includes("export type SkillDefinition"), true);
  assert.equal(contractTools.includes("export type ToolsResponse"), true);
  assert.equal(contractConfig.includes("modelCatalogs?: readonly ModelProviderModelCatalog[]"), true);
  assert.equal(contractConversation.includes("responseModel?:"), true);
  assert.equal(appRunController.includes('from "./types"'), false);
  assert.equal(appState.includes('from "./types"'), false);
  assert.equal(chatActive.includes('from "../types"'), false);
  assert.equal(modelSettings.includes('from "../types"'), false);
});
