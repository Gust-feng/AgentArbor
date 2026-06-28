import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel UI chat and transcript modules stay presentation-focused", async () => {
  const [
    chatEmpty,
    chatActive,
    chatTranscriptDisplay,
    chatTranscriptChain,
    transcriptTimeline,
    transcriptConfirmationProjection,
    confirmationDisplayProjection,
    transcriptTimelineCopy,
    agentWorkTimelineProjection,
    transcriptConfirmation,
    transcriptToolFormat,
    transcriptNodeVisibility,
    chatSessionProjection,
    chatWorklineProjection,
    transcriptTurnProjection,
    chatActiveProjection,
    chatActiveViewProjection,
    assistantVisibleText,
    assistantFailureProjection,
    assistantMessageOutputProjection,
    assistantMessageViewProjection,
    assistantMessageStructureProjection,
    conversationDisplayListProjection,
    assistantRunOutputProjection,
    richText,
    liveStreamText,
    styleEntry,
    chatLayoutStyles,
    chatComposerStyles,
    chatMessageStyles,
    richTextStyles,
    chatFeedbackStyles,
    transcriptStyles,
    defaultStyle,
    glassStyle,
    transcriptConfirmationStyles,
    chatResultStyles,
  ] = await Promise.all([
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "chat-active.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-display.tsx")),
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readAppSource("panel-transcript-confirmation-projection.ts"),
    readAppSource("panel-confirmation-display-projection.ts"),
    readAppSource("panel-transcript-activity-copy.ts"),
    readAppSource("panel-agent-work-timeline-view.ts"),
    readPanelUiSource(path.join("components", "transcript-confirmation.tsx")),
    readAppSource("panel-transcript-tool-format.ts"),
    readAppSource("panel-transcript-node-projection.ts"),
    readPanelUiSource(path.join("components", "chat-session-projection.ts")),
    readAppSource("panel-ui-chat-workline.ts"),
    readAppSource("panel-transcript-turn-projection.ts"),
    readAppSource("panel-ui-chat-active-projection.ts"),
    readAppSource("panel-ui-chat-active-view.ts"),
    readAppSource("panel-assistant-visible-text.ts"),
    readAppSource("panel-assistant-failure.ts"),
    readAppSource("panel-assistant-message-output.ts"),
    readAppSource("panel-assistant-message-view.ts"),
    readAppSource("panel-assistant-message-structure.ts"),
    readAppSource("panel-conversation-display-list.ts"),
    readAppSource("panel-assistant-run-output.ts"),
    readPanelUiSource(path.join("components", "rich-text.tsx")),
    readPanelUiSource(path.join("components", "live-stream-text.tsx")),
    readPanelUiSource("styles.css"),
    readPanelUiStyle("chat-layout.css"),
    readPanelUiStyle("chat-composer.css"),
    readPanelUiStyle("chat-message.css"),
    readPanelUiStyle("rich-text.css"),
    readPanelUiStyle("chat-feedback.css"),
    readPanelUiStyle("transcript.css"),
    readPanelUiStyle("style-default.css"),
    readPanelUiStyle("style-glass.css"),
    readPanelUiStyle("transcript-confirmation.css"),
    readPanelUiStyle("chat-results.css"),
  ]);

  assert.equal(chatEmpty.includes("今天要处理什么？"), false);
  assert.equal(chatEmpty.includes("chatEmptyVisual"), false);
  assert.equal(chatEmpty.includes("chat-empty-visual"), false);
  assert.equal(chatEmpty.includes("draggable"), false);
  assert.equal(chatEmpty.includes("PromptTraceAnimation"), false);
  assert.equal(chatEmpty.includes("export function ChatInputBar"), true);
  assert.equal(chatEmpty.includes('variant="home"'), false);
  assert.equal(chatEmpty.includes('variant="floating"'), true);
  assert.equal(chatEmpty.includes("textareaRef"), true);
  assert.equal(chatEmpty.includes("didAutoFocusRef"), true);
  assert.equal(chatEmpty.includes("previousBusyRef"), true);
  assert.equal(chatEmpty.includes("任务中心"), false);
  assert.equal(chatEmpty.includes("workbenchTaskCardsFromConversations"), false);
  assert.equal(chatEmpty.includes("function TaskCenterCard"), false);
  assert.equal(chatEmpty.includes("resumeTaskFromConversations"), false);
  assert.equal(chatEmpty.includes("function EmptyResumePrompt"), false);
  assert.equal(chatEmpty.includes("chat-empty-resume"), false);
  assert.equal(chatEmpty.includes("打开可继续任务"), false);
  assert.equal(chatEmpty.includes("providerLabel"), true);
  assert.equal(chatEmpty.includes("配置模型"), true);
  assert.equal(chatEmpty.includes("closeSignal"), true);
  assert.equal(chatEmpty.includes("composer-options-button"), true);
  assert.equal(chatEmpty.includes("composer-options-popover"), true);
  assert.equal(chatEmpty.includes("model-select-button"), false);
  assert.equal(chatEmpty.includes("composer-reasoning-chip"), true);
  assert.equal(chatEmpty.includes("composer-access-chip"), true);
  assert.equal(chatEmpty.includes("完全访问"), true);
  assert.equal(chatEmpty.includes("toolConfirmationPolicy"), true);
  assert.equal(chatEmpty.includes("reasoningEffortEnabled"), true);
  assert.equal(chatEmpty.includes("当前工作入口"), false);
  assert.equal(chatEmpty.includes("继续最近任务"), false);
  assert.equal(chatEmpty.includes("管理模型厂商"), false);
  assert.equal(chatEmpty.includes("chat-empty-task-groups"), false);
  assert.equal(chatEmpty.includes("chat-empty-task-group-heading"), false);
  assert.equal(chatEmpty.includes("props.task.currentAction"), false);
  assert.equal(chatEmpty.includes("task.nextStep"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-task-next"), false);
  assert.equal(chatActive.includes("export function ChatActive"), true);
  assert.equal(chatActive.includes("WorkContextPanel"), false);
  assert.equal(chatActive.includes('import { RichText } from "./rich-text"'), true);
  assert.equal(chatActive.includes("resolveModelIconSvg"), false);
  assert.equal(chatSessionProjection.includes("resolveModelIconSvg"), true);
  assert.equal(chatActive.includes("assistantModelForTurn"), false);
  assert.equal(chatTranscriptChain.includes("assistantModelForTurn"), true);
  assert.equal(chatActive.includes(".slice(-8)"), false);
  assert.equal(chatActive.includes('from "./transcript-timeline"'), false);
  assert.equal(chatTranscriptChain.includes('from "./transcript-timeline"'), true);
  assert.equal(chatTranscriptChain.includes("stableViewRef"), false);
  assert.equal(chatActive.includes("projectConversationDisplayList"), false);
  assert.equal(chatActive.includes("subscribeTranscriptNodesCache"), false);
  assert.equal(chatActive.includes("transcriptNodesCacheForConversation("), true);
  assert.equal(chatActive.includes("<ChatTranscriptDisplay"), true);
  assert.equal(chatTranscriptDisplay.includes("projectConversationDisplayList"), true);
  assert.equal(chatTranscriptDisplay.includes("createConversationWorkflowDisplayState"), true);
  assert.equal(chatTranscriptDisplay.includes("subscribeTranscriptNodesCache(props.conversationId, listener)"), true);
  assert.equal(chatTranscriptDisplay.includes("transcriptNodesCacheForConversation(\n    cachedHistoricalSnapshot,\n    props.conversationId"), true);
  assert.equal(chatTranscriptDisplay.includes("cachedNodesByRunId: cachedHistoricalNodes,\n      currentRunId: props.currentRunId"), true);
  assert.equal(chatTranscriptDisplay.includes("cachedNodesByRunId: cachedHistoricalNodes,\n      currentRunId: props.run?.runId"), false);
  assert.equal(chatActive.includes("projectStandaloneAssistantWorkflowDisplay"), false);
  assert.equal(conversationDisplayListProjection.includes("export function projectConversationDisplayList"), true);
  assert.equal(conversationDisplayListProjection.includes("projectConversationWorkflowDisplay"), true);
  assert.equal(conversationDisplayListProjection.includes("projectStandaloneAssistantWorkflowDisplay"), true);
  assert.equal(chatTranscriptChain.includes("projectConversationWorkflowDisplay"), false);
  assert.equal(chatTranscriptChain.includes("panel-assistant-workflow-display"), true);
  assert.equal(chatTranscriptChain.includes("createConversationWorkflowDisplayState"), false);
  assert.equal(chatTranscriptChain.includes("projectConversationDisplayList"), false);
  assert.equal(chatTranscriptChain.includes("subscribeTranscriptNodesCache"), false);
  assert.equal(chatTranscriptChain.includes("projectStableAssistantTurnDisplays"), false);
  assert.equal(chatTranscriptChain.includes("materializeConversationTranscript"), false);
  assert.equal(chatTranscriptChain.includes("mergeStickyTranscriptNodesByRunId"), false);
  assert.equal(chatTranscriptChain.includes("assistantShellSnapshot"), false);
  assert.equal(chatActive.includes("panel-transcript-node-projection"), false);
  assert.equal(chatActive.includes('from "./transcript-node-visibility"'), false);
  assert.equal(chatActive.includes('from "./workbench-task-situation"'), false);
  assert.equal(chatActive.includes("projectWorkbenchTaskSituation"), false);
  assert.equal(chatActive.includes("WorkbenchTaskSituationPanel"), false);
  assert.equal(chatActive.includes("taskSituation"), false);
  assert.equal(chatActive.includes("当前任务态势"), false);
  assert.equal(chatActive.includes('from "./chat-visible-text"'), false);
  assert.equal(chatTranscriptChain.includes('from "./chat-visible-text"'), false);
  assert.equal(chatTranscriptChain.includes("panel-assistant-message-output"), false);
  assert.equal(chatTranscriptChain.includes("panel-assistant-message-view"), false);
  assert.equal(chatTranscriptChain.includes("panel-transcript-turn-projection"), true);
  assert.equal(chatTranscriptChain.includes("projectAssistantTranscriptTurn"), false);
  assert.equal(chatActive.includes('from "./chat-transcript-display"'), true);
  assert.equal(chatActive.includes('data-display="command"'), false);
  assert.equal(chatTranscriptChain.includes('data-display="command"'), false);
  assert.equal(transcriptTimeline.includes('data-display="command"'), false);
  assert.equal(transcriptTimeline.includes("export function AgentWorkTimeline"), true);
  assert.equal(transcriptTimeline.includes("export function activityItemsForNodes"), false);
  assert.equal(transcriptTimeline.includes("export function workflowItemsForNodes"), false);
  assert.equal(transcriptTimeline.includes("activityItemsForNodes"), false);
  assert.equal(transcriptTimeline.includes("workflowItemsForNodes"), false);
  assert.equal(agentWorkTimelineProjection.includes("export function projectAgentWorkTimelineView"), true);
  assert.equal(agentWorkTimelineProjection.includes("timelineVisibleNodes"), true);
  assert.equal(agentWorkTimelineProjection.includes("timelineConfirmationProjection"), true);
  assert.equal(agentWorkTimelineProjection.includes("displayActivityItemsForNodes"), true);
  assert.equal(agentWorkTimelineProjection.includes("workflowItemsForNodes"), false);
  assert.equal(agentWorkTimelineProjection.includes("confirmationNodesForProjection"), true);
  assert.equal(agentWorkTimelineProjection.includes("hasContent"), true);
  assert.equal(transcriptTimeline.includes("export function compactWorkflowItemsForDisplay"), false);
  assert.equal(transcriptTimeline.includes("export function currentActivityItemForNodes"), false);
  assert.equal(transcriptTimeline.includes("MAX_ACTIVITY_ITEMS"), false);
  assert.equal(transcriptTimeline.includes("COLLAPSED_WORKFLOW_ITEMS"), false);
  assert.equal(transcriptTimeline.includes("agent-workline"), true);
  assert.equal(transcriptTimeline.includes("agent-workflow"), false);
  assert.equal(transcriptTimeline.includes("agent-activity"), true);
  assert.equal(transcriptTimeline.includes("agent-activity-step"), true);
  assert.equal(transcriptTimeline.includes("agent-activity-step confirmation"), true);
  assert.equal(transcriptTimeline.includes("agent-activity-marker"), true);
  assert.equal(transcriptTimeline.includes("agent-activity-toggle"), false);
  assert.equal(transcriptTimeline.includes("agent-activity-disclosure"), true);
  assert.equal(transcriptTimeline.includes("agent-activity-expanded-detail"), true);
  assert.equal(transcriptTimeline.includes("expandedDetail"), true);
  assert.equal(transcriptTimeline.includes("function shouldRenderExpandedDetail"), true);
  assert.equal(transcriptTimeline.includes('item.tone === "thinking" || item.tone === "narration" || item.tone === "system"'), true);
  assert.equal(transcriptTimeline.includes("timelineConfirmationProjection"), false);
  assert.equal(transcriptTimeline.includes("confirmationForNode"), false);
  assert.equal(transcriptTimeline.includes("currentConfirmationNode"), false);
  assert.equal(transcriptConfirmationProjection.includes("export function timelineConfirmationProjection"), true);
  assert.equal(transcriptConfirmationProjection.includes("export function confirmationForNode"), true);
  assert.equal(transcriptConfirmationProjection.includes("export function pendingForTurn"), true);
  assert.equal(confirmationDisplayProjection.includes("export function projectConfirmationDisplay"), true);
  assert.equal(confirmationDisplayProjection.includes("cleanConfirmationSummary"), true);
  assert.equal(confirmationDisplayProjection.includes("发送新消息即可基于当前上下文继续。"), true);
  assert.equal(transcriptTimeline.includes("agent-workline-current"), false);
  assert.equal(transcriptTimeline.includes("agent-workline-confirmation"), false);
  assert.equal(transcriptTimeline.includes("agent-activity-rail"), false);
  assert.equal(transcriptTimeline.includes("allWorkflowItems.map"), false);
  assert.equal(transcriptTimeline.includes("items.map"), true);
  assert.equal(transcriptTimeline.includes("visibleItems.map"), false);
  assert.equal(transcriptTimeline.includes('"thinking" | "narration" | "tool"'), false);
  assert.equal(transcriptTimeline.includes('"confirmation"'), false);
  assert.equal(transcriptTimeline.includes("export function visibleTranscriptNodes"), false);
  assert.equal(transcriptTimeline.includes("node.eventType"), false);
  assert.equal(transcriptTimeline.includes("timelineRowIdentity"), false);
  assert.equal(transcriptTimeline.includes("AgentTimelineRow"), false);
  assert.equal(transcriptTimeline.includes("TranscriptTimelineDetail"), false);
  assert.equal(transcriptTimeline.includes("ToolNodeDetail"), false);
  assert.equal(transcriptTimeline.includes("readonly collapsed?: boolean"), true);
  assert.equal(transcriptTimeline.includes("readonly lifecycle?:"), true);
  assert.equal(transcriptTimeline.includes("readonly collapseReason?:"), true);
  assert.equal(transcriptTimeline.includes("data-lifecycle={props.lifecycle}"), true);
  assert.equal(transcriptTimeline.includes("data-collapse-reason={props.collapseReason}"), true);
  assert.equal(chatTranscriptChain.includes("lifecycle={segment.lifecycle}"), true);
  assert.equal(chatTranscriptChain.includes("collapseReason={segment.collapseReason}"), true);
  assert.equal(transcriptTimeline.includes("agent-workline-disclosure"), true);
  assert.equal(transcriptTimeline.includes("agent-workline-summary"), true);
  assert.equal(transcriptTimeline.includes("agent-workline-summary-chip"), true);
  assert.equal(transcriptTimeline.includes("activityMetrics"), true);
  assert.equal(transcriptTimelineCopy.includes("export function activityLineForNode"), true);
  assert.equal(transcriptTimelineCopy.includes("export function activityItemsForNodes"), true);
  assert.equal(transcriptTimelineCopy.includes("export function displayActivityItemsForNodes"), true);
  assert.equal(transcriptTimelineCopy.includes("export function workflowItemsForNodes"), false);
  assert.equal(transcriptTimelineCopy.includes("export type ActivityLineCopy"), true);
  assert.equal(transcriptTimelineCopy.includes("export type ActivityItem"), true);
  assert.equal(transcriptTimelineCopy.includes("export function readableThinkingText"), true);
  assert.equal(transcriptTimelineCopy.includes("export function readableThinkingCopy"), true);
  assert.equal(transcriptTimelineCopy.includes("readableExpandedModelText"), true);
  assert.equal(transcriptTimelineCopy.includes("restoreReadableEnglishBoundaries"), false);
  assert.equal(transcriptTimelineCopy.includes("export function readableNarrationText"), true);
  assert.equal(transcriptTimelineCopy.includes("export function readableNarrationCopy"), true);
  assert.equal(transcriptTimelineCopy.includes("expandedDetail"), true);
  assert.equal(transcriptTimelineCopy.includes('"thinking" | "narration" | "tool"'), true);
  assert.equal(transcriptTimelineCopy.includes('"confirmation"'), true);
  assert.equal(transcriptTimelineCopy.includes('return "命令"'), true);
  assert.equal(transcriptTimelineCopy.includes('return "读取"'), true);
  assert.equal(transcriptTimelineCopy.includes("looksLikeCompressedLatin"), false);
  assert.equal(transcriptTimelineCopy.includes("commandText(display)"), true);
  assert.equal(transcriptTimelineCopy.includes("export function timelineToolVerb"), false);
  assert.equal(transcriptTimelineCopy.includes("export function toolActionLabel"), false);
  assert.equal(transcriptNodeVisibility.includes("export function visibleTranscriptNodes"), true);
  assert.equal(transcriptNodeVisibility.includes("export function timelineVisibleNodes"), true);
  assert.equal(transcriptNodeVisibility.includes("export function activityVisibleNodes"), true);
  assert.equal(transcriptNodeVisibility.includes("export function workflowVisibleNodes"), false);
  assert.equal(transcriptNodeVisibility.includes("hasWorkActivity"), false);
  assert.equal(transcriptNodeVisibility.includes("return text.length > 0;"), true);
  assert.equal(transcriptNodeVisibility.includes("export function isLowValueUserDecisionNode"), true);
  assert.equal(transcriptNodeVisibility.includes('node.kind === "tool" || node.kind === "confirmation"'), true);
  assert.equal(transcriptToolFormat.includes("export function commandText"), true);
  assert.equal(transcriptToolFormat.includes("export function genericItemLabel"), true);
  assert.equal(transcriptConfirmation.includes("export function ConfirmationNode"), true);
  assert.equal(assistantVisibleText.includes("export function userVisibleAnswer"), true);
  assert.equal(assistantVisibleText.includes("export function sanitizeFailureCopy"), true);
  assert.equal(chatSessionProjection.includes("export function visibleTurns"), false);
  assert.equal(chatSessionProjection.includes("export function showStandaloneRun"), false);
  assert.equal(chatWorklineProjection.includes("export function projectChatWorkline"), true);
  assert.equal(chatWorklineProjection.includes("latestClaimableAssistantTurnId"), true);
  assert.equal(chatWorklineProjection.includes("standaloneRun"), true);
  assert.equal(transcriptTurnProjection.includes("export function projectAssistantTranscriptTurn"), true);
  assert.equal(transcriptTurnProjection.includes("export function assistantShellSnapshot"), true);
  assert.equal(transcriptTurnProjection.includes("export function isRefreshingRunStatus"), true);
  assert.equal(transcriptTurnProjection.includes("answerForWorkViewTurn"), true);
  assert.equal(transcriptTurnProjection.includes("deliverableForWorkViewTurn"), true);
  assert.equal(transcriptTurnProjection.includes("pendingForTurn"), true);
  assert.equal(transcriptTurnProjection.includes("run.started:node"), false);
  assert.equal(transcriptTurnProjection.includes("已开始处理。"), false);
  assert.equal(chatActiveProjection.includes("export function projectChatActive"), true);
  assert.equal(chatActiveProjection.includes("projectChatWorkline"), true);
  assert.equal(chatActiveProjection.includes("run.started:node"), false);
  assert.equal(chatActiveProjection.includes("已开始处理。"), false);
  assert.equal(transcriptTurnProjection.includes("panel-transcript-startup-node"), false);
  assert.equal(chatActiveProjection.includes("panel-transcript-startup-node"), false);
  assert.equal(chatActiveProjection.includes("terminalStatuses"), true);
  assert.equal(chatActiveProjection.includes('"blocked"'), true);
  assert.equal(chatActiveProjection.includes("statusNotice"), true);
  assert.equal(chatActiveProjection.includes("standaloneAssistant"), false);
  assert.equal(chatActiveProjection.includes("scrollKey"), true);
  assert.equal(chatActiveViewProjection.includes("export function projectChatActiveView"), true);
  assert.equal(chatActiveViewProjection.includes("activityVisibleNodes"), true);
  assert.equal(chatActiveViewProjection.includes("workflowVisibleNodes"), false);
  assert.equal(chatActiveViewProjection.includes("visibleDeliverable"), true);
  assert.equal(chatActiveViewProjection.includes("visibleResultText"), true);
  assert.equal(chatActiveViewProjection.includes("visibleRunProblem"), true);
  assert.equal(chatActive.includes("../../../panel-ui-chat-active-view"), true);
  assert.equal(chatActive.includes("./chat-active-projection"), false);
  assert.equal(chatSessionProjection.includes("export function assistantModelForTurn"), true);
  assert.equal(chatSessionProjection.includes("export function visibleDeliverable"), false);
  assert.equal(assistantMessageOutputProjection.includes("export function visibleDeliverable"), true);
  assert.equal(chatSessionProjection.includes("export function visibleRunProblem"), false);
  assert.equal(chatSessionProjection.includes("export function visibleResultText"), false);
  assert.equal(assistantRunOutputProjection.includes("export function visibleRunProblem"), true);
  assert.equal(assistantRunOutputProjection.includes("export function visibleResultText"), true);
  assert.equal(chatActive.includes("ChatTranscriptDisplay"), true);
  assert.equal(chatTranscriptDisplay.includes("TranscriptChain"), true);
  assert.equal(chatTranscriptChain.includes("export function TranscriptChain"), true);
  assert.equal(chatTranscriptChain.includes("export function AssistantMessage"), true);
  assert.equal(chatTranscriptChain.includes("export function AssistantAvatar"), false);
  assert.equal(chatTranscriptChain.includes("export function TypingDots"), true);
  assert.equal(chatActive.includes("session-placeholder"), false);
  assert.equal(chatTranscriptChain.includes("collapseTimeline"), false);
  assert.equal(chatTranscriptChain.includes("assistant-workline-collapsed"), true);
  assert.equal(chatActive.includes("shouldCollapseStandaloneTimeline"), false);
  assert.equal(chatTranscriptDisplay.includes("shouldCollapseStandaloneTimeline"), true);
  assert.equal(chatActive.includes("assistant-workline"), false);
  assert.equal(chatTranscriptChain.includes("assistant-workline"), true);
  assert.equal(chatActive.includes("const visible = userVisibleAnswer(props.content);"), false);
  assert.equal(chatTranscriptChain.includes("const visible = userVisibleAnswer(props.content);"), false);
  assert.equal(assistantMessageOutputProjection.includes("userVisibleAnswer(input.content)"), true);
  assert.equal(chatActive.includes("animateOnMount={animateAnswerOnMount}"), false);
  assert.equal(chatTranscriptChain.includes("animateOnMount={animateAnswerOnMount}"), false);
  assert.equal(assistantMessageViewProjection.includes("animateAnswerOnMount"), true);
  assert.equal(assistantMessageViewProjection.includes("projectAssistantMessageStructure"), true);
  assert.equal(assistantMessageViewProjection.includes("projectAgentWorkTimelineView"), false);
  assert.equal(assistantMessageStructureProjection.includes("export function projectAssistantMessageStructure"), true);
  assert.equal(assistantMessageStructureProjection.includes("projectAgentWorkTimelineView"), true);
  assert.equal(assistantMessageStructureProjection.includes("assistantMessageCopyTextFromSegments"), true);
  assert.equal(chatActive.includes("answerFromLiveReplay"), false);
  assert.equal(chatTranscriptChain.includes("answerFromLiveReplay"), false);
  assert.equal(transcriptTurnProjection.includes("answerFromLiveReplay"), false);
  assert.equal(chatActive.includes("turn.content.trim().length === 0"), false);
  assert.equal(chatTranscriptChain.includes("turn.content.trim().length === 0"), false);
  assert.equal(transcriptTurnProjection.includes("turn.content.trim().length === 0"), true);
  assert.equal(chatActive.includes("autoStickToBottomRef"), true);
  assert.equal(chatActive.includes("isNearBottom(node)"), true);
  assert.equal(chatActive.includes("node.scrollTop = nextTop"), true);
  assert.equal(chatActive.includes("isRefreshingRunStatus"), false);
  assert.equal(chatActive.includes("standaloneRefreshing"), false);
  assert.equal(chatActive.includes("keepStreamMounted={standaloneRefreshing}"), false);
  assert.equal(chatActive.includes("standaloneAssistant"), false);
  assert.equal(chatActive.includes("standaloneRun={"), true);
  assert.equal(chatTranscriptDisplay.includes("standaloneRun:"), true);
  assert.equal(chatActive.includes("shouldShowStatusNotice"), false);
  assert.equal(chatActiveProjection.includes("function shouldShowStatusNotice"), true);
  assert.equal(chatActive.includes("{hasAnswer && ("), false);
  assert.equal(chatTranscriptChain.includes("{hasAnswer && ("), false);
  assert.equal(assistantMessageViewProjection.includes("answer: output.hasAnswer"), true);
  assert.equal(chatActive.includes("assistantFailureParts"), false);
  assert.equal(chatTranscriptChain.includes("assistantFailureParts"), false);
  assert.equal(chatTranscriptChain.includes("assistantFailureParts("), false);
  assert.equal(assistantFailureProjection.includes("export function assistantFailureParts"), true);
  assert.equal(chatTranscriptChain.includes("projectAgentWorkTimelineView"), false);
  assert.equal(chatTranscriptChain.includes("projectAgentWorkTimelineView("), false);
  assert.equal(chatTranscriptChain.includes("projectAssistantMessageView("), false);
  assert.equal(chatTranscriptChain.includes("failure={item.failure}"), true);
  assert.equal(chatTranscriptChain.includes("workflow={item.workflow}"), true);
  assert.equal(chatTranscriptChain.includes("readonly failure: AssistantFailureParts;"), true);
  assert.equal(chatTranscriptChain.includes("readonly workflow?: AssistantWorkflowDisplay<TranscriptNode, ConfirmationProjection>;"), true);
  assert.equal(chatTranscriptChain.includes("const bodySegments = workflow?.segments.filter((segment) => segment.kind !== \"activity\") ?? [];"), true);
  assert.equal(chatTranscriptChain.includes("const activitySegments = workflow?.segments.filter((segment) => segment.kind === \"activity\") ?? [];"), true);
  assert.equal(chatTranscriptChain.includes("workflow !== undefined\n          ? bodySegments.map"), true);
  assert.equal(chatTranscriptChain.includes(": props.failure.previous.length > 0 && ("), true);
  assert.equal(chatTranscriptChain.includes("transcriptNodes={item.failure.transcriptNodes}"), false);
  assert.equal(chatTranscriptChain.includes("readonly transcriptNodes?: readonly TranscriptNode[];"), false);
  assert.equal(chatTranscriptChain.includes(".filter((segment) => segment.kind === \"activity\")"), true);
  assert.equal(chatTranscriptChain.includes("className=\"assistant-failure-activity\""), true);
  assert.equal(chatTranscriptChain.includes("activitySegments.map((segment) => ("), true);
  assert.match(conversationDisplayListProjection, /turn\.status === "failed"[\s\S]*workflow,[\s\S]*failure: assistantDisplay\.failure/);
  assert.equal(conversationDisplayListProjection.includes("assistantFailureParts("), false);
  assert.equal(chatActive.includes("错误信息："), false);
  assert.equal(chatTranscriptChain.includes("错误信息："), false);
  assert.equal(assistantFailureProjection.includes("错误信息："), true);
  assert.equal(chatActive.includes("deliverableAsLinearText"), false);
  assert.equal(chatTranscriptChain.includes("deliverableAsLinearText"), false);
  assert.equal(assistantMessageOutputProjection.includes("export function deliverableAsLinearText"), true);
  assert.equal(chatActive.includes("deliverableForTurn"), false);
  assert.equal(chatTranscriptChain.includes("deliverableForTurn"), false);
  assert.equal(chatTranscriptChain.includes("deliverableForWorkViewTurn"), false);
  assert.equal(chatTranscriptChain.includes("answerForWorkViewTurn"), false);
  assert.equal(chatTranscriptChain.includes("assistantMessageOutput"), false);
  assert.equal(assistantMessageViewProjection.includes("assistantMessageOutput"), true);
  assert.equal(chatActive.includes("AnswerSupport"), false);
  assert.equal(chatActive.includes("answerResultForTurn"), false);
  assert.equal(chatActive.includes("contextLedgerForTurn"), false);
  assert.equal(chatActive.includes("contextLedger={contextLedger}"), false);
  assert.equal(chatActive.includes("answerResult={props.workSession?.answer}"), false);
  assert.equal(chatActive.includes("answerResult === undefined && <AssistantAnswerBlock"), false);
  assert.equal(chatActive.includes('aria-label="结果"'), false);
  assert.equal(chatActive.includes("复制结果"), false);
  assert.equal(chatActive.includes("evidenceItemsForRefs"), false);
  assert.equal(chatActive.includes("findContextLedgerEntry"), false);
  assert.equal(chatActive.includes("function isUserFacingEvidenceRef"), false);
  assert.equal(chatActive.includes("fallbackEvidenceSummary"), false);
  assert.equal(chatActive.includes("模型摘要"), false);
  assert.equal(chatActive.includes("工具证据"), false);
  assert.equal(chatActive.includes("运行摘要"), false);
  assert.equal(chatActive.includes("evidenceStatusLabel"), false);
  assert.equal(chatActive.includes('className="evidence-card"'), false);
  assert.equal(chatActive.includes("ref.label ?? ref.id"), false);
  assert.equal(chatActive.includes('status={turn.status}'), false);
  assert.equal(chatTranscriptChain.includes('status={turn.status}'), false);
  assert.equal(chatTranscriptChain.includes('status={item.turn.status}'), true);
  assert.equal(chatActive.includes('status === "pending"'), false);
  assert.equal(chatTranscriptChain.includes('status === "pending"'), true);
  assert.equal(chatActive.includes("user-message-queued"), false);
  assert.equal(chatTranscriptChain.includes("user-message-queued"), true);
  assert.equal(chatActive.includes("已排队，当前任务完成后处理"), false);
  assert.equal(chatTranscriptChain.includes("已排队，当前任务完成后处理"), false);
  assert.equal(chatTranscriptChain.includes('aria-label="等待当前回复完成"'), true);
  assert.equal(chatActive.includes("hasRunId(turn.runId)"), false);
  assert.equal(chatActive.includes("ConfirmationBanner"), false);
  assert.equal(chatActive.includes("hasLaterToolResolution"), false);
  assert.equal(chatActive.includes("projectChatWorkline"), false);
  assert.equal(chatActive.includes("showStandaloneRun"), false);
  assert.equal(chatActive.includes("pendingForTurn"), false);
  assert.equal(chatTranscriptChain.includes("pendingForTurn"), false);
  assert.equal(chatActive.includes("visibleTranscriptNodes"), false);
  assert.equal(chatActive.includes("workflowVisibleNodes"), false);
  assert.equal(chatActiveViewProjection.includes("activityVisibleNodes"), true);
  assert.equal(chatActiveViewProjection.includes("workflowVisibleNodes"), false);
  assert.equal(chatActive.includes("node.eventType"), false);
  assert.equal(chatTranscriptChain.includes("node.eventType"), false);
  assert.equal(chatSessionProjection.includes("hasRunId(turn.runId)"), false);
  assert.equal(chatSessionProjection.includes("!terminalStatuses.has(input.run.status)"), false);
  assert.equal(chatActive.includes("补充要求或限制..."), false);
  assert.equal(chatActive.includes("补充要求..."), true);
  assert.equal(chatActive.includes("继续输入..."), true);
  assert.equal(chatActive.includes('props.onDecision("guidance", guidance)'), true);
  assert.equal(transcriptTimeline.includes('props.busy ? "处理中" : "允许"'), false);
  assert.equal(transcriptConfirmation.includes("cleanConfirmationSummary"), false);
  assert.equal(transcriptConfirmation.includes("isInternalReference"), false);
  assert.equal(transcriptConfirmation.includes("confirmationAffectedResources"), false);
  assert.equal(transcriptConfirmation.includes("confirmationDisplayTitle"), false);
  assert.equal(transcriptConfirmation.includes("需重新发起。"), false);
  assert.equal(transcriptConfirmation.includes("projectConfirmationDisplay"), true);
  assert.equal(transcriptConfirmation.includes('props.busy ? "提交中" : "继续"'), false);
  assert.equal(transcriptConfirmation.includes('props.busy ? "执行中" : "执行"'), true);
  assert.equal(transcriptConfirmation.includes('props.busy ? "提交中" : "确认继续"'), false);
  assert.equal(transcriptConfirmation.includes("<span>待确认</span>"), false);
  assert.equal(transcriptConfirmation.includes("拒绝"), false);
  assert.equal(transcriptConfirmation.includes("不执行"), true);
  assert.equal(transcriptConfirmation.includes("confirmation-guidance-hint"), false);
  assert.equal(transcriptConfirmation.includes("确认后继续当前动作；拒绝则停止。也可以直接补充新的要求。"), false);
  assert.equal(transcriptConfirmation.includes("confirmation-action-summary"), true);
  assert.equal(transcriptConfirmationStyles.includes(".confirmation-command-row"), false);
  assert.equal(chatActive.includes("confirmation-guidance-input"), false);
  assert.equal(chatActive.includes("判断下一步"), false);
  assert.equal(chatActive.includes('aria-label="思考"'), false);
  assert.equal(chatActive.includes("isSyntheticResponseModel"), false);
  assert.equal(chatSessionProjection.includes("isSyntheticResponseModel"), true);
  assert.equal(transcriptNodeVisibility.includes("isStaleModelProgressSummary"), true);
  assert.equal(transcriptNodeVisibility.includes("正在组织直接回答"), false);
  assert.equal(transcriptNodeVisibility.includes("等待模型路由结果"), false);
  assert.equal(richText.includes('from "react-markdown"'), true);
  assert.equal(richText.includes('from "remark-gfm"'), true);
  assert.equal(richText.includes("normalizeMarkdownLineEndings"), true);
  assert.equal(richText.includes("skipHtml"), true);
  assert.equal(richText.includes("normalizePlainSegmentWhitespace"), false);
  assert.equal(richText.includes("\\n{3,}"), false);
  assert.equal(richText.includes("(?=\\S)"), false);
  assert.equal(richText.includes("rich-code-block"), true);
  assert.equal(richText.includes("dangerouslySetInnerHTML"), false);
  assert.equal(richText.includes("innerHTML"), false);
  assert.equal(liveStreamText.includes("renderText?: (text: string) => React.ReactNode"), true);
  assert.equal(liveStreamText.includes("animateOnMount"), true);
  assert.equal(liveStreamText.includes("shouldAnimateSettledText"), true);
  assert.equal(liveStreamText.includes("setStreamingRender"), true);
  assert.equal(liveStreamText.includes("streamingRender ? \"streaming\" : \"settled\""), true);
  assert.equal(liveStreamText.includes("updateFrozenMarkdownStreamState"), false);
  assert.equal(liveStreamText.includes("markdownStreamViewport"), false);
  assert.equal(liveStreamText.includes("live-stream-frozen-chunk"), false);
  assert.equal(liveStreamText.includes("live-stream-live-tail"), false);
  assert.equal(liveStreamText.includes('className="live-stream-live-tail"'), false);
  assert.equal(liveStreamText.includes("live-stream-live-tail-text"), false);
  assert.equal(liveStreamText.includes("renderText(viewport.liveTail)"), false);
  assert.equal(liveStreamText.includes("{viewport.liveTail}</span>"), false);
  assert.equal(liveStreamText.includes("renderText === undefined ? displayed"), true);
  assert.equal(liveStreamText.includes("renderText(displayed)"), true);
  assert.equal(liveStreamText.includes("consumeStreamingTextFrame(stateRef.current, latestPropsRef.current.tone)"), true);
  assert.equal(liveStreamText.includes("container.textContent"), false);
  assert.equal(styleEntry.includes('@import "./styles/chat-layout.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-composer.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-message.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/rich-text.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-feedback.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript-detail.css"'), false);
  assert.equal(styleEntry.includes('@import "./styles/transcript-file-review.css"'), false);
  assert.equal(styleEntry.includes('@import "./styles/transcript-command.css"'), false);
  assert.equal(styleEntry.includes('@import "./styles/transcript-confirmation.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-results.css"'), true);
  assert.equal(styleEntry.includes(".chat-active-scroll"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-screen,"), true);
  assert.equal(chatLayoutStyles.includes(".chat-empty-heading"), true);
  assert.equal(chatLayoutStyles.includes(".chat-empty-visual"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-kinetic"), false);
  assert.equal(chatLayoutStyles.includes("align-content: start"), true);
  assert.equal(chatLayoutStyles.includes("padding-block: clamp(112px, 16vh, 154px) 28px"), true);
  assert.equal(chatLayoutStyles.includes(".chat-empty-input-dock"), false);
  assert.equal(chatComposerStyles.includes(".chat-composer-home"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-task-groups,"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-task-group-heading"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-resume"), false);
  assert.equal(chatLayoutStyles.includes(".chat-input-card"), false);
  assert.equal(chatLayoutStyles.includes("overflow-anchor: none"), true);
  assert.equal(chatComposerStyles.includes(".chat-input-card"), true);
  assert.equal(chatComposerStyles.includes(".composer-options-button"), true);
  assert.equal(chatComposerStyles.includes(".composer-options-popover"), true);
  assert.equal(chatComposerStyles.includes(".composer-access-chip"), true);
  assert.equal(chatComposerStyles.includes(".model-select-button"), false);
  assert.equal(chatComposerStyles.includes(".chat-active-grid"), false);
  assert.equal(chatMessageStyles.includes(".chat-active-grid"), true);
  assert.equal(chatMessageStyles.includes("task-situation"), false);
  assert.equal(chatMessageStyles.includes(".user-message-queued"), true);
  assert.equal(chatMessageStyles.includes(".assistant-workline-collapsed"), true);
  assert.equal(chatTranscriptChain.includes("AssistantResponseMeta"), true);
  assert.equal(chatTranscriptChain.includes("workflowModelUsage"), true);
  assert.equal(chatTranscriptChain.includes("cachedInputTokens"), true);
  assert.equal(chatTranscriptChain.includes("uncachedInputTokens"), true);
  assert.equal(chatTranscriptChain.includes("new`"), true);
  assert.equal(chatTranscriptChain.includes("tokens ("), true);
  assert.equal(chatTranscriptChain.includes("首 token"), true);
  assert.equal(chatMessageStyles.includes(".assistant-response-meta"), true);
  assert.equal(chatMessageStyles.includes(".assistant-model-usage svg"), true);
  assert.equal(chatMessageStyles.includes("queued-dot-breathe"), true);
  assert.equal(chatMessageStyles.includes(".rich-text"), false);
  assert.equal(chatMessageStyles.includes(".live-stream-frozen-chunk"), false);
  assert.equal(chatMessageStyles.includes("transition: color"), false);
  assert.equal(richTextStyles.includes(".rich-text"), true);
  assert.equal(richTextStyles.includes(".live-stream-live-tail-text"), false);
  assert.equal(richTextStyles.includes("white-space: normal"), false);
  assert.equal(richTextStyles.includes("min-height: 1.84em"), true);
  assert.equal(richTextStyles.includes("dangerouslySetInnerHTML"), false);
  assert.equal(chatFeedbackStyles.includes(".assistant-error-message"), true);
  assert.equal(chatFeedbackStyles.includes(".agent-work-timeline"), false);
  assert.equal(transcriptStyles.includes(".agent-workline"), true);
  assert.equal(transcriptStyles.includes(".agent-workline-disclosure"), true);
  assert.equal(transcriptStyles.includes(".agent-workline-summary"), true);
  assert.equal(transcriptStyles.includes(".agent-workline-summary-chip"), true);
  assert.equal(transcriptStyles.includes(".agent-workline-summary-icon"), true);
  assert.equal(transcriptStyles.includes(".agent-workline-summary-chevron"), true);
  assert.equal(transcriptStyles.includes(".agent-workflow"), false);
  assert.equal(transcriptStyles.includes(".agent-activity"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-step"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-marker"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-toggle"), false);
  assert.equal(transcriptStyles.includes(".agent-activity-disclosure"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-label"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-detail"), true);
  assert.equal(transcriptStyles.includes(".agent-activity-expanded-detail"), true);
  assert.match(transcriptStyles, /\.agent-activity-step\[data-current="true"\]\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(transcriptStyles, /\.agent-activity-label\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(defaultStyle, /html\[data-style="default"\] \.agent-activity-step\[data-current="true"\]\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(glassStyle, /html\[data-style="glass"\] \.agent-activity-step\[data-current="true"\]\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.equal(transcriptStyles.includes(".agent-workline-current"), false);
  assert.equal(transcriptStyles.includes(".agent-workline-label"), false);
  assert.equal(transcriptStyles.includes(".agent-workline-detail"), false);
  assert.equal(transcriptStyles.includes(".agent-workline-pulse"), false);
  assert.equal(transcriptStyles.includes(".agent-activity-rail::before"), false);
  assert.equal(transcriptStyles.includes(".agent-timeline-track::before"), false);
  assert.equal(transcriptStyles.includes(".agent-timeline-marker"), false);
  assert.equal(transcriptStyles.includes(".transcript-tool-detail"), false);
  assert.equal(transcriptConfirmationStyles.includes(".confirmation-node-body"), true);
  assert.equal(transcriptConfirmationStyles.includes(".confirmation-guidance-hint"), false);
  assert.equal(chatResultStyles.includes(".result-preview"), false);
  assert.equal(chatResultStyles.includes(".answer-result-card"), false);
  assert.equal(chatResultStyles.includes(".answer-result-content"), false);
  assert.equal(chatResultStyles.includes(".result-kicker"), false);
  assert.equal(chatResultStyles.includes(".result-actions"), false);
  assert.equal(chatResultStyles.includes(".evidence-list"), false);
  assert.equal(chatResultStyles.includes(".evidence-card"), false);
  assert.equal(chatResultStyles.includes(".evidence-card-heading"), false);
  assert.equal(chatResultStyles.includes(".evidence-status-used"), false);
  assert.equal(chatResultStyles.includes(".next-steps"), false);
  assert.equal([chatMessageStyles, richTextStyles, transcriptStyles].join("\n").includes("text-wrap: pretty"), false);
  assert.equal(chatMessageStyles.includes("contain: layout paint"), true);
});
