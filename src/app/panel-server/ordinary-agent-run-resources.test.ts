import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CapabilityToolCatalogItem } from "../../domain/config/index.js";
import type { IntelligenceChannel, ModelMessage, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import { createMinimalReadonlySoilStore, createMinimalSoilConstraints } from "../../domain/soil/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { runAgentDefinitionRef } from "../agent-definition-ref.js";
import type { AgentLoop, CreateModelRuntimeAgentLoopInput } from "../model-runtime/index.js";
import type { OrdinaryExecutionInput, OrdinaryRunBirth } from "../ordinary-agent/contracts.js";
import { ordinaryRunBirth } from "../ordinary-agent/test-support.js";
import type { AgentLoopTokenCounter } from "../context-maintenance/index.js";
import { createOpenAIAgentsInputMapper } from "../../adapters/intelligence/openai-agents-input.js";
import { SubAgentRegistry } from "../sub-agents/sub-agent-registry.js";
import type { AgentRunResources } from "./agent-run-resources.js";
import type { AgentToolRegistryContribution } from "../tool-center/index.js";
import { createOrdinaryAgentRunResourceAcquirer } from "./ordinary-agent-run-resources.js";

const LEGACY_SUB_AGENT_TOOLS = ["call_sub_agent", "call_sub_agents", "spawn_sub_agent", "read_sub_agent_output"];

test("Ordinary Host resources preserve canonical context and expose mechanical, MCP, Skill, and native Sub-Agent capabilities", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-run-resources-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const imagePath = path.join(root, "screen.png");
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const skillResource = path.join(root, "guide.md");
  await fs.writeFile(skillResource, "Use the guide.", "utf8");
  const subAgentRoot = await createSubAgentRoot(root);
  const frozenSubAgents = await new SubAgentRegistry({ roots: [subAgentRoot] }).list();
  const snapshot = capabilitySnapshot(root, frozenSubAgents.map((definition) => ({
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
  })));
  let hostReleases = 0;
  let loopReleases = 0;
  let loopConfig: CreateModelRuntimeAgentLoopInput | undefined;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    soilStore: createMinimalReadonlySoilStore(createMinimalSoilConstraints()),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSkillContexts: async () => [{
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
    }],
    resolveSubAgentRoots: () => [subAgentRoot],
  }, {
    async prepareRunResources() {
      return resources(snapshot, root, () => { hostReleases += 1; });
    },
    createAgentLoop(input) {
      loopConfig = input;
      return loop(() => { loopReleases += 1; });
    },
  });
  const prior: readonly ModelMessage[] = [
    { role: "system", content: DESKTOP_ROOT_AGENT.prompt.systemPrompt, ref: "stable-system" },
    { role: "user", content: "first request" },
    { role: "assistant", content: "", toolCalls: [{ callId: "call-1", toolName: "read_file", input: { path: "README.md" } }] },
    { role: "tool", content: "README", toolCallId: "call-1", toolName: "read_file" },
    { role: "assistant", content: "first answer" },
  ];
  const execution = executionInput(snapshot, [...prior, { role: "user", content: "review the image" }], {
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

  assert.equal(loopConfig?.mode, "openai-responses");
  assert.equal(loopConfig?.modelProvider, execution.birth.config);
  assert.equal(acquired.resolvedMessages.filter((message) => message.role === "system").length, 1);
  assert.deepEqual(acquired.resolvedMessages.slice(0, prior.length), prior);
  assert.equal(acquired.resolvedMessages.filter((message) => message.role === "tool").length, 1);
  assert.equal(acquired.resolvedMessages.at(-1)?.attachments?.[0]?.attachmentId, "screen");
  assert.equal(acquired.resolvedMessages.at(-1)?.content.includes("Review Skill"), true);
  assert.equal(acquired.resolvedMessages.at(-1)?.content.includes("review the image"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("read_file"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("mcp_lookup"), true);
  assert.equal(acquired.tools.permission.allowedTools.includes("read_skill_resource"), true);
  assert.equal(acquired.tools.context.confirmationPolicy, "prompt");
  assert.equal(acquired.tools.permission.confirmationPolicy, "prompt");
  assert.equal(LEGACY_SUB_AGENT_TOOLS.some((name) => acquired.tools.gateway.has(name)), false);
  assert.deepEqual(acquired.agentTools?.map((tool) => tool.toolName), ["call_sub_agent", "spawn_sub_agent"]);

  await acquired.release();
  await acquired.release();
  assert.equal(loopReleases, 1);
  assert.equal(hostReleases, 1);
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
    workspace: { ...base.capabilitySnapshot.workspace, workspaceDirectory: process.cwd() },
  };
  let hostReleases = 0;
  let received: CreateModelRuntimeAgentLoopInput | undefined;
  const failure = new Error("loop construction failed");
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareRunResources() {
      return resources(snapshot, process.cwd(), () => { hostReleases += 1; });
    },
    createAgentLoop(input) {
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
    birth,
    runInput: { userMessage: "hello" },
    messages: [{ role: "user", content: "hello" }],
    abortSignal: new AbortController().signal,
  }), (error: unknown) => error === failure);

  assert.equal(received?.mode, "openai-compatible");
  assert.equal(received?.modelProvider, chatConfig);
  assert.equal(hostReleases, 1);
});

test("Ordinary resources reject an incomplete or mismatched AgentDefinition ref before acquiring Host resources", async () => {
  const base = ordinaryRunBirth();
  let acquisitions = 0;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host: {} as never,
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareRunResources() {
      acquisitions += 1;
      return resources(base.capabilitySnapshot, process.cwd(), () => undefined);
    },
  });

  await assert.rejects(acquirer.acquire({
    runId: "run-invalid-ref",
    birth: base,
    runInput: { userMessage: "hello" },
    messages: [{ role: "user", content: "hello" }],
    abortSignal: new AbortController().signal,
  }), /complete frozen AgentDefinition reference/u);
  assert.equal(acquisitions, 0);
});

for (const protocol of ["openai_responses", "openai_compatible_chat_completions"] as const) {
  test(`Ordinary resources compact oversized ${protocol} context before AgentLoop`, async () => {
    const base = ordinaryRunBirth();
    const config = {
      ...base.config,
      protocolKind: protocol,
      defaultAiMode: protocol === "openai_responses" ? "openai-responses" as const : "openai-compatible" as const,
      model: `model-${protocol}`,
    };
    const snapshot = {
      ...base.capabilitySnapshot,
      activeModel: config,
      modelCapabilities: {
        ...base.capabilitySnapshot.modelCapabilities,
        contextWindowTokens: 1_000,
      },
      workspace: { ...base.capabilitySnapshot.workspace, workspaceDirectory: process.cwd() },
    };
    const channel = new CompactionChannel();
    const controller = new AbortController();
    let loopConfig: CreateModelRuntimeAgentLoopInput | undefined;
    const acquirer = createOrdinaryAgentRunResourceAcquirer({
      host: {} as never,
      soilStore: createMinimalReadonlySoilStore([]),
      resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
      resolveSubAgentRoots: () => [],
    }, {
      async prepareRunResources() {
        return resources(snapshot, process.cwd(), () => undefined, channel);
      },
      createAgentLoop(input) {
        loopConfig = input;
        return loop(() => undefined);
      },
      createTokenCounter: () => characterTokenCounter(),
    });
    const oldMessages = Array.from({ length: 12 }, (_, index): ModelMessage => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `old-${index}-${"x".repeat(220)}`,
      ref: `old:${index}`,
    }));
    const acquired = await acquirer.acquire({
      runId: `run-${protocol}`,
      birth: {
        ...base,
        instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
        aiMode: config.defaultAiMode,
        config,
        agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
        capabilitySnapshot: snapshot,
      },
      runInput: { userMessage: "current request" },
      messages: [
        ...oldMessages,
        {
          role: "assistant",
          content: "",
          ref: "recent:tool-call",
          toolCalls: [{ callId: "recent-call", toolName: "read_file", input: { path: "README.md" } }],
        },
        {
          role: "tool",
          content: "recent README result",
          ref: "recent:tool-result",
          toolCallId: "recent-call",
          toolName: "read_file",
        },
        { role: "user", content: "current request", ref: "current:user" },
      ],
      abortSignal: controller.signal,
    });

    assert.equal(channel.requests.length, 1);
    assert.equal(channel.abortSignals[0], controller.signal);
    assert.equal(loopConfig?.modelProvider?.protocolKind, protocol);
    assert.equal(acquired.resolvedMessages.some((message) => message.content.includes("# Compacted Context")), true);
    assert.equal(acquired.resolvedMessages.filter((message) => message.role === "system").length, 1);
    assert.equal(acquired.resolvedMessages.some((message) => message.ref === "old:0"), false);
    assert.equal(acquired.resolvedMessages.some((message) => message.ref === "recent:tool-call"), true);
    assert.equal(acquired.resolvedMessages.some((message) => message.ref === "recent:tool-result"), true);
    assert.equal(acquired.resolvedMessages.some((message) => message.content.includes("current request")), true);
    assert.equal(acquired.resolvedMessages.some((message) => message.content === DESKTOP_ROOT_AGENT.prompt.systemPrompt), true);
    assert.doesNotThrow(() => createOpenAIAgentsInputMapper({
      protocol,
      messages: acquired.resolvedMessages,
    }).messages(DESKTOP_ROOT_AGENT.prompt.systemPrompt));
    await acquired.release();
  });
}

test("Ordinary run release attempts process and retained-output cleanup even when one cleanup fails", async () => {
  const base = ordinaryRunBirth();
  const calls: string[] = [];
  const cleanupFailure = new Error("process cleanup failed");
  const host = {
    processRegistry: {
      register() { return undefined; },
      async cleanupByRun(runId: string) {
        calls.push(`process:${runId}`);
        throw cleanupFailure;
      },
    },
    processTerminator: { killTree: async () => ({ status: "killed" as const }) },
    toolOutputStore: {
      async releaseOwner(ownerId: string) { calls.push(`output:${ownerId}`); return 1; },
    },
  } as never;
  const acquirer = createOrdinaryAgentRunResourceAcquirer({
    host,
    soilStore: createMinimalReadonlySoilStore([]),
    resolveAgentDefinition: () => DESKTOP_ROOT_AGENT,
    resolveSubAgentRoots: () => [],
  }, {
    async prepareRunResources() {
      return resources(base.capabilitySnapshot, process.cwd(), () => calls.push("host"));
    },
    createAgentLoop() {
      return loop(() => calls.push("loop"));
    },
  });
  const acquired = await acquirer.acquire({
    runId: "run-cleanup",
    birth: { ...base, instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt, agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT) },
    runInput: { userMessage: "cleanup" },
    messages: [{ role: "user", content: "cleanup" }],
    abortSignal: new AbortController().signal,
  });

  await assert.rejects(acquired.release(), (error: unknown) => error === cleanupFailure);
  await assert.rejects(acquired.release(), (error: unknown) => error === cleanupFailure);
  assert.deepEqual(calls, ["loop", "host", "process:run-cleanup", "output:run-cleanup"]);
});

function executionInput(
  snapshot: OrdinaryRunBirth["capabilitySnapshot"],
  messages: readonly ModelMessage[],
  taskSoil: NonNullable<OrdinaryExecutionInput["runInput"]["taskSoil"]>,
): OrdinaryExecutionInput {
  const base = ordinaryRunBirth();
  return {
    runId: "run-responses",
    birth: {
      ...base,
      instructions: DESKTOP_ROOT_AGENT.prompt.systemPrompt,
      config: snapshot.activeModel,
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
      capabilitySnapshot: snapshot,
    },
    runInput: { userMessage: "review the image", taskSoil },
    messages,
    abortSignal: new AbortController().signal,
  };
}

function capabilitySnapshot(
  workspaceRoot: string,
  subAgentCatalog: OrdinaryRunBirth["capabilitySnapshot"]["subAgentCatalog"],
): OrdinaryRunBirth["capabilitySnapshot"] {
  const base = ordinaryRunBirth().capabilitySnapshot;
  const tools = [
    tool("read_file", ["workspace", "desktop-basic"]),
    tool("read_skill_resource", ["desktop-basic"]),
    tool("mcp_lookup", ["mcp"]),
  ];
  return {
    ...base,
    toolCatalog: { scope: "desktop-basic", tools, allowedTools: tools.map((item) => item.name) },
    subAgentCatalog,
    workspace: { ...base.workspace, workspaceDirectory: workspaceRoot },
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
  channel: IntelligenceChannel = new UnusedChannel(),
): AgentRunResources {
  const mcpContribution: AgentToolRegistryContribution = (register) => register({
    executor: executor("mcp_lookup"),
    scopes: ["mcp"],
    enabledByDefault: true,
  });
  return {
    capabilitySnapshot: snapshot,
    informationAccess: ordinaryRunBirth().informationAccess,
    aiEnvironment: { AGENTARBOR_MODEL_API_KEY: "test-key" },
    aiConfig: { enabled: true, mode: "fake", summaryInput: { enabled: true, mode: "fake" }, createIntelligenceChannel: () => channel },
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

class CompactionChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];
  readonly abortSignals: (AbortSignal | undefined)[] = [];
  async request(request: ModelRequest, options?: { readonly abortSignal?: AbortSignal }): Promise<ModelResponse> {
    this.requests.push(request);
    this.abortSignals.push(options?.abortSignal);
    return {
      responseId: `response-${request.requestId}`,
      requestId: request.requestId,
      providerId: "compactor",
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      model: "compactor",
      status: "completed",
      outputKind: "explanation",
      textOutput: "## Goal\nContinue the current request.\n\n## Next Steps\nUse the preserved recent messages.",
      validation: { status: "passed", checkedAt: "2026-07-15T00:00:00.000Z", issues: [] },
      completedAt: "2026-07-15T00:00:00.000Z",
    };
  }
  validateResponse(_request: ModelRequest, response: ModelResponse) { return response.validation; }
}

class UnusedChannel implements IntelligenceChannel {
  async request(): Promise<ModelResponse> { throw new Error("unexpected context compaction request"); }
  validateResponse(_request: ModelRequest, response: ModelResponse) { return response.validation; }
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
