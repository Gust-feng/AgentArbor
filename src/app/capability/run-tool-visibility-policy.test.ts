import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentCapabilitySnapshot,
  CapabilityMcpCatalogItem,
  CapabilityMcpToolCatalogItem,
  CapabilityToolCatalogItem,
} from "../../domain/config/index.js";
import type { ToolDefinition, ToolJsonSchema } from "../../domain/tools/index.js";
import {
  LOAD_MCP_TOOLS_CONTROL_NAME,
  SEARCH_MCP_TOOLS_CONTROL_NAME,
  resolveMcpFirstToolVisibilityPlan,
} from "./run-tool-visibility-policy.js";

test("MCP-first visibility defers only final allowed definitions from exposedTools with hashes", () => {
  const builtin = catalogTool("read");
  const skill = catalogTool("skill_read");
  const agentTool = catalogTool("agent_call");
  const deferred = mcpTool("docs__lookup", { definitionHash: "sha256:docs-lookup" });
  const unexposed = mcpTool("docs__hidden", { definitionHash: "sha256:docs-hidden" });
  const denied = mcpTool("docs__denied", { definitionHash: "sha256:docs-denied" });
  const notFrozen = mcpTool("docs__not_frozen", { definitionHash: "sha256:docs-not-frozen" });
  const snapshot = capabilitySnapshot({
    tools: [builtin, skill, agentTool, deferred, unexposed, denied, notFrozen],
    mcpCatalog: [mcpServer({
      tools: [deferred, unexposed, denied, notFrozen],
      exposedTools: [deferred, denied, notFrozen],
    })],
  });
  const plan = resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: [
      builtin.name,
      skill.name,
      deferred.name,
      unexposed.name,
      notFrozen.name,
    ],
    allowedAgentToolNames: [agentTool.name],
    frozenDefinitions: [
      definition(builtin.name),
      definition(skill.name),
      definition(agentTool.name),
      definition(deferred.name),
      definition(unexposed.name),
    ],
    toolDefinitionTokenCounter: progressiveCounter(deferred.name),
  });

  assert.notEqual(plan, undefined);
  assert.equal(plan?.policyId, "mcp-progressive/v1");
  assert.equal(plan?.snapshotId, snapshot.snapshotId);
  assert.deepEqual(plan?.initiallyVisibleToolNames, [
    builtin.name,
    skill.name,
    agentTool.name,
    unexposed.name,
  ]);
  assert.deepEqual(plan?.deferredTools, [{
    name: deferred.name,
    displayName: deferred.displayName,
    description: definition(deferred.name).description,
    source: {
      kind: "mcp",
      id: "docs",
      label: "Documentation",
    },
    definitionHash: deferred.definitionHash,
  }]);
  assert.equal(plan?.deferredTools.some((tool) => tool.name === denied.name), false);
  assert.equal(plan?.deferredTools.some((tool) => tool.name === notFrozen.name), false);
});

test("MCP-first visibility keeps AgentTools direct even when an exposed MCP catalog reuses the name", () => {
  const conflictingCatalogEntry = mcpTool("agent_call", {
    definitionHash: "sha256:malformed-mcp-agent-tool",
  });
  const deferred = mcpTool("docs__lookup", { definitionHash: "sha256:docs-lookup" });
  const snapshot = capabilitySnapshot({
    tools: [conflictingCatalogEntry, deferred],
    mcpCatalog: [mcpServer({
      tools: [conflictingCatalogEntry, deferred],
      exposedTools: [conflictingCatalogEntry, deferred],
    })],
  });
  const plan = resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: [deferred.name],
    allowedAgentToolNames: [conflictingCatalogEntry.name],
    frozenDefinitions: [definition(conflictingCatalogEntry.name), definition(deferred.name)],
    toolDefinitionTokenCounter: progressiveCounter(deferred.name),
  });

  assert.deepEqual(plan?.initiallyVisibleToolNames, [conflictingCatalogEntry.name]);
  assert.deepEqual(plan?.deferredTools.map((tool) => tool.name), [deferred.name]);
});

test("MCP-first visibility omits the plan and controls when no eligible MCP definition is deferred", () => {
  const legacyMcp = mcpTool("docs__legacy");
  const snapshot = capabilitySnapshot({
    tools: [catalogTool("read"), legacyMcp],
    mcpCatalog: [mcpServer({ tools: [legacyMcp], exposedTools: [legacyMcp] })],
  });

  assert.equal(resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: ["read", legacyMcp.name],
    allowedAgentToolNames: [],
    frozenDefinitions: [definition("read"), definition(legacyMcp.name)],
  }), undefined);
});

test("MCP progressive controls expose bounded closed input and output schemas", () => {
  const deferred = mcpTool("docs__lookup", { definitionHash: "sha256:docs-lookup" });
  const snapshot = capabilitySnapshot({
    tools: [deferred],
    mcpCatalog: [mcpServer({ tools: [deferred], exposedTools: [deferred] })],
  });
  const plan = resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: [deferred.name],
    allowedAgentToolNames: [],
    frozenDefinitions: [definition(deferred.name)],
    toolDefinitionTokenCounter: progressiveCounter(deferred.name),
  });

  assert.equal(plan?.controls.search.name, SEARCH_MCP_TOOLS_CONTROL_NAME);
  assert.deepEqual(plan?.controls.search.inputSchema, {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 200 },
      server_id: { type: "string", minLength: 1, maxLength: 128 },
      cursor: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
    },
    additionalProperties: false,
  });
  assertClosedOutputSchema(plan?.controls.search.outputSchema);
  assert.equal(plan?.controls.search.metadata?.operationType, "read-only");
  assert.equal(plan?.controls.load.name, LOAD_MCP_TOOLS_CONTROL_NAME);
  assert.deepEqual(plan?.controls.load.inputSchema, {
    type: "object",
    properties: {
      tool_names: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    required: ["tool_names"],
    additionalProperties: false,
  });
  assertClosedOutputSchema(plan?.controls.load.outputSchema);
  assert.deepEqual(plan?.controls.load.outputSchema, {
    type: "object",
    properties: {
      kind: { const: "tool_visibility_activation" },
      activatedToolNames: {
        type: "array",
        maxItems: 16,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
      alreadyLoaded: {
        type: "array",
        maxItems: 16,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
      remainingDeferredToolCount: { type: "integer", minimum: 0 },
      availableFrom: { const: "next_model_request" },
    },
    required: [
      "kind",
      "activatedToolNames",
      "alreadyLoaded",
      "remainingDeferredToolCount",
      "availableFrom",
    ],
    additionalProperties: false,
  });
  assert.equal(plan?.controls.load.metadata?.operationType, "read-write");
});

test("MCP-first visibility falls back to direct definitions when a real tool owns a control name", () => {
  const deferred = mcpTool("docs__lookup", { definitionHash: "sha256:docs-lookup" });
  const snapshot = capabilitySnapshot({
    tools: [catalogTool(SEARCH_MCP_TOOLS_CONTROL_NAME), deferred],
    mcpCatalog: [mcpServer({ tools: [deferred], exposedTools: [deferred] })],
  });

  assert.equal(resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: [SEARCH_MCP_TOOLS_CONTROL_NAME, deferred.name],
    allowedAgentToolNames: [],
    frozenDefinitions: [definition(SEARCH_MCP_TOOLS_CONTROL_NAME), definition(deferred.name)],
    toolDefinitionTokenCounter: progressiveCounter(deferred.name),
  }), undefined);
});

test("MCP-first visibility ignores disabled, unavailable, and non-exposed frozen servers", () => {
  const disabled = mcpTool("disabled__lookup", { definitionHash: "sha256:disabled" });
  const disconnected = mcpTool("offline__lookup", { definitionHash: "sha256:offline" });
  const unconfigured = mcpTool("unconfigured__lookup", { definitionHash: "sha256:unconfigured" });
  const snapshot = capabilitySnapshot({
    tools: [disabled, disconnected, unconfigured],
    mcpCatalog: [
      { ...mcpServer({ tools: [disabled], exposedTools: [disabled] }), enabled: false },
      {
        ...mcpServer({ tools: [disconnected], exposedTools: [] }),
        serverId: "offline",
        runtimeStatus: "error",
      },
      {
        ...mcpServer({ tools: [unconfigured], exposedTools: [unconfigured] }),
        serverId: "unconfigured",
        availability: "unavailable",
        runtimeStatus: "unavailable",
      },
    ],
  });

  assert.equal(resolveMcpFirstToolVisibilityPlan({
    snapshot,
    executionAllowedToolNames: [disabled.name, disconnected.name, unconfigured.name],
    allowedAgentToolNames: [],
    frozenDefinitions: [definition(disabled.name), definition(disconnected.name), definition(unconfigured.name)],
    toolDefinitionTokenCounter: progressiveCounter(disabled.name, disconnected.name, unconfigured.name),
  }), undefined);
});

function assertClosedOutputSchema(schema: ToolJsonSchema | undefined): void {
  assert.notEqual(schema, undefined);
  assert.equal(typeof schema, "object");
  assert.notEqual(schema, null);
  if (typeof schema !== "object" || schema === null) return;
  assert.equal(schema.additionalProperties, false);
  assert.equal(typeof schema.properties, "object");
  assert.equal(Array.isArray(schema.required), true);
}

function capabilitySnapshot(input: {
  readonly tools: readonly CapabilityToolCatalogItem[];
  readonly mcpCatalog: readonly CapabilityMcpCatalogItem[];
}): AgentCapabilitySnapshot {
  return {
    snapshotId: "capability-snapshot-progressive-policy-test",
    createdAt: "2026-07-22T00:00:00.000Z",
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
      updatedAt: "2026-07-22T00:00:00.000Z",
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
      tools: input.tools,
      allowedTools: input.tools.map((tool) => tool.name),
    },
    mcpCatalog: input.mcpCatalog,
    executionRoot: "Z:/AgentArbor",
    securitySummary: "Test snapshot.",
    warnings: [],
  };
}

function mcpServer(input: {
  readonly tools: readonly CapabilityMcpToolCatalogItem[];
  readonly exposedTools: readonly CapabilityMcpToolCatalogItem[];
}): CapabilityMcpCatalogItem {
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
    enabledTools: input.tools.map((tool) => tool.protocolName),
    autoApprovedTools: [],
    tools: input.tools,
    exposedTools: input.exposedTools,
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

function mcpTool(
  name: string,
  overrides: Partial<CapabilityMcpToolCatalogItem> = {}
): CapabilityMcpToolCatalogItem {
  return {
    ...catalogTool(name, overrides),
    protocolName: name.replace(/^docs__/u, ""),
    ...overrides,
  };
}

function catalogTool(
  name: string,
  overrides: Partial<CapabilityToolCatalogItem> = {}
): CapabilityToolCatalogItem {
  return {
    name,
    displayName: name,
    displayDescription: `${name} display description`,
    description: `${name} objective description`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      additionalProperties: false,
    },
    definitionHash: `sha256:${"0".repeat(64)}`,
    category: name.includes("__") ? "mcp" : "workspace",
    categoryLabel: "Test",
    riskLevel: "low",
    riskLabel: "Low",
    operationType: "read-only",
    operationLabel: "Read",
    requiresConfirmation: false,
    confirmationLabel: "No confirmation",
    scopes: name.includes("__") ? ["mcp"] : ["desktop-basic"],
    enabled: true,
    availability: "available",
    ...overrides,
  };
}

function definition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} frozen definition`,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    metadata: {
      category: name.includes("__") ? "mcp" : "workspace",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function progressiveCounter(...expensiveToolNames: readonly string[]): (serialized: string) => number {
  return (serialized) => serialized.length +
    expensiveToolNames.filter((name) => serialized.includes(`\"name\":\"${name}\"`)).length * 20_000;
}
