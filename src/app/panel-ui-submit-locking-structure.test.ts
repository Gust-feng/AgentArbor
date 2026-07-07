import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("ordinary submit only locks the UI during bootstrap", async () => {
  const [app, appWorkbenchInputProps, chatEmpty, appTaskSubmission] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-workbench-input-props.ts"),
    readPanelUiSource(join("components", "chat-empty.tsx")),
    readPanelUiSource("app-task-submission.ts"),
  ]);

  assert.equal(app.includes("const isBootstrapping = isBootstrappingApp(app);"), true);
  assert.equal(appWorkbenchInputProps.includes("allowInputWhileBusy: true"), true);
  assert.equal(chatEmpty.includes("const canSend = props.value.trim().length > 0 && (!props.busy || props.allowInputWhileBusy === true);"), true);
  assert.equal(chatEmpty.includes("disabled={props.busy && props.allowInputWhileBusy !== true}"), true);
  assert.equal(chatEmpty.includes("disabled={!canSend}"), true);
  assert.equal(app.includes('disabled={isBootstrapping || app.busy || modelResponding}'), false);
  assert.equal(appWorkbenchInputProps.includes("} else if (options.busy || options.modelResponding) {\n        options.enqueueMessage(options.goal);"), true);

  assert.equal(appTaskSubmission.includes("busy: false,\n        conversation: response.conversation,"), true);
});
