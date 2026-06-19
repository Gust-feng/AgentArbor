import assert from "node:assert/strict";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

const BUTTON_TITLE_ATTRIBUTE = /<button\b[^>]*\btitle=/s;

test("panel UI buttons do not use native title tooltips", async () => {
  const sources = await Promise.all([
    readPanelUiSource("components/chat-empty.tsx"),
    readPanelUiSource("components/sidebar.tsx"),
    readPanelUiSource("components/model-provider-form.tsx"),
    readPanelUiSource("components/model-provider-list.tsx"),
    readPanelUiSource("components/capability-settings.tsx"),
    readPanelUiSource("components/theme-switcher.tsx"),
  ]);

  for (const source of sources) {
    assert.equal(BUTTON_TITLE_ATTRIBUTE.test(source), false);
  }
});
