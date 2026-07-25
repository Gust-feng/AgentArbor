import assert from "node:assert/strict";
import test from "node:test";
import { readPanelUiStyle } from "./panel-structure-test-utils.js";

test("startup visual overlay stays noninteractive and title handoff restores workbench input", async () => {
  const style = await readPanelUiStyle("startup-intro.css");

  assert.match(cssRule(style, ".startup-intro-overlay {\n  position: fixed;"), /pointer-events:\s*none;/);
  assert.match(
    cssRule(style, '.app-root[data-startup-intro="title-handoff"] > .app-sidebar,'),
    /pointer-events:\s*auto;/,
  );
  assert.match(
    cssRule(style, '.app-root[data-startup-intro="title-handoff"] > .app-workbench'),
    /pointer-events:\s*auto;/,
  );
});

function cssRule(source: string, selectorStart: string): string {
  const start = source.indexOf(selectorStart);
  assert.notEqual(start, -1, `missing CSS selector: ${selectorStart}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS selector: ${selectorStart}`);
  return source.slice(start, end + 1);
}
