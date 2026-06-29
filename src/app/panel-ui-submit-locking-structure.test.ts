import assert from "node:assert/strict";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("ordinary submit only locks the UI during bootstrap", async () => {
  const [app, appTaskSubmission] = await Promise.all([
    readPanelUiSource("App.tsx"),
    readPanelUiSource("app-task-submission.ts"),
  ]);

  assert.equal(app.includes('disabled={isBootstrapping || app.busy}'), true);
  assert.equal(app.includes('disabled={isBootstrapping || app.busy || modelResponding}'), false);
  assert.equal(app.includes("} else if (app.busy || modelResponding) {\n        enqueueMessage(goal);"), true);

  assert.equal(appTaskSubmission.includes("busy: false,\n        conversation: response.conversation,"), true);
});
