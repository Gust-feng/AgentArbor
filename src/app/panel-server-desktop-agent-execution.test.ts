import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  RunAgentDefinitionRef,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { toolPresentationForName } from "../domain/tools/index.js";
import { runAgentDefinitionRef } from "./agent-definition-runtime.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { runOrdinaryDesktopForPanel } from "./panel-server/desktop-agent-execution.js";
import { PanelHttpError } from "./panel-server/http-utils.js";
import type { DesktopRunResources } from "./panel-server/run-execution-contracts.js";
import type { PanelRuntime } from "./panel-server/runtime.js";

test("ordinary desktop execution keeps frozen run facts on failed agent results", async () => {
  const snapshot = capabilitySnapshot();
  const frozenInformationAccess = informationAccess();
  const resources = desktopRunResources({
    capabilitySnapshot: snapshot,
    informationAccess: frozenInformationAccess,
    channel: failedChannel("fixture model failure"),
  });

  const result = await runOrdinaryDesktopForPanel(
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

test("ordinary desktop execution requires a run-created agent ref", async () => {
  const resources = desktopRunResources({
    capabilitySnapshot: capabilitySnapshot(),
    informationAccess: informationAccess(),
    channel: failedChannel("fixture model failure"),
  });

  await assert.rejects(
    () =>
      runOrdinaryDesktopForPanel(
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

  const result = await runOrdinaryDesktopForPanel(
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

  const result = await runOrdinaryDesktopForPanel(
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
    channel: textChannel("我会只在高影响动作前等待确认。"),
  });

  const result = await runOrdinaryDesktopForPanel(
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

  const result = await runOrdinaryDesktopForPanel(
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
      runOrdinaryDesktopForPanel(
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
  operationType: CapabilityToolCatalogItem["operationType"]
): CapabilityToolCatalogItem {
  const presentation = toolPresentationForName(name, {
    category: "workspace",
    riskLevel: operationType === "read-only" ? "low" : "high",
    operationType,
    requiresConfirmation: operationType !== "read-only",
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
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
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
    scopes: ["desktop-basic", "research"],
    enabled: true,
    availability: "available",
  };
}

function desktopRunResources(input: {
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly channel: IntelligenceChannel;
  readonly toolCenter?: ToolExecutionBroker;
}): DesktopRunResources {
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
      createToolCenter: () => input.toolCenter ?? noToolBroker(),
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
  };
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
    resetCallCount: () => undefined,
    getCallCount: () => 0,
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
    resetCallCount: () => undefined,
    getCallCount: () => 0,
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
    resetCallCount: () => undefined,
    getCallCount: () => 0,
  };
}

function capabilitySnapshot(input: {
  readonly tools?: BasicAgentCapabilitySnapshot["toolCatalog"]["tools"];
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
    skillCatalog: [],
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
