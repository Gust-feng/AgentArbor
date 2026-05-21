import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { McpClientWrapper } from "./mcp-client.js";
import { createMcpToolExecutor } from "./mcp-tool-adapter.js";
import { McpManager } from "./mcp-manager.js";

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
  assert.equal(tools.length, 3);

  const echo = tools.find((t) => t.name === "echo");
  assert.ok(echo);
  assert.equal(echo.description, "Echoes input back");
  assert.deepEqual(echo.inputSchema.properties, { message: { type: "string" } });
  assert.deepEqual(echo.inputSchema.required, ["message"]);

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

  assert.equal(executor.definition.name, "my-server__echo");
  assert.equal(executor.definition.description, "Echoes input back");
  assert.equal(executor.definition.metadata?.category, "mcp");
  assert.equal(executor.definition.metadata?.riskLevel, "medium");
  assert.equal(executor.definition.metadata?.operationType, "execute");

  await client.disconnect();
});

test("createMcpToolExecutor infers read-only metadata from annotations", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const readOnlyTool = tools.find((t) => t.name === "read_only_tool")!;
  const executor = createMcpToolExecutor(client, readOnlyTool, "my-server");

  assert.equal(executor.definition.name, "my-server__read_only_tool");
  assert.equal(executor.definition.metadata?.category, "mcp");
  assert.equal(executor.definition.metadata?.riskLevel, "low");
  assert.equal(executor.definition.metadata?.operationType, "read-only");
  assert.equal(executor.definition.metadata?.requiresConfirmation, false);

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

  assert.deepEqual(output, { text: "Echo: test" });

  await client.disconnect();
});

test("createMcpToolExecutor execute throws on MCP error", async () => {
  const { client } = await createConnectedPair();

  const tools = await client.listTools();
  const failTool = tools.find((t) => t.name === "fail_tool")!;
  const executor = createMcpToolExecutor(client, failTool, "my-server");

  await assert.rejects(
    () =>
      executor.execute(
        {},
        { callerAgentId: "test-agent", traceId: "trace-1", goalId: "goal-1" }
      ),
    /Something went wrong/
  );

  await client.disconnect();
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
        enabled: false,
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
    ],
  });

  const statuses = manager.getServerStatuses();
  assert.equal(statuses["disabled-server"], undefined);
});

test("McpManager getToolsForRegistry returns namespaced tools", async () => {
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
  assert.equal(tools.length, 3);
  const names = tools.map((t) => t.definition.name).sort();
  assert.deepEqual(names, ["srv__echo", "srv__fail_tool", "srv__read_only_tool"]);
  assert.equal(tools[0].definition.metadata?.category, "mcp");

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
