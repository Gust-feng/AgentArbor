import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { modelVisibleToolDescription, normalizeToolFactValue, type ToolCallResult } from "../../domain/tools/index.js";
import { createDesktopBasicToolRegistryForTest as createDesktopBasicToolRegistry } from "../testing/desktop-basic-tool-registry.js";
import { ensurePidExited } from "../tool-center/adapters/background-process-test-utils.js";
import { projectToolDisplay } from "../tool-projection/tool-display-projection.js";
import { createPlatformProcessTerminator, InMemoryProcessRegistry } from "../runtime-guard/index.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

function resultFact(result: ToolCallResult): Readonly<Record<string, unknown>> {
  const output = typeof result.output === "object" && result.output !== null ? result.output as Readonly<Record<string, unknown>> : {};
  const nested = typeof output.result === "object" && output.result !== null ? output.result as Readonly<Record<string, unknown>> : {};
  return { ...output, ...nested };
}

test("tool capability acceptance supports a demo-building workflow without command micro-tools or hangs", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-acceptance-"));
  const processRegistry = new InMemoryProcessRegistry();
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: workspace,
    playwrightAvailable: false,
    processRegistry,
    processTerminator: createPlatformProcessTerminator(),
  });
  const center = registry.createToolCenter("desktop-basic");
  const toolNames = center.list().map((tool) => tool.name);
  let backgroundProcessId: string | undefined;
  let serverPid: number | undefined;

  try {
    assert.deepEqual(toolNames, [
      "ResearchSearch",
      "ResearchRead",
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "Shell",
      "ProcessRead",
      "ProcessStop",
      "AttachmentList",
      "AttachmentRead",
      "AttachmentReadPdf",
      "AttachmentReadImage",
      "AttachmentInspectTable",
      "AttachmentReadTable",
      "AttachmentInspectArchive",
      "AttachmentListFiles",
      "AttachmentSearchFiles",
      "HttpRequest",
    ]);
    assert.equal(toolNames.includes("create_directory"), false);
    assert.equal(toolNames.includes("HttpRequest"), true);
    assert.equal(toolNames.includes("read_binary_file"), false);

    const shellDefinition = center.list().find((tool) => tool.name === "Shell");
    assert.notEqual(shellDefinition, undefined);
    const shellSyntax = requireShellSyntax(
      shellDefinition!.metadata?.runtimeHints?.find((hint) => hint.kind === "command_shell")?.syntax,
    );
    assert.equal("background" in shellDefinition!.inputSchema.properties, true);
    assert.equal("backgroundWaitMs" in shellDefinition!.inputSchema.properties, false);
    assert.equal("cwd" in shellDefinition!.inputSchema.properties, true);
    assert.match(modelVisibleToolDescription(shellDefinition!), /^Run a workspace command in the foreground or start it as an owned background process\./);

    const html = [
      "<!doctype html>",
      "<html>",
      "  <head><title>AgentArbor Demo</title></head>",
      "  <body><main id=\"app\">demo-ready</main></body>",
      "</html>",
      "",
    ].join("\n");
    const write = await executeTool("call-write", "Write", { path: "demo/index.html", content: html });
    assert.equal(write.status, "completed");
    assert.equal(resultFact(write).path, "demo/index.html");
    assert.equal((await stat(path.join(workspace, "demo"))).isDirectory(), true);
    assert.equal(projectToolDisplay({ callId: write.callId, toolName: write.toolName, input: write.input }, write.output).kind, "file_change_summary");

    const read = await executeTool("call-read", "Read", { path: "demo/index.html" });
    assert.equal(read.status, "completed");
    assert.match(String(resultFact(read).content), /demo-ready/);

    const validate = await executeTool("call-validate", "Shell", {
      command: commandForArgs([
        process.execPath,
        "-e",
        "const fs=require('fs'); console.log(fs.readFileSync('index.html','utf8').includes('demo-ready') ? 'validated' : 'missing')",
      ], shellSyntax),
      cwd: "demo",
    });
    assert.equal(validate.status, "completed");
    assert.equal(resultFact(validate).cwd, "demo");
    assert.match(String(resultFact(validate).stdout), /validated/);

    const commandFailure = await executeTool("call-command-failure", "Shell", {
      command: commandForArgs([process.execPath, "-e", "console.error('structured command failure'); process.exit(7);"], shellSyntax),
    });
    const commandFailureContent = resultFact(commandFailure) as {
      readonly exitCode?: number;
      readonly stderr?: string;
    };
    assert.equal(commandFailure.status, "completed");
    assert.equal(commandFailureContent.exitCode, 7);
    assert.match(commandFailureContent.stderr ?? "", /structured command failure/);

    const port = await reserveFreePort();
    const serverSource = [
      "import { createServer } from 'node:http';",
      "const port = Number(process.argv[2]);",
      "const server = createServer((req, res) => {",
      "  if (req.url === '/ready') {",
      "    res.writeHead(200, { 'content-type': 'text/plain' });",
      "    res.end('demo-ready');",
      "    return;",
      "  }",
      "  res.writeHead(404, { 'content-type': 'text/plain' });",
      "  res.end('demo-missing');",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`HTTP_READY:${port}`));",
      "",
    ].join("\n");
    const writeServer = await executeTool("call-write-server", "Write", {
      path: "demo/server.mjs",
      content: serverSource,
    });
    assert.equal(writeServer.status, "completed");

    const server = await executeTool("call-start-server", "Shell", {
      command: commandForArgs([process.execPath, "server.mjs", String(port)], shellSyntax),
      cwd: "demo",
      background: true,
    });
    const serverContent = resultFact(server) as {
      readonly background?: boolean;
      readonly processId?: string;
      readonly pid?: number;
    };
    backgroundProcessId = serverContent.processId;
    serverPid = serverContent.pid;
    assert.equal(server.status, "completed");
    assert.equal(serverContent.background, true);
    assert.equal(typeof serverContent.processId, "string");
    await waitUntil(() => canConnectToLocalhostPort(port), 5_000);

    const inspected = await executeTool("call-read-server", "ProcessRead", { processId: backgroundProcessId });
    assert.equal(inspected.status, "completed");
    assert.equal(resultFact(inspected).processId, backgroundProcessId);

    const httpOk = await executeTool("call-http-ok", "HttpRequest", {
      url: `http://127.0.0.1:${port}/ready`,
      timeoutMs: 2_000,
    });
    const httpOkContent = resultFact(httpOk) as {
      readonly statusCode?: number;
      readonly body?: string;
      readonly method?: string;
    };
    assert.equal(httpOk.status, "completed");
    assert.equal(httpOkContent.method, "GET");
    assert.equal(httpOkContent.statusCode, 200);
    assert.match(httpOkContent.body ?? "", /demo-ready/);

    const httpNotFound = await executeTool("call-http-not-found", "HttpRequest", {
      url: `http://127.0.0.1:${port}/missing`,
      timeoutMs: 2_000,
    });
    const httpNotFoundContent = resultFact(httpNotFound) as {
      readonly statusCode?: number;
      readonly body?: string;
    };
    assert.equal(httpNotFound.status, "completed");
    assert.equal(httpNotFoundContent.statusCode, 404);
    assert.match(httpNotFoundContent.body ?? "", /demo-missing/);

    const stoppedServer = await executeTool("call-stop-server", "ProcessStop", { processId: backgroundProcessId });
    backgroundProcessId = undefined;
    await ensurePidExited(serverPid, 5_000);
    serverPid = undefined;
    assert.equal(stoppedServer.status, "completed");
    await waitUntil(async () => !(await canConnectToLocalhostPort(port)), 5_000);

    const largeOutput = await executeTool("call-large-output", "Shell", {
      command: commandForArgs([process.execPath, "-e", "process.stdout.write('x'.repeat(140000));"], shellSyntax),
    });
    const largeContent = resultFact(largeOutput) as {
      readonly truncated?: boolean;
      readonly stdout?: string;
    };
    assert.equal(largeOutput.status, "completed");
    assert.equal(largeContent.truncated, true);
    assert.equal((largeContent.stdout?.length ?? 0) <= 16_000, true);

    const startedAt = Date.now();
    const timedOut = await executeTool("call-timeout", "Shell", {
      command: commandForArgs([process.execPath, "-e", "console.log('before-timeout'); setTimeout(() => {}, 5000);"], shellSyntax),
      timeoutMs: 1_000,
    });
    const timedOutContent = resultFact(timedOut) as {
      readonly timedOut?: boolean;
      readonly exitCode?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    assert.equal(timedOut.status, "completed");
    assert.equal(timedOutContent.timedOut, true);
    assert.equal(timedOutContent.exitCode, 124);
    assert.match(timedOutContent.stdout ?? "", /before-timeout/);
    assert.match(timedOutContent.stderr ?? "", /timed out after 1000ms/);
    assert.equal(Date.now() - startedAt < 4_000, true);

  } finally {
    if (backgroundProcessId !== undefined) {
      await executeTool("call-stop-background-finally", "ProcessStop", { processId: backgroundProcessId }).catch(() => undefined);
      await ensurePidExited(serverPid, 5_000).catch(() => undefined);
      await delay(50);
    }
    await removeTempTree(workspace);
  }

  async function executeTool(callId: string, toolName: string, input: Record<string, unknown>) {
    return center.execute(
      { callId, toolName, input: normalizeToolFactValue(input) },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: toolNames,
        approvedConfirmationIds: [`confirmation-${callId}`],
      }
    );
  }
});

function commandForArgs(args: readonly string[], syntax: "cmd" | "powershell" | "posix"): string {
  return args.map((argument) => quoteCommandArgument(argument, syntax)).join(" ");
}

function requireShellSyntax(value: unknown): "cmd" | "powershell" | "posix" {
  if (value !== "cmd" && value !== "powershell" && value !== "posix") {
    throw new Error(`Unexpected shell syntax: ${String(value)}`);
  }
  return value;
}

function quoteCommandArgument(value: string, syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") return `"${value.replace(/"/g, '""')}"`;
  if (syntax === "powershell") return `'${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(25);
  }
}

async function removeTempTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}

async function reserveFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  if (port === undefined) {
    throw new Error("Failed to reserve a free local port.");
  }
  return port;
}

function canConnectToLocalhostPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
