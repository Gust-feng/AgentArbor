import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

type SourceGraph = ReadonlyMap<string, readonly string[]>;

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

test("app and domain source dependencies do not form local cycles", async () => {
  for (const area of ["src/app", "src/domain"]) {
    const graph = await buildSourceGraph(area);
    const cycles = findDependencyCycles(graph, 10);

    assert.deepEqual(cycles, [], `${area} should not contain local import cycles`);
  }
});

test("domain internals avoid sibling barrel imports", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "domain"));
  const violations: string[] = [];

  for (const file of files) {
    if (path.basename(file) === "index.ts") {
      continue;
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (isSiblingBarrelImport(specifier)) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain implementation files should import sibling contracts directly");
});

test("domain and kernel do not depend on app or adapters", async () => {
  const root = process.cwd();
  const files = [
    ...(await collectSourceFiles(path.join(root, "src", "domain"))),
    ...(await collectSourceFiles(path.join(root, "src", "kernel"))),
  ];
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath.startsWith("src/app/") || targetPath.startsWith("src/adapters/")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "domain/kernel layers must not import app or adapters");
});

test("Basic Agent runtime does not depend on panel-private modules", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "app", "basic-agent-runtime"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      const name = path.basename(targetPath);
      if (name.startsWith("panel-")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "Basic Agent runtime should consume app-level contracts, not panel-private helpers");
});

test("Basic Agent runtime does not depend on underground domain contracts", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "app", "basic-agent-runtime"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath.startsWith("src/domain/underground/")) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(violations, [], "Basic Agent runtime should keep deep/underground structures behind app-level attachments");
});

test("ordinary Agent paths do not import top-level domain barrels", async () => {
  const files = await collectOrdinaryAgentSourceFiles();
  const forbiddenTargets = new Set([
    relativePath(path.join(process.cwd(), "src", "domain", "contracts.ts")),
    relativePath(path.join(process.cwd(), "src", "domain", "index.ts")),
  ]);
  const violations: string[] = [];

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (forbiddenTargets.has(targetPath)) {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "ordinary Agent paths should import narrow domain contracts instead of src/domain top-level barrels"
  );
});

test("Basic Agent run executor consumes prepared start facts instead of route infrastructure", async () => {
  const runtimeRoot = path.join(process.cwd(), "src", "app", "basic-agent-runtime");
  const [executorSource, contractsSource] = await Promise.all([
    readSource(path.join(runtimeRoot, "run-executor.ts")),
    readSource(path.join(runtimeRoot, "contracts.ts")),
  ]);

  assert.equal(contractsSource.includes("readonly prepareRunStart"), true);
  const executionResultSource = contractsSource.slice(
    contractsSource.indexOf("export type BasicAgentRunExecutionResult"),
    contractsSource.indexOf("export type BasicAgentPendingToolContinuation")
  );
  const startFactsSource = contractsSource.slice(
    contractsSource.indexOf("export type BasicAgentRunStartFacts"),
    contractsSource.indexOf("export type BasicAgentRunStartInput")
  );
  assert.equal(
    executionResultSource.includes("agentDefinitionRef"),
    false,
    "execution results must not be able to override the AgentDefinition ref frozen at run birth"
  );
  assert.equal(startFactsSource.includes("readonly agentDefinitionRef?: RunAgentDefinitionRef"), true);
  assert.equal(executorSource.includes("resolveBasicAgentRunMode(input.runKind, input.runMode)"), true);
  assert.equal(executorSource.includes("this.config.prepareRunStart(startInput)"), true);
  for (const routeInfrastructureDetail of [
    "getModelProviderConfig",
    "getInformationAccessConfig",
    "getCapabilitySnapshot",
    "getDefaultAgentDefinitionRef",
    "capabilityCenter",
    "configCenter",
    'input.runKind === "desktop"',
    'input.runKind !== "desktop"',
    'input.runMode === "agent"',
    'input.runMode !== "agent"',
    "runAgentDefinitionRef",
  ]) {
    assert.equal(
      executorSource.includes(routeInfrastructureDetail),
      false,
      `run executor should not own start preparation detail: ${routeInfrastructureDetail}`
    );
  }
});

test("run mode policy depends on AgentDefinition refs without importing runtime capability wiring", async () => {
  const source = await readSource(path.join(process.cwd(), "src", "app", "run-mode-policy.ts"));

  assert.equal(source.includes("./agent-definition-ref.js"), true);
  assert.equal(source.includes("./agent-definition-runtime.js"), false);
  assert.equal(source.includes("resolveRunCapabilities"), false);
  assert.equal(source.includes("createAgentTurnPolicyFromDefinition"), false);
});

test("AgentDefinition runtime does not own executable tool boundary pruning", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [definitionRuntime, runToolBoundary, loopPreparation] = await Promise.all([
    readSource(path.join(appRoot, "agent-definitions", "agent-definition-runtime.ts")),
    readSource(path.join(appRoot, "run-tool-boundary.ts")),
    readSource(path.join(appRoot, "desktop-agent-loop-preparation.ts")),
  ]);

  assert.equal(definitionRuntime.includes("ToolExecutionBroker"), false);
  assert.equal(definitionRuntime.includes("restrictRunCapabilityResolutionToExecutableTools"), false);
  assert.equal(runToolBoundary.includes("ToolExecutionBroker"), true);
  assert.equal(runToolBoundary.includes("resolveRunToolBoundary"), true);
  assert.equal(runToolBoundary.includes("restrictRunCapabilityResolutionToExecutableTools"), true);
  assert.equal(loopPreparation.includes('from "./run-tool-boundary.js"'), true);
  assert.equal(loopPreparation.includes("resolveRunToolBoundary({"), true);
});

test("panel server implementation does not import the default desktop root agent directly", async () => {
  const files = await collectSourceFiles(path.join(process.cwd(), "src", "app", "panel-server"));
  const violations: string[] = [];

  for (const file of files) {
    if (file.endsWith(".test.ts")) {
      continue;
    }
    const source = await fs.readFile(file, "utf8");
    for (const target of resolveRelativeImports(file, source)) {
      const targetPath = relativePath(target);
      if (targetPath === "src/app/agent-prompts/desktop-root-agent.ts") {
        violations.push(`${relativePath(file)} -> ${targetPath}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "panel-server should resolve ordinary Agent definitions through the runtime catalog/registry, not direct prompt assets"
  );
});

test("default Desktop Agent definition stays as separate prompt and policy assets", async () => {
  const promptRoot = path.join(process.cwd(), "src", "app", "agent-prompts");
  const [definition, prompt, turnPolicy, outputContract, toolVisibility] = await Promise.all([
    readSource(path.join(promptRoot, "desktop-root-agent.ts")),
    readSource(path.join(promptRoot, "desktop-root-agent-prompt.ts")),
    readSource(path.join(promptRoot, "desktop-root-agent-turn-policy.ts")),
    readSource(path.join(promptRoot, "desktop-root-agent-output-contract.ts")),
    readSource(path.join(promptRoot, "desktop-root-agent-tool-visibility.ts")),
  ]);

  assert.equal(definition.includes('from "./desktop-root-agent-prompt.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-turn-policy.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-output-contract.js"'), true);
  assert.equal(definition.includes('from "./desktop-root-agent-tool-visibility.js"'), true);
  assert.equal(definition.includes("systemPrompt:"), false);
  assert.equal(definition.includes("allowModel:"), false);
  assert.equal(definition.includes("outputKind:"), false);
  assert.equal(definition.includes("visibleToolScopes:"), false);
  assert.equal(prompt.includes("export const DESKTOP_ROOT_AGENT_PROMPT"), true);
  assert.equal(prompt.includes("systemPrompt:"), true);
  assert.equal(turnPolicy.includes("export const DESKTOP_ROOT_AGENT_TURN_POLICY"), true);
  assert.equal(outputContract.includes("export const DESKTOP_ROOT_AGENT_OUTPUT_CONTRACT"), true);
  assert.equal(toolVisibility.includes("export const DESKTOP_ROOT_AGENT_TOOL_VISIBILITY"), true);
});

test("Basic Agent run projection does not keep stale panel projection files", () => {
  const runtimeRoot = path.join(process.cwd(), "src", "app", "basic-agent-runtime");

  assert.equal(fileExistsSync(path.join(runtimeRoot, "run-projection.ts")), true);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "run-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "panel-projection.ts")), false);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "panel-projection.test.ts")), false);
});

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
    ["app-update-service.ts", 'export * from "./app-update/app-update-service.js";'],
    ["electron-app-update-service.ts", 'export * from "./app-update/electron-app-update-service.js";'],
    ["product-info.ts", 'export * from "./app-update/product-info.js";'],
    ["agent-definition-catalog.ts", 'export * from "./agent-definitions/agent-definition-catalog.js";'],
    ["agent-definition-ref.ts", 'export * from "./agent-definitions/agent-definition-ref.js";'],
    ["agent-definition-registry.ts", 'export * from "./agent-definitions/agent-definition-registry.js";'],
    ["agent-definition-runtime.ts", 'export * from "./agent-definitions/agent-definition-runtime.js";'],
    ["model-capability-registry.ts", 'export * from "./model-runtime/model-capability-registry.js";'],
    ["model-context-window-fallback.ts", 'export * from "./model-runtime/model-context-window-fallback.js";'],
    ["run-read-model-envelope.ts", 'export * from "./run-read-model/envelope.js";'],
    ["run-read-model-summary.ts", 'export * from "./run-read-model/summary.js";'],
    ["task-soil-workspace.ts", 'export * from "./task-soil/task-soil-workspace.js";'],
    ["context-attachments.ts", 'export * from "./task-soil/context-attachments.js";'],
    ["desktop-agent-model-input-files.ts", 'export * from "./task-soil/desktop-agent-model-input-files.js";'],
    ["workspace-folder-summary.ts", 'export * from "./task-soil/workspace-folder-summary.js";'],
    ["panel-confirmation-display-projection.ts", 'export * from "./panel-ui/src/confirmation-display-projection.js";'],
    ["panel-agent-work-timeline-view.ts", 'export * from "./panel-read-model/assistant/panel-agent-work-timeline-view.js";'],
    ["panel-stream-tool-projection.ts", 'export * from "./panel-read-model/run/panel-stream-tool-projection.js";'],
    ["panel-agent-run-tree-view.ts", 'export * from "./panel-read-model/run/panel-agent-run-tree-view.js";'],
    ["panel-work-note-contracts.ts", 'export * from "./panel-read-model/run/panel-work-note-contracts.js";'],
    ["panel-work-notes.ts", 'export * from "./panel-read-model/run/panel-work-notes.js";'],
    ["panel-runtime-summary.ts", 'export * from "./panel-read-model/run/panel-runtime-summary.js";'],
    ["panel-usage-statistics.ts", 'export * from "./panel-server/panel-usage-statistics.js";'],
    ["panel-context-window-usage.ts", 'export * from "./panel-ui/src/context-window-usage.js";'],
    ["panel-model-progress-copy.ts", 'export * from "./panel-read-model/panel-model-progress-copy.js";'],
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
  assert.equal(fileExistsSync(path.join(appRoot, "model-capability-registry.test.ts")), false);
  assert.equal(fileExistsSync(path.join(appRoot, "model-context-window-fallback.test.ts")), false);
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
  assert.equal(fileExistsSync(path.join(appRoot, "model-runtime", "model-capability-registry.test.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "model-runtime", "model-context-window-fallback.test.ts")), true);
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
    "panel-usage-statistics.test.ts",
    "panel-usage-statistics.ts",
  ];

  for (const fileName of panelServerFiles) {
    if (fileName !== "panel-usage-statistics.ts") {
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

test("desktop shell support modules stay under desktop ownership", () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const desktopRoot = path.join(appRoot, "desktop");
  const desktopFiles = [
    "panel-desktop-launcher.test.ts",
    "panel-desktop-launcher.ts",
    "panel-desktop-local-preferences.test.ts",
    "panel-desktop-local-preferences.ts",
    "panel-desktop-preload.cts",
    "panel-desktop-window-controls.test.ts",
    "panel-desktop-window-controls.ts",
    "panel-startup-intro-geometry.test.ts",
    "panel-startup-intro-geometry.ts",
    "panel-startup-theme.test.ts",
    "panel-startup-theme.ts",
  ];

  for (const fileName of desktopFiles) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(
      fileExistsSync(path.join(desktopRoot, fileName)),
      true,
      `${fileName} should live in desktop`
    );
  }
});

test("ordinary Desktop Agent entry does not depend on the legacy intent gate", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const sources = await Promise.all([
    readSource(path.join(appRoot, "desktop-agent-session.ts")),
    readSource(path.join(appRoot, "panel-server", "desktop-agent-execution.ts")),
    readSource(path.join(appRoot, "panel-server", "run-execution.ts")),
    readSource(path.join(appRoot, "panel-server", "run-routes.ts")),
    readSource(path.join(appRoot, "panel-server", "conversation-routes.ts")),
  ]);

  assert.equal(fileExistsSync(path.join(appRoot, "desktop-intent-router.ts")), false);
  assert.equal(sources.some((source) => source.includes("decideDesktopIntentWithModel")), false);
  assert.equal(sources.some((source) => source.includes('from "./desktop-intent-router.js"')), false);
  assert.equal(sources.some((source) => source.includes('from "../desktop-intent-router.js"')), false);
});

test("ordinary Desktop Agent source keeps plain runtime terminology", async () => {
  const source = await readSource(path.join(process.cwd(), "src", "app", "desktop-agent-session.ts"));

  for (const overloadedTerm of [
    "deep mode",
    "Underground",
    "Plan",
    "Handoff",
    "rootlet",
    "child agent",
    "atomic mutation",
  ]) {
    assert.equal(source.includes(overloadedTerm), false, `ordinary Desktop Agent source should not mention ${overloadedTerm}`);
  }
});

test("ordinary Desktop Agent entry does not import legacy desktop chat compatibility wrappers", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const files = await collectSourceFiles(appRoot);
  const violations: string[] = [];

  for (const file of files) {
    if (relativePath(file) === "src/app/desktop-chat-session.ts") {
      continue;
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (specifier.includes("desktop-chat-session")) {
        violations.push(`${relativePath(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "new ordinary Agent code should import desktop-agent-session directly");
});

test("confirmation copy stays app-owned while display projection stays panel UI-owned", async () => {
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
  assert.equal(confirmationDisplayProjection.includes('from "../../confirmation-copy.js"'), true);
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

test("kernel tool use loop keeps execution helpers split", async () => {
  const [loop, contracts, execution, messages, results, cloning] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-contracts.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-execution.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-messages.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-results.ts")),
    readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "tool-use-loop-cloning.ts")),
  ]);

  assert.equal(loop.includes('from "./tool-use-loop-contracts.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-execution.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-messages.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-results.js"'), true);
  assert.equal(loop.includes('from "./tool-use-loop-cloning.js"'), true);
  assert.equal(loop.includes("export type ToolUseLoopOptions ="), false);
  assert.equal(loop.includes("function executeToolCalls"), false);
  assert.equal(loop.includes("function executeToolCallSafely"), false);
  assert.equal(loop.includes("function canExecuteReadOnlyBatchInParallel"), false);
  assert.equal(loop.includes("function assistantToolCallMessage"), false);
  assert.equal(loop.includes("function toolResultMessage"), false);
  assert.equal(loop.includes("function outOfFuelLoopResult"), false);
  assert.equal(loop.includes("function abortedLoopResult"), false);
  assert.equal(loop.includes("function approvalRequiredResultFromPending"), false);
  assert.equal(loop.includes("function clonePendingApproval"), false);
  assert.equal(contracts.includes("export type ToolUseLoopOptions"), true);
  assert.equal(execution.includes("export async function executeToolCalls"), true);
  assert.equal(execution.includes("export async function executeSingleToolCall"), true);
  assert.equal(messages.includes("export function assistantToolCallMessage"), true);
  assert.equal(messages.includes("export function toolResultMessage"), true);
  assert.equal(results.includes("export function outOfFuelLoopResult"), true);
  assert.equal(results.includes("export function abortedLoopResult"), true);
  assert.equal(results.includes("export function approvalRequiredResultFromPending"), true);
  assert.equal(cloning.includes("export function clonePendingApproval"), true);
  assert.equal(contracts.includes("readonly allowedTools: readonly string[];"), true);
  assert.equal(contracts.includes("readonly allowedTools?: readonly string[];"), false);
  assert.equal(execution.includes("!options.allowedTools.includes(request.toolName)"), true);
  assert.equal(execution.includes("options.allowedTools === undefined"), false);
  assert.equal(execution.includes("options.allowedTools !== undefined"), false);
});

test("AgentTurnPolicy requires explicit allowed tools at the runtime boundary", async () => {
  const runtimeSource = await readSource(path.join(process.cwd(), "src", "kernel", "intelligence", "agent-turn-runtime.ts"));

  assert.equal(runtimeSource.includes("readonly allowedTools: readonly string[];"), true);
  assert.equal(runtimeSource.includes("readonly allowedTools?: readonly string[];"), false);
  assert.equal(runtimeSource.includes("allowedTools: [...policy.allowedTools]"), true);
  assert.equal(runtimeSource.includes("policy.allowedTools ?? []"), false);
});

test("ToolCenter execution requires explicit run permissions", async () => {
  const [domainTools, toolCenter] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "domain", "tools", "contracts.ts")),
    readSource(path.join(process.cwd(), "src", "app", "tool-center", "tool-center.ts")),
  ]);

  assert.equal(domainTools.includes("readonly allowedTools: readonly string[];"), true);
  assert.equal(domainTools.includes("readonly allowedTools?: readonly string[];"), false);
  assert.equal(domainTools.includes("permission: ToolPermissionCheck"), true);
  assert.equal(domainTools.includes("permission?: ToolPermissionCheck"), false);
  assert.equal(toolCenter.includes("permission: ToolPermissionCheck"), true);
  assert.equal(toolCenter.includes("permission?: ToolPermissionCheck"), false);
  assert.equal(toolCenter.includes("permission.callerAgentId !== context.callerAgentId"), true);
  assert.equal(toolCenter.includes("!permission.allowedTools.includes(request.toolName)"), true);
  assert.equal(toolCenter.includes("permission?.allowedTools"), false);
  assert.equal(toolCenter.includes("permission?.approvedConfirmationIds"), false);
}
);

test("Basic Agent context pack does not own model-visible tool exposure", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const basicRuntimeRoot = path.join(appRoot, "basic-agent-runtime");
  const promptAndContextSources = await Promise.all([
    readSource(path.join(appRoot, "desktop-agent-prompts.ts")),
    readSource(path.join(basicRuntimeRoot, "context-pack.ts")),
    readSource(path.join(basicRuntimeRoot, "context-ledger.ts")),
    readSource(path.join(basicRuntimeRoot, "context-ledger-items.ts")),
  ]);

  for (const source of promptAndContextSources) {
    assert.equal(source.includes("allowedTools"), false);
    assert.equal(source.includes("toolCatalog"), false);
    assert.equal(source.includes("capabilitySnapshot"), false);
    assert.equal(source.includes("ToolCenter"), false);
    assert.equal(source.includes("ToolExecutionBroker"), false);
  }
});

test("OpenAI Responses provider keeps protocol mapping split", async () => {
  const [provider, request, response, fetchBridge] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-request.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-responses-response.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-fetch-bridge.ts")),
  ]);

  assert.equal(provider.includes('from "./openai-responses-request.js"'), true);
  assert.equal(provider.includes('from "./openai-responses-response.js"'), true);
  assert.equal(provider.includes('from "./openai-fetch-bridge.js"'), true);
  assert.equal(provider.includes("function buildResponsesRequestBody"), false);
  assert.equal(provider.includes("function buildInput"), false);
  assert.equal(provider.includes("function normalizeResponse"), false);
  assert.equal(provider.includes("function normalizeStreamResponse"), false);
  assert.equal(provider.includes("function parseOutputItems"), false);
  assert.equal(provider.includes("function toOpenAIFetch"), false);
  assert.equal(provider.includes("openai-compatible-chat-completions-provider.js"), false);
  assert.equal(request.includes("export function buildResponsesRequestBody"), true);
  assert.equal(response.includes("export function normalizeOpenAIResponsesResponse"), true);
  assert.equal(response.includes("export async function normalizeOpenAIResponsesStreamResponse"), true);
  assert.equal(fetchBridge.includes("export function toOpenAIFetch"), true);
});

test("OpenAI-compatible Chat provider keeps request mapping split", async () => {
  const [provider, request, response, stream] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-completions-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-request.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-response.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "openai-compatible-chat-stream.ts")),
  ]);

  assert.equal(provider.includes('from "./openai-compatible-chat-request.js"'), true);
  assert.equal(provider.includes('from "./openai-compatible-chat-response.js"'), true);
  assert.equal(provider.includes('from "./openai-compatible-chat-stream.js"'), true);
  assert.equal(provider.includes("buildOpenAICompatibleChatRequestBody"), true);
  assert.equal(provider.includes("function toOpenAIMessage"), false);
  assert.equal(provider.includes("function toOpenAITool"), false);
  assert.equal(provider.includes("function toOpenAIToolChoice"), false);
  assert.equal(provider.includes("function toOpenAIToolCall"), false);
  assert.equal(provider.includes("applyOpenAICompatibleChatRequestPolicy"), false);
  assert.equal(provider.includes("buildOpenAIChatCompletionsControlFields"), false);
  assert.equal(provider.includes("function normalizeOpenAICompatibleResponse"), false);
  assert.equal(provider.includes("async function normalizeOpenAICompatibleStreamResponse"), false);
  assert.equal(provider.includes("function emitReasoningDelta"), false);
  assert.equal(provider.includes("function accumulateStreamingToolCalls"), false);
  assert.equal(provider.includes("function parseToolCalls"), false);
  assert.equal(provider.includes("function assistantContinuationMessage"), false);
  assert.equal(request.includes("export function buildOpenAICompatibleChatRequestBody"), true);
  assert.equal(request.includes("function toOpenAIMessage"), true);
  assert.equal(request.includes("function toOpenAITool"), true);
  assert.equal(request.includes("function toOpenAIToolChoice"), true);
  assert.equal(request.includes("function toOpenAIToolCall"), true);
  assert.equal(response.includes("export function normalizeOpenAICompatibleResponse"), true);
  assert.equal(response.includes("export function parseToolCalls"), true);
  assert.equal(response.includes("function assistantContinuationMessage"), true);
  assert.equal(stream.includes("export async function normalizeOpenAICompatibleStreamResponse"), true);
  assert.equal(stream.includes("function emitReasoningDelta"), true);
  assert.equal(stream.includes("function accumulateStreamingToolCalls"), true);
});

test("Fake model provider keeps fixture families split", async () => {
  const [provider, contracts, output, desktop, underground, stream] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-contracts.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-output.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-desktop.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-underground.ts")),
    readSource(path.join(process.cwd(), "src", "adapters", "intelligence", "fake-model-provider-stream.ts")),
  ]);

  assert.equal(provider.includes('from "./fake-model-provider-contracts.js"'), true);
  assert.equal(provider.includes('from "./fake-model-provider-output.js"'), true);
  assert.equal(provider.includes('from "./fake-model-provider-stream.js"'), true);
  assert.equal(provider.includes("function defaultFakeOutput"), false);
  assert.equal(provider.includes("function fakeDesktopIntentGateOutput"), false);
  assert.equal(provider.includes("function fakeWorkSessionDecisionOutput"), false);
  assert.equal(provider.includes("function fakeIntentProfileOutput"), false);
  assert.equal(provider.includes("function fakeConvergenceJudgmentOutput"), false);
  assert.equal(provider.includes("function emitFakeOutputDeltas"), false);
  assert.equal(contracts.includes("export type FakeModelProviderOptions"), true);
  assert.equal(contracts.includes("export type FakeModelProviderResponse"), true);
  assert.equal(output.includes("export function defaultFakeStep"), true);
  assert.equal(output.includes("export function defaultFakeOutput"), true);
  assert.equal(output.includes('from "./fake-model-provider-desktop.js"'), true);
  assert.equal(output.includes('from "./fake-model-provider-underground.js"'), true);
  assert.equal(output.includes("desktop.intent_gate.v1"), false);
  assert.equal(output.includes("fakeDesktopIntentGateOutput"), false);
  assert.equal(desktop.includes("export function fakeDesktopAgentStep"), true);
  assert.equal(desktop.includes("fakeDesktopIntentGateOutput"), false);
  assert.equal(desktop.includes("export function fakeWorkSessionSynthesisOutput"), true);
  assert.equal(desktop.includes("start_work_session"), false);
  assert.equal(underground.includes("export function fakeIntentProfileOutput"), true);
  assert.equal(underground.includes("export function fakeConvergenceJudgmentOutput"), true);
  assert.equal(stream.includes("export function emitFakeOutputDeltas"), true);
});

test("Underground orchestrator keeps run factories split", async () => {
  const [orchestrator, factories] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator.ts")),
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator-factories.ts")),
  ]);

  assert.equal(orchestrator.includes('from "./orchestrator-factories.js"'), true);
  assert.equal(orchestrator.includes("function createManagerAgentSpec"), false);
  assert.equal(orchestrator.includes("function createRootletChildRuns"), false);
  assert.equal(orchestrator.includes("function createDelegationDecisionFromGrowth"), false);
  assert.equal(orchestrator.includes("function createParentSynthesisFromCandidatePool"), false);
  assert.equal(orchestrator.includes("function createExplorationPlanFromAutonomyDecision"), false);
  assert.equal(orchestrator.includes("function createExplorationCycle"), false);
  assert.equal(orchestrator.includes("function createAutonomyReview"), false);
  assert.equal(factories.includes("export const UNDERGROUND_CENTER_MANAGER_AGENT_ID"), true);
  assert.equal(factories.includes("export function createManagerAgentSpec"), true);
  assert.equal(factories.includes("export function createRootletChildRuns"), true);
  assert.equal(factories.includes("export function createDelegationDecisionFromGrowth"), true);
  assert.equal(factories.includes("export function createParentSynthesisFromCandidatePool"), true);
  assert.equal(factories.includes("export function createExplorationPlanFromAutonomyDecision"), true);
  assert.equal(factories.includes("export function createExplorationCycle"), true);
  assert.equal(factories.includes("export function createAutonomyReview"), true);
});

async function buildSourceGraph(area: string): Promise<SourceGraph> {
  const root = process.cwd();
  const sourceRoot = path.join(root, area);
  const files = await collectSourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    graph.set(file, resolveRelativeImports(file, source).filter((target) => fileSet.has(target)));
  }

  return graph;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name) as (typeof SOURCE_EXTENSIONS)[number])) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectOrdinaryAgentSourceFiles(): Promise<string[]> {
  const appRoot = path.join(process.cwd(), "src", "app");
  const panelServerRoot = path.join(appRoot, "panel-server");
  const files = [
    ...(await collectSourceFiles(path.join(appRoot, "basic-agent-runtime"))),
    ...(await collectDirectSourceFiles(appRoot, (name) => name.startsWith("desktop-agent-session"))),
    ...(await collectDirectSourceFiles(panelServerRoot, (name) => name.startsWith("basic-agent"))),
    ...(await collectDirectSourceFiles(panelServerRoot, (name) => name.startsWith("conversation"))),
  ];

  return [...new Set(files)].sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
}

async function collectDirectSourceFiles(directory: string, matchesName: (name: string) => boolean): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        matchesName(entry.name) &&
        SOURCE_EXTENSIONS.includes(path.extname(entry.name) as (typeof SOURCE_EXTENSIONS)[number])
    )
    .map((entry) => path.join(directory, entry.name));
}

async function readSource(file: string): Promise<string> {
  return fs.readFile(file, "utf8");
}

function resolveRelativeImports(file: string, source: string): string[] {
  const targets: string[] = [];
  for (const specifier of importSpecifiersFrom(source)) {
    if (!specifier.startsWith(".")) {
      continue;
    }

    const target = resolveSourceSpecifier(file, specifier);
    if (target !== undefined) {
      targets.push(target);
    }
  }

  return targets;
}

function importSpecifiersFrom(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]);
}

function isSiblingBarrelImport(specifier: string): boolean {
  return /^(\.\.\/|\.\/)[^/]+\/index\.js$/.test(specifier);
}

function resolveSourceSpecifier(file: string, specifier: string): string | undefined {
  const withoutJsExtension = path
    .resolve(path.dirname(file), specifier)
    .replace(/\.js$/, "");
  const candidates = [
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    path.join(withoutJsExtension, "index.ts"),
    path.join(withoutJsExtension, "index.tsx"),
  ];

  return candidates.find((candidate) => fileExistsSync(candidate));
}

function fileExistsSync(file: string): boolean {
  return existsSync(file);
}

function isTestAssetSource(file: string): boolean {
  const normalized = relativePath(file);
  return normalized.endsWith(".test.ts") || normalized.includes("/integration-tests/") || normalized.includes("/tests/");
}

function findDependencyCycles(graph: SourceGraph, maxLength: number): string[][] {
  const cycles = new Map<string, string[]>();

  for (const start of graph.keys()) {
    const stack = [start];
    const visited = new Set([start]);

    searchDependencyCycles(start, start, stack, visited, graph, cycles, maxLength);
  }

  return [...cycles.values()].sort(compareCycle);
}

function searchDependencyCycles(
  start: string,
  current: string,
  stack: string[],
  visited: Set<string>,
  graph: SourceGraph,
  cycles: Map<string, string[]>,
  maxLength: number
): void {
  if (stack.length > maxLength) {
    return;
  }

  for (const next of graph.get(current) ?? []) {
    if (next === start && stack.length > 1) {
      const cycle = canonicalCycle(stack.map(relativePath));
      cycles.set(cycle.join(" -> "), cycle);
      continue;
    }

    if (visited.has(next)) {
      continue;
    }

    visited.add(next);
    stack.push(next);
    searchDependencyCycles(start, next, stack, visited, graph, cycles, maxLength);
    stack.pop();
    visited.delete(next);
  }
}

function canonicalCycle(cycle: string[]): string[] {
  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join("\n") < best.join("\n")) {
      best = rotated;
    }
  }

  return best;
}

function compareCycle(left: string[], right: string[]): number {
  return left.length - right.length || left.join("").localeCompare(right.join(""));
}

function relativePath(file: string): string {
  return path.relative(process.cwd(), file).replaceAll(path.sep, "/");
}
