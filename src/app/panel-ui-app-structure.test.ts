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
    transcriptStore,
    appSettingsController,
    appState,
    chatEmpty,
    chatTranscriptChain,
    sidebar,
    settingsDialog,
    capabilitySettings,
    skillSettings,
    workspaceSettings,
    deepView,
    deepRunTree,
    deepConclusion,
    multiAgentWorkspace,
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
    readPanelUiSource("panel-ui-transcript-store.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("app-state.ts"),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "capability-settings.tsx")),
    readPanelUiSource(path.join("components", "skill-settings.tsx")),
    readPanelUiSource(path.join("components", "workspace-settings.tsx")),
    readPanelUiSource(path.join("components", "deep-view.tsx")),
    readPanelUiSource(path.join("components", "deep-run-tree.tsx")),
    readPanelUiSource(path.join("components", "deep-conclusion.tsx")),
    readPanelUiSource(path.join("components", "multi-agent-workspace.tsx")),
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
  ]);

  assert.equal(entry.includes('import { App } from "./App"'), true);
  assert.equal(app.includes('import { getJson } from "./api"'), false);
  assert.equal(app.includes('import { getJson, postJson } from "./api"'), false);
  assert.equal(app.includes('from "./components/sidebar"'), true);
  assert.equal(app.includes('from "./components/topbar"'), false);
  assert.equal(app.includes('from "./components/chat-empty"'), true);
  assert.equal(hasPanelUiModuleReference(app, "./components/chat-active"), true);
  assert.equal(hasPanelUiModuleReference(app, "./components/settings-dialog"), true);
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
  assert.equal(app.includes("app.busy || modelResponding"), true);
  assert.equal(app.includes("queueReadyAfterRunRef"), true);
  assert.equal(app.includes('if (app.agentMode === "deep") {\n        void submitDeepInput();'), true);
  assert.equal(app.includes("} else if (app.busy || modelResponding) {\n        enqueueMessage(goal);"), true);
  assert.equal(app.includes('const chatScreen = app.agentMode === "deep"'), true);
  assert.equal(app.includes("function openNormalTaskEntry"), true);
  assert.equal(app.includes('changeAgentMode("normal");\n    setSelectedWorkspaceDirectory(undefined);\n    resetChat();'), true);
  assert.equal(app.includes("app.conversation.workspaceFolder?.path"), true);
  assert.equal(app.includes("app.conversation?.workspaceFolder?.path"), true);
  assert.equal(app.includes("summary?.workspaceFolder?.path"), true);
  assert.equal(app.includes("function openAgentClusterEntry"), true);
  assert.equal(app.includes("function openCurrentModeTaskEntry"), true);
  assert.equal(app.includes('agentMode: "deep"'), true);
  assert.equal(app.includes('from "./app-deep-intake"'), true);
  assert.equal(app.includes('from "./app-deep-task-submission"'), false);
  assert.equal(app.includes('from "./components/multi-agent-workspace"'), true);
  assert.equal(app.includes('from "./components/deep-view"'), false);
  assert.equal(app.includes('from "./app-deep-history"'), true);
  assert.equal(app.includes("latestActiveDeepRun(bootstrap.deepRuns)"), true);
  assert.equal(app.includes("latestRestorableDeepRun(app.deepRuns)"), true);
  assert.equal(app.includes("openAgentClusterRun(activeDeepRun.runId, { auto: true })"), true);
  assert.equal(app.includes("openDeepRun(runId)"), true);
  assert.equal(app.includes("deepSelectedRunId"), true);
  assert.equal(app.includes('const deepActive = app.agentMode === "deep"'), true);
  assert.equal(app.includes("<MultiAgentWorkspace"), true);
  assert.equal(app.includes("<DeepView"), false);
  assert.equal(app.includes("conversation={app.deepConversation}"), true);
  assert.equal(app.includes("intakeStatus={app.deepIntakeStatus}"), true);
  assert.equal(app.includes("busy={app.deepBusy || deepChildOperationBusyId !== undefined}"), true);
  assert.equal(app.includes("pendingGoal={app.deepPendingGoal}"), true);
  assert.equal(app.includes("runs={app.deepRuns}"), true);
  assert.equal(app.includes("activeRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}"), true);
  assert.equal(app.includes("onOpenRun={(runId) => void openAgentClusterRun(runId)}"), false);
  assert.equal(app.includes("childOperationBusyId={deepChildOperationBusyId}"), true);
  assert.equal(app.includes("resynthesisBusy={deepResynthesisBusy}"), true);
  assert.equal(app.includes("onChildMessage={sendDeepChildMessage}"), true);
  assert.equal(app.includes("onChildConfirmation={decideDeepChild}"), true);
  assert.equal(app.includes("onResynthesize={resynthesizeDeepRun}"), true);
  assert.equal(app.includes("agentClusterDisabled="), false);
  assert.equal(app.includes("onOpenAgentCluster="), false);
  assert.equal(app.includes('agentMode={app.agentMode}'), true);
  assert.equal(app.includes('onModeChange={selectAgentMode}'), true);
  assert.equal(app.includes("桌面 Agent"), true);
  assert.equal(app.includes("多 Agent"), true);
  assert.equal(multiAgentWorkspace.includes("export function MultiAgentWorkspace"), true);
  assert.equal(multiAgentWorkspace.includes("<DeepView"), true);
  assert.equal(multiAgentWorkspace.includes("conversation={props.conversation}"), true);
  assert.equal(multiAgentWorkspace.includes("intakeStatus={props.intakeStatus}"), true);
  assert.equal(multiAgentWorkspace.includes("ChatInputBar"), true);
  assert.equal(multiAgentWorkspace.includes('aria-label="多 Agent 工作区"'), true);
  assert.equal(multiAgentWorkspace.includes("准备新的多 Agent 任务"), true);
  assert.equal(multiAgentWorkspace.includes("最近任务"), false);
  assert.equal(multiAgentWorkspace.includes("暂无历史"), false);
  assert.equal(multiAgentWorkspace.includes("props.runs"), true);
  assert.equal(multiAgentWorkspace.includes("key={run.runId}"), false);
  assert.equal(multiAgentWorkspace.includes("API path"), false);
  assert.equal(multiAgentWorkspace.includes("raw event type"), false);
  assert.equal(multiAgentWorkspace.includes("Deep 模式"), false);
  assert.equal(deepView.includes("export function DeepView"), true);
  assert.equal(deepView.includes("function DeepChatView"), true);
  assert.equal(deepView.includes("function DeepIntakeChatView"), true);
  assert.equal(deepView.includes("deepIntakeChatItems"), true);
  assert.equal(deepView.includes("type DeepChatItem"), true);
  assert.equal(deepView.includes("DeepRunTree"), true);
  assert.equal(deepView.includes("DeepConclusion"), true);
  assert.equal(deepView.includes("DeepStageNavigator"), false);
  assert.equal(deepView.includes("DeepFocusOutput"), false);
  assert.equal(deepView.includes("DeepModelOutputPanel"), false);
  assert.equal(deepView.includes("DeepChildWorklist"), false);
  assert.equal(deepView.includes("DeepWorkflowStrip"), true);
  assert.equal(deepView.includes('className="deep-workflow-strip"'), true);
  assert.equal(deepView.includes("deep-workflow-pending"), false);
  assert.equal(deepView.includes("DeepChildActivityStrip"), true);
  assert.equal(deepView.includes("DeepChildActivityCard"), true);
  assert.equal(deepView.includes("CompactConclusion"), false);
  assert.equal(deepView.includes("DeepBriefDetails"), true);
  assert.equal(deepView.includes("DeepDetailStageRail"), false);
  assert.equal(deepView.includes("DeepRunRefs"), false);
  assert.equal(deepView.includes('aria-label="助手回复"'), true);
  assert.equal(deepView.includes('aria-label="协作进展"'), true);
  assert.equal(deepView.includes('className="deep-flow-canvas"'), false);
  assert.equal(deepView.includes("deep-stage-navigator"), false);
  assert.equal(deepView.includes("deep-process-node"), false);
  assert.equal(deepView.includes("deep-focus-output"), false);
  assert.equal(deepView.includes('className="deep-workbench-layout"'), false);
  assert.equal(deepView.includes('className="deep-workbench-sidebar"'), false);
  assert.equal(deepView.includes('className="deep-workbench-main"'), false);
  assert.equal(deepView.includes('aria-label="多 Agent 模型输出"'), false);
  assert.equal(deepView.includes('label: "计划"'), false);
  assert.equal(deepView.includes('label: "探索"'), false);
  assert.equal(deepView.includes('label: "目标"'), false);
  assert.equal(deepView.includes('label: "综合"'), false);
  assert.equal(deepView.includes('label: "结论"'), false);
  assert.equal(deepView.includes('label: "判断"'), false);
  assert.equal(deepView.includes('label: "子任务"'), false);
  assert.equal(deepView.includes('label: "助手"'), true);
  assert.equal(deepView.includes('label: "父 Agent"'), false);
  assert.equal(deepView.includes('kind: "user_goal"'), true);
  assert.equal(deepView.includes('kind: "parent_message"'), true);
  assert.equal(deepView.includes('kind: "system_notice"'), true);
  assert.equal(deepView.includes("view.brief"), true);
  assert.equal(deepView.includes("deep-brief-chips"), false);
  assert.equal(deepView.includes("modelOutputEntries"), false);
  assert.equal(deepView.includes("childOutputEntries"), false);
  assert.equal(deepView.includes("view.liveProjection.decision?.summary"), true);
  assert.equal(deepView.includes("view.report.childSummaries"), true);
  assert.equal(deepView.includes("view.report?.synthesisRecords.at(-1)"), true);
  assert.equal(deepView.includes("view.report?.conclusion"), true);
  assert.equal(deepView.includes("deep-child-node-confidence"), false);
  assert.equal(deepView.includes("deep-child-node-uncertainty"), false);
  assert.equal(deepView.includes("child.parentOperation"), true);
  assert.equal(deepView.includes("parentOperationLabel"), true);
  assert.equal(deepView.includes("deep-child-node-parent-op"), true);
  assert.equal(deepView.includes("DeepUserMessage"), true);
  assert.equal(deepView.includes("DeepParentMessage"), true);
  assert.equal(deepView.includes("DeepSystemNotice"), true);
  assert.equal(deepView.includes("ChildNodeFollowup"), true);
  assert.equal(deepView.includes("deep-child-node-followup"), true);
  assert.equal(deepView.includes("deep-child-node-followup-toggle"), true);
  assert.equal(deepView.includes("ChildNodeApproval"), true);
  assert.equal(deepView.includes("deep-child-node-approval"), true);
  assert.equal(deepView.includes("child.pendingApproval"), true);
  assert.equal(deepView.includes("props.onChildMessage &&"), true);
  assert.equal(deepView.includes("补充给这个协作项"), true);
  assert.equal(deepView.includes("补充给这个子 Agent"), false);
  assert.equal(deepView.includes("busy={props.childOperationBusyId !== undefined}"), false);
  assert.equal(deepView.includes("busy={props.childOperationBusyId === child.childRunId}"), true);
  assert.equal(deepView.includes("busy={props.busy}"), true);
  assert.equal(deepView.includes("busy={busy || props.childOperationBusyId === child.childRunId}"), false);
  assert.equal(deepView.includes("childStatusLabel"), true);
  assert.equal(deepView.includes("phase === \"needs_input\""), true);
  assert.equal(deepView.includes("运行细节"), false);
  assert.equal(deepView.includes("我正在接手这个目标"), false);
  assert.equal(deepView.includes("协作记录"), true);
  assert.equal(deepView.includes("deep-record-section"), true);
  assert.equal(deepView.includes("deep-resynthesis-button"), true);
  assert.equal(deepView.includes("needsResynthesis"), true);
  assert.equal(deepView.includes("deep-resynthesis-state"), true);
  assert.equal(deepView.includes("待重新综合"), true);
  assert.equal(deepView.includes("重新综合"), true);
  assert.equal(deepView.includes("父层重新综合"), false);
  assert.equal(deepView.includes("raw prompt"), false);
  assert.equal(deepView.includes("raw response"), false);
  assert.equal(deepView.includes("API path"), false);
  assert.equal(deepView.includes('"deep.child.instruction_queued"'), true);
  assert.equal(deepView.includes('"deep.child.blocked"'), true);
  assert.equal(deepView.includes('"deep.child.interrupted"'), true);
  assert.equal(deepView.includes('"deep.child.failed"'), true);
  assert.equal(deepRunTree.includes("export function DeepRunTree"), true);
  assert.equal(deepRunTree.includes("busy={props.childOperationBusyId !== undefined}"), true);
  assert.equal(deepRunTree.includes("busy={props.busy || props.childOperationBusyId ==="), false);
  assert.equal(deepConclusion.includes("export function DeepConclusion"), true);
  assert.equal(appDeepLiveUpdates.includes("export function createDeepRunUpdateController"), true);
  assert.equal(appDeepLiveUpdates.includes("/api/deep/runs/"), true);
  assert.equal(appDeepLiveUpdates.includes("openDeepRunStream"), true);
  assert.equal(appDeepLiveUpdates.includes("refreshQueued"), true);
  assert.equal(appDeepLiveUpdates.includes("isTerminalDeepRunStatus"), true);
  assert.equal(app.includes('from "./app-deep-live-updates"'), true);
  assert.equal(app.includes("requestDeepChildMessage(activeDeepRunId, childRunId, message)"), true);
  assert.equal(app.includes("applyQueuedChildOperationProjection(response)"), true);
  assert.equal(app.includes('status: "queued" as const'), true);
  assert.equal(app.includes("const queuedCount = response.queuedCount"), true);
  assert.equal(app.includes("updatedAt: queuedAt"), true);
  assert.equal(app.includes('response.status === "queued"'), true);
  assert.equal(app.includes("decideDeepChildConfirmation("), true);
  assert.equal(appDeepControl.includes("export async function requestDeepChildMessage"), true);
  assert.equal(appDeepControl.includes("/children/${encodeURIComponent(childRunId)}/messages"), true);
  assert.equal(appDeepControl.includes("export async function decideDeepChildConfirmation"), true);
  assert.equal(appDeepControl.includes("/confirmations/${encodeURIComponent(confirmationId)}/decision"), true);
  assert.equal(appDeepControl.includes("export async function requestDeepRunResynthesis"), true);
  assert.equal(appDeepControl.includes("/resynthesize"), true);
  assert.equal(appDeepControl.includes("export async function requestDeepRunFollowUp"), true);
  assert.equal(appDeepControl.includes("/follow-up"), true);
  assert.equal(appDeepIntake.includes("export async function requestDeepIntake"), true);
  assert.equal(appDeepIntake.includes("/api/deep/intake"), true);
  assert.equal(app.includes("requestDeepRunCorrection(activeDeepRunId"), true);
  assert.equal(app.includes("requestDeepIntake({"), true);
  assert.equal(app.includes("requestDeepRunFollowUp("), false);
  assert.equal(app.includes("requestDeepRunResynthesis(activeDeepRunId)"), true);
  assert.equal(app.includes("requestDeepRunStop(activeDeepRunId)"), true);
  assert.equal(app.includes("app.deep?.run.runId ?? app.deepActiveRunId"), true);
  assert.equal(app.includes('cancelLabel: "停止"'), true);
  assert.equal(app.includes('"描述要协作处理的目标..."'), true);
  assert.equal(app.includes('"补充要求..."'), true);
  assert.equal(app.includes('"继续围绕当前主题补充..."'), true);
  assert.equal(app.includes('"继续补充这个任务..."'), false);
  assert.equal(app.includes("deepConversation: view.conversation ?? previous.deepConversation"), true);
  assert.equal(app.includes("const deepConversationId ="), true);
  assert.equal(app.includes("app.deep?.conversation?.conversationId"), true);
  assert.equal(app.includes("conversationId: deepConversationId"), true);
  assert.equal(appDeepLiveUpdates.includes("deepConversation: view.conversation ?? previous.deepConversation"), true);
  assert.equal(appDeepIntake.includes("conversationId: input.conversationId"), true);
  assert.equal(app.includes("deepRunUpdateController.startPolling(response.run.runId)"), true);
  assert.equal(app.includes("deepPollTimerRef"), true);
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
  assert.equal(appBootstrap.includes('getJson<ListDeepRunSummariesResponse>("/api/deep/runs?limit=50")'), true);
  assert.equal(appBootstrap.includes('Pick<AppState, "config" | "tools" | "skills" | "conversations" | "deepRuns">'), true);
  assert.equal(appState.includes("readonly deepRuns: readonly DeepRunSummary[]"), true);
  assert.equal(appState.includes("readonly deepSelectedRunId?: string"), true);
  assert.equal(appState.includes("deepRuns: []"), true);
  assert.equal(appDeepHistory.includes("export async function listDeepRuns"), true);
  assert.equal(appDeepHistory.includes("/api/deep/runs?limit="), true);
  assert.equal(appDeepHistory.includes("export async function openDeepRun"), true);
  assert.equal(appDeepHistory.includes("/api/deep/runs/${encodeURIComponent(runId)}/view"), true);
  assert.equal(appDeepHistory.includes("latestRestorableDeepRun"), true);
  assert.equal(appDeepHistory.includes("latestActiveDeepRun"), true);
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
  assert.equal(app.includes("resetChat();"), true);
  assert.equal(appConversationSession.includes("updateTranscriptNodesCache"), true);
  assert.equal(appConversationSession.includes("loadHistoricalTranscriptNodeEntries"), true);
  assert.equal(appConversationSession.includes("HISTORICAL_RUN_LOAD_CONCURRENCY = 4"), true);
  assert.equal(appConversationSession.includes("resetTranscriptNodesCache(conversationId)"), false);
  assert.equal(appConversationSession.includes("transcriptNodesByRunId"), true);
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
  assert.equal(appSettingsController.includes("async function createCustomModelProfile"), true);
  assert.equal(appSettingsController.includes("async function fetchModelsForProfile"), true);
  assert.equal(appSettingsController.includes("async function saveWorkspace"), true);
  assert.equal(appSettingsController.includes("async function saveTools"), true);
  assert.equal(appSettingsController.includes("async function saveMcpServer"), true);
  assert.equal(appSettingsController.includes("async function updateMcpTool"), true);
  assert.equal(appSettingsController.includes("async function refreshSkills"), true);
  assert.equal(appSettingsController.includes("async function updateSkill"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("saveWorkspaceDirectory"), true);
  assert.equal(appSettingsController.includes("saveToolSettings"), true);
  assert.equal(appSettingsController.includes("saveMcpServerSettings"), true);
  assert.equal(appSettingsController.includes("updateMcpToolState"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(appSettingsController.includes("selectWorkspaceDirectory"), true);
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
  assert.equal(capabilitySettings.includes("export function BasicCapabilitiesSettings"), true);
  assert.equal(capabilitySettings.includes("export function McpServiceSettings"), true);
  assert.equal(capabilitySettings.includes("function WebSearchSettings"), true);
  assert.equal(capabilitySettings.includes("function McpServiceBoard"), true);
  assert.equal(capabilitySettings.includes("McpReferencePanel"), true);
  assert.equal(capabilitySettings.includes("onLoadMcpReferences"), true);
  assert.equal(capabilitySettings.includes("网络搜索"), true);
  assert.equal(capabilitySettings.includes("网页查证"), false);
  assert.equal(capabilitySettings.includes('from "../app-config-actions"'), false);
  assert.equal(capabilitySettings.includes("模型能力"), false);
  assert.equal(capabilitySettings.includes("MCP 服务"), true);
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
  assert.equal(appConversationSession.includes('from "../../panel-ui-transcript-cache"'), true);
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
  assert.equal(sidebar.includes("createPortal"), false);
  assert.equal(sidebar.includes("MoreHorizontal"), false);
  assert.equal(sidebar.includes("PencilLine"), false);
  assert.equal(sidebar.includes("  Pin,"), false);
  assert.equal(sidebar.includes("Trash2"), false);
  assert.equal(sidebar.includes("  Plus,"), true);
  assert.equal(sidebar.includes("  Network,"), false);
  assert.equal(sidebar.includes("agentClusterActive"), true);
  assert.equal(sidebar.includes("onOpenAgentCluster"), false);
  assert.equal(sidebar.includes("deepRuns"), true);
  assert.equal(sidebar.includes("activeDeepRunId"), true);
  assert.equal(sidebar.includes("onOpenDeepRun"), true);
  assert.equal(sidebar.includes("DeepRunGroup"), true);
  assert.equal(sidebar.includes("DeepRunListItem"), true);
  assert.equal(sidebar.includes("暂无多 Agent 任务"), true);
  assert.equal(sidebar.includes("!props.agentClusterActive && props.pendingCount > 0"), true);
  assert.equal(sidebar.includes("多 Agent 任务"), true);
  assert.equal(sidebar.includes("sidebar-deep-run-row"), true);
  assert.equal(sidebar.includes("多 Agent"), true);
  assert.equal(sidebar.includes("Deep 模式"), false);
  assert.equal(app.includes('agentClusterActive={app.agentMode === "deep"}'), true);
  assert.equal(app.includes('activeConversationId={app.agentMode === "deep" ? undefined : app.conversation?.conversationId}'), true);
  assert.equal(app.includes('deepRuns={app.deepRuns}'), true);
  assert.equal(app.includes("activeDeepRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}"), true);
  assert.equal(app.includes("onOpenDeepRun={(runId) => void openAgentClusterRun(runId)}"), true);
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
  assert.equal(shellStyles.includes(".sidebar-deep-run-copy"), true);
  assert.equal(shellStyles.includes(".sidebar-folder-heading"), true);
  assert.equal(deepStyles.includes(".multi-agent-workspace"), true);
  assert.equal(deepStyles.includes(".multi-agent-missionbar"), true);
  assert.equal(deepStyles.includes(".multi-agent-body"), true);
  assert.equal(deepStyles.includes(".multi-agent-stage"), true);
  assert.equal(deepStyles.includes(".multi-agent-commandbar"), true);
  assert.equal(deepStyles.includes(".multi-agent-inspector"), false);
  assert.equal(deepStyles.includes(".multi-agent-history-list"), false);
  assert.equal(deepStyles.includes(".multi-agent-run-facts"), false);
  assert.equal(deepStyles.includes("flex: 0 0 280px"), false);
  assert.equal(deepStyles.includes(".deep-chat-view"), true);
  assert.equal(deepStyles.includes(".deep-chat-thread"), true);
  assert.equal(deepStyles.includes(".deep-chat-parent-message"), true);
  assert.equal(deepStyles.includes(".deep-chat-child-strip"), true);
  assert.equal(deepStyles.includes(".deep-chat-child-card"), true);
  assert.equal(deepStyles.includes(".deep-flow-canvas"), false);
  assert.equal(deepStyles.includes(".deep-focus-output"), false);
  assert.equal(deepStyles.includes(".deep-stage-navigator"), false);
  assert.equal(deepStyles.includes(".deep-child-node-followup-toggle"), true);
  assert.equal(deepStyles.includes("min-height: 0"), true);
  assert.equal(deepStyles.includes("overflow-y: auto"), true);
  assert.equal(deepStyles.includes("flex-direction: column"), true);
  assert.equal(deepStyles.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(app.includes("sidebarCollapsed"), true);
  assert.equal(app.includes("onToggleSidebar"), true);
  assert.equal(app.includes("PanelLeftClose"), true);
  assert.equal(app.includes("PanelLeftOpen"), true);
  assert.equal(sidebar.includes("onToggleCollapsed"), false);
  assert.equal(sidebar.includes("PanelLeftClose"), false);
  assert.equal(sidebar.includes("PanelLeftOpen"), false);
  assert.equal(shellStyles.includes(".app-workbench-sidebar-toggle"), true);
  assert.equal(app.includes("Maximize2"), true);
  assert.equal(app.includes("Minimize2"), true);
  assert.equal(app.includes("getWindowState"), true);
  assert.equal(app.includes("onWindowStateChanged"), true);
  assert.equal(app.includes("Square"), false);
  assert.equal(shellStyles.includes('data-window-animating="true"'), true);
  assert.equal(app.includes("window.confirm"), false);
  assert.equal(app.includes("(response.conversations ?? previous.conversations).filter"), true);
  assert.equal(shellStyles.includes(".topbar"), false);
  assert.equal(shellStyles.includes(".topbar-sidebar-button"), false);
  assert.equal(shellStyles.includes(".topbar-chip"), false);
  assert.equal(shellStyles.includes(".app-mode-switch"), true);
  assert.equal(shellStyles.includes(".app-mode-switch-button"), true);
  assert.equal(shellStyles.includes(".app-workbench-brand"), false);
  assert.equal(shellStyles.includes(".sidebar-agent-cluster-button"), false);
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
  assert.equal(workspaceStyles.includes(".capability-settings-stack"), false);
  assert.equal(workspaceStyles.includes(".capability-toggle"), true);
  assert.equal(workspaceStyles.includes(".mcp-service-card"), true);
  assert.equal(workspaceStyles.includes(".mcp-form-grid"), true);
  assert.equal(workspaceStyles.includes(".settings-capabilities"), false);
  assert.equal(workspaceStyles.includes(".service-config-grid"), true);
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
  assert.equal(deepRunTree.includes("instruction.messageRef ?? instruction.instructionId"), true);
  assert.equal(deepRunTree.includes("parentInstructionReviewTitle"), true);
  assert.equal(deepRunTree.includes("跟进 {run.parentInstructions.length}"), true);
  assert.equal(deepRunTree.includes("SYNTHESIS_CHILD_REVIEW_LABEL"), true);
  assert.equal(deepRunTree.includes("synthesis.childReviews.map"), true);
  assert.equal(deepRunTree.includes('aria-label="协作审查"'), true);
  assert.equal(deepRunTree.includes('className="deep-synthesis-review-reason"'), true);
  assert.equal(deepStyles.includes(".deep-child-objective"), true);
  assert.equal(deepStyles.includes(".deep-child-execution"), true);
  assert.equal(deepStyles.includes(".deep-child-node-parent-op"), true);
  assert.equal(deepStyles.includes(".deep-child-approval"), true);
  assert.equal(deepStyles.includes(".deep-child-followup"), true);
  assert.equal(deepStyles.includes(".deep-child-approval-actions"), true);
  assert.equal(deepStyles.includes(".deep-child-guidance"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review-decision.accepted"), true);
  assert.equal(deepStyles.includes(".deep-synthesis-review-reason"), true);
  assert.equal(deepStyles.includes(".deep-resynthesis-state"), true);
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
