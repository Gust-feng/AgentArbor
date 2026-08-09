import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityMcpCatalogItem,
  CapabilityMcpToolCatalogItem,
  CapabilitySubAgentCatalogItem,
  CapabilityToolCatalogItem,
  CapabilityToolScope,
} from "../../domain/config/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import {
  toolPresentationForName,
  type ToolInputSchema,
  type ToolJsonSchema,
} from "../../domain/tools/index.js";
import { createTaskSoil } from "../../domain/soil/index.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { toolDefinitionContractHash } from "./tool-definition-contract.js";
import { resolveRunToolBoundary } from "./run-tool-boundary.js";

test("run tool boundary intersects policy-visible tools with executable tools", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read", "read-only"),
      tool("write", "read-write", { enabled: false }),
      tool("underground_probe", "read-only", { scopes: ["underground"] }),
    ]),
    goal: "inspect tools",
    taskSoil: createTaskSoil({ rawGoal: "inspect tools" }),
    toolCenter: executableToolBroker(["search"]),
  });

  assert.deepEqual(boundary.allowedTools, ["search"]);
  assert.deepEqual(boundary.toolDefinitions.map((tool) => tool.name), ["search"]);
  assert.equal(boundary.toolDefinitions[0]?.inputSchema.properties.query !== undefined, true);
  assert.equal(boundary.toolDefinitions[0]?.description, "search tool");
  assert.deepEqual(boundary.capabilityResolution?.allowedTools, ["search"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.allowedTools, ["search"]);
  assert.equal(boundary.capabilityResolution?.capabilityPlan.canExposeModelTools, true);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read")?.reason,
    "工具执行器当前未提供该工具。"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "write")?.reason,
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

test("run tool boundary keeps MCP execution permission while deferring its model definition", () => {
  const mcpDefinition: ToolDefinition = {
    name: "docs__lookup",
    description: "Look up frozen documentation.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    metadata: {
      category: "mcp",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
  const definitionHash = toolDefinitionContractHash(mcpDefinition);
  assert.notEqual(definitionHash, undefined);
  const mcpCatalogTool: CapabilityMcpToolCatalogItem = {
    ...tool(mcpDefinition.name, "read-only", {
      description: mcpDefinition.description,
      inputSchema: mcpDefinition.inputSchema,
      outputSchema: mcpDefinition.outputSchema,
      category: "mcp",
      scopes: ["mcp"],
      definitionHash,
    }),
    protocolName: "lookup",
  };
  const snapshot = capabilitySnapshot(
    [tool("read", "read-only"), mcpCatalogTool],
    ["read", mcpCatalogTool.name],
    [],
    [mcpServerCatalog([mcpCatalogTool])],
  );
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot,
    goal: "read local and remote documentation",
    taskSoil: createTaskSoil({ rawGoal: "read local and remote documentation" }),
    toolCenter: executableToolBrokerFromDefinitions([
      toolDefinition("read"),
      mcpDefinition,
    ]),
    toolDefinitionTokenCounter: progressiveCounter(mcpDefinition.name),
  });

  assert.deepEqual(boundary.allowedTools, ["read", mcpCatalogTool.name]);
  assert.deepEqual(boundary.toolDefinitions.map((definition) => definition.name), [
    "read",
    mcpCatalogTool.name,
  ]);
  assert.deepEqual(boundary.toolVisibilityPlan?.initiallyVisibleToolNames, ["read"]);
  assert.deepEqual(boundary.toolVisibilityPlan?.deferredTools, [{
    name: mcpCatalogTool.name,
    displayName: mcpCatalogTool.displayName,
    description: mcpCatalogTool.description,
    source: { kind: "mcp", id: "docs", label: "Documentation" },
    definitionHash,
  }]);
  assert.equal(boundary.toolVisibilityPlan?.controls.search.name, "McpSearch");
  assert.equal(boundary.toolVisibilityPlan?.controls.load.name, "McpLoad");
});

test("run tool boundary omits progressive controls when no eligible MCP tool remains", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([tool("read", "read-only")]),
    goal: "read one file",
    taskSoil: createTaskSoil({ rawGoal: "read one file" }),
    toolCenter: executableToolBroker(["read"]),
  });

  assert.equal(boundary.toolVisibilityPlan, undefined);
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

test("run tool boundary hides executable tools when frozen definition hash drifts", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("read", "read-only", { definitionHash: "sha256:old-read-file-contract" }),
    ]),
    goal: "inspect old run",
    taskSoil: createTaskSoil({ rawGoal: "inspect old run" }),
    toolCenter: executableToolBroker(["read"]),
  });

  assert.deepEqual(boundary.allowedTools, []);
  assert.deepEqual(boundary.toolDefinitions, []);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "read")?.reasonCode,
    "tool_contract_mismatch"
  );
  assert.equal(
    boundary.capabilityResolution?.warnings.some((warning) =>
      warning === "本轮有 1 个工具执行契约与冻结快照不一致，已隐藏。"
    ),
    true
  );
});

test("run tool boundary restores complete frozen input and output JSON Schema", () => {
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["fast", "safe"] },
      target: { $ref: "#/$defs/target" },
      retries: { type: "integer", minimum: 0, maximum: 3 },
      slug: { type: "string", pattern: "^[a-z]+$" },
      operation: { const: "lookup" },
    },
    required: ["mode", "target"],
    additionalProperties: { type: "string" },
    $defs: {
      target: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    oneOf: [
      { required: ["mode"] },
      { properties: { mode: { const: "safe" } } },
    ],
    dependentRequired: { mode: ["target"] },
  };
  const outputSchema: ToolJsonSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: { $ref: "#/$defs/result" },
      },
    },
    required: ["results"],
    $defs: {
      result: {
        type: "object",
        properties: { score: { type: "number", minimum: 0, maximum: 1 } },
        required: ["score"],
      },
    },
  };
  const catalogTool = tool("search", "read-only", { inputSchema, outputSchema });
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([catalogTool]),
    goal: "restore schema",
    taskSoil: createTaskSoil({ rawGoal: "restore schema" }),
    toolCenter: executableToolBrokerFromDefinitions([toolDefinitionFromCatalogItem(catalogTool)]),
  });

  assert.deepEqual(boundary.toolDefinitions[0]?.inputSchema, inputSchema);
  assert.deepEqual(boundary.toolDefinitions[0]?.outputSchema, outputSchema);
});

test("tool contract hash changes for every material JSON Schema constraint", () => {
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["fast", "safe"] },
      kind: { const: "lookup" },
      retries: { type: "integer", minimum: 0, maximum: 3 },
    },
  };
  const outputSchema: ToolJsonSchema = {
    type: "object",
    properties: { result: { type: "string" } },
  };
  const definition = (input: ToolInputSchema, output: ToolJsonSchema): ToolDefinition => ({
    name: "schema_hash_tool",
    description: "Schema hash fixture.",
    inputSchema: input,
    outputSchema: output,
    metadata: {
      category: "other",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  });
  const baseline = toolDefinitionContractHash(definition(inputSchema, outputSchema));
  const enumChanged = toolDefinitionContractHash(definition({
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      mode: { type: "string", enum: ["fast", "safe", "thorough"] },
    },
  }, outputSchema));
  const constChanged = toolDefinitionContractHash(definition({
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      kind: { const: "search" },
    },
  }, outputSchema));
  const boundsChanged = toolDefinitionContractHash(definition({
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      retries: { type: "integer", minimum: 0, maximum: 4 },
    },
  }, outputSchema));
  const outputChanged = toolDefinitionContractHash(definition(inputSchema, {
    ...outputSchema,
    properties: { result: { type: "number" } },
  }));
  const descriptionChanged = toolDefinitionContractHash({
    ...definition(inputSchema, outputSchema),
    description: "Changed provider-visible contract.",
  });

  assert.equal(typeof baseline, "string");
  assert.notEqual(enumChanged, baseline);
  assert.notEqual(constChanged, baseline);
  assert.notEqual(boundsChanged, baseline);
  assert.notEqual(outputChanged, baseline);
  assert.notEqual(descriptionChanged, baseline);
});

test("tool contract hash includes execution identity and runtime hints", () => {
  const definition = (runtimeHints: NonNullable<ToolDefinition["metadata"]>["runtimeHints"]): ToolDefinition => ({
    name: "identity_hash_tool",
    description: "Execution identity fixture.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    metadata: {
      category: "other",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
      runtimeHints,
    },
  });
  const baseline = toolDefinitionContractHash(definition([{
    kind: "mcp_tool",
    serverId: "docs",
    protocolName: "send-email",
  }]));
  const protocolChanged = toolDefinitionContractHash(definition([{
    kind: "mcp_tool",
    serverId: "docs",
    protocolName: "send_email",
  }]));
  const shellChanged = toolDefinitionContractHash(definition([{
    kind: "command_shell",
    shellId: "powershell",
    label: "PowerShell",
    executable: "pwsh",
    syntax: "powershell",
    platform: "win32",
    invocation: ["-NoProfile", "-Command"],
    commandLineParameter: "commandLine",
    notes: [],
  }]));
  assert.equal(typeof baseline, "string");
  assert.notEqual(protocolChanged, baseline);
  assert.notEqual(shellChanged, baseline);
});

test("run tool boundary audits selected skill allowed-tools without hiding normal run tools", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read", "read-only"),
      tool("write", "read-write"),
    ]),
    goal: "use skill-restricted tools",
    taskSoil: createTaskSoil({ rawGoal: "use skill-restricted tools" }),
    toolCenter: executableToolBroker(["search", "read", "write"]),
    skillContexts: [
      skillContext("repo-review", { allowedTools: ["read", "missing_tool"] }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read", "write"]);
  assert.deepEqual(boundary.capabilityResolution?.allowedTools, ["search", "read", "write"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.allowedTools, ["search", "read", "write"]);
  assert.deepEqual(boundary.capabilityResolution?.capabilityPlan.tools?.allowedTools, ["search", "read", "write"]);
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
      tool("read", "read-only"),
      tool("write", "read-write"),
      tool("shell", "execute"),
    ]),
    goal: "use two restricted skills",
    taskSoil: createTaskSoil({ rawGoal: "use two restricted skills" }),
    toolCenter: executableToolBroker(["search", "read", "write", "shell"]),
    skillContexts: [
      skillContext("repo-review", { allowedTools: ["read", "shell"] }),
      skillContext("research", { allowedTools: ["search", "missing_tool"] }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read", "write", "shell"]);
  assert.equal(boundary.capabilityResolution?.toolExposures.find((item) => item.name === "write")?.modelVisible, true);
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
      tool("read", "read-only"),
    ]),
    goal: "use unrestricted skill",
    taskSoil: createTaskSoil({ rawGoal: "use unrestricted skill" }),
    toolCenter: executableToolBroker(["search", "read"]),
    skillContexts: [skillContext("unrestricted")],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read"]);
});

test("run tool boundary ignores failed or omitted skill contexts for tool restriction", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("read", "read-only"),
    ]),
    goal: "failed skill",
    taskSoil: createTaskSoil({ rawGoal: "failed skill" }),
    toolCenter: executableToolBroker(["search", "read"]),
    skillContexts: [
      skillContext("failed", { allowedTools: ["read"], loadStatus: "failed" }),
      skillContext("omitted", { allowedTools: ["read"], omitted: true }),
    ],
  });

  assert.deepEqual(boundary.allowedTools, ["search", "read"]);
});

test("run tool boundary hides SkillRead when no selected skill resource is readable", () => {
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("SkillRead", "read-only"),
    ]),
    goal: "use skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use skill resources" }),
    toolCenter: executableToolBroker(["search", "SkillRead"]),
    skillContexts: [skillContext("repo-review")],
  });

  assert.deepEqual(boundary.allowedTools, ["search"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.modelVisible,
    false
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.reason,
    "当前没有已选中且可读的技能资源。"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.reasonCode,
    "selected_skill_resources_unavailable"
  );
  assert.equal(
    boundary.capabilityResolution?.warnings.includes("当前没有已选中且可读的技能资源，已隐藏 skill_read。"),
    true
  );
});

test("run tool boundary keeps SkillRead when selected skills expose readable resources", () => {
  const selectedSkill = skillContext("repo-review");
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot([
      tool("search", "read-only"),
      tool("SkillRead", "read-only"),
    ]),
    goal: "use skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use skill resources" }),
    toolCenter: executableToolBroker(["search", "SkillRead"]),
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

  assert.deepEqual(boundary.allowedTools, ["search", "SkillRead"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.modelVisible,
    true
  );
});

test("run tool boundary can activate latent SkillRead after skill selection", () => {
  const selectedSkill = skillContext("repo-review");
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot(
      [
        tool("search", "read-only"),
        tool("SkillRead", "read-only"),
      ],
      ["search"]
    ),
    goal: "use selected skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use selected skill resources" }),
    toolCenter: executableToolBroker(["search", "SkillRead"]),
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

  assert.deepEqual(boundary.allowedTools, ["search", "SkillRead"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.reason,
    "当前已选中技能提供可读资源。"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.reasonCode,
    "selected_skill_resources_available"
  );
  assert.equal(boundary.capabilityResolution?.warnings.includes("已隐藏 1 个不可用工具。"), false);
});

test("run tool boundary rejects a drifted latent SkillRead executor", () => {
  const selectedSkill = skillContext("repo-review");
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot: capabilitySnapshot(
      [tool("search", "read-only"), tool("SkillRead", "read-only")],
      ["search"],
    ),
    goal: "use selected skill resources",
    taskSoil: createTaskSoil({ rawGoal: "use selected skill resources" }),
    toolCenter: executableToolBrokerFromDefinitions([
      toolDefinition("search"),
      { ...toolDefinition("SkillRead"), description: "Drifted skill resource executor." },
    ]),
    skillContexts: [{
      ...selectedSkill,
      skill: {
        ...selectedSkill.skill,
        resourceIndex: [{ type: "reference", relativePath: "references/checklist.md", exists: true }],
      },
    }],
  });

  assert.deepEqual(boundary.allowedTools, ["search"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "SkillRead")?.reasonCode,
    "tool_contract_mismatch",
  );
});

test("run tool boundary exposes implemented Pi AgentTools without requiring ToolCenter executors", () => {
  const callAgentTool = {
    ...toolDefinition("Agent"),
    description: "Call a frozen project-helper specialist.",
    inputSchema: {
      type: "object" as const,
      properties: { sub_agent_name: { type: "string", enum: ["project-helper"] } },
      required: ["sub_agent_name"],
      additionalProperties: false,
    },
  };
  const frozenCallAgentTool = tool("Agent", "read-write", {
    description: callAgentTool.description,
    inputSchema: callAgentTool.inputSchema,
    definitionHash: toolDefinitionContractHash(callAgentTool),
  });
  const snapshot = capabilitySnapshot(
    [frozenCallAgentTool],
    ["Agent"],
    [
      subAgentCatalogItem("project-helper", {
        description: "Project-specific helper from the frozen run catalog.",
        category: "project",
        allowedTools: ["read"],
        whenToUse: ["Use for project-specific inspection."],
      }),
      subAgentCatalogItem("code-expert", { enabled: false }),
    ],
  );
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot,
    subAgentCatalog: snapshot.subAgentCatalog,
    goal: "use frozen sub-agent catalog",
    taskSoil: createTaskSoil({ rawGoal: "use frozen sub-agent catalog" }),
    agentToolDefinitions: [callAgentTool],
  });

  assert.deepEqual(boundary.allowedTools, []);
  assert.deepEqual(boundary.allowedAgentToolNames, ["Agent"]);
  assert.equal(boundary.toolDefinitions[0]?.name, "Agent");
  assert.equal(boundary.toolDefinitions[0]?.description, frozenCallAgentTool.description);
  assert.deepEqual(boundary.toolDefinitions[0]?.inputSchema, frozenCallAgentTool.inputSchema);
});

test("run tool boundary hides preset sub-agent call tools when no enabled sub-agents exist", () => {
  const snapshot = capabilitySnapshot(
    [
      tool("Agent", "read-write"),
      tool("AgentSpawn", "read-write"),
    ],
    ["Agent", "AgentSpawn"],
    [subAgentCatalogItem("disabled-helper", { enabled: false })],
  );
  const boundary = resolveRunToolBoundary({
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot,
    subAgentCatalog: snapshot.subAgentCatalog,
    goal: "use sub-agent tools",
    taskSoil: createTaskSoil({ rawGoal: "use sub-agent tools" }),
    agentToolDefinitions: [toolDefinition("Agent"), toolDefinition("AgentSpawn")],
  });

  assert.deepEqual(boundary.allowedTools, []);
  assert.deepEqual(boundary.allowedAgentToolNames, ["AgentSpawn"]);
  assert.deepEqual(boundary.toolDefinitions.map((definition) => definition.name), ["AgentSpawn"]);
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "Agent")?.reasonCode,
    "no_enabled_sub_agents"
  );
  assert.equal(
    boundary.capabilityResolution?.toolExposures.find((item) => item.name === "AgentSpawn")?.modelVisible,
    true
  );
});

test("run tool boundary applies permissions, profile, model, snapshot, and implementation gates to Pi AgentTools", () => {
  const agentTools = [toolDefinition("Agent"), toolDefinition("AgentSpawn")];
  const snapshot = capabilitySnapshot(
    [tool("Agent", "read-write"), tool("AgentSpawn", "read-write")],
    ["Agent", "AgentSpawn"],
    [subAgentCatalogItem("reviewer")],
  );
  const base = {
    agentDefinition: DESKTOP_ROOT_AGENT,
    snapshot,
    subAgentCatalog: snapshot.subAgentCatalog,
    goal: "delegate",
    taskSoil: createTaskSoil({ rawGoal: "delegate" }),
    agentToolDefinitions: agentTools,
  };

  assert.deepEqual(resolveRunToolBoundary(base).allowedAgentToolNames, [
    "Agent",
    "AgentSpawn",
  ]);
  assert.deepEqual(resolveRunToolBoundary({
    ...base,
    taskSoil: createTaskSoil({
      rawGoal: "delegate",
      permissionBoundaryRefs: ["deny:tool:AgentSpawn"],
    }),
  }).allowedAgentToolNames, ["Agent"]);
  assert.deepEqual(resolveRunToolBoundary({
    ...base,
    agentDefinition: {
      ...DESKTOP_ROOT_AGENT,
      toolVisibilityProfile: {
        ...DESKTOP_ROOT_AGENT.toolVisibilityProfile,
        hiddenToolNames: ["Agent", "AgentSpawn"],
      },
    },
  }).allowedAgentToolNames, []);
  assert.deepEqual(resolveRunToolBoundary({
    ...base,
    modelCapabilities: {
      ...snapshot.modelCapabilities,
      supportsToolCalling: false,
      supportsParallelToolCalls: false,
    },
  }).allowedAgentToolNames, []);
  assert.deepEqual(resolveRunToolBoundary({
    ...base,
    snapshot: capabilitySnapshot([], [], [subAgentCatalogItem("reviewer")]),
  }).allowedAgentToolNames, []);
  assert.deepEqual(resolveRunToolBoundary({
    ...base,
    agentToolDefinitions: [],
  }).allowedAgentToolNames, []);
});

function capabilitySnapshot(
  tools: readonly CapabilityToolCatalogItem[],
  allowedTools: readonly string[] = tools.filter((item) => item.enabled && item.availability === "available").map((item) => item.name),
  subAgentCatalog: readonly CapabilitySubAgentCatalogItem[] = [],
  mcpCatalog: readonly CapabilityMcpCatalogItem[] = [],
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
    subAgentCatalog,
    mcpCatalog,
    executionRoot: "Z:/AgentArbor",
    securitySummary: "Safe capability snapshot.",
    warnings: [],
  };
}

function mcpServerCatalog(
  exposedTools: readonly CapabilityMcpToolCatalogItem[]
): CapabilityMcpCatalogItem {
  return {
    serverId: "docs",
    label: "Documentation",
    transport: "stdio",
    enabled: true,
    confirmationMode: "unsafe_only",
    availability: "configured",
    runtimeStatus: "configured",
    envSecretRefCount: 0,
    authSecretRefCount: 0,
    toolExposureMode: "all",
    enabledTools: exposedTools.map((tool) => tool.protocolName),
    autoApprovedTools: [],
    tools: exposedTools,
    exposedTools,
    updatedAt: "2026-06-08T00:00:00.000Z",
  };
}

function subAgentCatalogItem(
  name: string,
  overrides: Partial<CapabilitySubAgentCatalogItem> = {}
): CapabilitySubAgentCatalogItem {
  return {
    id: name,
    name,
    description: `${name} test sub-agent`,
    category: "test",
    sourceKind: "project",
    sourceRootId: "project",
    sourcePrecedence: 100,
    enabled: true,
    version: "1.0.0",
    whenToUse: [],
    whenNotToUse: [],
    allowedTools: [],
    contentHash: `sha256:${name}:content`,
    bodyHash: `sha256:${name}:body`,
    ...overrides,
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
    category: name === "SkillRead"
      ? "other" as const
      : operationType === "execute"
        ? "terminal" as const
        : "workspace" as const,
    riskLevel: operationType === "read-only" ? "low" as const : "high" as const,
    operationType,
    requiresConfirmation: operationType !== "read-only",
  };
  const presentation = toolPresentationForName(name, metadata);
  const item = {
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
    scopes: defaultScopesFor(operationType),
    enabled: true,
    availability: "available" as const,
    ...overrides,
    inputSchema: overrides.inputSchema ?? {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    definitionHash: overrides.definitionHash ?? `sha256:${"0".repeat(64)}`,
  };
  return {
    ...item,
    definitionHash: overrides.definitionHash ?? requiredDefinitionHash(toolDefinitionFromCatalogItem(item)),
  };
}

function requiredDefinitionHash(definition: ToolDefinition): string {
  const hash = toolDefinitionContractHash(definition);
  if (hash === undefined) throw new Error(`Missing hash for ${definition.name}`);
  return hash;
}

function defaultScopesFor(
  operationType: CapabilityToolCatalogItem["operationType"]
): readonly CapabilityToolScope[] {
  return operationType === "read-only"
    ? ["desktop-basic", "research"]
    : ["desktop-basic", "workspace"];
}

function executableToolBroker(names: readonly string[]): ToolExecutionBroker {
  return executableToolBrokerFromDefinitions(names.map(toolDefinition));
}

function executableToolBrokerFromDefinitions(
  definitions: readonly ToolDefinition[]
): ToolExecutionBroker {
  return {
    list: () => [...definitions],
    has: (name) => definitions.some((definition) => definition.name === name),
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
  };
}

function toolDefinition(name: string): ToolDefinition {
  const operationType = fixtureOperationType(name);
  const category = name === "SkillRead"
    ? "other" as const
    : operationType === "execute"
      ? "terminal" as const
      : "workspace" as const;
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    metadata: {
      category,
      riskLevel: operationType === "read-only" ? "low" : "high",
      operationType,
      requiresConfirmation: operationType !== "read-only",
    },
  };
}

function toolDefinitionFromCatalogItem(tool: CapabilityToolCatalogItem): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    metadata: {
      category: tool.category,
      riskLevel: tool.riskLevel,
      operationType: tool.operationType,
      fileOperation: tool.fileOperation,
      requiresConfirmation: tool.requiresConfirmation,
      runtimeHints: tool.runtimeHints,
    },
  };
}

function fixtureOperationType(name: string): CapabilityToolCatalogItem["operationType"] {
  if (name === "shell") return "execute";
  if (name === "write" || name === "Agent" || name === "AgentSpawn") {
    return "read-write";
  }
  return "read-only";
}

function progressiveCounter(...expensiveToolNames: readonly string[]): (serialized: string) => number {
  return (serialized) => serialized.length +
    expensiveToolNames.filter((name) => serialized.includes(`\"name\":\"${name}\"`)).length * 20_000;
}
