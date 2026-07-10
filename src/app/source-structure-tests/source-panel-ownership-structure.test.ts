import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  fileExistsSync,
  isTestAssetSource,
  readSource,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

test("panel UI frontend support modules stay under panel-ui ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const panelUiRoot = path.join(appRoot, "panel-ui", "src");
  const panelUiTestRoot = path.join(appRoot, "panel-ui", "tests");
  const movedPanelUiSourceFiles = [
    "app-task-submit-flow.ts",
    "chat-active-projection.ts",
    "chat-active-view.ts",
    "confirmation-display-projection.ts",
    "context-window-usage.ts",
    "deep-sidebar-selection.ts",
    "deep-transcript.ts",
    "run-capability-state.ts",
    "streaming-text.ts",
    "transcript-window.ts",
  ];
  const movedPanelUiTestFiles = [
    "app-task-submit-flow.test.ts",
    "chat-active-projection.test.ts",
    "chat-active-view.test.ts",
    "confirmation-display-projection.test.ts",
    "context-window-usage.test.ts",
    "deep-sidebar-selection.test.ts",
    "deep-transcript.test.ts",
    "run-capability-state.test.ts",
    "streaming-text.test.ts",
    "transcript-window.test.ts",
  ];
  const legacyTopLevelPanelUiFiles = [
    "panel-ui-deep-sidebar-selection.test.ts",
    "panel-ui-deep-sidebar-selection.ts",
    "panel-ui-deep-transcript.test.ts",
    "panel-ui-deep-transcript.ts",
    "panel-ui-run-capability-state.test.ts",
    "panel-ui-run-capability-state.ts",
    "panel-ui-submit-flow.test.ts",
    "panel-ui-submit-flow.ts",
    "panel-ui-chat-active-projection.test.ts",
    "panel-ui-chat-active-projection.ts",
    "panel-ui-chat-active-view.test.ts",
    "panel-ui-chat-active-view.ts",
    "panel-ui-confirmation-projection.test.ts",
    "panel-ui-streaming.test.ts",
    "panel-ui-streaming.ts",
    "panel-ui-transcript-window.test.ts",
    "panel-ui-transcript-window.ts",
    "panel-context-window-usage.test.ts",
  ];

  for (const fileName of movedPanelUiSourceFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(panelUiRoot, fileName)),
      true,
      `${fileName} should live in panel-ui/src`
    );
  }
  for (const fileName of movedPanelUiTestFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(panelUiTestRoot, fileName)),
      true,
      `${fileName} should live in panel-ui/tests`
    );
  }
  for (const fileName of legacyTopLevelPanelUiFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
  }
});

test("panel server integration test assets stay under panel-server ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const integrationTestRoot = path.join(appRoot, "panel-server", "integration-tests");
  const movedIntegrationTestAssets = [
    "panel-server-basic-agent-api.test.ts",
    "panel-server-config-api.test.ts",
    "panel-server-conversation-api.test.ts",
    "panel-server-deep-routes.test.ts",
    "panel-server-desktop-agent-api.test.ts",
    "panel-server-desktop-agent-execution.test.ts",
    "panel-server-desktop-run-resources.test.ts",
    "panel-server-run-stream.test.ts",
    "panel-server-skill-service.test.ts",
    "panel-server-test-utils.ts",
    "panel-server.test.ts",
    "panel-server-underground-compat.test.ts",
  ];

  for (const fileName of movedIntegrationTestAssets) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(integrationTestRoot, fileName)),
      true,
      `${fileName} should live in panel-server/integration-tests`
    );
  }
});

test("panel server support modules stay under panel-server ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const panelServerRoot = path.join(appRoot, "panel-server");
  const panelServerFiles = [
    "panel-assets.ts",
    "panel-launch-args.test.ts",
    "panel-launch-args.ts",
    "run-jobs.test.ts",
    "run-jobs.ts",
    "panel-usage-statistics.test.ts",
    "panel-usage-statistics.ts",
  ];

  for (const fileName of panelServerFiles) {
    if (
      fileName !== "panel-assets.ts" &&
      fileName !== "panel-usage-statistics.ts" &&
      fileName !== "panel-launch-args.ts" &&
      fileName !== "run-jobs.ts"
    ) {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    }
    assert.equal(
      fileExistsSync(path.join(panelServerRoot, fileName)),
      true,
      `${fileName} should live in panel-server`
    );
  }
});

test("shared app test fixtures stay under testing ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const testingRoot = path.join(appRoot, "testing");
  const movedSharedTestFixtures = ["openai-test-fixtures.ts"];
  const violations: string[] = [];

  for (const fileName of movedSharedTestFixtures) {
    assert.equal(fileExistsSync(path.join(appRoot, `panel-${fileName}`)), false, `${fileName} should not live at src/app top level`);
    assert.equal(fileExistsSync(path.join(testingRoot, fileName)), true, `${fileName} should live in app/testing`);
  }

  for (const file of await collectSourceFiles(appRoot)) {
    if (file.startsWith(testingRoot) || isTestAssetSource(file)) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      if (target.startsWith(testingRoot)) {
        violations.push(`${relativePath(file)} -> ${relativePath(target)}`);
      }
    }
  }

  assert.deepEqual(violations, [], "production app source must not import shared test fixtures");
});

test("panel transcript read-model stays under panel-read-model ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const transcriptRoot = path.join(appRoot, "panel-read-model", "transcript");
  const legacyTopLevelTranscriptFiles = [
    "panel-ui-live-transcript.test.ts",
    "panel-ui-live-transcript.ts",
    "panel-ui-transcript-cache.test.ts",
    "panel-ui-transcript-cache.ts",
  ];
  const transcriptFacadeFiles = new Set([
    "ordinary-transcript-event-policy.ts",
    "readable-text-fragments.ts",
    "transcript-reasoning.ts",
  ]);
  const transcriptFiles = [
    "ordinary-transcript-event-policy.ts",
    "panel-live-transcript.test.ts",
    "panel-live-transcript.ts",
    "panel-transcript-activity-copy.test.ts",
    "panel-transcript-activity-copy.ts",
    "panel-transcript-cache.test.ts",
    "panel-transcript-cache.ts",
    "panel-transcript-confirmation-projection.test.ts",
    "panel-transcript-confirmation-projection.ts",
    "panel-transcript-materializer.test.ts",
    "panel-transcript-materializer.ts",
    "panel-transcript-model-calls.test.ts",
    "panel-transcript-model-calls.ts",
    "panel-transcript-node-identity.test.ts",
    "panel-transcript-node-identity.ts",
    "panel-transcript-node-projection.test.ts",
    "panel-transcript-node-projection.ts",
    "panel-transcript-nodes.ts",
    "panel-transcript-tool-format.ts",
    "panel-transcript-turn-projection.test.ts",
    "panel-transcript-turn-projection.ts",
    "readable-text-fragments.test.ts",
    "readable-text-fragments.ts",
    "transcript-reasoning.test.ts",
    "transcript-reasoning.ts",
  ];

  for (const fileName of transcriptFiles) {
    if (!transcriptFacadeFiles.has(fileName)) {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    }
    assert.equal(
      fileExistsSync(path.join(transcriptRoot, fileName)),
      true,
      `${fileName} should live in panel-read-model/transcript`
    );
  }
  for (const fileName of legacyTopLevelTranscriptFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
  }
});

test("panel shared read-model support modules stay under panel-read-model ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const readModelRoot = path.join(appRoot, "panel-read-model");
  const sharedReadModelFiles = [
    "panel-model-progress-copy.test.ts",
    "panel-model-progress-copy.ts",
  ];

  assert.equal(
    fileExistsSync(path.join(appRoot, "panel-basic-agent-run-view-contracts.ts")),
    true,
    "panel-basic-agent-run-view-contracts.ts should keep a top-level compatibility facade"
  );
  assert.equal(
    fileExistsSync(path.join(appRoot, "basic-agent-run-view-contracts.ts")),
    false,
    "basic-agent-run-view-contracts.ts should not live at src/app top level"
  );
  assert.equal(
    fileExistsSync(path.join(readModelRoot, "basic-agent-run-view-contracts.ts")),
    true,
    "basic-agent-run-view-contracts.ts should live in panel-read-model"
  );

  for (const fileName of sharedReadModelFiles) {
    if (!fileName.endsWith(".test.ts")) {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), true, `${fileName} should keep a top-level compatibility facade`);
    } else {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    }
    assert.equal(
      fileExistsSync(path.join(readModelRoot, fileName)),
      true,
      `${fileName} should live in panel-read-model`
    );
  }
});

test("panel canvas read-model stays under panel-read-model ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const canvasRoot = path.join(appRoot, "panel-read-model", "canvas");
  const canvasFiles = [
    "panel-canvas-common.ts",
    "panel-canvas-read-model.ts",
    "panel-desktop-agent-canvas.ts",
  ];

  for (const fileName of canvasFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(
      fileExistsSync(path.join(canvasRoot, fileName)),
      true,
      `${fileName} should live in panel-read-model/canvas`
    );
  }
});

test("panel assistant read-model stays under panel-read-model ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const assistantRoot = path.join(appRoot, "panel-read-model", "assistant");
  const assistantFacadeFiles = new Set([
    "panel-agent-work-timeline-view.ts",
  ]);
  const legacyTopLevelAssistantFiles = [
    "panel-ui-chat-workline.test.ts",
    "panel-ui-chat-workline.ts",
    "panel-ui-timeline-collapse.test.ts",
    "panel-ui-timeline-collapse.ts",
  ];
  const assistantFiles = [
    "panel-agent-work-timeline-view.test.ts",
    "panel-agent-work-timeline-view.ts",
    "panel-assistant-activity-identity.test.ts",
    "panel-assistant-activity-identity.ts",
    "panel-assistant-failure.test.ts",
    "panel-assistant-failure.ts",
    "panel-assistant-message-output.test.ts",
    "panel-assistant-message-output.ts",
    "panel-assistant-message-stability.test.ts",
    "panel-assistant-message-stability.ts",
    "panel-assistant-message-structure.test.ts",
    "panel-assistant-message-structure.ts",
    "panel-assistant-message-view.test.ts",
    "panel-assistant-message-view.ts",
    "panel-assistant-output.test.ts",
    "panel-assistant-output.ts",
    "panel-assistant-run-output.test.ts",
    "panel-assistant-run-output.ts",
    "panel-assistant-segment-identity.test.ts",
    "panel-assistant-segment-identity.ts",
    "panel-assistant-segment-policy.test.ts",
    "panel-assistant-segment-policy.ts",
    "panel-assistant-timeline-collapse.test.ts",
    "panel-assistant-timeline-collapse.ts",
    "panel-assistant-turn-display.test.ts",
    "panel-assistant-turn-display.ts",
    "panel-assistant-visible-text.test.ts",
    "panel-assistant-visible-text.ts",
    "panel-assistant-workflow-display.test.ts",
    "panel-assistant-workflow-display.ts",
    "panel-assistant-workline.test.ts",
    "panel-assistant-workline.ts",
  ];

  for (const fileName of assistantFiles) {
    if (!assistantFacadeFiles.has(fileName)) {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    }
    assert.equal(
      fileExistsSync(path.join(assistantRoot, fileName)),
      true,
      `${fileName} should live in panel-read-model/assistant`
    );
  }
  for (const fileName of legacyTopLevelAssistantFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
  }
});

test("panel run read-model stays under panel-read-model ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const runRoot = path.join(appRoot, "panel-read-model", "run");
  const readModelFacade = await readSource(path.join(appRoot, "panel-run-read-model.ts"));
  const legacyTopLevelRunFiles = [
    "panel-ui-live-run-buffer.test.ts",
    "panel-ui-live-run-buffer.ts",
    "panel-ui-run-projection.test.ts",
    "panel-ui-run-projection.ts",
  ];
  const runFacadeFiles = new Set([
    "panel-agent-run-tree-view.ts",
    "panel-runtime-summary.ts",
    "panel-stream-tool-projection.ts",
    "panel-work-note-contracts.ts",
    "panel-work-notes.ts",
  ]);
  const runReadModelFiles = [
    "index.ts",
    "panel-agent-run-tree-view.ts",
    "panel-run-live-buffer.test.ts",
    "panel-run-live-buffer.ts",
    "panel-model-failure-copy.test.ts",
    "panel-model-failure-copy.ts",
    "panel-run-observation-state.test.ts",
    "panel-run-observation-state.ts",
    "panel-run-projection.test.ts",
    "panel-run-projection.ts",
    "panel-run-read-model.test.ts",
    "panel-run-status.ts",
    "panel-run-steps.ts",
    "panel-run-stream-contracts.ts",
    "panel-run-stream-copy.test.ts",
    "panel-run-stream-copy.ts",
    "panel-run-stream-events.ts",
    "panel-runtime-summary.test.ts",
    "panel-runtime-summary.ts",
    "panel-stream-tool-projection.test.ts",
    "panel-stream-tool-projection.ts",
    "panel-run-tracking-contracts.ts",
    "panel-run-tracking.test.ts",
    "panel-run-tracking.ts",
    "panel-run-transcript-contracts.ts",
    "panel-run-transcript.ts",
    "panel-work-note-contracts.ts",
    "panel-work-notes.test.ts",
    "panel-work-notes.ts",
  ];

  assert.equal(readModelFacade.trim(), 'export * from "./panel-read-model/run/index.js";');
  for (const fileName of runReadModelFiles) {
    if (fileName !== "index.ts" && !runFacadeFiles.has(fileName)) {
      assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    }
    assert.equal(
      fileExistsSync(path.join(runRoot, fileName)),
      true,
      `${fileName} should live in panel-read-model/run`
    );
  }
  for (const fileName of legacyTopLevelRunFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
  }
});

test("panel conversation module stays under panel-conversation ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const conversationRoot = path.join(appRoot, "panel-conversation");
  const conversationFiles = [
    "panel-conversation-contracts.ts",
    "panel-conversation-display-list.test.ts",
    "panel-conversation-display-list.ts",
    "panel-conversation-projection.ts",
    "panel-conversation-refresh.test.ts",
    "panel-conversation-refresh.ts",
    "panel-conversation-response-model.ts",
    "panel-conversation-workflow-display.test.ts",
    "panel-conversation-workflow-display.ts",
    "panel-conversations.test.ts",
    "panel-conversations.ts",
  ];

  for (const fileName of conversationFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(conversationRoot, fileName)),
      true,
      `${fileName} should live in panel-conversation`
    );
  }
});

test("confirmation copy stays text projection-owned while display projection stays panel UI-owned", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [transcriptConfirmation, confirmationDisplayFacade, confirmationDisplayProjection] = await Promise.all([
    readSource(path.join(appRoot, "panel-ui", "src", "components", "transcript-confirmation.tsx")),
    readSource(path.join(appRoot, "panel-confirmation-display-projection.ts")),
    readSource(path.join(appRoot, "panel-ui", "src", "confirmation-display-projection.ts")),
  ]);

  assert.equal(fileExistsSync(path.join(appRoot, "confirmation-copy.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-confirmation-copy.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-confirmation-display-projection.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-ui", "src", "confirmation-display-projection.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-ui", "tests", "confirmation-display-projection.test.ts")), true);
  assert.equal(confirmationDisplayFacade.trim(), 'export * from "./panel-ui/src/confirmation-display-projection.js";');
  assert.equal(confirmationDisplayProjection.includes('from "../../text-projection/confirmation-copy.js"'), true);
  assert.equal(transcriptConfirmation.includes("../../../confirmation-copy"), false);
  assert.equal(transcriptConfirmation.includes("../../../panel-confirmation-display-projection"), false);
  assert.equal(transcriptConfirmation.includes("../confirmation-display-projection"), true);
  assert.equal(transcriptConfirmation.includes("panel-confirmation-copy"), false);
});

test("panel UI components do not keep unused projection re-export wrappers", () => {
  const componentsRoot = path.join(process.cwd(), "src", "app", "panel-ui", "src", "components");

  assert.equal(fileExistsSync(path.join(componentsRoot, "chat-active-projection.ts")), false);
  assert.equal(fileExistsSync(path.join(componentsRoot, "chat-visible-text.ts")), false);
  assert.equal(fileExistsSync(path.join(componentsRoot, "transcript-timeline-copy.ts")), false);
  assert.equal(fileExistsSync(path.join(componentsRoot, "transcript-tool-format.ts")), false);
  assert.equal(fileExistsSync(path.join(componentsRoot, "transcript-node-visibility.ts")), false);
});
