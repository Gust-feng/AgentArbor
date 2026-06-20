import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { McpClientWrapper } from "./mcp-client.js";
import { createMcpToolExecutor } from "./mcp-tool-adapter.js";
import { McpManager } from "./mcp-manager.js";
import { ensureManagedMcpExecutable, mcpManagedRuntimeDirectories, resolveMcpExecutable } from "./mcp-local-runtime.js";

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
  assert.equal(tools.length, 5);

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
  const executor = createMcpToolExecutor(client, readOnlyTool, "my-server", {
    confirmationMode: "unsafe_only",
    autoApprovedTools: [],
  });

  assert.equal(executor.definition.name, "my-server__read_only_tool");
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

test("createMcpToolExecutor honors always mode and autoApprovedTools", async () => {
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
    autoApprovedTools: ["my-server__destructive_tool"],
  });

  assert.equal(echoExecutor.definition.metadata?.operationType, "execute");
  assert.equal(echoExecutor.definition.metadata?.requiresConfirmation, true);
  assert.equal(readOnlyExecutor.definition.metadata?.requiresConfirmation, false);
  assert.equal(destructiveExecutor.definition.metadata?.requiresConfirmation, false);

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
    summary: "Echo: test",
    result: {
      text: "Echo: test",
      multimodal: undefined,
    },
    truncated: false,
  });

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
  assert.equal(discoveredTools.length, 5);
  const names = discoveredTools.map((t) => t.definition.name).sort();
  assert.deepEqual(names, [
    "srv__destructive_tool",
    "srv__echo",
    "srv__fail_tool",
    "srv__open_world_tool",
    "srv__read_only_tool",
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
    await fs.rm(home, { recursive: true, force: true });
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
    await fs.rm(agentArborHome, { recursive: true, force: true });
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
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
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
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
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
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(serverDirectory, { recursive: true, force: true });
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
        autoApprovedTools: ["read_only_tool", "srv__destructive_tool"],
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
