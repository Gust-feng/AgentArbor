import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("streaming assistant answers keep streaming text without a visible cursor node", async () => {
  const [chatTranscriptChain, chatMessageStyles, richTextStyles] = await Promise.all([
    readPanelUiSource(path.join("components", "chat-transcript-chain.tsx")),
    readPanelUiStyle("chat-message.css"),
    readPanelUiStyle("rich-text.css"),
  ]);

  assert.equal(chatTranscriptChain.includes("LiveStreamBox"), true);
  assert.equal(chatTranscriptChain.includes('className="rich-text rich-text-streaming"'), true);
  assert.equal(chatTranscriptChain.includes("stabilizeStreamingMarkdown(displayed)"), true);
  assert.equal(chatTranscriptChain.includes('className="stream-cursor"'), false);
  assert.equal(chatMessageStyles.includes(".stream-cursor"), false);
  assert.equal(chatMessageStyles.includes("stream-cursor-blink"), false);
  assert.equal(richTextStyles.includes(".stream-cursor"), false);
  assert.equal(richTextStyles.includes("stream-cursor-blink"), false);
});
