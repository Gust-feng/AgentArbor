import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("settings commands remain outside the personal workbench view", async () => {
  const [app, runtime, settingsController, workbench, settingsDialog] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-workbench-runtime.ts"),
    readPanelUiSource("app-settings-controller.ts"),
    readPanelUiSource(path.join("personal-workbench", "workbench", "agentarbor-workbench.tsx")),
    readPanelUiSource(path.join("components", "workbench-settings-dialog.tsx")),
  ]);

  assert.match(app, /workbenchSettingsDialogPropsFrom\(\{/u);
  assert.match(app, /settingsDialogProps=\{settingsDialogProps\}/u);
  assert.match(runtime, /createAppSettingsController\(\{/u);
  assert.match(settingsController, /saveModelProviderConfig/u);
  assert.match(settingsController, /saveToolSettings/u);
  assert.match(workbench, /<WorkbenchSettingsDialog \{\.\.\.props\.settingsDialogProps\} \/>/u);
  assert.match(settingsDialog, /export function WorkbenchSettingsDialog/u);
  assert.doesNotMatch(workbench, /saveModelProviderConfig|saveToolSettings|\/api\/config\//u);
});
