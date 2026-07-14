import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  collectSourceFiles,
  fileExistsSync,
  importSpecifiersFrom,
  readSource,
  relativePath,
  resolveRelativeImports,
} from "./source-structure-test-utils.js";

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
  const source = await readSource(path.join(process.cwd(), "src", "app", "run-runtime-core", "run-mode-policy.ts"));

  assert.equal(source.includes("../agent-definitions/agent-definition-ref.js"), true);
  assert.equal(source.includes("./agent-definition-runtime.js"), false);
  assert.equal(source.includes("resolveRunCapabilities"), false);
  assert.equal(source.includes("createAgentTurnPolicyFromDefinition"), false);
});

test("AgentDefinition runtime does not own executable tool boundary pruning", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [definitionRuntime, runToolBoundary, loopPreparation] = await Promise.all([
    readSource(path.join(appRoot, "agent-definitions", "agent-definition-runtime.ts")),
    readSource(path.join(appRoot, "capability", "run-tool-boundary.ts")),
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-loop-preparation.ts")),
  ]);

  assert.equal(definitionRuntime.includes("ToolExecutionBroker"), false);
  assert.equal(definitionRuntime.includes("restrictRunCapabilityResolutionToExecutableTools"), false);
  assert.equal(runToolBoundary.includes("ToolExecutionBroker"), true);
  assert.equal(runToolBoundary.includes("resolveRunToolBoundary"), true);
  assert.equal(runToolBoundary.includes("restrictRunCapabilityResolutionToExecutableTools"), true);
  assert.equal(loopPreparation.includes('from "../capability/run-tool-boundary.js"'), true);
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

test("Basic Agent run projection does not keep stale panel projection files or display contracts", async () => {
  const runtimeRoot = path.join(process.cwd(), "src", "app", "basic-agent-runtime");
  const runProjection = await readSource(path.join(runtimeRoot, "run-projection.ts"));

  assert.equal(fileExistsSync(path.join(runtimeRoot, "run-projection.ts")), true);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "run-projection.test.ts")), true);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "panel-projection.ts")), false);
  assert.equal(fileExistsSync(path.join(runtimeRoot, "panel-projection.test.ts")), false);
  assert.equal(runProjection.includes("ToolDisplayProjection"), false);
  assert.equal(runProjection.includes("readonly display?:"), false);
});

test("Conversation persistence consumers use the single validated Ordinary snapshot reader", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [contract, ...consumers] = await Promise.all([
    readSource(path.join(appRoot, "basic-agent-runtime", "persistence-snapshot-contract.ts")),
    readSource(path.join(appRoot, "panel-server", "conversation-restore.ts")),
    readSource(path.join(appRoot, "panel-server", "conversation-history.ts")),
    readSource(path.join(appRoot, "panel-server", "conversation-routes.ts")),
  ]);

  assert.equal(contract.includes("export async function readRuntimeSnapshotWithOrdinaryContract"), true);
  assert.equal(contract.includes('snapshot?.run.runMode === "agent"'), true);
  assert.equal(contract.includes("requireRestorableOrdinaryRuntimeSnapshot(snapshot)"), true);
  for (const source of consumers) {
    assert.equal(source.includes("readRuntimeSnapshotWithOrdinaryContract"), true);
    assert.equal(source.includes(".getRun("), false);
  }
});

test("Ordinary runtime persistence has one atomic run snapshot write contract", async () => {
  const root = path.join(process.cwd(), "src");
  const files = await collectSourceFiles(root);
  const writeCallers: string[] = [];
  const legacyRunWriters = [
    ".upsertRun(",
    ".upsertBasicRun(",
    ".replaceBasicRunEvents(",
    ".replaceRunEvents(",
    ".replaceModelCalls(",
    ".replaceToolCalls(",
    ".replaceArtifacts(",
    ".replaceConfirmations(",
    ".replaceSubAgentRuns(",
    ".upsertWorkspace(",
  ];

  for (const file of files) {
    const relative = relativePath(file);
    if (relative.endsWith(".test.ts")) {
      continue;
    }
    const source = await readSource(file);
    for (const writer of legacyRunWriters) {
      assert.equal(source.includes(writer), false, `${relative} must not use legacy runtime sidecar writer ${writer}`);
    }
    if (
      source.includes(".saveRunSnapshot(") &&
      relative !== "src/adapters/runtime-database/file-system-runtime-database.ts" &&
      relative !== "src/domain/runtime-database/contracts.ts"
    ) {
      writeCallers.push(relative);
    }
  }

  assert.deepEqual(writeCallers.sort(), [
    "src/app/basic-agent-runtime/persistence.ts",
    "src/app/panel-server/run-persistence.ts",
  ]);
});

test("ordinary Desktop Agent entry does not depend on the legacy intent gate", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const sources = await Promise.all([
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-session.ts")),
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
  const source = await readSource(path.join(process.cwd(), "src", "app", "desktop-agent", "desktop-agent-session.ts"));

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
    const relative = relativePath(file);
    if (relative.endsWith(".test.ts")) {
      continue;
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiersFrom(source)) {
      if (specifier.includes("desktop-chat-session")) {
        violations.push(`${relative} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [], "new ordinary Agent code should import desktop-agent-session directly");
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
  assert.equal(toolCenter.includes("!permission.allowedTools.includes(factRequest.toolName)"), true);
  assert.equal(toolCenter.includes("permission?.allowedTools"), false);
  assert.equal(toolCenter.includes("permission?.approvedConfirmationIds"), false);
}
);

test("tool execution facts stay independent from display, compatibility, and repeated normalization", async () => {
  const root = process.cwd();
  const [
    contracts,
    toolCenter,
    modelView,
    toolLoopExecution,
    toolLoopMessages,
    runtimeDatabase,
    adapterFiles,
    subAgentToolProducer,
  ] = await Promise.all([
    readSource(path.join(root, "src", "domain", "tools", "contracts.ts")),
    readSource(path.join(root, "src", "app", "tool-center", "tool-center.ts")),
    readSource(path.join(root, "src", "kernel", "intelligence", "tool-call-result-model-view.ts")),
    readSource(path.join(root, "src", "kernel", "intelligence", "tool-use-loop-execution.ts")),
    readSource(path.join(root, "src", "kernel", "intelligence", "tool-use-loop-messages.ts")),
    readSource(path.join(root, "src", "domain", "runtime-database", "contracts.ts")),
    collectSourceFiles(path.join(root, "src", "app", "tool-center", "adapters")),
    readSource(path.join(root, "src", "app", "sub-agents", "sub-agent-tools.ts")),
  ]);

  for (const source of [contracts, toolCenter]) {
    assert.equal(source.includes("ToolDisplayProjection"), false);
    assert.equal(source.includes("ToolSafeProjection"), false);
    assert.equal(source.includes("ToolResultEnvelope"), false);
    assert.equal(source.includes("projection:"), false);
  }
  assert.equal(contracts.includes("resetCallCount"), false);
  assert.equal(contracts.includes("getCallCount"), false);
  assert.equal(modelView.includes('from "../../app/'), false);
  assert.equal(modelView.includes("structuredContent"), false);
  assert.equal(modelView.includes("readonly content"), false);
  assert.equal(modelView.includes("normalizeToolFactValue"), false, "the model consumer must trust ToolCallResult facts");
  assert.equal(toolLoopExecution.includes("normalizeToolFactValue"), false, "the Agent loop must trust its ToolExecutionBroker contract");
  assert.equal(toolLoopMessages.includes("normalizeToolFactValue"), false, "model message construction must not copy the same fact again");
  assert.equal(toolCenter.includes("normalizeToolFactValue"), true, "ToolCenter remains the executor fact-normalization boundary");
  assert.equal(runtimeDatabase.includes("panel-ui"), false);
  assert.equal(runtimeDatabase.includes("ToolResultEnvelope"), false);
  assert.equal(fileExistsSync(path.join(root, "src", "kernel", "tools", "tool-result-envelope.ts")), false);
  assert.equal(fileExistsSync(path.join(root, "src", "app", "tool-result-continuation.ts")), false);
  for (const file of adapterFiles.filter((value) => !value.endsWith(".test.ts"))) {
    const source = await readSource(file);
    assert.equal(/\bdisplay\s*:/u.test(source), false, `${relativePath(file)} must not produce display projections`);
    assert.equal(source.includes("canonicalResult"), false, `${relativePath(file)} must not produce model result wrappers`);
  }
  const executionContractFiles = (await Promise.all([
    path.join(root, "src", "domain", "tools"),
    path.join(root, "src", "domain", "config"),
    path.join(root, "src", "kernel"),
    path.join(root, "src", "adapters"),
    path.join(root, "src", "app", "tool-center"),
    path.join(root, "src", "app", "capability"),
    path.join(root, "src", "app", "model-runtime"),
    path.join(root, "src", "app", "research"),
    path.join(root, "src", "app", "sub-agents"),
  ].map(collectSourceFiles))).flat().filter((file) => !file.endsWith(".test.ts"));
  for (const file of executionContractFiles) {
    const source = await readSource(file);
    assert.equal(
      source.includes("visibleResultPolicy") || source.includes("ToolVisibleResultPolicy"),
      false,
      `${relativePath(file)} must not carry Panel preview policy through the execution domain`
    );
  }
  assert.equal(/\bdisplay\s*:/u.test(subAgentToolProducer), false, "sub-agent tool producers must not emit display projections");
  assert.equal(subAgentToolProducer.includes("canonicalResult"), false, "sub-agent tool producers must not emit model wrappers");
  assert.equal(subAgentToolProducer.includes("rawContentRef"), false, "sub-agent output refs must be executable continuations");
  assert.equal(subAgentToolProducer.includes("full_output_ref"), false, "sub-agent output refs must be executable continuations");
  const readModelConsumers = await Promise.all([
    readSource(path.join(root, "src", "app", "tool-projection", "tool-display-normalization.ts")),
    readSource(path.join(root, "src", "app", "panel-read-model", "run", "panel-stream-tool-projection.ts")),
    readSource(path.join(root, "src", "app", "panel-server", "runtime-records.ts")),
  ]);
  for (const source of readModelConsumers) {
    assert.equal(source.includes("output.display"), false);
    assert.equal(source.includes("existingDisplay"), false);
    assert.equal(source.includes("canonicalResult"), false);
  }
});

test("Desktop Agent model input does not own model-visible tool exposure", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const modelInputSources = await Promise.all([
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-model-input.ts")),
    readSource(path.join(appRoot, "desktop-agent", "desktop-agent-model-input.test.ts")),
  ]);

  for (const source of modelInputSources) {
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
  const appRoot = path.join(process.cwd(), "src", "app");
  const [orchestrator, factories, eventsFacade] = await Promise.all([
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator.ts")),
    readSource(path.join(process.cwd(), "src", "app", "underground", "orchestrator-factories.ts")),
    readSource(path.join(appRoot, "underground-events.ts")),
  ]);

  assert.equal(orchestrator.includes('from "./orchestrator-factories.js"'), true);
  assert.equal(orchestrator.includes('from "./events.js"'), true);
  assert.equal(orchestrator.includes("../underground-events.js"), false);
  assert.equal(eventsFacade.trim(), 'export * from "./underground/events.js";');
  assert.equal(fileExistsSync(path.join(appRoot, "underground", "events.ts")), true);
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

test("legacy underground compat chain stays under underground/compat ownership", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const compatRoot = path.join(appRoot, "underground", "compat");
  const productionFacades = new Map([
    ["direction-handoff-derivation.ts", 'export * from "./underground/compat/direction-handoff-derivation.js";'],
    ["underground-agent-cluster-runtime.ts", 'export * from "./underground/compat/underground-agent-cluster-runtime.js";'],
    ["underground-demo-summary.ts", 'export * from "./underground/compat/underground-demo-summary.js";'],
    ["underground-direction-recovery.ts", 'export * from "./underground/compat/underground-direction-recovery.js";'],
    ["underground-direction-session.ts", 'export * from "./underground/compat/underground-direction-session.js";'],
    ["underground-intelligence.ts", 'export * from "./underground/compat/underground-intelligence.js";'],
    ["underground-message-dispatcher.ts", 'export * from "./underground/compat/underground-message-dispatcher.js";'],
    ["underground-runner.ts", 'export * from "./underground/compat/underground-runner.js";'],
  ]);
  const movedTests = [
    "underground-autonomy-loop.test.ts",
    "underground-demo-cli.test.ts",
    "underground-demo-summary.test.ts",
    "underground-direction-session.test.ts",
    "underground-intelligence.test.ts",
    "underground-message-dispatcher.test.ts",
  ];
  const ownerSources = await Promise.all([
    readSource(path.join(appRoot, "agents", "underground-analyzer.ts")),
    readSource(path.join(appRoot, "underground", "orchestrator.ts")),
    readSource(path.join(appRoot, "underground", "orchestrator.test.ts")),
    readSource(path.join(appRoot, "underground", "minimal", "minimal-loop.ts")),
    readSource(path.join(appRoot, "underground", "minimal", "minimal-direction.ts")),
    readSource(path.join(appRoot, "underground", "clarification", "clarification-flow.ts")),
    readSource(path.join(appRoot, "underground", "agents", "growth-governor.ts")),
    readSource(path.join(appRoot, "panel-server", "underground-compat-execution.ts")),
    readSource(path.join(appRoot, "panel-server", "run-execution-contracts.ts")),
    readSource(path.join(appRoot, "panel-read-model", "canvas", "panel-canvas-read-model.ts")),
  ]);

  for (const [fileName, expectedSource] of productionFacades) {
    const facade = await readSource(path.join(appRoot, fileName));
    assert.equal(facade.trim(), expectedSource, `${fileName} should stay a top-level compatibility facade`);
    assert.equal(fileExistsSync(path.join(compatRoot, fileName)), true, `${fileName} implementation should live in underground/compat`);
  }

  const cliFacade = await readSource(path.join(appRoot, "underground-demo.ts"));
  assert.equal(cliFacade.trim(), 'import "./underground/compat/underground-demo.js";');
  assert.equal(fileExistsSync(path.join(compatRoot, "underground-demo.ts")), true);

  for (const fileName of movedTests) {
    assert.equal(fileExistsSync(path.join(appRoot, fileName)), false, `${fileName} should not live at src/app top level`);
    assert.equal(fileExistsSync(path.join(compatRoot, fileName)), true, `${fileName} should live in underground/compat`);
  }

  for (const source of ownerSources) {
    assert.equal(source.includes("/compat/"), true);
    assert.equal(source.includes("../underground-direction-session.js"), false);
    assert.equal(source.includes("../../underground-direction-session.js"), false);
    assert.equal(source.includes("../underground-demo-summary.js"), false);
    assert.equal(source.includes("../underground-agent-cluster-runtime.js"), false);
    assert.equal(source.includes("../../underground-agent-cluster-runtime.js"), false);
  }
});
