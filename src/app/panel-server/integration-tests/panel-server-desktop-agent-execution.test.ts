import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilitySkillCatalogItem,
  CapabilityToolCatalogItem,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../../domain/config/index.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutor,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../../domain/tools/index.js";
import { normalizeToolFactValue, toolPresentationForName } from "../../../domain/tools/index.js";
import { runAgentDefinitionRef } from "../../agent-definition-runtime.js";
import type { AgentDefinition } from "../../agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "../../agent-prompts/desktop-root-agent.js";
import { executeOrdinaryDesktopRunForPanel } from "../desktop-agent-execution.js";
import { PanelHttpError } from "../http-utils.js";
import type { AgentRunResources } from "../run-execution-contracts.js";
import type { PanelRuntime } from "../runtime.js";
import {
  createMcpToolRegistryContribution,
  type McpToolExecutorProvider,
} from "../../mcp/mcp-tool-contribution.js";
import type { AgentToolRegistryContribution } from "../../tool-center/index.js";

type OrdinaryExecutionInput = Parameters<typeof executeOrdinaryDesktopRunForPanel>[0];

function executeOrdinaryFixture(
  runtime: OrdinaryExecutionInput["runtime"],
  goal: OrdinaryExecutionInput["goal"],
  aiMode: OrdinaryExecutionInput["aiMode"],
  taskSoilInput: OrdinaryExecutionInput["taskSoilInput"],
  resources: OrdinaryExecutionInput["resources"],
  options: OrdinaryExecutionInput["options"],
) {
  return executeOrdinaryDesktopRunForPanel({
    runtime,
    goal,
    aiMode,
    taskSoilInput,
    resources,
    options,
  });
}

test("ordinary desktop execution keeps frozen run facts on failed agent results", async () => {
  const snapshot = capabilitySnapshot();
  const frozenInformationAccess = informationAccess();
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: frozenInformationAccess,
    channel: failedChannel("fixture model failure"),
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "触发失败路径",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  assert.equal(result.failed?.code, "desktop_agent_failed");
  assert.equal(result.failed?.message, "fixture model failure");
  assert.equal(result.config, snapshot.activeModel);
  assert.equal(result.informationAccess, frozenInformationAccess);
  assert.equal(result.capabilitySnapshot, snapshot);
  assert.deepEqual(result.agentDefinitionRef, runAgentDefinitionRef(DESKTOP_ROOT_AGENT));
  assert.equal(result.capabilityResolution?.agentId, DESKTOP_ROOT_AGENT.agentId);
  assert.equal(result.capabilityResolution?.snapshotId, snapshot.snapshotId);
  assert.deepEqual(result.capabilityResolution?.allowedTools, []);
  assert.equal(result.canvas?.kind, "desktop_agent_canvas");
  assert.equal(result.canvas.kind === "desktop_agent_canvas" ? result.canvas.agent.status : undefined, "failed");
});

test("ordinary desktop execution awaits terminal resource release", async () => {
  const snapshot = capabilitySnapshot();
  let releaseStarted!: () => void;
  let finishRelease!: () => void;
  const releaseWasStarted = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  const releaseGate = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel: sequenceChannel([{ kind: "text", answer: "done" }]),
    release: async () => {
      releaseStarted();
      await releaseGate;
    },
  });

  let settled = false;
  const execution = executeOrdinaryDesktopRunForPanel({
    runtime: runtime(),
    goal: "完成后释放资源",
    aiMode: "fake",
    taskSoilInput: undefined,
    resources,
    options: { agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT) },
  }).finally(() => {
    settled = true;
  });

  await releaseWasStarted;
  assert.equal(settled, false);
  finishRelease();
  const result = await execution;
  assert.equal(result.completed, true);
  assert.equal(settled, true);
});

test("ordinary desktop approval continuation releases retained resources exactly once", async () => {
  const toolName = "test_mutating_tool";
  const snapshot = capabilitySnapshot({
    tools: [capabilityTool(toolName, "read-write")],
  });
  let releaseCalls = 0;
  let executions = 0;
  const channel = sequenceChannel([
    { kind: "tool", toolName, callId: "call-mutating", input: { value: "approved" } },
    { kind: "text", answer: "确认后已完成。" },
  ]);
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel,
    toolExecutor: {
      definition: {
        name: toolName,
        description: "Mutate a fixture only after explicit confirmation.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        modelContract: {
          purpose: "Exercise the approval continuation resource lifecycle.",
          whenToUse: ["Use when the fixture requests a confirmed mutation."],
          inputNotes: ["value: fixture mutation value."],
          outputNotes: ["Returns the accepted fixture value."],
        },
        metadata: {
          category: "filesystem",
          riskLevel: "high",
          operationType: "read-write",
          requiresConfirmation: true,
        },
      },
      async execute(input) {
        executions += 1;
        return { accepted: input };
      },
    },
    release: async () => {
      releaseCalls += 1;
    },
  });

  const pending = await executeOrdinaryDesktopRunForPanel({
    runtime: runtime(),
    goal: "执行需要确认的测试变更",
    aiMode: "fake",
    taskSoilInput: undefined,
    resources,
    options: {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
      toolConfirmationPolicy: "prompt",
    },
  });

  assert.ok(pending.pendingApproval);
  assert.notEqual(pending.pendingApproval.confirmationId.length, 0);
  assert.equal(executions, 0);
  assert.equal(releaseCalls, 0);
  const confirmationId = pending.pendingApproval.confirmationId;
  const completed = await pending.pendingApproval.resume({
    approvedConfirmationIds: [confirmationId],
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.completed, true);
  assert.equal(executions, 1);
  assert.equal(releaseCalls, 1);
  await pending.pendingApproval.release();
  assert.equal(releaseCalls, 1);
});

test("ordinary desktop execution does not run skill routing for unmatched input", async () => {
  const snapshot = capabilitySnapshot({
    skillCatalog: [
      capabilitySkill("defuddle", {
        name: "defuddle",
        description: "Extract clean markdown content from web pages.",
        triggers: ["url", "web page"],
      }),
    ],
  });
  const channel = sequenceChannel([
    {
      kind: "text",
      answer: "收到 111222。",
    },
  ]);
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel,
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "111222",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  assert.equal(result.failed, undefined);
  assert.equal(result.completed, true);
  assert.deepEqual(channel.requests.map((request) => request.purpose), ["desktop_agent"]);
  assert.equal(channel.requests.some((request) => request.purpose === "skill_routing"), false);
  assert.deepEqual(result.capabilityResolution?.enabledSkills.map((skill) => skill.id), ["defuddle"]);
  assert.equal(
    result.canvas?.kind === "desktop_agent_canvas"
      ? result.canvas.agent.context?.items.some((item) => item.sourceKind === "skill")
      : true,
    false
  );
});

test("ordinary desktop execution runs skill routing only when the frozen trigger mode opts in", async () => {
  const snapshot = capabilitySnapshot({
    skillTrigger: {
      mode: "model",
      label: "语义路由",
      modelRouterEnabled: true,
      summary: "test opt-in",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    skillCatalog: [
      capabilitySkill("defuddle", {
        name: "defuddle",
        description: "Extract clean markdown content from web pages.",
        triggers: [],
      }),
    ],
  });
  const channel = modelRouterThenTextChannel({
    selectedSkillIds: ["defuddle"],
    answer: "收到 111222。",
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel,
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "111222",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  assert.equal(result.failed, undefined);
  assert.equal(result.completed, true);
  assert.deepEqual(channel.requests.map((request) => request.purpose), ["skill_routing", "desktop_agent"]);
  assert.equal(channel.requests[0]?.toolChoice, "none");
  assert.deepEqual(channel.requests[0]?.tools, []);
});

test("ordinary desktop execution requires a run-created agent ref", async () => {
  const resources = desktopRunResources({
    capabilitySnapshot: capabilitySnapshot(),
    informationAccess: informationAccess(),
    channel: failedChannel("fixture model failure"),
  });

  await assert.rejects(
    () =>
      executeOrdinaryFixture(
        runtime(),
        "普通 Agent 执行不能临时补默认定义引用",
        "fake",
        undefined,
        resources,
        {}
      ),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.code, "agent_definition_ref_required");
      return true;
    }
  );
});

test("ordinary desktop execution preserves the run-created agent ref after display name changes", async () => {
  const snapshot = capabilitySnapshot();
  const frozenInformationAccess = informationAccess();
  const renamedAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    displayName: "Renamed Desktop Agent",
  };
  const frozenRef: RunAgentDefinitionRef = {
    ...runAgentDefinitionRef(renamedAgent),
    agentDisplayName: "Frozen Desktop Agent",
  };
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: frozenInformationAccess,
    channel: failedChannel("fixture model failure"),
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "旧 run 使用冻结的 Agent 定义引用",
    "fake",
    undefined,
    resources,
    {
      agentDefinition: renamedAgent,
      agentDefinitionRef: frozenRef,
    }
  );

  assert.deepEqual(result.agentDefinitionRef, frozenRef);
  assert.equal(result.capabilityResolution?.agentId, frozenRef.agentId);
  assert.equal(result.capabilityResolution?.agentDisplayName, frozenRef.agentDisplayName);
  assert.equal(result.capabilityResolution?.toolVisibilityProfileId, frozenRef.toolVisibilityProfileId);
  assert.equal(result.capabilityResolution?.snapshotId, snapshot.snapshotId);
  assert.equal(JSON.stringify(result.agentDefinitionRef).includes(renamedAgent.prompt.systemPrompt), false);
});

test("ordinary desktop execution uses the frozen user-configured system prompt", async () => {
  const customSystemPrompt = "You are the user configured Desktop Agent system prompt.";
  const configuredAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    prompt: {
      ...DESKTOP_ROOT_AGENT.prompt,
      promptRef: "prompt:desktop-root-agent:user-configured",
      version: "user-test",
      systemPrompt: customSystemPrompt,
    },
  };
  const channel = sequenceChannel([{ kind: "text", answer: "已使用自定义系统提示词。" }]);
  const resources = desktopRunResources({
    capabilitySnapshot: capabilitySnapshot(),
    informationAccess: informationAccess(),
    channel,
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "检查系统提示词",
    "fake",
    undefined,
    resources,
    {
      agentDefinition: configuredAgent,
      agentDefinitionRef: runAgentDefinitionRef(configuredAgent),
    }
  );

  assert.equal(result.completed, true);
  assert.equal(channel.requests[0]?.sanitizedMessages[0]?.role, "system");
  assert.equal(channel.requests[0]?.sanitizedMessages[0]?.content, customSystemPrompt);
  assert.equal(JSON.stringify(result.agentDefinitionRef).includes(customSystemPrompt), false);
});

test("ordinary desktop execution cannot expose tools outside the frozen capability snapshot", async () => {
  const snapshot = capabilitySnapshot({
    tools: [
      capabilityTool("search", "read-only"),
    ],
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel: textChannel("我会只使用本轮冻结工具边界。"),
    toolCenter: extraToolCenter(),
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "展示当前可见工具边界",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  assert.equal(result.failed, undefined);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(result.capabilityResolution?.toolExposures.some((tool) => tool.name === "read_file"), false);
});

test("ordinary desktop execution can expose optional tools enabled in the frozen capability snapshot", async () => {
  const snapshot = capabilitySnapshot({
    tools: [
      capabilityTool("shell_command", "execute"),
    ],
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel: textChannel("我会只在命令执行前等待确认。"),
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "展示本轮冻结的可执行工具边界",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  const shellExposure = result.capabilityResolution?.toolExposures.find((tool) => tool.name === "shell_command");
  assert.equal(result.failed, undefined);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["shell_command"]);
  assert.equal(shellExposure?.modelVisible, true);
  assert.equal(shellExposure?.requiresConfirmation, true);
  assert.equal(result.capabilityResolution?.warnings.includes("本轮没有可用工具。"), false);
});

test("ordinary desktop execution can run a frozen fake MCP tool through the default agent loop", async () => {
  const mcpTool = capabilityTool("fake_docs__lookup", "read-only", {
    category: "mcp",
    categoryLabel: "MCP",
    scopes: ["mcp"],
  });
  const snapshot = capabilitySnapshot({
    tools: [mcpTool],
  });
  const channel = sequenceChannel([
    {
      kind: "tool",
      toolName: "fake_docs__lookup",
      callId: "call-mcp-lookup",
      input: { query: "AgentArbor MCP" },
    },
    {
      kind: "text",
      answer: "我已根据 fake MCP 工具结果回答。",
    },
  ]);
  const toolCenter = mcpToolCenter({
    name: "fake_docs__lookup",
    output: {
      action: "MCP 查询",
      summary: "找到 AgentArbor MCP 能力底座说明。",
      result: {
        text: "AgentArbor MCP tools are exposed from frozen run capability snapshots.",
      },
      truncated: false,
    },
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel,
    mcpManager: {
      getToolsForRegistry: () => [toolCenter],
    },
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "用 MCP 查一下能力底座",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  const completedTool = result.eventEntries?.find((entry) => entry.type === "tool.completed");
  const toolPayload = completedTool?.message.payload as Readonly<Record<string, unknown>> | undefined;
  assert.equal(result.failed, undefined);
  assert.equal(result.completed, true);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["fake_docs__lookup"]);
  assert.equal(result.canvas?.kind === "desktop_agent_canvas" ? result.canvas.agent.answer?.answer : undefined, "我已根据 fake MCP 工具结果回答。");
  assert.deepEqual(result.canvas?.kind === "desktop_agent_canvas" ? result.canvas.agent.answer?.resultBlocks : undefined, []);
  assert.deepEqual(result.canvas?.kind === "desktop_agent_canvas" ? result.canvas.agent.activity : undefined, []);
  assert.deepEqual(channel.requests.map((request) => request.tools?.map((tool) => tool.name)), [
    ["fake_docs__lookup"],
    ["fake_docs__lookup"],
  ]);
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) =>
    message.role === "tool" &&
    (message.content ?? "").includes("AgentArbor MCP tools are exposed from frozen run capability snapshots.")
  ), true);
  assert.equal(completedTool?.type, "tool.completed");
  assert.equal(toolPayload?.toolName, "fake_docs__lookup");
  assert.equal(JSON.stringify(toolPayload).includes("AgentArbor MCP tools are exposed"), true);
});

test("ordinary desktop execution projects paused context overflow as blocked", async () => {
  const snapshot = capabilitySnapshot({
    tools: [
      capabilityTool("read_file", "read-only"),
    ],
    modelCapabilities: {
      contextWindowTokens: 1_200,
      maxOutputTokens: 512,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
  });
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel: contextOverflowChannel(),
    toolCenter: bulkyToolCenter(),
  });

  const result = await executeOrdinaryFixture(
    runtime(),
    "持续读取大量材料直到可以回答",
    "fake",
    undefined,
    resources,
    {
      agentDefinitionRef: runAgentDefinitionRef(DESKTOP_ROOT_AGENT),
    }
  );

  assert.equal(result.failed, undefined);
  assert.equal(result.blocked?.code, "context_overflow");
  assert.equal(result.blocked?.message.includes("上下文整理没有成功"), true);
  assert.equal(result.canvas?.kind, "desktop_agent_canvas");
  assert.equal(result.canvas.kind === "desktop_agent_canvas" ? result.canvas.agent.status : undefined, "paused");
  assert.equal(result.canvas.kind === "desktop_agent_canvas" ? result.canvas.agent.answer : undefined, undefined);
});

test("ordinary desktop execution rejects a hashed ref that does not match the injected agent definition", async () => {
  const snapshot = capabilitySnapshot();
  const oldAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    prompt: {
      ...DESKTOP_ROOT_AGENT.prompt,
      systemPrompt: "Old prompt content must not leak from direct execution checks.",
    },
  };
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: informationAccess(),
    channel: failedChannel("fixture model failure"),
  });

  await assert.rejects(
    () =>
      executeOrdinaryFixture(
        runtime(),
        "直接执行路径也必须校验 Agent 定义引用",
        "fake",
        undefined,
        resources,
        {
          agentDefinition: DESKTOP_ROOT_AGENT,
          agentDefinitionRef: runAgentDefinitionRef(oldAgent),
        }
      ),
    (error) => {
      assert.equal(error instanceof PanelHttpError, true);
      const panelError = error as PanelHttpError;
      assert.equal(panelError.code, "agent_definition_mismatch");
      assert.equal(panelError.message.includes(oldAgent.prompt.systemPrompt), false);
      return true;
    }
  );
});

function runtime(): PanelRuntime {
  return {
    desktopAgentDefinition: DESKTOP_ROOT_AGENT,
    configCenter: {},
  } as unknown as PanelRuntime;
}

function capabilityTool(
  name: string,
  operationType: CapabilityToolCatalogItem["operationType"],
  overrides: Partial<CapabilityToolCatalogItem> = {}
): CapabilityToolCatalogItem {
  const presentation = toolPresentationForName(name, {
    category: "workspace",
    riskLevel: operationType === "read-only" ? "low" : "high",
    operationType,
    requiresConfirmation: operationType !== "read-only",
  });
  return {
    name,
    displayName: presentation.displayName,
    displayDescription: presentation.displayDescription,
    description: `${name} tool`,
    category: "workspace",
    categoryLabel: presentation.categoryLabel,
    riskLevel: operationType === "read-only" ? "low" : "high",
    riskLabel: presentation.riskLabel,
    operationType,
    operationLabel: presentation.operationLabel,
    requiresConfirmation: operationType !== "read-only",
    confirmationLabel: presentation.confirmationLabel,
    scopes: ["desktop-basic", "research"],
    enabled: true,
    availability: "available",
    ...overrides,
  };
}

function capabilitySkill(
  id: string,
  overrides: Partial<CapabilitySkillCatalogItem> = {}
): CapabilitySkillCatalogItem {
  return {
    id,
    name: id,
    description: `${id} skill`,
    enabled: true,
    sourcePath: `Z:/AgentArbor/.agents/skills/${id}/SKILL.md`,
    triggers: [],
    ...overrides,
  };
}

function desktopRunResources(input: {
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly channel: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
  readonly toolExecutor?: ToolExecutor;
  readonly mcpManager?: McpToolExecutorProvider;
  readonly release?: () => Promise<void>;
}): AgentRunResources {
  return {
    capabilitySnapshot: input.capabilitySnapshot,
    informationAccess: input.informationAccess,
    aiEnvironment: {
      AGENTARBOR_MODEL_API_KEY: "sk-test",
      AGENTARBOR_MODEL_BASE_URL: "https://provider.example",
      AGENTARBOR_MODEL_NAME: "fixture-model",
    },
    aiConfig: {
      enabled: true,
      mode: "fake",
      summaryInput: {
        enabled: true,
        mode: "fake",
        providerId: "fixture",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "fixture-model",
      },
      createIntelligenceChannel: () => input.channel,
    },
    workspaceRoot: input.capabilitySnapshot.workspace.workspaceDirectory,
    toolStates: input.capabilitySnapshot.toolCatalog.tools.map((tool) => ({
      name: tool.name,
      enabled: tool.enabled,
      updatedAt: input.capabilitySnapshot.createdAt,
    })),
    toolCatalogNames: input.capabilitySnapshot.toolCatalog.tools.map((tool) => tool.name),
    toolCatalogAvailability: input.capabilitySnapshot.toolCatalog.tools.map((tool) => ({
      name: tool.name,
      availability: tool.availability,
      disabledReason: tool.disabledReason,
    })),
    playwrightAvailable: false,
    toolRegistryScopes: input.mcpManager === undefined
      ? ["desktop-basic"]
      : ["desktop-basic", "mcp"],
    toolContributions: [
      ...(input.toolExecutor === undefined ? [] : [toolExecutorContribution(input.toolExecutor)]),
      ...(input.mcpManager === undefined ? [] : [createMcpToolRegistryContribution(input.mcpManager)]),
    ],
    release: async () => {
      await input.release?.();
      await input.mcpManager?.disconnectAll?.();
    },
  };
}

function toolExecutorContribution(executor: ToolExecutor): AgentToolRegistryContribution {
  return (register) => register({
    executor,
    scopes: ["desktop-basic"],
    enabledByDefault: true,
  });
}

function contextOverflowChannel(): IntelligenceChannel {
  const requests: ModelRequest[] = [];
  return {
    async request(request) {
      requests.push(request);
      if (request.purpose === "desktop_context_compaction") {
        return {
          ...textResponse(request, ""),
          responseId: `${request.requestId}-empty-compaction`,
          textOutput: "",
        };
      }
      return {
        ...textResponse(request, ""),
        responseId: `${request.requestId}-tool-call`,
        textOutput: undefined,
        toolCalls: [
          {
            callId: `call-bulky-read-${requests.length}`,
            toolName: "read_file",
            input: { path: `bulky-${requests.length}.md` },
          },
        ],
        finishReason: "tool_call",
      };
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function textResponse(request: ModelRequest, answer: string): ModelResponse {
  return {
    responseId: `${request.requestId}-text-response`,
    requestId: request.requestId,
    providerId: "fixture-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "fixture-model",
    status: "completed",
    outputKind: request.outputContract.outputKind,
    textOutput: answer,
    finishReason: "stop",
    validation: {
      status: "passed",
      checkedAt: "2026-06-06T00:00:00.000Z",
      issues: [],
    },
    completedAt: "2026-06-06T00:00:00.000Z",
  };
}

function bulkyToolCenter(): ToolExecutionBroker {
  return {
    list(): ToolDefinition[] {
      return [
        {
          name: "read_file",
          description: "Return a large safe file summary.",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      ];
    },
    has(name) {
      return name === "read_file";
    },
    async execute(
      request: ToolCallRequest,
      _context: ToolExecutionContext,
      _permission: ToolPermissionCheck
    ): Promise<ToolCallResult> {
      const input = request.input as { path?: string };
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: {
          action: "read_file",
          status: "completed",
          refId: `workspace:file:${input.path ?? "bulky.md"}`,
          summary: `Large safe summary ${"context ".repeat(900)}`,
          result: { path: input.path, bytes: 12_000 },
          truncated: false,
        },
        status: "completed",
        durationMs: 0,
      };
    },
  };
}

function failedChannel(message: string): IntelligenceChannel {
  return {
    async request(request) {
      return failedModelResponse(request, message);
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function textChannel(answer: string): IntelligenceChannel {
  return {
    async request(request) {
      return textResponse(request, answer);
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function sequenceChannel(
  steps: readonly (
    | {
        readonly kind: "tool";
        readonly toolName: string;
        readonly callId: string;
        readonly input: unknown;
      }
    | {
        readonly kind: "text";
        readonly answer: string;
      }
  )[]
): IntelligenceChannel & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      const step = steps[Math.min(requests.length - 1, steps.length - 1)];
      if (step?.kind === "tool") {
        return {
          ...textResponse(request, ""),
          textOutput: undefined,
          toolCalls: [
            {
              callId: step.callId,
              toolName: step.toolName,
              input: normalizeToolFactValue(step.input),
            },
          ],
          finishReason: "tool_call",
        };
      }
      return textResponse(request, step?.kind === "text" ? step.answer : "完成。");
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function modelRouterThenTextChannel(input: {
  readonly selectedSkillIds: readonly string[];
  readonly answer: string;
}): IntelligenceChannel & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      if (request.purpose === "skill_routing") {
        return {
          ...textResponse(request, ""),
          responseId: `${request.requestId}-skill-routing-response`,
          structuredOutput: {
            selectedSkillIds: input.selectedSkillIds,
            reasons: input.selectedSkillIds.map((skillId) => ({
              skillId,
              reason: "Test opt-in model route.",
              confidence: 0.8,
            })),
            confidence: 0.8,
          },
        };
      }
      return textResponse(request, input.answer);
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function failedModelResponse(request: ModelRequest, message: string): ModelResponse {
  return {
    responseId: `${request.requestId}-failed`,
    requestId: request.requestId,
    providerId: "fixture-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "fixture-model",
    status: "failed",
    outputKind: request.outputContract.outputKind,
    finishReason: "error",
    validation: {
      status: "failed",
      checkedAt: "2026-06-06T00:00:00.000Z",
      issues: [{ code: "fixture_failure", message }],
    },
    failure: {
      kind: "provider_response",
      retryable: false,
      message,
    },
    completedAt: "2026-06-06T00:00:00.000Z",
  };
}

function mcpToolCenter(input: {
  readonly name: string;
  readonly output: unknown;
}): ToolExecutor {
  return {
    definition: {
      name: input.name,
      description: "Fake MCP lookup tool.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      modelContract: {
        purpose: "Fake MCP lookup tool.",
        whenToUse: ["Use this test MCP tool when the task needs the fake docs lookup."],
        inputNotes: ["query: search text for the fake docs lookup."],
        outputNotes: ["Returns a structured fake MCP lookup result."],
        runtimeHints: [{ label: "scope", value: "test" }],
        examples: [{ input: { query: "AgentArbor MCP" } }],
      },
      metadata: {
        category: "mcp",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    async execute() {
      return input.output;
    },
  };
}

function extraToolCenter(): ToolExecutionBroker {
  const definitions: ToolDefinition[] = [
    {
      name: "search",
      description: "Search safely.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "read_file",
      description: "Read a workspace file.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];
  return {
    list: () => definitions,
    has: (name) => definitions.some((tool) => tool.name === name),
    async execute(request, _context, _permission) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: { status: "completed" },
        status: "completed",
        durationMs: 0,
      };
    },
  };
}

function noToolBroker(): ToolExecutionBroker {
  return {
    list: () => [],
    has: () => false,
    async execute(request, _context, _permission) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "failed",
        error: "No test tools are registered.",
        durationMs: 0,
      };
    },
  };
}

function capabilitySnapshot(input: {
  readonly tools?: BasicAgentCapabilitySnapshot["toolCatalog"]["tools"];
  readonly skillCatalog?: BasicAgentCapabilitySnapshot["skillCatalog"];
  readonly skillTrigger?: BasicAgentCapabilitySnapshot["skillTrigger"];
  readonly modelCapabilities?: BasicAgentCapabilitySnapshot["modelCapabilities"];
} = {}): BasicAgentCapabilitySnapshot {
  const activeModel = modelConfig();
  const tools = input.tools ?? [];
  return {
    snapshotId: "snapshot-desktop-failed-test",
    createdAt: "2026-06-06T00:00:00.000Z",
    activeModel,
    modelCapabilities: input.modelCapabilities ?? {
      contextWindowTokens: 16_000,
      maxOutputTokens: 1_024,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools,
      allowedTools: tools.map((tool) => tool.name),
    },
    skillCatalog: input.skillCatalog ?? [],
    subAgentCatalog: [],
    skillTrigger: input.skillTrigger,
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "frozen-profile",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://provider.example",
    model: "frozen-model",
    defaultAiMode: "fake",
    secretRef: "secret://test/model",
    secretConfigured: true,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web", "codebase"],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 3,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}
