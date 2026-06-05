import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentCapabilitySnapshot, CapabilityToolCatalogItem } from "../domain/config/index.js";
import { toolPresentationForName } from "../domain/tools/index.js";
import { createTaskSoil } from "../domain/soil/index.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { resolveRunCapabilities } from "./capability-policy.js";

test("run capability policy hides disabled, unavailable, denied, and mode-internal tools", () => {
  const snapshot = capabilitySnapshot([
    tool("search", "read-only"),
    tool("shell_command", "execute"),
    tool("browser_snapshot", "read-only", { availability: "unavailable" }),
    tool("write_file", "read-write", { enabled: false }),
    tool("underground_probe", "read-only"),
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

  assert.deepEqual(resolution.allowedTools, ["search"]);
  assert.equal(resolution.toolExposures.find((item) => item.name === "shell_command")?.modelVisible, false);
  assert.equal(resolution.toolExposures.find((item) => item.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(resolution.toolExposures.find((item) => item.name === "browser_snapshot")?.reason, "工具运行时当前不可用。");
  assert.equal(resolution.toolExposures.find((item) => item.name === "write_file")?.reason, "工具已在配置中停用。");
  assert.equal(resolution.toolExposures.find((item) => item.name === "underground_probe")?.modelVisible, false);
  assert.match(resolution.warnings.join("\n"), /隐藏/);
});

test("run capability policy keeps MCP as draft only and filters disabled skills", () => {
  const snapshot = capabilitySnapshot([tool("search", "read-only")], {
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
  assert.equal(resolution.mcpDrafts.length, 1);
  assert.equal(resolution.mcpDrafts[0]?.source, "mcp");
  assert.match(resolution.mcpDrafts[0]?.reason ?? "", /不执行 MCP tool/);
  const projected = JSON.stringify(resolution);
  assert.equal(projected.includes("sk-secret"), false);
  assert.equal(projected.includes("--token"), false);
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
        availability: "configured",
        commandSummary: "node server.js [args omitted]",
        envSecretRefCount: 1,
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
    enabled: true,
    availability: "available",
    ...overrides,
  };
}
