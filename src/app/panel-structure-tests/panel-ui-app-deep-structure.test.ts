import path from "node:path";
import test from "node:test";
import {
  assert,
  assertExcludesAll,
  assertIncludesAll,
  readPanelUiAppStructureSources,
} from "./panel-ui-app-structure-sources.js";
import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel UI app shell keeps Agent cluster orchestration outside App", async () => {
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
