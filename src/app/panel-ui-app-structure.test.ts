import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("panel UI app shell delegates data and control work", async () => {
  const [
    entry,
    app,
    api,
    text,
    appRuntimeControls,
    appAttachments,
    appBootstrap,
    appConfigActions,
    appConfigProjection,
    appRunProjection,
    appRunController,
    appLiveRunUpdates,
    appSettingsController,
    appState,
    appSkillActions,
    sidebar,
    topbar,
  ] = await Promise.all([
    readPanelUiSource("main.tsx"),
    readPanelUiSource("App.tsx"),
    readPanelUiSource("api.ts"),
    readPanelUiSource("text.ts"),
    readPanelUiSource("app-runtime-controls.ts"),
    readPanelUiSource("app-attachments.ts"),
    readPanelUiSource("app-bootstrap.ts"),
    readPanelUiSource("app-config-actions.ts"),
    readPanelUiSource("app-config-projection.ts"),
    readPanelUiSource("app-run-projection.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource("app-skill-actions.ts"),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "topbar.tsx")),
  ]);

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('import { getJson } from "./api"'), false);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), false);
  assert.equal(app.includes('from "./components/sidebar"'), true);
  assert.equal(app.includes('from "./components/chat-empty"'), true);
  assert.equal(app.includes('from "./components/chat-active"'), true);
  assert.equal(app.includes('from "./components/workspace-pages"'), true);
  assert.equal(app.includes('from "./ui-state"'), false);
  assert.equal(api.includes("export async function requestJson"), true);
  assert.equal(text.includes("export const STATUS_LABELS"), true);
  assert.equal(app.includes("isConversationWaitingForUser"), true);
  assert.equal(app.includes("transcriptNodesByRunId"), false);
  assert.equal(app.includes("loadConversationTranscriptNodesByRunId"), false);
  assert.equal(app.includes('from "./app-run-projection"'), true);
  assert.equal(app.includes('from "./app-runtime-controls"'), true);
  assert.equal(app.includes('from "./app-attachments"'), true);
  assert.equal(app.includes('from "./app-bootstrap"'), true);
  assert.equal(app.includes('from "./app-config-actions"'), false);
  assert.equal(app.includes('from "./app-config-projection"'), true);
  assert.equal(app.includes('from "./app-run-controller"'), true);
  assert.equal(app.includes('from "./app-settings-controller"'), true);
  assert.equal(app.includes('from "./app-state"'), true);
  assert.equal(app.includes('from "./app-skill-actions"'), true);
  assert.equal(app.includes("function refreshBootstrap"), false);
  assert.equal(app.includes("function persistModelConfig"), false);
  assert.equal(app.includes("function saveModelConfig"), false);
  assert.equal(app.includes("function createCustomModelProfile"), false);
  assert.equal(app.includes("function fetchModelsForProfile"), false);
  assert.equal(app.includes("function saveWorkspace"), false);
  assert.equal(app.includes("function saveTools"), false);
  assert.equal(app.includes("function updateTool"), false);
  assert.equal(app.includes("function updateSkill"), false);
  assert.equal(app.includes("function loadConversation"), false);
  assert.equal(app.includes("function startPolling"), false);
  assert.equal(app.includes("function startLiveUpdates"), false);
  assert.equal(app.includes("function decideConfirmation"), false);
  assert.equal(app.includes("function stopPolling"), false);
  assert.equal(app.includes("function taskSoilInputFromAttachments"), false);
  assert.equal(app.includes("function mergeConfigResponse"), false);
  assert.equal(app.includes("function startSkillChat"), false);
  assert.equal(app.includes("parseModelOptionId"), false);
  assert.equal(app.includes("/api/context/attachments/preview"), false);
  assert.equal(app.includes('postJson<ConfigResponse>("/api/config/model-provider"'), false);
  assert.equal(app.includes('postJson<ConfigResponse>("/api/config/model-profiles"'), false);
  assert.equal(app.includes('postJson<ToolsResponse>("/api/config/tools/web-search"'), false);
  assert.equal(appRuntimeControls.includes("export function stopLiveUpdates"), true);
  assert.equal(appAttachments.includes("export function taskSoilInputFromAttachments"), true);
  assert.equal(appAttachments.includes("export async function previewContextAttachment"), true);
  assert.equal(appAttachments.includes("export function blockedContextAttachment"), true);
  assert.equal(appAttachments.includes("/api/context/attachments/preview"), true);
  assert.equal(appBootstrap.includes("export async function loadAppBootstrap"), true);
  assert.equal(appBootstrap.includes("export function applyAppBootstrap"), true);
  assert.equal(appBootstrap.includes('getJson<ConfigResponse>("/api/config")'), true);
  assert.equal(appBootstrap.includes('getJson<ToolsResponse>("/api/config/tools")'), true);
  assert.equal(appBootstrap.includes('/api/conversations'), true);
  assert.equal(appConfigActions.includes("export async function saveModelProviderConfig"), true);
  assert.equal(appConfigActions.includes("export async function createCustomModelProviderProfile"), true);
  assert.equal(appConfigActions.includes("export async function selectModelProviderModel"), true);
  assert.equal(appConfigActions.includes("export async function fetchModelProviderCatalog"), true);
  assert.equal(appConfigActions.includes("export async function saveToolSettings"), true);
  assert.equal(appConfigActions.includes('postJson<ConfigResponse>("/api/config/model-provider"'), true);
  assert.equal(appConfigActions.includes('postJson<ToolsResponse>("/api/config/tools/web-search"'), true);
  assert.equal(appConfigProjection.includes("export function mergeConfigResponse"), true);
  assert.equal(appConfigProjection.includes("export function runReasoningSettings"), true);
  assert.equal(app.includes("mergeConversationTranscriptNodes"), false);
  assert.equal(appRunProjection.includes("export function projectCurrentRun"), true);
  assert.equal(appRunProjection.includes("function mergeConversationTranscriptNodes"), true);
  assert.equal(appRunController.includes("export function createAppRunController"), true);
  assert.equal(appRunController.includes("function startLiveUpdates"), false);
  assert.equal(appRunController.includes("function startPolling"), false);
  assert.equal(appLiveRunUpdates.includes("export function createLiveRunUpdateController"), true);
  assert.equal(appLiveRunUpdates.includes("function startLiveUpdates"), true);
  assert.equal(appLiveRunUpdates.includes("function startPolling"), true);
  assert.equal(appRunController.includes("function decideConfirmation"), true);
  assert.equal(appRunController.includes("loadConversationTranscriptNodesByRunId"), true);
  assert.equal(appRunController.includes("transcriptNodesByRunId"), true);
  assert.equal(appRunController.includes("taskSoilInputFromAttachments"), true);
  assert.equal(appSettingsController.includes("export function createAppSettingsController"), true);
  assert.equal(appSettingsController.includes("async function persistModelConfig"), true);
  assert.equal(appSettingsController.includes("async function saveModelConfig"), true);
  assert.equal(appSettingsController.includes("async function createCustomModelProfile"), true);
  assert.equal(appSettingsController.includes("async function fetchModelsForProfile"), true);
  assert.equal(appSettingsController.includes("async function saveWorkspace"), true);
  assert.equal(appSettingsController.includes("async function saveTools"), true);
  assert.equal(appSettingsController.includes("async function updateTool"), true);
  assert.equal(appSettingsController.includes("async function updateSkill"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("saveWorkspaceDirectory"), true);
  assert.equal(appSettingsController.includes("saveToolSettings"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(appState.includes("export type AppState"), true);
  assert.equal(appState.includes("export function createInitialAppState"), true);
  assert.equal(appState.includes("transcriptNodesByRunId"), true);
  assert.equal(appSkillActions.includes("export function startSkillChat"), true);
  assert.equal(app.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appRunController.includes('from "../../panel-ui-transcript-cache"'), true);
  assert.equal(app.includes("shouldShowProviderIcon"), false);
  assert.equal(sidebar.includes("最近会话"), true);
  assert.equal(sidebar.includes("sidebar-confirmation-card"), false);
  assert.equal(sidebar.includes("sidebar-pending-reminder"), true);
  assert.equal(topbar.includes("topbarStatusText"), true);
  assert.equal(topbar.includes("写入前确认"), false);
});
