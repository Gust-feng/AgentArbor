import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readPanelUiSource, readPanelUiStyle } from "./panel-structure-test-utils.js";

test("streaming assistant answers render through RichText without a visible cursor node", async () => {
  const [transcript, richText, richTextStyles] = await Promise.all([
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "RedesignTranscript.tsx")),
    readPanelUiSource(path.join("components", "rich-text.tsx")),
    readPanelUiStyle("rich-text.css"),
  ]);

  assert.match(transcript, /props\.live \? <StreamingRichText text=\{props\.text\} live \/>/u);
  assert.match(richText, /splitStreamingMarkdown\(text\)/u);
  assert.match(richText, /stabilizeStreamingMarkdown\(segments\.activeBlock\)/u);
  assert.doesNotMatch(transcript, /stream-cursor|data-entering/u);
  assert.doesNotMatch(richText, /stream-cursor|data-entering/u);
  assert.doesNotMatch(richTextStyles, /stream-cursor|stream-cursor-blink/u);
});
