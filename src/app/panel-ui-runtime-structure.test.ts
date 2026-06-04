import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertOrdinaryUiSourceHasNoInternalTerms,
  readAppSource,
  readPanelUiSource,
  readPanelUiStyle,
} from "./panel-structure-test-utils.js";

test("panel React workbench consumes Basic Agent projection APIs", async () => {
  const [
    app,
    appAttachments,
    appBootstrap,
    appConfigActions,
    appConfirmationDecisions,
    appConversationRefresh,
    appRunController,
    appConversationSession,
    appTaskSubmission,
    appLiveRunUpdates,
    appRunObservationSettlement,
    appSettingsController,
    runtime,
    settingsDialog,
    modelSettings,
    modelCatalogPanel,
    chatEmpty,
    chatActive,
    chatTranscriptChain,
    assistantMessageViewProjection,
    chatActiveViewProjection,
    transcriptTurnProjection,
    transcriptActivityCopy,
    agentWorkTimelineProjection,
    transcriptTimeline,
    transcriptConfirmation,
    sidebar,
    motionResponsiveStyles,
    modelProviderLogos,
    modelOptions,
  ] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-attachments.ts"),
    readPanelUiSource("app-bootstrap.ts"),
    readPanelUiSource("app-config-actions.ts"),
    readPanelUiSource("app-confirmation-decisions.ts"),
    readPanelUiSource("app-conversation-refresh.ts"),
    readPanelUiSource("app-run-controller.ts"),
    readPanelUiSource("app-conversation-session.ts"),
    readPanelUiSource("app-task-submission.ts"),
    readPanelUiSource("app-live-run-updates.ts"),
    readPanelUiSource("app-run-observation-settlement.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource("runtime.ts"),
    readPanelUiSource(path.join("components", "settings-dialog.tsx")),
    readPanelUiSource(path.join("components", "model-settings.tsx")),
    readPanelUiSource(path.join("components", "model-catalog-panel.tsx")),
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "chat-active.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readAppSource("panel-assistant-message-view.ts"),
    readAppSource("panel-ui-chat-active-view.ts"),
    readAppSource("panel-transcript-turn-projection.ts"),
    readAppSource("panel-transcript-activity-copy.ts"),
    readAppSource("panel-agent-work-timeline-view.ts"),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readPanelUiSource(path.join("components", "transcript-confirmation.tsx")),
    readPanelUiSource(path.join("components", "sidebar.tsx")),
    readPanelUiStyle("motion-responsive.css"),
    readPanelUiSource("model-provider-logos.ts"),
    readPanelUiSource("model-options.ts"),
  ]);

  assert.equal(app.includes("/api/conversations"), false);
  assert.equal(appBootstrap.includes("/api/conversations"), true);
  assert.equal(appConversationRefresh.includes("/api/conversations"), true);
  assert.equal(appConversationRefresh.includes("/api/basic-agent/runs/"), false);
  assert.equal(appConversationRefresh.includes("/events?cursor="), false);
  assert.equal(appConversationRefresh.includes("safeDesktopDetail"), false);
  assert.equal(app.includes("/api/basic-agent/runs/"), false);
  assert.equal(app.includes("/events?cursor="), false);
  assert.equal(appRunController.includes("/api/basic-agent/runs/"), true);
  assert.equal(appRunController.includes("/events?cursor="), false);
  assert.equal(appRunController.includes("submitPanelTask"), true);
  assert.equal(appRunController.includes("optimisticConversationForSubmit"), false);
  assert.equal(appRunController.includes("taskSoilInputFromAttachments"), false);
  assert.equal(appRunController.includes("runReasoningSettings"), false);
  assert.equal(appRunController.includes("mergeObservedRunEvents"), false);
  assert.equal(appRunController.includes("StartedConversationRun"), false);
  assert.equal(appTaskSubmission.includes("export async function submitPanelTask"), true);
  assert.equal(appTaskSubmission.includes("optimisticConversationForSubmit"), true);
  assert.equal(appTaskSubmission.includes("taskSoilInputFromAttachments"), true);
  assert.equal(appTaskSubmission.includes("runReasoningSettings"), true);
  assert.equal(appTaskSubmission.includes("mergeObservedRunEvents"), true);
  assert.equal(appTaskSubmission.includes("StartedConversationRun"), true);
  assert.equal(appLiveRunUpdates.includes("safeBasicEvents"), true);
  assert.equal(appLiveRunUpdates.includes("loadSettledRunProjection"), true);
  assert.equal(appLiveRunUpdates.includes("appStateWithSettledRunProjection"), true);
  assert.equal(appLiveRunUpdates.includes("appStateWithObservedRunProjection"), true);
  assert.equal(appLiveRunUpdates.includes("appStateWithObservedRunEvent"), true);
  assert.equal(appLiveRunUpdates.includes("appStateWithAppendOnlyRunEvent"), true);
  assert.equal(appLiveRunUpdates.includes("createRunReadModelPatch"), false);
  assert.equal(appLiveRunUpdates.includes("appendLiveRunEvents"), false);
  assert.equal(appLiveRunUpdates.includes("appendLiveRunEvent("), false);
  assert.equal(appLiveRunUpdates.includes("mergeRunEvents"), false);
  assert.equal(appLiveRunUpdates.includes("safeConversation"), false);
  assert.equal(appLiveRunUpdates.includes("safeDesktopDetail"), false);
  assert.equal(appRunObservationSettlement.includes("export async function loadSettledRunProjection"), true);
  assert.equal(appRunObservationSettlement.includes("export function appStateWithSettledRunProjection"), true);
  assert.equal(appRunObservationSettlement.includes("export function refreshingFollowUpRun"), true);
  assert.equal(appRunObservationSettlement.includes("loadFollowUpActiveRunProjection"), true);
  assert.equal(appRunObservationSettlement.includes("liveRunHasVisibleText"), false);
  assert.equal(appRunObservationSettlement.includes("appendLiveRunEvents"), true);
  assert.equal(appLiveRunUpdates.includes("STREAM_BOOTSTRAP_POLL_INTERVAL_MS"), true);
  assert.equal(appLiveRunUpdates.includes("startBootstrapPolling"), true);
  assert.equal(appLiveRunUpdates.includes("streamDeliveredEvent"), true);
  assert.equal(appLiveRunUpdates.includes("FALLBACK_POLL_INTERVAL_MS"), true);
  assert.equal(runtime.includes("/stream?cursor="), true);
  assert.equal(runtime.includes("agent.note.delta"), true);
  assert.equal(runtime.includes("agent.note.completed"), true);
  assert.equal(runtime.includes("/work-session"), true);
  assert.equal(app.includes("/api/context/attachments/preview"), false);
  assert.equal(appConfigActions.includes("/api/context/attachments/preview"), false);
  assert.equal(appAttachments.includes("/api/context/attachments/preview"), true);
  assert.equal(app.includes("/api/skills"), false);
  assert.equal(appBootstrap.includes("/api/skills"), true);
  assert.equal(app.includes("/api/config/tools"), false);
  assert.equal(appBootstrap.includes("/api/config/tools"), true);
  assert.equal(app.includes("/cancel"), false);
  assert.equal(app.includes("/confirmations/"), false);
  assert.equal(appConfirmationDecisions.includes("/confirmations/"), true);
  assert.equal(appConfirmationDecisions.includes("export async function decideRunConfirmation"), true);
  assert.equal(appConfirmationDecisions.includes("isStaleConfirmationError"), true);
  assert.equal(appConfirmationDecisions.includes("refreshRunAfterConfirmationSettled"), true);
  assert.equal(app.includes("safeDesktopDetail"), false);
  assert.equal(app.includes("safeWorkSession"), false);
  assert.equal(appRunController.includes("/cancel"), true);
  assert.equal(appRunController.includes("/confirmations/"), false);
  assert.equal(appRunController.includes("decideRunConfirmation"), true);
  assert.equal(appRunController.includes("safeDesktopDetail"), false);
  assert.equal(appRunController.includes("safeWorkSession"), true);
  assert.equal(appConversationSession.includes("safeDesktopDetail"), true);
  assert.equal(appConversationSession.includes("safeWorkSession"), true);
  assert.equal(appRunController.includes("confirmationDecisionStatusMessage"), false);
  assert.equal(appRunController.includes("已提交确认，正在继续处理。"), false);
  assert.equal(appRunController.includes("已记录拒绝，正在让助手重新判断。"), false);
  assert.equal(appRunController.includes("已收到补充指导，正在让助手继续判断。"), false);
  assert.equal(appRunController.includes("error: undefined"), false);
  assert.equal(appConversationSession.includes("error: undefined"), true);
  assert.equal(runtime.includes("safeWorkSession"), true);
  assert.equal(runtime.includes("/api/desktop/runs/"), true);
  assert.equal(app.includes("/api/config/model-profiles"), false);
  assert.equal(app.includes("/model-catalog"), false);
  assert.equal(appConfigActions.includes("/api/config/model-profiles"), true);
  assert.equal(appConfigActions.includes("/model-catalog"), true);
  assert.equal(appSettingsController.includes("saveModelProviderConfig"), true);
  assert.equal(appSettingsController.includes("updateSkillState"), true);
  assert.equal(settingsDialog.includes("获取模型"), false);
  assert.equal(modelSettings.includes("获取模型"), false);
  assert.equal(modelCatalogPanel.includes("获取模型"), true);
  assert.equal(chatActive.includes("model.output.delta"), false);
  assert.equal(chatActive.includes("model.reasoning.delta"), false);
  assert.equal(transcriptTimeline.includes("model.reasoning.delta"), false);
  assert.equal(chatActive.includes('kind === "thinking"'), false);
  assert.equal(transcriptTimeline.includes('kind === "thinking"'), false);
  assert.equal(transcriptActivityCopy.includes('kind === "thinking"'), true);
  assert.equal(transcriptTimeline.includes("export function activityItemsForNodes"), false);
  assert.equal(transcriptTimeline.includes("export function workflowItemsForNodes"), false);
  assert.equal(transcriptActivityCopy.includes("export function activityItemsForNodes"), true);
  assert.equal(transcriptActivityCopy.includes("export function workflowItemsForNodes"), true);
  assert.equal(agentWorkTimelineProjection.includes("export function projectAgentWorkTimelineView"), true);
  assert.equal(agentWorkTimelineProjection.includes("timelineVisibleNodes"), true);
  assert.equal(agentWorkTimelineProjection.includes("timelineConfirmationProjection"), true);
  assert.equal(agentWorkTimelineProjection.includes("workflowItemsForNodes"), true);
  assert.equal(transcriptTimeline.includes("export function compactWorkflowItemsForDisplay"), false);
  assert.equal(transcriptTimeline.includes("export function currentActivityItemForNodes"), false);
  assert.equal(transcriptTimeline.includes("MAX_ACTIVITY_ITEMS"), false);
  assert.equal(transcriptTimeline.includes("COLLAPSED_WORKFLOW_ITEMS"), false);
  assert.equal(transcriptTimeline.includes("agent-workflow"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow-step"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow-step confirmation"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow-marker"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow-toggle"), false);
  assert.equal(transcriptTimeline.includes("agent-workflow-disclosure"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow-expanded-detail"), true);
  assert.equal(transcriptTimeline.includes("expandedDetail"), true);
  assert.equal(transcriptTimeline.includes("timelineConfirmationProjection"), false);
  assert.equal(transcriptTimeline.includes("currentConfirmationNode"), false);
  assert.equal(transcriptTimeline.includes("agent-workline-current"), false);
  assert.equal(transcriptTimeline.includes("agent-workline-confirmation"), false);
  assert.equal(transcriptTimeline.includes("agent-activity-rail"), false);
  assert.equal(transcriptTimeline.includes("AgentTimelineRow"), false);
  assert.equal(transcriptTimeline.includes("TranscriptTimelineDetail"), false);
  assert.equal(transcriptTimeline.includes("ToolNodeDetail"), false);
  assert.equal(chatActive.includes("reasoning-block"), false);
  assert.equal(chatActive.includes("TimelineStream"), false);
  assert.equal(chatActive.includes("activityItemsFromTranscriptNodes"), false);
  assert.equal(chatActive.includes("WorkflowFrame"), false);
  assert.equal(chatActive.includes("ActivityGroup"), false);
  assert.equal(chatActive.includes("transcriptNodesFromEvents"), false);
  assert.equal(chatActive.includes("toolTranscriptTitle"), false);
  assert.equal(chatActive.includes("resultBlocks"), false);
  assert.equal(chatActive.includes("workflowVisibleNodes"), false);
  assert.equal(chatActive.includes("standaloneRefreshing"), false);
  assert.equal(chatActiveViewProjection.includes("workflowVisibleNodes"), true);
  assert.equal(chatActiveViewProjection.includes("projectChatActive"), true);
  assert.equal(chatActiveViewProjection.includes("visibleDeliverable"), true);
  assert.equal(chatActiveViewProjection.includes("visibleRunProblem"), true);
  assert.equal(modelOptions.includes("profile.secretConfigured === true"), true);
  assert.equal(modelOptions.includes("profile.defaultAiMode !== \"fake\""), true);
  assert.equal(modelOptions.includes("profile.defaultAiMode !== \"none\""), true);
  assert.equal(modelProviderLogos.includes("默认配置"), false);
  assert.equal(modelProviderLogos.includes("value.includes(\"default\")"), false);
  assert.equal(chatEmpty.includes("任务输入"), true);
  assert.equal(chatEmpty.includes("ChatInputBar"), true);
  assert.equal(chatEmpty.includes("composer-options-button"), true);
  assert.equal(chatEmpty.includes("composer-options-popover"), true);
  assert.equal(chatEmpty.includes("model-select-button"), false);
  assert.equal(motionResponsiveStyles.includes(".model-select-button"), false);
  assert.equal(sidebar.includes("新任务"), true);
  assert.equal(sidebar.includes("工作方式"), false);
  assert.equal(sidebar.includes("技能"), false);
  assert.equal(sidebar.includes("Wrench"), false);
  assert.equal(sidebar.includes("NAV_ITEMS"), false);
  assert.equal(sidebar.includes("onNavigate"), false);
  assert.equal(sidebar.includes("设置"), true);
  assert.equal(sidebar.includes("待确认"), true);
  assert.equal(sidebar.includes("sidebarConversationTone"), false);
  assert.equal(sidebar.includes("sidebarConversationStatusLabel"), false);
  assert.equal(sidebar.includes("sidebar-status-pill"), false);
  assert.equal(sidebar.includes("等待你确认、拒绝或补充指导。"), false);
  assert.equal(sidebar.includes("等待前序任务完成后自动继续。"), false);
  assert.equal(sidebar.includes("sidebar-confirmation-card"), false);
  assert.equal(sidebar.includes("最近会话"), true);
  assert.equal(app.includes('from "./components/topbar"'), false);
  assert.equal(app.includes("sidebarCollapsed"), false);
  assert.equal(app.includes("onToggleSidebar"), false);
  assert.equal(motionResponsiveStyles.includes(".topbar-chip"), false);
  assert.equal(chatActive.includes("WorkContextPanel"), false);
  assert.equal(chatActive.includes("工作上下文"), false);
  assert.equal(transcriptConfirmation.includes("待确认"), true);
  assert.equal(chatActive.includes("assistant-workline"), false);
  assert.equal(chatTranscriptChain.includes("assistant-workline"), true);
  assert.equal(chatActive.includes("deliverableAsLinearText"), false);
  assert.equal(chatTranscriptChain.includes("deliverableAsLinearText"), false);
  assert.equal(chatTranscriptChain.includes("assistantMessageOutput"), false);
  assert.equal(chatTranscriptChain.includes("projectAssistantMessageView"), true);
  assert.equal(assistantMessageViewProjection.includes("assistantMessageOutput"), true);
  assert.equal(chatTranscriptChain.includes("panel-transcript-turn-projection"), true);
  assert.equal(chatTranscriptChain.includes("deliverableForWorkSessionTurn"), false);
  assert.equal(transcriptTurnProjection.includes("deliverableForWorkSessionTurn"), true);
  assert.equal(transcriptTurnProjection.includes("answerForWorkSessionTurn"), true);
  assert.equal(chatActive.includes("EvidenceRefs"), false);
  assert.equal(chatActive.includes("NextSteps"), false);
  assert.equal(chatActive.includes("ResultPreview"), false);
  assert.equal(chatActive.includes("证据"), false);
  assert.equal(chatActive.includes('className="evidence-card"'), false);
  assert.equal(app.includes("innerHTML"), false);
  assert.equal(app.includes("raw provider"), false);
  assert.equal(app.includes("raw tool"), false);
  assert.equal(app.includes("stdout/stderr"), false);
  assertOrdinaryUiSourceHasNoInternalTerms([sidebar, chatEmpty, chatActive].join("\n"));
});
