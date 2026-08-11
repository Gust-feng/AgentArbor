import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { estimateContextTokens, estimateTokens, InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import type {
  AgentLoopAgentTool,
  AgentLoopInput,
  AgentLoopToolVisibilityPlan,
} from "../../app/model-runtime/agent-loop.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutor,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import {
  toolCallFactId,
  toolModelAttachmentsFromOutput,
  withToolModelAttachments,
} from "../../domain/tools/index.js";
import { createAgentSessionLoop } from "./agent-session-loop.js";
import { ToolCenter } from "../../app/tool-center/tool-center.js";
import { createReadToolOutputTool } from "../../app/tool-center/adapters/tool-output-read-tool.js";
import { InMemoryToolOutputStore } from "../../app/tool-center/tool-output-store.js";

test("agent session loop completes a direct answer in the injected Session with usage", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("final answer")]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.finalText, "final answer");
  const branch = await fixture.session.getBranch();
  assert.deepEqual(branch.flatMap((entry) => entry.type === "message" ? [entry.message.role] : []), ["user", "assistant"]);
  assert.equal(result.usage.requestCount, 1);
  assert.equal(result.session?.sessionId, "run-1");
  assert.equal(result.session?.startLeafRef, null);
  assert.equal(result.session?.inputEntryRef?.sessionId, "run-1");
  assert.equal(result.session?.latestLeafRef?.sessionId, "run-1");
  await loop.release();
});

test("agent session loop persists Pi-observed provider timing for visible output", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("timed answer")]);
  const timestamps = [1_000, 1_120, 1_620];
  const loop = createAgentSessionLoop({
    ...fixture,
    now: () => timestamps.shift() ?? 1_620,
  });

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.usage.latencyMs, 620);
  assert.equal(result.usage.firstTokenLatencyMs, 120);
  assert.equal(result.usage.outputDurationMs, 500);
  assert.equal(result.usage.outputTokensPerSecond, 6);
  await loop.release();
});

test("provider definition metrics use the allowed active subset on every model request", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "read-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("evidence accepted"),
  ]);
  const definitions = [
    toolDefinition("read", "read-only"),
    toolDefinition("write", "read-write"),
  ];
  const gateway = gatewayForDefinitions(definitions, async (request) => ({
    ...request,
    output: "contents",
    status: "completed",
    durationMs: 1,
  }));
  const transformedTools: string[][] = [];
  const observedMetrics: Array<{
    readonly toolCount: number;
    readonly totalTokens: number;
    readonly tools: readonly { readonly toolName: string; readonly definitionTokens: number }[];
  }> = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      transformedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
    toolDefinitionTokenCounter: (serialized) => serialized.length,
    onProviderToolDefinitionMetrics: (metrics) => { observedMetrics.push(metrics); },
  });
  const input = loopInput(gateway);

  const result = await loop.execute({
    ...input,
    tools: {
      ...input.tools,
      permission: { ...input.tools.permission, allowedTools: ["read"] },
    },
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(transformedTools, [["read"], ["read"]]);
  assert.equal(observedMetrics.length, 2);
  for (const metrics of observedMetrics) {
    assert.equal(metrics.toolCount, 1);
    assert.equal(metrics.totalTokens > 0, true);
    assert.deepEqual(metrics.tools.map((tool) => tool.toolName), ["read"]);
    assert.equal((metrics.tools[0]?.definitionTokens ?? 0) > 0, true);
  }
  assert.deepEqual((await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "active_tools_change" ? [entry.activeToolNames] : []), [["read"]]);
  await loop.release();
});

test("provider definition metrics record an empty active tool set without serialized content", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("no tools needed")]);
  const observed: unknown[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    onProviderToolDefinitionMetrics: (metrics) => { observed.push(metrics); },
  });

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(observed, [{ toolCount: 0, totalTokens: 0, tools: [] }]);
  await loop.release();
});

test("provider tools use run-frozen definitions while execution stays bound to the live gateway", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("no execution needed")]);
  const live = toolDefinition("read", "read-only");
  const frozen: ToolDefinition = {
    ...live,
    description: "Frozen read contract.",
    inputSchema: {
      type: "object",
      properties: { frozenPath: { type: "string" } },
      required: ["frozenPath"],
      additionalProperties: false,
    },
  };
  const gateway = gatewayForDefinitions([live], async (request) => ({
    ...request,
    output: "unused",
    status: "completed",
    durationMs: 0,
  }));
  const observed: Array<readonly ToolDefinition[]> = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      observed.push(tools);
      return payload;
    },
  });
  const input = loopInput(gateway);
  const result = await loop.execute({
    ...input,
    tools: { ...input.tools, definitions: [frozen] },
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(observed[0]?.[0]?.description, frozen.description);
  assert.deepEqual(observed[0]?.[0]?.inputSchema, frozen.inputSchema);
  assert.notEqual(observed[0]?.[0]?.description, live.description);
  await loop.release();
});

test("provider definition metrics include model-visible AgentTools", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("delegation is unnecessary")]);
  const observedNames: string[][] = [];
  const observedOperations: string[][] = [];
  const gateway = gatewayFor({
    definition: undefined,
    execute: async () => { throw new Error("No mechanical tools are available."); },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop({
    ...fixture,
    onProviderToolDefinitionMetrics: (metrics) => {
      observedNames.push(metrics.tools.map((tool) => tool.toolName));
      observedOperations.push(metrics.tools.map((tool) => tool.operationType));
    },
  });

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool([])],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(observedNames, [["agent_call"]]);
  assert.deepEqual(observedOperations, [["read-write"]]);
  await loop.release();
});

test("progressive MCP search exposes a compact frozen catalog and a replayable continuation", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definitions = [
    toolDefinition("read", "read-only"),
    mcpToolDefinition("docs__lookup"),
    mcpToolDefinition("docs__search"),
  ];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_search", { query: "docs", limit: 1 }, { id: "search-1" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("catalog inspected"),
  ]);
  const gateway = gatewayForDefinitions(definitions, async (request) => ({
    ...request,
    output: "must not execute an MCP tool during search",
    status: "completed",
    durationMs: 1,
  }));
  const accepted: ToolCallResult[] = [];
  const observedTools: string[][] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
  });
  const result = await loop.execute(loopInput(gateway, {
    tools: {
      ...loopInput(gateway).tools,
      permission: {
        ...loopInput(gateway).tools.permission,
        allowedTools: definitions.map((definition) => definition.name),
      },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: ["read"],
      deferred: [
        { name: "docs__lookup", displayName: "Lookup docs", description: "Look up docs.", serverId: "docs" },
        { name: "docs__search", displayName: "Search docs", description: "Search docs.", serverId: "docs" },
      ],
    }),
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(observedTools, [
    ["read", "mcp_search", "mcp_load"],
    ["read", "mcp_search", "mcp_load"],
  ]);
  const searchResult = accepted.find((item) => item.toolName === "mcp_search");
  assert.equal(searchResult?.status, "completed");
  const searchOutput = searchResult?.output as {
    readonly matches?: readonly Record<string, unknown>[];
    readonly totalMatches?: number;
    readonly returned?: number;
    readonly continuation?: { readonly nextInput?: Record<string, unknown> };
  } | undefined;
  assert.deepEqual(searchOutput?.matches, [{
    name: "docs__lookup",
    displayName: "Lookup docs",
    description: "Look up docs.",
    source: { kind: "mcp", id: "docs", label: "Documentation" },
    loaded: false,
  }]);
  assert.equal(searchOutput?.totalMatches, 2);
  assert.equal(searchOutput?.returned, 1);
  assert.deepEqual(searchOutput?.continuation?.nextInput, {
    query: "docs",
    cursor: 1,
    limit: 1,
  });
  const serialized = JSON.stringify(searchResult?.output);
  assert.equal(serialized.includes("inputSchema"), false);
  assert.equal(serialized.includes("protocolName"), false);
  assert.equal(serialized.includes("definitionHash"), false);
  assert.equal(serialized.includes("sha256"), false);
  assert.equal(accepted.some((item) => item.toolName === "docs__lookup"), false);
  await loop.release();
});

test("progressive MCP loading reveals the frozen definition on the next request and records its load point", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definitions = [
    toolDefinition("read", "read-only"),
    mcpToolDefinition("docs__lookup"),
    mcpToolDefinition("docs__search"),
  ];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__lookup"] }, { id: "load-1" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("docs__lookup", { query: "agent" }, { id: "mcp-1" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("MCP result accepted"),
  ]);
  let executions = 0;
  const gateway = gatewayForDefinitions(definitions, async (request) => {
    executions += 1;
    return { ...request, output: { answer: "found" }, status: "completed", durationMs: 1 };
  });
  const observedTools: string[][] = [];
  const observedSchemas: Array<Record<string, unknown>[]> = [];
  const observedMetrics: string[][] = [];
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      observedSchemas.push(tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
      })));
      return payload;
    },
    onProviderToolDefinitionMetrics: (metrics) => {
      observedMetrics.push(metrics.tools.map((tool) => tool.toolName));
    },
  });
  const base = loopInput(gateway);
  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: definitions.map((definition) => definition.name) },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: ["read"],
      deferred: [
        { name: "docs__lookup", displayName: "Lookup docs", description: "Look up docs.", serverId: "docs" },
        { name: "docs__search", displayName: "Search docs", description: "Search docs.", serverId: "docs" },
      ],
    }),
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 1);
  assert.deepEqual(observedTools, [
    ["read", "mcp_search", "mcp_load"],
    ["read", "mcp_search", "mcp_load", "docs__lookup"],
    ["read", "mcp_search", "mcp_load", "docs__lookup"],
  ]);
  assert.deepEqual(observedMetrics, observedTools);
  const loadResult = accepted.find((item) => item.toolName === "mcp_load");
  assert.deepEqual(loadResult?.output, {
    kind: "tool_visibility_activation",
    activatedToolNames: ["docs__lookup"],
    alreadyLoaded: [],
    remainingDeferredToolCount: 1,
    availableFrom: "next_model_request",
  });
  assert.deepEqual(
    (await fixture.session.getBranch())
      .filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
      .map((entry) => entry.type === "message" && entry.message.role === "toolResult"
        ? { toolName: entry.message.toolName, addedToolNames: entry.message.addedToolNames }
        : undefined),
    [
      { toolName: "mcp_load", addedToolNames: ["docs__lookup"] },
      { toolName: "docs__lookup", addedToolNames: undefined },
    ],
  );
  const loadedDefinition = observedSchemas[1]?.find((definition) => definition.name === "docs__lookup");
  assert.deepEqual(loadedDefinition?.inputSchema, definitions[1]?.inputSchema);
  await loop.release();
});

test("a loaded MCP tool still passes through the confirmation boundary", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const baseDefinition = mcpToolDefinition("docs__write");
  const definition: ToolDefinition = {
    ...baseDefinition,
    metadata: {
      category: "mcp",
      riskLevel: "medium",
      operationType: "read-write",
      requiresConfirmation: true,
    },
  };
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "write-load" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall(definition.name, { query: "write" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("write completed"),
  ]);
  let executions = 0;
  const confirmationRequest = {
    confirmationId: "confirm-mcp-write",
    toolCallFactId: "write-call",
    title: "Write through MCP",
    actionSummary: "Write through the documentation MCP server",
    affectedResources: ["docs"],
    riskLevel: "medium" as const,
    requestedAt: "2026-07-22T00:00:00.000Z",
    sourceRefs: [],
  };
  const gateway = gatewayFor({
    definition,
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest,
      },
    }),
    execute: async (request) => {
      executions += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop({ ...fixture, transformProviderPayload: ({ payload }) => payload });
  const base = loopInput(gateway);
  const paused = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [{ name: definition.name, displayName: "Write", description: "Write", serverId: "docs" }],
    }),
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  });

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.equal(executions, 0);
  assert.deepEqual(paused.confirmationRequests, [confirmationRequest]);
  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: confirmationRequest.confirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-22T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executions, 1);
  assert.deepEqual(accepted.map((toolResult) => toolResult.status), ["completed", "approval_required", "completed"]);
  await loop.release();
});

test("progressive MCP loading is atomic for invalid names and idempotent across repeated union loads", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definitions = [mcpToolDefinition("docs__one"), mcpToolDefinition("docs__two")];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__one", "docs__missing"] }, { id: "invalid-load" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__one"] }, { id: "load-one" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__one"] }, { id: "load-one-again" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__two"] }, { id: "load-two" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("all MCP tools loaded"),
  ]);
  let executions = 0;
  const gateway = gatewayForDefinitions(definitions, async (request) => {
    executions += 1;
    return { ...request, output: "unexpected MCP execution", status: "completed", durationMs: 1 };
  });
  const observedTools: string[][] = [];
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
  });
  const base = loopInput(gateway);
  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: definitions.map((definition) => definition.name) },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [
        { name: "docs__one", displayName: "One", description: "One", serverId: "docs" },
        { name: "docs__two", displayName: "Two", description: "Two", serverId: "docs" },
      ],
    }),
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 0);
  assert.deepEqual(observedTools, [
    ["mcp_search", "mcp_load"],
    ["mcp_search", "mcp_load"],
    ["mcp_search", "mcp_load", "docs__one"],
    ["mcp_search", "mcp_load", "docs__one"],
    ["docs__one", "docs__two"],
  ]);
  assert.equal(accepted[0]?.status, "failed");
  assert.equal(accepted[0]?.errorFacts?.code, "tool_visibility_tool_not_loadable");
  assert.deepEqual(accepted[0]?.errorFacts?.invalidToolNames, ["docs__missing"]);
  assert.deepEqual(accepted[1]?.output, {
    kind: "tool_visibility_activation",
    activatedToolNames: ["docs__one"],
    alreadyLoaded: [],
    remainingDeferredToolCount: 1,
    availableFrom: "next_model_request",
  });
  assert.deepEqual(accepted[2]?.output, {
    kind: "tool_visibility_activation",
    activatedToolNames: [],
    alreadyLoaded: ["docs__one"],
    remainingDeferredToolCount: 1,
    availableFrom: "next_model_request",
  });
  assert.deepEqual(accepted[3]?.output, {
    kind: "tool_visibility_activation",
    activatedToolNames: ["docs__two"],
    alreadyLoaded: [],
    remainingDeferredToolCount: 0,
    availableFrom: "next_model_request",
  });
  await loop.release();
});

test("concurrent MCP loads merge the active set without losing either definition", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definitions = [mcpToolDefinition("docs__one"), mcpToolDefinition("docs__two")];
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("mcp_load", { tool_names: ["docs__one"] }, { id: "load-one" }),
      fauxToolCall("mcp_load", { tool_names: ["docs__two"] }, { id: "load-two" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("both MCP tools are available"),
  ]);
  const observedTools: string[][] = [];
  const gateway = gatewayForDefinitions(definitions, async (request) => ({
    ...request,
    output: "unexpected MCP execution",
    status: "completed",
    durationMs: 1,
  }));
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
  });
  const base = loopInput(gateway);

  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: definitions.map((definition) => definition.name) },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [
        { name: "docs__one", displayName: "One", description: "One", serverId: "docs" },
        { name: "docs__two", displayName: "Two", description: "Two", serverId: "docs" },
      ],
    }),
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(observedTools, [
    ["mcp_search", "mcp_load"],
    ["docs__one", "docs__two"],
  ]);
  assert.deepEqual(result.toolResults.map((item) => item.callId), ["load-one", "load-two"]);
  await loop.release();
});

test("a hallucinated unloaded MCP call never reaches its executor", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definition = mcpToolDefinition("docs__lookup");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("docs__lookup", { query: "never" }, { id: "hallucinated" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("the tool was unavailable"),
  ]);
  let executions = 0;
  const gateway = gatewayForDefinitions([definition], async (request) => {
    executions += 1;
    return { ...request, output: "must not run", status: "completed", durationMs: 1 };
  });
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload }) => payload,
  });
  const base = loopInput(gateway);
  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [{ name: definition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 0);
  assert.equal(result.toolResults.length, 1);
  assert.deepEqual(result.toolResults[0], {
    callId: "hallucinated",
    toolName: "docs__lookup",
    input: { query: "never" },
    output: undefined,
    status: "failed",
    error: "Tool docs__lookup not found",
    errorDomain: "runtime_error",
    errorFacts: { code: "pi_tool_call_rejected", doNotBlindlyRetry: true },
    durationMs: 0,
  });
  await loop.release();
});

test("same-batch MCP loading cannot make a deferred call visible to its originating request", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definition = mcpToolDefinition("docs__lookup");
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "same-batch-load" }),
      fauxToolCall(definition.name, { query: "too early" }, { id: "same-batch-call" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("the tool is available on the next request"),
  ]);
  let executions = 0;
  const gateway = gatewayForDefinitions([definition], async (request) => {
    executions += 1;
    return { ...request, output: { answer: "must not execute" }, status: "completed", durationMs: 1 };
  });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    transformProviderPayload: ({ payload }) => payload,
  });
  const base = loopInput(gateway);

  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [{ name: definition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 0);
  assert.equal(accepted.find((item) => item.callId === "same-batch-load")?.status, "completed");
  const rejected = accepted.find((item) => item.callId === "same-batch-call");
  assert.equal(rejected?.status, "failed");
  assert.equal(rejected?.errorFacts?.code, "pi_tool_call_rejected");
  assert.equal(rejected?.failureAttribution, undefined);
  await loop.release();
});

test("Pi schema rejection becomes a canonical fact before the tool-round checkpoint", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", {}, { id: "invalid-schema" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("invalid input corrected"),
  ]);
  const accepted = new Map<string, ToolCallResult>();
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async () => { throw new Error("schema-invalid calls must not execute"); },
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onToolResult: async (toolResult) => { accepted.set(toolResult.callId, toolResult); },
    onSessionWriteCheckpoint: async (checkpoint) => {
      if (checkpoint.kind !== "tool_result_entries_committed") return;
      for (const callId of checkpoint.toolCallIds) {
        assert.equal(accepted.has(callId), true, `missing canonical fact for ${callId}`);
      }
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const rejected = accepted.get("invalid-schema");
  assert.equal(rejected?.status, "failed");
  assert.equal(rejected?.errorFacts?.code, "pi_tool_schema_validation_failed");
  assert.equal(rejected?.failureAttribution, "schema_validation");
  assert.match(rejected?.error ?? "", /path/u);
  await loop.release();
});

test("Pi executor exceptions retain their exact error as canonical execution failures", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "executor-throw" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("execution failure observed"),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async () => { throw new Error("disk exploded exactly"); },
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const failed = result.toolResults.find((toolResult) => toolResult.callId === "executor-throw");
  assert.equal(failed?.error, "disk exploded exactly");
  assert.equal(failed?.errorFacts?.code, "pi_tool_execution_failed");
  assert.equal(failed?.failureAttribution, "execution_failure");
  await loop.release();
});

test("load activation rolls the ordered active set back when Ordinary rejects the fact", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definition = mcpToolDefinition("docs__lookup");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "rejected-load" }), {
      stopReason: "toolUse",
    }),
  ]);
  const gateway = gatewayForDefinitions([definition], async (request) => ({
    ...request,
    output: "must not execute",
    status: "completed",
    durationMs: 1,
  }));
  const loop = createAgentSessionLoop(fixture);
  const base = loopInput(gateway);

  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [{ name: definition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
    onToolResult: async () => { throw new Error("ordinary persistence unavailable"); },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "tool_result_acceptance_failed");
  assert.equal(fixture.faux.state.callCount, 1);
  const activeChanges = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "active_tools_change" ? [entry.activeToolNames] : []);
  assert.deepEqual(activeChanges, [
    ["mcp_search", "mcp_load"],
    [definition.name],
    ["mcp_search", "mcp_load"],
  ]);
  const context = await fixture.session.buildContext();
  assert.deepEqual(context.activeToolNames, ["mcp_search", "mcp_load"]);
  const toolResultEntries = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : []);
  // The owning feature rejected the load fact and the active set was rolled
  // back, so the failed result must not retain Pi's activation marker.
  assert.equal(toolResultEntries[0]?.addedToolNames, undefined);
  await loop.release();
});

test("a new run resets active tools and hides historical activation markers without rewriting Session", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definition = mcpToolDefinition("docs__lookup");
  const gateway = gatewayForDefinitions([definition], async (request) => ({
    ...request,
    output: "MCP evidence",
    status: "completed",
    durationMs: 1,
  }));
  const base = loopInput(gateway);
  const progressiveInput = {
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: [],
      deferred: [{ name: definition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
  } satisfies AgentLoopInput;
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "first-load" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("first run complete"),
  ]);
  const firstLoop = createAgentSessionLoop(fixture);
  const first = await firstLoop.execute(progressiveInput);
  assert.equal(first.status, "completed", first.status === "failed" ? first.error : undefined);
  await firstLoop.release();

  fixture.faux.setResponses([(context) => {
    const historicalLoad = context.messages.find((message) =>
      message.role === "toolResult" && message.toolName === "mcp_load");
    assert.equal(historicalLoad?.role === "toolResult" ? historicalLoad.addedToolNames : undefined, undefined);
    return fauxAssistantMessage("second run complete");
  }]);
  const secondLoop = createAgentSessionLoop(fixture);
  const second = await secondLoop.execute({
    ...progressiveInput,
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "second run" },
    ],
  });
  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  await secondLoop.release();

  const branch = await fixture.session.getBranch();
  const durableLoad = branch.find((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "mcp_load");
  assert.deepEqual(
    durableLoad?.type === "message" && durableLoad.message.role === "toolResult"
      ? durableLoad.message.addedToolNames
      : undefined,
    [definition.name],
  );
  assert.deepEqual(branch.flatMap((entry) =>
    entry.type === "active_tools_change" ? [entry.activeToolNames] : []), [
    ["mcp_search", "mcp_load"],
    [definition.name],
    ["mcp_search", "mcp_load"],
  ]);
});

test("delegated agents receive a fresh narrowed progressive catalog", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const mcpDefinition = mcpToolDefinition("docs__lookup");
  const mechanicalDefinitions = [mcpDefinition];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__lookup"] }, { id: "parent-load" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: ["docs__lookup"] }, { id: "child-load" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("docs__lookup", { query: "child" }, { id: "child-mcp" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child evidence"),
    fauxAssistantMessage("parent synthesis"),
  ]);
  const observedTools: string[][] = [];
  let executions = 0;
  const gatewayBase = gatewayForDefinitions(mechanicalDefinitions, async (request) => {
    executions += 1;
    return { ...request, output: "MCP evidence", status: "completed", durationMs: 1 };
  });
  const gateway = {
    ...gatewayBase,
    deliverResult: async (result: ToolCallResult) => result,
  };
  const loop = createAgentSessionLoop({
    ...fixture,
    toolDefinitionTokenCounter: progressiveCounter("docs__lookup"),
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
  });
  const base = loopInput(gateway, { agentTools: [delegatedAgentTool([mcpDefinition.name])] });
  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [mcpDefinition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: ["agent_call"],
      deferred: [{ name: mcpDefinition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 1);
  assert.deepEqual(observedTools, [
    ["agent_call", "mcp_search", "mcp_load"],
    ["agent_call", "docs__lookup"],
    ["mcp_search", "mcp_load"],
    ["docs__lookup"],
    ["docs__lookup"],
    ["agent_call", "docs__lookup"],
  ]);
  await loop.release();
});

test("a delegated same-batch load cannot make the deferred call visible early", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definition = mcpToolDefinition("docs__lookup");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate-same-batch" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([
      fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "child-same-batch-load" }),
      fauxToolCall(definition.name, { query: "too early" }, { id: "child-same-batch-call" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("child observed the rejection"),
    fauxAssistantMessage("parent observed the child result"),
  ]);
  let executions = 0;
  const gatewayBase = gatewayForDefinitions([definition], async (request) => {
    executions += 1;
    return { ...request, output: "must not execute", status: "completed", durationMs: 1 };
  });
  const gateway = { ...gatewayBase, deliverResult: async (result: ToolCallResult) => result };
  const loop = createAgentSessionLoop({
    ...fixture,
    toolDefinitionTokenCounter: progressiveCounter(definition.name),
    transformProviderPayload: ({ payload }) => payload,
  });
  const base = loopInput(gateway, { agentTools: [delegatedAgentTool([definition.name])] });

  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: [definition.name] },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: ["agent_call"],
      deferred: [{ name: definition.name, displayName: "Lookup", description: "Lookup", serverId: "docs" }],
    }),
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(executions, 0);
  const rejected = result.toolResults.find((toolResult) => toolResult.callId === "child-same-batch-call");
  assert.equal(rejected?.parentToolCallFactId, "delegate-same-batch");
  assert.equal(rejected?.status, "failed");
  assert.equal(rejected?.errorFacts?.code, "pi_tool_call_rejected");
  await loop.release();
});

test("delegated agents expose a small narrowed MCP set directly instead of inheriting parent controls", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  const definitions = [mcpToolDefinition("docs__one"), mcpToolDefinition("docs__two")];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate-small" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child did not need a tool"),
    fauxAssistantMessage("parent synthesis"),
  ]);
  const gatewayBase = gatewayForDefinitions(definitions, async (request) => ({
    ...request,
    output: "unused",
    status: "completed",
    durationMs: 1,
  }));
  const gateway = { ...gatewayBase, deliverResult: async (result: ToolCallResult) => result };
  const observedTools: string[][] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    toolDefinitionTokenCounter: (serialized) => serialized.length,
    transformProviderPayload: ({ payload, tools }) => {
      observedTools.push(tools.map((tool) => tool.name));
      return payload;
    },
  });
  const base = loopInput(gateway, { agentTools: [delegatedAgentTool([definitions[0]!.name])] });

  const result = await loop.execute({
    ...base,
    tools: {
      ...base.tools,
      permission: { ...base.tools.permission, allowedTools: definitions.map((definition) => definition.name) },
    },
    toolVisibilityPlan: progressivePlan({
      initialNames: ["agent_call"],
      deferred: definitions.map((definition) => ({
        name: definition.name,
        displayName: definition.name,
        description: definition.description,
        serverId: "docs",
      })),
    }),
  });

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(observedTools, [
    ["agent_call", "mcp_search", "mcp_load"],
    ["docs__one"],
    ["agent_call", "mcp_search", "mcp_load"],
  ]);
  await loop.release();
});

test("delegated Pi immediate failures become nested canonical facts", async (t) => {
  const fixture = await createPayloadAwareFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate-immediate" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("ghost_tool", { query: "missing" }, { id: "child-ghost" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child recovered"),
    fauxAssistantMessage("parent recovered"),
  ]);
  const baseGateway = emptyGateway();
  const gateway = {
    ...baseGateway,
    deliverResult: async (result: ToolCallResult) => result,
  };
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool([])],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const nested = result.toolResults.find((toolResult) => toolResult.callId === "child-ghost");
  assert.equal(nested?.parentToolCallFactId, "delegate-immediate");
  assert.equal(nested?.error, "Tool ghost_tool not found");
  assert.equal(nested?.errorFacts?.code, "pi_tool_call_rejected");
  assert.equal(result.toolResults.some((toolResult) => toolResult.callId === "delegate-immediate"), true);
  await loop.release();
});

test("agent session loop forwards the frozen thinking level to Pi provider requests", async (t) => {
  const observed: string[] = [];
  const fixture = await createFixture(t, {
    models: [{ id: "reasoning-model", reasoning: true }],
  });
  fixture.faux.setResponses([(context, options) => {
    void context;
    const reasoning = typeof options === "object" && options !== null && "reasoning" in options
      ? options.reasoning
      : undefined;
    observed.push(String(reasoning ?? "off"));
    return fauxAssistantMessage("reasoned answer");
  }]);
  const loop = createAgentSessionLoop({ ...fixture, thinkingLevel: "high" });

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "completed");
  assert.deepEqual(observed, ["high"]);
  await loop.release();
});

test("agent session loop reads prior turns from the injected session", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("answer one")]);
  const firstLoop = createAgentSessionLoop(fixture);
  const first = await firstLoop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "question one" },
    ],
  }));
  assert.equal(first.status, "completed");
  await firstLoop.release();

  fixture.faux.setResponses([(context) => {
    assert.deepEqual(context.messages.map((message) => message.role), ["user", "assistant", "user"]);
    assert.deepEqual(context.messages[0]?.role === "user" ? context.messages[0].content : undefined, [
      { type: "text", text: "question one" },
    ]);
    return fauxAssistantMessage("answer two");
  }]);
  const secondLoop = createAgentSessionLoop(fixture);
  const second = await secondLoop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "question two" },
    ],
  }));

  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  await secondLoop.release();
});

test("agent session loop persists image bytes in Session so later turns can reference them", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("ephemeral-image-bytes").toString("base64");
  fixture.faux.setResponses([
    (context) => {
      const current = context.messages.at(-1);
      assert.equal(current?.role, "user");
      assert.equal(JSON.stringify(current).includes(imageData), true);
      return fauxAssistantMessage("image inspected");
    },
    (context) => {
      assert.equal(
        context.messages.some((message) => message.role === "user" && JSON.stringify(message).includes(imageData)),
        true,
      );
      return fauxAssistantMessage("follow-up image inspected");
    },
  ]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      {
        role: "user",
        content: "inspect this image",
        attachments: [{
          kind: "image",
          attachmentId: "image-1",
          inputRef: "file:image.png",
          source: { kind: "data", mimeType: "image/png", data: imageData },
        }],
      },
    ],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const branchJson = JSON.stringify(await fixture.session.getBranch());
  // 图片字节必须进入 durable Session：否则后续轮次模型无法再引用此前发送的图片。
  assert.equal(branchJson.includes(imageData), true);
  await loop.release();

  const secondLoop = createAgentSessionLoop(fixture);
  const second = await secondLoop.execute(loopInput(emptyGateway(), {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "请继续说明刚才图片里的内容。" },
    ],
  }));

  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  await secondLoop.release();
});

test("agent session loop does not call the provider when cancellation is already requested", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("must not be reached")]);
  const cancellation = new AbortController();
  cancellation.abort(new Error("cancelled by user"));
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway(), { abortSignal: cancellation.signal }));

  assert.equal(result.status, "cancelled");
  assert.match(result.status === "cancelled" ? result.error ?? "" : "", /cancelled by user/);
  assert.equal(fixture.faux.state.callCount, 0);
  await loop.release();
});

test("Pi immediate cancellation becomes a canonical cancelled tool fact", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("ghost_tool", { query: "cancel me" }, { id: "immediate-cancel" }), {
      stopReason: "toolUse",
    }),
  ]);
  const cancellation = new AbortController();
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway(), {
    abortSignal: cancellation.signal,
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
    onSessionWriteCheckpoint: async (checkpoint) => {
      if (checkpoint.kind === "assistant_tool_call_entry_committed") {
        cancellation.abort(new Error("cancelled during tool dispatch"));
      }
    },
  }));

  assert.equal(result.status, "cancelled");
  const cancelled = accepted.find((toolResult) => toolResult.callId === "immediate-cancel");
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.errorFacts?.code, "pi_tool_call_cancelled");
  await loop.release();
});

test("loop release classifies an in-flight Pi immediate result as cancelled", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("ghost_tool", { query: "release me" }, { id: "release-immediate" }), {
      stopReason: "toolUse",
    }),
  ]);
  let checkpointEntered!: () => void;
  let releaseCheckpoint!: () => void;
  const checkpointReady = new Promise<void>((resolve) => { checkpointEntered = resolve; });
  const checkpointGate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop(fixture);
  const run = loop.execute(loopInput(emptyGateway(), {
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
    onSessionWriteCheckpoint: async (checkpoint) => {
      if (checkpoint.kind !== "assistant_tool_call_entry_committed") return;
      checkpointEntered();
      await checkpointGate;
    },
  }));

  await checkpointReady;
  const release = loop.release();
  releaseCheckpoint();
  await release;
  const result = await run;

  assert.equal(result.status, "cancelled");
  const cancelled = accepted.find((toolResult) => toolResult.callId === "release-immediate");
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.errorFacts?.code, "pi_tool_call_cancelled");
});

test("agent session loop preserves proven provider stop classifications", async (t) => {
  const fixture = await createFixture(t);
  const loop = createAgentSessionLoop(fixture);

  fixture.faux.setResponses([fauxAssistantMessage("partial answer", { stopReason: "length" })]);
  const truncated = await loop.execute(loopInput(emptyGateway()));
  assert.equal(truncated.status, "failed");
  assert.equal(truncated.status === "failed" ? truncated.errorCode : undefined, "output_truncated");
  await loop.release();

  const providerFailureLoop = createAgentSessionLoop(fixture);
  fixture.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider rejected the request" })]);
  const providerFailure = await providerFailureLoop.execute(loopInput(emptyGateway()));
  assert.equal(providerFailure.status, "failed");
  assert.equal(providerFailure.status === "failed" ? providerFailure.errorCode : undefined, "provider_response");
  await providerFailureLoop.release();
});

test("agent session loop maps provider refusal diagnostics to a stable failed result", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([{
    ...fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "The model refused to provide a response",
    }),
    diagnostics: [{
      type: "provider_refusal",
      timestamp: Date.now(),
      details: { refusal: "I cannot complete that request." },
    }],
  }]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "model_refusal");
  assert.equal(
    result.status === "failed" ? result.error : undefined,
    "The model refused the request: I cannot complete that request.",
  );
  await loop.release();
});

test("agent session loop preserves the Responses incomplete reason", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([{
    ...fauxAssistantMessage("partial", { stopReason: "length" }),
    providerMetadata: { status: "incomplete", incompleteReason: "content_filter" },
  }]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(emptyGateway()));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "content_filtered");
  assert.equal(result.status === "failed" ? result.error : undefined, "Model response was incomplete: content_filter.");
  await loop.release();
});

test("agent session loop normalizes Pi provider errors into AgentArbor failure codes", async (t) => {
  const fixture = await createFixture(t);
  const cases = [
    {
      message: "Request timed out while waiting for the provider.",
      expectedCode: "provider_timeout",
    },
    {
      message: "fetch failed: other side closed",
      expectedCode: "provider_network",
    },
    {
      message: "OpenAI API error (401): invalid_api_key",
      expectedCode: "provider_auth",
    },
    {
      message: "429: rate_limit_exceeded",
      expectedCode: "provider_rate_limit",
    },
    {
      message: "No API key for provider: agentarbor-test",
      expectedCode: "provider_config",
    },
    {
      message: "provider rejected the request",
      expectedCode: "provider_response",
    },
    {
      message: "Provider finish_reason: content_filter",
      expectedCode: "content_filtered",
    },
    {
      message: "This model's maximum context length is 8192 tokens.",
      expectedCode: "context_overflow",
    },
  ] as const;

  for (const fixtureCase of cases) {
    fixture.faux.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: fixtureCase.message }),
    ]);
    const loop = createAgentSessionLoop(fixture);

    const result = await loop.execute(loopInput(emptyGateway()));

    assert.equal(result.status, "failed", fixtureCase.message);
    assert.equal(
      result.status === "failed" ? result.errorCode : undefined,
      fixtureCase.expectedCode,
      fixtureCase.message,
    );
    assert.equal(result.status === "failed" ? result.error : undefined, fixtureCase.message);
    await loop.release();
  }
});

test("agent session loop persists compaction before the next provider request", async (t) => {
  const fixture = await createFixture(t, {
    models: [{ id: "small-model", contextWindow: 2_400, maxTokens: 500 }],
  });
  for (let index = 0; index < 30; index += 1) {
    await fixture.session.appendMessage({
      role: "user",
      content: `old context ${index} `.repeat(50),
      timestamp: index * 2 + 1,
    });
    await fixture.session.appendMessage(fauxAssistantMessage(`old answer ${index}`));
  }
  fixture.faux.setResponses([
    fauxAssistantMessage("summary of old context"),
    fauxAssistantMessage("answer after compaction"),
  ]);
  const observedEntries: string[] = [];
  const loop = createAgentSessionLoop({
    ...fixture,
    compactionSettings: { enabled: true, reserveTokens: 100, keepRecentTokens: 300 },
  });

  const result = await loop.execute(loopInput(emptyGateway(), {
    onSessionWriteCheckpoint: async (checkpoint) => {
      if (checkpoint.kind === "compaction_entry_committed") {
        observedEntries.push(checkpoint.compactionEntryRef.entryId);
      }
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(observedEntries.length, 1);
  assert.equal((await fixture.session.getEntry(observedEntries[0]!))?.type, "compaction");
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop bounds a twenty-turn session with repeated tool rounds and compaction", async (t) => {
  const fixture = await createFixture(t, {
    models: [{ id: "small-model", contextWindow: 3_000, maxTokens: 500 }],
  });
  let toolCallSequence = 0;
  const response = (context: Context) => {
    if ((context.tools?.length ?? 0) === 0) {
      return fauxAssistantMessage("summary of prior turns");
    }
    if (context.messages.at(-1)?.role === "user") {
      toolCallSequence += 1;
      return fauxAssistantMessage(
        fauxToolCall("read", { path: "README.md" }, { id: `read-${toolCallSequence}` }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(`turn ${toolCallSequence} complete`);
  };
  fixture.faux.setResponses(Array.from({ length: 100 }, () => response));
  let toolExecutions = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => {
      toolExecutions += 1;
      return {
        ...request,
        output: { content: `evidence ${toolExecutions} `.repeat(30) },
        status: "completed",
        durationMs: 1,
      };
    },
  });
  const compactionEntryIds = new Set<string>();

  for (let turn = 1; turn <= 20; turn += 1) {
    const loop = createAgentSessionLoop({
      ...fixture,
      compactionSettings: { enabled: true, reserveTokens: 500, keepRecentTokens: 300 },
    });
    const result = await loop.execute(loopInput(gateway, {
      messages: [
        { role: "system", content: "You are the Ordinary Agent." },
        { role: "user", content: `turn ${turn} ${"context ".repeat(60)}` },
      ],
      onSessionWriteCheckpoint: async (checkpoint) => {
        if (checkpoint.kind === "compaction_entry_committed") {
          compactionEntryIds.add(checkpoint.compactionEntryRef.entryId);
        }
      },
    }));
    if (result.status !== "completed") {
      const observed = (await fixture.session.buildContext()).messages;
      assert.fail(`turn ${turn}: ${JSON.stringify(result)}; tokens=${estimateContextTokens(observed).tokens}; messages=${JSON.stringify(observed.map((message) => [message.role, estimateTokens(message)]))}`);
    }
    await loop.release();
  }

  const finalContext = (await fixture.session.buildContext()).messages;
  assert.equal(toolExecutions, 20);
  assert.equal(toolCallSequence, 20);
  assert.equal(compactionEntryIds.size >= 2, true);
  assert.equal(fixture.faux.state.callCount > 40, true);
  assert.equal(estimateContextTokens(finalContext).tokens < 1_900, true);
});

test("agent session loop sends one ToolCenter fact back to the model in callback order", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "read-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("read complete"),
  ]);
  const order: string[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 2,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onSessionWriteCheckpoint: async (checkpoint) => { order.push(`session:${checkpoint.kind}`); },
    onToolRequested: () => { order.push("requested"); },
    onToolResult: async () => { order.push("result"); },
  }));

  assert.equal(result.status, "completed");
  assert.deepEqual(order, [
    "session:start_leaf_captured",
    "session:input_entry_committed",
    "session:assistant_tool_call_entry_committed",
    "requested",
    "result",
    "session:tool_result_entries_committed",
    "session:assistant_response_entry_committed",
  ]);
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.callId, "read-call");
  const toolResults = (await fixture.session.getBranch()).filter((entry) =>
    entry.type === "message" && entry.message.role === "toolResult");
  assert.equal(toolResults.length, 1);
  await loop.release();
});

test("agent session loop reads an oversized ToolCenter result through Pi continuation without rerunning the tool", async (t) => {
  const fixture = await createFixture(t);
  const outputStore = new InMemoryToolOutputStore();
  const toolCenter = new ToolCenter({ outputStore, maxInlineOutputChars: 128 });
  let producerExecutions = 0;
  toolCenter.register(oversizedReportTool(async () => {
    producerExecutions += 1;
    return { content: "report-line ".repeat(400) };
  }));
  toolCenter.register(createReadToolOutputTool(outputStore));

  let continuationInput: Record<string, unknown> | undefined;
  const accepted: ToolCallResult[] = [];
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("produce_report", {}, { id: "report-call" }), {
      stopReason: "toolUse",
    }),
    () => {
      assert.ok(continuationInput, "ToolCenter did not provide a read_output continuation.");
      return fauxAssistantMessage(fauxToolCall("ReadOutput", continuationInput, { id: "report-read" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("report recovered"),
  ]);
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(toolCenter, {
    onToolResult: async (toolResult) => {
      accepted.push(toolResult);
      if (toolResult.toolName !== "produce_report") return;
      const output = toolResult.output as { readonly continuation?: { readonly nextInput?: unknown } };
      continuationInput = output.continuation?.nextInput as Record<string, unknown> | undefined;
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "report recovered");
  assert.equal(producerExecutions, 1);
  assert.deepEqual(accepted.map((item) => item.toolName), ["produce_report", "ReadOutput"]);
  assert.equal(typeof (accepted[0]?.output as { readonly contentRef?: unknown })?.contentRef, "string");
  assert.ok(accepted[1]?.output, JSON.stringify(accepted[1]));
  assert.match(JSON.stringify(accepted[1]?.output), /report-line/u);
  await loop.release();
});

test("agent session loop persists tool-origin images so later turns can reference them", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("tool-image-bytes").toString("base64");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("inspect_image", { path: "image.png" }, { id: "image-call" }), {
      stopReason: "toolUse",
    }),
    (context) => {
      const toolMessage = context.messages.at(-1);
      assert.equal(toolMessage?.role, "toolResult");
      assert.equal(
        JSON.stringify(toolMessage).includes(imageData),
        true,
        JSON.stringify(toolMessage),
      );
      return fauxAssistantMessage("image inspected");
    },
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("inspect_image", "read-only"),
    execute: async (request) => ({
      ...request,
      output: withToolModelAttachments({ kind: "image-result" }, [{
        kind: "image",
        attachmentId: "tool-image-1",
        source: { kind: "data", mimeType: "image/png", data: imageData },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onToolResult: async (toolResult) => {
      // The owning feature is notified only after Pi has appended message_end,
      // so a crash cannot leave a durable run fact ahead of its image entry.
      assert.equal(JSON.stringify(await fixture.session.getBranch()).includes(imageData), true);
      assert.equal(toolModelAttachmentsFromOutput(toolResult.output)?.length, 1);
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(
    toolModelAttachmentsFromOutput(result.toolResults.find((item) => item.callId === "image-call")?.output)?.length,
    1,
  );
  const branchJson = JSON.stringify(await fixture.session.getBranch());
  // 工具产出的图片同样必须进入 durable Session，跨轮引用才成立。
  assert.equal(branchJson.includes(imageData), true);
  await loop.release();

  fixture.faux.setResponses([(context) => {
    assert.equal(
      context.messages.some((message) => message.role === "toolResult" && JSON.stringify(message).includes(imageData)),
      true,
    );
    return fauxAssistantMessage("follow-up tool image inspected");
  }]);
  const secondLoop = createAgentSessionLoop(fixture);
  const second = await secondLoop.execute(loopInput(gateway, {
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "请继续说明刚才工具返回的图片。" },
    ],
  }));

  assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  await secondLoop.release();
});

test("agent session loop rejects tool-origin images when the frozen run capability is text-only", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("tool-image-without-vision").toString("base64");
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("inspect_image", { path: "image.png" }, { id: "text-only-image-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("inspect_image", "read-only"),
    execute: async (request) => ({
      ...request,
      output: withToolModelAttachments({ kind: "image-result" }, [{
        kind: "image",
        attachmentId: "text-only-image",
        source: { kind: "data", mimeType: "image/png", data: imageData },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop({ ...fixture, supportsVisionInput: false });

  const result = await loop.execute(loopInput(gateway, {
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  }));

  assert.equal(result.status, "failed");
  assert.equal(accepted[0]?.status, "failed");
  assert.equal(accepted[0]?.errorFacts?.code, "tool_result_image_input_unsupported");
  assert.equal(accepted[0]?.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(accepted[0]?.errorFacts?.doNotBlindlyRetry, true);
  assert.equal(JSON.stringify(await fixture.session.getBranch()).includes(imageData), false);
  await loop.release();
});

test("agent session loop replaces current user images with a text notice when Pi model.input is text-only", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("current-user-image").toString("base64");
  const textOnlyModel = { ...fixture.selectedModel, input: ["text"] as ("text" | "image")[] };
  let capturedContext: Context | undefined;
  fixture.faux.setResponses([(context) => {
    capturedContext = context;
    return fauxAssistantMessage("The image was not delivered.");
  }]);
  const loop = createAgentSessionLoop({ ...fixture, selectedModel: textOnlyModel });

  const result = await loop.execute(loopInput(emptyGateway(), {
    messages: [{
      role: "user",
      content: "inspect this image",
      attachments: [{
        kind: "image",
        attachmentId: "current-user-image",
        source: { kind: "data", mimeType: "image/png", data: imageData },
      }],
    }],
  }));

  assert.equal(result.status, "completed");
  assert.equal(fixture.faux.state.callCount, 1);
  assert.equal(JSON.stringify(capturedContext?.messages).includes(imageData), false);
  assert.equal(JSON.stringify(capturedContext?.messages).includes("Image not delivered"), true);
  await loop.release();
});

test("agent session loop persists images sent under a text-only model so a later vision model can inspect them", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("deferred-vision-image").toString("base64");
  const textOnlyModel = { ...fixture.selectedModel, input: ["text"] as ("text" | "image")[] };
  let textOnlyContext: Context | undefined;
  fixture.faux.setResponses([(context) => {
    textOnlyContext = context;
    return fauxAssistantMessage("Image could not be inspected.");
  }]);
  const textOnlyLoop = createAgentSessionLoop({ ...fixture, selectedModel: textOnlyModel });

  const first = await textOnlyLoop.execute(loopInput(emptyGateway(), {
    messages: [{
      role: "user",
      content: "inspect this image",
      attachments: [{
        kind: "image",
        attachmentId: "deferred-image",
        source: { kind: "data", mimeType: "image/png", data: imageData },
      }],
    }],
  }));

  assert.equal(first.status, "completed");
  assert.equal(JSON.stringify(textOnlyContext?.messages).includes(imageData), false);
  assert.equal(JSON.stringify(textOnlyContext?.messages).includes("Image not delivered"), true);
  assert.equal(JSON.stringify(await fixture.session.getBranch()).includes(imageData), true);
  await textOnlyLoop.release();

  let visionContext: Context | undefined;
  fixture.faux.setResponses([(context) => {
    visionContext = context;
    return fauxAssistantMessage("Now I can see the image.");
  }]);
  const visionLoop = createAgentSessionLoop(fixture);

  const second = await visionLoop.execute(loopInput(emptyGateway(), {
    messages: [{ role: "user", content: "now inspect it" }],
  }));

  assert.equal(second.status, "completed");
  assert.equal(JSON.stringify(visionContext?.messages).includes(imageData), true);
  assert.equal(JSON.stringify(visionContext?.messages).includes("Image not delivered"), false);
  await visionLoop.release();
});

test("agent session loop replaces historical Session images with a text notice when Pi model.input is text-only", async (t) => {
  const fixture = await createFixture(t);
  const imageData = Buffer.from("historical-session-image").toString("base64");
  await fixture.session.appendMessage({
    role: "user",
    content: [{ type: "image", mimeType: "image/png", data: imageData }],
    timestamp: Date.now(),
  });
  let capturedContext: Context | undefined;
  fixture.faux.setResponses([(context) => {
    capturedContext = context;
    return fauxAssistantMessage("History image could not be inspected.");
  }]);
  const textOnlyModel = { ...fixture.selectedModel, input: ["text"] as ("text" | "image")[] };
  const loop = createAgentSessionLoop({ ...fixture, selectedModel: textOnlyModel });

  const result = await loop.execute(loopInput(emptyGateway(), {
    messages: [{ role: "user", content: "continue" }],
  }));

  assert.equal(result.status, "completed");
  assert.equal(fixture.faux.state.callCount, 1);
  assert.equal(JSON.stringify(capturedContext?.messages).includes(imageData), false);
  assert.equal(JSON.stringify(capturedContext?.messages).includes("Image not delivered"), true);
  await loop.release();
});

test("agent session loop fails unsupported tool attachments instead of dropping them", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read_document", { path: "report.pdf" }, { id: "file-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read_document", "read-only"),
    execute: async (request) => ({
      ...request,
      output: withToolModelAttachments({ kind: "document-result" }, [{
        kind: "file",
        filename: "report.pdf",
        source: {
          kind: "data",
          mimeType: "application/pdf",
          data: Buffer.from("pdf-bytes").toString("base64"),
        },
      }]),
      status: "completed",
      durationMs: 1,
    }),
  });
  const accepted: ToolCallResult[] = [];
  const loop = createAgentSessionLoop(fixture);

  await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(fixture.faux.state.callCount, 1);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.status, "failed");
  assert.equal(accepted[0]?.errorFacts?.code, "tool_result_attachment_not_supported");
  assert.equal(accepted[0]?.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(accepted[0]?.errorFacts?.doNotBlindlyRetry, true);
  await loop.release();
});

test("agent session loop pauses when a read-only executor discovers approval during execution", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "private.txt" }, { id: "dynamic-read" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("private read complete"),
  ]);
  const confirmationRequest = {
    confirmationId: "confirm-dynamic-read",
    toolCallFactId: "dynamic-read",
    title: "Read private file",
    actionSummary: "Read private.txt",
    affectedResources: ["private.txt"],
    riskLevel: "medium" as const,
    requestedAt: "2026-07-20T00:00:00.000Z",
    sourceRefs: [],
  };
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      if (permission.approvedConfirmationIds?.includes("confirm-dynamic-read") !== true) {
        return {
          ...request,
          output: "partial content before the gate",
          status: "approval_required",
          durationMs: 3,
          confirmationRequest,
        };
      }
      return { ...request, output: "private contents", status: "completed", durationMs: 4 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests, [confirmationRequest]);
  assert.equal(executeCount, 1);
  assert.equal(accepted[0]?.status, "approval_required");

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-dynamic-read",
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 2);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "completed"]);
  await loop.release();
});

test("agent session loop keeps concurrent dynamic approvals pending until each is decided", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read", { path: "private-a.txt" }, { id: "dynamic-a" }),
      fauxToolCall("read", { path: "private-b.txt" }, { id: "dynamic-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("both private reads completed"),
  ]);
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      const confirmationId = `confirm-${request.callId}`;
      if (permission.approvedConfirmationIds?.includes(confirmationId) !== true) {
        return {
          ...request,
          output: `partial:${request.callId}`,
          status: "approval_required",
          durationMs: 2,
          confirmationRequest: {
            confirmationId,
            toolCallFactId: request.callId,
            title: "Read private file",
            actionSummary: `Read ${request.callId}`,
            affectedResources: [request.callId],
            riskLevel: "medium" as const,
            requestedAt: "2026-07-20T00:00:00.000Z",
            sourceRefs: [],
          },
        };
      }
      return { ...request, output: `completed:${request.callId}`, status: "completed", durationMs: 3 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.equal(paused.confirmationRequests.length, 2);
  const firstConfirmationId = paused.confirmationRequests[0]!.confirmationId;
  const afterFirstDecision = await paused.continuation.decide({
    decision: {
      confirmationId: firstConfirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(afterFirstDecision.status, "approval_required");
  if (afterFirstDecision.status !== "approval_required") return;
  assert.equal(afterFirstDecision.confirmationRequests.length, 1);
  assert.notEqual(afterFirstDecision.confirmationRequests[0]?.confirmationId, firstConfirmationId);
  assert.equal(executeCount, 3);

  const completed = await afterFirstDecision.continuation.decide({
    decision: {
      confirmationId: afterFirstDecision.confirmationRequests[0]!.confirmationId,
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:02.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 4);
  assert.equal(accepted.filter((result) => result.status === "approval_required").length, 2);
  assert.equal(accepted.filter((result) => result.status === "completed").length, 2);
  assert.equal(accepted.some((result) => result.status === "cancelled"), false);
  await loop.release();
});

test("same-turn read-write calls run concurrently, isolate failures, and return to the model in source order", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("write", { path: "a.txt" }, { id: "write-a" }),
      fauxToolCall("write", { path: "b.txt" }, { id: "write-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("the independent writes were handled"),
  ]);
  let active = 0;
  let maxActive = 0;
  let markSecondStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    execute: async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (request.callId === "write-a") {
          await withDeadline(secondStarted, 1_000, "The second write did not start concurrently.");
          return { ...request, output: "written:a", status: "completed", durationMs: 2 };
        }
        markSecondStarted();
        return {
          ...request,
          output: undefined,
          status: "failed",
          error: "write b failed",
          errorDomain: "tool_error",
          errorFacts: { code: "write_failed" },
          durationMs: 1,
        };
      } finally {
        active -= 1;
      }
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(maxActive, 2);
  assert.equal(result.toolResults.find((item) => item.callId === "write-a")?.status, "completed");
  assert.equal(result.toolResults.find((item) => item.callId === "write-b")?.status, "failed");
  const modelToolResultIds = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []);
  assert.deepEqual(modelToolResultIds, ["write-a", "write-b"]);
  await loop.release();
});

test("same-turn delegated Agent calls start concurrently", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("agent_call", { task: "inspect a" }, { id: "agent-a" }),
      fauxToolCall("agent_call", { task: "inspect b" }, { id: "agent-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("child result"),
    fauxAssistantMessage("child result"),
    fauxAssistantMessage("both delegated results were reviewed"),
  ]);
  let activeResolutions = 0;
  let maxActiveResolutions = 0;
  let releaseResolutions!: () => void;
  const bothResolving = new Promise<void>((resolve) => { releaseResolutions = resolve; });
  const contribution: AgentLoopAgentTool = {
    toolName: "agent_call",
    resolve: async () => {
      activeResolutions += 1;
      maxActiveResolutions = Math.max(maxActiveResolutions, activeResolutions);
      if (activeResolutions === 2) releaseResolutions();
      await withDeadline(bothResolving, 1_000, "The second delegated Agent did not start concurrently.");
      activeResolutions -= 1;
      return {
        agentName: "reviewer",
        instructions: "Return the delegated result.",
        input: "Inspect independently.",
        callerAgentId: "sub-agent:reviewer",
        allowedTools: [],
      };
    },
  };
  const gateway = gatewayFor({
    definition: undefined,
    execute: async () => { throw new Error("No mechanical tools are available."); },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, { agentTools: [contribution] }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(maxActiveResolutions, 2);
  const modelToolResultIds = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []);
  assert.deepEqual(modelToolResultIds, ["agent-a", "agent-b"]);
  await loop.release();
});

test("agent session loop denial rejects only the pending call and lets the model continue", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("I will use another approach."),
  ]);
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest,
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests, [confirmationRequest]);
  assert.equal(executeCount, 0);

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-write",
      decision: "deny",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed");
  if (completed.status !== "completed") return;
  assert.equal(completed.finalText, "I will use another approach.");
  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "failed"]);
  assert.equal(completed.toolResults[0]?.errorFacts?.code, "tool_call_denied");
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop executes an approved tool exactly once", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("write complete"),
  ]);
  const accepted: ToolCallResult[] = [];
  const approvedConfirmationIds: string[][] = [];
  let executeCount = 0;
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: { ...request, output: undefined, status: "approval_required", durationMs: 0, confirmationRequest },
    }),
    execute: async (request, _context, permission) => {
      executeCount += 1;
      approvedConfirmationIds.push([...(permission.approvedConfirmationIds ?? [])]);
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;

  const completed = await paused.continuation.decide({
    decision: {
      confirmationId: "confirm-write",
      decision: "approve_once",
      decidedAt: "2026-07-20T00:00:01.000Z",
    },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed");
  assert.equal(executeCount, 1);
  assert.deepEqual(approvedConfirmationIds, [["confirm-write"]]);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "completed"]);
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("agent session loop releases one static approval while retaining the remaining confirmation", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read", { path: "a.txt" }, { id: "read-a" }),
      fauxToolCall("read", { path: "b.txt" }, { id: "read-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("both private files were read"),
  ]);
  const executions: string[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId: `confirm-${request.callId}`,
          toolCallFactId: request.callId,
          title: "Read private file",
          actionSummary: `Read ${request.callId}`,
          affectedResources: [request.callId],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executions.push(request.callId);
      return { ...request, output: `contents:${request.callId}`, status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.deepEqual(paused.confirmationRequests.map((request) => request.confirmationId).sort(), ["confirm-read-a", "confirm-read-b"]);

  const afterFirstDecision = await paused.continuation.decide({
    decision: { confirmationId: "confirm-read-a", decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(afterFirstDecision.status, "approval_required");
  if (afterFirstDecision.status !== "approval_required") return;
  assert.deepEqual(afterFirstDecision.confirmationRequests.map((request) => request.confirmationId), ["confirm-read-b"]);
  await withDeadline(waitForValue(() => executions.includes("read-a")), 1_000, "Approved tool did not begin before the remaining confirmation.");
  assert.deepEqual(executions, ["read-a"]);

  const completed = await afterFirstDecision.continuation.decide({
    decision: { confirmationId: "confirm-read-b", decision: "approve_once", decidedAt: "2026-07-20T00:00:02.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.deepEqual(executions.sort(), ["read-a", "read-b"]);
  await loop.release();
});

test("agent session loop preserves the original cancellation signal after approval", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const runCancellation = new AbortController();
  let observeToolStart!: () => void;
  const toolStarted = new Promise<void>((resolve) => { observeToolStart = resolve; });
  let observedToolSignal: AbortSignal | undefined;
  const confirmationRequest = writeConfirmationRequest();
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: { ...request, output: undefined, status: "approval_required", durationMs: 0, confirmationRequest },
    }),
    execute: async (request, context) => {
      const toolAbortSignal = context.abortSignal;
      assert.ok(toolAbortSignal, "Tool execution context must include an abort signal.");
      observedToolSignal = toolAbortSignal;
      observeToolStart();
      await new Promise<void>((resolve) => toolAbortSignal.addEventListener("abort", () => resolve(), { once: true }));
      return { ...request, output: undefined, status: "cancelled", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, { abortSignal: runCancellation.signal }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  const resumed = paused.continuation.decide({
    decision: { confirmationId: confirmationRequest.confirmationId, decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });
  await withDeadline(toolStarted, 1_000, "Approved tool did not start.");

  runCancellation.abort(new Error("cancel original run"));
  const result = await withDeadline(resumed, 1_000, "Original run cancellation did not settle the loop.");

  assert.equal(observedToolSignal?.aborted, true);
  assert.equal(result.status, "cancelled");
  await loop.release();
});

test("agent session loop release cancels a tool waiting for approval without executing it", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "write-call" }), {
      stopReason: "toolUse",
    }),
  ]);
  const accepted: ToolCallResult[] = [];
  let executeCount = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: writeConfirmationRequest(),
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");

  await withDeadline(loop.release(), 1_000, "Agent loop release did not settle while approval was pending.");

  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "cancelled"]);
  await loop.release();
});

test("agent session loop stops after the owning feature rejects a tool fact", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "read-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("must not be reached"),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 1,
    }),
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    onToolResult: async () => { throw new Error("tool fact persistence failed"); },
  }));

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.errorCode, "tool_result_acceptance_failed");
  assert.match(result.error, /tool fact persistence failed/);
  assert.equal(fixture.faux.state.callCount, 1);
  await loop.release();
});

test("agent session loop rejects delegated tools when complete result delivery is unavailable", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([fauxAssistantMessage("must not be reached")]);
  const loop = createAgentSessionLoop(fixture);

  await assert.rejects(
    () => loop.execute(loopInput(emptyGateway(), { agentTools: [delegatedAgentTool([])] })),
    /require a gateway with complete result delivery/u,
  );

  assert.equal(fixture.faux.state.callCount, 0);
  await loop.release();
});

test("agent session loop keeps delegated transcripts isolated while preserving nested tool facts", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "shared-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "shared-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated result"),
    fauxAssistantMessage("parent synthesis"),
  ]);
  const accepted: ToolCallResult[] = [];
  const delivered: ToolCallResult[] = [];
  const order: string[] = [];
  let observedCallerAgentId: string | undefined;
  let observedAllowedTools: readonly string[] | undefined;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request, context, permission) => {
      order.push("execute");
      observedCallerAgentId = context.callerAgentId;
      observedAllowedTools = permission.allowedTools;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => {
      delivered.push(result);
      return {
        ...result,
        output: {
          preview: "delegated result",
          continuation: { ref: "tool-output://delegated-result" },
        },
      };
    },
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read"])],
    onNestedToolRequestsAccepted: async (requests) => {
      assert.deepEqual(requests.map((request) => request.factId), [
        "agent-tool:11:shared-call/tool:shared-call",
      ]);
      order.push("accepted");
    },
    onToolResult: async (toolResult) => { accepted.push(toolResult); },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.equal(result.status === "completed" ? result.finalText : undefined, "parent synthesis");
  assert.deepEqual(accepted.map((item) => item.toolName), ["read", "agent_call"]);
  const nested = accepted[0];
  assert.equal(nested?.callId, "shared-call");
  assert.equal(nested?.factId, "agent-tool:11:shared-call/tool:shared-call");
  assert.equal(nested?.parentToolCallFactId, "shared-call");
  assert.deepEqual(accepted[1]?.output, {
    preview: "delegated result",
    continuation: { ref: "tool-output://delegated-result" },
  });
  assert.equal(accepted[1]?.delegatedExecution?.modelRounds, 2);
  assert.equal(accepted[1]?.delegatedExecution?.toolCallCount, 1);
  assert.equal(accepted[1]?.delegatedExecution?.usage.requestCount, 2);
  assert.equal(result.usage.requestCount, 4);
  assert.deepEqual(order, ["accepted", "execute"]);
  assert.equal(observedCallerAgentId, "sub-agent:reviewer");
  assert.deepEqual(observedAllowedTools, ["read"]);
  assert.deepEqual(delivered.map((item) => item.toolName), ["agent_call"]);
  assert.equal(delivered[0]?.output, "delegated result");
  const rootMessages = (await fixture.session.getBranch()).flatMap((entry) =>
    entry.type === "message" ? [entry.message] : []);
  assert.deepEqual(rootMessages.map((message) => message.role), ["user", "assistant", "toolResult", "assistant"]);
  assert.equal(rootMessages.filter((message) => message.role === "toolResult").length, 1);
  assert.equal(rootMessages.find((message) => message.role === "toolResult")?.toolCallId, "shared-call");
  assert.match(JSON.stringify(rootMessages.find((message) => message.role === "toolResult")?.content), /tool-output:\/\/delegated-result/u);
  await loop.release();
});

test("delegated tools accept one provider message as a single nested write-ahead batch", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect both" }, { id: "batch-parent" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([
      fauxToolCall("read", { path: "a.txt" }, { id: "nested-a" }),
      fauxToolCall("read", { path: "b.txt" }, { id: "nested-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("delegated batch complete"),
    fauxAssistantMessage("parent synthesis"),
  ]);
  const acceptedBatches: string[][] = [];
  let executeCalls = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => {
      assert.equal(acceptedBatches.length, 1, "the whole nested batch must be accepted before execution");
      executeCalls += 1;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read"])],
    async onNestedToolRequestsAccepted(requests) {
      acceptedBatches.push(requests.map((request) => toolCallFactId(request)));
    },
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  assert.deepEqual(acceptedBatches, [[
    "agent-tool:12:batch-parent/tool:nested-a",
    "agent-tool:12:batch-parent/tool:nested-b",
  ]]);
  assert.equal(executeCalls, 2);
  await loop.release();
});

test("delegated tools never reach preflight when nested request acceptance fails", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate-wal-failure" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "nested-wal-failure" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child must not continue"),
    fauxAssistantMessage("parent must not continue"),
  ]);
  let preflightCalls = 0;
  let executeCalls = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    preflight: (request) => {
      preflightCalls += 1;
      return { status: "ready", request };
    },
    execute: async (request) => {
      executeCalls += 1;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read"])],
    async onNestedToolRequestsAccepted() {
      throw new Error("nested request persistence failed");
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "tool_request_acceptance_failed");
  assert.match(result.status === "failed" ? result.error : "", /nested request persistence failed/u);
  assert.equal(preflightCalls, 0);
  assert.equal(executeCalls, 0);
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

test("delegated tools reject a reused scoped call identity before a second side effect", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect twice" }, { id: "delegate-reuse" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "a.txt" }, { id: "nested-reuse" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "b.txt" }, { id: "nested-reuse" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child must not continue"),
    fauxAssistantMessage("parent must not continue"),
  ]);
  let executeCalls = 0;
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => {
      executeCalls += 1;
      return { ...request, output: "contents", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read"])],
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "session_tool_request_duplicate");
  assert.equal(executeCalls, 1);
  assert.equal(fixture.faux.state.callCount, 3);
  await loop.release();
});

test("delegated tool approval resumes once with the continuation abort signal", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "write" }, { id: "delegate-call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "nested-write" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated write complete"),
    fauxAssistantMessage("parent complete"),
  ]);
  const confirmationId = "confirm-nested-write";
  let executeCount = 0;
  let observedAbortSignal: AbortSignal | undefined;
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request, context) => {
      executeCount += 1;
      observedAbortSignal = context.abortSignal;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write"])],
  }));

  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  assert.equal(paused.confirmationRequests[0]?.toolCallFactId, "agent-tool:13:delegate-call/tool:nested-write");
  const resumed = new AbortController();
  const completed = await paused.continuation.decide({
    decision: { confirmationId, decision: "approve_once", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: resumed.signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(executeCount, 1);
  assert.equal(observedAbortSignal?.aborted, false);
  resumed.abort(new Error("cancel delegated continuation"));
  assert.equal(observedAbortSignal?.aborted, true);
  await loop.release();
});

test("denying a delegated tool call does not stop the child or parent model loops", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "write" }, { id: "delegate-deny" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "nested-deny" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("delegated agent adapted after denial"),
    fauxAssistantMessage("parent accepted the alternative"),
  ]);
  const confirmationId = "confirm-nested-deny";
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId,
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write"])],
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;

  const completed = await paused.continuation.decide({
    decision: { confirmationId, decision: "deny", decidedAt: "2026-07-20T00:00:01.000Z" },
    abortSignal: new AbortController().signal,
  });

  assert.equal(completed.status, "completed", completed.status === "failed" ? completed.error : undefined);
  assert.equal(completed.status === "completed" ? completed.finalText : undefined, "parent accepted the alternative");
  assert.equal(executeCount, 0);
  assert.deepEqual(accepted.map((result) => result.status), ["approval_required", "failed", "completed"]);
  assert.equal(accepted[1]?.errorFacts?.code, "tool_call_denied");
  assert.equal(fixture.faux.state.callCount, 4);
  await loop.release();
});

test("rejecting a nested tool fact stops both delegated and parent provider loops", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "inspect" }, { id: "delegate-persistence" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }, { id: "nested-persistence" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child must not continue"),
    fauxAssistantMessage("parent must not continue"),
  ]);
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async (request) => ({
      ...request,
      output: "contents",
      status: "completed",
      durationMs: 1,
    }),
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["read"])],
    onToolResult: async (toolResult) => {
      accepted.push(toolResult);
      if (toolResult.parentToolCallFactId !== undefined) {
        throw new Error("nested fact persistence failed");
      }
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorCode : undefined, "tool_result_acceptance_failed");
  assert.equal(fixture.faux.state.callCount, 2);
  assert.equal(accepted.some((item) => item.parentToolCallFactId !== undefined), true);
  assert.equal(accepted.some((item) => item.toolName === "agent_call"), true);
  await loop.release();
});

test("releasing the parent loop cancels a delegated approval wait without executing it", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "write" }, { id: "delegate-release" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write", { path: "a.txt" }, { id: "nested-release" }), {
      stopReason: "toolUse",
    }),
  ]);
  let executeCount = 0;
  const accepted: ToolCallResult[] = [];
  const gateway = gatewayFor({
    definition: toolDefinition("write", "read-write"),
    preflight: (request) => ({
      status: "approval_required",
      result: {
        ...request,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
        confirmationRequest: {
          confirmationId: "confirm-nested-release",
          toolCallFactId: request.factId ?? request.callId,
          title: "Write file",
          actionSummary: "Write a.txt",
          affectedResources: ["a.txt"],
          riskLevel: "medium",
          requestedAt: "2026-07-20T00:00:00.000Z",
          sourceRefs: [],
        },
      },
    }),
    execute: async (request) => {
      executeCount += 1;
      return { ...request, output: "written", status: "completed", durationMs: 1 };
    },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const paused = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write"])],
    onToolResult: async (result) => { accepted.push(result); },
  }));
  assert.equal(paused.status, "approval_required");

  await withDeadline(loop.release(), 1_000, "Delegated approval wait did not settle during release.");

  assert.equal(executeCount, 0);
  assert.equal(fixture.faux.state.callCount, 2);
  assert.equal(accepted.some((result) =>
    result.parentToolCallFactId === "delegate-release" && result.status === "cancelled"), true);
  assert.equal(accepted.some((result) =>
    result.toolName === "agent_call" && result.parentToolCallFactId === undefined && result.status === "cancelled"), true);
  await loop.release();
});

test("delegated agents cannot expand the parent tool boundary or recurse", async (t) => {
  const fixture = await createFixture(t);
  fixture.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("agent_call", { task: "expand" }, { id: "delegate-outside" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("parent handled delegation failure"),
  ]);
  const gateway = gatewayFor({
    definition: toolDefinition("read", "read-only"),
    execute: async () => { throw new Error("Nested execution must not start."); },
    deliverResult: async (result) => result,
  });
  const loop = createAgentSessionLoop(fixture);

  const result = await loop.execute(loopInput(gateway, {
    agentTools: [delegatedAgentTool(["write", "agent_call"])],
  }));

  assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  const delegatedResult = result.toolResults.find((item) => item.toolName === "agent_call");
  assert.equal(delegatedResult?.status, "failed");
  assert.match(delegatedResult?.error ?? "", /outside the parent boundary/u);
  assert.equal(fixture.faux.state.callCount, 2);
  await loop.release();
});

async function createFixture(
  t: test.TestContext,
  options?: Parameters<typeof fauxProvider>[0],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-session-loop-"));
  const env = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await env.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const faux = fauxProvider(options);
  const models = createModels();
  models.setProvider(faux.provider);
  const session = await new InMemorySessionRepo().create({ id: "run-1" });
  return {
    executionEnvironment: env,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    agentSession: session,
    session,
    faux,
  };
}

async function createPayloadAwareFixture(
  t: test.TestContext,
  options?: Parameters<typeof fauxProvider>[0],
) {
  const fixture = await createFixture(t, options);
  const original = fixture.faux.provider;
  const provider: typeof original = {
    ...original,
    stream(model, context, streamOptions) {
      void Promise.resolve(streamOptions?.onPayload?.({ tools: context.tools }, model)).catch(() => undefined);
      return original.stream(model, context, streamOptions);
    },
    streamSimple(model, context, streamOptions) {
      void Promise.resolve(streamOptions?.onPayload?.({ tools: context.tools }, model)).catch(() => undefined);
      return original.streamSimple(model, context, streamOptions);
    },
  };
  const modelRegistry = createModels();
  modelRegistry.setProvider(provider);
  const selectedModel = modelRegistry.getModel(provider.id, fixture.selectedModel.id);
  if (selectedModel === undefined) throw new Error("Payload-aware faux provider did not expose its selected model.");
  return { ...fixture, modelRegistry, selectedModel };
}

function loopInput(
  gateway: ToolExecutionGateway,
  overrides: Partial<AgentLoopInput> = {},
): AgentLoopInput {
  const contributedDefinitions = (overrides.agentTools ?? []).map((tool) => delegatedAgentToolDefinition(tool.toolName));
  return {
    instructions: "You are the Ordinary Agent.",
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: "help" },
    ],
    tools: {
      definitions: [...gateway.list(), ...contributedDefinitions],
      gateway,
      context: { callerAgentId: "ordinary", traceId: "run-1", goalId: "run-1" },
      permission: { callerAgentId: "ordinary", allowedTools: gateway.list().map((tool) => tool.name) },
    },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function delegatedAgentToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: "Call a specialist Agent for one bounded task.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      additionalProperties: true,
    },
    metadata: {
      category: "other",
      riskLevel: "medium",
      operationType: "read-write",
      requiresConfirmation: false,
    },
  };
}

function emptyGateway(): ToolExecutionGateway {
  return gatewayFor({
    definition: undefined,
    execute: async () => { throw new Error("No tools are available."); },
  });
}

function gatewayFor(input: {
  readonly definition: ToolDefinition | undefined;
  readonly preflight?: ToolExecutionGateway["preflight"];
  readonly execute: (
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ) => Promise<ToolCallResult>;
  readonly deliverResult?: NonNullable<ToolExecutionGateway["deliverResult"]>;
}): ToolExecutionGateway {
  const definitions = input.definition === undefined ? [] : [input.definition];
  return {
    list: () => globalThis.structuredClone(definitions),
    has: (name) => definitions.some((definition) => definition.name === name),
    preflight: input.preflight ?? ((request) => ({ status: "ready", request })),
    execute: input.execute,
    ...(input.deliverResult === undefined ? {} : { deliverResult: input.deliverResult }),
  };
}

function gatewayForDefinitions(
  definitions: readonly ToolDefinition[],
  execute: (
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ) => Promise<ToolCallResult>,
): ToolExecutionGateway {
  return {
    list: () => [...globalThis.structuredClone(definitions)],
    has: (name) => definitions.some((definition) => definition.name === name),
    preflight: (request) => ({ status: "ready", request }),
    execute,
  };
}

function delegatedAgentTool(allowedTools: readonly string[]): AgentLoopAgentTool {
  return {
    toolName: "agent_call",
    resolve: async () => ({
      agentName: "reviewer",
      instructions: "Review the delegated task and return the complete result.",
      input: "Inspect the requested material.",
      callerAgentId: "sub-agent:reviewer",
      allowedTools,
    }),
  };
}

function toolDefinition(name: string, operationType: "read-only" | "read-write"): ToolDefinition {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    metadata: {
      category: "workspace",
      riskLevel: operationType === "read-only" ? "low" : "medium",
      operationType,
      requiresConfirmation: operationType !== "read-only",
    },
  };
}

function mcpToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Execute frozen MCP tool ${name}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    metadata: {
      category: "mcp",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function progressivePlan(input: {
  readonly initialNames: readonly string[];
  readonly deferred: readonly {
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly serverId: string;
  }[];
}): AgentLoopToolVisibilityPlan {
  return {
    policyId: "mcp-progressive/v1",
    snapshotId: "progressive-test-snapshot",
    costGate: {
      minimumDeferredDefinitionTokens: 1,
      minimumNetDefinitionSavingsTokens: 1,
      definitionSerialization: { api: "openai-responses", includeStrict: true },
    },
    initiallyVisibleToolNames: input.initialNames,
    deferredTools: input.deferred.map((tool) => ({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      source: { kind: "mcp", id: tool.serverId, label: "Documentation" },
      definitionHash: `sha256:${tool.name}`,
    })),
    controls: {
      search: {
        name: "mcp_search",
        description: "Search the frozen MCP tool catalog without loading or executing tools.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 200 },
            server_id: { type: "string", minLength: 1, maxLength: 128 },
            cursor: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          },
          additionalProperties: false,
        },
        metadata: {
          category: "mcp",
          riskLevel: "low",
          operationType: "read-only",
          requiresConfirmation: false,
        },
      },
      load: {
        name: "mcp_load",
        description: "Expose authorized frozen MCP definitions from the next model request.",
        inputSchema: {
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
        },
        metadata: {
          category: "mcp",
          riskLevel: "low",
          operationType: "read-write",
          requiresConfirmation: false,
        },
      },
    },
  };
}

function progressiveCounter(...expensiveToolNames: readonly string[]): (serialized: string) => number {
  return (serialized) => serialized.length +
    expensiveToolNames.filter((name) => serialized.includes(`\"name\":\"${name}\"`)).length * 20_000;
}

function oversizedReportTool(execute: ToolExecutor["execute"]): ToolExecutor {
  return {
    definition: {
      name: "produce_report",
      description: "Produce a report for the current task.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      metadata: {
        category: "workspace",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    execute,
  };
}

function writeConfirmationRequest() {
  return {
    confirmationId: "confirm-write",
    toolCallFactId: "write-call",
    title: "Write file",
    actionSummary: "Write a.txt",
    affectedResources: ["a.txt"],
    riskLevel: "medium" as const,
    requestedAt: "2026-07-20T00:00:00.000Z",
    sourceRefs: [],
  };
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForValue(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
