import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  CapabilityToolScope,
} from "../domain/config/index.js";
import { toolPresentationForName } from "../domain/tools/index.js";
import { createTaskSoil } from "../domain/soil/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { resolveRunCapabilities } from "./capability-policy.js";
import { restrictRunCapabilityResolutionToExecutableTools } from "./run-tool-boundary.js";

test("run capability policy hides disabled, unavailable, denied, and mode-internal tools", () => {
  const snapshot = capabilitySnapshot([
    tool("search", "read-only"),
    tool("shell_command", "execute"),
    tool("browser_snapshot", "read-only", { availability: "unavailable" }),
    tool("write_file", "read-write", { enabled: false }),
    tool("underground_probe", "read-only", { scopes: ["underground"] }),
    tool("mcp_docs_search", "external-submit", { scopes: ["mcp"], category: "mcp" }),
  ]);
  const taskSoil = createTaskSoil({
    rawGoal: "research safely",
    permissionBoundaryRefs: ["deny:tool:shell_command"],
  });

  const resolution = resolveRunCapabilities({
    snapshot,
    goal: "research safely",
    agentDefinition: DESKTOP_ROOT_AGENT,
    taskSoil,
    platform: "win32",
  });

  assert.equal(resolution.agentId, DESKTOP_ROOT_AGENT.agentId);
  assert.equal(resolution.agentDisplayName, DESKTOP_ROOT_AGENT.displayName);
  assert.equal(resolution.toolVisibilityProfileId, DESKTOP_ROOT_AGENT.toolVisibilityProfile.profileId);
  assert.deepEqual(resolution.allowedTools, ["search", "mcp_docs_search"]);
  assert.equal(resolution.toolExposures.find((item) => item.name === "shell_command")?.modelVisible, false);
  assert.equal(resolution.toolExposures.find((item) => item.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(resolution.toolExposures.find((item) => item.name === "browser_snapshot")?.reason, "当前不可用。");
  assert.equal(resolution.toolExposures.find((item) => item.name === "write_file")?.reason, "工具已在配置中停用。");
  assert.equal(resolution.toolExposures.find((item) => item.name === "underground_probe")?.modelVisible, false);
  assert.equal(resolution.toolExposures.find((item) => item.name === "mcp_docs_search")?.modelVisible, true);
  assert.match(resolution.warnings.join("\n"), /隐藏/);
});

test("run capability policy hides every tool when the model cannot call tools", () => {
  const snapshot = capabilitySnapshot([
    tool("search", "read-only"),
  ]);

  const resolution = resolveRunCapabilities({
    snapshot,
    goal: "answer without tools",
    agentDefinition: DESKTOP_ROOT_AGENT,
    modelSupportsToolCalling: false,
  });

  assert.deepEqual(resolution.allowedTools, []);
  assert.equal(resolution.toolExposures[0]?.modelVisible, false);
  assert.equal(resolution.toolExposures[0]?.reason, "当前模型不支持工具调用。");
  assert.match(resolution.warnings.join("\n"), /本轮没有可用工具/);
});

test("run capability policy never expands beyond snapshot allowed tools", () => {
  const baseSnapshot = capabilitySnapshot([
    tool("search", "read-only"),
    tool("read_file", "read-only"),
  ]);
  const snapshot = {
    ...baseSnapshot,
    toolCatalog: {
      ...baseSnapshot.toolCatalog,
      allowedTools: ["search"],
    },
  };

  const resolution = resolveRunCapabilities({
    snapshot,
    goal: "read safely",
    agentDefinition: DESKTOP_ROOT_AGENT,
  });

  assert.deepEqual(resolution.allowedTools, ["search"]);
  assert.equal(resolution.toolExposures.find((item) => item.name === "read_file")?.modelVisible, false);
  assert.equal(
    resolution.toolExposures.find((item) => item.name === "read_file")?.reason,
    "不在本轮可用范围内。"
  );
});

test("executable restriction only counts tools that were model-visible before execution pruning", () => {
  const resolution = resolveRunCapabilities({
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read_file", "read-only"),
      tool("write_file", "read-write", { enabled: false }),
      tool("underground_probe", "read-only", { scopes: ["underground"] }),
    ]),
    goal: "inspect executable boundary",
    agentDefinition: DESKTOP_ROOT_AGENT,
  });

  const restricted = restrictRunCapabilityResolutionToExecutableTools(resolution, undefined);

  assert.deepEqual(resolution.allowedTools, ["search", "read_file"]);
  assert.deepEqual(restricted.allowedTools, []);
  assert.equal(restricted.toolExposures.find((item) => item.name === "search")?.reason, "本轮没有可执行的工具运行器。");
  assert.equal(restricted.toolExposures.find((item) => item.name === "read_file")?.reason, "本轮没有可执行的工具运行器。");
  assert.equal(restricted.toolExposures.find((item) => item.name === "write_file")?.reason, "工具已在配置中停用。");
  assert.equal(restricted.toolExposures.find((item) => item.name === "underground_probe")?.reason, "当前模式不可用。");
  assert.equal(
    restricted.warnings.some((warning) => warning === "本轮有 2 个策略可见工具没有对应的工具执行器。"),
    true
  );
  assert.equal(
    restricted.warnings.some((warning) => warning.includes("4 个策略可见工具")),
    false
  );
});

test("run capability policy exposes MCP by default while filtering disabled skills", () => {
  const mcpTool = tool("docs__lookup", "read-only", { scopes: ["mcp"], category: "mcp" });
  const snapshot = capabilitySnapshot([tool("search", "read-only"), mcpTool], {
    skillCatalog: [
      {
        id: "enabled-skill",
        name: "Enabled Skill",
        description: "A real skill.",
        enabled: true,
        sourcePath: "Z:/AgentArbor/.agents/skills/enabled/SKILL.md",
        triggers: ["enabled"],
      },
      {
        id: "disabled-skill",
        name: "Disabled Skill",
        description: "Disabled.",
        enabled: false,
        sourcePath: "Z:/AgentArbor/.agents/skills/disabled/SKILL.md",
        triggers: ["disabled"],
      },
    ],
  });

  const resolution = resolveRunCapabilities({
    snapshot,
    goal: "use skills",
    agentDefinition: DESKTOP_ROOT_AGENT,
    platform: "linux",
  });

  assert.deepEqual(resolution.enabledSkills.map((skill) => skill.id), ["enabled-skill"]);
  assert.equal("sourcePath" in (resolution.enabledSkills[0] as Record<string, unknown>), false);
  assert.deepEqual(resolution.allowedTools, ["search", "docs__lookup"]);
  assert.equal(resolution.toolExposures.find((tool) => tool.name === "docs__lookup")?.modelVisible, true);
  assert.equal(resolution.mcpDrafts.length, 1);
  assert.equal(resolution.mcpDrafts[0]?.source, "mcp");
  assert.equal(resolution.mcpDrafts[0]?.reason, "已登记。");
  const projected = JSON.stringify(resolution);
  assert.equal(projected.includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
  assert.equal(projected.includes("sk-secret"), false);
  assert.equal(projected.includes("--token"), false);
});

test("run capability policy hides MCP tools when an AgentDefinition hides mcp scope", () => {
  const snapshot = capabilitySnapshot([
    tool("search", "read-only"),
    tool("docs__lookup", "read-only", { scopes: ["mcp"], category: "mcp" }),
  ]);
  const noMcpAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "no-mcp-test-agent",
    displayName: "No MCP Test Agent",
    toolVisibilityProfile: {
      profileId: "no-mcp-test-agent:no-mcp:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic", "workspace", "research"],
      hiddenToolScopes: ["mcp"],
    },
  };

  const resolution = resolveRunCapabilities({
    snapshot,
    goal: "lookup docs",
    agentDefinition: noMcpAgent,
  });

  assert.deepEqual(resolution.allowedTools, ["search"]);
  assert.equal(resolution.toolExposures.find((tool) => tool.name === "docs__lookup")?.modelVisible, false);
  assert.equal(resolution.toolExposures.find((tool) => tool.name === "search")?.modelVisible, true);
});

function capabilitySnapshot(
  tools: readonly CapabilityToolCatalogItem[],
  overrides: Partial<Pick<BasicAgentCapabilitySnapshot, "skillCatalog">> = {}
): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "capability-snapshot-test",
    createdAt: "2026-05-13T00:00:00.000Z",
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
      updatedAt: "2026-05-13T00:00:00.000Z",
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
    skillCatalog: overrides.skillCatalog ?? [],
    mcpCatalog: [
      {
        serverId: "docs",
        label: "Docs MCP",
        transport: "stdio",
        enabled: true,
        confirmationMode: "always",
        availability: "configured",
        commandSummary: "node server.js [args omitted]",
        envSecretRefCount: 1,
        authSecretRefCount: 0,
        toolExposureMode: "all",
        enabledTools: [],
        tools: tools.filter((tool) => tool.scopes.includes("mcp")),
        exposedTools: tools.filter((tool) => tool.scopes.includes("mcp")),
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ],
    workspace: {
      workspaceDirectory: "Z:/AgentArbor",
      updatedAt: "2026-05-13T00:00:00.000Z",
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
  const presentation = toolPresentationForName(name, {
    category: operationType === "execute" ? "terminal" : "workspace",
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
    category: operationType === "execute" ? "terminal" : "workspace",
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
