import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type ProviderStreams } from "@earendil-works/pi-ai";
import type { CapabilityToolCatalogItem } from "../../domain/config/index.js";
import type { ModelMessage, ModelRequest } from "../../domain/intelligence/index.js";
import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../../domain/soil/index.js";
import { toolPresentationForDefinition, type ToolDefinition, type ToolExecutor } from "../../domain/tools/index.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { runAgentDefinitionRef } from "../agent-definitions/agent-definition-ref.js";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import type { AgentLoop } from "../model-runtime/index.js";
import type { AgentSessionLoopOptions } from "../../adapters/intelligence/agent-session-loop.js";
import { createModelProviderBinding } from "../../adapters/intelligence/model-provider-binding.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import type { OrdinaryExecutionInput, OrdinaryRunBirth } from "../ordinary-agent/contracts.js";
import { ordinaryRunBirth } from "../ordinary-agent/test-support.js";
import type { AgentLoopTokenCounter } from "../context-maintenance/index.js";
import { SubAgentRegistry } from "../sub-agents/sub-agent-registry.js";
import { createSubAgentAgentToolCatalogContribution } from "../sub-agents/sub-agent-agent-tools.js";
import { toolDefinitionContractHash } from "../capability/tool-definition-contract.js";
import type { AgentHostRunResources } from "./agent-run-resources.js";
import type { AgentToolRegistryContribution } from "../tool-center/index.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import { createReadToolOutputTool } from "../tool-center/adapters/tool-output-read-tool.js";
import { CodedExecutionError } from "../execution-errors/index.js";
import { createOrdinaryAgentRunResourceAcquirer } from "./ordinary-agent-run-resources.js";

const AGENT_TOOL_NAMES = ["call_sub_agent", "spawn_sub_agent"];

test("Ordinary Host resources preserve canonical context and expose mechanical, MCP, Skill, and native Sub-Agent capabilities", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-run-resources-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const imagePath = path.join(root, "screen.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const skillResource = path.join(root, "guide.md");
  await fs.writeFile(skillResource, "Use the guide.", "utf8");
  const subAgentRoot = await createSubAgentRoot(root);
  const frozenSubAgents = await new SubAgentRegistry({ roots: [subAgentRoot] }).list();
  const baseSnapshot = capabilitySnapshot(root, frozenSubAgents.map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    sourceKind: definition.sourceKind,
    sourceRootId: definition.sourceRootId,
    sourcePrecedence: definition.sourcePrecedence,
    enabled: definition.enabled,
    allowedTools: definition.allowedTools,
    contentHash: definition.contentHash,
    bodyHash: definition.bodyHash,
  })), createSubAgentAgentToolCatalogContribution({
    subAgents: frozenSubAgents,
    dynamicSpawnAvailable: true,
  }).definitions);
  const snapshot = {
    ...baseSnapshot,
    activeModel: {
      ...baseSnapshot.activeModel,
      openAI: { ...baseSnapshot.activeModel.openAI, reasoningEffort: "high" as const },
    },
  };
  let hostReleases = 0;
  let loopReleases = 0;
  let loopConfig: AgentSessionLoopOptions | undefined;
  const countedToolContracts: string[] = [];
  const routingProvider = fauxProvider();
  routingProvider.setResponses([
    fauxAssistantMessage('{"selectedSkillIds":["review-skill"]}'),
    fauxAssistantMessage('{"selectedSkillIds":["review-skill"]}'),
  ]);
  const providerBinding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "test-profile",
    apiKey: "test-key",
    model: snapshot.activeModel.model ?? "gpt-5",
    requestSettings: snapshot.activeModel.openAI,
  }, { createResponsesTransport: () => providerStreams(routingProvider.provider) });
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore(createMinimalSoilConstraints()),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSkillContexts: async ({ createIntelligenceChannel }) => {
      const response = await createIntelligenceChannel({
        bus: new InMemoryMessageBus(new InMemoryEventLog()),
      }).request(skillRoutingRequest());
      assert.equal(response.status, "completed", response.failure?.message);
      assert.deepEqual(response.structuredOutput, { selectedSkillIds: ["review-skill"] });
      return [{
        skill: {
          id: "review-skill",
          name: "Review Skill",
          description: "Reviews changes.",
          enabled: true,
          sourcePath: path.join(root, "SKILL.md"),
          triggers: ["review"],
          resourceIndex: [{ type: "reference", relativePath: "guide.md", sourcePath: skillResource, exists: true }],
        },
        body: "Follow the review guide.",
        triggerReason: "Explicit review request.",
      }];
    },
    resolveSubAgentRoots: () => [subAgentRoot],
  }, {
    async prepareHostResources() {
      return resources(snapshot, root, () => { hostReleases += 1; });
    },
    createSessionLoop(input) {
      loopConfig = input;
      return loop(() => { loopReleases += 1; });
    },
    createProviderBinding: () => providerBinding,
    createTokenCounter: () => observingTokenCounter(countedToolContracts),
  });
  const execution = executionInput(snapshot, {
    contextRefs: [{
      attachmentId: "screen",
      ref: `local-file:${imagePath}`,
      kind: "file",
      title: "screen.png",
      metadata: { mimeType: "image/png", byteLength: 4, available: true, truncated: false },
      readonlyPreview: { title: "Screen", text: "Selected image" },
    }],
    permissionBoundaryRefs: [`read:local-file:${imagePath}`],
  });

  const acquired = await acquirer.acquire(execution);

  assert.equal(loopConfig?.selectedModel.id, execution.birth.config.model);
  assert.equal(loopConfig?.thinkingLevel, "high");
  assert.equal((await loopConfig?.agentSession.getMetadata())?.id, execution.sessionRef.sessionId);
  assert.equal(acquired.resolvedMessages.filter((message) => message.role === "system").length, 1);
  assert.equal(acquired.resolvedMessages.filter((message) => message.role === "tool").length, 0);
  assert.equal(acquired.resolvedMessages.at(-1)?.attachments?.[0]?.attachmentId, "screen");
  assert.equal(acquired.resolvedMessages.at(-1)?.content.includes("Review Skill"), true);
  assert.equal(acquired.resolvedMessages.at(-1)?.content.includes("review the image"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("read_file"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("mcp_lookup"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("read_skill_resource"), true);
  assert.equal(acquired.tools.context.confirmationPolicy, "prompt");
  assert.equal(acquired.tools.permission.confirmationPolicy, "prompt");
  assert.equal(acquired.capabilityResolution?.snapshotId, snapshot.snapshotId);
  assert.deepEqual(acquired.capabilityResolution?.allowedTools, [
    ...acquired.tools.permission.allowedTools,
    "call_sub_agent",
    "spawn_sub_agent",
  ]);
  assert.equal(acquired.capabilityResolution?.runMode, "agent");
  assert.equal(AGENT_TOOL_NAMES.some((name) => acquired.tools.gateway.has(name)), false);
  assert.deepEqual(acquired.agentTools?.map((tool) => tool.toolName), ["call_sub_agent", "spawn_sub_agent"]);
  const deniedSpawn = await acquirer.acquire(executionInput(
    snapshot,
    {
      permissionBoundaryRefs: ["deny:tool:spawn_sub_agent"],
    },
  ));
  assert.deepEqual(deniedSpawn.agentTools?.map((tool) => tool.toolName), ["call_sub_agent"]);

  await acquired.release();
  await acquired.release();
  await deniedSpawn.release();
  assert.equal(loopReleases, 2);
  assert.equal(hostReleases, 2);
});

test("Ordinary Host resources run retained Skill evidence and confirmation through the real Agent Session loop", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-vertical-tools-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const skillResource = path.join(root, "references", "guide.md");
  const skillEvidence = `SKILL_EVIDENCE_MARKER\n${"evidence ".repeat(1_500)}SKILL_EVIDENCE_END`;
  await fs.mkdir(path.dirname(skillResource), { recursive: true });
  await fs.writeFile(skillResource, skillEvidence, "utf8");
  await fs.writeFile(path.join(root, "SKILL.md"), "Use guide.md for complete evidence.", "utf8");

  const outputStore = new InMemoryToolOutputStore({
    createRefToken: () => "vertical-skill-evidence",
  });
  let confirmedExecutions = 0;
  const confirmed = confirmedFixtureTool(() => {
    confirmedExecutions += 1;
    return { confirmed: true };
  });
  const outputReader = createReadToolOutputTool(outputStore);
  const snapshot = capabilitySnapshot(root, [], [outputReader.definition, confirmed.definition]);
  const model = fauxProvider();
  model.setResponses([
    fauxAssistantMessage(fauxToolCall("read_skill_resource", {
      skillId: "review-skill",
      path: "references/guide.md",
      type: "reference",
      maxChars: 64_000,
    }, { id: "read-skill" }), { stopReason: "toolUse" }),
    (context) => {
      const visible = JSON.stringify(context.messages.at(-1));
      assert.match(visible, /tool-output:\/\/vertical-skill-evidence/u);
      assert.equal(visible.includes("SKILL_EVIDENCE_END"), false);
      return fauxAssistantMessage(fauxToolCall("read_tool_output", {
        ref: "tool-output://vertical-skill-evidence",
        startChar: 0,
        maxChars: 20_000,
      }, { id: "read-retained-skill" }), { stopReason: "toolUse" });
    },
    (context) => {
      const visible = JSON.stringify(context.messages.at(-1));
      assert.match(visible, /SKILL_EVIDENCE_MARKER/u);
      assert.match(visible, /"hasMoreAfter":true/u);
      return fauxAssistantMessage(fauxToolCall("confirmed_fixture", {}, { id: "confirmed-call" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("vertical tool path complete"),
  ]);
  const binding = createModelProviderBinding({
    protocol: "openai_responses",
    baseUrl: "https://responses.example/v1",
    profileId: "vertical-tool-profile",
    apiKey: "test-key",
    model: snapshot.activeModel.model ?? "gpt-5",
  }, { createResponsesTransport: () => providerStreams(model.provider) });
  const confirmedContribution: AgentToolRegistryContribution = (register) => register({
    executor: confirmed,
    scopes: ["desktop-basic"],
    enabledByDefault: true,
  });
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSkillContexts: async () => [{
      skill: {
        id: "review-skill",
        name: "Review Skill",
        description: "Reviews changes.",
        enabled: true,
        sourcePath: path.join(root, "SKILL.md"),
        triggers: ["review"],
        resourceIndex: [{
          type: "reference",
          relativePath: "references/guide.md",
          sourcePath: skillResource,
          exists: true,
        }],
      },
      body: "Read the complete guide before confirming.",
      triggerReason: "Selected for vertical acceptance.",
    }],
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      const prepared = resources(snapshot, root, () => undefined);
      return {
        ...prepared,
        toolOutputStore: outputStore,
        toolContributions: [...prepared.toolContributions, confirmedContribution],
      };
    },
    createProviderBinding: () => binding,
    createTokenCounter: () => characterTokenCounter(),
  });
  const acquired = await acquirer.acquire(executionInput(snapshot, { permissionBoundaryRefs: [] }));
  const accepted: Array<{ readonly toolName: string; readonly status: string }> = [];

  const paused = await acquired.loop.execute({
    instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
    messages: acquired.resolvedMessages,
    tools: acquired.tools,
    agentTools: acquired.agentTools,
    abortSignal: new AbortController().signal,
    onToolResult: async (result) => {
      accepted.push({ toolName: result.toolName, status: result.status });
    },
  });

  assert.equal(
    paused.status,
    "approval_required",
    paused.status === "failed" ? `${paused.errorCode ?? "failed"}: ${paused.error}` : paused.status,
  );
  assert.equal(model.state.callCount, 3);
  assert.equal(confirmedExecutions, 0);
  assert.equal(
    typeof (paused.toolResults[0]?.output as { readonly contentRef?: unknown })?.contentRef,
    "string",
  );
  if (paused.status !== "approval_required") return;
  const request = paused.confirmationRequests[0];
  assert.ok(request);
  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: request.confirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-21T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.status === "completed" ? completed.finalText : undefined, "vertical tool path complete");
  assert.equal(model.state.callCount, 4);
  assert.equal(confirmedExecutions, 1);
  assert.deepEqual(accepted, [
    { toolName: "read_skill_resource", status: "completed" },
    { toolName: "read_tool_output", status: "completed" },
    { toolName: "confirmed_fixture", status: "approval_required" },
    { toolName: "confirmed_fixture", status: "completed" },
  ]);
  await acquired.release();
});

test("Ordinary resources pass through Chat Completions configuration and clean Host resources when loop creation fails", async () => {
  const base = ordinaryRunBirth();
  const chatConfig = {
    ...base.config,
    protocolKind: "openai_compatible_chat_completions" as const,
    defaultAiMode: "openai-compatible" as const,
    model: "compatible-model",
  };
  const snapshot = {
    ...base.capabilitySnapshot,
    activeModel: chatConfig,
    modelCapabilities: {
      ...base.capabilitySnapshot.modelCapabilities,
      supportsVisionInput: false,
    },
    workspace: { ...base.capabilitySnapshot.workspace, workspaceDirectory: process.cwd() },
  };
  let hostReleases = 0;
  let received: AgentSessionLoopOptions | undefined;
  const failure = new Error("loop construction failed");
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      return resources(snapshot, process.cwd(), () => { hostReleases += 1; });
    },
    createSessionLoop(input) {
      received = input;
      throw failure;
    },
  });
  const birth: OrdinaryRunBirth = {
    ...base,
    instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
    aiMode: "openai-compatible",
    config: chatConfig,
    agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    capabilitySnapshot: snapshot,
  };

  await assert.rejects(acquirer.acquire({
    runId: "run-chat",
    sessionRef: agentSessionRef(),
    birth,
    runInput: { userMessage: "hello" },
    abortSignal: new AbortController().signal,
  }), (error: unknown) =>
    error instanceof CodedExecutionError &&
    error.code === "run_resource_acquisition_failed" &&
    error.cause === failure);

  assert.equal(received?.selectedModel.api, "openai-completions");
  assert.equal(received?.selectedModel.id, chatConfig.model);
  assert.deepEqual(received?.selectedModel.input, ["text"]);
  assert.equal(hostReleases, 1);
});

test("Ordinary resources preserve provider-native Web Search in the frozen Responses binding", async () => {
  const base = ordinaryRunBirth();
  let hostReleases = 0;
  let loopReleases = 0;
  let received: AgentSessionLoopOptions | undefined;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      return {
        ...resources(base.capabilitySnapshot, process.cwd(), () => { hostReleases += 1; }),
        aiEnvironment: {
          AGENTARBOR_MODEL_API_KEY: "test-key",
          AGENTARBOR_MODEL_BUILTIN_WEB_SEARCH: "true",
        },
      };
    },
    createSessionLoop(input) {
      received = input;
      return loop(() => { loopReleases += 1; });
    },
  });

  const acquired = await acquirer.acquire(executionInput(base.capabilitySnapshot, { permissionBoundaryRefs: [] }));
  assert.ok(received);
  const transformed = received.transformProviderPayload?.({
    model: received.selectedModel,
    payload: { model: received.selectedModel.id, tools: [] },
    tools: [],
  });
  assert.deepEqual(transformed, {
    model: received.selectedModel.id,
    tools: [{ type: "web_search", search_context_size: "medium" }],
  });

  await acquired.release();
  assert.equal(hostReleases, 1);
  assert.equal(loopReleases, 1);
});

test("Ordinary resources reject an incomplete or mismatched AgentDefinition ref before acquiring Host resources", async () => {
  const base = ordinaryRunBirth();
  let acquisitions = 0;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      acquisitions += 1;
      return resources(base.capabilitySnapshot, process.cwd(), () => undefined);
    },
  });

  await assert.rejects(acquirer.acquire({
    runId: "run-invalid-ref",
    sessionRef: agentSessionRef(),
    birth: base,
    runInput: { userMessage: "hello" },
    abortSignal: new AbortController().signal,
  }), (error: unknown) =>
    error instanceof CodedExecutionError && error.code === "agent_definition_mismatch");
  assert.equal(acquisitions, 0);
});

test("Ordinary resources classify tool-boundary failures without parsing messages", async () => {
  const base = ordinaryRunBirth();
  const birth: OrdinaryRunBirth = {
    ...base,
    instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
    agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
  };
  const input = {
    runId: "run-boundary-error",
    sessionRef: agentSessionRef(),
    birth,
    runInput: { userMessage: "hello" },
    abortSignal: new AbortController().signal,
  };

  const boundaryCause = new Error("arbitrary tool policy defect");
  let boundaryReleases = 0;
  const boundaryAcquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      return resources(base.capabilitySnapshot, process.cwd(), () => { boundaryReleases += 1; });
    },
    resolveToolBoundary() { throw boundaryCause; },
  });
  await assert.rejects(boundaryAcquirer.acquire(input), (error: unknown) =>
    error instanceof CodedExecutionError &&
    error.code === "tool_boundary_resolution_failed" &&
    error.cause === boundaryCause);
  assert.equal(boundaryReleases, 1);
});

test("Ordinary run release cleans run resources without discarding retained output", async () => {
  const base = ordinaryRunBirth();
  const calls: string[] = [];
  const cleanupFailure = new Error("process cleanup failed");
  const outputStore = new InMemoryToolOutputStore();
  const retained = await outputStore.retain({
    mediaType: "text/plain",
    content: "continue reading this result",
    sourceToolName: "shell_command",
    sourceCallId: "call-retained-output",
    ownerId: "run-cleanup",
  });
  const host = {
    processRegistry: {
      register() { return undefined; },
      async cleanupByRun(runId: string) {
        calls.push(`process:${runId}`);
        throw cleanupFailure;
      },
    },
    processTerminator: { killTree: async () => ({ status: "killed" as const }) },
    toolOutputStore: outputStore,
  } as never;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host,
    sessionRepository: sessionRepository(),
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareHostResources() {
      return resources(base.capabilitySnapshot, process.cwd(), () => calls.push("host"));
    },
    createSessionLoop() {
      return loop(() => calls.push("loop"));
    },
  });
  const acquired = await acquirer.acquire({
    runId: "run-cleanup",
    sessionRef: agentSessionRef(),
    birth: { ...base, instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt, agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT) },
    runInput: { userMessage: "cleanup" },
    abortSignal: new AbortController().signal,
  });

  await assert.rejects(acquired.release(), (error: unknown) => error === cleanupFailure);
  await assert.rejects(acquired.release(), (error: unknown) => error === cleanupFailure);
  assert.deepEqual(calls, ["loop", "host", "process:run-cleanup"]);
  assert.equal(
    (await outputStore.read(retained.ref, { startChar: 0, maxChars: 64 }))?.content,
    "continue reading this result",
  );
});

function executionInput(
  snapshot: OrdinaryRunBirth["capabilitySnapshot"],
  taskSoil: NonNullable<OrdinaryExecutionInput["runInput"]["taskSoil"]>,
): OrdinaryExecutionInput {
  const base = ordinaryRunBirth();
  return {
    runId: "run-responses",
    sessionRef: agentSessionRef(),
    birth: {
      ...base,
      instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
      config: snapshot.activeModel,
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
      capabilitySnapshot: snapshot,
    },
    runInput: { userMessage: "review the image", taskSoil },
    abortSignal: new AbortController().signal,
  };
}

function agentSessionRef() {
  return {
    sessionId: "session-ordinary-resources",
    storageKey: "session-ordinary-resources.jsonl",
    sessionCwd: process.cwd(),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function skillRoutingRequest(): ModelRequest {
  return {
    requestId: "ordinary-skill-routing",
    traceId: "ordinary-skill-routing-trace",
    callerRef: "ordinary-skill-router",
    purpose: "skill_routing",
    inputRefs: [],
    sanitizedMessages: [
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Select a skill." },
    ],
    tools: [],
    toolChoice: "none",
    outputContract: {
      contractId: "skill-router.selection.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["selectedSkillIds"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 200 },
    sensitivity: "internal",
    requestedAt: "2026-07-21T00:00:00.000Z",
  };
}

function providerStreams(provider: ReturnType<typeof fauxProvider>["provider"]): ProviderStreams {
  return {
    stream: provider.stream.bind(provider),
    streamSimple: provider.streamSimple.bind(provider),
  };
}

function sessionRepository() {
  return {
    async acquire(ref: ReturnType<typeof agentSessionRef>) {
      const session = await new InMemorySessionRepo().create({ id: ref.sessionId });
      return {
        ref,
        session,
        revokeTo: (target: { readonly sessionId: string; readonly entryId: string } | null) =>
          session.moveTo(target?.entryId ?? null).then(() => undefined),
        async release() { return undefined; },
      };
    },
  };
}

function capabilitySnapshot(
  workspaceRoot: string,
  subAgentCatalog: OrdinaryRunBirth["capabilitySnapshot"]["subAgentCatalog"],
  agentToolDefinitions: readonly ToolDefinition[] = [],
): OrdinaryRunBirth["capabilitySnapshot"] {
  const base = ordinaryRunBirth().capabilitySnapshot;
  const tools = [
    tool("read_file", ["workspace", "desktop-basic"]),
    tool("read_skill_resource", ["desktop-basic"]),
    tool("mcp_lookup", ["mcp"]),
    ...agentToolDefinitions.map(capabilityToolFromDefinition),
  ];
  return {
    ...base,
    toolCatalog: { scope: "desktop-basic", tools, allowedTools: tools.map((item) => item.name) },
    subAgentCatalog,
    workspace: { ...base.workspace, workspaceDirectory: workspaceRoot },
  };
}

function capabilityToolFromDefinition(definition: ToolDefinition): CapabilityToolCatalogItem {
  const metadata = definition.metadata;
  assert.notEqual(metadata, undefined);
  const presentation = toolPresentationForDefinition(definition);
  return {
    name: definition.name,
    displayName: presentation.displayName,
    displayDescription: presentation.displayDescription,
    description: definition.description,
    inputSchema: globalThis.structuredClone(definition.inputSchema),
    category: metadata!.category,
    categoryLabel: presentation.categoryLabel,
    riskLevel: metadata!.riskLevel,
    riskLabel: presentation.riskLabel,
    operationType: metadata!.operationType,
    operationLabel: presentation.operationLabel,
    requiresConfirmation: metadata!.requiresConfirmation,
    confirmationLabel: presentation.confirmationLabel,
    definitionHash: toolDefinitionContractHash(definition),
    scopes: ["desktop-basic"],
    enabled: true,
    availability: "available",
  };
}

function tool(name: string, scopes: CapabilityToolCatalogItem["scopes"]): CapabilityToolCatalogItem {
  return {
    name,
    displayName: name,
    displayDescription: `${name} tool`,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    category: name === "mcp_lookup" ? "mcp" : name === "read_skill_resource" ? "other" : "filesystem",
    categoryLabel: "Tool",
    riskLevel: "low",
    riskLabel: "Low",
    operationType: "read-only",
    operationLabel: "Read",
    requiresConfirmation: false,
    confirmationLabel: "No confirmation",
    scopes,
    enabled: true,
    availability: "available",
  };
}

function resources(
  snapshot: OrdinaryRunBirth["capabilitySnapshot"],
  workspaceRoot: string,
  onRelease: () => void,
): AgentHostRunResources<OrdinaryRunBirth["capabilitySnapshot"]> {
  const mcpContribution: AgentToolRegistryContribution = (register) => register({
    executor: executor("mcp_lookup"),
    scopes: ["mcp"],
    enabledByDefault: true,
  });
  return {
    capabilitySnapshot: snapshot,
    informationAccess: ordinaryRunBirth().informationAccess,
    aiEnvironment: { AGENTARBOR_MODEL_API_KEY: "test-key" },
    workspaceRoot,
    toolStates: snapshot.toolCatalog.tools.map((item) => ({ name: item.name, enabled: true, updatedAt: snapshot.createdAt })),
    toolCatalogNames: snapshot.toolCatalog.tools.map((item) => item.name),
    toolCatalogAvailability: snapshot.toolCatalog.tools.map((item) => ({ name: item.name, availability: item.availability })),
    playwrightAvailable: false,
    toolRegistryScopes: ["desktop-basic", "mcp"],
    toolContributions: [mcpContribution],
    async release() { onRelease(); },
  };
}

function characterTokenCounter(): AgentLoopTokenCounter {
  const count = (message: ModelMessage) => message.content.length + JSON.stringify(message.toolCalls ?? []).length;
  return {
    source: "openai_tiktoken",
    model: "test-character-counter",
    countText: (text) => text.length,
    countMessage: count,
    countMessages: (messages) => messages.reduce((total, message) => total + count(message), 0),
  };
}

function observingTokenCounter(observedText: string[]): AgentLoopTokenCounter {
  const base = characterTokenCounter();
  return {
    ...base,
    countText(text) {
      observedText.push(text);
      return base.countText(text);
    },
  };
}

function executor(name: string): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} tool`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      metadata: { category: "mcp", riskLevel: "low", operationType: "read-only", requiresConfirmation: false },
    },
    async execute() { return { ok: true }; },
  };
}

function confirmedFixtureTool(execute: () => unknown): ToolExecutor {
  return {
    definition: {
      name: "confirmed_fixture",
      description: "Execute one confirmed fixture operation.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      metadata: {
        category: "workspace",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: true,
      },
    },
    async execute() { return execute(); },
  };
}

function loop(onRelease: () => void): AgentLoop {
  return {
    async execute() { throw new Error("unused"); },
    async release() { onRelease(); },
  };
}

async function createSubAgentRoot(root: string): Promise<string> {
  const subAgentRoot = path.join(root, "sub-agents");
  const directory = path.join(subAgentRoot, "reviewer");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "SUB_AGENT.md"), [
    "---",
    'name: "reviewer"',
    'description: "Review implementation facts."',
    'allowed-tools: ["read_file"]',
    "---",
    "",
    "Review carefully and report complete evidence.",
    "",
  ].join("\n"), "utf8");
  return subAgentRoot;
}
