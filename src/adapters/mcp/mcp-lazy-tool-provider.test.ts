import assert from "node:assert/strict";
import test from "node:test";
import type { McpServerSettings } from "../../domain/config/index.js";
import type { McpCallOptions, McpClientConfig, McpLifecycleRequestOptions } from "./mcp-client.js";
import { McpCatalogLimitError, McpClientWrapper } from "./mcp-client.js";
import { LazyMcpToolExecutorProvider } from "./mcp-lazy-tool-provider.js";

const TEST_SERVER: McpServerSettings = {
  serverId: "lazy-test",
  label: "Lazy test",
  transport: "stdio",
  command: "unused",
  envSecretRefs: [],
  confirmationMode: "never",
  toolExposureMode: "all",
  enabledTools: [],
  autoApprovedTools: [],
  enabled: true,
  cachedTools: [{
    name: "lookup",
    description: "Lookup a record.",
    inputSchema: { type: "object", properties: {} },
  }],
  updatedAt: "2026-07-19T00:00:00.000Z",
};

test("LazyMcpToolExecutorProvider rejects an oversized aggregate model-visible catalog", () => {
  const provider = new LazyMcpToolExecutorProvider({
    servers: [{
      ...TEST_SERVER,
      cachedTools: [
        ...(TEST_SERVER.cachedTools ?? []),
        { name: "second", inputSchema: { type: "object", properties: {} } },
      ],
    }],
    maxToolCatalogItems: 1,
  });

  assert.throws(
    () => provider.getToolsForRegistry(),
    (error: unknown) => {
      assert.ok(error instanceof McpCatalogLimitError);
      assert.equal(error.catalogKind, "model-visible tools");
      assert.equal(error.unit, "items");
      assert.equal(error.observed, 2);
      assert.equal(error.limit, 1);
      return true;
    },
  );
});

test("LazyMcpToolExecutorProvider cancels and awaits a connection that finishes after close", async () => {
  let resolveConnect!: () => void;
  const connectGate = new Promise<void>((resolve) => {
    resolveConnect = resolve;
  });
  let connectSignal: AbortSignal | undefined;
  let disconnectCalls = 0;
  let callToolCalls = 0;
  let connected = false;
  const client = {
    async connect(options: McpLifecycleRequestOptions = {}) {
      connectSignal = options.signal;
      await connectGate;
      connected = true;
    },
    async disconnect() {
      disconnectCalls += 1;
      connected = false;
    },
    isConnected() {
      return connected;
    },
    async callTool(_name: string, _args: unknown, _options: McpCallOptions = {}) {
      callToolCalls += 1;
      return { content: [] };
    },
  } as unknown as McpClientWrapper;
  const provider = new LazyMcpToolExecutorProvider(
    { servers: [TEST_SERVER] },
    { createClient: (_config: McpClientConfig) => client },
  );
  const executor = provider.getToolsForRegistry()[0];
  assert.ok(executor);

  const execution = executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
  );
  assert.ok(connectSignal);

  const firstClose = provider.disconnectAll();
  const secondClose = provider.disconnectAll();
  assert.equal(connectSignal.aborted, true);
  resolveConnect();

  await assert.rejects(execution, /Lazy MCP provider is closed/u);
  await Promise.all([firstClose, secondClose]);
  await provider.disconnectAll();
  assert.equal(callToolCalls, 0);
  assert.equal(disconnectCalls, 1);
  assert.equal(connected, false);
});

test("LazyMcpToolExecutorProvider disconnects an established client once across repeated close calls", async () => {
  let disconnectCalls = 0;
  let connected = false;
  const client = {
    async connect() {
      connected = true;
    },
    async disconnect() {
      disconnectCalls += 1;
      connected = false;
    },
    isConnected() {
      return connected;
    },
    async callTool() {
      return { content: [{ type: "text" as const, text: "found" }] };
    },
  } as unknown as McpClientWrapper;
  const provider = new LazyMcpToolExecutorProvider(
    { servers: [TEST_SERVER] },
    { createClient: () => client },
  );
  const executor = provider.getToolsForRegistry()[0];
  assert.ok(executor);

  const result = await executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" },
  );
  assert.deepEqual(result, { content: [{ type: "text", text: "found" }] });

  await Promise.all([provider.disconnectAll(), provider.disconnectAll()]);
  await provider.disconnectAll();
  assert.equal(disconnectCalls, 1);
  assert.equal(connected, false);
  await assert.rejects(
    () => executor.execute(
      {},
      { callerAgentId: "test-agent", traceId: "trace-2", goalId: "goal-2" },
    ),
    /Lazy MCP provider is closed/u,
  );
});
