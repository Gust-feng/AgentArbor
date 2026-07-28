import test from "node:test";
import {
  assert,
  hasPanelUiModuleReference,
  readPanelUiAppStructureSources,
} from "./panel-ui-app-structure-sources.js";

test("panel App composes the PersonalWorkbench around Ordinary runtime facades", async () => {
  const {
    entry,
    app,
    api,
    text,
    appWorkbenchRuntime,
    appWorkbenchTaskState,
    appWorkbenchConfigState,
    appWorkbenchInputProps,
    appShellEffects,
    appShellState,
    appQueuedMessageState,
    appComposerController,
    appSettingsController,
    appRunController,
    appConversationRefresh,
    appConfigActions,
  } = await readPanelUiAppStructureSources();

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('from "./personal-workbench/personal-workbench"'), true);
  assert.equal(app.includes("<PersonalWorkbench"), true);
  assert.equal(hasPanelUiModuleReference(app, "./components/workbench-shell"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/workbench-main"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/deep-view"), false);
  assert.equal(hasPanelUiModuleReference(app, "./multi-agent-workspace"), false);

  // App supplies existing Ordinary projections and commands; PersonalWorkbench
  // must not become a second owner of runs, conversations, or confirmations.
  assert.equal(app.includes("conversation={app.conversation}"), true);
  assert.equal(app.includes("conversations={app.conversations}"), true);
  assert.equal(app.includes("currentRun={currentRun}"), true);
  assert.equal(app.includes("inputProps={inputProps}"), true);
  assert.equal(app.includes("pendingConfirmation={pendingConfirmation}"), true);
  assert.equal(app.includes("onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}"), true);
  assert.equal(app.includes("onOpenConversation={openNormalConversation}"), true);
  assert.equal(app.includes("settingsDialogProps={settingsDialogProps}"), true);
  assert.equal(app.includes("deep={"), false);
  assert.equal(app.includes("deepView"), false);

  assert.equal(app.includes('import { getJson } from "./api"'), false);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), false);
  assert.equal(api.includes("export async function requestJson"), true);
  assert.equal(text.includes("export const STATUS_LABELS"), true);
  assert.equal(app.includes('from "./app-workbench-runtime"'), true);
  assert.equal(app.includes("useAppWorkbenchRuntime({"), true);
  assert.equal(appWorkbenchRuntime.includes("export function useAppWorkbenchRuntime"), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-run-controller"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-conversation-refresh"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-settings-controller"'), true);
  assert.equal(appRunController.includes("export function createAppRunController"), true);
  assert.equal(appConversationRefresh.includes("export function useConversationSummaryRefresh"), true);
  assert.equal(appSettingsController.includes("export function createAppSettingsController"), true);

  assert.equal(app.includes('from "./app-workbench-task-state"'), true);
  assert.equal(app.includes("useAppWorkbenchTaskState(app)"), true);
  assert.equal(appWorkbenchTaskState.includes("export function useAppWorkbenchTaskState"), true);
  assert.equal(app.includes('from "./app-workbench-config-state"'), true);
  assert.equal(app.includes("useAppWorkbenchConfigState(app)"), true);
  assert.equal(appWorkbenchConfigState.includes("export function useAppWorkbenchConfigState"), true);
  assert.equal(appWorkbenchConfigState.includes('from "./app-form-state-sync"'), true);
  assert.equal(app.includes('from "./app-workbench-input-props"'), true);
  assert.equal(app.includes("buildWorkbenchInputProps({"), true);
  assert.equal(appWorkbenchInputProps.includes("export function buildWorkbenchInputProps"), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-composer-controller"'), true);
  assert.equal(appComposerController.includes("export function createAppComposerController"), true);
  assert.equal(app.includes("function selectInputModel"), false);
  assert.equal(app.includes("function selectAttachment"), false);
  assert.equal(app.includes("function loadConversation"), false);
  assert.equal(app.includes("function decideConfirmation"), false);
  assert.equal(app.includes("function startPolling"), false);

  assert.equal(app.includes('from "./app-shell-state"'), true);
  assert.equal(app.includes('from "./app-shell-effects"'), true);
  assert.equal(appShellState.includes("export function useAppShellState"), true);
  assert.equal(appShellEffects.includes("export function useAppShellEffects"), true);
  assert.equal(app.includes('from "./app-queued-message-state"'), true);
  assert.equal(app.includes("useAppQueuedMessages({"), true);
  assert.equal(appQueuedMessageState.includes("export function useAppQueuedMessages"), true);
  assert.equal(appConfigActions.includes("export async function saveModelCapabilityConfig"), true);
  assert.equal(appConfigActions.includes("export async function saveSkillTriggerConfig"), true);
});

test("panel App keeps Multi-Agent deferred instead of rendering a Deep product surface", async () => {
  const { app } = await readPanelUiAppStructureSources();

  // Compatibility controls may still be threaded through the Ordinary input
  // facade, but App must freeze the rendered product surface to Ordinary.
  assert.equal(app.includes("const agentClusterActive = false;"), true);
  assert.equal(app.includes('agentClusterEnabled && app.agentMode === "deep"'), false);
  assert.equal(app.includes("<DeepView"), false);
  assert.equal(app.includes("<MultiAgentWorkspace"), false);
  assert.equal(app.includes("submitDeepInput()"), false);
  assert.equal(app.includes("stopDeepTask()"), false);
});
