import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileExistsSync, readSource } from "./source-structure-test-utils.js";

test("app top-level keeps moved implementation modules as compatibility facades", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const compatibilityFacades = new Map([
    ["config-center.ts", 'export * from "./config-center/index.js";'],
    ["safe-projection.ts", 'export * from "./tool-projection/safe-projection.js";'],
    ["command-text.ts", 'export * from "./tool-projection/command-text.js";'],
    ["safe-tool-preview.ts", 'export * from "./tool-projection/safe-tool-preview.js";'],
    ["tool-display-normalization.ts", 'export * from "./tool-projection/tool-display-normalization.js";'],
    ["tool-result-continuation.ts", 'export * from "./tool-projection/tool-result-continuation.js";'],
    ["ordinary-tool-copy.ts", 'export * from "./tool-projection/ordinary-tool-copy.js";'],
    ["confirmation-copy.ts", 'export * from "./text-projection/confirmation-copy.js";'],
    ["failure-copy.ts", 'export * from "./text-projection/failure-copy.js";'],
    ["visible-text-safety.ts", 'export * from "./text-projection/visible-text-safety.js";'],
    ["app-update-service.ts", 'export * from "./app-update/app-update-service.js";'],
    ["electron-app-update-service.ts", 'export * from "./app-update/electron-app-update-service.js";'],
    ["product-info.ts", 'export * from "./app-update/product-info.js";'],
    ["agent-definition-catalog.ts", 'export * from "./agent-definitions/agent-definition-catalog.js";'],
    ["agent-definition-ref.ts", 'export * from "./agent-definitions/agent-definition-ref.js";'],
    ["agent-definition-registry.ts", 'export * from "./agent-definitions/agent-definition-registry.js";'],
    ["agent-definition-runtime.ts", 'export * from "./agent-definitions/agent-definition-runtime.js";'],
    ["capability-center.ts", 'export * from "./capability/capability-center.js";'],
    ["capability-policy.ts", 'export * from "./capability/capability-policy.js";'],
    ["capability-tool-definitions.ts", 'export * from "./capability/capability-tool-definitions.js";'],
    ["intelligence-channel-factory.ts", 'export * from "./model-runtime/factory.js";'],
    ["model-capability-registry.ts", 'export * from "./model-runtime/model-capability-registry.js";'],
    ["model-context-window-fallback.ts", 'export * from "./model-runtime/model-context-window-fallback.js";'],
    ["model-failure-visible-copy.ts", 'export * from "./panel-read-model/run/panel-model-failure-copy.js";'],
    ["run-mode-policy.ts", 'export * from "./run-runtime-core/run-mode-policy.js";'],
    ["run-facts-policy.ts", 'export * from "./run-runtime-core/run-facts-policy.js";'],
    ["runtime.ts", 'export * from "./run-runtime-core/minimal-runtime.js";'],
    ["agent-run-tree-attachment.ts", 'export * from "./run-read-model/agent-run-tree-attachment.js";'],
    ["run-summary.ts", 'export * from "./run-read-model/run-summary.js";'],
    ["panel-run-summary.ts", 'export * from "./panel-read-model/run/panel-run-summary.js";'],
    ["real-ai-smoke-runner.ts", 'export * from "./smoke/real-ai-smoke-runner.js";'],
    ["cognitive-work-session.ts", 'export * from "./underground/cognitive-work-session/cognitive-work-session.js";'],
    [
      "cognitive-work-session-contracts.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-contracts.js";',
    ],
    [
      "cognitive-work-session-fabric.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-fabric.js";',
    ],
    [
      "cognitive-work-session-model-io.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-model-io.js";',
    ],
    [
      "cognitive-work-session-result.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-result.js";',
    ],
    [
      "cognitive-work-session-run-projection.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-run-projection.js";',
    ],
    [
      "cognitive-work-session-runtime.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-runtime.js";',
    ],
    [
      "cognitive-work-session-safe.ts",
      'export * from "./underground/cognitive-work-session/cognitive-work-session-safe.js";',
    ],
    ["clarification-flow.ts", 'export * from "./underground/clarification/clarification-flow.js";'],
    ["clarification-recovery.ts", 'export * from "./underground/clarification/clarification-recovery.js";'],
    ["minimal-direction.ts", 'export * from "./underground/minimal/minimal-direction.js";'],
    ["minimal-governance.ts", 'export * from "./underground/minimal/minimal-governance.js";'],
    ["minimal-growth-plan.ts", 'export * from "./underground/minimal/minimal-growth-plan.js";'],
    ["minimal-loop.ts", 'export * from "./underground/minimal/minimal-loop.js";'],
    ["minimal-underground.ts", 'export * from "./underground/minimal/minimal-underground.js";'],
    ["minimal-verification.ts", 'export * from "./underground/minimal/minimal-verification.js";'],
    ["underground-candidates.ts", 'export * from "./underground/primitives/underground-candidates.js";'],
    ["underground-convergence.ts", 'export * from "./underground/primitives/underground-convergence.js";'],
    ["underground-evidence.ts", 'export * from "./underground/primitives/underground-evidence.js";'],
    ["underground-agent-cluster-runtime.ts", 'export * from "./underground/compat/underground-agent-cluster-runtime.js";'],
    ["underground-demo-summary.ts", 'export * from "./underground/compat/underground-demo-summary.js";'],
    ["underground-direction-recovery.ts", 'export * from "./underground/compat/underground-direction-recovery.js";'],
    ["underground-direction-session.ts", 'export * from "./underground/compat/underground-direction-session.js";'],
    ["underground-events.ts", 'export * from "./underground/events.js";'],
    ["underground-goal-profile.ts", 'export * from "./underground/primitives/underground-goal-profile.js";'],
    ["underground-intelligence.ts", 'export * from "./underground/compat/underground-intelligence.js";'],
    ["underground-message-dispatcher.ts", 'export * from "./underground/compat/underground-message-dispatcher.js";'],
    ["underground-report.ts", 'export * from "./underground/primitives/underground-report.js";'],
    ["underground-rootlets.ts", 'export * from "./underground/primitives/underground-rootlets.js";'],
    ["underground-runner.ts", 'export * from "./underground/compat/underground-runner.js";'],
    ["run-read-model-envelope.ts", 'export * from "./run-read-model/envelope.js";'],
    ["run-read-model-summary.ts", 'export * from "./run-read-model/summary.js";'],
    ["restored-run-projection.ts", 'export * from "./run-read-model/restored-run-projection.js";'],
    ["sub-agent-stream-projection.ts", 'export * from "./run-read-model/sub-agent-stream-projection.js";'],
    ["desktop-agent-contracts.ts", 'export * from "./desktop-agent/desktop-agent-contracts.js";'],
    ["desktop-agent-prompts.ts", 'export * from "./desktop-agent/desktop-agent-prompts.js";'],
    ["desktop-chat-session.ts", 'export * from "./desktop-agent/desktop-chat-session.js";'],
    ["desktop-agent-session.ts", 'export * from "./desktop-agent/desktop-agent-session.js";'],
    ["desktop-agent-session-contracts.ts", 'export * from "./desktop-agent/desktop-agent-session-contracts.js";'],
    ["desktop-agent-session-projection.ts", 'export * from "./desktop-agent/desktop-agent-session-projection.js";'],
    ["desktop-agent-session-events.ts", 'export * from "./desktop-agent/desktop-agent-session-events.js";'],
    ["desktop-agent-session-runtime.ts", 'export * from "./desktop-agent/desktop-agent-session-runtime.js";'],
    ["desktop-agent-loop-preparation.ts", 'export * from "./desktop-agent/desktop-agent-loop-preparation.js";'],
    ["run-tool-boundary.ts", 'export * from "./capability/run-tool-boundary.js";'],
    ["tool-definition-contract.ts", 'export * from "./capability/tool-definition-contract.js";'],
    ["panel-read-model-utils.ts", 'export * from "./run-read-model/value-utils.js";'],
    ["task-soil-workspace.ts", 'export * from "./task-soil/task-soil-workspace.js";'],
    ["direction-handoff-derivation.ts", 'export * from "./underground/compat/direction-handoff-derivation.js";'],
    ["context-attachments.ts", 'export * from "./task-soil/context-attachments.js";'],
    ["desktop-agent-model-input-files.ts", 'export * from "./task-soil/desktop-agent-model-input-files.js";'],
    ["workspace-folder-summary.ts", 'export * from "./task-soil/workspace-folder-summary.js";'],
    ["panel-confirmation-display-projection.ts", 'export * from "./panel-ui/src/confirmation-display-projection.js";'],
    ["panel-agent-work-timeline-view.ts", 'export * from "./panel-read-model/assistant/panel-agent-work-timeline-view.js";'],
    ["panel-assets.ts", 'export * from "./panel-server/panel-assets.js";'],
    ["panel-stream-tool-projection.ts", 'export * from "./panel-read-model/run/panel-stream-tool-projection.js";'],
    ["panel-agent-run-tree-view.ts", 'export * from "./panel-read-model/run/panel-agent-run-tree-view.js";'],
    ["panel-work-note-contracts.ts", 'export * from "./panel-read-model/run/panel-work-note-contracts.js";'],
    ["panel-work-notes.ts", 'export * from "./panel-read-model/run/panel-work-notes.js";'],
    ["panel-runtime-summary.ts", 'export * from "./panel-read-model/run/panel-runtime-summary.js";'],
    ["panel-usage-statistics.ts", 'export * from "./panel-server/panel-usage-statistics.js";'],
    ["panel-run-jobs.ts", 'export * from "./panel-server/run-jobs.js";'],
    ["panel-args.ts", 'export * from "./panel-server/panel-launch-args.js";'],
    ["panel-basic-agent-run-view-contracts.ts", 'export * from "./panel-read-model/basic-agent-run-view-contracts.js";'],
    ["panel-context-window-usage.ts", 'export * from "./panel-ui/src/context-window-usage.js";'],
    ["panel-model-progress-copy.ts", 'export * from "./panel-read-model/panel-model-progress-copy.js";'],
    ["panel-canvas-read-model.ts", 'export * from "./panel-read-model/canvas/panel-canvas-read-model.js";'],
    ["panel-canvas-common.ts", 'export * from "./panel-read-model/canvas/panel-canvas-common.js";'],
    ["panel-desktop-agent-canvas.ts", 'export * from "./panel-read-model/canvas/panel-desktop-agent-canvas.js";'],
    [
      "ordinary-transcript-event-policy.ts",
      'export * from "./panel-read-model/transcript/ordinary-transcript-event-policy.js";',
    ],
    ["readable-text-fragments.ts", 'export * from "./panel-read-model/transcript/readable-text-fragments.js";'],
    ["transcript-reasoning.ts", 'export * from "./panel-read-model/transcript/transcript-reasoning.js";'],
  ]);

  for (const [fileName, expectedSource] of compatibilityFacades) {
    const facade = await readSource(path.join(appRoot, fileName));
    assert.equal(facade.trim(), expectedSource, `${fileName} should stay a re-export compatibility facade`);
  }
  assert.equal(fileExistsSync(path.join(appRoot, "config-center.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "safe-projection.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "tool-display-normalization.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "app-update-service.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "electron-app-update-service.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definition-catalog.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definition-registry.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definition-runtime.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "intelligence-channel-factory.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "model-capability-registry.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "model-context-window-fallback.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "run-mode-policy.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "run-facts-policy.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "real-ai-smoke.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "cognitive-work-session.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "clarification-flow.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "minimal-loop.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "task-soil-workspace.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "context-attachments.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "desktop-agent-model-input-files.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-ui-confirmation-projection.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-agent-work-timeline-view.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-stream-tool-projection.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-work-notes.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-runtime-summary.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-usage-statistics.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-context-window-usage.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-model-progress-copy.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "readable-text-fragments.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "transcript-reasoning.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "config-center", "config-center.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "tool-projection", "safe-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "tool-projection", "tool-display-normalization.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "app-update", "app-update-service.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "app-update", "electron-app-update-service.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definitions", "agent-definition-catalog.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definitions", "agent-definition-registry.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "agent-definitions", "agent-definition-runtime.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "model-runtime", "factory.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "model-runtime", "model-capability-registry.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "model-runtime", "model-context-window-fallback.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "run-runtime-core", "run-mode-policy.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "run-runtime-core", "run-facts-policy.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "smoke", "real-ai-smoke.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "smoke", "real-ai-smoke-runner.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "smoke", "real-ai-smoke.test.ts")), true);
  assert.equal(
    fileExistsSync(path.join(appRoot, "underground", "cognitive-work-session", "cognitive-work-session.test.ts")),
    true
  );
  assert.equal(fileExistsSync(path.join(appRoot, "underground", "clarification", "clarification-flow.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "underground", "minimal", "minimal-loop.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "task-soil", "task-soil-workspace.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "task-soil", "context-attachments.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "task-soil", "desktop-agent-model-input-files.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "run", "panel-stream-tool-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "run", "panel-work-notes.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "run", "panel-runtime-summary.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-server", "panel-usage-statistics.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-ui", "tests", "confirmation-display-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-ui", "tests", "context-window-usage.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "panel-model-progress-copy.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "transcript", "panel-transcript-confirmation-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "assistant", "panel-agent-work-timeline-view.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "transcript", "readable-text-fragments.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-read-model", "transcript", "transcript-reasoning.test.ts")), true);

  const smokeCliFacade = await readSource(path.join(appRoot, "real-ai-smoke.ts"));
  assert.equal(smokeCliFacade.trim(), 'import "./smoke/real-ai-smoke.js";');
});

test("app CLI entrypoints stay thin and delegate to owning modules", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [demoEntrypoint, panelEntrypoint, minimalRuntime, demoCli, panelCli] = await Promise.all([
    readSource(path.join(appRoot, "demo.ts")),
    readSource(path.join(appRoot, "panel.ts")),
    readSource(path.join(appRoot, "run-runtime-core", "minimal-runtime.ts")),
    readSource(path.join(appRoot, "underground", "minimal", "minimal-demo-cli.ts")),
    readSource(path.join(appRoot, "panel-server", "panel-cli.ts")),
  ]);

  assert.equal(
    demoEntrypoint.trim(),
    'import { runMinimalDemoCli } from "./underground/minimal/minimal-demo-cli.js";\n\nawait runMinimalDemoCli();'
  );
  assert.equal(
    panelEntrypoint.trim(),
    'import { runPanelCli } from "./panel-server/panel-cli.js";\n\nawait runPanelCli();'
  );
  assert.equal(minimalRuntime.includes("export function createMinimalRuntime"), true);
  assert.equal(demoCli.includes("export async function runMinimalDemoCli"), true);
  assert.equal(panelCli.includes("export async function runPanelCli"), true);
  assert.equal(demoEntrypoint.includes("runMinimalLoop"), false);
  assert.equal(demoEntrypoint.includes("console.log"), false);
  assert.equal(panelEntrypoint.includes("startLocalPanelServer"), false);
  assert.equal(panelEntrypoint.includes("process.on"), false);
});

test("shared read-model value helpers use neutral run-read-model ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [valueUtils, desktopSession, desktopProjection, subAgentStream, panelStreamEvents] = await Promise.all([
    readSource(path.join(appRoot, "run-read-model", "value-utils.ts")),
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-session.ts")),
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-session-projection.ts")),
    readSource(path.join(appRoot, "run-read-model", "sub-agent-stream-projection.ts")),
    readSource(path.join(appRoot, "panel-read-model", "run", "panel-run-stream-events.ts")),
  ]);

  assert.equal(valueUtils.includes("export function asRecord"), true);
  assert.equal(valueUtils.includes("export function stringOrUndefined"), true);
  assert.equal(valueUtils.includes("export function numberOrUndefined"), true);
  for (const source of [desktopSession, desktopProjection, panelStreamEvents]) {
    assert.equal(source.includes("panel-read-model-utils.js"), false);
    assert.equal(source.includes("run-read-model/value-utils.js"), true);
  }
  assert.equal(subAgentStream.includes("panel-read-model-utils.js"), false);
  assert.equal(subAgentStream.includes('from "./value-utils.js"'), true);
});

test("tool projection support modules stay under tool-projection ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const toolProjectionRoot = path.join(appRoot, "tool-projection");
  const movedToolProjectionFiles = [
    "command-text.ts",
    "ordinary-tool-copy.ts",
    "safe-tool-preview.ts",
    "tool-display-normalization.ts",
    "tool-result-continuation.ts",
  ];

  for (const fileName of movedToolProjectionFiles) {
    const facade = path.join(appRoot, fileName);
    assert.equal(fileExistsSync(facade), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(toolProjectionRoot, fileName)), true, `${fileName} should live in tool-projection`);
  }
});

test("text projection support modules stay under text-projection ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const textProjectionRoot = path.join(appRoot, "text-projection");
  const movedTextProjectionFiles = [
    "confirmation-copy.ts",
    "failure-copy.ts",
    "visible-text-safety.ts",
  ];
  const movedTextProjectionTests = [
    "confirmation-copy.test.ts",
    "visible-text-safety.test.ts",
  ];

  for (const fileName of movedTextProjectionFiles) {
    const facade = path.join(appRoot, fileName);
    assert.equal(fileExistsSync(facade), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(textProjectionRoot, fileName)), true, `${fileName} should live in text-projection`);
  }
  for (const fileName of movedTextProjectionTests) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(textProjectionRoot, fileName)),
      true,
      `${fileName} should live in text-projection`
    );
  }
});

test("app update support modules stay under app-update ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const appUpdateRoot = path.join(appRoot, "app-update");
  const movedAppUpdateFiles = [
    "app-update-service.ts",
    "electron-app-update-service.ts",
    "product-info.ts",
  ];

  for (const fileName of movedAppUpdateFiles) {
    const facade = path.join(appRoot, fileName);
    assert.equal(fileExistsSync(facade), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(appUpdateRoot, fileName)), true, `${fileName} should live in app-update`);
  }
});

test("capability boundary modules stay under capability ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const capabilityRoot = path.join(appRoot, "capability");
  const capabilityFiles = [
    "capability-center.ts",
    "capability-policy.ts",
    "capability-tool-definitions.ts",
    "run-tool-boundary.ts",
    "tool-definition-contract.ts",
  ];
  const ownerSources = await Promise.all([
    readSource(path.join(appRoot, "agent-definitions", "agent-definition-runtime.ts")),
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-loop-preparation.ts")),
    readSource(path.join(appRoot, "panel-server", "config-routes.ts")),
    readSource(path.join(appRoot, "panel-server", "deep-routes.ts")),
    readSource(path.join(appRoot, "panel-server", "mcp-management-service.ts")),
    readSource(path.join(appRoot, "panel-server", "runtime.ts")),
  ]);

  for (const fileName of capabilityFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(capabilityRoot, fileName)), true, `${fileName} should live in capability`);
  }

  const centerFacade = await readSource(path.join(appRoot, "capability-center.ts"));
  assert.equal(centerFacade.trim(), 'export * from "./capability/capability-center.js";');
  const policyFacade = await readSource(path.join(appRoot, "capability-policy.ts"));
  assert.equal(policyFacade.trim(), 'export * from "./capability/capability-policy.js";');
  const toolDefinitionsFacade = await readSource(path.join(appRoot, "capability-tool-definitions.ts"));
  assert.equal(toolDefinitionsFacade.trim(), 'export * from "./capability/capability-tool-definitions.js";');
  const toolBoundaryFacade = await readSource(path.join(appRoot, "run-tool-boundary.ts"));
  assert.equal(toolBoundaryFacade.trim(), 'export * from "./capability/run-tool-boundary.js";');
  const toolDefinitionContractFacade = await readSource(path.join(appRoot, "tool-definition-contract.ts"));
  assert.equal(toolDefinitionContractFacade.trim(), 'export * from "./capability/tool-definition-contract.js";');
  assert.equal(fileExistsSync(path.join(appRoot, "capability-center.test.ts")), false);
  assert.equal(fileExistsSync(path.join(capabilityRoot, "capability-center.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "capability-policy.test.ts")), false);
  assert.equal(fileExistsSync(path.join(capabilityRoot, "capability-policy.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "run-tool-boundary.test.ts")), false);
  assert.equal(fileExistsSync(path.join(capabilityRoot, "run-tool-boundary.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "tool-capability-acceptance.test.ts")), false);
  assert.equal(fileExistsSync(path.join(capabilityRoot, "tool-capability-acceptance.test.ts")), true);

  for (const source of ownerSources) {
    assert.equal(source.includes("capability/"), true);
    assert.equal(source.includes('from "../capability-center.js"'), false);
    assert.equal(source.includes('from "../capability-policy.js"'), false);
    assert.equal(source.includes('from "../run-tool-boundary.js"'), false);
    assert.equal(source.includes('from "../tool-definition-contract.js"'), false);
  }
});

test("AgentDefinition support modules stay under agent-definitions ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const agentDefinitionRoot = path.join(appRoot, "agent-definitions");
  const movedAgentDefinitionFiles = [
    "agent-definition-catalog.ts",
    "agent-definition-ref.ts",
    "agent-definition-registry.ts",
    "agent-definition-runtime.ts",
  ];

  for (const fileName of movedAgentDefinitionFiles) {
    const facade = path.join(appRoot, fileName);
    assert.equal(fileExistsSync(facade), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(
      fileExistsSync(path.join(agentDefinitionRoot, fileName)),
      true,
      `${fileName} should live in agent-definitions`
    );
  }
});

test("Task Soil support modules stay under task-soil ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const taskSoilRoot = path.join(appRoot, "task-soil");
  const movedTaskSoilFiles = [
    "task-soil-workspace.ts",
    "context-attachments.ts",
    "desktop-agent-model-input-files.ts",
    "workspace-folder-summary.ts",
  ];

  for (const fileName of movedTaskSoilFiles) {
    const facade = path.join(appRoot, fileName);
    assert.equal(fileExistsSync(facade), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(taskSoilRoot, fileName)), true, `${fileName} should live in task-soil`);
  }
});

test("panel structure tests stay in the panel structure test module", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const structureTestRoot = path.join(appRoot, "panel-structure-tests");
  const movedStructureTests = [
    "panel-runtime-structure.test.ts",
    "panel-server-structure.test.ts",
    "panel-structure.test.ts",
    "panel-ui-app-structure.test.ts",
    "panel-ui-chat-structure.test.ts",
    "panel-ui-contract-structure.test.ts",
    "panel-ui-deep-follow-up-structure.test.ts",
    "panel-ui-deep-history-structure.test.ts",
    "panel-ui-deep-sidebar-structure.test.ts",
    "panel-ui-model-options-structure.test.ts",
    "panel-ui-model-provider-projection.test.ts",
    "panel-ui-multi-agent-node-structure.test.ts",
    "panel-ui-runtime-structure.test.ts",
    "panel-ui-settings-structure.test.ts",
    "panel-ui-startup-intro-structure.test.ts",
    "panel-ui-structure.test.ts",
    "panel-ui-streaming-cursor.test.ts",
    "panel-ui-submit-locking-structure.test.ts",
  ];

  assert.equal(fileExistsSync(path.join(appRoot, "panel-structure-test-utils.ts")), false);
  assert.equal(fileExistsSync(path.join(structureTestRoot, "panel-structure-test-utils.ts")), true);
  for (const fileName of movedStructureTests) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(fileExistsSync(path.join(structureTestRoot, fileName)), true, `${fileName} should live in panel-structure-tests`);
  }
});

test("source structure tests stay in the source structure test module", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const sourceStructureTestRoot = path.join(appRoot, "source-structure-tests");
  const sourceStructureFiles = [
    "source-app-ownership-structure.test.ts",
    "source-dependency-structure.test.ts",
    "source-panel-ownership-structure.test.ts",
    "source-runtime-contract-structure.test.ts",
    "source-structure-test-utils.ts",
    "trellis-gitignore.test.ts",
  ];

  for (const fileName of sourceStructureFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(sourceStructureTestRoot, fileName)),
      true,
      `${fileName} should live in source-structure-tests`
    );
  }
});

test("runtime boundary tests stay in the runtime boundary test module", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const runtimeBoundaryTestRoot = path.join(appRoot, "runtime-boundary-tests");
  const runtimeBoundaryTestFiles = ["runtime-boundaries.test.ts"];

  for (const fileName of runtimeBoundaryTestFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(runtimeBoundaryTestRoot, fileName)),
      true,
      `${fileName} should live in runtime-boundary-tests`
    );
  }
});

test("desktop shell support modules stay under desktop ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const desktopRoot = path.join(appRoot, "desktop");
  const panelDesktopEntry = await fs.readFile(path.join(appRoot, "panel-desktop.ts"), "utf8");
  const desktopFiles = [
    "panel-desktop-launcher.test.ts",
    "panel-desktop-launcher.ts",
    "panel-desktop-local-preferences.test.ts",
    "panel-desktop-local-preferences.ts",
    "panel-desktop-main.ts",
    "panel-desktop-preload.cts",
    "panel-desktop-window-controls.test.ts",
    "panel-desktop-window-controls.ts",
    "panel-startup-intro-geometry.test.ts",
    "panel-startup-intro-geometry.ts",
    "panel-startup-theme.test.ts",
    "panel-startup-theme.ts",
  ];

  assert.equal(panelDesktopEntry.trim(), 'import "./desktop/panel-desktop-main.js";');
  for (const fileName of desktopFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(desktopRoot, fileName)),
      true,
      `${fileName} should live in desktop`
    );
  }
});

test("desktop agent support modules stay under desktop-agent ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const desktopAgentRoot = path.join(appRoot, "desktop-agent");
  const desktopAgentFiles = [
    "desktop-agent-contracts.ts",
    "desktop-agent-prompts.ts",
    "desktop-chat-session.ts",
    "desktop-agent-session.ts",
    "desktop-agent-session-contracts.ts",
    "desktop-agent-session-projection.ts",
    "desktop-agent-session-events.ts",
    "desktop-agent-session-runtime.ts",
    "desktop-agent-loop-preparation.ts",
  ];
  const sessionOwnerSource = await readSource(path.join(appRoot, "desktop-agent", "desktop-agent-session.ts"));
  const externalOwnerConsumers = await Promise.all([
    readSource(path.join(appRoot, "basic-agent-runtime", "context-pack.ts")),
    readSource(path.join(appRoot, "basic-agent-runtime", "context-pack.test.ts")),
    readSource(path.join(appRoot, "basic-agent-runtime", "context-ledger.ts")),
    readSource(path.join(appRoot, "basic-agent-runtime", "context-ledger-items.ts")),
    readSource(path.join(appRoot, "basic-agent-runtime", "builtin-tool-runtime.ts")),
    readSource(path.join(appRoot, "panel-read-model", "canvas", "panel-desktop-agent-canvas.ts")),
    readSource(path.join(appRoot, "panel-server", "conversation-history.ts")),
    readSource(path.join(appRoot, "panel-server", "desktop-run-resources.ts")),
    readSource(path.join(appRoot, "panel-server", "desktop-agent-execution.ts")),
    readSource(path.join(appRoot, "panel-server", "run-execution-contracts.ts")),
    readSource(path.join(appRoot, "panel-server", "skill-service.ts")),
    readSource(path.join(appRoot, "capability", "run-tool-boundary.ts")),
  ]);

  for (const fileName of desktopAgentFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), true, `${fileName} should keep a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(desktopAgentRoot, fileName)), true, `${fileName} should live in desktop-agent`);
  }

  const contractsFacade = await readSource(path.join(appRoot, "desktop-agent-contracts.ts"));
  assert.equal(contractsFacade.trim(), 'export * from "./desktop-agent/desktop-agent-contracts.js";');
  const promptsFacade = await readSource(path.join(appRoot, "desktop-agent-prompts.ts"));
  assert.equal(promptsFacade.trim(), 'export * from "./desktop-agent/desktop-agent-prompts.js";');
  const chatFacade = await readSource(path.join(appRoot, "desktop-chat-session.ts"));
  assert.equal(chatFacade.trim(), 'export * from "./desktop-agent/desktop-chat-session.js";');
  const sessionFacade = await readSource(path.join(appRoot, "desktop-agent-session.ts"));
  assert.equal(sessionFacade.trim(), 'export * from "./desktop-agent/desktop-agent-session.js";');
  const sessionContractsFacade = await readSource(path.join(appRoot, "desktop-agent-session-contracts.ts"));
  assert.equal(sessionContractsFacade.trim(), 'export * from "./desktop-agent/desktop-agent-session-contracts.js";');
  const sessionProjectionFacade = await readSource(path.join(appRoot, "desktop-agent-session-projection.ts"));
  assert.equal(sessionProjectionFacade.trim(), 'export * from "./desktop-agent/desktop-agent-session-projection.js";');
  const sessionEventsFacade = await readSource(path.join(appRoot, "desktop-agent-session-events.ts"));
  assert.equal(sessionEventsFacade.trim(), 'export * from "./desktop-agent/desktop-agent-session-events.js";');
  const sessionRuntimeFacade = await readSource(path.join(appRoot, "desktop-agent-session-runtime.ts"));
  assert.equal(sessionRuntimeFacade.trim(), 'export * from "./desktop-agent/desktop-agent-session-runtime.js";');
  const loopPreparationFacade = await readSource(path.join(appRoot, "desktop-agent-loop-preparation.ts"));
  assert.equal(loopPreparationFacade.trim(), 'export * from "./desktop-agent/desktop-agent-loop-preparation.js";');
  assert.equal(fileExistsSync(path.join(appRoot, "desktop-agent-session.test.ts")), false);
  assert.equal(fileExistsSync(path.join(desktopAgentRoot, "desktop-agent-session.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "desktop-agent-session-projection.test.ts")), false);
  assert.equal(fileExistsSync(path.join(desktopAgentRoot, "desktop-agent-session-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "desktop-agent-loop-preparation.test.ts")), false);
  assert.equal(fileExistsSync(path.join(desktopAgentRoot, "desktop-agent-loop-preparation.test.ts")), true);

  assert.equal(sessionOwnerSource.includes('from "./desktop-agent-session-contracts.js"'), true);
  assert.equal(sessionOwnerSource.includes('from "./desktop-agent-session-projection.js"'), true);
  assert.equal(sessionOwnerSource.includes('from "./desktop-agent-session-events.js"'), true);
  assert.equal(sessionOwnerSource.includes('from "../desktop-agent-session.js"'), false);
  assert.equal(sessionOwnerSource.includes('from "../desktop-agent-session-contracts.js"'), false);
  assert.equal(sessionOwnerSource.includes('from "../desktop-agent-session-projection.js"'), false);
  assert.equal(sessionOwnerSource.includes('from "../desktop-agent-session-events.js"'), false);

  for (const source of externalOwnerConsumers) {
    assert.equal(source.includes("desktop-agent/desktop-agent-"), true);
    assert.equal(source.includes('from "./desktop-agent-contracts.js"'), false);
    assert.equal(source.includes('from "./desktop-agent-prompts.js"'), false);
    assert.equal(source.includes('from "../desktop-agent-contracts.js"'), false);
    assert.equal(source.includes('from "../desktop-agent-prompts.js"'), false);
    assert.equal(source.includes('from "./desktop-agent-session-contracts.js"'), false);
    assert.equal(source.includes('from "./desktop-agent-session-projection.js"'), false);
    assert.equal(source.includes('from "./desktop-agent-session-events.js"'), false);
    assert.equal(source.includes('from "../desktop-agent-session-contracts.js"'), false);
    assert.equal(source.includes('from "../desktop-agent-session-projection.js"'), false);
    assert.equal(source.includes('from "../desktop-agent-session-events.js"'), false);
  }
});
