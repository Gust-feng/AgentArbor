import nodeAssert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

const assert = {
  equal(actual: unknown, expected: unknown, message?: string): void {
    nodeAssert.equal(actual, expected, message);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    nodeAssert.deepEqual(actual, expected, message);
  },
};

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
    appUpdateActions,
    appConfigProjection,
    appConversationRefresh,
    conversationRefresh,
    submitFlow,
    appObservedRunReadModel,
    appRunProjection,
    panelContextWindowUsage,
    appRunController,
    appConversationSession,
    appTaskSubmission,
    appLiveRunUpdates,
    transcriptStore,
    appSettingsController,
    appState,
    chatEmpty,
    workbenchShell,
    workbenchMain,
    chatTranscriptChain,
    transcriptTimeline,
    sidebar,
    settingsDialog,
    workbenchSettingsDialog,
    capabilitySettings,
    skillSettings,
    workspaceSettings,
    deepView,
    deepViewModel,
    deepTranscriptModel,
    deepWorkDetailModel,
    deepRunTree,
    deepConclusion,
    multiAgentWorkspace,
    appDeepEntry,
    appDeepTaskController,
    appSidebarConversationController,
    appComposerController,
    appFormStateSync,
    appWorkbenchConfigState,
    appShellEffects,
    appShellState,
    appWorkbenchShellProps,
    appWorkbenchRuntime,
    appWorkbenchTaskState,
    appQueuedMessageState,
    appWorkbenchInputProps,
    appDeepLiveUpdates,
    appDeepControl,
    appDeepIntake,
    appDeepHistory,
    deepStyles,
    shellStyles,
    chatComposerStyles,
    chatMessageStyles,
    motionResponsiveStyles,
    workspaceStyles,
    appModelUsageDisplay,
  ] = await Promise.all([
    readPanelUiSource("main.tsx"),
    readPanelUiSource("App.tsx"),
    readPanelUiSource("api.ts"),
    readPanelUiSource("text.ts"),
    readPanelUiSource("app-runtime-controls.ts"),
    readPanelUiSource("app-attachments.ts"),
    readPanelUiSource("app-bootstrap.ts"),
    readPanelUiSource("app-config-actions.ts"),
    readPanelUiSource("app-update-actions.ts"),
    readPanelUiSource("app-config-projection.ts"),
    readPanelUiSource("app-conversation-refresh.ts"),
    readAppSource(path.join("panel-conversation", "panel-conversation-refresh.ts")),
    readAppSource("panel-ui-submit-flow.ts"),
    readPanelUiSource("app-observed-run-read-model.ts"),
    readPanelUiSource("app-run-projection.ts"),
    readAppSource("panel-context-window-usage.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-conversation-session.ts"),
    readPanelUiSource("app-task-submission.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("panel-ui-transcript-store.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "workbench-shell.tsx")),
    readPanelUiSource(path.join("components", "workbench-main.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "workbench-settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "skill-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "deep-view.tsx")),
    readPanelUiSource("deep-view-model.ts"),
    readPanelUiSource("deep-transcript-model.ts"),
    readPanelUiSource("deep-work-detail-model.ts"),
    readPanelUiSource(path.join("components", "deep-run-tree.tsx")),
    readPanelUiSource(path.join("components", "deep-conclusion.tsx")),
    readPanelUiSource(path.join("components", "multi-agent-workspace.tsx")),
    readPanelUiSource("app-deep-entry.ts"),
    readPanelUiSource("app-deep-task-controller.ts"),
    readPanelUiSource("app-sidebar-conversation-controller.ts"),
    readPanelUiSource("app-composer-controller.ts"),
    readPanelUiSource("app-form-state-sync.ts"),
    readPanelUiSource("app-workbench-config-state.ts"),
    readPanelUiSource("app-shell-effects.ts"),
    readPanelUiSource("app-shell-state.ts"),
    readPanelUiSource("app-workbench-shell-props.ts"),
    readPanelUiSource("app-workbench-runtime.ts"),
    readPanelUiSource("app-workbench-task-state.ts"),
    readPanelUiSource("app-queued-message-state.ts"),
    readPanelUiSource("app-workbench-input-props.ts"),
    readPanelUiSource("app-deep-live-updates.ts"),
    readPanelUiSource("app-deep-control.ts"),
    readPanelUiSource("app-deep-intake.ts"),
    readPanelUiSource("app-deep-history.ts"),
    readPanelUiStyle("deep-view.css"),
    readPanelUiStyle("shell.css"),
    readPanelUiStyle("chat-composer.css"),
    readPanelUiStyle("chat-message.css"),
    readPanelUiStyle("motion-responsive.css"),
    readPanelUiStyle("workspace.css"),
    readPanelUiSource("app-model-usage-display.ts"),
  ]);

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('import { getJson } from "./api"'), false);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), false);
  assert.equal(app.includes('from "./components/sidebar"'), false);
  assert.equal(app.includes('from "./components/topbar"'), false);
  assert.equal(app.includes('from "./components/chat-empty"'), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/chat-active"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/settings-dialog"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/workbench-main"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/workbench-settings-dialog"), false);
  assert.equal(hasPanelUiModuleReference(app, "./components/workbench-shell"), true);
  assert.equal(workbenchShell.includes('from "./sidebar"'), true);
  assert.equal(workbenchShell.includes('from "./workbench-main"'), true);
  assert.equal(workbenchShell.includes('from "./workbench-settings-dialog"'), true);
  assert.equal(workbenchShell.includes('from "../app-startup-intro"'), true);
  assert.equal(app.includes('from "./app-workbench-shell-props"'), true);
  assert.equal(app.includes('from "./ui-state"'), false);
  assert.equal(api.includes("export async function requestJson"), true);
  assert.equal(text.includes("export const STATUS_LABELS"), true);
  assert.equal(app.includes("isConversationWaitingForUser"), false);
  assert.equal(appWorkbenchRuntime.includes("isConversationWaitingForUser"), true);
  assert.equal(app.includes("transcriptNodesByRunId"), false);
  assert.equal(app.includes("loadConversationTranscriptNodesByRunId"), false);
  assert.equal(app.includes('from "./app-run-projection"'), false);
  assert.equal(app.includes('from "./app-workbench-runtime"'), true);
  assert.equal(app.includes("useAppWorkbenchRuntime({"), true);
  assert.equal(appWorkbenchRuntime.includes("export function useAppWorkbenchRuntime"), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-run-projection"'), true);
  assert.equal(app.includes('from "./app-model-usage-display"'), false);
  assert.equal(appShellState.includes('from "./app-model-usage-display"'), true);
  assert.equal(app.includes('from "../../panel-context-window-usage"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "../../panel-context-window-usage"'), true);
  assert.equal(app.includes("contextWindowUsageFrom({"), false);
  assert.equal(appWorkbenchRuntime.includes("contextWindowUsageFrom({"), true);
  assert.equal(app.includes("capabilityPlan?.modelCapabilities.contextWindowTokens"), false);
  assert.equal(appWorkbenchRuntime.includes("capabilityPlan?.modelCapabilities.contextWindowTokens"), true);
  assert.equal(app.includes("capabilityPlan.modelCapabilities.contextWindowTokens"), false);
  assert.equal(appWorkbenchRuntime.includes("selectedModelContextWindowTokens ??"), false);
  assert.equal(appWorkbenchRuntime.includes("currentRun.run === undefined"), true);
  assert.equal(app.includes("latestModelUsageFromEvents(currentRun.events)"), false);
  assert.equal(app.includes("latestModelUsageFromTranscript(currentRun.transcriptNodes)"), false);
  assert.equal(appWorkbenchRuntime.includes("latestModelUsageFromEvents(currentRun.events)"), true);
  assert.equal(appWorkbenchRuntime.includes("latestModelUsageFromTranscript(currentRun.transcriptNodes)"), true);
  assert.equal(app.includes("contextUsage,"), true);
  assert.equal(panelContextWindowUsage.includes("export function contextWindowUsageFrom"), true);
  assert.equal(panelContextWindowUsage.includes("export function latestModelUsageFromTranscript"), true);
  assert.equal(panelContextWindowUsage.includes("isTokenSourceUsableForContextUsage"), true);
  assert.equal(chatEmpty.includes("readonly contextUsage?: ContextWindowUsage"), true);
  assert.equal(chatEmpty.includes('className="composer-context-usage"'), true);
  assert.equal(chatComposerStyles.includes(".composer-context-usage-svg"), true);
  assert.equal(chatComposerStyles.includes(".composer-context-usage-meter"), true);
  assert.equal(app.includes("modelUsageDisplayEnabled"), true);
  assert.equal(app.includes("showModelUsage={modelUsageDisplayEnabled}"), false);
  assert.equal(appWorkbenchShellProps.includes("showModelUsage: options.modelUsageDisplayEnabled"), true);
  assert.equal(workbenchMain.includes("showModelUsage={props.showModelUsage}"), true);
  assert.equal(app.includes("onModelUsageDisplayChange={changeModelUsageDisplay}"), false);
  assert.equal(workbenchSettingsDialog.includes("onModelUsageDisplayChange={props.preferences.onModelUsageDisplayChange}"), true);
  assert.equal(appModelUsageDisplay.includes("agentarbor:model-usage-display"), true);
  assert.equal(appModelUsageDisplay.includes("readLocalPreference(STORAGE_MODEL_USAGE_DISPLAY_KEY) === \"true\""), true);
  assert.equal(appModelUsageDisplay.includes("writeLocalPreference(STORAGE_MODEL_USAGE_DISPLAY_KEY"), true);
  assert.equal(appModelUsageDisplay.includes("subscribeModelUsageDisplayChanged"), true);
  assert.equal(app.includes('from "./app-shell-effects"'), true);
  assert.equal(app.includes('from "./app-shell-state"'), true);
  assert.equal(app.includes("useAppShellEffects({"), true);
  assert.equal(app.includes("useAppShellState({"), true);
  assert.equal(app.includes('from "./app-workbench-task-state"'), true);
  assert.equal(app.includes("useAppWorkbenchTaskState(app)"), true);
  assert.equal(appShellEffects.includes("export function useAppShellEffects"), true);
  assert.equal(appShellState.includes("export function useAppShellState"), true);
  assert.equal(appWorkbenchTaskState.includes("export function useAppWorkbenchTaskState"), true);
  assert.equal(appWorkbenchTaskState.includes("const [goal, setGoal] = useState(\"\");"), true);
  assert.equal(appWorkbenchTaskState.includes("const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);"), true);
  assert.equal(appWorkbenchTaskState.includes("const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string | undefined>(undefined);"), true);
  assert.equal(appShellState.includes("function openSettings"), true);
  assert.equal(appShellState.includes("function changeModelUsageDisplay"), true);
  assert.equal(appShellState.includes("function changeAgentClusterEnabled"), true);
  assert.equal(appShellState.includes("export function persistSidebarCollapsedPreference"), true);
  assert.equal(appShellState.includes("onExitDeepMode"), true);
  assert.equal(app.includes("function openSettings"), false);
  assert.equal(app.includes("function changeModelUsageDisplay"), false);
  assert.equal(app.includes("function changeAgentClusterEnabled"), false);
  assert.equal(app.includes("function loadSidebarCollapsedPreference"), false);
  assert.equal(app.includes("function loadAgentClusterEnabledPreference"), false);
  assert.equal(app.includes("function persistAgentClusterEnabledPreference"), false);
  assert.equal(app.includes("function persistSidebarCollapsedPreference"), false);
  assert.equal(appShellEffects.includes("subscribeMotionSettingsChanged"), true);
  assert.equal(appShellEffects.includes("subscribeModelUsageDisplayChanged"), true);
  assert.equal(appShellEffects.includes("autoAppUpdateCheckRequestedRef"), true);
  assert.equal(appShellEffects.includes("checkAppUpdateRef.current()"), true);
  assert.equal(appShellEffects.includes("refreshAppUpdateStatusRef.current()"), true);
  assert.equal(appShellEffects.includes("persistSidebarCollapsed(options.sidebarCollapsed)"), true);
  assert.equal(app.includes('from "./app-queued-message-state"'), true);
  assert.equal(app.includes("useAppQueuedMessages({"), true);
  assert.equal(appQueuedMessageState.includes("export function useAppQueuedMessages"), true);
  assert.equal(appQueuedMessageState.includes("queueReadyAfterRunRef"), true);
  assert.equal(appQueuedMessageState.includes("dispatchedQueueAfterRunRef"), true);
  assert.equal(appQueuedMessageState.includes("previousRunActivityRef"), true);
  assert.equal(appQueuedMessageState.includes("clearQueuedMessages"), true);
  assert.equal(app.includes('from "./app-form-state-sync"'), false);
  assert.equal(app.includes("useAppFormStateSync({"), false);
  assert.equal(app.includes('from "./app-workbench-config-state"'), true);
  assert.equal(app.includes("useAppWorkbenchConfigState(app)"), true);
  assert.equal(app.includes("const [goal, setGoal] = useState(\"\");"), false);
  assert.equal(app.includes("const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);"), false);
  assert.equal(app.includes("const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string | undefined>(undefined);"), false);
  assert.equal(app.includes('from "./model-options"'), false);
  assert.equal(appFormStateSync.includes("export function useAppFormStateSync"), true);
  assert.equal(appWorkbenchConfigState.includes("export function useAppWorkbenchConfigState"), true);
  assert.equal(appWorkbenchConfigState.includes('from "./app-form-state-sync"'), true);
  assert.equal(appWorkbenchConfigState.includes("useAppFormStateSync({"), true);
  assert.equal(appWorkbenchConfigState.includes('from "./model-options"'), true);
  assert.equal(appWorkbenchConfigState.includes("modelOptionsFromConfig(app.config, modelCatalogs)"), true);
  assert.equal(appWorkbenchConfigState.includes("selectedModelOptionId(app.config, modelOptions)"), true);
  assert.equal(appWorkbenchConfigState.includes("modelOptionSupportsReasoningEffort(app.config, selectedModelId)"), true);
  assert.equal(appFormStateSync.includes("normalizeVisibleAiMode"), true);
  assert.equal(appFormStateSync.includes("visibleConfigLabel"), true);
  assert.equal(appFormStateSync.includes("setToolForm({"), true);
  assert.equal(appFormStateSync.includes("setMcpServerForm((previous) => {"), true);
  assert.equal(appFormStateSync.includes("setComposerSelectedModelId(undefined)"), true);
  assert.equal(appFormStateSync.includes('setComposerReasoningEffort("")'), true);
  assert.equal(app.includes('from "./app-workbench-input-props"'), true);
  assert.equal(app.includes("buildWorkbenchInputProps({"), true);
  assert.equal(appWorkbenchInputProps.includes("export function buildWorkbenchInputProps"), true);
  assert.equal(appWorkbenchInputProps.includes("const activeInputAgentMode: AgentMode = options.agentClusterActive ? \"deep\" : \"normal\";"), true);
  assert.equal(appWorkbenchInputProps.includes("if (options.agentClusterActive) {"), true);
  assert.equal(appWorkbenchInputProps.includes("} else if (options.busy || options.modelResponding) {"), true);
  assert.equal(appWorkbenchInputProps.includes("options.enqueueMessage(options.goal);"), true);
  assert.equal(appWorkbenchInputProps.includes("allowInputWhileBusy: true,"), true);
  assert.equal(appWorkbenchInputProps.includes("const hasBusyDeepRun = shouldKeepDeepRunBusy(options.deep?.run);"), true);
  assert.equal(appWorkbenchInputProps.includes("const hasPendingDeepRunBootstrap = options.deepActiveRunId !== undefined && options.deep === undefined;"), true);
  assert.equal(appWorkbenchInputProps.includes("const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;"), true);
  assert.equal(appWorkbenchInputProps.includes("queuedMessages: undefined,"), true);
  assert.equal(appWorkbenchInputProps.includes("onRemoveQueuedMessage: undefined,"), true);
  assert.equal(appWorkbenchInputProps.includes("onUpdateQueuedMessage: undefined,"), true);
  assert.equal(appWorkbenchInputProps.includes('cancelLabel: "停止",'), true);
  assert.equal(appWorkbenchInputProps.includes("function deepInputPlaceholder("), true);
  assert.equal(app.includes('from "./app-composer-controller"'), false);
  assert.equal(app.includes("createAppComposerController({"), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-composer-controller"'), true);
  assert.equal(appWorkbenchRuntime.includes("createAppComposerController({"), true);
  assert.equal(appComposerController.includes("export function createAppComposerController"), true);
  assert.equal(appComposerController.includes('from "./app-attachments"'), true);
  assert.equal(appComposerController.includes('from "./app-workspace-selection"'), true);
  assert.equal(app.includes('from "./app-runtime-controls"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-runtime-controls"'), true);
  assert.equal(app.includes('from "./app-attachments"'), false);
  assert.equal(app.includes('from "./app-bootstrap"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-bootstrap"'), true);
  assert.equal(app.includes('from "./app-config-actions"'), false);
  assert.equal(app.includes('from "./app-update-actions"'), false);
  assert.equal(app.includes('from "./app-config-projection"'), false);
  assert.equal(appWorkbenchConfigState.includes('from "./app-config-projection"'), true);
  assert.equal(app.includes('from "./app-conversation-refresh"'), false);
  assert.equal(app.includes('from "./app-run-controller"'), false);
  assert.equal(app.includes('from "./app-settings-controller"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-conversation-refresh"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-run-controller"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-settings-controller"'), true);
  assert.equal(app.includes('from "./app-state"'), true);
  assert.equal(app.includes('from "./app-skill-actions"'), false);
  assert.equal(app.includes("function refreshBootstrap"), false);
  assert.equal(app.includes("checkAppUpdate: settingsController.checkAppUpdate"), true);
  assert.equal(app.includes("saveModelCapabilities,"), false);
  assert.equal(app.includes("saveSkillTriggerMode,"), false);
  assert.equal(app.includes("appUpdate={app.appUpdate}"), true);
  assert.equal(app.includes("refreshAppUpdateStatusRef.current()"), false);
  assert.equal(app.includes("autoAppUpdateCheckRequestedRef"), false);
  assert.equal(app.includes("checkAppUpdateRef.current()"), false);
  assert.equal(app.includes('app.appUpdate?.status === "downloaded"'), false);
  assert.equal(app.includes("app-update-ready-banner"), false);
  assert.equal(workbenchShell.includes("app-update-ready-banner"), true);
  assert.equal(appWorkbenchShellProps.includes("export function appUpdateReadyText"), true);
  assert.equal(app.includes("onInstallAppUpdate={() => void installAppUpdate()}"), false);
  assert.equal(app.includes("onCheckAppUpdate={() => void checkAppUpdate()}"), false);
  assert.equal(app.includes("onSaveModelCapabilities={saveModelCapabilities}"), false);
  assert.equal(app.includes("settingsController.installAppUpdate()"), true);
  assert.equal(workbenchShell.includes("onClick={props.onInstallAppUpdate}"), true);
  assert.equal(workbenchSettingsDialog.includes('from "./settings-dialog"'), true);
  assert.equal(workbenchSettingsDialog.includes("export function WorkbenchSettingsDialog"), true);
  assert.equal(workbenchSettingsDialog.includes("appUpdate={props.app.appUpdate}"), true);
  assert.equal(workbenchSettingsDialog.includes("onCheckAppUpdate={() => void props.actions.checkAppUpdate()}"), true);
  assert.equal(workbenchSettingsDialog.includes("onInstallAppUpdate={() => void props.actions.installAppUpdate()}"), true);
  assert.equal(workbenchSettingsDialog.includes("onSaveModelCapabilities={props.actions.saveModelCapabilities}"), true);
  assert.equal(workbenchSettingsDialog.includes("onSaveSkillTriggerMode={(mode) => void props.actions.saveSkillTriggerMode(mode)}"), true);
  assert.equal(workbenchSettingsDialog.includes("onRefreshSkills={() => void props.actions.refreshSkills()}"), true);
  assert.equal(workbenchSettingsDialog.includes("onUpdateSkill={(skill, enabled) => void props.actions.updateSkill(skill, enabled)}"), true);
  assert.equal(app.includes("normalizeVisibleAiMode"), false);
  assert.equal(app.includes("visibleConfigLabel"), false);
  assert.equal(app.includes("setToolForm({"), false);
  assert.equal(app.includes("setMcpServerForm((previous) => {"), false);
  assert.equal(app.includes("setComposerSelectedModelId(undefined)"), false);
  assert.equal(app.includes('setComposerReasoningEffort("")'), false);
  assert.equal(app.includes("function selectInputModel"), false);
  assert.equal(app.includes("function selectAttachment"), false);
  assert.equal(app.includes("function selectTaskWorkspace"), false);
  assert.equal(app.includes("function uploadAttachments"), false);
  assert.equal(app.includes("function removeAttachment"), false);
  assert.equal(app.includes("function changeToolConfirmationPolicy"), false);
  assert.equal(app.includes("queueReadyAfterRunRef"), false);
  assert.equal(app.includes("dispatchedQueueAfterRunRef"), false);
  assert.equal(app.includes("previousRunActivityRef"), false);
  assert.equal(app.includes("useCallback("), false);
  assert.equal(appComposerController.includes("function selectInputModel"), true);
  assert.equal(appComposerController.includes("function selectAttachment"), true);
  assert.equal(appComposerController.includes("function selectTaskWorkspace"), true);
  assert.equal(appComposerController.includes("function uploadAttachments"), true);
  assert.equal(appComposerController.includes("function removeAttachment"), true);
  assert.equal(appComposerController.includes("function changeToolConfirmationPolicy"), true);
  assert.equal(appQueuedMessageState.includes("const enqueueMessage = useCallback"), true);
  assert.equal(appQueuedMessageState.includes("const removeQueuedMessage = useCallback"), true);
  assert.equal(appQueuedMessageState.includes("const updateQueuedMessage = useCallback"), true);
  assert.equal(app.includes("onSaveSkillTriggerMode={(mode) => void saveSkillTriggerMode(mode)}"), false);
  assert.equal(workbenchSettingsDialog.includes("onSaveSkillTriggerMode={(mode) => void props.actions.saveSkillTriggerMode(mode)}"), true);
  assert.equal(appConfigActions.includes("export async function saveModelCapabilityConfig"), true);
  assert.equal(appConfigActions.includes('postJson<ConfigResponse>("/api/config/model-capabilities"'), true);
  assert.equal(appConfigActions.includes("export async function saveSkillTriggerConfig"), true);
  assert.equal(appConfigActions.includes('postJson<ConfigResponse>("/api/config/skill-trigger"'), true);
  assert.equal(app.includes("function persistModelConfig"), false);
  assert.equal(app.includes("function saveModelConfig"), false);
  assert.equal(app.includes("function createCustomModelProfile"), false);
  assert.equal(app.includes("function fetchModelsForProfile"), false);
  assert.equal(app.includes("function saveWorkspace"), false);
  assert.equal(app.includes("function saveTools"), false);
  assert.equal(app.includes("function saveMcpServer"), false);
  assert.equal(app.includes("function updateTool"), false);
  assert.equal(app.includes("function updateSkill"), false);
  assert.equal(app.includes("function loadConversation"), false);
  assert.equal(app.includes("function conversationSummaryNeedsRefresh"), false);
  assert.equal(app.includes("function conversationSummariesNeedRefresh"), false);
  assert.equal(app.includes("function startPolling"), false);
  assert.equal(app.includes("function startLiveUpdates"), false);
  assert.equal(app.includes("function decideConfirmation"), false);
  assert.equal(app.includes("function stopPolling"), false);
  assert.equal(app.includes("function taskSoilInputFromAttachments"), false);
  assert.equal(app.includes("function mergeConfigResponse"), false);
  assert.equal(app.includes("function startSkillChat"), false);
  assert.equal(app.includes("app.busy || modelResponding"), false);
  assert.equal(app.includes("queueReadyAfterRunRef"), false);
  assert.equal(app.includes("if (agentClusterActive) {"), false);
  assert.equal(app.includes("void submitDeepInput();"), false);
  assert.equal(app.includes("} else if (app.busy || modelResponding) {"), false);
  assert.equal(app.includes("enqueueMessage(goal);"), false);
  assert.equal(app.includes('const agentClusterActive = agentClusterEnabled && app.agentMode === "deep";'), true);
  assert.equal(app.includes("function openNormalTaskEntry"), false);
  assert.equal(appDeepEntry.includes('changeAgentMode("normal");'), true);
  assert.equal(appDeepEntry.includes("options.setSelectedWorkspaceDirectory(undefined);"), true);
  assert.equal(appDeepEntry.includes("options.resetChat();"), true);
  assert.equal(appDeepEntry.includes("options.deepOpenEpochRef.current += 1;"), true);
  assert.equal(appDeepEntry.includes("options.deepRunUpdateController.stopPolling();"), true);
  assert.equal(app.includes("function openNormalAgentEntry"), false);
  assert.equal(appDeepEntry.includes("options.deepRunUpdateController.stopPolling();"), true);
  assert.equal(app.includes('setScreen(app.conversation !== undefined || app.run !== undefined ? "chat-active" : "chat-empty");'), false);
  assert.equal(appDeepEntry.includes('options.setScreen(options.app.conversation !== undefined || options.app.run !== undefined ? "chat-active" : "chat-empty");'), true);
  assert.equal(app.includes("app.conversation.workspaceFolder?.path"), false);
  assert.equal(app.includes("app.conversation?.workspaceFolder?.path"), false);
  assert.equal(app.includes("app.deep.run.workspaceFolder?.path"), false);
  assert.equal(app.includes("app.deep?.run.workspaceFolder?.path"), false);
  assert.equal(appWorkbenchRuntime.includes("options.app.conversation.workspaceFolder?.path"), false);
  assert.equal(appWorkbenchRuntime.includes("options.app.deep.run.workspaceFolder?.path"), false);
  assert.equal(appWorkbenchTaskState.includes("app.conversation.workspaceFolder?.path"), true);
  assert.equal(appWorkbenchTaskState.includes("app.deep.run.workspaceFolder?.path"), true);
  assert.equal(app.includes("summary?.workspaceFolder?.path") || app.includes("view.run.workspaceFolder?.path"), false);
  assert.equal(appDeepEntry.includes("summary?.workspaceFolder?.path"), true);
  assert.equal(appDeepEntry.includes("view.run.workspaceFolder?.path"), true);
  assert.equal(app.includes("function openAgentClusterEntry"), false);
  assert.equal(app.includes("function openCurrentModeTaskEntry"), false);
  assert.equal(app.includes('agentMode: "deep"'), false);
  assert.equal(appDeepEntry.includes('agentMode: "deep"'), true);
  assert.equal(app.includes('from "./app-deep-intake"'), false);
  assert.equal(app.includes('from "./app-deep-control"'), false);
  assert.equal(app.includes('from "./app-deep-entry"'), false);
  assert.equal(app.includes('from "./app-deep-task-controller"'), false);
  assert.equal(app.includes('from "./app-sidebar-conversation-controller"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-deep-entry"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-deep-task-controller"'), true);
  assert.equal(appWorkbenchRuntime.includes('from "./app-sidebar-conversation-controller"'), true);
  assert.equal(app.includes('from "./app-deep-task-submission"'), false);
  assert.equal(app.includes('from "./components/multi-agent-workspace"'), false);
  assert.equal(app.includes('from "./components/deep-view"'), false);
  assert.equal(app.includes('from "./app-deep-history"'), false);
  assert.equal(app.includes("createAppDeepEntryController({"), false);
  assert.equal(app.includes("createAppDeepTaskController({"), false);
  assert.equal(app.includes("createAppSidebarConversationController({"), false);
  assert.equal(appWorkbenchRuntime.includes("createAppDeepEntryController({"), true);
  assert.equal(appWorkbenchRuntime.includes("createAppDeepTaskController({"), true);
  assert.equal(appWorkbenchRuntime.includes("createAppSidebarConversationController({"), true);
  assert.equal(appDeepEntry.includes("export function createAppDeepEntryController"), true);
  assert.equal(appDeepTaskController.includes("export function createAppDeepTaskController"), true);
  assert.equal(appSidebarConversationController.includes("export function createAppSidebarConversationController"), true);
  assert.equal(appWorkbenchInputProps.includes('from "./app-deep-history"'), true);
  assert.equal(appDeepTaskController.includes('from "./app-deep-intake"'), true);
  assert.equal(appDeepTaskController.includes('from "./app-deep-control"'), true);
  assert.equal(appDeepTaskController.includes('from "./app-deep-history"'), true);
  assert.equal(appSidebarConversationController.includes('from "./app-conversation-management"'), true);
  assert.equal(appSidebarConversationController.includes('from "./app-deep-conversation-management"'), true);
  assert.equal(app.includes("latestActiveDeepRun(bootstrap.deepRuns)"), false);
  assert.equal(app.includes("latestRestorableDeepConversation(app.deepConversations)"), false);
  assert.equal(app.includes("latestRestorableDeepRun(app.deepRuns)"), false);
  assert.equal(appDeepEntry.includes("latestRestorableDeepConversation(options.app.deepConversations)"), true);
  assert.equal(appDeepEntry.includes("latestRestorableDeepRun(options.app.deepRuns)"), true);
  const openAgentClusterEntryIndex = appDeepEntry.indexOf("function openAgentClusterEntry");
  assert.equal(openAgentClusterEntryIndex >= 0, true);
  assert.equal(
    appDeepEntry.indexOf("latestRestorableDeepConversation(options.app.deepConversations)", openAgentClusterEntryIndex) <
      appDeepEntry.indexOf("latestRestorableDeepRun(options.app.deepRuns)", openAgentClusterEntryIndex),
    true,
  );
  assert.equal(app.includes("deepOpenEpochRef.current += 1;"), false);
  assert.equal(appDeepEntry.includes("options.deepOpenEpochRef.current += 1;"), true);
  assert.equal(app.includes("if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;"), false);
  assert.equal(appDeepTaskController.includes("if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;"), true);
  assert.equal(appDeepEntry.includes("if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;"), true);
  assert.equal(app.includes("openAgentClusterRun(activeDeepRun.runId, { auto: true })"), false);
  assert.equal(app.includes("function openAgentClusterConversation"), false);
  assert.equal(appDeepEntry.includes("function openAgentClusterConversation"), true);
  assert.equal(app.includes("getDeepConversation(conversationId)"), false);
  assert.equal(appDeepEntry.includes("getDeepConversation(conversationId)"), true);
  assert.equal(app.includes("openDeepRun(runId)"), false);
  assert.equal(appDeepEntry.includes("openDeepRun(runId)"), true);
  assert.equal(app.includes("deepSelectedRunId"), false);
  assert.equal(appDeepTaskController.includes("deepSelectedRunId"), true);
  assert.equal(app.includes("const deepActive = agentClusterActive"), false);
  assert.equal(app.includes("<WorkbenchMain"), false);
  assert.equal(workbenchShell.includes("<WorkbenchMain"), true);
  assert.equal(appWorkbenchShellProps.includes("export function buildWorkbenchMainProps"), true);
  assert.equal(appWorkbenchShellProps.includes("deepActive: options.agentClusterActive"), true);
  assert.equal(app.includes("<MultiAgentWorkspace"), false);
  assert.equal(app.includes("<ChatEmpty"), false);
  assert.equal(app.includes("<ChatActive"), false);
  assert.equal(app.includes("<DeepView"), false);
  assert.equal(workbenchMain.includes("conversation={props.deepConversation}"), true);
  assert.equal(workbenchMain.includes("intakeStatus={props.deepIntakeStatus}"), true);
  assert.equal(workbenchMain.includes("busy={props.deepBusy}"), true);
  assert.equal(workbenchMain.includes("pendingGoal={props.deepPendingGoal}"), true);
  assert.equal(app.includes("runs={app.deepRuns}"), false);
  assert.equal(app.includes("activeRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}"), false);
  assert.equal(app.includes("onOpenRun={(runId) => void openAgentClusterRun(runId)}"), false);
  assert.equal(workbenchMain.includes("childOperationBusyId={props.deepChildOperationBusyId}"), true);
  assert.equal(workbenchMain.includes("resynthesisBusy={props.deepResynthesisBusy}"), true);
  assert.equal(workbenchMain.includes("onChildMessage={props.onChildMessage}"), true);
  assert.equal(workbenchMain.includes("onChildConfirmation={props.onChildConfirmation}"), true);
  assert.equal(workbenchMain.includes("onResynthesize={props.onResynthesize}"), true);
  assert.equal(workbenchMain.includes("onStopRun={props.onStopRun}"), true);
  assert.equal(workbenchMain.includes('className="app-bootstrap-loading"'), true);
  assert.equal(workbenchMain.includes("正在初始化工作台"), true);
  assert.equal(workbenchMain.includes("export function WorkbenchMain"), true);
  assert.equal(workbenchMain.includes('from "./multi-agent-workspace"'), true);
  assert.equal(workbenchMain.includes('from "./chat-empty"'), true);
  assert.equal(workbenchMain.includes('from "./chat-active"'), true);
  assert.equal(app.includes("const keepBusy = shouldKeepDeepRunBusy(view.run);"), false);
  assert.equal(app.includes("const keepPolling = shouldPollDeepRun(view.run);"), false);
  assert.equal(appDeepTaskController.includes("const keepPolling = shouldPollDeepRun(view.run);"), true);
  assert.equal(appDeepEntry.includes("const keepBusy = shouldKeepDeepRunBusy(view.run);"), true);
  assert.equal(appDeepEntry.includes("const keepPolling = shouldPollDeepRun(view.run);"), true);
  assert.equal(app.includes("const canStop = app.deep?.run.runtimeHealth?.canStop === true || app.deepBusy;"), false);
  assert.equal(appDeepTaskController.includes("const canStop = options.app.deep?.run.runtimeHealth?.canStop === true || options.app.deepBusy;"), true);
  assert.equal(app.includes("const hasBusyDeepRun = shouldKeepDeepRunBusy(app.deep?.run);"), false);
  assert.equal(app.includes("const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;"), false);
  assert.equal(app.includes("selectedWorkspaceDirectory: undefined"), false);
  assert.equal(app.includes("onSelectWorkspaceDirectory: undefined"), false);
  assert.equal(app.includes("agentClusterDisabled="), false);
  assert.equal(app.includes("onOpenAgentCluster={openAgentClusterEntry}"), false);
  assert.equal(appWorkbenchShellProps.includes("onOpenAgentCluster: options.onOpenAgentCluster"), true);
  assert.equal(app.includes('agentMode={app.agentMode}'), false);
  assert.equal(app.includes('onModeChange={selectAgentMode}'), false);
  assert.equal(app.includes("桌面 Agent"), false);
  assert.equal(app.includes("Agent 集群"), false);
  assertIncludesAll(multiAgentWorkspace, [
    "export function MultiAgentWorkspace",
    "selectedComposerModel",
    "assistantModel",
    "<DeepView",
    "<DeepWorkItemDetailPanel",
    "deepRunWorkItemExists",
    "selectedWorkItem",
    "setSelectedWorkItem",
    "conversation={props.conversation}",
    "intakeStatus={props.intakeStatus}",
    "onStartConfirmedRun={props.onStartConfirmedRun}",
    "resynthesisBusy={props.resynthesisBusy || props.childOperationBusyId !== undefined}",
    "onResynthesize={props.onResynthesize}",
    "onStopRun={props.onStopRun}",
    "ChatInputBar",
    'aria-label="Agent 集群工作区"',
    "with-work-detail",
    "props.view !== undefined && selectedWorkItem !== undefined",
    'className="multi-agent-reading-shell"',
  ]);
  assertExcludesAll(multiAgentWorkspace, [
    "<DeepTaskSidebar",
    "<DeepParentWorkflowPane",
    "<DeepWorkflowDetailPanel",
    "selectedWorkflowItem",
    "selectedNode",
    "selectedWorkItem.kind === \"child_agent\"",
    "准备新的 Agent 集群任务",
    "multi-agent-missionbar",
    "最近任务",
    "暂无历史",
    "props.runs",
    "props.activeRunId",
    "key={run.runId}",
    "with-task-sidebar",
    "with-workflow-detail",
    "with-side-panel",
    "runStatusLabel={statusLabel",
  ]);
  assert.equal(
    multiAgentWorkspace.indexOf('className="multi-agent-commandbar"') >
      multiAgentWorkspace.indexOf('className="multi-agent-reading-shell"'),
    true,
  );
  assertExcludesAll(multiAgentWorkspace, ["API path", "raw event type", "Deep 模式"]);
  assertIncludesAll(deepView, [
    "export function DeepView",
    "export function DeepWorkItemDetailPanel",
    "function DeepRunTranscriptPane",
    "function DeepPlanConfirmationCard",
    "function DeepIntakeChatView",
    "AssistantMessageLabel",
    "assistantModel?: AssistantModelBadge",
    "deepIntakeChatItems",
    "DeepLiveChildWorkflowItem",
    "chat-active-screen",
    "chat-active-scroll",
    "chat-active-grid",
    "session-stream",
    'aria-label="助手回复"',
    'aria-label="计划确认"',
    'aria-label="助手回复"',
    'aria-label="详情"',
  ]);
  assert.equal(deepTranscriptModel.includes("type DeepChatItem"), true);
  assertExcludesAll(deepView, [
    "export function DeepTaskSidebar",
    "export function DeepParentWorkflowPane",
    "export function DeepWorkflowDetailPanel",
    "function DeepChatView",
    "function DeepPanelView",
    "function DeepResultCanvas",
    "function DeepPlanSummary",
    "function DeepRunCounters",
    "<DeepRunTree",
    'from "./deep-run-tree"',
    'from "./deep-conclusion"',
    "DeepStageNavigator",
    "DeepFocusOutput",
    "DeepModelOutputPanel",
    "DeepChildWorklist",
    "DeepWorkflowStrip",
    'className="deep-workflow-strip"',
    "deep-workflow-pending",
    "DeepChildActivityStrip",
    "DeepChildActivityCard",
    "CompactConclusion",
    "DeepBriefDetails",
    "DeepDetailStageRail",
    "DeepRunRefs",
    'aria-label="任务侧栏"',
    'aria-label="协作摘要"',
    'aria-label="当前协作项"',
    'aria-label="材料与产物"',
    'aria-label="父 Agent 工作流"',
    'aria-label="工作流详情"',
    'aria-label="模型工作流"',
    'aria-label="协作进展"',
    'className="deep-flow-canvas"',
    "deep-stage-navigator",
    "deep-process-node",
    "deep-focus-output",
    'className="deep-workbench-layout"',
    'className="deep-workbench-sidebar"',
    'className="deep-workbench-main"',
    'aria-label="Agent 集群模型输出"',
  ]);
  assert.equal(deepView.includes('label: "计划"'), false);
  assert.equal(deepView.includes('label: "探索"'), false);
  assert.equal(deepView.includes('label: "目标"'), false);
  assert.equal(deepTranscriptModel.includes('label: "目标"'), false);
  assert.equal(deepWorkDetailModel.includes('label: "目标"'), true);
  assert.equal(deepView.includes('label: "综合"'), false);
  assert.equal(deepView.includes('label: "结论"'), false);
  assert.equal(deepView.includes('label: "判断"'), false);
  assert.equal(deepView.includes('label: "子任务"'), false);
  assert.equal(deepView.includes('label: "助手"'), false);
  assert.equal(deepTranscriptModel.includes('label: "助手"'), true);
  assert.equal(deepView.includes('label: "父 Agent"'), false);
  assert.equal(deepView.includes("<Bot size={14} />"), false);
  assert.equal(deepView.includes('assistant-message-model">Agent 集群'), false);
  assert.equal(deepView.includes('kind: "user_goal"'), true);
  assert.equal(deepView.includes('kind: "parent_message"'), false);
  assert.equal(deepView.includes('kind: "system_notice"'), false);
  assert.equal(deepTranscriptModel.includes('kind: "parent_message"'), true);
  assert.equal(deepTranscriptModel.includes('kind: "system_notice"'), true);
  assert.equal(deepView.includes("view.brief"), false);
  assert.equal(deepViewModel.includes("view.brief"), true);
  assert.equal(deepView.includes("DeepResultCanvas"), false);
  assert.equal(deepView.includes("resultCanvasState"), false);
  assert.equal(deepView.includes("DeepRunCounters"), false);
  assert.equal(deepView.includes("workboardSummary"), false);
  assert.equal(deepView.includes("deep-brief-chips"), false);
  assert.equal(deepView.includes("modelOutputEntries"), false);
  assert.equal(deepView.includes("childOutputEntries"), false);
  assert.equal(deepView.includes('from "../deep-view-model"'), true);
  assert.equal(deepView.includes('from "../deep-transcript-model"'), true);
  assert.equal(deepView.includes('from "../deep-work-detail-model"'), true);
  assert.equal(deepView.includes("view.liveProjection.decision?.summary"), false);
  assert.equal(deepView.includes("view.report?.childSummaries"), false);
  assert.equal(deepView.includes("view.report?.synthesisRecords.at(-1)"), false);
  assert.equal(deepView.includes("view.report?.conclusion"), false);
  assertIncludesAll(deepView, [
    'export type { DeepWorkItemDetailViewModel } from "../deep-view-model";',
    "AgentWorkTimeline",
    "ActivityItem",
    "function detailTimelineView",
    "function detailActivityItem",
    "function activityStatusBadge",
    "readonly expandedSections?: readonly ActivityExpandedSection[]",
    "conversation={props.conversation}",
    "pendingGoal={props.pendingGoal}",
    "deepIntakeChatItems(props.conversation.intakeTurns, props.intakeStatus)",
    "function DeepRunTranscriptChildListBlock",
    "deep-run-child-list-item",
    'kind: "child_agent_list"',
    "onSelectWorkItem={props.onSelectWorkItem}",
    "view={detailTimelineView(detail.worklineItems)}",
    "执行记录",
    "条动作",
    "child.childRun",
    "label: input.label",
    "DeepUserMessage",
    "DeepConclusionMessage",
    "DeepParentMessage",
    "DeepSystemNotice",
    "ChildTaskApproval",
    "deep-child-task-approval",
    "props.onChildMessage &&",
    "补充给这个协作项",
    "busy={props.busy}",
    'kind: "conclusion"',
    "readonly resynthesisBusy?: boolean",
    "readonly onResynthesize?: () => void | Promise<void>;",
  ]);
  assertIncludesAll(deepTranscriptModel, [
    "export type DeepPlanConfirmationViewModel",
    "export type DeepRunTranscriptViewModel",
    "export type DeepRunTranscriptBlock",
    "function deepPlanConfirmationViewModel",
    "function deepRunTranscriptViewModel",
    "function deepRunTranscriptBlocks",
    "function deepConversationTranscriptBlocks",
    "function managerDecisionComesBeforeChildren",
    "function isChildLifecycleEvent",
    "function runtimeHealthNoticeViewModel",
    "readonly blocks: readonly DeepRunTranscriptBlock[]",
    "readonly children: readonly DeepRunChildSummaryViewModel[]",
    "health?.state !== \"stalled\" && health?.state !== \"orphaned\"",
    "这次运行一段时间没有新进展",
    "这次运行已失联",
  ]);
  assertIncludesAll(deepViewModel, [
    "export type DeepSelectedWorkItem",
    "export function deepRunWorkItemExists",
    "function runTranscriptWorkflowItems",
    "function childAgentSummaryItems",
    "function childAgentSummaryItem",
    "function visibleWorkflowStatusLabel",
    "function meaningfulChildResultText",
    "function isNaturalChildStateText",
    "readonly findings: readonly string[]",
    "readonly evidenceRefs: readonly string[]",
    "view.liveProjection.decision?.summary",
    "view.report?.childSummaries",
    "view.report?.synthesisRecords.at(-1)",
    "view.report?.conclusion",
    "liveChild?.workflowItems",
    "liveChild?.latestResult",
    "export type DeepWorkItemDetailViewModel",
    "export type DeepChildAgentWorkflowSegment",
    "readonly worklineItems: readonly DeepWorklineItemViewModel[]",
    "function childAgentImportantSignal",
    "function childAgentSignalText",
    "function compactWorklineText",
  ]);
  assertIncludesAll(deepWorkDetailModel, [
    "export function synthesisReviewLabel",
    "function childDetailWorklineItems",
    "function deepWorkItemDetailViewModel",
    "function deepWorklineItems",
    "function childRunWorklineItems",
    "function childDetailVisibleWorklineItems",
    "function isChildDetailConcreteActionItem",
    "function childModelMessageWorklineItem",
    "function childModelMessageText",
    "function childToolCallWorklineItem",
    "displayActivityItemsForNodes",
    "function toolCallActivityItem",
    "function toolCallExpandedSections",
    "function toolCallBadges",
    "call.summary ?? call.inputSummary",
    "function executionSegmentWorklineItem",
    "childRun.executionHistory",
    "segment.modelMessages",
    "工具调用前说明",
  ]);
  assertExcludesAll(deepViewModel, [
    "type DeepChatItem",
    "export type DeepPlanConfirmationViewModel",
    "export type DeepRunTranscriptViewModel",
    "export type DeepRunTranscriptBlock",
    "function deepPlanConfirmationViewModel",
    "function deepRunTranscriptViewModel",
    "function deepRunTranscriptBlocks",
    "function deepConversationTranscriptBlocks",
    "function managerDecisionComesBeforeChildren",
    "function isChildLifecycleEvent",
    "function runtimeHealthNoticeViewModel",
    "health?.state !== \"stalled\" && health?.state !== \"orphaned\"",
    "这次运行一段时间没有新进展",
    "这次运行已失联",
    "function childDetailWorklineItems",
    "function deepWorkItemDetailViewModel",
    "function deepWorklineItems",
    "function childRunWorklineItems",
    "function childDetailVisibleWorklineItems",
    "function isChildDetailConcreteActionItem",
    "function childModelMessageWorklineItem",
    "function childModelMessageText",
    "function childToolCallWorklineItem",
    "displayActivityItemsForNodes",
    "function toolCallActivityItem",
    "function toolCallExpandedSections",
    "function toolCallBadges",
    "call.summary ?? call.inputSummary",
    "function executionSegmentWorklineItem",
    "childRun.executionHistory",
    "segment.modelMessages",
    "工具调用前说明",
    "function synthesisReviewLabel",
  ]);
  assertExcludesAll(deepView, [
    "function deepPlanConfirmationViewModel",
    "function deepRunTranscriptViewModel",
    "function deepRunTranscriptBlocks",
    "function deepConversationTranscriptBlocks",
    "function managerDecisionComesBeforeChildren",
    "function isChildLifecycleEvent",
    "export function deepRunWorkItemExists",
    "function runTranscriptWorkflowItems",
    "function childAgentSummaryItems",
    "function childAgentSummaryItem",
    "function visibleWorkflowStatusLabel",
    "function meaningfulChildResultText",
    "function isNaturalChildStateText",
    "function runtimeHealthNoticeViewModel",
    "function childAgentImportantSignal",
    "function childAgentSignalText",
    "function compactWorklineText",
    "function childDetailWorklineItems",
    "function deepWorkItemDetailViewModel",
    "function deepWorklineItems",
    "function childRunWorklineItems",
    "function childDetailVisibleWorklineItems",
    "function isChildDetailConcreteActionItem",
    "function childModelMessageWorklineItem",
    "function childModelMessageText",
    "function childToolCallWorklineItem",
    "displayActivityItemsForNodes",
    "function toolCallActivityItem",
    "function toolCallExpandedSections",
    "function toolCallBadges",
    "call.summary ?? call.inputSummary",
    "function executionSegmentWorklineItem",
    "childRun.executionHistory",
    "segment.modelMessages",
    "工具调用前说明",
    "export type DeepRunConsoleViewModel",
    "function DeepRunConsolePane",
    "function deepRunConsoleViewModel",
    "function runConsoleTimelineView",
    "function runConsoleActivityItem",
    "function runConsoleWorklineItems",
    "function runConsoleWorkflowItems",
    "type DeepTaskSidebarViewModel",
    "type DeepTaskSidebarChildViewModel",
    "function deepTaskSidebarViewModel",
    "function taskSidebarPlanItems",
    "function childTaskSidebarItems",
    "export type DeepAgentWorkflowViewModel",
    "export type DeepWorkflowItemViewModel",
    "export type DeepWorkflowDetailViewModel",
    "export function managerStepDetailViewModels",
    "export function childTaskDetailViewModels",
    "export function synthesisDetailViewModel",
    "export function conclusionDetailViewModel",
    "DeepCollaborationNodeIndex",
    "DeepNodeInspector",
    "deep-node-inspector",
    "deep-child-node-confidence",
    "deep-child-node-uncertainty",
    "child.parentOperation",
    "parentOperationLabel",
    "deep-child-node-parent-op",
    "ChildNodeFollowup",
    "deep-child-node-followup",
    "deep-child-node-followup-toggle",
    "ChildNodeApproval",
    "deep-child-node-approval",
    "补充给这个子 Agent",
    "busy={props.childOperationBusyId !== undefined}",
    "busy={props.childOperationBusyId === child.childRunId}",
    "busy={busy || props.childOperationBusyId === child.childRunId}",
    "deep-work-detail-timeline",
    "deep-work-detail-step",
    "workflowItemTone(",
    "function DeepActivityLine",
    "formatShortTime",
    "formatToolCountSummary",
    "model.workflowItems.map",
    "model.worklineItems.map",
    "detail.worklineItems.map",
    "agent-activity-step deep-run-workflow-item",
    "deep-workline-title",
    "deep-run-child-card",
    "deep-run-child-grid",
    "deep-run-child-section",
    "model.result",
    "deep-run-result",
    "最新结果",
    "deep-run-workflow-active",
    "deep-run-workflow-complete",
    "detail: child.latestResult ?? child.summary",
    "function mergeToolWorklineItems",
    "function canMergeToolWorklineItems",
    "已合并连续工具调用",
    "function childTranscriptResultText",
    'text: childActivityIntro(view.liveProjection.children)',
    'text: `${child.title}：${result}`',
    "return mergeAdjacentAssistantTextBlocks(blocks);",
    "function mergeAssistantText",
    "这个目标还缺少关键范围",
  ]);
  assert.equal(deepView.includes("view.liveProjection.phase === \"needs_input\""), false);
  assert.equal(deepTranscriptModel.includes("view.liveProjection.phase === \"needs_input\""), true);
  assertIncludesAll(transcriptTimeline, [
    "selectedItemKey",
    "onSelectItem",
    "data-selected",
    "aria-pressed={input.selected}",
  ]);
  assert.equal(deepView.includes("运行细节"), false);
  assert.equal(deepView.includes("我正在接手这个目标"), false);
  assert.equal(deepView.includes("协作记录"), false);
  assert.equal(deepView.includes("deep-record-section"), false);
  assert.equal(deepView.includes("deep-resynthesis-button"), false);
  assert.equal(deepView.includes("conclusionNeedsResynthesis"), false);
  assert.equal(deepTranscriptModel.includes("conclusionNeedsResynthesis"), true);
  assert.equal(deepView.includes("deep-resynthesis-state"), false);
  assert.equal(deepView.includes("待重新综合"), false);
  assert.equal(deepTranscriptModel.includes("待重新综合"), true);
  assert.equal(deepView.includes("重新综合"), true);
  assert.equal(deepView.includes("父层重新综合"), false);
  assert.equal(deepView.includes("raw prompt"), false);
  assert.equal(deepView.includes("raw response"), false);
  assert.equal(deepView.includes("API path"), false);
  assert.equal(deepView.includes('"deep.child.instruction_queued"'), false);
  assert.equal(deepView.includes('"deep.child.blocked"'), false);
  assert.equal(deepView.includes('"deep.child.interrupted"'), false);
  assert.equal(deepView.includes('"deep.child.failed"'), false);
  assert.equal(deepRunTree.includes("export function DeepRunTree"), true);
  assert.equal(deepRunTree.includes("busy={props.childOperationBusyId !== undefined}"), true);
  assert.equal(deepRunTree.includes("busy={props.busy || props.childOperationBusyId ==="), false);
  assert.equal(deepConclusion.includes("export function DeepConclusion"), true);
  assert.equal(appDeepLiveUpdates.includes("export function createDeepRunUpdateController"), true);
  assert.equal(appDeepLiveUpdates.includes("/api/deep/runs/"), true);
  assert.equal(appDeepLiveUpdates.includes("openDeepRunStream"), true);
  assert.equal(appDeepLiveUpdates.includes("refreshQueued"), true);
  assert.equal(appDeepLiveUpdates.includes("shouldKeepDeepRunBusy"), true);
  assert.equal(appDeepLiveUpdates.includes("shouldPollDeepRun"), true);
  assert.equal(appDeepLiveUpdates.includes("isTerminalDeepRunStatus"), false);
  assert.equal(app.includes('from "./app-deep-live-updates"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./app-deep-live-updates"'), true);
  assert.equal(app.includes("requestDeepChildMessage(activeDeepRunId, childRunId, message)"), false);
  assert.equal(appDeepTaskController.includes("requestDeepChildMessage(activeDeepRunId, childRunId, message)"), true);
  assert.equal(app.includes("applyQueuedChildOperationProjection(response)"), false);
  assert.equal(appDeepTaskController.includes("applyQueuedChildOperationProjection(response)"), true);
  assert.equal(app.includes('status: "queued" as const'), false);
  assert.equal(appDeepTaskController.includes('status: "queued" as const'), true);
  assert.equal(app.includes("const queuedCount = response.queuedCount"), false);
  assert.equal(appDeepTaskController.includes("const queuedCount = response.queuedCount"), true);
  assert.equal(app.includes("updatedAt: queuedAt"), false);
  assert.equal(appDeepTaskController.includes("updatedAt: queuedAt"), true);
  assert.equal(app.includes('response.status === "queued"'), false);
  assert.equal(appDeepTaskController.includes('response.status === "queued"'), true);
  assert.equal(app.includes("decideDeepChildConfirmation("), false);
  assert.equal(appDeepTaskController.includes("decideDeepChildConfirmation("), true);
  assert.equal(appDeepControl.includes("export async function requestDeepChildMessage"), true);
  assert.equal(appDeepControl.includes("/children/${encodeURIComponent(childRunId)}/messages"), true);
  assert.equal(appDeepControl.includes("export async function decideDeepChildConfirmation"), true);
  assert.equal(appDeepControl.includes("/confirmations/${encodeURIComponent(confirmationId)}/decision"), true);
  assert.equal(appDeepControl.includes("export async function requestDeepRunResynthesis"), true);
  assert.equal(appDeepControl.includes("/resynthesize"), true);
  assert.equal(appDeepControl.includes("export async function requestDeepRunStop"), true);
  assert.equal(appDeepControl.includes("export async function requestDeepRunFollowUp"), true);
  assert.equal(appDeepControl.includes("/follow-up"), true);
  assert.equal(appDeepIntake.includes("export async function requestDeepIntake"), true);
  assert.equal(appDeepIntake.includes("export async function requestStartConfirmedDeepRun"), true);
  assert.equal(appDeepIntake.includes("/api/deep/intake"), true);
  assert.equal(appDeepIntake.includes("/api/deep/conversations/${encodeURIComponent(input.conversationId)}/runs"), true);
  assert.equal(app.includes("requestDeepRunCorrection(activeDeepRunId"), false);
  assert.equal(appDeepTaskController.includes("requestDeepRunCorrection(activeDeepRunId"), true);
  assert.equal(app.includes("requestDeepIntake({"), false);
  assert.equal(appDeepTaskController.includes("requestDeepIntake({"), true);
  assert.equal(app.includes("requestStartConfirmedDeepRun({"), false);
  assert.equal(appDeepTaskController.includes("requestStartConfirmedDeepRun({"), true);
  assert.equal(app.includes('deepIntakeStatus: "running"'), false);
  assert.equal(appDeepTaskController.includes('deepIntakeStatus: "running"'), true);
  assert.equal(app.includes('app.deepIntakeStatus === "plan_ready"'), false);
  assert.equal(appDeepTaskController.includes('options.app.deepIntakeStatus === "plan_ready"'), true);
  assert.equal(app.includes('response.status === "plan_ready" ? terminalActiveRunId : undefined'), false);
  assert.equal(appDeepTaskController.includes('response.status === "plan_ready" ? terminalActiveRunId : undefined'), true);
  assert.equal(app.includes("const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId ?? app.deepSelectedRunId"), false);
  assert.equal(app.includes("const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId"), false);
  assert.equal(appDeepTaskController.includes("const activeDeepRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId"), true);
  assert.equal(app.includes("parentRunConversationId === conversationId"), false);
  assert.equal(appDeepTaskController.includes("parentRunConversationId === conversationId"), true);
  assert.equal(appDeepLiveUpdates.includes("currentPollToken !== pollToken"), true);
  assert.equal(app.includes("requestDeepRunFollowUp("), false);
  assert.equal(app.includes("requestDeepRunResynthesis(activeDeepRunId)"), false);
  assert.equal(appDeepTaskController.includes("requestDeepRunResynthesis(activeDeepRunId)"), true);
  assert.equal(app.includes("requestDeepRunStop(activeDeepRunId)"), false);
  assert.equal(appDeepTaskController.includes("requestDeepRunStop(activeDeepRunId)"), true);
  assert.equal(app.includes("app.deep?.run.runId ?? app.deepActiveRunId"), false);
  assert.equal(appWorkbenchShellProps.includes("options.app.deep?.run.runId ?? options.app.deepActiveRunId"), true);
  assert.equal(appDeepTaskController.includes("options.app.deep?.run.runId ?? options.app.deepActiveRunId"), true);
  assert.equal(app.includes('cancelLabel: "停止"'), false);
  assert.equal(app.includes('"描述要协作处理的目标..."'), false);
  assert.equal(app.includes('"补充要求..."'), false);
  assert.equal(app.includes('"继续围绕当前主题补充..."'), false);
  assert.equal(appWorkbenchInputProps.includes('cancelLabel: "停止"'), true);
  assert.equal(appWorkbenchInputProps.includes('"描述要协作处理的目标..."'), true);
  assert.equal(appWorkbenchInputProps.includes('"补充要求..."'), true);
  assert.equal(appWorkbenchInputProps.includes('"继续围绕当前主题补充..."'), true);
  assert.equal(app.includes('"继续补充这个任务..."'), false);
  assert.equal(app.includes("deepConversation: view.conversation ?? previous.deepConversation"), false);
  assert.equal(appDeepTaskController.includes("deepConversation: view.conversation ?? previous.deepConversation"), true);
  assert.equal(app.includes("const deepConversationId ="), false);
  assert.equal(appDeepTaskController.includes("const deepConversationId ="), true);
  assert.equal(app.includes("app.deep?.conversation?.conversationId"), false);
  assert.equal(appDeepTaskController.includes("options.app.deep?.conversation?.conversationId"), true);
  assert.equal(app.includes("conversationId: deepConversationId"), false);
  assert.equal(appDeepTaskController.includes("conversationId: deepConversationId"), true);
  assert.equal(appDeepLiveUpdates.includes("deepConversation: view.conversation ?? previous.deepConversation"), true);
  assert.equal(appDeepIntake.includes("conversationId: input.conversationId"), true);
  assert.equal(appDeepIntake.includes("parentRunId: input.parentRunId"), true);
  assert.equal(appDeepIntake.includes("taskSoilInput: input.taskSoilInput"), true);
  assert.equal(app.includes("deepRunUpdateController.startPolling(response.run.runId)"), false);
  assert.equal(appDeepTaskController.includes("options.deepRunUpdateController.startPolling(response.run.runId)"), true);
  assert.equal(app.includes("deepPollTimerRef"), false);
  assert.equal(appWorkbenchRuntime.includes("deepPollTimerRef"), true);
  assert.equal(appDeepLiveUpdates.includes("DEEP_POLL_TIMEOUT_MS"), false);
  assert.equal(appDeepLiveUpdates.includes("Agent 集群运行超时"), false);
  assert.equal(app.includes("TODO(T3-4e)"), false);
  assert.equal(app.includes("SkillsPage"), false);
  assert.equal(app.includes("ToolsPage"), false);
  assert.equal(app.includes("onStartSkill"), false);
  assert.equal(app.includes('"general"'), false);
  assert.equal(app.includes('"appearance"'), false);
  assert.equal(app.includes('chatScreen === "skills"'), false);
  assert.equal(app.includes('chatScreen === "tools"'), false);
  assert.equal(app.includes("onNavigate"), false);
  assert.equal(app.includes("parseModelOptionId"), false);
  assert.equal(app.includes("/api/context/attachments/preview"), false);
  assert.equal(app.includes('postJson<ConfigResponse>("/api/config/model-provider"'), false);
  assert.equal(app.includes('postJson<ConfigResponse>("/api/config/model-profiles"'), false);
  assert.equal(app.includes('postJson<ToolsResponse>("/api/config/tools/web-search"'), false);
  assert.equal(app.includes('postJson<{ readonly catalog?: ToolsResponse["mcpCatalog"] }>("/api/config/mcp"'), false);
  assert.equal(api.includes("export class ApiError extends Error"), true);
  assert.equal(api.includes("throw new ApiError(response.status, errorCode(parsed), message)"), true);
  assert.equal(appRuntimeControls.includes("export function stopLiveUpdates"), true);
  assert.equal(appAttachments.includes("export function taskSoilInputFromAttachments"), true);
  assert.equal(appAttachments.includes("export async function previewContextAttachment"), true);
  assert.equal(appAttachments.includes("export async function uploadContextAttachmentFiles"), true);
  assert.equal(appAttachments.includes("export function blockedContextAttachment"), true);
  assert.equal(appAttachments.includes("/api/context/attachments/preview"), true);
  assert.equal(appAttachments.includes("/api/context/attachments/upload"), true);
  assert.equal(appBootstrap.includes("export async function loadAppBootstrap"), true);
  assert.equal(appBootstrap.includes("export function applyAppBootstrap"), true);
  assert.equal(appBootstrap.includes('getJson<ConfigResponse>("/api/config")'), true);
  assert.equal(appBootstrap.includes('getJson<ToolsResponse>("/api/config/tools")'), true);
  assert.equal(appBootstrap.includes('getJson<{ readonly catalog?: readonly McpServerCatalogItem[] }>("/api/config/mcp")'), true);
  assert.equal(appBootstrap.includes("/api/skills"), true);
  assert.equal(appBootstrap.includes('/api/conversations'), true);
  assert.equal(appBootstrap.includes('getJson<ListDeepConversationSummariesResponse>("/api/deep/conversations?limit=50")'), true);
  assert.equal(appBootstrap.includes('getJson<ListDeepRunSummariesResponse>("/api/deep/runs?limit=50")'), true);
  assert.equal(appBootstrap.includes('"conversations" | "deepConversations" | "deepRuns"'), true);
  assert.equal(appState.includes("readonly deepConversations: readonly DeepConversationSummary[]"), true);
  assert.equal(appState.includes("readonly deepRuns: readonly DeepRunSummary[]"), true);
  assert.equal(appState.includes("readonly deepSelectedRunId?: string"), true);
  assert.equal(appState.includes("deepConversations: []"), true);
  assert.equal(appState.includes("deepRuns: []"), true);
  assert.equal(appDeepHistory.includes("export async function listDeepConversations"), true);
  assert.equal(appDeepHistory.includes("export async function getDeepConversation"), true);
  assert.equal(appDeepHistory.includes("export async function listDeepRuns"), true);
  assert.equal(appDeepHistory.includes("/api/deep/conversations?limit="), true);
  assert.equal(appDeepHistory.includes("/api/deep/conversations/${encodeURIComponent(conversationId)}"), true);
  assert.equal(appDeepHistory.includes("/api/deep/runs?limit="), true);
  assert.equal(appDeepHistory.includes("export async function openDeepRun"), true);
  assert.equal(appDeepHistory.includes("/api/deep/runs/${encodeURIComponent(runId)}/view"), true);
  assert.equal(appDeepHistory.includes("deepConversationSummaryFromView"), true);
  assert.equal(appDeepHistory.includes("upsertDeepConversationSummary"), true);
  assert.equal(appDeepHistory.includes("latestRestorableDeepConversation"), true);
  assert.equal(appDeepHistory.includes("latestRestorableDeepRun"), true);
  assert.equal(appDeepHistory.includes("latestActiveDeepRun"), true);
  assert.equal(appDeepHistory.includes("export function shouldKeepDeepRunBusy"), true);
  assert.equal(appDeepHistory.includes("export function shouldPollDeepRun"), true);
  assert.equal(appDeepHistory.includes('health === undefined || health === "active" || health === "stalled"'), true);
  assert.equal(appDeepHistory.includes("isTerminalDeepRunStatus"), true);
  assert.equal(appConfigActions.includes("export async function saveModelProviderConfig"), true);
  assert.equal(appConfigActions.includes("export async function createCustomModelProviderProfile"), true);
  assert.equal(appConfigActions.includes("export async function selectModelProviderModel"), true);
  assert.equal(appConfigActions.includes("export async function fetchModelProviderCatalog"), true);
  assert.equal(appConfigActions.includes("export async function saveToolSettings"), true);
  assert.equal(appConfigActions.includes("export async function saveMcpServerSettings"), true);
  assert.equal(appConfigActions.includes("export async function updateMcpToolState"), true);
  assert.equal(appConfigActions.includes("export async function updateSkillState"), true);
  assert.equal(appConfigActions.includes("export async function refreshSkillCatalog"), true);
  assert.equal(appConfigActions.includes("export async function selectWorkspaceDirectory"), true);
  assert.equal(appConfigActions.includes('postJson<ConfigResponse>("/api/config/model-provider"'), true);
  assert.equal(appConfigActions.includes('postJson<ToolsResponse>("/api/config/tools/web-search"'), true);
  assert.equal(appConfigActions.includes('postJson<{ readonly catalog?: ToolsResponse["mcpCatalog"] }>("/api/config/mcp"'), true);
  assert.equal(appUpdateActions.includes("export function loadAppUpdateStatus"), true);
  assert.equal(appUpdateActions.includes("export function checkAppUpdate"), true);
  assert.equal(appUpdateActions.includes("export function installAppUpdate"), true);
  assert.equal(appUpdateActions.includes('getJson<AppUpdateInfo>("/api/app/update")'), true);
  assert.equal(appUpdateActions.includes('postJson<AppUpdateInfo>("/api/app/update/check"'), true);
  assert.equal(appUpdateActions.includes('postJson<AppUpdateInfo>("/api/app/update/install"'), true);
  assert.equal(appBootstrap.includes("/api/app/update"), true);
  assert.equal(appSettingsController.includes("requestAppUpdateCheck"), true);
  assert.equal(appSettingsController.includes("readonly checkAppUpdate"), true);
  assert.equal(appState.includes("readonly appUpdate?: AppUpdateInfo"), true);
  assert.equal(appConfigProjection.includes("export function mergeConfigResponse"), true);
  assert.equal(appConfigProjection.includes("export function runReasoningSettings"), true);
  assert.equal(appConversationRefresh.includes('from "../../panel-conversation/panel-conversation-refresh"'), true);
  assert.equal(conversationRefresh.includes("export function conversationSummaryNeedsRefresh"), true);
  assert.equal(conversationRefresh.includes("export function conversationSummariesNeedRefresh"), true);
  assert.equal(appConversationRefresh.includes("export function useConversationSummaryRefresh"), true);
  assert.equal(appConversationRefresh.includes("/api/conversations"), true);
  assert.equal(conversationRefresh.includes('"running"'), true);
  assert.equal(conversationRefresh.includes('"approval_needed"'), true);
  assert.equal(conversationRefresh.includes('"needs_input"'), true);
  assert.equal(conversationRefresh.includes("conversation.requiresUserAction === true"), true);
  assert.equal(conversationRefresh.includes("conversation.activeRunId !== undefined"), true);
  assert.equal(conversationRefresh.includes("queuedRunCount"), true);
  assert.equal(appConversationRefresh.includes("safeDesktopDetail"), false);
  assert.equal(appConversationRefresh.includes("safeWorkSession"), false);
  assert.equal(appConversationRefresh.includes("CONVERSATION_SUMMARY_REFRESH_INTERVAL_MS"), true);
  assert.equal(app.includes("mergeConversationTranscriptNodes"), false);
  assert.equal(appRunProjection.includes("export function projectCurrentRun"), true);
  assert.equal(appRunProjection.includes("function mergeConversationTranscriptNodes"), true);
  assert.equal(appWorkbenchRuntime.includes("useConversationSummaryRefresh({"), true);
  assert.equal(appWorkbenchRuntime.includes("void loadAppBootstrap().then((bootstrap) => {"), true);
  assert.equal(appWorkbenchRuntime.includes("stopLiveUpdates(pollTimer, streamRef);"), true);
  assert.equal(appWorkbenchRuntime.includes("const currentRun = useMemo(() => projectCurrentRun(options.app), currentRunProjectionDeps(options.app));"), true);
  assert.equal(appRunController.includes("export function createAppRunController"), true);
  assert.equal(appRunController.includes("submitPanelTask"), true);
  assert.equal(appRunController.includes("optimisticConversationForSubmit"), false);
  assert.equal(appRunController.includes("immediateRunForStartedConversation"), false);
  assert.equal(appRunController.includes("liveRunForObservedReplay"), false);
  assert.equal(appTaskSubmission.includes("export async function submitPanelTask"), true);
  assert.equal(appTaskSubmission.includes("optimisticConversationForSubmit"), true);
  assert.equal(appTaskSubmission.includes("immediateRunForStartedConversation"), true);
  assert.equal(appTaskSubmission.includes("liveRunForObservedReplay"), true);
  assert.equal(appTaskSubmission.includes("runMode"), false);
  assert.equal(appTaskSubmission.includes("/api/desktop/runs"), false);
  assert.equal(appTaskSubmission.includes("/api/underground"), false);
  assert.equal(appConversationSession.includes("liveRunForObservedReplay"), true);
  assert.equal(appConversationSession.includes("observedRunId: latestRunId"), true);
  assert.equal(appConversationSession.includes("replay?.cursor.lastSequence ?? run.eventCursor.lastSequence"), true);
  assert.equal(submitFlow.includes("export function liveRunForObservedReplay"), true);
  assert.equal(appRunController.includes("observedRunId: latestRunId"), false);
  assert.equal(appRunController.includes("replay?.cursor.lastSequence ?? run.eventCursor.lastSequence"), false);
  assert.equal(appRunController.includes("liveUpdates.startLiveUpdates(immediateLiveRunId, 0)"), false);
  assert.equal(appRunController.includes("appendLiveRunEvents(observedRunId, previous.live"), false);
  assert.equal(appRunController.includes("function startLiveUpdates"), false);
  assert.equal(appRunController.includes("function startPolling"), false);
  assert.equal(appRunController.includes("safeWorkSession"), false);
  assert.equal(appRunController.includes("loadObservedRunReadModel"), true);
  assert.equal(appRunController.includes("safeBasicRunView"), false);
  assert.equal(appRunController.includes("ordinaryWorkViewFromRunView"), false);
  assert.equal(appTaskSubmission.includes("options.startLiveUpdates({"), true);
  assert.equal(appTaskSubmission.includes("conversationId: response.conversation.conversationId"), true);
  assert.equal(appTaskSubmission.includes("epoch,"), true);
  assert.equal(appTaskSubmission.includes("loadObservedRunReadModel"), true);
  assert.equal(appTaskSubmission.includes("safeBasicRunView"), false);
  assert.equal(appTaskSubmission.includes("ordinaryWorkViewFromRunView"), false);
  assert.equal(appTaskSubmission.includes("replay?.cursor.lastSequence ?? 0"), true);
  assert.equal(appLiveRunUpdates.includes("export function createLiveRunUpdateController"), true);
  assert.equal(appLiveRunUpdates.includes("function startLiveUpdates"), true);
  assert.equal(appLiveRunUpdates.includes("function startPolling(subscription"), true);
  assert.equal(appLiveRunUpdates.includes("canApplyRunSubscriptionToAppState"), true);
  assert.equal(appLiveRunUpdates.includes("createAppendOnlyRunEventBatcher"), true);
  assert.equal(appLiveRunUpdates.includes("appStateWithAppendOnlyRunEvents"), true);
  assert.equal(appLiveRunUpdates.includes("appendOnlyBatcher.enqueue({ subscription, event })"), true);
  assert.equal(
    appLiveRunUpdates.includes("appendOnlyBatcher.flush();\n      const runView = await fetchBasicRunView(runId, 0);"),
    true
  );
  assert.equal(appLiveRunUpdates.includes("requestAnimationFrame"), true);
  assert.equal(appRunController.includes("function decideConfirmation"), true);
  assert.equal(appRunController.includes("loadConversationSession"), true);
  assert.equal(appRunController.includes("resetConversationSession"), true);
  assert.equal(appRunController.includes("loadConversationTranscriptNodesByRunId"), false);
  assert.equal(appRunController.includes("transcriptNodesByRunId"), false);
  assert.equal(appRunController.includes("taskSoilInputFromAttachments"), false);
  assert.equal(appConversationSession.includes("export async function loadConversationSession"), true);
  assert.equal(appConversationSession.includes("export function resetConversationSession"), true);
  assert.equal(appConversationSession.includes("function isMissingConversationError"), true);
  assert.equal(appConversationSession.includes('error.code === "conversation_not_found"'), true);
  assert.equal(appConversationSession.includes("resetConversationSession(options)"), true);
  assert.equal(app.includes("resetChat();"), false);
  assert.equal(appSidebarConversationController.includes("options.resetChat();"), true);
  assert.equal(appConversationSession.includes("updateTranscriptNodesCache"), true);
  assert.equal(appConversationSession.includes("loadHistoricalTranscriptNodeEntries"), true);
  assert.equal(appConversationSession.includes("HISTORICAL_RUN_LOAD_CONCURRENCY = 4"), true);
  assert.equal(appConversationSession.includes("resetTranscriptNodesCache(conversationId)"), false);
  assert.equal(appConversationSession.includes("resetTranscriptNodesCache()"), false);
  assert.equal(appConversationSession.includes("transcriptNodesByRunId"), true);
  assert.equal(appTaskSubmission.includes("resetTranscriptNodesCache"), false);
  assert.equal(appLiveRunUpdates.includes("function cacheSettledRunTranscriptNodes"), true);
  assert.equal(appLiveRunUpdates.includes("updateTranscriptNodesCache(conversationId"), true);
  assert.equal(transcriptStore.includes("readonly nodesByConversationId"), true);
  assert.equal(transcriptStore.includes("transcriptNodesCacheForConversation"), true);
  assert.equal(transcriptStore.includes("transcriptNodesByRunIdForConversation"), true);
  assert.equal(transcriptStore.includes("subscribeTranscriptNodesCache(\n  conversationId: string | undefined"), true);
  assert.equal(transcriptStore.includes("updateTranscriptNodesCache("), true);
  assert.equal(transcriptStore.includes("notifyTranscriptNodesCache(conversationId)"), true);
  assert.equal(transcriptStore.includes("notifyAllTranscriptNodesCache();\n  } else {\n    notifyTranscriptNodesCache(conversationId);"), true);
  assert.equal(appTaskSubmission.includes("taskSoilInputFromAttachments"), true);
  assert.equal(appObservedRunReadModel.includes("conversation.currentRun"), true);
  assert.equal(appObservedRunReadModel.includes("safeBasicRunView"), true);
  assert.equal(appObservedRunReadModel.includes("ordinaryWorkViewFromRunView(currentRun)"), true);
  assert.equal(appObservedRunReadModel.includes("ordinaryWorkViewFromRunView(view)"), true);
  assert.equal(appObservedRunReadModel.includes("safeBasicRun("), false);
  assert.equal(appObservedRunReadModel.includes("safeWorkSession"), false);
  assert.equal(appObservedRunReadModel.includes("/work-session"), false);
  assert.equal(appObservedRunReadModel.includes("safeDesktopDetail"), false);
  assert.equal(appObservedRunReadModel.includes("safeBasicEvents"), false);
  assert.equal(appSettingsController.includes("export function createAppSettingsController"), true);
  assert.equal(appSettingsController.includes("async function persistModelConfig"), true);
  assert.equal(appSettingsController.includes("async function saveModelConfig"), true);
  assert.equal(appSettingsController.includes("readonly saveModelCapabilities"), true);
  assert.equal(appSettingsController.includes("async function saveModelCapabilities"), true);
  assert.equal(appSettingsController.includes("async function persistModelCapabilities"), true);
  assert.equal(appSettingsController.includes("readonly saveSkillTriggerMode"), true);
  assert.equal(appSettingsController.includes("async function saveSkillTriggerMode"), true);
  assert.equal(appSettingsController.includes("async function createCustomModelProfile"), true);
  assert.equal(appSettingsController.includes("async function fetchModelsForProfile"), true);
  assert.equal(appSettingsController.includes("async function saveWorkspace"), true);
  assert.equal(appSettingsController.includes("async function saveTools"), true);
  assert.equal(appSettingsController.includes("async function saveMcpServer"), true);
  assert.equal(appSettingsController.includes("async function updateMcpTool"), true);
  assert.equal(appSettingsController.includes("async function refreshSkills"), true);
  assert.equal(appSettingsController.includes("async function updateSkill"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("saveModelCapabilityConfig"), true);
  assert.equal(appSettingsController.includes("saveSkillTriggerConfig"), true);
  assert.equal(appSettingsController.includes("saveWorkspaceDirectory"), true);
  assert.equal(appSettingsController.includes("saveToolSettings"), true);
  assert.equal(appSettingsController.includes("saveMcpServerSettings"), true);
  assert.equal(appSettingsController.includes("updateMcpToolState"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(appSettingsController.includes("selectWorkspaceDirectory"), true);
  assert.equal(appWorkbenchRuntime.includes("const settingsController = useMemo(() => createAppSettingsController({"), true);
  assert.equal(appWorkbenchRuntime.includes("const composerController = useMemo(() => createAppComposerController({"), true);
  assert.equal(appWorkbenchRuntime.includes("const deepRunUpdateController = useMemo(() => createDeepRunUpdateController({"), true);
  assert.equal(appWorkbenchRuntime.includes("const runController = useMemo(() => createAppRunController({"), true);
  assert.equal(appState.includes("export type AppState"), true);
  assert.equal(appState.includes("export function createInitialAppState"), true);
  assert.equal(appState.includes("transcriptNodesByRunId"), true);
  assert.equal(appState.includes("readonly skills"), true);
  assert.equal(hasPanelUiModuleReference(settingsDialog, "./capability-settings"), true);
  assert.equal(hasPanelUiModuleReference(settingsDialog, "./skill-settings"), true);
  assert.equal(hasPanelUiModuleReference(settingsDialog, "./workspace-settings"), true);
  assert.equal(settingsDialog.includes('from "./confirmation-settings"'), false);
  assert.equal(hasJsxComponentReference(settingsDialog, "BasicCapabilitiesSettings"), true);
  assert.equal(hasJsxComponentReference(settingsDialog, "McpServiceSettings"), true);
  assert.equal(hasJsxComponentReference(settingsDialog, "SkillSettings"), true);
  assert.equal(hasJsxComponentReference(settingsDialog, "WorkspaceSettings"), true);
  assert.equal(settingsDialog.includes("<ConfirmationSettings"), false);
  assert.equal(settingsDialog.includes("function Capability"), false);
  assert.equal(settingsDialog.includes("function WorkspaceSettings"), false);
  assert.equal(settingsDialog.includes("function ConfirmationSettings"), false);
  assert.equal(hasJsxComponentReference(settingsDialog, "AppearanceSettings"), true);
  assert.equal(settingsDialog.includes("function AppearanceSettings"), false);
  assert.equal(settingsDialog.includes("function AboutSettings"), true);
  assert.equal(settingsDialog.includes("SkillsPage"), false);
  assert.equal(settingsDialog.includes("ToolsPage"), false);
  assert.equal(settingsDialog.includes("onStartSkill"), false);
  assert.equal(settingsDialog.includes("可复用工作方法"), false);
  assert.equal(settingsDialog.includes('label: "助手能力"'), false);
  assert.equal(settingsDialog.includes('label: "能力"'), false);
  assert.equal(settingsDialog.includes("HIDDEN_DEVELOPER_SKILL_MARKERS"), false);
  assert.equal(settingsDialog.includes("function isUserVisibleSkill"), false);
  assert.equal(settingsDialog.includes("接入工具"), false);
  assert.equal(settingsDialog.includes("管理助手可调用"), false);
  assert.equal(settingsDialog.includes("actions={"), false);
  assert.equal(settingsDialog.includes("工作台界面设计"), false);
  assert.equal(settingsDialog.includes("Agent 工作区面板"), false);
  assert.equal(settingsDialog.includes('label: "常规"'), false);
  assert.equal(settingsDialog.includes('label: "界面"'), false);
  assert.equal(settingsDialog.includes("function GeneralSettings"), false);
  assert.equal(settingsDialog.includes('label: "模型服务"'), true);
  assert.equal(settingsDialog.includes('label: "基础能力"'), true);
  assert.equal(settingsDialog.includes('label: "MCP 服务"'), true);
  assert.equal(settingsDialog.includes('label: "技能"'), true);
  assert.equal(settingsDialog.includes('label: "工作区"'), true);
  assert.equal(settingsDialog.includes('label: "命令确认"'), false);
  assert.equal(settingsDialog.includes('label: "外观"'), true);
  assert.equal(settingsDialog.includes('label: "关于"'), true);
  assert.equal(settingsDialog.includes('label: "确认边界"'), false);
  assert.equal(settingsDialog.includes("onSaveModelCapabilities"), true);
  assert.equal(capabilitySettings.includes("export function BasicCapabilitiesSettings"), true);
  assert.equal(capabilitySettings.includes("export function McpServiceSettings"), true);
  assert.equal(capabilitySettings.includes("function ModelInformationSettings"), true);
  assert.equal(capabilitySettings.includes("function WebSearchSettings"), true);
  assert.equal(capabilitySettings.includes("function McpServiceBoard"), true);
  assert.equal(capabilitySettings.includes("modelCapabilityTargets"), true);
  assert.equal(capabilitySettings.includes("model-info-card"), true);
  assert.equal(capabilitySettings.includes("模型信息"), true);
  assert.equal(capabilitySettings.includes("McpReferencePanel"), true);
  assert.equal(capabilitySettings.includes("onLoadMcpReferences"), true);
  assert.equal(capabilitySettings.includes("网络搜索"), true);
  assert.equal(capabilitySettings.indexOf("<WebSearchSettings") < capabilitySettings.indexOf("<DesktopAgentPromptSettings"), true);
  assert.equal(capabilitySettings.indexOf("<DesktopAgentPromptSettings") < capabilitySettings.indexOf("<SkillTriggerSettings"), true);
  assert.equal(capabilitySettings.indexOf("<SkillTriggerSettings") < capabilitySettings.indexOf("<ModelInformationSettings"), true);
  assert.equal(capabilitySettings.includes("网页查证"), false);
  assert.equal(capabilitySettings.includes('from "../app-config-actions"'), false);
  assert.equal(capabilitySettings.includes("模型能力"), false);
  assert.equal(capabilitySettings.includes("MCP 服务"), true);
  assert.equal(capabilitySettings.includes("视觉输入"), true);
  assert.equal(capabilitySettings.includes("思考强度"), true);
  assert.equal(capabilitySettings.includes("上下文窗口"), true);
  assert.equal(capabilitySettings.includes("最大输出"), true);
  assert.equal(capabilitySettings.includes("API 风格"), false);
  assert.equal(capabilitySettings.includes("稳定性"), false);
  assert.equal(capabilitySettings.includes("验证日期"), false);
  assert.equal(capabilitySettings.includes("工具调用"), false);
  assert.equal(capabilitySettings.includes("并行工具"), false);
  assert.equal(capabilitySettings.includes("结构化输出"), false);
  assert.equal(capabilitySettings.includes("流式输出"), false);
  assert.equal(capabilitySettings.includes("推理输出"), false);
  assert.equal(capabilitySettings.includes("overrideCapabilities"), true);
  assert.equal(capabilitySettings.includes("这里配置可用服务和安全边界"), false);
  assert.equal(capabilitySettings.includes("由模型按任务判断"), false);
  assert.equal(capabilitySettings.includes("不替助手决定"), false);
  assert.equal(capabilitySettings.includes("工作方法"), false);
  assert.equal(skillSettings.includes("export function SkillSettings"), true);
  assert.equal(skillSettings.includes("工作方法"), false);
  assert.equal(skillSettings.includes("按任务触发的工作流说明"), false);
  assert.equal(skillSettings.includes("暂无技能"), true);
  assert.equal(skillSettings.includes('aria-label="技能列表"'), true);
  assert.equal(skillSettings.includes("SKILL.md"), false);
  assert.equal(skillSettings.includes("sourcePath"), false);
  assert.equal(skillSettings.includes("按任务匹配"), false);
  assert.equal(skillSettings.includes("最近使用"), true);
  assert.equal(capabilitySettings.includes("接入工具"), false);
  assert.equal(capabilitySettings.includes("管理助手可调用"), false);
  assert.equal(workspaceSettings.includes("export function WorkspaceSettings"), true);
  assert.equal(workspaceSettings.includes("这是助手可使用的本地上下文边界"), false);
  assert.equal(app.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appRunController.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appConversationSession.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appConversationSession.includes('from "../../panel-read-model/transcript/panel-transcript-cache"'), true);
  assert.equal(app.includes("shouldShowProviderIcon"), false);
  assert.equal(sidebar.includes('export type Screen = "chat-empty" | "chat-active"'), true);
  assert.equal(sidebar.includes("NAV_ITEMS"), false);
  assert.equal(sidebar.includes("onNavigate"), false);
  assert.equal(sidebar.includes("工作方式"), false);
  assert.equal(sidebar.includes("Wrench"), false);
  assert.equal(sidebar.includes("Folder"), true);
  assert.equal(sidebar.includes("groupSidebarItemsByWorkspaceFolder"), true);
  assert.equal(sidebar.includes("SidebarFolderHeading"), true);
  assert.equal(sidebar.includes("workspaceFolder"), true);
  assert.equal(sidebar.includes("未归类"), true);
  assert.equal(sidebar.includes("DEFAULT_FOLDER_CONVERSATION_LIMIT = 5"), true);
  assert.equal(sidebar.includes("expandedConversationGroupKeys"), true);
  assert.equal(sidebar.includes("defaultVisibleCount={DEFAULT_FOLDER_CONVERSATION_LIMIT}"), true);
  assert.equal(sidebar.includes("props.conversations.slice(0, defaultVisibleCount)"), true);
  assert.equal(sidebar.includes("sidebar-folder-more-button"), true);
  assert.equal(sidebar.includes("createPortal"), false);
  assert.equal(sidebar.includes("MoreHorizontal"), false);
  assert.equal(sidebar.includes("PencilLine"), false);
  assert.equal(sidebar.includes("  Pin,"), false);
  assert.equal(sidebar.includes("Trash2"), false);
  assert.equal(sidebar.includes("  Plus,"), true);
  assert.equal(sidebar.includes("  Network,"), true);
  assert.equal(sidebar.includes("agentClusterActive"), true);
  assert.equal(sidebar.includes("agentClusterEnabled"), true);
  assert.equal(sidebar.includes("onOpenAgentCluster"), true);
  assert.equal(sidebar.includes("deepConversations"), true);
  assert.equal(sidebar.includes("deepRuns"), true);
  assert.equal(sidebar.includes("activeDeepConversationId"), true);
  assert.equal(sidebar.includes("activeDeepRunId"), true);
  assert.equal(sidebar.includes("onOpenDeepConversation"), true);
  assert.equal(sidebar.includes("onOpenDeepRun"), true);
  assert.equal(sidebar.includes("DeepConversationGroup"), true);
  assert.equal(sidebar.includes("DeepConversationFolderGroup"), true);
  assert.equal(sidebar.includes("expandedRunGroupKeys"), true);
  assert.equal(sidebar.includes("props.runs.slice(0, 24)"), false);
  assert.equal(sidebar.includes("props.conversations.slice(0, DEFAULT_FOLDER_CONVERSATION_LIMIT)"), true);
  assert.equal(sidebar.includes("DeepConversationListItem"), true);
  assert.equal(sidebar.includes("deepConversationSummaryFromRun"), true);
  assert.equal(sidebar.includes("暂无 Agent 集群任务"), true);
  assert.equal(sidebar.includes("!props.agentClusterActive && props.pendingCount > 0"), true);
  assert.equal(sidebar.includes("多 Agent 任务"), false);
  assert.equal(sidebar.includes("sidebar-deep-run-row"), true);
  assert.equal(sidebar.includes("function deepRunRuntimeHealthLabel"), true);
  assert.equal(sidebar.includes("暂无新进展"), true);
  assert.equal(sidebar.includes("已失联"), true);
  assert.equal(sidebar.includes("health === undefined || health === \"active\" || health === \"stalled\""), true);
  assert.equal(sidebar.includes("疑似卡住"), false);
  assert.equal(sidebar.includes("Agent 集群"), true);
  assert.equal(sidebar.includes("Deep 模式"), false);
  assert.equal(appWorkbenchShellProps.includes("export function buildSidebarProps"), true);
  assert.equal(app.includes("agentClusterActive={agentClusterActive}"), false);
  assert.equal(app.includes("agentClusterEnabled={agentClusterEnabled}"), false);
  assert.equal(app.includes('activeConversationId={agentClusterActive ? undefined : app.conversation?.conversationId}'), false);
  assert.equal(app.includes('deepConversations={app.deepConversations}'), false);
  assert.equal(app.includes('deepRuns={app.deepRuns}'), false);
  assert.equal(app.includes("activeDeepConversationId={app.deepConversation?.conversationId ?? app.deep?.run.conversationId}"), false);
  assert.equal(appWorkbenchShellProps.includes("agentClusterActive: options.agentClusterActive"), true);
  assert.equal(appWorkbenchShellProps.includes("agentClusterEnabled: options.agentClusterEnabled"), true);
  assert.equal(appWorkbenchShellProps.includes("activeConversationId: options.agentClusterActive ? undefined : options.app.conversation?.conversationId"), true);
  assert.equal(appWorkbenchShellProps.includes("deepConversations: options.app.deepConversations"), true);
  assert.equal(appWorkbenchShellProps.includes("deepRuns: options.app.deepRuns"), true);
  assert.equal(appWorkbenchShellProps.includes("activeDeepConversationId: options.app.deepConversation?.conversationId ?? options.app.deep?.run.conversationId"), true);
  assert.equal(app.includes("activeDeepRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}"), false);
  assert.equal(app.includes("activeDeepRunId={app.deep?.run.runId ?? app.deepActiveRunId}"), false);
  assert.equal(appWorkbenchShellProps.includes("activeDeepRunId: options.app.deep?.run.runId ?? options.app.deepActiveRunId"), true);
  assert.equal(app.includes("pinningConversationIds={pinningConversationIds}"), false);
  assert.equal(appWorkbenchShellProps.includes("pinningConversationIds: options.pinningConversationIds"), true);
  assert.equal(app.includes("patchConversationPinnedAt(previous, conversationId, optimisticPinnedAt)"), false);
  assert.equal(app.includes("patchConversationPinnedAt(previous, conversationId, previousPinnedAt)"), false);
  assert.equal(appSidebarConversationController.includes("patchConversationPinnedAt(previous, conversationId, optimisticPinnedAt)"), true);
  assert.equal(appSidebarConversationController.includes("patchConversationPinnedAt(previous, conversationId, previousPinnedAt)"), true);
  assert.equal(appSidebarConversationController.includes("patchDeepConversationPinnedAt(previous, conversationId, optimisticPinnedAt)"), true);
  assert.equal(appSidebarConversationController.includes("patchDeepConversationPinnedAt(previous, conversationId, previousPinnedAt)"), true);
  assert.equal(appSidebarConversationController.includes("setConversationPinning(conversationId, true)"), true);
  assert.equal(appSidebarConversationController.includes("options.pinningConversationIdsRef.current"), true);
  assert.equal(app.includes("onOpenDeepConversation={(conversationId) => void openAgentClusterConversation(conversationId)}"), false);
  assert.equal(app.includes("onOpenDeepRun={(runId) => void openAgentClusterRun(runId)}"), false);
  assert.equal(appWorkbenchShellProps.includes("onOpenDeepConversation: options.onOpenDeepConversation"), true);
  assert.equal(appWorkbenchShellProps.includes("onOpenDeepRun: options.onOpenDeepRun"), true);
  assert.equal(app.includes("onOpenAgentCluster={openAgentClusterEntry}"), false);
  assert.equal(sidebar.includes("sidebar-brand"), false);
  assert.equal(sidebar.includes("document.addEventListener(\"pointerdown\""), true);
  assert.equal(sidebar.includes("document.addEventListener(\"keydown\""), true);
  assert.equal(sidebar.includes("document.addEventListener(\"scroll\""), true);
  assert.equal(sidebar.includes("data-sidebar-menu-owner"), true);
  assert.equal(sidebar.includes("function menuOwnerFromTarget"), true);
  assert.equal(sidebar.includes("function positionConversationMenu"), true);
  assert.equal(sidebar.includes("React.useLayoutEffect"), true);
  assert.equal(sidebar.includes("conversationOverrides"), false);
  assert.equal(sidebar.includes("renamingConversationId"), false);
  assert.equal(sidebar.includes("openConversationMenu"), false);
  assert.equal(sidebar.includes("EllipsisVertical"), true);
  assert.equal(sidebar.includes("sidebar-kebab-button"), true);
  assert.equal(sidebar.includes("重命名"), true);
  assert.equal(sidebar.includes("置顶"), true);
  assert.equal(sidebar.includes("readonly pinningConversationIds: ReadonlySet<string>"), true);
  assert.equal(sidebar.includes("props.pinningConversationIds.has(conversation.conversationId)"), true);
  assert.equal(sidebar.includes('props.pinning ? "更新中"'), true);
  assert.equal(sidebar.includes("删除"), true);
  assert.equal(sidebar.includes("sidebarConversationTone"), false);
  assert.equal(sidebar.includes("sidebarConversationStatusLabel"), false);
  assert.equal(sidebar.includes("sidebarConversationPriority"), false);
  assert.equal(sidebar.includes("sidebarConversationAction"), false);
  assert.equal(sidebar.includes("等待你确认、拒绝或补充指导。"), false);
  assert.equal(sidebar.includes("等待前序任务完成后自动继续。"), false);
  assert.equal(sidebar.includes("结果已生成，可打开继续追问。"), false);
  assert.equal(sidebar.includes("menu-open"), true);
  assert.equal(sidebar.includes("sidebar-status-pill"), false);
  assert.equal(sidebar.includes("sidebar-confirmation-card"), false);
  assert.equal(sidebar.includes("sidebar-pending-reminder"), true);
  assert.equal(shellStyles.includes(".sidebar-status-pill"), false);
  assert.equal(shellStyles.includes(".sidebar-conversation-action"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-actions"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-more"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-menu"), false);
  assert.equal(shellStyles.includes(".sidebar-rename-input"), false);
  assert.equal(shellStyles.includes(".sidebar-brand"), false);
  assert.equal(shellStyles.includes(".sidebar-kebab-button"), true);
  assert.equal(shellStyles.includes(".sidebar-recent-item:hover .sidebar-kebab-button"), true);
  assert.equal(shellStyles.includes(".sidebar-conversation-menu"), true);
  assert.equal(shellStyles.includes("position: fixed"), true);
  assert.equal(shellStyles.includes(".sidebar-recent-item.attention"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-item.problem"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-item.active"), true);
  assert.equal(shellStyles.includes(".sidebar-deep-run-row"), true);
  assert.equal(shellStyles.includes(".sidebar-deep-run-status"), true);
  assert.equal(shellStyles.includes(".sidebar-deep-run-status-stalled"), true);
  assert.equal(shellStyles.includes(".sidebar-deep-run-status-orphaned"), true);
  assert.equal(shellStyles.includes(".sidebar-deep-run-copy"), true);
  assert.equal(shellStyles.includes(".sidebar-folder-heading"), true);
  assert.equal(shellStyles.includes(".sidebar-folder-more-button"), true);
  assert.equal(deepStyles.includes(".multi-agent-workspace"), true);
  assertIncludesAll(deepStyles, [
    ".multi-agent-body",
    ".multi-agent-primary",
    ".multi-agent-reading-shell",
    ".multi-agent-stage",
    ".multi-agent-commandbar",
    ".with-work-detail",
    "grid-template-columns: minmax(0, 1fr) clamp",
    ".deep-chat-view",
    ".deep-chat-thread",
    ".assistant-message",
    ".assistant-answer",
    ".user-message-wrap",
    ".deep-plan-confirmation",
    ".deep-run-transcript",
    ".deep-run-transcript-thread",
    ".deep-run-child-list",
    ".deep-run-child-list-item",
    ".deep-work-detail-panel",
    ".deep-work-detail-actionbar",
    ".deep-work-detail-composer",
    ".deep-child-task-approval",
  ]);
  assertExcludesAll(deepStyles, [
    ".multi-agent-missionbar",
    ".multi-agent-inspector",
    ".with-task-sidebar",
    ".with-workflow-detail",
    ".with-side-panel",
    ".deep-panel-view",
    ".deep-panel-scroll",
    ".deep-result-canvas",
    ".deep-result-head",
    ".deep-run-transcript-activity-block",
    ".deep-run-counters",
    ".deep-progress-log",
    ".deep-run-console",
    ".deep-run-workflow",
    ".deep-run-console-kicker",
    ".deep-run-console-goal-icon",
    ".deep-run-workflow .agent-activity-chip.meta",
    ".deep-workboard-result",
    ".deep-workboard-objective",
    ".deep-tree-live-map",
    ".deep-tree-live-node",
    ".multi-agent-history-list",
    ".multi-agent-run-facts",
    "flex: 0 0 280px",
    ".deep-task-sidebar",
    ".deep-task-sidebar-plan",
    ".deep-task-sidebar-child",
    ".deep-task-sidebar-actionbar",
    ".deep-task-sidebar-composer",
    ".deep-run-child-card",
    ".deep-run-child-grid",
    ".deep-run-child-section",
    ".deep-run-result",
    ".deep-chat-child-strip",
    ".deep-chat-child-card",
    ".deep-flow-canvas",
    ".deep-focus-output",
    ".deep-stage-navigator",
    ".deep-run-workflow-item",
    ".deep-workline-title",
    ".deep-workline-spin",
  ]);
  assert.equal(deepStyles.includes(".deep-child-node-followup-toggle"), false);
  assert.equal(deepStyles.includes("min-height: 0"), true);
  assert.equal(deepStyles.includes("overflow-y: auto"), true);
  assert.equal(deepStyles.includes("flex-direction: column"), true);
  assert.equal(deepStyles.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(app.includes("sidebarCollapsed"), true);
  assert.equal(app.includes("onToggleSidebar"), true);
  assert.equal(app.includes("PanelLeftClose"), false);
  assert.equal(app.includes("PanelLeftOpen"), false);
  assert.equal(workbenchShell.includes("data-startup-intro"), true);
  assert.equal(workbenchShell.includes("data-sidebar-collapsed"), true);
  assert.equal(workbenchShell.includes("app-workbench-header"), true);
  assert.equal(workbenchShell.includes("onToggleSidebar"), true);
  assert.equal(workbenchShell.includes("PanelLeftClose"), true);
  assert.equal(workbenchShell.includes("PanelLeftOpen"), true);
  assert.equal(sidebar.includes("onToggleCollapsed"), false);
  assert.equal(sidebar.includes("PanelLeftClose"), false);
  assert.equal(sidebar.includes("PanelLeftOpen"), false);
  assert.equal(shellStyles.includes(".app-workbench-sidebar-toggle"), true);
  assert.equal(app.includes("Maximize2"), false);
  assert.equal(app.includes("Minimize2"), false);
  assert.equal(app.includes("getWindowState"), false);
  assert.equal(app.includes("onWindowStateChanged"), false);
  assert.equal(workbenchShell.includes("Maximize2"), true);
  assert.equal(workbenchShell.includes("Minimize2"), true);
  assert.equal(workbenchShell.includes("getWindowState"), true);
  assert.equal(workbenchShell.includes("onWindowStateChanged"), true);
  assert.equal(workbenchShell.includes("app-window-controls"), true);
  assert.equal(app.includes("Square"), false);
  assert.equal(shellStyles.includes('data-window-animating="true"'), true);
  assert.equal(app.includes("window.confirm"), false);
  assert.equal(app.includes("(response.conversations ?? previous.conversations).filter"), false);
  assert.equal(appSidebarConversationController.includes("(response.conversations ?? previous.conversations).filter"), true);
  assert.equal(shellStyles.includes(".topbar"), false);
  assert.equal(shellStyles.includes(".topbar-sidebar-button"), false);
  assert.equal(shellStyles.includes(".topbar-chip"), false);
  assert.equal(shellStyles.includes(".app-mode-switch"), false);
  assert.equal(shellStyles.includes(".app-mode-switch-button"), false);
  assert.equal(shellStyles.includes(".app-workbench-brand"), false);
  assert.equal(shellStyles.includes(".sidebar-agent-cluster-button"), true);
  assert.equal(motionResponsiveStyles.includes(".topbar-chip"), false);
  assert.equal(chatEmpty.includes("composer-options-button"), true);
  assert.equal(chatEmpty.includes("composer-options-popover"), true);
  assert.equal(chatEmpty.includes("composer-workspace-button"), true);
  assert.equal(chatEmpty.includes("workspace-pill"), false);
  assert.equal(chatEmpty.includes("onClearWorkspaceDirectory"), false);
  assert.equal(chatEmpty.includes("当前工作区"), false);
  assert.equal(chatEmpty.includes("attachmentMediaPreview"), true);
  assert.equal(chatEmpty.includes("attachment-image-thumbnail"), true);
  assert.equal(chatTranscriptChain.includes("UserMessageAttachments"), true);
  assert.equal(chatTranscriptChain.includes("user-message-image-attachment"), true);
  assert.equal(chatEmpty.includes("model-select-button"), false);
  assert.equal(chatComposerStyles.includes(".composer-options-button"), true);
  assert.equal(chatComposerStyles.includes(".composer-options-popover"), true);
  assert.equal(chatComposerStyles.includes(".composer-workspace-button"), true);
  assert.equal(chatComposerStyles.includes(".attachment-image-card"), true);
  assert.equal(chatComposerStyles.includes(".attachment-image-thumbnail"), true);
  assert.equal(chatMessageStyles.includes(".user-message-image-attachment"), true);
  assert.equal(chatComposerStyles.includes(".model-select-button"), false);
  assert.equal(motionResponsiveStyles.includes(".model-select-button"), false);
  assert.equal(workspaceStyles.includes(".skill-card"), false);
  assert.equal(workspaceStyles.includes(".tool-row"), false);
  assert.equal(workspaceStyles.includes(".workspace-tabs"), false);
  assert.equal(workspaceStyles.includes(".workspace-search"), false);
  assert.equal(workspaceStyles.includes(".service-settings-stack"), true);
  assert.equal(workspaceStyles.includes(".model-info-card"), true);
  assert.equal(workspaceStyles.includes(".model-info-grid"), true);
  assert.equal(workspaceStyles.includes(".capability-settings-stack"), false);
  assert.equal(workspaceStyles.includes(".capability-toggle"), true);
  assert.equal(workspaceStyles.includes(".mcp-service-card"), true);
  assert.equal(workspaceStyles.includes(".mcp-form-grid"), true);
  assert.equal(workspaceStyles.includes(".settings-capabilities"), false);
  assert.equal(workspaceStyles.includes(".service-config-grid"), true);
});

test("panel UI native title tooltips stay limited to context usage ring", async () => {
  const sourceRoot = path.join(process.cwd(), "src", "app", "panel-ui", "src");
  const files = await listPanelUiSourceFiles(sourceRoot);
  const nativeTitlePattern = /<([a-z][\w.-]*)(?=[\s>/])[^>]*\btitle\s*=/gms;
  const findings: {
    file: string;
    tag: string;
    tagSource: string;
  }[] = [];

  await Promise.all(files.map(async (file) => {
    const source = await fs.readFile(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = nativeTitlePattern.exec(source)) !== null) {
      findings.push({
        file: path.relative(sourceRoot, file).replaceAll("\\", "/"),
        tag: match[1],
        tagSource: match[0],
      });
    }
  }));

  assert.deepEqual(
    findings.filter((finding) =>
      finding.file !== "components/chat-empty.tsx" ||
      finding.tag !== "span" ||
      !finding.tagSource.includes('className="composer-context-usage"')
    ),
    [],
  );
});

test("panel UI subscribes to ordinary sub-agent stream events", async () => {
  const runtime = await readPanelUiSource("runtime.ts");

  assertIncludesAll(runtime, [
    '"sub_agent.started"',
    '"sub_agent.completed"',
    '"sub_agent_batch.started"',
    '"sub_agent_batch.completed"',
  ]);
});

test("multi Agent run tree exposes child Agent frozen instructions in details", async () => {
  const [deepContract, deepRunTree, deepStyles] = await Promise.all([
    readPanelUiSource(path.join("contracts", "deep.ts")),
    readPanelUiSource(path.join("components", "deep-run-tree.tsx")),
    readPanelUiStyle("deep-view.css"),
  ]);

  assert.equal(deepContract.includes("export type DeepAgentSpecInstructionsView"), true);
  assert.equal(deepContract.includes("readonly instructions?: DeepAgentSpecInstructionsView"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunExecutionView"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunModelMessageTraceView"), true);
  assert.equal(deepContract.includes("readonly modelMessages?: readonly DeepChildAgentRunModelMessageTraceView[]"), true);
  assert.equal(deepContract.includes("readonly execution?: DeepChildAgentRunExecutionView"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunExecutionSegmentView"), true);
  assert.equal(deepContract.includes("readonly executionHistory?: readonly DeepChildAgentRunExecutionSegmentView[]"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunParentInstructionView"), true);
  assert.equal(deepContract.includes("readonly messageRef?: string"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunParentReviewView"), true);
  assert.equal(deepContract.includes("readonly review?: DeepChildAgentRunParentReviewView"), true);
  assert.equal(deepContract.includes("export type DeepLiveChildParentOperationProjection"), true);
  assert.equal(deepContract.includes("readonly parentOperation?: DeepLiveChildParentOperationProjection"), true);
  assert.equal(deepContract.includes("readonly parentInstructions?: readonly DeepChildAgentRunParentInstructionView[]"), true);
  assert.equal(deepContract.includes("export type DeepParentSynthesisChildReviewView"), true);
  assert.equal(deepContract.includes("readonly childReviews?: readonly DeepParentSynthesisChildReviewView[]"), true);
  assert.equal(deepContract.includes("export type DeepChildAgentRunPendingApprovalView"), true);
  assert.equal(deepContract.includes("readonly pendingApproval?: DeepChildAgentRunPendingApprovalView"), true);
  assert.equal(deepContract.includes("export type DeepChildOperationResponse"), true);
  assert.equal(deepContract.includes("export type DeepRunResynthesisResponse"), true);
  assert.equal(deepContract.includes('readonly status?: "queued" | "continued"'), true);
  assert.equal(deepContract.includes("readonly queuedCount?: number"), true);
  assert.equal(deepContract.includes("readonly queuedAt?: string"), true);
  assert.equal(deepContract.includes("readonly childStatus?: DeepChildRunStatus"), true);
  assert.equal(deepContract.includes("export type DeepChildConfirmationResponse"), true);
  assert.equal(deepRunTree.includes("run.spec.instructions?.objective ?? summary?.spec.objective"), true);
  assert.equal(deepRunTree.includes('className="deep-child-objective"'), true);
  assert.equal(deepRunTree.includes('className="deep-child-execution"'), true);
  assert.equal(deepRunTree.includes('className="deep-child-approval"'), true);
  assert.equal(deepRunTree.includes("function ChildMessageControls"), true);
  assert.equal(deepRunTree.includes("function ChildConfirmationControls"), true);
  assert.equal(deepRunTree.includes("function LiveChildRunNode"), true);
  assert.equal(deepRunTree.includes("function ChildApprovalBlock"), true);
  assert.equal(deepRunTree.includes("child.pendingApproval"), true);
  assert.equal(deepRunTree.includes('placeholder="补充给这个协作项..."'), true);
  assert.equal(deepRunTree.includes('aria-label="协作项确认操作"'), true);
  assert.equal(deepRunTree.includes("pendingApproval.actionSummary"), true);
  assert.equal(deepRunTree.includes("pendingApproval.resumeAvailability"), true);
  assert.equal(deepRunTree.includes("run.execution.modelRounds"), true);
  assert.equal(deepRunTree.includes("run.execution.toolRounds"), true);
  assert.equal(deepRunTree.includes("run.executionHistory.length"), true);
  assert.equal(deepRunTree.includes("执行段 {run.executionHistory.length}"), true);
  assert.equal(deepRunTree.includes("run.parentInstructions.length"), true);
  assert.equal(deepRunTree.includes("跟进 {run.parentInstructions.length}"), true);
  assert.equal(deepRunTree.includes("instruction.messageRef ?? instruction.instructionId"), false);
  assert.equal(deepRunTree.includes("parentInstructionReviewTitle"), false);
  assert.equal(deepRunTree.includes("SYNTHESIS_CHILD_REVIEW_LABEL"), true);
  assert.equal(deepRunTree.includes("synthesis.childReviews.map"), true);
  assert.equal(deepRunTree.includes('aria-label="协作审查"'), true);
  assert.equal(deepRunTree.includes('className="deep-synthesis-review-reason"'), true);
  assert.equal(deepStyles.includes(".deep-child-objective"), true);
  assert.equal(deepStyles.includes(".deep-child-execution"), true);
  assert.equal(deepStyles.includes(".deep-child-node-parent-op"), false);
  assert.equal(deepStyles.includes(".deep-parent-workflow-pane"), false);
  assert.equal(deepStyles.includes(".deep-parent-workflow-list"), false);
  assert.equal(deepStyles.includes(".deep-workflow-detail-panel"), false);
  assert.equal(deepStyles.includes(".deep-workflow-detail-actionbar"), false);
  assert.equal(deepStyles.includes(".deep-task-sidebar"), false);
  assert.equal(deepStyles.includes(".deep-task-sidebar-actionbar"), false);
  assert.equal(deepStyles.includes(".deep-collaboration-node-index"), false);
  assert.equal(deepStyles.includes(".deep-node-inspector-actionbar"), false);
  assert.equal(deepStyles.includes(".deep-child-approval"), true);
  assert.equal(deepStyles.includes(".deep-child-followup"), true);
  assert.equal(deepStyles.includes(".deep-child-approval-actions"), true);
  assert.equal(deepStyles.includes(".deep-child-guidance"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review-decision.accepted"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review-reason"), true);
  assert.equal(deepStyles.includes(".deep-resynthesis-state"), false);
  assert.equal(deepStyles.includes(".deep-compact-conclusion.needs-resynthesis"), true);
  assert.equal(deepStyles.includes("--success-text"), false);
  assert.equal(deepStyles.includes("--success-soft"), false);
});

function hasPanelUiModuleReference(source: string, modulePath: string): boolean {
  return source.includes(`from "${modulePath}"`) || source.includes(`import("${modulePath}")`);
}

function hasJsxComponentReference(source: string, componentName: string): boolean {
  return source.includes(`<${componentName}`) || source.includes(`<Lazy${componentName}`);
}

function assertIncludesAll(source: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`Expected source to include: ${pattern}`);
    }
  }
}

function assertExcludesAll(source: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    if (source.includes(pattern)) {
      throw new Error(`Expected source to exclude: ${pattern}`);
    }
  }
}

async function listPanelUiSourceFiles(root: string): Promise<readonly string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listPanelUiSourceFiles(fullPath);
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      return [fullPath];
    }
    return [];
  }));
  return nested.flat();
}
