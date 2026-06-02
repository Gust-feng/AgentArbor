import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel UI chat and transcript modules stay presentation-focused", async () => {
  const [
    chatEmpty,
    chatActive,
    transcriptTimeline,
    transcriptTimelineHeader,
    transcriptTimelineClassification,
    transcriptTimelineCopy,
    transcriptTimelineDetail,
    transcriptTimelineRow,
    transcriptConfirmation,
    transcriptToolDetail,
    transcriptToolFormat,
    transcriptNodeVisibility,
    chatSessionProjection,
    chatVisibleText,
    richText,
    liveStreamText,
    styleEntry,
    chatLayoutStyles,
    chatComposerStyles,
    chatMessageStyles,
    richTextStyles,
    chatFeedbackStyles,
    transcriptStyles,
    transcriptDetailStyles,
    transcriptFileReviewStyles,
    transcriptCommandStyles,
    transcriptConfirmationStyles,
    chatResultStyles,
  ] = await Promise.all([
    readPanelUiSource(path.join("components", "chat-empty.tsx")),
    readPanelUiSource(path.join("components", "chat-active.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline-header.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline-classification.ts")),
    readPanelUiSource(path.join("components", "transcript-timeline-copy.ts")),
    readPanelUiSource(path.join("components", "transcript-timeline-detail.tsx")),
    readPanelUiSource(path.join("components", "transcript-timeline-row.tsx")),
    readPanelUiSource(path.join("components", "transcript-confirmation.tsx")),
    readPanelUiSource(path.join("components", "transcript-tool-detail.tsx")),
    readPanelUiSource(path.join("components", "transcript-tool-format.ts")),
    readPanelUiSource(path.join("components", "transcript-node-visibility.ts")),
    readPanelUiSource(path.join("components", "chat-session-projection.ts")),
    readPanelUiSource(path.join("components", "chat-visible-text.ts")),
    readPanelUiSource(path.join("components", "rich-text.tsx")),
    readPanelUiSource(path.join("components", "live-stream-text.tsx")),
    readPanelUiSource("styles.css"),
    readPanelUiStyle("chat-layout.css"),
    readPanelUiStyle("chat-composer.css"),
    readPanelUiStyle("chat-message.css"),
    readPanelUiStyle("rich-text.css"),
    readPanelUiStyle("chat-feedback.css"),
    readPanelUiStyle("transcript.css"),
    readPanelUiStyle("transcript-detail.css"),
    readPanelUiStyle("transcript-file-review.css"),
    readPanelUiStyle("transcript-command.css"),
    readPanelUiStyle("transcript-confirmation.css"),
    readPanelUiStyle("chat-results.css"),
  ]);

  assert.equal(chatEmpty.includes("今天要处理什么？"), true);
  assert.equal(chatEmpty.includes("export function ChatInputBar"), true);
  assert.equal(chatEmpty.includes("providerLabel"), true);
  assert.equal(chatEmpty.includes("配置模型"), true);
  assert.equal(chatEmpty.includes("closeSignal"), true);
  assert.equal(chatEmpty.includes("composer-reasoning-control"), true);
  assert.equal(chatEmpty.includes("reasoningEffortEnabled"), true);
  assert.equal(chatEmpty.includes("当前工作入口"), false);
  assert.equal(chatEmpty.includes("继续最近任务"), false);
  assert.equal(chatEmpty.includes("管理模型厂商"), false);
  assert.equal(chatActive.includes("export function ChatActive"), true);
  assert.equal(chatActive.includes("WorkContextPanel"), false);
  assert.equal(chatActive.includes('import { RichText } from "./rich-text"'), true);
  assert.equal(chatActive.includes("resolveModelIconSvg"), false);
  assert.equal(chatSessionProjection.includes("resolveModelIconSvg"), true);
  assert.equal(chatActive.includes("assistantModelForTurn"), true);
  assert.equal(chatActive.includes(".slice(-8)"), false);
  assert.equal(chatActive.includes('from "./transcript-timeline"'), true);
  assert.equal(chatActive.includes('from "./transcript-node-visibility"'), true);
  assert.equal(chatActive.includes('from "./chat-visible-text"'), true);
  assert.equal(chatActive.includes('data-display="command"'), false);
  assert.equal(transcriptTimeline.includes('data-display="command"'), false);
  assert.equal(transcriptToolDetail.includes('data-display="command"'), true);
  assert.equal(transcriptTimeline.includes("export function AgentWorkTimeline"), true);
  assert.equal(transcriptTimeline.includes("export function visibleTranscriptNodes"), false);
  assert.equal(transcriptTimeline.includes("node.eventType"), false);
  assert.equal(transcriptTimeline.includes("timelineRowIdentity"), true);
  assert.equal(transcriptTimelineHeader.includes("model.reasoning.delta"), true);
  assert.equal(transcriptTimelineHeader.includes("LiveStreamBox"), true);
  assert.equal(transcriptTimelineClassification.includes("node.eventType"), true);
  assert.equal(transcriptTimelineClassification.includes("export function timelineRowCategory"), true);
  assert.equal(transcriptTimelineCopy.includes("export function timelineToolVerb"), true);
  assert.equal(transcriptTimelineCopy.includes("export function toolActionLabel"), true);
  assert.equal(transcriptTimelineDetail.includes("export function TranscriptTimelineDetail"), true);
  assert.equal(transcriptTimelineDetail.includes("ConfirmationNode"), true);
  assert.equal(transcriptTimelineDetail.includes("ToolNodeDetail"), true);
  assert.equal(transcriptTimelineRow.includes("export function AgentTimelineRow"), true);
  assert.equal(transcriptTimelineRow.includes("useState"), true);
  assert.equal(transcriptNodeVisibility.includes("export function visibleTranscriptNodes"), true);
  assert.equal(transcriptNodeVisibility.includes("export function timelineVisibleNodes"), true);
  assert.equal(transcriptToolFormat.includes("export function commandText"), true);
  assert.equal(transcriptToolFormat.includes("export function genericItemLabel"), true);
  assert.equal(transcriptConfirmation.includes("export function ConfirmationNode"), true);
  assert.equal(transcriptToolDetail.includes("export function ToolNodeDetail"), true);
  assert.equal(chatVisibleText.includes("export function userVisibleAnswer"), true);
  assert.equal(chatSessionProjection.includes("export function visibleTurns"), true);
  assert.equal(chatSessionProjection.includes("export function assistantModelForTurn"), true);
  assert.equal(chatSessionProjection.includes("export function visibleDeliverable"), true);
  assert.equal(chatSessionProjection.includes("export function visibleRunProblem"), true);
  assert.equal(chatActive.includes("TranscriptChain"), true);
  assert.equal(chatActive.includes("hasRunId(turn.runId)"), false);
  assert.equal(chatActive.includes("ConfirmationBanner"), false);
  assert.equal(chatActive.includes("hasLaterToolResolution"), false);
  assert.equal(chatActive.includes("showStandaloneRun"), true);
  assert.equal(chatActive.includes("pendingForTurn"), true);
  assert.equal(chatActive.includes("visibleTranscriptNodes"), true);
  assert.equal(chatActive.includes("node.eventType"), false);
  assert.equal(chatActive.includes("补充要求或限制..."), true);
  assert.equal(chatActive.includes('props.onDecision("guidance", guidance)'), true);
  assert.equal(transcriptTimeline.includes('props.busy ? "处理中" : "允许"'), false);
  assert.equal(transcriptConfirmation.includes('props.busy ? "处理中" : "允许"'), true);
  assert.equal(transcriptConfirmation.includes("拒绝"), true);
  assert.equal(chatActive.includes("confirmation-guidance-input"), false);
  assert.equal(chatActive.includes("判断下一步"), false);
  assert.equal(chatActive.includes('aria-label="思考"'), false);
  assert.equal(chatActive.includes("isSyntheticResponseModel"), false);
  assert.equal(chatSessionProjection.includes("isSyntheticResponseModel"), true);
  assert.equal(richText.includes('from "react-markdown"'), true);
  assert.equal(richText.includes('from "remark-gfm"'), true);
  assert.equal(richText.includes("normalizeCollapsedMarkdown"), true);
  assert.equal(richText.includes("skipHtml"), true);
  assert.equal(richText.includes("(?=\\S)"), true);
  assert.equal(richText.includes("rich-code-block"), true);
  assert.equal(richText.includes("dangerouslySetInnerHTML"), false);
  assert.equal(richText.includes("innerHTML"), false);
  assert.equal(liveStreamText.includes("renderText?: (text: string) => React.ReactNode"), true);
  assert.equal(liveStreamText.includes("updateFrozenMarkdownStreamState"), true);
  assert.equal(liveStreamText.includes("markdownStreamViewport"), true);
  assert.equal(liveStreamText.includes("live-stream-frozen-chunk"), true);
  assert.equal(liveStreamText.includes("live-stream-live-tail"), true);
  assert.equal(liveStreamText.includes("container.textContent"), false);
  assert.equal(styleEntry.includes('@import "./styles/chat-layout.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-composer.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-message.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/rich-text.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-feedback.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript-detail.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript-file-review.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript-command.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/transcript-confirmation.css"'), true);
  assert.equal(styleEntry.includes('@import "./styles/chat-results.css"'), true);
  assert.equal(styleEntry.includes(".chat-active-scroll"), false);
  assert.equal(chatLayoutStyles.includes(".chat-empty-screen,"), true);
  assert.equal(chatLayoutStyles.includes(".chat-input-card"), false);
  assert.equal(chatComposerStyles.includes(".chat-input-card"), true);
  assert.equal(chatComposerStyles.includes(".chat-active-grid"), false);
  assert.equal(chatMessageStyles.includes(".chat-active-grid"), true);
  assert.equal(chatMessageStyles.includes(".rich-text"), false);
  assert.equal(richTextStyles.includes(".rich-text"), true);
  assert.equal(richTextStyles.includes("dangerouslySetInnerHTML"), false);
  assert.equal(chatFeedbackStyles.includes(".assistant-error-message"), true);
  assert.equal(chatFeedbackStyles.includes(".agent-work-timeline"), false);
  assert.equal(transcriptStyles.includes(".agent-timeline-track::before"), true);
  assert.equal(transcriptStyles.includes(".agent-timeline-marker"), true);
  assert.equal(transcriptStyles.includes(".transcript-tool-detail"), false);
  assert.equal(transcriptDetailStyles.includes(".transcript-tool-detail"), true);
  assert.equal(transcriptDetailStyles.includes(".file-change-review"), false);
  assert.equal(transcriptFileReviewStyles.includes(".file-change-review"), true);
  assert.equal(transcriptFileReviewStyles.includes(".transcript-command-block"), false);
  assert.equal(transcriptCommandStyles.includes(".transcript-command-block"), true);
  assert.equal(transcriptCommandStyles.includes(".confirmation-node-body"), false);
  assert.equal(transcriptConfirmationStyles.includes(".confirmation-node-body"), true);
  assert.equal(chatResultStyles.includes(".result-preview"), true);
  assert.equal([chatMessageStyles, richTextStyles, transcriptStyles].join("\n").includes("text-wrap: pretty"), false);
  assert.equal(chatMessageStyles.includes("contain: layout paint"), true);
});
