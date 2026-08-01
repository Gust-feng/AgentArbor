import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("Panel App composes the current Personal Workbench from Ordinary runtime state", async () => {
  const [app, personalWorkbench, redesignEntry, workbenchRuntime] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource(path.join("personal-workbench", "personal-workbench.tsx")),
    readPanelUiSource(path.join("personal-workbench", "redesign", "app", "App.tsx")),
    readPanelUiSource("app-workbench-runtime.ts"),
  ]);

  assert.match(app, /from "\.\/personal-workbench\/personal-workbench"/u);
  assert.match(app, /useAppWorkbenchRuntime\(\{/u);
  assert.match(app, /<PersonalWorkbench/u);
  assert.match(app, /conversation=\{app\.conversation\}/u);
  assert.match(app, /currentRun=\{currentRun\}/u);
  assert.match(app, /pendingConfirmation=\{pendingConfirmation\}/u);
  assert.match(app, /settingsDialogProps=\{settingsDialogProps\}/u);
  assert.match(personalWorkbench, /from "\.\/redesign\/app\/App"/u);
  assert.match(redesignEntry, /from "\.\.\/agentarbor-workbench"/u);
  assert.match(workbenchRuntime, /export function useAppWorkbenchRuntime/u);
});

test("the production workbench keeps Multi-Agent deferred", async () => {
  const [app, workbench] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource(path.join("personal-workbench", "redesign", "agentarbor-workbench.tsx")),
  ]);

  assert.match(app, /const agentClusterActive = false;/u);
  assert.doesNotMatch(app, /<DeepView|<MultiAgentWorkspace/u);
  assert.doesNotMatch(workbench, /DeepView|MultiAgentWorkspace|\/api\/deep\//u);
});
