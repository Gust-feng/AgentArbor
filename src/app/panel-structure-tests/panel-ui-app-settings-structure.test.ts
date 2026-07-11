import test from "node:test";
import {
  assert,
  hasJsxComponentReference,
  hasPanelUiModuleReference,
  readPanelUiAppStructureSources,
} from "./panel-ui-app-structure-sources.js";

test("panel UI app shell delegates settings and sidebar ownership", async () => {
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
    appLiveRunUpdates.includes("appendOnlyBatcher.flush();\n      const runView = await fetchBasicRunView(runId, lastSequence);"),
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
});
