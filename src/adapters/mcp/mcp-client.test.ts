import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS,
  modelVisibleToolDescription,
  toolModelAttachmentsFromOutput,
  type ToolExecutorResult,
  validateModelVisibleToolContract,
} from "../../domain/tools/index.js";
import { toolResultMessage } from "../../kernel/intelligence/tool-use-loop-messages.js";
import { createReadToolOutputTool } from "../../app/tool-center/adapters/tool-output-read-tool.js";
import { InMemoryToolOutputStore } from "../../app/tool-center/tool-output-store.js";
import { ToolCenter } from "../../app/tool-center/tool-center.js";
import { McpCatalogLimitError, McpClientWrapper } from "./mcp-client.js";
import {
  createCachedMcpToolExecutor,
  createMcpToolExecutor,
  type McpToolOutput,
} from "./mcp-tool-adapter.js";
import { McpManager } from "./mcp-manager.js";
import { ensureManagedMcpExecutable, mcpManagedRuntimeDirectories, resolveMcpExecutable } from "./mcp-local-runtime.js";

const RESOURCE_IMAGE_DATA = Buffer.from("resource-image", "utf8").toString("base64");
const RESOURCE_BINARY_DATA = Buffer.from("binary", "utf8").toString("base64");

function createTestServer() {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echoes input back",
      inputSchema: { message: z.string() },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Echo: ${args.message}` }],
    })
  );
  server.registerTool(
    "query-docs",
    {
      description: "Queries documentation",
      inputSchema: { query: z.string() },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Docs: ${args.query}` }],
    }),
  );
  server.registerTool(
    "fail_tool",
    {
      description: "Always fails",
    },
    async () => ({
      content: [{ type: "text" as const, text: "Something went wrong." }],
      isError: true,
    })
  );
  server.registerTool(
    "read_only_tool",
    {
      description: "Read-only hint tool",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true, title: "Read Only" },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Result: ${args.query}` }],
    })
  );
  server.registerTool(
    "structured_tool",
    {
      description: "Returns text and structured content",
      inputSchema: { id: z.string() },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Loaded ${args.id}` }],
      structuredContent: {
        id: args.id,
        records: [{ title: "Structured record", score: 1 }],
      },
    })
  );
  server.registerTool(
    "resource_tool",
    {
      description: "Returns current MCP resource content types",
    },
    async () => ({
      content: [
        {
          type: "resource_link" as const,
          uri: "memory://records/1",
          name: "record-1",
          title: "Record one",
          description: "Retrievable record",
          mimeType: "text/plain",
          size: 12,
        },
        {
          type: "resource" as const,
          resource: {
            uri: "memory://records/1/body",
            mimeType: "text/plain",
            text: "Resource body",
          },
        },
        {
          type: "resource" as const,
          resource: {
            uri: "memory://records/1/image",
            mimeType: "image/png",
            blob: RESOURCE_IMAGE_DATA,
          },
        },
        {
          type: "resource" as const,
          resource: {
            uri: "memory://records/1/binary",
            mimeType: "application/octet-stream",
            blob: RESOURCE_BINARY_DATA,
          },
        },
      ],
    })
  );
  server.registerTool(
    "destructive_tool",
    {
      description: "Mutates external state",
      inputSchema: { value: z.string() },
      annotations: { destructiveHint: true, title: "Destructive" },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Mutated: ${args.value}` }],
    })
  );
  server.registerTool(
    "open_world_tool",
    {
      description: "Submits data outside the local workspace",
      inputSchema: { value: z.string() },
      annotations: { openWorldHint: true, title: "Open World" },
    },
    async (args) => ({
      content: [{ type: "text" as const, text: `Submitted: ${args.value}` }],
    })
  );
  return server;
}

async function createConnectedPair() {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClientWrapper(
    {
      serverId: "test-server",
      transport: "stdio",
    },
    { transport: clientTransport }
  );
  await client.connect();
  return { client, server };
}

function createFakeMcpExecutor(
  client: McpClientWrapper,
  name: string,
  annotations?: Parameters<typeof createMcpToolExecutor>[1]["annotations"],
) {
  return createMcpToolExecutor(
    client,
    {
      name,
      description: `Test MCP tool ${name}`,
      inputSchema: { type: "object", properties: {} },
      annotations,
    },
    "fake-server"
  );
}

test("McpClientWrapper connects and disconnects", async () => {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClientWrapper(
    {
      serverId: "test-server",
      transport: "stdio",
    },
    { transport: clientTransport }
  );

  assert.equal(client.isConnected(), false);
  await client.connect();
  assert.equal(client.isConnected(), true);
  await client.disconnect();
  assert.equal(client.isConnected(), false);
});

test("McpClientWrapper listTools returns expected format", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  assert.equal(tools.length, 8);

  const echo = tools.find((t) => t.name === "echo");
  assert.ok(echo);
  assert.equal(echo.description, "Echoes input back");
  assert.deepEqual(echo.inputSchema.properties, { message: { type: "string" } });
  assert.deepEqual(echo.inputSchema.required, ["message"]);

  await client.disconnect();
});

test("McpClientWrapper follows MCP pagination for tools and references", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {
      "tools/list": [
        {
          tools: [
            {
              name: "lookup",
              title: "Lookup",
              description: "Lookup docs.",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
              outputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
              annotations: { readOnlyHint: true },
            },
          ],
          nextCursor: "tools-page-2",
        },
        {
          tools: [
            {
              name: "mutate",
              description: "Mutate docs.",
              inputSchema: { type: "object", properties: {} },
              annotations: { destructiveHint: true },
            },
          ],
        },
      ],
      "prompts/list": [
        {
          prompts: [
            {
              name: "draft",
              title: "Draft",
              description: "Draft a summary.",
              arguments: [{ name: "topic", description: "Topic", required: true }],
            },
          ],
          nextCursor: "prompts-page-2",
        },
        {
          prompts: [{ name: "revise", description: "Revise a summary." }],
        },
      ],
      "resources/list": [
        {
          resources: [
            {
              uri: "docs://guide",
              name: "guide",
              title: "Guide",
              description: "Static guide.",
              mimeType: "text/plain",
              size: 42,
            },
          ],
        },
      ],
      "resources/templates/list": [
        {
          resourceTemplates: [
            {
              uriTemplate: "docs://guide/{topic}",
              name: "guide-topic",
              title: "Guide Topic",
              description: "Topic guide.",
              mimeType: "text/plain",
            },
          ],
          nextCursor: "templates-page-2",
        },
        {
          resourceTemplates: [{ uriTemplate: "docs://faq/{topic}", name: "faq-topic" }],
        },
      ],
    },
  });
  const client = new McpClientWrapper(
    { serverId: "paginated-server", transport: "stdio" },
    { transport }
  );

  await client.connect();
  const tools = await client.listTools();
  const references = await client.listReferences();

  assert.deepEqual(tools.map((tool) => tool.name), ["lookup", "mutate"]);
  assert.equal(tools[0]?.title, "Lookup");
  assert.deepEqual(tools[0]?.outputSchema?.required, ["text"]);
  assert.deepEqual(references.prompts.map((prompt) => prompt.name), ["draft", "revise"]);
  assert.deepEqual(references.resources.map((resource) => resource.name), ["guide"]);
  assert.deepEqual(references.resourceTemplates.map((template) => template.name), ["guide-topic", "faq-topic"]);
  assert.deepEqual(transport.cursorsFor("tools/list"), [undefined, "tools-page-2"]);
  assert.deepEqual(transport.cursorsFor("prompts/list"), [undefined, "prompts-page-2"]);
  assert.deepEqual(transport.cursorsFor("resources/templates/list"), [undefined, "templates-page-2"]);

  await client.disconnect();
});

test("McpClientWrapper rejects a tool catalog that exceeds the configured item boundary", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {
      "tools/list": [{
        tools: [
          { name: "first", inputSchema: { type: "object" } },
          { name: "second", inputSchema: { type: "object" } },
        ],
      }],
    },
  });
  const client = new McpClientWrapper(
    { serverId: "large-tool-catalog", transport: "stdio", maxToolCatalogItems: 1 },
    { transport },
  );

  await client.connect();
  await assert.rejects(
    () => client.listTools(),
    (error: unknown) => {
      assert.ok(error instanceof McpCatalogLimitError);
      assert.equal(error.code, "mcp_catalog_limit_exceeded");
      assert.equal(error.catalogKind, "tools");
      assert.equal(error.unit, "items");
      assert.equal(error.observed, 2);
      assert.equal(error.limit, 1);
      return true;
    },
  );
  await client.disconnect();
});

test("McpClientWrapper rejects a tool catalog that exceeds the serialized metadata boundary", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {
      "tools/list": [{
        tools: [{
          name: "oversized",
          description: "x".repeat(256),
          inputSchema: { type: "object" },
        }],
      }],
    },
  });
  const client = new McpClientWrapper(
    { serverId: "large-tool-metadata", transport: "stdio", maxToolCatalogBytes: 128 },
    { transport },
  );

  await client.connect();
  await assert.rejects(
    () => client.listTools(),
    (error: unknown) => {
      assert.ok(error instanceof McpCatalogLimitError);
      assert.equal(error.catalogKind, "tools");
      assert.equal(error.unit, "serialized_bytes");
      assert.equal(error.observed > error.limit, true);
      return true;
    },
  );
  await client.disconnect();
});

test("McpClientWrapper applies one shared item boundary to the complete reference catalog", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {
      "prompts/list": [{ prompts: [{ name: "draft" }] }],
      "resources/list": [{ resources: [{ uri: "docs://guide", name: "guide" }] }],
      "resources/templates/list": [{ resourceTemplates: [] }],
    },
  });
  const client = new McpClientWrapper(
    { serverId: "large-reference-catalog", transport: "stdio", maxReferenceCatalogItems: 1 },
    { transport },
  );

  await client.connect();
  await assert.rejects(
    () => client.listReferences(),
    (error: unknown) => {
      assert.ok(error instanceof McpCatalogLimitError);
      assert.equal(error.code, "mcp_catalog_limit_exceeded");
      assert.equal(error.catalogKind, "references");
      assert.equal(error.unit, "items");
      assert.equal(error.observed, 2);
      assert.equal(error.limit, 1);
      return true;
    },
  );
  await client.disconnect();
});

test("McpClientWrapper rejects repeated MCP pagination cursors", async () => {
  const client = new McpClientWrapper(
    { serverId: "repeated-cursor-server", transport: "stdio" },
    {
      transport: new PaginatedMcpTestTransport({
        pages: {
          "tools/list": [
            {
              tools: [
                {
                  name: "first",
                  description: "First page.",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              nextCursor: "same",
            },
            {
              tools: [
                {
                  name: "second",
                  description: "Second page.",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              nextCursor: "same",
            },
          ],
        },
      }),
    }
  );

  await client.connect();
  await assert.rejects(() => client.listTools(), /repeated cursor/);
  await client.disconnect();
});

test("McpClientWrapper reports reference listing failures instead of projecting an empty catalog", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {},
    failures: {
      "prompts/list": { code: -32000, message: "prompt catalog denied" },
    },
  });
  const client = new McpClientWrapper(
    { serverId: "reference-failure-server", transport: "stdio" },
    { transport },
  );

  await client.connect();
  await assert.rejects(
    () => client.listReferences(),
    /MCP prompts listing failed:.*prompt catalog denied/u,
  );
  await client.disconnect();
});

test("McpClientWrapper treats an explicitly unsupported reference method as an empty category", async () => {
  const transport = new PaginatedMcpTestTransport({
    pages: {},
    failures: {
      "prompts/list": { code: -32601, message: "Method not found" },
    },
  });
  const client = new McpClientWrapper(
    { serverId: "unsupported-reference-server", transport: "stdio" },
    { transport },
  );

  await client.connect();
  const references = await client.listReferences();
  assert.deepEqual(references.prompts, []);
  await client.disconnect();
});

test("McpClientWrapper callTool returns expected text result", async () => {
  const { client } = await createConnectedPair();

  const result = await client.callTool("echo", { message: "hello" });
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  const textPart = result.content[0];
  assert.ok(textPart.type === "text");
  if (textPart.type === "text") {
    assert.equal(textPart.text, "Echo: hello");
  }

  await client.disconnect();
});

test("McpClientWrapper callTool handles error result", async () => {
  const { client } = await createConnectedPair();

  const result = await client.callTool("fail_tool", {});
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  const textPart = result.content[0];
  assert.ok(textPart.type === "text");
  if (textPart.type === "text") {
    assert.equal(textPart.text, "Something went wrong.");
  }

  await client.disconnect();
});

test("McpClientWrapper bounds per-server concurrency and cancels queued calls", async () => {
  const server = new McpServer({ name: "slow-server", version: "1.0.0" });
  let startedResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  server.registerTool("slow", { description: "Slow tool" }, async () => {
    startedResolve?.();
    await release;
    return { content: [{ type: "text" as const, text: "done" }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClientWrapper(
    { serverId: "slow-server", transport: "stdio", maxConcurrentCalls: 1 },
    { transport: clientTransport },
  );
  await client.connect();
  try {
    const first = client.callTool("slow", {});
    await started;
    const controller = new AbortController();
    const queued = client.callTool("slow", {}, { signal: controller.signal });
    controller.abort("queued call cancelled");
    await assert.rejects(queued, (error: unknown) => {
      assert.equal(error instanceof Error ? error.name : undefined, "AbortError");
      return true;
    });
    releaseResolve?.();
    const firstResult = await first;
    assert.equal(firstResult.content[0]?.type, "text");
  } finally {
    await client.disconnect();
  }
});

test("McpClientWrapper exposes degraded health after timeout and recovers after success", async () => {
  const server = new McpServer({ name: "health-server", version: "1.0.0" });
  let releaseResolve: (() => void) | undefined;
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  server.registerTool("slow", { description: "Health probe tool" }, async () => {
    await release;
    return { content: [{ type: "text" as const, text: "healthy" }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClientWrapper(
    { serverId: "health-server", transport: "stdio", requestIdleTimeoutMs: 20 },
    { transport: clientTransport },
  );
  await client.connect();
  try {
    await assert.rejects(() => client.callTool("slow", {}), /timed out/i);
    const degraded = client.getRuntimeSnapshot();
    assert.equal(degraded.health, "degraded");
    assert.match(degraded.lastCallFailure?.message ?? "", /timed out/i);

    releaseResolve?.();
    const recovered = await client.callTool("slow", {});
    assert.equal(recovered.content[0]?.type, "text");
    assert.deepEqual(client.getRuntimeSnapshot(), {
      health: "healthy",
      activeToolCalls: 0,
      queuedToolCalls: 0,
    });
  } finally {
    releaseResolve?.();
    await client.disconnect();
  }
});

test("McpClientWrapper keeps server health unchanged when the user cancels an active call", async () => {
  const server = new McpServer({ name: "cancel-server", version: "1.0.0" });
  let startedResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  server.registerTool("wait", { description: "Wait until cancelled" }, async () => {
    startedResolve?.();
    await release;
    return { content: [{ type: "text" as const, text: "released" }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClientWrapper(
    { serverId: "cancel-server", transport: "stdio", maxConcurrentCalls: 1 },
    { transport: clientTransport },
  );
  await client.connect();
  try {
    const controller = new AbortController();
    const running = client.callTool("wait", {}, { signal: controller.signal });
    await started;
    controller.abort("cancelled by user");
    await assert.rejects(running);
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(client.getRuntimeSnapshot(), {
      health: "healthy",
      activeToolCalls: 0,
      queuedToolCalls: 0,
      maxConcurrentCalls: 1,
    });
  } finally {
    releaseResolve?.();
    await client.disconnect();
  }
});

test("MCP adapter turns an MCP request timeout into an explicit unknown-outcome failure", async () => {
  const controller = new AbortController();
  const timeoutError = Object.assign(new Error("MCP request timed out"), {
    code: -32001,
    data: { timeout: 25 },
  });
  const client = {
    async callTool(_name: string, _input: unknown, options?: { readonly signal?: AbortSignal }) {
      assert.equal(options?.signal?.aborted, false);
      throw timeoutError;
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "slow_tool");

  const output = await executor.execute(
    { query: "long-running" },
    {
      callerAgentId: "test-agent",
      traceId: "trace-1",
      goalId: "goal-1",
      toolCallId: "call-timeout",
      abortSignal: controller.signal,
    },
  );

  assert.equal((output as ToolExecutorResult).kind, "tool_call_result");
  const result = (output as ToolExecutorResult).result;
  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_request_idle_timeout");
  assert.equal(result.errorFacts?.sourceExecutionStatus, "unknown");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
  assert.equal(result.errorFacts?.timeoutMs, 25);
});

test("MCP adapter forwards progress as live-only tool observation", async () => {
  const observed: unknown[] = [];
  const client = {
    async callTool(_name: string, _input: unknown, options?: { readonly onProgress?: (progress: { progress: number; total: number; message: string }) => void }) {
      options?.onProgress?.({ progress: 2, total: 5, message: "searching" });
      return { content: [{ type: "text" as const, text: "result" }] };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "progress_tool");

  const output = await executor.execute(
    {},
    {
      callerAgentId: "test-agent",
      traceId: "trace-1",
      goalId: "goal-1",
      reportProgress: (progress) => observed.push(progress),
    },
  );

  assert.equal((output as { readonly kind: string }).kind, undefined);
  assert.deepEqual(observed, [{ kind: "mcp_progress", progress: 2, total: 5, message: "searching" }]);
});

test("McpClientWrapper callTool preserves structuredContent", async () => {
  const { client } = await createConnectedPair();

  const result = await client.callTool("structured_tool", { id: "record-1" });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    id: "record-1",
    records: [{ title: "Structured record", score: 1 }],
  });
  assert.equal(result.content[0]?.type, "text");

  await client.disconnect();
});

test("McpClientWrapper throws when not connected", async () => {
  const client = new McpClientWrapper(
    { serverId: "test-server", transport: "stdio" },
    { transport: InMemoryTransport.createLinkedPair()[0] }
  );

  await assert.rejects(() => client.listTools(), /not connected/);
  await assert.rejects(() => client.callTool("echo", {}), /not connected/);
});

test("createMcpToolExecutor creates correct namespaced ToolExecutor", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const echoTool = tools.find((t) => t.name === "echo")!;
  const executor = createMcpToolExecutor(client, echoTool, "my-server");

  assert.equal(executor.definition.name, "my_server__echo");
  assert.equal(executor.definition.description, "Echoes input back");
  assert.equal(executor.definition.metadata?.category, "mcp");
  assert.equal(executor.definition.metadata?.riskLevel, "medium");
  assert.equal(executor.definition.metadata?.operationType, "execute");
  const validation = validateModelVisibleToolContract(executor.definition);
  assert.equal(validation.ok, true, validation.missing.join(", "));

  await client.disconnect();
});

test("MCP tool identity is canonicalized once while remote invocation keeps the original name", async () => {
  const { client } = await createConnectedPair();
  const tool = (await client.listTools()).find((item) => item.name === "query-docs")!;
  const executor = createMcpToolExecutor(client, tool, "my-server");

  assert.equal(executor.definition.name, "my_server__query_docs");
  const identity = executor.definition.metadata?.runtimeHints?.find((hint) => hint.kind === "mcp_tool");
  assert.equal(identity?.serverId, "my-server");
  assert.equal(identity?.protocolName, "query-docs");
  assert.deepEqual(
    await executor.execute(
      { query: "identity" },
      { callerAgentId: "test-agent", traceId: "trace-identity", goalId: "goal-identity" },
    ),
    { content: [{ type: "text", text: "Docs: identity" }] },
  );

  await client.disconnect();
});

test("createCachedMcpToolExecutor preserves MCP description facts and defers provider budgeting", () => {
  const finalConstraint = `Workflow guidance: ${"preserve server constraint ".repeat(30).trim()}.`;
  const executor = createCachedMcpToolExecutor(
    {
      name: "docs_search",
      description: [
        "Search documentation for a query and return the most relevant passages.",
        "Use this for current API references that are not already present in the workspace.",
        "",
        finalConstraint,
      ].join("\n"),
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
    },
    "docs"
  );

  assert.equal(executor.definition.description.includes(finalConstraint), true);
  assert.equal(executor.definition.description.includes("\n"), false);
  const modelDescription = modelVisibleToolDescription(executor.definition);
  assert.equal(modelDescription.length <= MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS, true);
  assert.match(modelDescription, /^Search documentation for a query/m);
  assert.match(modelDescription, /…\[truncated\]$/u);
});

test("MCP canonical name collisions fail during registration", () => {
  const first = createCachedMcpToolExecutor({
    name: "query-docs",
    description: "First query tool.",
    inputSchema: { type: "object", properties: {} },
  }, "docs");
  const second = createCachedMcpToolExecutor({
    name: "query_docs",
    description: "Second query tool.",
    inputSchema: { type: "object", properties: {} },
  }, "docs");
  const center = new ToolCenter();
  center.register(first);

  assert.equal(first.definition.name, "docs__query_docs");
  assert.equal(second.definition.name, "docs__query_docs");
  assert.throws(() => center.register(second), /already registered/u);
});

test("createMcpToolExecutor infers read-only metadata from annotations", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const readOnlyTool = tools.find((t) => t.name === "read_only_tool")!;
  const executor = createMcpToolExecutor(client, readOnlyTool, "my-server", {
    confirmationMode: "unsafe_only",
    autoApprovedTools: [],
  });

  assert.equal(executor.definition.name, "my_server__read_only_tool");
  assert.equal(executor.definition.metadata?.category, "mcp");
  assert.equal(executor.definition.metadata?.riskLevel, "low");
  assert.equal(executor.definition.metadata?.operationType, "read-only");
  assert.equal(executor.definition.metadata?.requiresConfirmation, false);

  await client.disconnect();
});

test("createMcpToolExecutor requires confirmation for unsafe MCP tools in unsafe_only mode", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const destructiveTool = tools.find((t) => t.name === "destructive_tool")!;
  const openWorldTool = tools.find((t) => t.name === "open_world_tool")!;
  const destructiveExecutor = createMcpToolExecutor(client, destructiveTool, "my-server", {
    confirmationMode: "unsafe_only",
    autoApprovedTools: [],
  });
  const openWorldExecutor = createMcpToolExecutor(client, openWorldTool, "my-server", {
    confirmationMode: "unsafe_only",
    autoApprovedTools: [],
  });

  assert.equal(destructiveExecutor.definition.metadata?.riskLevel, "high");
  assert.equal(destructiveExecutor.definition.metadata?.operationType, "read-write");
  assert.equal(destructiveExecutor.definition.metadata?.requiresConfirmation, true);
  assert.equal(openWorldExecutor.definition.metadata?.riskLevel, "high");
  assert.equal(openWorldExecutor.definition.metadata?.operationType, "external-submit");
  assert.equal(openWorldExecutor.definition.metadata?.requiresConfirmation, true);

  await client.disconnect();
});

test("createMcpToolExecutor matches auto approval only by the original MCP method name", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const echoTool = tools.find((t) => t.name === "echo")!;
  const readOnlyTool = tools.find((t) => t.name === "read_only_tool")!;
  const destructiveTool = tools.find((t) => t.name === "destructive_tool")!;
  const echoExecutor = createMcpToolExecutor(client, echoTool, "my-server", {
    confirmationMode: "always",
    autoApprovedTools: [],
  });
  const readOnlyExecutor = createMcpToolExecutor(client, readOnlyTool, "my-server", {
    confirmationMode: "always",
    autoApprovedTools: ["read_only_tool"],
  });
  const destructiveExecutor = createMcpToolExecutor(client, destructiveTool, "my-server", {
    confirmationMode: "always",
    autoApprovedTools: ["destructive_tool"],
  });
  const namespacedAliasExecutor = createMcpToolExecutor(client, destructiveTool, "my-server", {
    confirmationMode: "always",
    autoApprovedTools: ["my-server__destructive_tool"],
  });

  assert.equal(echoExecutor.definition.metadata?.operationType, "execute");
  assert.equal(echoExecutor.definition.metadata?.requiresConfirmation, true);
  assert.equal(readOnlyExecutor.definition.metadata?.requiresConfirmation, false);
  assert.equal(destructiveExecutor.definition.metadata?.requiresConfirmation, false);
  assert.equal(namespacedAliasExecutor.definition.metadata?.requiresConfirmation, true);

  await client.disconnect();
});

test("createMcpToolExecutor execute returns text output", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const echoTool = tools.find((t) => t.name === "echo")!;
  const executor = createMcpToolExecutor(client, echoTool, "my-server");

  const output = await executor.execute(
    { message: "test" },
    {
      callerAgentId: "test-agent",
      traceId: "trace-1",
      goalId: "goal-1",
    }
  );

  assert.deepEqual(output, {
    content: [{ type: "text", text: "Echo: test" }],
  });
  assert.equal(JSON.stringify(output).split("Echo: test").length - 1, 1);

  await client.disconnect();
});

test("createMcpToolExecutor preserves distinct text and structured facts exactly once", async () => {
  const { client } = await createConnectedPair();
  const tools = await client.listTools();
  const structuredTool = tools.find((tool) => tool.name === "structured_tool")!;
  const executor = createMcpToolExecutor(client, structuredTool, "my-server");

  const output = await executor.execute(
    { id: "record-1" },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" }
  );

  assert.deepEqual(output, {
    content: [{ type: "text", text: "Loaded record-1" }],
    structuredContent: {
      id: "record-1",
      records: [{ title: "Structured record", score: 1 }],
    },
  });
  const serialized = JSON.stringify(output);
  assert.equal(serialized.split("Loaded record-1").length - 1, 1);
  assert.equal(serialized.split("Structured record").length - 1, 1);
  assert.equal(serialized.includes("summary"), false);
  assert.equal(serialized.includes("mcpResult"), false);

  await client.disconnect();
});

test("MCP tool adapter preserves parseable JSON text when it differs from structured content", async () => {
  const structuredContent = { id: "record-1", records: [{ score: 1 }] };
  const distinctTextFact = { id: "record-1", records: [{ score: 2 }] };
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(distinctTextFact) }],
        structuredContent,
      };
    },
  } as unknown as McpClientWrapper;

  const output = await createFakeMcpExecutor(client, "distinct_json").execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" }
  );

  assert.deepEqual(output, {
    content: [{ type: "text", text: JSON.stringify(distinctTextFact) }],
    structuredContent,
  });
});

test("MCP exact JSON mirror is kept once and stays below the model transport budget", async () => {
  const largeText = "x".repeat(120_000);
  const structuredContent = {
    id: "large-record",
    payload: largeText,
    facts: { complete: true },
  };
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "large_exact_mirror");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-large-mirror-call", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const serializedOutput = JSON.stringify(result.output);
  const modelMessage = toolResultMessage(result);
  const modelPayload = JSON.parse(modelMessage.content) as {
    readonly status: string;
    readonly body: {
      readonly format: string;
      readonly value: {
        readonly content: readonly unknown[];
        readonly structuredContent: typeof structuredContent;
      };
    };
  };

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { content: [], structuredContent });
  assert.equal(serializedOutput.split(largeText).length - 1, 1);
  assert.equal(modelMessage.content.length < 220_000, true);
  assert.equal(modelMessage.content.includes("tool_message_transport_budget_exceeded"), false);
  assert.equal(modelPayload.status, "completed");
  assert.equal(modelPayload.body.format, "json");
  assert.deepEqual(modelPayload.body.value.content, []);
  assert.deepEqual(modelPayload.body.value.structuredContent, structuredContent);
});

test("createMcpToolExecutor execute preserves MCP error content", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const failTool = tools.find((t) => t.name === "fail_tool")!;
  const executor = createMcpToolExecutor(client, failTool, "my-server");

  const output = await executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1", toolCallId: "call-fail" }
  );
  const executorResult = output as ToolExecutorResult;
  assert.equal(executorResult.kind, "tool_call_result");
  assert.equal(executorResult.result.callId, "call-fail");
  assert.equal(executorResult.result.toolName, "my_server__fail_tool");
  assert.deepEqual(executorResult.result.input, {});
  assert.equal(executorResult.result.status, "failed");
  assert.equal(executorResult.result.error, "MCP tool my_server__fail_tool reported an error.");
  assert.equal(executorResult.result.errorDomain, "tool_error");
  assert.deepEqual(executorResult.result.errorFacts, {
    code: "mcp_tool_error",
    serverId: "my-server",
    mcpToolName: "fail_tool",
  });
  assert.equal(executorResult.result.durationMs >= 0, true);
  assert.deepEqual(executorResult.result.output, {
    content: [{ type: "text", text: "Something went wrong." }],
  });
  const serialized = JSON.stringify(executorResult.result.output);
  assert.equal(serialized.split("Something went wrong.").length - 1, 1);
  assert.equal(serialized.includes("isError"), false);

  const center = new ToolCenter();
  center.register(executor);
  const normalized = await center.execute(
    { callId: "call-fail-normalized", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const modelMessage = toolResultMessage(normalized);
  assert.equal(normalized.status, "failed");
  assert.equal(modelMessage.content.split("Something went wrong.").length - 1, 1);
  assert.equal(modelMessage.content.includes("mcpResult"), false);
  assert.equal(modelMessage.content.includes("isError"), false);

  await client.disconnect();
});

test("MCP tool adapter carries image and audio bytes out of band without losing media", async () => {
  const imageData = Buffer.from("image-bytes", "utf8").toString("base64");
  const audioData = Buffer.from("audio-bytes", "utf8").toString("base64");
  const client = {
    async callTool() {
      return {
        content: [
          { type: "text" as const, text: "Media result" },
          { type: "image" as const, data: imageData, mimeType: "image/png" },
          { type: "audio" as const, data: audioData, mimeType: "audio/wav" },
        ],
      };
    },
  } as unknown as McpClientWrapper;

  const output = await createFakeMcpExecutor(client, "media").execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" }
  ) as McpToolOutput;
  assert.deepEqual(output, {
    content: [
      { type: "text", text: "Media result" },
      {
        type: "image",
        mimeType: "image/png",
        byteLength: 11,
        modelInput: "attached",
        modelAttachmentIndex: 0,
      },
      {
        type: "audio",
        mimeType: "audio/wav",
        filename: "mcp-audio-3.wav",
        byteLength: 11,
        modelInput: "audio_attachment",
        modelAttachmentIndex: 1,
      },
    ],
  });
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(imageData), false);
  assert.equal(serialized.includes(audioData), false);
  const attachments = toolModelAttachmentsFromOutput(output);
  assert.equal(attachments?.length, 2);
  assert.equal(attachments?.[0]?.kind, "image");
  assert.equal(attachments?.[0]?.byteLength, 11);
  assert.equal(attachments?.[0]?.source.kind, "data");
  if (attachments?.[0]?.source.kind === "data") {
    assert.equal(attachments[0].source.mimeType, "image/png");
    assert.equal(attachments[0].source.data, imageData);
  }
  assert.equal(attachments?.[1]?.kind, "audio");
  assert.equal(attachments?.[1]?.filename, "mcp-audio-3.wav");
  assert.equal(attachments?.[1]?.inputRef, "mcp-content:audio:2");
  assert.equal(attachments?.[1]?.byteLength, 11);
  assert.equal(attachments?.[1]?.source.kind, "data");
  if (attachments?.[1]?.source.kind === "data") {
    assert.equal(attachments[1].source.mimeType, "audio/wav");
    assert.equal(attachments[1].source.data, audioData);
  }
});

test("MCP image output survives ToolCenter normalization and reaches the model once out of band", async () => {
  const imageData = Buffer.from("model-image-bytes", "utf8").toString("base64");
  const client = {
    async callTool() {
      return {
        content: [
          { type: "text" as const, text: "Image observation" },
          { type: "image" as const, data: imageData, mimeType: "image/png" },
        ],
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "image_observation");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-image-call", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const message = toolResultMessage(result);

  assert.equal(result.status, "completed");
  assert.equal(message.attachments?.length, 1);
  assert.equal(message.attachments?.[0]?.kind, "image");
  assert.equal(message.attachments?.[0]?.source.kind, "data");
  if (message.attachments?.[0]?.source.kind === "data") {
    assert.equal(message.attachments[0].source.data, imageData);
  }
  assert.equal(message.content.includes(imageData), false);
  assert.equal(message.content.split("Image observation").length - 1, 1);
});

test("MCP audio and file media survive ToolCenter normalization out of band", async () => {
  const audioData = Buffer.from("model-audio-bytes", "utf8").toString("base64");
  const binaryData = Buffer.from("model-binary-bytes", "utf8").toString("base64");
  const client = {
    async callTool() {
      return {
        content: [
          { type: "audio" as const, data: audioData, mimeType: "audio/wav" },
          {
            type: "resource" as const,
            resource: {
              uri: "memory://records/tool-output.bin",
              mimeType: "application/octet-stream",
              blob: binaryData,
            },
          },
        ],
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "file_media");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-file-media", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const message = toolResultMessage(result);

  assert.equal(result.status, "completed");
  assert.deepEqual(message.attachments?.map((attachment) => attachment.kind), ["audio", "file"]);
  assert.equal(message.attachments?.[0]?.filename, "mcp-audio-1.wav");
  assert.equal(message.attachments?.[1]?.filename, "tool-output.bin");
  assert.equal(message.attachments?.[0]?.source.kind, "data");
  assert.equal(message.attachments?.[1]?.source.kind, "data");
  if (message.attachments?.[0]?.source.kind === "data") {
    assert.equal(message.attachments[0].source.data, audioData);
  }
  if (message.attachments?.[1]?.source.kind === "data") {
    assert.equal(message.attachments[1].source.data, binaryData);
  }
  assert.equal(message.content.includes(audioData), false);
  assert.equal(message.content.includes(binaryData), false);
});

test("MCP model attachments fail with explicit facts above the 20 MiB request limit", async () => {
  const maxBytes = 20 * 1024 * 1024;
  const oversizedAudio = Buffer.alloc(maxBytes + 1).toString("base64");
  let calls = 0;
  const client = {
    async callTool() {
      calls += 1;
      return {
        content: [
          { type: "text" as const, text: "Remote operation completed before media delivery." },
          { type: "audio" as const, data: oversizedAudio, mimeType: "audio/wav" },
        ],
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "oversized_audio");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-oversized-audio", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const output = result.output as {
    readonly content?: readonly unknown[];
    readonly resultDelivery?: Readonly<Record<string, unknown>>;
  };

  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_model_attachment_too_large");
  assert.equal(result.errorFacts?.mimeType, "audio/wav");
  assert.equal(result.errorFacts?.byteLength, maxBytes + 1);
  assert.equal(result.errorFacts?.maxBytes, maxBytes);
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
  assert.equal(output.resultDelivery?.sourceExecutionStatus, "completed");
  assert.equal(JSON.stringify(output.content).includes("Remote operation completed before media delivery."), true);
  assert.equal(JSON.stringify(output).includes(oversizedAudio), false);
});

test("MCP model attachments fail when one result exceeds the attachment count budget", async () => {
  const client = {
    async callTool() {
      return {
        content: Array.from({ length: 17 }, () => ({
          type: "image" as const,
          data: "AA==",
          mimeType: "image/png",
        })),
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "too_many_images");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-too-many-images", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_model_attachment_count_exceeded");
  assert.equal(result.errorFacts?.attachmentCount, 17);
  assert.equal(result.errorFacts?.maxAttachments, 16);
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
});

test("MCP model attachments fail when one result exceeds the aggregate byte budget", async () => {
  const attachmentBytes = 16 * 1024 * 1024 + 1;
  const attachmentData = Buffer.alloc(attachmentBytes).toString("base64");
  const client = {
    async callTool() {
      return {
        content: [
          { type: "image" as const, data: attachmentData, mimeType: "image/png" },
          { type: "image" as const, data: attachmentData, mimeType: "image/png" },
        ],
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "aggregate_images");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-aggregate-images", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_model_attachment_total_bytes_exceeded");
  assert.equal(result.errorFacts?.attachmentCount, 2);
  assert.equal(result.errorFacts?.totalBytes, attachmentBytes * 2);
  assert.equal(result.errorFacts?.maxTotalBytes, 32 * 1024 * 1024);
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
});

test("createMcpToolExecutor preserves current MCP resource types without binary JSON fallbacks", async () => {
  const { client } = await createConnectedPair();
  const tools = await client.listTools();
  const resourceTool = tools.find((tool) => tool.name === "resource_tool")!;
  const executor = createMcpToolExecutor(client, resourceTool, "my-server");

  const output = await executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" }
  ) as McpToolOutput;

  assert.deepEqual(output, {
    content: [
      {
        type: "resource_link",
        uri: "memory://records/1",
        name: "record-1",
        title: "Record one",
        description: "Retrievable record",
        mimeType: "text/plain",
        size: 12,
      },
      {
        type: "resource",
        resource: {
          uri: "memory://records/1/body",
          mimeType: "text/plain",
          text: "Resource body",
        },
      },
      {
        type: "resource",
        resource: {
          uri: "memory://records/1/image",
          mimeType: "image/png",
          byteLength: Buffer.from("resource-image", "utf8").byteLength,
          modelAttachmentIndex: 0,
          modelInput: "attached",
        },
      },
      {
        type: "resource",
        resource: {
          uri: "memory://records/1/binary",
          mimeType: "application/octet-stream",
          filename: "binary",
          byteLength: Buffer.from("binary", "utf8").byteLength,
          modelInput: "file_attachment",
          modelAttachmentIndex: 1,
        },
      },
    ],
  });
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(RESOURCE_IMAGE_DATA), false);
  assert.equal(serialized.includes(RESOURCE_BINARY_DATA), false);
  assert.equal(serialized.split("Resource body").length - 1, 1);
  const attachments = toolModelAttachmentsFromOutput(output);
  assert.equal(attachments?.length, 2);
  assert.equal(attachments?.[0]?.kind, "image");
  assert.equal(attachments?.[0]?.source.kind, "data");
  if (attachments?.[0]?.source.kind === "data") {
    assert.equal(attachments[0].source.data, RESOURCE_IMAGE_DATA);
  }
  assert.equal(attachments?.[1]?.kind, "file");
  assert.equal(attachments?.[1]?.filename, "binary");
  assert.equal(attachments?.[1]?.inputRef, "memory://records/1/binary");
  assert.equal(attachments?.[1]?.source.kind, "data");
  if (attachments?.[1]?.source.kind === "data") {
    assert.equal(attachments[1].source.mimeType, "application/octet-stream");
    assert.equal(attachments[1].source.data, RESOURCE_BINARY_DATA);
  }

  await client.disconnect();
});

test("MCP tool adapter reports unknown post-execution content without inviting a blind retry", async () => {
  let calls = 0;
  const client = {
    async callTool() {
      calls += 1;
      return {
        content: [{ type: "legacy_blob", data: "opaque" }],
      };
    },
  } as unknown as McpClientWrapper;

  const executor = createFakeMcpExecutor(client, "unknown_content");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-unknown-content", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );

  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_result_delivery_failed");
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
  assert.match(result.error ?? "", /Unsupported MCP content part: legacy_blob/);
});

test("MCP adapter preserves valid content when structured content is not JSON-safe", async () => {
  const structuredContent: Record<string, unknown> = { id: "record-1" };
  structuredContent.self = structuredContent;
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: "Loaded record-1" }],
        structuredContent,
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "invalid_structured_content");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-invalid-structured-content", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Tool fact is not JSON-safe at \$\.self: circular references are not supported/);
  assert.equal(result.errorDomain, "runtime_error");
  assert.equal((result.errorFacts as Readonly<Record<string, unknown>> | undefined)?.code, "invalid_tool_fact");
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
  assert.deepEqual(result.output, {
    content: [{ type: "text", text: "Loaded record-1" }],
    resultDelivery: {
      status: "failed",
      code: "invalid_tool_fact",
      message: "Tool fact is not JSON-safe at $.self: circular references are not supported.",
      mcpIsError: false,
      sourceExecutionStatus: "completed",
      doNotBlindlyRetry: true,
    },
  });
  assert.equal(toolResultMessage(result).content.includes("Loaded record-1"), true);
});

test("MCP adapter rejects non-object structuredContent after the remote call returns", async () => {
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: "Loaded records" }],
        structuredContent: ["record-1"],
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "non_object_structured_content");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-non-object-structured-content", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "mcp_structured_content_not_object");
  assert.equal(result.errorFacts?.sourceExecutionStatus, "completed");
  assert.equal(result.errorFacts?.doNotBlindlyRetry, true);
  assert.equal(toolResultMessage(result).content.includes("Loaded records"), true);
});

test("MCP tool adapter fails honestly when large text has no continuation reader", async () => {
  const text = "x".repeat(200_000);
  const client = {
    async callTool() {
      return { content: [{ type: "text" as const, text }] };
    },
  } as unknown as McpClientWrapper;

  const executor = createFakeMcpExecutor(client, "large_text");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-large-text", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const output = result.output as McpToolOutput & {
    readonly retentionFailed?: boolean;
    readonly contentIncomplete?: boolean;
    readonly contentPreview?: string;
    readonly deliveryCode?: string;
  };
  const modelMessage = toolResultMessage(result);

  assert.equal(result.status, "failed");
  assert.equal(result.errorFacts?.code, "tool_output_reader_unavailable");
  assert.equal(result.errorFacts?.outputDeliveryCode, "tool_output_reader_unavailable");
  assert.equal(output.retentionFailed, true);
  assert.equal(output.contentIncomplete, true);
  assert.equal(output.deliveryCode, "tool_output_reader_unavailable");
  assert.equal(typeof output.contentPreview, "string");
  assert.equal(modelMessage.content.includes(text), false);
  assert.equal(modelMessage.content.includes("tool_output_reader_unavailable"), true);
});

test("MCP continuation-shaped structuredContent stays opaque while oversized current output remains recoverable", async () => {
  const currentPageSentinel = "CURRENT_PAGE_SENTINEL";
  const currentPageText = `${"x".repeat(240_000)}${currentPageSentinel}`;
  const singleContinuation = {
    ref: "mcp-result://single",
    nextInput: { cursor: "next-single" },
  };
  const multipleContinuations = [
    { ref: "mcp-result://first", nextInput: { cursor: "next-first" } },
    { ref: "mcp-result://second", nextInput: { cursor: "next-second" } },
  ];
  const fixtures = [
    {
      name: "structured_single_continuation",
      structuredContent: { continuation: singleContinuation },
      expected: { continuation: singleContinuation },
    },
    {
      name: "structured_multiple_continuations",
      structuredContent: { continuations: multipleContinuations },
      expected: { continuations: multipleContinuations },
    },
  ] as const;

  for (const fixture of fixtures) {
    const client = {
      async callTool() {
        return {
          content: [{ type: "text" as const, text: currentPageText }],
          structuredContent: fixture.structuredContent,
        };
      },
    } as unknown as McpClientWrapper;
    const executor = createFakeMcpExecutor(client, fixture.name, { readOnlyHint: true });
    const store = new InMemoryToolOutputStore();
    const center = new ToolCenter({ outputStore: store });
    center.register(executor);
    const reader = createReadToolOutputTool(store);
    center.register(reader);
    const result = await center.execute(
      { callId: `mcp-${fixture.name}`, toolName: executor.definition.name, input: {} },
      { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
      {
        callerAgentId: "test-agent",
        allowedTools: [executor.definition.name, reader.definition.name],
      },
    );
    const canonicalOutput = result.output as {
      readonly continuation?: {
        readonly ref?: string;
        readonly nextInput?: unknown;
      };
    };
    const payload = JSON.parse(toolResultMessage(result).content) as {
      readonly status?: string;
      readonly body?: {
        readonly value?: {
          readonly truncated?: boolean;
          readonly continuation?: typeof singleContinuation;
          readonly continuations?: typeof multipleContinuations;
        };
      };
    };
    assert.equal(executor.definition.metadata?.operationType, "read-only");
    assert.equal(result.status, "completed");
    assert.equal(payload.status, "completed");
    assert.equal(payload.body?.value?.truncated, true);
    assert.match(canonicalOutput.continuation?.ref ?? "", /^tool-output:\/\//u);

    const firstInput = canonicalOutput.continuation?.nextInput;
    let input = firstInput as { readonly ref: string; readonly startChar: number; readonly maxChars: number };
    let restored = "";
    while (true) {
      const read = await center.execute(
        {
          callId: `read-${fixture.name}-${input.startChar}`,
          toolName: reader.definition.name,
          input,
        },
        { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
        { callerAgentId: "test-agent", allowedTools: [reader.definition.name] },
      );
      assert.equal(read.status, "completed");
      const readOutput = read.output as {
        readonly content: string;
        readonly continuation?: { readonly nextInput?: typeof input };
      };
      restored += readOutput.content;
      if (readOutput.continuation?.nextInput === undefined) {
        break;
      }
      input = readOutput.continuation.nextInput;
    }
    const restoredOutput = JSON.parse(restored) as {
      readonly content: readonly { readonly type: string; readonly text?: string }[];
      readonly structuredContent?: unknown;
      readonly continuation?: unknown;
      readonly continuations?: unknown;
    };
    assert.equal(restoredOutput.content[0]?.text, currentPageText);
    assert.equal(restoredOutput.content[0]?.text?.endsWith(currentPageSentinel), true);
    assert.equal(restoredOutput.continuation, undefined);
    assert.equal(restoredOutput.continuations, undefined);
    assert.deepEqual(restoredOutput.structuredContent, fixture.expected);
  }
});

test("MCP transport does not guess continuations below structuredContent top level", async () => {
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: "x".repeat(240_000) }],
        structuredContent: {
          nested: {
            continuation: {
              ref: "mcp-result://nested",
              nextInput: { cursor: "must-not-be-discovered" },
            },
          },
        },
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "nested_continuation");
  const center = new ToolCenter();
  center.register(executor);
  const result = await center.execute(
    { callId: "mcp-nested-continuation", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const payload = JSON.parse(toolResultMessage(result).content) as {
    readonly status?: string;
    readonly error?: { readonly facts?: { readonly code?: string } };
  };

  assert.equal(payload.status, "failed");
  assert.equal(payload.error?.facts?.code, "tool_output_reader_unavailable");
});

test("MCP adapter does not promote a ref-only business field as an executable continuation", async () => {
  const client = {
    async callTool() {
      return {
        content: [{ type: "text" as const, text: "business result" }],
        structuredContent: {
          continuation: { ref: "business-record://not-a-reader" },
        },
      };
    },
  } as unknown as McpClientWrapper;
  const executor = createFakeMcpExecutor(client, "ref_only_business_field");
  const center = new ToolCenter();
  center.register(executor);

  const result = await center.execute(
    { callId: "mcp-ref-only-business-field", toolName: executor.definition.name, input: {} },
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
    { callerAgentId: "test-agent", allowedTools: [executor.definition.name] },
  );
  const output = result.output as {
    readonly continuation?: unknown;
    readonly structuredContent?: { readonly continuation?: unknown };
  };

  assert.equal(result.status, "completed");
  assert.equal(output.continuation, undefined);
  assert.deepEqual(output.structuredContent?.continuation, {
    ref: "business-record://not-a-reader",
  });
});

test("McpManager connectAll connects enabled servers and tracks statuses", async () => {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const manager = new McpManager({
    servers: [
      {
        serverId: "test-server",
        label: "Test",
        transport: "stdio",
        command: "unused",
        envSecretRefs: [],
        confirmationMode: "always",
        toolExposureMode: "none",
        enabledTools: [],
        autoApprovedTools: [],
        enabled: true,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });
  const entry = manager.getEntryForTesting("test-server");
  assert.ok(entry);
  entry.client = new McpClientWrapper(
    {
      serverId: "test-server",
      transport: "stdio",
    },
    { transport: clientTransport }
  );

  await manager.connectAll();
  const statuses = manager.getServerStatuses();
  assert.equal(statuses["test-server"], "connected");

  await manager.disconnectAll();
  const afterDisconnect = manager.getServerStatuses();
  assert.equal(afterDisconnect["test-server"], "disconnected");
});

test("McpManager skips disabled servers", async () => {
  const manager = new McpManager({
    servers: [
      {
        serverId: "disabled-server",
        label: "Disabled",
        transport: "stdio",
        command: "unused",
        envSecretRefs: [],
        confirmationMode: "always",
        toolExposureMode: "none",
        enabledTools: [],
        autoApprovedTools: [],
        enabled: false,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });

  const statuses = manager.getServerStatuses();
  assert.equal(statuses["disabled-server"], undefined);
});

test("McpManager separates discovered tools from exposed registry tools", async () => {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const manager = new McpManager({
    servers: [
      {
        serverId: "srv",
        label: "Test",
        transport: "stdio",
        command: "unused",
        envSecretRefs: [],
        confirmationMode: "always",
        toolExposureMode: "none",
        enabledTools: [],
        autoApprovedTools: [],
        enabled: true,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });
  const entry = manager.getEntryForTesting("srv");
  assert.ok(entry);
  entry.client = new McpClientWrapper(
    {
      serverId: "srv",
      transport: "stdio",
    },
    { transport: clientTransport }
  );
  await manager.connectAll();

  const discoveredTools = manager.getDiscoveredToolsForRegistry();
  assert.equal(discoveredTools.length, 8);
  const names = discoveredTools.map((t) => t.definition.name).sort();
  assert.deepEqual(names, [
    "srv__destructive_tool",
    "srv__echo",
    "srv__fail_tool",
    "srv__open_world_tool",
    "srv__query_docs",
    "srv__read_only_tool",
    "srv__resource_tool",
    "srv__structured_tool",
  ]);
  assert.equal(discoveredTools[0].definition.metadata?.category, "mcp");
  assert.deepEqual(manager.getToolsForRegistry(), []);

  await manager.disconnectAll();
});

test("resolveMcpExecutable prioritizes AgentArbor user runtime bin", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-home-"));
  try {
    const bin = path.join(home, ".agentarbor", "bin");
    await fs.mkdir(bin, { recursive: true });
    const executableName = process.platform === "win32" ? "fake-mcp.cmd" : "fake-mcp";
    const executablePath = path.join(bin, executableName);
    await fs.writeFile(executablePath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(executablePath, 0o755);
    }

    const resolution = resolveMcpExecutable("fake-mcp", {
      USERPROFILE: home,
      HOME: home,
      PATH: "",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    });

    assert.equal(resolution.source, "agentarbor");
    assert.equal(resolution.executable?.toLowerCase(), executablePath.toLowerCase());
    assert.equal(resolution.managedDirectories[0], bin);
  } finally {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("mcpManagedRuntimeDirectories treats AGENTARBOR_HOME as the user AgentArbor directory", async () => {
  const agentArborHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-explicit-home-"));
  try {
    const directories = mcpManagedRuntimeDirectories({
      AGENTARBOR_HOME: agentArborHome,
      USERPROFILE: path.join(os.tmpdir(), "unused-profile"),
      HOME: path.join(os.tmpdir(), "unused-home"),
    });

    assert.equal(directories[0], path.join(agentArborHome, "bin"));
    assert.equal(directories.includes(path.join(agentArborHome, ".agentarbor", "bin")), false);
  } finally {
    await fs.rm(agentArborHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("ensureManagedMcpExecutable imports discovered runtime entry into AgentArbor bin", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-managed-home-"));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-external-bin-"));
  try {
    const commandName = "fake-managed-mcp";
    const externalName = process.platform === "win32" ? `${commandName}.cmd` : commandName;
    const externalPath = path.join(external, externalName);
    await fs.writeFile(externalPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(externalPath, 0o755);
    }

    const env = {
      USERPROFILE: home,
      HOME: home,
      PATH: external,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const ensured = await ensureManagedMcpExecutable(commandName, env);
    const managedName = process.platform === "win32" ? `${commandName}.cmd` : commandName;
    const managedPath = path.join(home, ".agentarbor", "bin", managedName);
    const resolved = resolveMcpExecutable(commandName, env);

    assert.equal(ensured.source, "agentarbor");
    assert.equal(ensured.executable?.toLowerCase(), managedPath.toLowerCase());
    assert.equal(ensured.managedAction, process.platform === "win32" ? "wrapped" : "copied");
    assert.equal(await fileExists(managedPath), true);
    assert.equal(resolved.source, "agentarbor");
    assert.equal(resolved.executable?.toLowerCase(), managedPath.toLowerCase());
  } finally {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(external, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("ensureManagedMcpExecutable imports explicit base runtime paths into AgentArbor bin", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-explicit-runtime-home-"));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-explicit-runtime-bin-"));
  try {
    const executableName = process.platform === "win32" ? "node.cmd" : "node";
    const executablePath = path.join(external, executableName);
    await fs.writeFile(executablePath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(executablePath, 0o755);
    }

    const env = {
      USERPROFILE: home,
      HOME: home,
      PATH: "",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const ensured = await ensureManagedMcpExecutable(executablePath, env);
    const managedName = process.platform === "win32" ? "node.cmd" : "node";
    const managedPath = path.join(home, ".agentarbor", "bin", managedName);

    assert.equal(ensured.source, "agentarbor");
    assert.equal(ensured.executable?.toLowerCase(), managedPath.toLowerCase());
    assert.equal(await fileExists(managedPath), true);
  } finally {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(external, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("McpClientWrapper starts stdio servers from AgentArbor user runtime bin", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-runtime-home-"));
  const serverDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-mcp-runtime-server-"));
  try {
    const bin = path.join(home, ".agentarbor", "bin");
    const serverPath = path.join(serverDirectory, "server.mjs");
    const commandName = "fake-agentarbor-mcp";
    const executableName = process.platform === "win32" ? `${commandName}.cmd` : commandName;
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(serverPath, mcpSpawnServerSource(), "utf8");
    await fs.writeFile(path.join(bin, executableName), mcpRuntimeWrapperSource(serverPath), "utf8");
    if (process.platform !== "win32") {
      await fs.chmod(path.join(bin, executableName), 0o755);
    }

    const client = new McpClientWrapper({
      serverId: "agentarbor-runtime-test",
      transport: "stdio",
      command: commandName,
      env: {
        USERPROFILE: home,
        HOME: home,
      },
    });
    try {
      await client.connect();
      const tools = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["ping"]);
    } finally {
      await client.disconnect();
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.rm(serverDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("McpManager filters MCP tools by enabledTools whitelist", async () => {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const manager = new McpManager({
    servers: [
      {
        serverId: "srv",
        label: "Test",
        transport: "stdio",
        command: "unused",
        envSecretRefs: [],
        confirmationMode: "unsafe_only",
        toolExposureMode: "selected",
        enabledTools: ["read_only_tool"],
        autoApprovedTools: [],
        enabled: true,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });
  const entry = manager.getEntryForTesting("srv");
  assert.ok(entry);
  entry.client = new McpClientWrapper(
    {
      serverId: "srv",
      transport: "stdio",
    },
    { transport: clientTransport }
  );
  await manager.connectAll();

  const tools = manager.getToolsForRegistry();
  assert.deepEqual(tools.map((t) => t.definition.name), ["srv__read_only_tool"]);
  assert.equal(tools[0]?.definition.metadata?.requiresConfirmation, false);

  await manager.disconnectAll();
});

test("McpManager applies MCP confirmationMode and autoApprovedTools", async () => {
  const server = createTestServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const manager = new McpManager({
    servers: [
      {
        serverId: "srv",
        label: "Test",
        transport: "stdio",
        command: "unused",
        envSecretRefs: [],
        confirmationMode: "always",
        toolExposureMode: "selected",
        enabledTools: ["echo", "read_only_tool", "destructive_tool", "open_world_tool"],
        autoApprovedTools: ["read_only_tool", "destructive_tool"],
        enabled: true,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });
  const entry = manager.getEntryForTesting("srv");
  assert.ok(entry);
  entry.client = new McpClientWrapper(
    {
      serverId: "srv",
      transport: "stdio",
    },
    { transport: clientTransport }
  );
  await manager.connectAll();

  const tools = manager.getToolsForRegistry();
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  assert.equal(byName.get("srv__read_only_tool")?.definition.metadata?.requiresConfirmation, false);
  assert.equal(byName.get("srv__destructive_tool")?.definition.metadata?.requiresConfirmation, false);
  assert.equal(byName.get("srv__echo")?.definition.metadata?.requiresConfirmation, true);
  assert.equal(byName.get("srv__open_world_tool")?.definition.metadata?.requiresConfirmation, true);

  await manager.disconnectAll();
});

test("McpManager connection error sets server status to error", async () => {
  const manager = new McpManager({
    servers: [
      {
        serverId: "broken",
        label: "Broken",
        transport: "stdio",
        command: "nonexistent-command",
        envSecretRefs: [],
        confirmationMode: "always",
        toolExposureMode: "none",
        enabledTools: [],
        autoApprovedTools: [],
        enabled: true,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });

  await manager.connectAll();
  const statuses = manager.getServerStatuses();
  assert.equal(statuses["broken"], "error");
  assert.equal(manager.getToolsForRegistry().length, 0);
});

test("McpManager aborts a timed-out connect and a late initialize response cannot revive it", async () => {
  const transport = new DelayedInitializeTransport();
  const manager = new McpManager({
    connectTimeoutMs: 20,
    servers: [{
      serverId: "slow-connect",
      label: "Slow connect",
      transport: "stdio",
      command: "unused",
      envSecretRefs: [],
      confirmationMode: "always",
      toolExposureMode: "none",
      enabledTools: [],
      autoApprovedTools: [],
      enabled: true,
      updatedAt: "2026-07-19T00:00:00.000Z",
    }],
  });
  const entry = manager.getEntryForTesting("slow-connect");
  assert.ok(entry);
  entry.client = new McpClientWrapper(
    { serverId: "slow-connect", transport: "stdio" },
    { transport },
  );

  const connecting = manager.connectAll();
  await transport.initializeRequested;
  await connecting;
  assert.equal(manager.getServerStatuses()["slow-connect"], "error");
  assert.equal(entry.client.isConnected(), false);
  transport.respondToInitialize();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(entry.client.isConnected(), false);
  assert.equal(transport.closeCalls > 0, true);
});

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function mcpSpawnServerSource(): string {
  const mcpServerModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioTransportModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const zodModule = import.meta.resolve("zod");
  return [
    `import { McpServer } from ${JSON.stringify(mcpServerModule)};`,
    `import { StdioServerTransport } from ${JSON.stringify(stdioTransportModule)};`,
    `import { z } from ${JSON.stringify(zodModule)};`,
    'const server = new McpServer({ name: "agentarbor-runtime-test", version: "1.0.0" });',
    'server.registerTool("ping", { description: "Ping runtime.", inputSchema: { message: z.string().optional() }, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "pong" }] }));',
    "await server.connect(new StdioServerTransport());",
    "",
  ].join("\n");
}

function mcpRuntimeWrapperSource(serverPath: string): string {
  if (process.platform === "win32") {
    return [
      "@echo off",
      `"${process.execPath}" "${serverPath}" %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    `exec ${shellQuote(process.execPath)} ${shellQuote(serverPath)} "$@"`,
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

type TestMcpPage = Readonly<Record<string, unknown>> & {
  readonly nextCursor?: string;
};

class PaginatedMcpTestTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly calls = new Map<string, (string | undefined)[]>();

  constructor(
    private readonly options: {
      readonly pages: Readonly<Record<string, readonly TestMcpPage[]>>;
      readonly failures?: Readonly<Record<string, { readonly code: number; readonly message: string }>>;
    }
  ) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("method" in message)) {
      return;
    }
    if (!("id" in message)) {
      return;
    }

    if (message.method === "initialize") {
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            prompts: {},
            resources: {},
          },
          serverInfo: { name: "paginated-test-server", version: "1.0.0" },
        },
      });
      return;
    }

    const failure = this.options.failures?.[message.method];
    if (failure !== undefined) {
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        error: failure,
      });
      return;
    }

    const pages = this.options.pages[message.method] ?? [emptyPageFor(message.method)];
    const cursor = cursorFromMessage(message);
    const callCursors = this.calls.get(message.method) ?? [];
    callCursors.push(cursor);
    this.calls.set(message.method, callCursors);
    const page = pageForCursor(pages, cursor);
    this.onmessage?.({
      jsonrpc: "2.0",
      id: message.id,
      result: page,
    });
  }

  cursorsFor(method: string): readonly (string | undefined)[] {
    return this.calls.get(method) ?? [];
  }
}

class DelayedInitializeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  closeCalls = 0;
  private initializeId: string | number | undefined;
  private resolveInitializeRequested!: () => void;
  readonly initializeRequested = new Promise<void>((resolve) => {
    this.resolveInitializeRequested = resolve;
  });

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if ("method" in message && "id" in message && message.method === "initialize") {
      this.initializeId = message.id;
      this.resolveInitializeRequested();
    }
  }

  respondToInitialize(): void {
    if (this.initializeId === undefined) {
      throw new Error("initialize was not requested");
    }
    this.onmessage?.({
      jsonrpc: "2.0",
      id: this.initializeId,
      result: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "delayed-server", version: "1.0.0" },
      },
    });
  }
}

function cursorFromMessage(message: JSONRPCMessage & { readonly method: string }): string | undefined {
  if (!("params" in message) || typeof message.params !== "object" || message.params === null) {
    return undefined;
  }
  const cursor = (message.params as { readonly cursor?: unknown }).cursor;
  return typeof cursor === "string" ? cursor : undefined;
}

function pageForCursor(pages: readonly TestMcpPage[], cursor: string | undefined): TestMcpPage {
  if (cursor === undefined) {
    return pages[0] ?? {};
  }
  const index = pages.findIndex((page) => page.nextCursor === cursor);
  return pages[index + 1] ?? emptyPageFor("");
}

function emptyPageFor(method: string): TestMcpPage {
  if (method === "prompts/list") {
    return { prompts: [] };
  }
  if (method === "resources/list") {
    return { resources: [] };
  }
  if (method === "resources/templates/list") {
    return { resourceTemplates: [] };
  }
  return { tools: [] };
}
