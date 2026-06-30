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

test("run tool boundary audits selected skill allowed-tools without hiding normal run tools", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
      tool("write_file", "read-write"),
    ]),
    goal: "use skill-restricted tools",
    taskSoil: createTaskSoil({ rawGoal: "use skill-restricted tools" }),
    toolCenter: executableToolBroker(["search", "read_file", "write_file"]),
    skillContexts: [
      skillContext("repo-review", { allowedTools: ["read_file", "missing_tool"] }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_file", "write_file"]);
  assert.deepEqual(boundary.capabilityResolution?.allowedTools, ["search", "read_file", "write_file"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.allowedTools, ["search", "read_file", "write_file"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.tools?.allowedTools, ["search", "read_file", "write_file"]);
  assert.equal(boundary.capabilityResolution?.capabilityPlan.fileOperations?.canWriteWorkspace, true);
  assert.equal(boundary.capabilityResolution?.toolExposures.find((item) => item.name === "search")?.modelVisible, true);
  assert.equal(
    boundary.capabilityResolution?.warnings.some((warning) =>
      warning === "选中技能声明了 1 个当前运行不可用工具。"
    ),
    true
  );
});

test("run tool boundary uses the union of multiple selected skill allowed-tools without expanding policy", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
      tool("write_file", "read-write"),
      tool("shell_command", "execute"),
    ]),
    goal: "use two restricted skills",
    taskSoil: createTaskSoil({ rawGoal: "use two restricted skills" }),
    toolCenter: executableToolBroker(["search", "read_file", "write_file", "shell_command"]),
    skillContexts: [
      skillContext("repo-review", { allowedTools: ["read_file", "shell_command"] }),
      skillContext("research", { allowedTools: ["search", "missing_tool"] }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_file", "write_file", "shell_command"]);
  assert.equal(boundary.capabilityResolution?.toolExposures.find((item) => item.name === "write_file")?.modelVisible, true);
  assert.equal(
    boundary.capabilityResolution?.warnings.some((warning) =>
      warning === "选中技能声明了 1 个当前运行不可用工具。"
    ),
    true
  );
});

test("run tool boundary does not restrict tools when selected skills do not declare allowed-tools", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
    ]),
    goal: "use unrestricted skill",
    taskSoil: createTaskSoil({ rawGoal: "use unrestricted skill" }),
    toolCenter: executableToolBroker(["search", "read_file"]),
    skillContexts: [skillContext("unrestricted")],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_file"]);
});

test("run tool boundary ignores failed or omitted skill contexts for tool restriction", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
    ]),
    goal: "failed skill",
    taskSoil: createTaskSoil({ rawGoal: "failed skill" }),
    toolCenter: executableToolBroker(["search", "read_file"]),
    skillContexts: [
      skillContext("failed", { allowedTools: ["read_file"], loadStatus: "failed" }),
      skillContext("omitted", { allowedTools: ["read_file"], omitted: true }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_file"]);
});

test("run tool boundary hides read_skill_resource when no selected skill resource is readable", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_skill_resource", "read-only"),
    ]),
    goal: "use skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use skill resources" }),
    toolCenter: executableToolBroker(["search", "read_skill_resource"]),
    skillContexts: [skillContext("repo-review")],
  });

  assert.deepEqual(boundary.allowedTools, ["search"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read_skill_resource")?.modelVisible,
    false
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read_skill_resource")?.reason,
    "当前没有已选中且可读的技能资源。"
  );
  assert.equal(
    boundary.capabilityResolution?.warnings.includes("当前没有已选中且可读的技能资源，已隐藏 read_skill_resource。"),
    true
  );
});

test("run tool boundary keeps read_skill_resource when selected skills expose readable resources", () => {
  const selectedSkill = skillContext("repo-review");
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_skill_resource", "read-only"),
    ]),
    goal: "use skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use skill resources" }),
    toolCenter: executableToolBroker(["search", "read_skill_resource"]),
    skillContexts: [{
      ...selectedSkill,
      skill: {
        ...selectedSkill.skill,
        resourceIndex: [{
          type: "reference",
          relativePath: "references/checklist.md",
          exists: true,
          contentHash: "sha256:checklist",
        }],
      },
    }],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_skill_resource"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read_skill_resource")?.modelVisible,
    true
  );
});

test("run tool boundary can activate latent read_skill_resource after skill selection", () => {
  const selectedSkill = skillContext("repo-review");
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot(
      [
        tool("search", "read-only"),
        tool("read_skill_resource", "read-only"),
      ],
      ["search"]
    ),
    goal: "use selected skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use selected skill resources" }),
    toolCenter: executableToolBroker(["search", "read_skill_resource"]),
    skillContexts: [{
      ...selectedSkill,
      skill: {
        ...selectedSkill.skill,
        resourceIndex: [{
          type: "reference",
          relativePath: "references/checklist.md",
          exists: true,
        }],
      },
    }],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read_skill_resource"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read_skill_resource")?.reason,
    "当前已选中技能提供可读资源。"
  );
  assert.equal(boundary.capabilityResolution?.warnings.includes("已隐藏 1 个不可用工具。"), false);
});

function capabilitySnapshot(
  tools: readonly CapabilityToolCatalogItem[],
  allowedTools: readonly string[] = tools.filter((item) => item.enabled && item.availability === "available").map((item) => item.name)
): BasicAgentCapabilitySnapshot {
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
      allowedTools,
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:/AgentArbor",
      updatedAt: "2026-06-08T00:00:00.000Z",
    },
    securitySummary: "Safe capability snapshot.",
    warnings: [],
  };
}

function skillContext(
  id: string,
  overrides: {
    readonly allowedTools?: readonly string[];
    readonly loadStatus?: "loaded" | "failed";
    readonly omitted?: boolean;
  } = {}
) {
  return {
    skill: {
      id,
      name: id,
      description: `${id} skill`,
      enabled: true,
      sourcePath: `/skills/${id}/SKILL.md`,
      triggers: [],
      ...(overrides.allowedTools === undefined ? {} : { allowedTools: overrides.allowedTools }),
    },
    body: "Skill body.",
    triggerReason: "test",
    loadStatus: overrides.loadStatus ?? "loaded",
    omitted: overrides.omitted,
  };
}

function tool(
  name: string,
  operationType: CapabilityToolCatalogItem["operationType"],
  overrides: Partial<CapabilityToolCatalogItem> = {}
): CapabilityToolCatalogItem {
  const metadata = {
    category: name === "read_skill_resource"
      ? "other" as const
      : operationType === "execute"
        ? "terminal" as const
        : "workspace" as const,
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
