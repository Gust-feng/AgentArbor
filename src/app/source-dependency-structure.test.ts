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

test("confirmation copy has a single shared app owner", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const transcriptConfirmation = await readSource(path.join(appRoot, "panel-ui", "src", "components", "transcript-confirmation.tsx"));

  assert.equal(fileExistsSync(path.join(appRoot, "confirmation-copy.ts")), true);
  assert.equal(fileExistsSync(path.join(appRoot, "panel-confirmation-copy.ts")), false);
  assert.equal(transcriptConfirmation.includes("../../../confirmation-copy"), true);
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
