import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAppSource, readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("panel conversation rendering has one Redesign-owned production path", async () => {
  const [main, personalWorkbench, workbench, transcript, evidence, confirmation, richText, richTextStyle, globalStyles, styleEntry] = await Promise.all([
    readPanelUiSource("main.tsx"),
    readPanelUiSource(path.join("personal-workbench", "personal-workbench.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "agentarbor-workbench.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "RedesignTranscript.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "ActivityEvidence.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "ConfirmationCard.tsx")),
    readPanelUiSource(path.join("components", "rich-text.tsx")),
    readPanelUiStyle("rich-text.css"),
    readPanelUiSource("styles.css"),
    readPanelUiSource(path.join("personal-workbench", "redesign", "styles", "index.css")),
  ]);

  assert.match(main, /import "\.\/personal-workbench\/redesign\/styles\/index\.css"/u);
  assert.match(personalWorkbench, /from "\.\/redesign\/app\/App"/u);
  assert.match(workbench, /<RedesignTranscript/u);
  assert.match(workbench, /projectChatActiveView/u);

  assert.match(transcript, /projectConversationDisplayList/u);
  assert.match(transcript, /useSyncExternalStore/u);
  assert.match(transcript, /transcriptToolResultsCacheForConversation/u);
  assert.match(transcript, /toolResultForActivity/u);
  assert.match(transcript, /from "\.\/ActivityEvidence"/u);
  assert.match(transcript, /from "\.\/ConfirmationCard"/u);
  assert.doesNotMatch(transcript, /components\/(?:chat-transcript|transcript-timeline|transcript-confirmation)/u);

  assert.match(evidence, /ActivityEvidencePanel/u);
  assert.match(evidence, /ToolCallResult/u);
  assert.match(evidence, /完整工具结果/u);
  assert.match(confirmation, /projectConfirmationDisplay/u);
  assert.match(confirmation, /approve_once/u);
  assert.match(confirmation, /"deny"/u);

  assert.match(styleEntry, /@import '\.\/activity-evidence\.css'/u);
  assert.doesNotMatch(styleEntry, /transcript\.css/u);
  assert.match(richText, /import "\.\.\/styles\/rich-text\.css"/u);
  assert.match(richTextStyle, /\.rich-list-unordered\s*\{[^}]*list-style-type:\s*disc/u);
  assert.match(richTextStyle, /\.rich-list-ordered\s*\{[^}]*list-style-type:\s*decimal/u);
  assert.match(richTextStyle, /\.rich-list \.task-list-item\s*\{[^}]*list-style-type:\s*none/u);
  assert.doesNotMatch(globalStyles, /@import "\.\/styles\/rich-text\.css"/u);

  await Promise.all([
    assertPanelUiSourceMissing(path.join("components", "chat-active.tsx")),
    assertPanelUiSourceMissing(path.join("components", "chat-transcript-display.tsx")),
    assertPanelUiSourceMissing(path.join("components", "chat-transcript-chain.tsx")),
    assertPanelUiSourceMissing(path.join("components", "transcript-timeline.tsx")),
    assertPanelUiSourceMissing(path.join("components", "transcript-confirmation.tsx")),
  ]);
});

test("conversation intelligence remains in neutral projections instead of Redesign components", async () => {
  const [conversationDisplay, timelineProjection, activityProjection] = await Promise.all([
    readAppSource(path.join("panel-conversation", "panel-conversation-display-list.ts")),
    readAppSource(path.join("panel-read-model", "assistant", "panel-agent-work-timeline-view.ts")),
    readAppSource(path.join("panel-read-model", "transcript", "panel-transcript-activity-copy.ts")),
  ]);

  assert.match(conversationDisplay, /export function projectConversationDisplayList/u);
  assert.match(conversationDisplay, /projectConversationWorkflowDisplay/u);
  assert.match(timelineProjection, /displayActivityItemsForNodes/u);
  assert.match(timelineProjection, /timelineConfirmationProjection/u);
  assert.match(activityProjection, /export function displayActivityItemsForNodes/u);
  assert.match(activityProjection, /readonly toolCallFactId\?: string/u);
  assert.doesNotMatch([conversationDisplay, timelineProjection, activityProjection].join("\n"), /React|className|--aa-/u);
});

async function assertPanelUiSourceMissing(relativePath: string): Promise<void> {
  const absolutePath = path.join(process.cwd(), "src", "app", "panel-ui", "src", relativePath);
  await assert.rejects(fs.access(absolutePath));
}
