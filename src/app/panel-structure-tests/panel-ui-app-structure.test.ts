import test from "node:test";
import {
  assert,
  hasPanelUiModuleReference,
  readPanelUiAppStructureSources,
} from "./panel-ui-app-structure-sources.js";

test("panel UI app shell delegates runtime data and control work", async () => {
  const {
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
  } = await readPanelUiAppStructureSources();

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
  assert.equal(appWorkbenchRuntime.includes('from "../../panel-context-window-usage"'), false);
  assert.equal(appWorkbenchRuntime.includes('from "./context-window-usage"'), true);
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
  assert.equal(appQueuedMessageState.includes("dispatchedQueueAfterRunRef"), true);
  assert.equal(appQueuedMessageState.includes("queuedMessageDispatchDecision"), true);
  assert.equal(appQueuedMessageState.includes("queuedMessageMayFollow"), true);
  assert.equal(appQueuedMessageState.includes("queueReadyAfterRunRef"), false);
  assert.equal(appQueuedMessageState.includes("previousRunActivityRef"), false);
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
  assert.equal(appWorkbenchTaskState.includes("const workspace = app.conversation.workspaceFolder"), true);
  assert.equal(appWorkbenchTaskState.includes("const workspace = app.deep.run.workspaceFolder"), true);
  assert.equal(appWorkbenchTaskState.includes('workspace?.selection === "explicit" ? workspace.path : undefined'), true);
  assert.equal(app.includes("summary?.workspaceFolder?.path") || app.includes("view.run.workspaceFolder?.path"), false);
  assert.equal(appDeepEntry.includes("summary?.workspaceFolder?.selection"), true);
  assert.equal(appDeepEntry.includes("summary.workspaceFolder.path"), true);
  assert.equal(appDeepEntry.includes("view.run.workspaceFolder?.selection"), true);
  assert.equal(appDeepEntry.includes("view.run.workspaceFolder.path"), true);
});
