import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

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
    appConversationRefresh,
    conversationRefresh,
    submitFlow,
    appObservedRunReadModel,
    appRunProjection,
    appRunController,
    appConversationSession,
    appTaskSubmission,
    appLiveRunUpdates,
    appSettingsController,
    appState,
    chatEmpty,
    sidebar,
    settingsDialog,
    capabilitySettings,
    workspaceSettings,
    confirmationSettings,
    shellStyles,
    chatComposerStyles,
    motionResponsiveStyles,
    workspaceStyles,
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
    readPanelUiSource("app-conversation-refresh.ts"),
    readAppSource("panel-conversation-refresh.ts"),
    readAppSource("panel-ui-submit-flow.ts"),
    readPanelUiSource("app-observed-run-read-model.ts"),
    readPanelUiSource("app-run-projection.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-conversation-session.ts"),
    readPanelUiSource("app-task-submission.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "confirmation-settings.tsx")),
    readPanelUiStyle("shell.css"),
    readPanelUiStyle("chat-composer.css"),
    readPanelUiStyle("motion-responsive.css"),
    readPanelUiStyle("workspace.css"),
  ]);

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('import { getJson } from "./api"'), false);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), false);
  assert.equal(app.includes('from "./components/sidebar"'), true);
  assert.equal(app.includes('from "./components/topbar"'), false);
  assert.equal(app.includes('from "./components/chat-empty"'), true);
  assert.equal(app.includes('from "./components/chat-active"'), true);
  assert.equal(app.includes('from "./components/settings-dialog"'), true);
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
  assert.equal(app.includes('from "./app-conversation-refresh"'), true);
  assert.equal(app.includes('from "./app-run-controller"'), true);
  assert.equal(app.includes('from "./app-settings-controller"'), true);
  assert.equal(app.includes('from "./app-state"'), true);
  assert.equal(app.includes('from "./app-skill-actions"'), false);
  assert.equal(app.includes("function refreshBootstrap"), false);
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
  assert.equal(appRuntimeControls.includes("export function stopLiveUpdates"), true);
  assert.equal(appAttachments.includes("export function taskSoilInputFromAttachments"), true);
  assert.equal(appAttachments.includes("export async function previewContextAttachment"), true);
  assert.equal(appAttachments.includes("export function blockedContextAttachment"), true);
  assert.equal(appAttachments.includes("/api/context/attachments/preview"), true);
  assert.equal(appBootstrap.includes("export async function loadAppBootstrap"), true);
  assert.equal(appBootstrap.includes("export function applyAppBootstrap"), true);
  assert.equal(appBootstrap.includes('getJson<ConfigResponse>("/api/config")'), true);
  assert.equal(appBootstrap.includes('getJson<ToolsResponse>("/api/config/tools")'), true);
  assert.equal(appBootstrap.includes('getJson<{ readonly catalog?: readonly McpServerCatalogItem[] }>("/api/config/mcp")'), true);
  assert.equal(appBootstrap.includes("/api/skills"), true);
  assert.equal(appBootstrap.includes('/api/conversations'), true);
  assert.equal(appConfigActions.includes("export async function saveModelProviderConfig"), true);
  assert.equal(appConfigActions.includes("export async function createCustomModelProviderProfile"), true);
  assert.equal(appConfigActions.includes("export async function selectModelProviderModel"), true);
  assert.equal(appConfigActions.includes("export async function fetchModelProviderCatalog"), true);
  assert.equal(appConfigActions.includes("export async function saveToolSettings"), true);
  assert.equal(appConfigActions.includes("export async function saveMcpServerSettings"), true);
  assert.equal(appConfigActions.includes("export async function updateToolState"), true);
  assert.equal(appConfigActions.includes("export async function updateSkillState"), true);
  assert.equal(appConfigActions.includes('postJson<ConfigResponse>("/api/config/model-provider"'), true);
  assert.equal(appConfigActions.includes('postJson<ToolsResponse>("/api/config/tools/web-search"'), true);
  assert.equal(appConfigActions.includes('postJson<{ readonly catalog?: ToolsResponse["mcpCatalog"] }>("/api/config/mcp"'), true);
  assert.equal(appConfigProjection.includes("export function mergeConfigResponse"), true);
  assert.equal(appConfigProjection.includes("export function runReasoningSettings"), true);
  assert.equal(appConversationRefresh.includes('from "../../panel-conversation-refresh"'), true);
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
  assert.equal(appTaskSubmission.includes("options.startLiveUpdates(immediateLiveRunId, 0)"), true);
  assert.equal(appTaskSubmission.includes("replay?.cursor.lastSequence ?? 0"), true);
  assert.equal(appLiveRunUpdates.includes("export function createLiveRunUpdateController"), true);
  assert.equal(appLiveRunUpdates.includes("function startLiveUpdates"), true);
  assert.equal(appLiveRunUpdates.includes("startPolling(runId"), true);
  assert.equal(appRunController.includes("function decideConfirmation"), true);
  assert.equal(appRunController.includes("loadConversationSession"), true);
  assert.equal(appRunController.includes("resetConversationSession"), true);
  assert.equal(appRunController.includes("loadConversationTranscriptNodesByRunId"), false);
  assert.equal(appRunController.includes("transcriptNodesByRunId"), false);
  assert.equal(appRunController.includes("taskSoilInputFromAttachments"), false);
  assert.equal(appConversationSession.includes("export async function loadConversationSession"), true);
  assert.equal(appConversationSession.includes("export function resetConversationSession"), true);
  assert.equal(appConversationSession.includes("loadConversationTranscriptNodesByRunId"), true);
  assert.equal(appConversationSession.includes("transcriptNodesByRunId"), true);
  assert.equal(appTaskSubmission.includes("taskSoilInputFromAttachments"), true);
  assert.equal(appObservedRunReadModel.includes("conversation.currentRun"), true);
  assert.equal(appObservedRunReadModel.includes("safeBasicRunView"), true);
  assert.equal(appObservedRunReadModel.includes("safeBasicRun("), false);
  assert.equal(appObservedRunReadModel.includes("safeWorkSession"), false);
  assert.equal(appObservedRunReadModel.includes("safeDesktopDetail"), false);
  assert.equal(appObservedRunReadModel.includes("safeBasicEvents"), false);
  assert.equal(appSettingsController.includes("export function createAppSettingsController"), true);
  assert.equal(appSettingsController.includes("async function persistModelConfig"), true);
  assert.equal(appSettingsController.includes("async function saveModelConfig"), true);
  assert.equal(appSettingsController.includes("async function createCustomModelProfile"), true);
  assert.equal(appSettingsController.includes("async function fetchModelsForProfile"), true);
  assert.equal(appSettingsController.includes("async function saveWorkspace"), true);
  assert.equal(appSettingsController.includes("async function saveTools"), true);
  assert.equal(appSettingsController.includes("async function saveMcpServer"), true);
  assert.equal(appSettingsController.includes("async function updateTool"), true);
  assert.equal(appSettingsController.includes("async function updateSkill"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("saveWorkspaceDirectory"), true);
  assert.equal(appSettingsController.includes("saveToolSettings"), true);
  assert.equal(appSettingsController.includes("saveMcpServerSettings"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(appState.includes("export type AppState"), true);
  assert.equal(appState.includes("export function createInitialAppState"), true);
  assert.equal(appState.includes("transcriptNodesByRunId"), true);
  assert.equal(appState.includes("readonly skills"), true);
  assert.equal(settingsDialog.includes('from "./capability-settings"'), true);
  assert.equal(settingsDialog.includes('from "./workspace-settings"'), true);
  assert.equal(settingsDialog.includes('from "./confirmation-settings"'), true);
  assert.equal(settingsDialog.includes("<CapabilitiesSettings"), true);
  assert.equal(settingsDialog.includes("<WorkspaceSettings"), true);
  assert.equal(settingsDialog.includes("<ConfirmationSettings"), true);
  assert.equal(settingsDialog.includes("function Capability"), false);
  assert.equal(settingsDialog.includes("function WorkspaceSettings"), false);
  assert.equal(settingsDialog.includes("function ConfirmationSettings"), false);
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
  assert.equal(settingsDialog.includes("function AppearanceSettings"), false);
  assert.equal(settingsDialog.includes('label: "模型服务"'), true);
  assert.equal(settingsDialog.includes('label: "能力与服务"'), true);
  assert.equal(settingsDialog.includes('label: "工作区"'), true);
  assert.equal(settingsDialog.includes('label: "高影响动作"'), true);
  assert.equal(settingsDialog.includes('label: "确认边界"'), false);
  assert.equal(capabilitySettings.includes("export function CapabilitiesSettings"), true);
  assert.equal(capabilitySettings.includes("function WebSearchSettings"), true);
  assert.equal(capabilitySettings.includes("function McpServiceSettings"), true);
  assert.equal(capabilitySettings.includes("基础能力"), true);
  assert.equal(capabilitySettings.includes("MCP 服务"), true);
  assert.equal(capabilitySettings.includes("这里配置可用服务和安全边界"), false);
  assert.equal(capabilitySettings.includes("由模型按任务判断"), false);
  assert.equal(capabilitySettings.includes("不替助手决定"), false);
  assert.equal(capabilitySettings.includes("工作方法"), true);
  assert.equal(capabilitySettings.includes("接入工具"), false);
  assert.equal(capabilitySettings.includes("管理助手可调用"), false);
  assert.equal(workspaceSettings.includes("export function WorkspaceSettings"), true);
  assert.equal(workspaceSettings.includes("这是助手可使用的本地上下文边界"), false);
  assert.equal(confirmationSettings.includes("export function ConfirmationSettings"), true);
  assert.equal(confirmationSettings.includes("确认门只处理高影响动作的授权"), false);
  assert.equal(confirmationSettings.includes("工具加载后显示相关动作"), false);
  assert.equal(app.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appRunController.includes('from "../../panel-ui-transcript-cache"'), false);
  assert.equal(appConversationSession.includes('from "../../panel-ui-transcript-cache"'), true);
  assert.equal(app.includes("shouldShowProviderIcon"), false);
  assert.equal(sidebar.includes('export type Screen = "chat-empty" | "chat-active"'), true);
  assert.equal(sidebar.includes("NAV_ITEMS"), false);
  assert.equal(sidebar.includes("onNavigate"), false);
  assert.equal(sidebar.includes("工作方式"), false);
  assert.equal(sidebar.includes("Wrench"), false);
  assert.equal(sidebar.includes("最近会话"), true);
  assert.equal(sidebar.includes("createPortal"), false);
  assert.equal(sidebar.includes("MoreHorizontal"), false);
  assert.equal(sidebar.includes("PencilLine"), false);
  assert.equal(sidebar.includes("Pin"), false);
  assert.equal(sidebar.includes("Trash2"), false);
  assert.equal(sidebar.includes("conversationOverrides"), false);
  assert.equal(sidebar.includes("renamingConversationId"), false);
  assert.equal(sidebar.includes("openConversationMenu"), false);
  assert.equal(sidebar.includes("重命名"), false);
  assert.equal(sidebar.includes("置顶"), false);
  assert.equal(sidebar.includes("删除"), false);
  assert.equal(sidebar.includes("sidebarConversationTone"), false);
  assert.equal(sidebar.includes("sidebarConversationStatusLabel"), false);
  assert.equal(sidebar.includes("sidebarConversationPriority"), false);
  assert.equal(sidebar.includes("sidebarConversationAction"), false);
  assert.equal(sidebar.includes("等待你确认、拒绝或补充指导。"), false);
  assert.equal(sidebar.includes("等待前序任务完成后自动继续。"), false);
  assert.equal(sidebar.includes("结果已生成，可打开继续追问。"), false);
  assert.equal(sidebar.includes('className={`sidebar-recent-item ${active ? "active" : ""}`}'), true);
  assert.equal(sidebar.includes("sidebar-status-pill"), false);
  assert.equal(sidebar.includes("sidebar-confirmation-card"), false);
  assert.equal(sidebar.includes("sidebar-pending-reminder"), true);
  assert.equal(shellStyles.includes(".sidebar-status-pill"), false);
  assert.equal(shellStyles.includes(".sidebar-conversation-action"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-actions"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-more"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-menu"), false);
  assert.equal(shellStyles.includes(".sidebar-rename-input"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-item.attention"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-item.problem"), false);
  assert.equal(shellStyles.includes(".sidebar-recent-item.active"), true);
  assert.equal(app.includes("sidebarCollapsed"), false);
  assert.equal(app.includes("onToggleSidebar"), false);
  assert.equal(shellStyles.includes(".topbar"), false);
  assert.equal(shellStyles.includes(".topbar-sidebar-button"), false);
  assert.equal(shellStyles.includes(".topbar-chip"), false);
  assert.equal(motionResponsiveStyles.includes(".topbar-chip"), false);
  assert.equal(chatEmpty.includes("composer-options-button"), true);
  assert.equal(chatEmpty.includes("composer-options-popover"), true);
  assert.equal(chatEmpty.includes("model-select-button"), false);
  assert.equal(chatComposerStyles.includes(".composer-options-button"), true);
  assert.equal(chatComposerStyles.includes(".composer-options-popover"), true);
  assert.equal(chatComposerStyles.includes(".model-select-button"), false);
  assert.equal(motionResponsiveStyles.includes(".model-select-button"), false);
  assert.equal(workspaceStyles.includes(".skill-card"), false);
  assert.equal(workspaceStyles.includes(".tool-row"), false);
  assert.equal(workspaceStyles.includes(".workspace-tabs"), false);
  assert.equal(workspaceStyles.includes(".workspace-search"), false);
  assert.equal(workspaceStyles.includes(".capability-row"), true);
  assert.equal(workspaceStyles.includes(".mcp-service-row"), true);
  assert.equal(workspaceStyles.includes(".mcp-form-grid"), true);
  assert.equal(workspaceStyles.includes(".settings-capabilities"), false);
  assert.equal(workspaceStyles.includes(".service-config-grid"), true);
});
