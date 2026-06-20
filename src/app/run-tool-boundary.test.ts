import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  CapabilityToolScope,
} from "../domain/config/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { toolPresentationForName } from "../domain/tools/index.js";
import { createTaskSoil } from "../domain/soil/index.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { resolveRunToolBoundary } from "./run-tool-boundary.js";

test("run tool boundary intersects policy-visible tools with executable tools", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
      tool("write_file", "read-write", { enabled: false }),
      tool("underground_probe", "read-only", { scopes: ["underground"] }),
    ]),
    goal: "inspect tools",
    taskSoil: createTaskSoil({ rawGoal: "inspect tools" }),
    toolCenter: executableToolBroker(["search"]),
  });

  assert.deepEqual(boundary.allowedTools, ["search"]);
  assert.deepEqual(boundary.capabilityResolution?.allowedTools, ["search"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.allowedTools, ["search"]);
  assert.equal(boundary.capabilityResolution?.capabilityPlan.canExposeModelTools, true);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read_file")?.reason,
    "工具执行器当前未提供该工具。"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "write_file")?.reason,
    "工具已在配置中停用。"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "underground_probe")?.reason,
    "当前模式不可用。"
  );
  assert.equal(
    boundary.capabilityResolution?.warnings.some((warning) =>
      warning === "本轮有 1 个策略可见工具没有对应的工具执行器。"
    ),
    true
  );
});

test("run tool boundary stays empty before a run capability snapshot exists", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    goal: "no snapshot",
    taskSoil: createTaskSoil({ rawGoal: "no snapshot" }),
    toolCenter: executableToolBroker(["search"]),
  });

  assert.deepEqual(boundary.allowedTools, []);
  assert.equal(boundary.capabilityResolution, undefined);
});

function capabilitySnapshot(tools: readonly CapabilityToolCatalogItem[]): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "capability-snapshot-tool-boundary-test",
    createdAt: "2026-06-08T00:00:00.000Z",
    activeModel: {
      profileId: "default",
      label: "Default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.openai.com",
      model: "gpt-5.5",
      defaultAiMode: "openai-compatible",
      secretRef: "secret://local-dev/model-provider/default/api-key",
      enabled: true,
      secretConfigured: false,
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools,
      allowedTools: tools.filter((item) => item.enabled && item.availability === "available").map((item) => item.name),
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:/AgentArbor",
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    securitySummary: "Safe capability snapshot.",
    warnings: [],
  };
}

function tool(
  name: string,
  operationType: CapabilityToolCatalogItem["operationType"],
  overrides: Partial<CapabilityToolCatalogItem> = {}
): CapabilityToolCatalogItem {
  const metadata = {
    category: operationType === "execute" ? "terminal" as const : "workspace" as const,
    riskLevel: operationType === "read-only" ? "low" as const : "high" as const,
    operationType,
    requiresConfirmation: operationType !== "read-only",
    visibleResultPolicy: {
      userVisible: "safe-preview" as const,
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
  };
  const presentation = toolPresentationForName(name, metadata);
  return {
    name,
    displayName: presentation.displayName,
    displayDescription: presentation.displayDescription,
    description: `${name} tool`,
    category: metadata.category,
    categoryLabel: presentation.categoryLabel,
    riskLevel: metadata.riskLevel,
    riskLabel: presentation.riskLabel,
    operationType,
    operationLabel: presentation.operationLabel,
    requiresConfirmation: metadata.requiresConfirmation,
    confirmationLabel: presentation.confirmationLabel,
    visibleResultPolicy: metadata.visibleResultPolicy,
    scopes: defaultScopesFor(operationType),
    enabled: true,
    availability: "available",
    ...overrides,
  };
}

function defaultScopesFor(
  operationType: CapabilityToolCatalogItem["operationType"]
): readonly CapabilityToolScope[] {
  return operationType === "read-only"
    ? ["desktop-basic", "research"]
    : ["desktop-basic", "workspace"];
}

function executableToolBroker(names: readonly string[]): ToolExecutionBroker {
  return {
    list: () => names.map(toolDefinition),
    has: (name) => names.includes(name),
    execute: async (
      request: ToolCallRequest,
      _context: ToolExecutionContext,
      _permission: ToolPermissionCheck
    ): Promise<ToolCallResult> => ({
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {},
      status: "completed",
      durationMs: 0,
    }),
    resetCallCount: () => undefined,
    getCallCount: () => 0,
  };
}

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
    },
    metadata: {
      category: "workspace",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
      visibleResultPolicy: {
        userVisible: "summary-only",
        maxPreviewChars: 800,
        omitRawOutput: true,
      },
    },
  };
}
