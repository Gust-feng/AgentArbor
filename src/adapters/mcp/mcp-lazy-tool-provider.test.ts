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

test("lazy MCP tool cancellation stops waiting without cancelling a shared connection", async () => {
  let resolveConnect!: () => void;
  const connectGate = new Promise<void>((resolve) => {
    resolveConnect = resolve;
  });
  let callToolCalls = 0;
  let connected = false;
  const client = {
    async connect() {
      await connectGate;
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    isConnected() {
      return connected;
    },
    async callTool() {
      callToolCalls += 1;
      return { content: [{ type: "text" as const, text: "found" }] };
    },
  } as unknown as McpClientWrapper;
  const provider = new LazyMcpToolExecutorProvider(
    { servers: [TEST_SERVER] },
    { createClient: () => client },
  );
  const executor = provider.getToolsForRegistry()[0];
  assert.ok(executor);

  const cancellation = new AbortController();
  const cancelledExecution = executor.execute(
    {},
    {
      callerAgentId: "test-agent",
      traceId: "trace-cancelled",
      goalId: "goal-1",
      abortSignal: cancellation.signal,
    },
  );
  cancellation.abort(new Error("run cancelled"));
  await assert.rejects(cancelledExecution, /run cancelled/u);
  assert.equal(callToolCalls, 0);

  // The shared provider connection is still allowed to finish for another caller.
  resolveConnect();
  const result = await executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: "trace-next", goalId: "goal-2" },
  );
  assert.deepEqual(result, { content: [{ type: "text", text: "found" }] });
  assert.equal(callToolCalls, 1);
  await provider.disconnectAll();
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

test("LazyMcpToolExecutorProvider retries only clients whose disconnect failed", async () => {
  const firstDisconnectError = new Error("first client disconnect failed");
  const disconnectCalls = [0, 0];
  const connected = [false, false];
  const clients = [0, 1].map((index) => ({
    async connect() {
      connected[index] = true;
    },
    async disconnect() {
      disconnectCalls[index] += 1;
      if (index === 0 && disconnectCalls[index] === 1) throw firstDisconnectError;
      connected[index] = false;
    },
    isConnected() {
      return connected[index];
    },
    async callTool() {
      return { content: [{ type: "text" as const, text: `found-${index}` }] };
    },
  })) as unknown as readonly McpClientWrapper[];
  let nextClient = 0;
  const provider = new LazyMcpToolExecutorProvider(
    {
      servers: [
        TEST_SERVER,
        { ...TEST_SERVER, serverId: "lazy-test-2", label: "Lazy test 2" },
      ],
    },
    { createClient: () => clients[nextClient++]! },
  );
  const executors = provider.getToolsForRegistry();
  assert.equal(executors.length, 2);

  await Promise.all(executors.map((executor, index) => executor.execute(
    {},
    { callerAgentId: "test-agent", traceId: `trace-${index}`, goalId: `goal-${index}` },
  )));

  await assert.rejects(provider.disconnectAll(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [firstDisconnectError]);
    return true;
  });
  assert.deepEqual(disconnectCalls, [1, 1]);
  assert.deepEqual(connected, [true, false]);

  await provider.disconnectAll();

  assert.deepEqual(disconnectCalls, [2, 1]);
  assert.deepEqual(connected, [false, false]);
});
