import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("the personal workbench owns the active shell layout", async () => {
  const [workbench, router, sidebar, topBar, spaceManager, renameField, sidebarRows] = await Promise.all([
    readPanelUiSource(path.join("personal-workbench", "workbench", "agentarbor-workbench.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "WorkbenchViewRouter.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "Sidebar.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "TopBar.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "SpaceManagerDialog.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "SidebarInlineRenameField.tsx")),
    readPanelUiSource(path.join("personal-workbench", "workbench", "app", "components", "SidebarRows.tsx")),
  ]);

  assert.match(workbench, /<Sidebar/u);
  assert.match(workbench, /<TopBar/u);
  assert.match(workbench, /<WorkbenchViewRouter/u);
  assert.match(router, /<HomePage/u);
  assert.match(router, /<SpacePage/u);
  assert.match(router, /<BrainPage/u);
  assert.match(router, /<ConversationSurface/u);
  assert.match(sidebar, /export function Sidebar/u);
  assert.match(sidebar, /from '\.\/SpaceManagerDialog'/u);
  assert.match(topBar, /<DesktopWindowControls/u);
  assert.match(topBar, /onToggleSidebar/u);
  assert.match(spaceManager, /export function SpaceManagerDialog/u);
  assert.match(renameField, /export function SidebarInlineRenameField/u);
  assert.match(sidebarRows, /export function SidebarNavRow/u);
  assert.match(sidebarRows, /export function SidebarListRow/u);
  assert.match(sidebarRows, /export function SidebarConversationScrollArea/u);
  assert.match(sidebarRows, /from '\.\/SidebarInlineRenameField'/u);
  assert.doesNotMatch(sidebar, /function SpaceManagerDialog/u);
  assert.doesNotMatch(sidebar, /function (NavRow|ListRow|RowMenu|SectionLabel|ConversationScrollArea)/u);
  assert.doesNotMatch(workbench, /components\/workbench-shell|components\/workbench-main/u);
});
