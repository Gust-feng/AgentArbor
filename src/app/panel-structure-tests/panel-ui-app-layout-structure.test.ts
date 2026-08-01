import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("the Redesign workbench owns the active shell layout", async () => {
  const [workbench, sidebar, topBar] = await Promise.all([
    readPanelUiSource(path.join("personal-workbench", "redesign", "agentarbor-workbench.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "Sidebar.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "components", "TopBar.tsx")),
  ]);

  assert.match(workbench, /<Sidebar/u);
  assert.match(workbench, /<TopBar/u);
  assert.match(workbench, /<HomePage/u);
  assert.match(workbench, /<SpacePage/u);
  assert.match(workbench, /<BrainPage/u);
  assert.match(workbench, /<ConversationPage/u);
  assert.match(sidebar, /export function Sidebar/u);
  assert.match(topBar, /<DesktopWindowControls/u);
  assert.match(topBar, /onToggleSidebar/u);
  assert.doesNotMatch(workbench, /components\/workbench-shell|components\/workbench-main/u);
});
